'use strict';
/**
 * The ONLY module allowed to change token balances (CLAUDE.md rule 4).
 *
 * Model:
 *   wallets.paidAvailable + wallets.trialAvailable = spendable tokens
 *   wallets.reserved = tokens held for in-flight actions
 *   wallet_ledger: append-only; `tokens` = signed change of available; commit rows carry `spent`.
 * Every movement is one transaction: conditional wallet update + reservation/ledger/lot writes.
 */
const { Wallet, Ledger, TokenLot, Reservation } = require('../../models/wallet');
const { withTransaction } = require('../../lib/mongo');
const { newId } = require('../../lib/ids');
const { AppError, E } = require('../../lib/errors');
const { env } = require('../../config/env');
const policies = require('../../config/policies');

const MAX_OPTIMISTIC_RETRIES = 8;
class VersionConflict extends Error {}

const addMinutes = (d, m) => new Date(d.getTime() + m * 60000);
const addDays = (d, n) => new Date(d.getTime() + n * 86400000);
const total = (w) => w.paidAvailable + w.trialAvailable;

function isDuplicateKey(err) {
  return err && (err.code === 11000 || err.code === 11001 || /E11000/.test(String(err.message)));
}

async function ensureWallet(merchantId) {
  const res = await Wallet.findOneAndUpdate(
    { merchantId },
    { $setOnInsert: { merchantId, paidAvailable: 0, trialAvailable: 0, reserved: 0, version: 0, planCode: 'trial', planStatus: 'active' } },
    { upsert: true, returnDocument: 'after', includeResultMetadata: true },
  ).catch(async (err) => {
    if (isDuplicateKey(err)) return { value: await Wallet.findOne({ merchantId }), lastErrorObject: { updatedExisting: true } };
    throw err;
  });
  const created = res.lastErrorObject && res.lastErrorObject.updatedExisting === false;
  if (created && env().TRIAL_TOKENS > 0) {
    await credit({
      merchantId, tokens: env().TRIAL_TOKENS, bucket: 'trial', source: 'trial', type: 'grant',
      actionRef: `trial:${merchantId}`, expiresAt: addDays(new Date(), 30), reason: 'Free trial tokens',
    }).catch((err) => { if (!isDuplicateKey(err)) throw err; });
    return Wallet.findOne({ merchantId });
  }
  return res.value;
}

async function getBalance(merchantId) {
  const w = (await Wallet.findOne({ merchantId }).lean()) || (await ensureWallet(merchantId)).toObject();
  const soon = addDays(new Date(), 7);
  const expiring = await TokenLot.aggregate([
    { $match: { merchantId, remaining: { $gt: 0 }, expiresAt: { $ne: null, $lte: soon } } },
    { $group: { _id: null, tokens: { $sum: '$remaining' }, firstAt: { $min: '$expiresAt' } } },
  ]);
  return {
    available: total(w),
    paidAvailable: w.paidAvailable,
    trialAvailable: w.trialAvailable,
    reserved: w.reserved,
    planCode: w.planCode,
    planStatus: w.planStatus,
    planRenewsAt: w.planRenewsAt || null,
    expiringSoon: expiring[0] ? { tokens: expiring[0].tokens, firstAt: expiring[0].firstAt } : null,
  };
}

/**
 * Atomically hold tokens. Throws INSUFFICIENT_TOKENS. Returns null when tokens === 0.
 * allowTrial=false excludes trial tokens (video, ADR-009/P4-06).
 */
