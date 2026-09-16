'use strict';
/**
 * Pending actions (ADR-007, docs/02-ARCHITECTURE.md §5.4).
 * Every write goes through here — confirmed or immediate — so reconciliation is uniform.
 */
const { PendingAction } = require('../../models/action');
const wallet = require('../wallet/service');
const { newId } = require('../../lib/ids');
const { hashArgs } = require('../../lib/canonical');
const { AppError, E } = require('../../lib/errors');
const { isAmbiguousUpstreamError, laravel } = require('../../integrations/laravel/client');
const { costOf } = require('../../config/tokens');
const policies = require('../../config/policies');
const conversations = require('../conversations/service');
const { logger } = require('../../lib/logger');

const registry = () => require('../../tools/registry');

function publicView(pa) {
  return {
    id: pa._id, tool: pa.tool, status: pa.status, preview: pa.preview, tokenCost: pa.tokenCost,
    expiresAt: pa.expiresAt, result: pa.result || null, error: pa.error ? { code: pa.error.code, message: pa.error.message } : null,
  };
}

async function create({ ctx, tool, args, preview, requiresConfirmation }) {
  const id = newId('pa');
  const tokenCost = costOf(tool.name, args);
  const reservation = await wallet.reserve({
    merchantId: ctx.merchantId, tokens: tokenCost, purpose: requiresConfirmation ? 'pending_action' : 'sync_write',
    actionType: tool.name, refId: id, requestId: ctx.requestId,
  });
  try {
    return await PendingAction.create({
      _id: id, merchantId: ctx.merchantId, userId: ctx.userId, conversationId: ctx.conversationId ? String(ctx.conversationId) : undefined,
      tool: tool.name, args, argsHash: hashArgs(args), preview, tokenCost, reservationId: reservation?._id, requiresConfirmation,
      status: requiresConfirmation ? 'awaiting_confirmation' : 'executing',
      executingSince: requiresConfirmation ? undefined : new Date(),
      expiresAt: requiresConfirmation ? new Date(Date.now() + policies.pendingActionTtlMinutes * 60000) : undefined,
    });
  } catch (err) {
    if (reservation) await wallet.release(reservation._id, { reason: 'pending action create failed' });
    throw err;
  }
}

function laravelFor(pa, requestId) {
  return laravel().forMerchant({ merchantId: pa.merchantId, userId: pa.userId, requestId });
}

/** Run the frozen args against Laravel and settle tokens. pa must already be in `executing`. */
async function executeAndSettle(pa, { requestId, signal } = {}) {
  const tool = registry().getTool(pa.tool);
  if (hashArgs(pa.args) !== pa.argsHash) {
    await settle(pa, 'failed', { error: { code: 'ARGS_TAMPERED', message: 'Action data changed after preview' } });
    throw new AppError('ARGS_TAMPERED', 409, 'This action changed after it was previewed and was not executed');
  }
  const ctx = { merchantId: pa.merchantId, userId: pa.userId, requestId, signal, laravel: laravelFor(pa, requestId) };
  try {
    const result = await tool.execute(pa.args, ctx, { idempotencyKey: pa._id });
    return settle(pa, 'succeeded', { result, summary: tool.summarize(result, pa.args, pa.preview) });
  } catch (err) {
    if (isAmbiguousUpstreamError(err) || !(err instanceof AppError)) {
      logger.warn({ err: err.message, actionId: pa._id }, 'write outcome unknown; will reconcile');
      return settle(pa, 'unknown', { error: { code: err.code || 'UNKNOWN_OUTCOME', message: 'We could not confirm whether this finished. We are checking.' } });
    }
    return settle(pa, 'failed', { error: { code: err.code, message: err.message, details: err.details } });
  }
}

async function settle(pa, status, { result, summary, error } = {}) {
  const update = { status, settledAt: ['succeeded', 'failed', 'cancelled', 'expired'].includes(status) ? new Date() : undefined };
  if (result !== undefined) update.result = result;
  if (summary) update.result = { ...(result || {}), summary };
  if (error) update.error = error;
  const fromStatuses = status === 'unknown' ? ['executing'] : ['executing', 'unknown', 'awaiting_confirmation'];
  const doc = await PendingAction.findOneAndUpdate({ _id: pa._id, status: { $in: fromStatuses } }, { $set: update }, { returnDocument: 'after' });
  if (!doc) return PendingAction.findById(pa._id);
  if (status === 'succeeded') await wallet.commit(doc.reservationId);
  if (['failed', 'cancelled', 'expired'].includes(status)) await wallet.release(doc.reservationId, { reason: `action ${status}` });
  return doc;
}

