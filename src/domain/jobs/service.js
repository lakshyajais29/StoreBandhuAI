'use strict';
/** Media job orchestration (docs/02-ARCHITECTURE.md §5.5). */
const { MediaJob, Asset } = require('../../models/media');
const wallet = require('../wallet/service');
const limits = require('./limits');
const { resolveMerchantAssets } = require('./assets');
const { newId } = require('../../lib/ids');
const { sha256 } = require('../../lib/canonical');
const { costOf } = require('../../config/tokens');
const { env } = require('../../config/env');
const { AppError, E } = require('../../lib/errors');
const { mediaQueueFor } = require('../../queues');
const { gateway } = require('../../integrations/media/gateway');
const { storage } = require('../../integrations/storage');
const { logger } = require('../../lib/logger');

function publicJob(j) {
  return {
    id: j._id, kind: j.kind, status: j.status, tokenCost: j.tokenCost, style: j.input?.style, productId: j.input?.productId || null,
    resultUrl: j.resultUrl || null, resultAssetId: j.resultAssetId || null, attachStatus: j.attachStatus,
    error: j.status === 'failed' ? { code: j.errorCode, message: j.errorMessage } : null, createdAt: j.createdAt, finishedAt: j.finishedAt || null,
  };
}

/** Decide video model (P4-04). Never trusts a text-only LLM guess about image contents. */
async function routeVideoModel({ hasPerson, imageUrl }) {
  const e = env();
  if (hasPerson === 'yes') return { model: e.VIDEO_MODEL_PERSON_ID, reason: 'merchant_said_person' };
  if (hasPerson === 'no') return { model: e.VIDEO_MODEL_DEFAULT_ID, reason: 'merchant_said_no_person' };
  const detected = await gateway().classifyPerson({ imageUrl }).catch(() => null);
  if (detected === true) return { model: e.VIDEO_MODEL_PERSON_ID, reason: 'classifier_person' };
  if (detected === false) return { model: e.VIDEO_MODEL_DEFAULT_ID, reason: 'classifier_no_person' };
  return e.VIDEO_UNKNOWN_PERSON_ROUTE === 'person'
    ? { model: e.VIDEO_MODEL_PERSON_ID, reason: 'unknown_defaults_to_person_model' }
    : { model: e.VIDEO_MODEL_DEFAULT_ID, reason: 'unknown_defaults_to_default_model' };
}

async function enqueue(tool, args, ctx) {
  const spec = tool.jobSpec(args, ctx);
  const [asset] = await resolveMerchantAssets(ctx.merchantId, [spec.assetId]);
  const tokenCost = costOf(tool.name, args);
  const e = env();

  const { model, reason } = spec.kind === 'video'
    ? await routeVideoModel({ hasPerson: spec.params.hasPerson, imageUrl: asset.url })
    : { model: e.IMAGE_MODEL_ID, reason: 'image_default' };
  const cacheKey = sha256([asset.sha256, spec.kind, model, spec.style, JSON.stringify(spec.params || {})].join('|'));

  // Cache: identical source + settings already generated for this merchant → reuse, no charge (ADR-009 default).
  const cached = await MediaJob.findOne({ merchantId: ctx.merchantId, cacheKey, status: 'succeeded' }).sort({ createdAt: -1 }).lean();
  if (cached) return { cached: true, job: publicJob(cached) };

  const jobId = newId('job');
  const lim = limits.planLimits(ctx.plan, spec.kind);
  const got = await limits.acquire({ merchantId: ctx.merchantId, kind: spec.kind, jobId, limits: lim, staleMs: e.MEDIA_JOB_TIMEOUT_MS + 10 * 60000 });
  if (!got.ok) {
    throw E.rateLimited({
      kind: spec.kind, reason: got.reason, retryAt: got.retryAt,
      message: got.reason === 'concurrent'
        ? `You already have ${lim.concurrent} ${spec.kind} jobs running. Please wait for one to finish.`
        : `Daily ${spec.kind} limit reached (${lim.perDay} per 24 hours).`,
    });
  }

  let reservation;
  try {
    reservation = await wallet.reserve({
      merchantId: ctx.merchantId, tokens: tokenCost, purpose: 'media_job', actionType: tool.name, refId: jobId,
      allowTrial: spec.kind !== 'video', requestId: ctx.requestId,
    });
    const job = await MediaJob.create({
      _id: jobId, merchantId: ctx.merchantId, userId: ctx.userId, conversationId: ctx.conversationId ? String(ctx.conversationId) : undefined,
      kind: spec.kind, model, routeReason: reason, input: { assetId: asset._id, style: spec.style, productId: spec.productId, params: spec.params },
      cacheKey, reservationId: reservation?._id, tokenCost, status: 'queued',
    });
    await mediaQueueFor(spec.kind).add(spec.kind, { jobId }, {
      jobId, attempts: 3, backoff: { type: 'exponential', delay: 5000 }, removeOnComplete: { count: 1000 }, removeOnFail: { count: 5000 },
    });
    return { cached: false, job: publicJob(job) };
  } catch (err) {
    await limits.releaseAll({ merchantId: ctx.merchantId, kind: spec.kind, jobId }).catch(() => {});
    if (reservation) await wallet.release(reservation._id, { reason: 'enqueue failed' }).catch(() => {});
    await MediaJob.updateOne({ _id: jobId, status: 'queued' }, { $set: { status: 'failed', errorCode: 'ENQUEUE_FAILED', errorMessage: 'Could not start the job', finishedAt: new Date() } }).catch(() => {});
    if (err instanceof AppError) throw err;
    logger.error({ err }, 'media enqueue failed');
    throw new AppError('MEDIA_UNAVAILABLE', 503, 'Media generation is unavailable right now');
  }
}

async function get(merchantId, jobId) {
  const j = await MediaJob.findOne({ _id: jobId, merchantId }).lean();
  if (!j) throw E.notFound('Job');
  return publicJob(j);
}

async function list(merchantId, limit = 20) {
  const rows = await MediaJob.find({ merchantId }).sort({ createdAt: -1 }).limit(Math.min(limit, 50)).lean();
  return rows.map(publicJob);
}

/** Merchant-safe failure text by code. */
const FAILURE_TEXT = {
  NSFW_REJECTED: 'The image was rejected by the safety filter. Try a different photo.',
  INVALID_INPUT: 'This photo could not be processed. Try a clearer, well-lit product photo (JPG or PNG).',
  PROVIDER_TIMEOUT: 'Generation took too long and was stopped.',
  PROVIDER_ERROR: 'The generation service failed.',
  RESULT_INVALID: 'The generated file was not valid.',
  STUCK: 'The job stopped responding.',
};

async function assetUrl(assetId) {
  const a = await Asset.findById(assetId).lean();
  return a ? { url: a.url || storage().publicUrl(a.key), key: a.key } : null;
}

module.exports = { enqueue, get, list, publicJob, routeVideoModel, FAILURE_TEXT, assetUrl };