async function reserve({ merchantId, tokens, purpose, actionType, refId, allowTrial = true, requestId }) {
  if (!Number.isInteger(tokens) || tokens < 0) throw new AppError('INVALID_TOKEN_AMOUNT', 500);
  if (tokens === 0) return null;
  await ensureWallet(merchantId);
  const ttl = policies.reservationTtlMinutes[purpose] ?? 30;

  for (let attempt = 0; attempt < MAX_OPTIMISTIC_RETRIES; attempt += 1) {
    try {
      return await withTransaction(async (session) => {
        const w = await Wallet.findOne({ merchantId }).session(session);
        const trialUsable = allowTrial ? w.trialAvailable : 0;
        if (trialUsable + w.paidAvailable < tokens) {
          throw E.insufficientTokens(tokens, allowTrial ? total(w) : w.paidAvailable);
        }
        const fromTrial = Math.min(trialUsable, tokens);
        const fromPaid = tokens - fromTrial;
        const updated = await Wallet.findOneAndUpdate(
          { merchantId, version: w.version, trialAvailable: { $gte: fromTrial }, paidAvailable: { $gte: fromPaid } },
          { $inc: { trialAvailable: -fromTrial, paidAvailable: -fromPaid, reserved: tokens, version: 1 } },
          { returnDocument: 'after', session },
        );
        if (!updated) throw new VersionConflict();
        const id = newId('rsv');
        const [rsv] = await Reservation.create([{
          _id: id, merchantId, tokens, fromTrial, fromPaid, status: 'held', purpose, actionType, refId,
          expiresAt: addMinutes(new Date(), ttl),
        }], { session });
        await Ledger.create([{
          merchantId, type: 'reserve', tokens: -tokens, availableAfter: total(updated), reservedAfter: updated.reserved,
          actionType, actionRef: `${purpose}:${refId}:${id}`, reservationId: id, requestId,
        }], { session });
        return rsv.toObject();
      });
    } catch (err) {
      if (err instanceof VersionConflict) continue;
      throw err;
    }
  }
  throw new AppError('WALLET_BUSY', 503, 'Wallet is busy, please retry');
}

async function consumeLots(session, merchantId, fromTrial, fromPaid) {
  const take = async (filter, amount) => {
    let left = amount;
    if (left <= 0) return;
    const withExpiry = await TokenLot.find({ ...filter, merchantId, remaining: { $gt: 0 }, expiresAt: { $ne: null } })
      .sort({ expiresAt: 1 }).session(session);
    const noExpiry = await TokenLot.find({ ...filter, merchantId, remaining: { $gt: 0 }, expiresAt: null })
      .sort({ createdAt: 1 }).session(session);
    for (const lot of [...withExpiry, ...noExpiry]) {
      if (left <= 0) break;
      const n = Math.min(lot.remaining, left);
      await TokenLot.updateOne({ _id: lot._id }, { $inc: { remaining: -n } }, { session });
      left -= n;
    }
    // Lots are expiry bookkeeping; the wallet buckets stay authoritative even if lots drift.
  };
  await take({ source: 'trial' }, fromTrial);
  await take({ source: { $ne: 'trial' } }, fromPaid);
}

/** Mark held tokens as spent. Idempotent: returns { settled:false } if already settled. */
async function commit(reservationId, { requestId } = {}) {
  if (!reservationId) return { settled: false };
  return withTransaction(async (session) => {
    const r = await Reservation.findOneAndUpdate(
      { _id: reservationId, status: 'held' }, { $set: { status: 'committed' } }, { returnDocument: 'after', session },
    );
    if (!r) return { settled: false };
    const w = await Wallet.findOneAndUpdate(
      { merchantId: r.merchantId, reserved: { $gte: r.tokens } },
      { $inc: { reserved: -r.tokens, version: 1 } }, { returnDocument: 'after', session },
    );
    if (!w) throw new AppError('WALLET_INVARIANT_BROKEN', 500, 'reserved < reservation tokens');
    await consumeLots(session, r.merchantId, r.fromTrial, r.fromPaid);
    await Ledger.create([{
      merchantId: r.merchantId, type: 'commit', tokens: 0, spent: r.tokens, availableAfter: total(w), reservedAfter: w.reserved,
      actionType: r.actionType, actionRef: `${r.purpose}:${r.refId}:${r._id}`, reservationId: r._id, requestId,
    }], { session });
    return { settled: true, tokens: r.tokens };
  });
}

