'use strict';
/** Plans, token packs and Razorpay (docs/02-ARCHITECTURE.md §5.6). One credit path for verify + webhook. */
const { Payment, WebhookEvent } = require('../../models/billing');
const { Ledger } = require('../../models/wallet');
const wallet = require('../wallet/service');
const { withTransaction } = require('../../lib/mongo');
const { plans, tokenPacks, PLAN_PERIOD_DAYS } = require('../../config/plans');
const { env } = require('../../config/env');
const { newId } = require('../../lib/ids');
const { E, AppError } = require('../../lib/errors');
const { razorpay, verifyCheckoutSignature, verifyWebhookSignature } = require('../../integrations/razorpay/client');
const { logger } = require('../../lib/logger');

function catalogue() {
  return {
    plans: Object.values(plans).filter((p) => p.pricePaise > 0).map((p) => ({ code: p.code, name: p.name, pricePaise: p.pricePaise, monthlyTokens: p.monthlyTokens, features: p.features, periodDays: PLAN_PERIOD_DAYS })),
    packs: Object.values(tokenPacks),
    currency: 'INR',
  };
}

async function createCheckout({ merchantId }, { kind, code }) {
  const item = kind === 'plan' ? plans[code] : tokenPacks[code];
  if (!item || (kind === 'plan' && item.pricePaise <= 0)) throw E.validation([{ field: 'code', problem: 'unknown plan or pack' }]);
  const tokens = kind === 'plan' ? item.monthlyTokens : item.tokens;
  const paymentId = newId('pay');
  const order = await razorpay().orders.create({
    amount: item.pricePaise, currency: 'INR', receipt: paymentId, notes: { merchantId, kind, code },
  });
  await Payment.create({ _id: paymentId, merchantId, kind, itemCode: code, tokens, amountPaise: item.pricePaise, razorpayOrderId: order.id });
  return { paymentId, razorpayOrderId: order.id, keyId: env().RAZORPAY_KEY_ID, amountPaise: item.pricePaise, currency: 'INR', tokens };
}

/**
 * Idempotent: the Payment status flip created→paid happens once inside the transaction;
 * the ledger unique index on actionRef is a second guard.
 */
async function creditPayment({ razorpayOrderId, razorpayPaymentId, amountPaise }) {
  return withTransaction(async (session) => {
    const pay = await Payment.findOne({ razorpayOrderId }).session(session);
    if (!pay) throw new AppError('PAYMENT_NOT_FOUND', 404, 'Unknown order');
    if (pay.status === 'paid') return { credited: false, payment: pay };
    if (typeof amountPaise === 'number' && amountPaise !== pay.amountPaise) {
      throw new AppError('AMOUNT_MISMATCH', 409, 'Paid amount does not match order', { expected: pay.amountPaise, got: amountPaise });
    }
    const flipped = await Payment.findOneAndUpdate(
      { _id: pay._id, status: { $ne: 'paid' } },
      { $set: { status: 'paid', razorpayPaymentId, paidAt: new Date() } }, { returnDocument: 'after', session },
    );
    if (!flipped) return { credited: false, payment: pay };

    const now = new Date();
    let expiresAt = null;
    if (pay.kind === 'plan') {
      const current = await require('../../models/wallet').Wallet.findOne({ merchantId: pay.merchantId }).session(session);
      const start = current?.planCode === pay.itemCode && current?.planStatus === 'active' && current.planRenewsAt > now ? current.planRenewsAt : now;
      const renewsAt = new Date(start.getTime() + PLAN_PERIOD_DAYS * 86400000);
      await wallet.setPlan({ merchantId: pay.merchantId, planCode: pay.itemCode, renewsAt, session });
      if (env().PLAN_TOKENS_EXPIRE) expiresAt = renewsAt;
    }
    await wallet.credit({
      session, merchantId: pay.merchantId, tokens: pay.tokens, bucket: 'paid', source: pay.kind === 'plan' ? 'plan' : 'topup',
      type: 'purchase', actionRef: `rzp:${razorpayPaymentId || razorpayOrderId}`, expiresAt, reason: `${pay.kind} ${pay.itemCode}`,
    });
    return { credited: true, payment: flipped };
  });
}

