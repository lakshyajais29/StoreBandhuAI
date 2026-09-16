'use strict';
/** Scheduled housekeeping. Every task is idempotent and safe to run concurrently with itself. */
const actions = require('../../domain/actions/service');
const wallet = require('../../domain/wallet/service');
const { MediaJob } = require('../../models/media');
const { PendingAction } = require('../../models/action');
const { Wallet } = require('../../models/wallet');
const { finalFailure } = require('./mediaJob');
const { env } = require('../../config/env');
const { logger } = require('../../lib/logger');

async function sweepStuckMedia() {
  const e = env();
  const runningBefore = new Date(Date.now() - e.MEDIA_JOB_TIMEOUT_MS - 10 * 60000);
  const queuedBefore = new Date(Date.now() - 3 * 60 * 60000);
  const stuck = await MediaJob.find({
    $or: [{ status: 'running', startedAt: { $lte: runningBefore } }, { status: 'queued', createdAt: { $lte: queuedBefore } }],
  }).limit(200);
  for (const j of stuck) await finalFailure(j, 'STUCK');
  return { failed: stuck.length };
}

/** Held reservations past TTL: settle based on the owner's real state. */
async function settleOrphanReservations() {
  const rows = await wallet.listExpiredReservations();
  const out = { committed: 0, released: 0, skipped: 0 };
  for (const r of rows) {
    let decision = 'skip';
    if (r.purpose === 'chat_turn') decision = 'release';
    if (r.purpose === 'media_job') {
      const j = await MediaJob.findById(r.refId).lean();
      if (!j || j.status === 'failed') decision = 'release';
      else if (j.status === 'succeeded') decision = 'commit';
    }
    if (r.purpose === 'pending_action' || r.purpose === 'sync_write') {
      const pa = await PendingAction.findById(r.refId).lean();
      if (!pa || ['failed', 'cancelled', 'expired'].includes(pa.status)) decision = 'release';
      else if (pa.status === 'succeeded') decision = 'commit';
    }
    if (decision === 'release') { await wallet.release(r._id, { reason: 'orphan reservation' }); out.released += 1; }
    else if (decision === 'commit') { await wallet.commit(r._id); out.committed += 1; }
    else out.skipped += 1;
  }
  return out;
}

async function expirePlans() {
  const res = await Wallet.updateMany({ planStatus: 'active', planCode: { $ne: 'trial' }, planRenewsAt: { $lte: new Date() } }, { $set: { planStatus: 'expired' } });
  return { expired: res.modifiedCount };
}

async function reconcileWallets() {
  const r = await wallet.reconcile();
  if (r.mismatches.length) logger.error({ mismatches: r.mismatches }, 'ALERT: wallet ledger mismatch');
  return { checked: r.checked, mismatches: r.mismatches.length };
}

const TASKS = {
  'expire-actions': () => actions.expireStale(),
  'reconcile-unknown-actions': () => actions.reconcileUnknown(),
  'sweep-stuck-media': sweepStuckMedia,
  'settle-orphan-reservations': settleOrphanReservations,
  'expire-token-lots': () => wallet.expireLots(),
  'expire-plans': expirePlans,
  'reconcile-wallets': reconcileWallets,
};

const SCHEDULE = {
  'expire-actions': { every: 60_000 },
  'reconcile-unknown-actions': { every: 120_000 },
  'sweep-stuck-media': { every: 120_000 },
  'settle-orphan-reservations': { every: 300_000 },
  'expire-token-lots': { every: 3_600_000 },
  'expire-plans': { every: 3_600_000 },
  'reconcile-wallets': { pattern: '30 2 * * *', tz: 'Asia/Kolkata' },
};

async function processMaintenance(job) {
  const fn = TASKS[job.name];
  if (!fn) throw new Error(`unknown maintenance task ${job.name}`);
  const result = await fn();
  logger.info({ task: job.name, result }, 'maintenance task done');
  return result;
}

module.exports = { processMaintenance, TASKS, SCHEDULE, sweepStuckMedia, settleOrphanReservations };