/** Return held tokens to the buckets they came from. Idempotent. */
async function release(reservationId, { reason, requestId } = {}) {
  if (!reservationId) return { settled: false };
  return withTransaction(async (session) => {
    const r = await Reservation.findOneAndUpdate(
      { _id: reservationId, status: 'held' }, { $set: { status: 'released' } }, { returnDocument: 'after', session },
    );
    if (!r) return { settled: false };
    const w = await Wallet.findOneAndUpdate(
      { merchantId: r.merchantId, reserved: { $gte: r.tokens } },
      { $inc: { reserved: -r.tokens, trialAvailable: r.fromTrial, paidAvailable: r.fromPaid, version: 1 } },
      { returnDocument: 'after', session },
    );
    if (!w) throw new AppError('WALLET_INVARIANT_BROKEN', 500, 'reserved < reservation tokens');
    await Ledger.create([{
      merchantId: r.merchantId, type: 'release', tokens: r.tokens, availableAfter: total(w), reservedAfter: w.reserved,
      actionType: r.actionType, actionRef: `${r.purpose}:${r.refId}:${r._id}`, reservationId: r._id, reason, requestId,
    }], { session });
    return { settled: true, tokens: r.tokens };
  });
}

/**
 * Add tokens. Idempotent by (actionRef, type) unique index — a duplicate throws E11000.
 * Pass `session` to join an outer transaction (e.g. payment credit).
 */
async function credit(opts) {
  if (opts.session) return creditInSession(opts.session, opts);
  await Wallet.updateOne({ merchantId: opts.merchantId }, { $setOnInsert: { merchantId: opts.merchantId } }, { upsert: true })
    .catch((e) => { if (!isDuplicateKey(e)) throw e; });
  return withTransaction((session) => creditInSession(session, opts));
}

async function creditInSession(session, {
  merchantId, tokens, bucket = 'paid', source, type, actionRef, expiresAt = null, reason, actorType = 'system', actorId, requestId,
}) {
  if (!Number.isInteger(tokens) || tokens <= 0) throw new AppError('INVALID_TOKEN_AMOUNT', 500);
  const field = bucket === 'trial' ? 'trialAvailable' : 'paidAvailable';
  const w = await Wallet.findOneAndUpdate(
    { merchantId }, { $inc: { [field]: tokens, version: 1 } }, { returnDocument: 'after', session, upsert: true },
  );
  const lotId = newId('lot');
  await TokenLot.create([{ _id: lotId, merchantId, source, granted: tokens, remaining: tokens, expiresAt, ref: actionRef }], { session });
  await Ledger.create([{
    merchantId, type, tokens, availableAfter: total(w), reservedAfter: w.reserved, actionType: source,
    actionRef, lotId, reason, actorType, actorId, requestId,
  }], { session });
  return { lotId, available: total(w) };
}

/** Admin correction. Negative amounts only succeed if the paid bucket covers them. */
async function adjust({ merchantId, tokens, reason, actorId, requestId }) {
  if (!reason || reason.length < 5) throw E.validation({ reason: 'required' });
  if (tokens > 0) {
    return credit({ merchantId, tokens, bucket: 'paid', source: 'adjust', type: 'adjust', actionRef: `adjust:${newId('adj')}`, reason, actorType: 'admin', actorId, requestId });
  }
  const n = -tokens;
  return withTransaction(async (session) => {
    const w = await Wallet.findOneAndUpdate(
      { merchantId, paidAvailable: { $gte: n } }, { $inc: { paidAvailable: -n, version: 1 } }, { returnDocument: 'after', session },
    );
    if (!w) throw E.conflict('ADJUST_EXCEEDS_BALANCE', 'Paid balance is lower than the adjustment');
    await Ledger.create([{
      merchantId, type: 'adjust', tokens: -n, availableAfter: total(w), reservedAfter: w.reserved,
      actionRef: `adjust:${newId('adj')}`, reason, actorType: 'admin', actorId, requestId,
    }], { session });
    return { available: total(w) };
  });
}