/** Optional fast path after Checkout success; the webhook remains the source of truth. */
async function verifyCheckout({ merchantId }, { razorpayOrderId, razorpayPaymentId, razorpaySignature }) {
  const pay = await Payment.findOne({ razorpayOrderId, merchantId }).lean();
  if (!pay) throw E.notFound('Payment');
  if (!verifyCheckoutSignature({ orderId: razorpayOrderId, paymentId: razorpayPaymentId, signature: razorpaySignature }, env().RAZORPAY_KEY_SECRET)) {
    throw new AppError('INVALID_SIGNATURE', 400, 'Payment signature is invalid');
  }
  const r = await creditPayment({ razorpayOrderId, razorpayPaymentId });
  return { status: 'paid', credited: r.credited, wallet: await wallet.getBalance(merchantId) };
}

async function handleWebhook({ rawBody, signature, eventIdHeader }) {
  const secret = env().RAZORPAY_WEBHOOK_SECRET;
  if (!verifyWebhookSignature(rawBody, signature, secret)) throw new AppError('INVALID_SIGNATURE', 400, 'Invalid webhook signature');
  let event;
  try { event = JSON.parse(rawBody.toString('utf8')); } catch { throw new AppError('INVALID_PAYLOAD', 400, 'Invalid JSON'); }
  const eventId = eventIdHeader || `${event.event}:${event.payload?.payment?.entity?.id || event.payload?.order?.entity?.id}:${event.created_at}`;

  try {
    await WebhookEvent.create({ provider: 'razorpay', eventId, type: event.event, payload: event });
  } catch (err) {
    if (wallet.isDuplicateKey(err)) {
      const existing = await WebhookEvent.findOne({ provider: 'razorpay', eventId }).lean();
      if (existing?.processedAt) return { duplicate: true };
      // Previous delivery crashed mid-way: fall through and re-process (credit is idempotent).
    } else throw err;
  }

  try {
    const payment = event.payload?.payment?.entity;
    const order = event.payload?.order?.entity;
    switch (event.event) {
      case 'payment.captured':
      case 'order.paid':
        await creditPayment({ razorpayOrderId: payment?.order_id || order?.id, razorpayPaymentId: payment?.id, amountPaise: payment?.amount });
        break;
      case 'payment.failed':
        if (payment?.order_id) await Payment.updateOne({ razorpayOrderId: payment.order_id, status: 'created' }, { $set: { status: 'failed' } });
        break;
      case 'refund.processed':
        // Policy decision (ADR-009): we flag; an admin decides on token claw-back via /admin adjust.
        logger.error({ paymentId: payment?.id }, 'ALERT: Razorpay refund processed; review token balance manually');
        if (payment?.id) await Payment.updateOne({ razorpayPaymentId: payment.id }, { $set: { status: 'refunded' } });
        break;
      default:
        break;
    }
    await WebhookEvent.updateOne({ provider: 'razorpay', eventId }, { $set: { processedAt: new Date(), error: null } });
    return { processed: true };
  } catch (err) {
    await WebhookEvent.updateOne({ provider: 'razorpay', eventId }, { $set: { error: String(err.message).slice(0, 500) } }).catch(() => {});
    throw err;
  }
}

/** Spend by action type from the ledger (commit rows = actual spend). */
async function usage(merchantId, { from, to }) {
  const match = { merchantId, type: 'commit' };
  if (from || to) match.createdAt = { ...(from ? { $gte: new Date(from) } : {}), ...(to ? { $lte: new Date(to) } : {}) };
  const [byAction, byDay, totals] = await Promise.all([
    Ledger.aggregate([{ $match: match }, { $group: { _id: '$actionType', tokens: { $sum: '$spent' }, count: { $sum: 1 } } }, { $sort: { tokens: -1 } }]),
    Ledger.aggregate([{ $match: match }, { $group: { _id: { $dateToString: { format: '%Y-%m-%d', date: '$createdAt', timezone: 'Asia/Kolkata' } }, tokens: { $sum: '$spent' } } }, { $sort: { _id: 1 } }]),
    Ledger.aggregate([{ $match: match }, { $group: { _id: null, tokens: { $sum: '$spent' }, count: { $sum: 1 } } }]),
  ]);
  return {
    from: from || null, to: to || null,
    totalTokens: totals[0]?.tokens || 0, actions: totals[0]?.count || 0,
    byAction: byAction.map((r) => ({ action: r._id, tokens: r.tokens, count: r.count })),
    byDay: byDay.map((r) => ({ day: r._id, tokens: r.tokens })),
  };
}

async function listPayments(merchantId) {
  return Payment.find({ merchantId }).sort({ createdAt: -1 }).limit(50).lean();
}

module.exports = { catalogue, createCheckout, creditPayment, verifyCheckout, handleWebhook, usage, listPayments };