/** Merchant pressed Confirm. Exactly one caller wins the awaiting→executing transition. */
async function confirm({ merchantId, userId, requestId }, id) {
  const now = new Date();
  const pa = await PendingAction.findOneAndUpdate(
    { _id: id, merchantId, status: 'awaiting_confirmation', expiresAt: { $gt: now } },
    { $set: { status: 'executing', executingSince: now, confirmedBy: userId } },
    { returnDocument: 'after' },
  );
  if (!pa) {
    const existing = await PendingAction.findOne({ _id: id, merchantId });
    if (!existing) throw E.notFound('Action');
    if (existing.status === 'awaiting_confirmation') {
      await expireOne(existing._id);
      throw E.gone('ACTION_EXPIRED', 'This preview expired. Ask again to get a fresh one.');
    }
    throw E.conflict('ACTION_ALREADY_HANDLED', `This action is already ${existing.status}`, { status: existing.status });
  }
  const { featureAccess } = registry();
  const tool = registry().getTool(pa.tool);
  const access = featureAccess(tool.feature, (await wallet.getBalance(merchantId)).planCode);
  if (access !== 'ok') {
    await settle(pa, 'failed', { error: { code: access === 'plan' ? 'PLAN_UPGRADE_REQUIRED' : 'FEATURE_DISABLED', message: 'Not available right now' } });
    throw access === 'plan' ? E.planUpgrade(tool.feature) : E.featureDisabled(tool.feature);
  }
  const done = await executeAndSettle(pa, { requestId });
  await postToConversation(done);
  return publicView(done);
}

async function cancel({ merchantId }, id) {
  const pa = await PendingAction.findOneAndUpdate(
    { _id: id, merchantId, status: 'awaiting_confirmation' }, { $set: { status: 'cancelled', settledAt: new Date() } }, { returnDocument: 'after' },
  );
  if (!pa) {
    const existing = await PendingAction.findOne({ _id: id, merchantId });
    if (!existing) throw E.notFound('Action');
    throw E.conflict('ACTION_ALREADY_HANDLED', `This action is already ${existing.status}`, { status: existing.status });
  }
  await wallet.release(pa.reservationId, { reason: 'cancelled by merchant' });
  await postToConversation(pa);
  return publicView(pa);
}

async function expireOne(id) {
  const pa = await PendingAction.findOneAndUpdate(
    { _id: id, status: 'awaiting_confirmation', expiresAt: { $lte: new Date() } },
    { $set: { status: 'expired', settledAt: new Date() } }, { returnDocument: 'after' },
  );
  if (pa) await wallet.release(pa.reservationId, { reason: 'preview expired' });
  return pa;
}

async function expireStale() {
  const stale = await PendingAction.find({ status: 'awaiting_confirmation', expiresAt: { $lte: new Date() } }).select('_id').limit(500).lean();
  let n = 0;
  for (const { _id } of stale) if (await expireOne(_id)) n += 1;
  return n;
}

/** Settle `unknown` and stuck `executing` actions by asking Laravel what happened to the idempotency key. */
async function reconcileUnknown() {
  const stuckBefore = new Date(Date.now() - policies.stuckActionMinutes * 60000);
  const rows = await PendingAction.find({
    $or: [{ status: 'unknown' }, { status: 'executing', executingSince: { $lte: stuckBefore } }],
  }).limit(100);
  const out = { checked: rows.length, settled: 0 };
  for (const pa of rows) {
    try {
      const r = await laravelFor(pa, `reconcile-${pa._id}`).getIdempotency(pa._id);
      await PendingAction.updateOne({ _id: pa._id }, { $inc: { reconcileAttempts: 1 } });
      if (r.found && r.status >= 200 && r.status < 300) {
        const tool = registry().getTool(pa.tool);
        const done = await settle(pa, 'succeeded', { result: r.body, summary: tool.summarize(r.body, pa.args, pa.preview) });
        await postToConversation(done);
        out.settled += 1;
      } else if (r.found) {
        const done = await settle(pa, 'failed', { error: { code: r.body?.error?.code || `LARAVEL_${r.status}`, message: r.body?.error?.message || 'The store rejected this action' } });
        await postToConversation(done);
        out.settled += 1;
      } else if (pa.status === 'unknown' || pa.executingSince <= stuckBefore) {
        // Laravel never saw the key after the stuck window → the write did not happen.
        const done = await settle(pa, 'failed', { error: { code: 'NOT_EXECUTED', message: 'This action did not reach the store. Nothing was charged.' } });
        await postToConversation(done);
        out.settled += 1;
      }
    } catch (err) {
      logger.warn({ err: err.message, actionId: pa._id }, 'reconcile attempt failed');
    }
  }
  return out;
}

async function postToConversation(pa) {
  let content;
  if (pa.status === 'succeeded') content = pa.result?.summary || 'Done.';
  else if (pa.status === 'failed') content = `That didn't go through: ${pa.error?.message || 'unknown error'}. No tokens were charged.`;
  else if (pa.status === 'cancelled') content = 'Cancelled. No tokens were charged.';
  else if (pa.status === 'expired') content = 'That preview expired. No tokens were charged.';
  else if (pa.status === 'unknown') content = pa.error?.message;
  if (!content) return;
  await conversations.appendSystemEvent({
    conversationId: pa.conversationId, merchantId: pa.merchantId, content: `${content} [action ${pa._id}: ${pa.tool} ${pa.status}]`,
    ui: { type: 'action_result', action: publicView(pa) },
  }).catch((err) => logger.warn({ err: err.message }, 'could not post action result to conversation'));
}

async function get(merchantId, id) {
  const pa = await PendingAction.findOne({ _id: id, merchantId }).lean();
  if (!pa) throw E.notFound('Action');
  return publicView(pa);
}

module.exports = { create, executeAndSettle, confirm, cancel, expireStale, reconcileUnknown, publicView, get, settle };