/** Expire lots past expiresAt (runs on a schedule). */
async function expireLots(now = new Date()) {
  const lots = await TokenLot.find({ expiresAt: { $ne: null, $lte: now }, remaining: { $gt: 0 } }).limit(500).lean();
  let expired = 0;
  for (const lot of lots) {
    await withTransaction(async (session) => {
      const fresh = await TokenLot.findOne({ _id: lot._id, remaining: { $gt: 0 } }).session(session);
      if (!fresh) return;
      const field = fresh.source === 'trial' ? 'trialAvailable' : 'paidAvailable';
      const w = await Wallet.findOne({ merchantId: fresh.merchantId }).session(session);
      const n = Math.min(fresh.remaining, w[field]);
      await TokenLot.updateOne({ _id: fresh._id }, { $inc: { remaining: -n } }, { session });
      if (n === 0) return; // tokens are currently reserved; picked up on a later run if released
      const updated = await Wallet.findOneAndUpdate(
        { merchantId: fresh.merchantId, [field]: { $gte: n } }, { $inc: { [field]: -n, version: 1 } }, { returnDocument: 'after', session },
      );
      if (!updated) throw new VersionConflict();
      await Ledger.create([{
        merchantId: fresh.merchantId, type: 'expire', tokens: -n, availableAfter: total(updated), reservedAfter: updated.reserved,
        actionType: fresh.source, actionRef: `expire:${fresh._id}:${now.getTime()}`, lotId: fresh._id, reason: 'Tokens expired',
      }], { session });
      expired += n;
    }).catch((err) => { if (!(err instanceof VersionConflict)) throw err; });
  }
  return { lots: lots.length, tokens: expired };
}

/** Release held reservations whose owner forgot them (crash safety). Owners in executing/unknown are skipped by callers. */
async function listExpiredReservations(now = new Date(), limit = 200) {
  return Reservation.find({ status: 'held', expiresAt: { $lte: now } }).limit(limit).lean();
}

/** Recompute balances from the ledger. Never auto-fixes; returns mismatches for alerting. */
async function reconcile(merchantId) {
  const match = merchantId ? { merchantId } : {};
  const sums = await Ledger.aggregate([
    { $match: match },
    { $group: {
      _id: '$merchantId',
      available: { $sum: '$tokens' },
      reservedIn: { $sum: { $cond: [{ $eq: ['$type', 'reserve'] }, { $multiply: ['$tokens', -1] }, 0] } },
      releasedOut: { $sum: { $cond: [{ $eq: ['$type', 'release'] }, '$tokens', 0] } },
      committedOut: { $sum: { $cond: [{ $eq: ['$type', 'commit'] }, '$spent', 0] } },
    } },
  ]);
  const mismatches = [];
  for (const s of sums) {
    const w = await Wallet.findOne({ merchantId: s._id }).lean();
    const expectedReserved = s.reservedIn - s.releasedOut - s.committedOut;
    if (!w || total(w) !== s.available || w.reserved !== expectedReserved) {
      mismatches.push({ merchantId: s._id, ledgerAvailable: s.available, walletAvailable: w ? total(w) : null, ledgerReserved: expectedReserved, walletReserved: w ? w.reserved : null });
    }
  }
  return { checked: sums.length, mismatches };
}

async function setPlan({ merchantId, planCode, renewsAt, session }) {
  const opts = session ? { session } : {};
  await Wallet.updateOne({ merchantId }, { $set: { planCode, planStatus: 'active', planRenewsAt: renewsAt } }, { upsert: true, ...opts });
}

module.exports = {
  ensureWallet, getBalance, reserve, commit, release, credit, adjust, expireLots, listExpiredReservations, reconcile, setPlan, isDuplicateKey,
};
