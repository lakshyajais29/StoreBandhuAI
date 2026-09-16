'use strict';
/** BullMQ processor for image + video jobs. Runs only in src/worker.js. */
const axios = require('axios');
const { MediaJob, Asset } = require('../../models/media');
const wallet = require('../../domain/wallet/service');
const limits = require('../../domain/jobs/limits');
const jobsService = require('../../domain/jobs/service');
const conversations = require('../../domain/conversations/service');
const { gateway, MediaError } = require('../../integrations/media/gateway');
const { storage } = require('../../integrations/storage');
const { laravel } = require('../../integrations/laravel/client');
const { env } = require('../../config/env');
const { newId } = require('../../lib/ids');
const { sha256 } = require('../../lib/canonical');
const { logger } = require('../../lib/logger');

const MAX_RESULT_BYTES = 80 * 1024 * 1024;
const EXT = { 'image/png': 'png', 'image/jpeg': 'jpg', 'image/webp': 'webp', 'video/mp4': 'mp4' };

async function downloadResult(url, signal) {
  const res = await axios.get(url, { responseType: 'arraybuffer', timeout: 120000, maxContentLength: MAX_RESULT_BYTES, signal, validateStatus: () => true });
  if (res.status !== 200) throw new MediaError('PROVIDER_ERROR', `download failed ${res.status}`, true);
  return { buffer: Buffer.from(res.data), mime: String(res.headers['content-type'] || '').split(';')[0] };
}

async function finalFailure(doc, code, extra = {}) {
  const updated = await MediaJob.findOneAndUpdate(
    { _id: doc._id, status: { $in: ['queued', 'running'] } },
    { $set: { status: 'failed', errorCode: code, errorMessage: jobsService.FAILURE_TEXT[code] || 'Generation failed.', finishedAt: new Date(), ...extra } },
    { returnDocument: 'after' },
  );
  if (!updated) return;
  await wallet.release(updated.reservationId, { reason: `media ${code}` });
  await limits.releaseAll({ merchantId: updated.merchantId, kind: updated.kind, jobId: updated._id }).catch(() => {});
  await conversations.appendSystemEvent({
    conversationId: updated.conversationId, merchantId: updated.merchantId,
    content: `The ${updated.kind} job ${updated._id} failed: ${updated.errorMessage} No tokens were charged.`,
    ui: { type: 'job', job: jobsService.publicJob(updated) },
  }).catch(() => {});
}

async function processMediaJob(bullJob) {
  const { jobId } = bullJob.data;
  const doc = await MediaJob.findOneAndUpdate(
    { _id: jobId, status: { $in: ['queued', 'running'] } },
    { $set: { status: 'running', startedAt: new Date() }, $inc: { attempts: 1 } },
    { returnDocument: 'after' },
  );
  if (!doc) return { skipped: true };

  const e = env();
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), e.MEDIA_JOB_TIMEOUT_MS);
  const isLastAttempt = bullJob.attemptsMade + 1 >= (bullJob.opts.attempts || 1);

  try {
    const source = await jobsService.assetUrl(doc.input.assetId);
    if (!source) return finalFailure(doc, 'INVALID_INPUT');

    const out = await gateway().run({
      kind: doc.kind, modelId: doc.model, imageUrl: source.url, sourceKey: source.key, style: doc.input.style, params: doc.input.params, signal: controller.signal,
    });
    const file = out.buffer ? { buffer: out.buffer, mime: out.mime } : await downloadResult(out.url, controller.signal);
    const ext = EXT[file.mime];
    if (!ext || file.buffer.length === 0) throw new MediaError('RESULT_INVALID', `unexpected result type ${file.mime}`, false);

    const assetId = newId('ast');
    const key = `generated/${doc.merchantId}/${assetId}.${ext}`;
    await storage().putObject({ key, body: file.buffer, mime: file.mime });
    const url = storage().publicUrl(key);
    await Asset.create({ _id: assetId, merchantId: doc.merchantId, kind: 'generated', status: 'ready', key, url, mime: file.mime, bytes: file.buffer.length, sha256: sha256(file.buffer), sourceJobId: doc._id });

    const succeeded = await MediaJob.findOneAndUpdate(
      { _id: doc._id, status: 'running' },
      { $set: { status: 'succeeded', resultAssetId: assetId, resultUrl: url, finishedAt: new Date(), providerCostUsd: out.costUsd } },
      { returnDocument: 'after' },
    );
    if (!succeeded) return { skipped: true };
    await wallet.commit(succeeded.reservationId);
    await limits.releaseConcurrent({ merchantId: doc.merchantId, kind: doc.kind, jobId: doc._id }).catch(() => {});

    if (doc.input.productId) {
      try {
        const r = await laravel().forMerchant({ merchantId: doc.merchantId, userId: doc.userId, requestId: `job-${doc._id}` })
          .attachMedia(doc.input.productId, { url, kind: doc.kind, source: 'bandhu_ai', set_as_primary: false }, { idempotencyKey: `media-${doc._id}` });
        await MediaJob.updateOne({ _id: doc._id }, { $set: { attachStatus: 'attached', laravelMediaId: String(r.media_id) } });
      } catch (err) {
        logger.warn({ err: err.message, jobId: doc._id }, 'attach to product failed; merchant can retry without charge');
        await MediaJob.updateOne({ _id: doc._id }, { $set: { attachStatus: 'failed' } });
      }
    }
    const final = await MediaJob.findById(doc._id).lean();
    await conversations.appendSystemEvent({
      conversationId: final.conversationId, merchantId: final.merchantId,
      content: `Your ${final.kind} is ready (job ${final._id}, asset ${assetId}).${final.attachStatus === 'attached' ? ' It was added to the product.' : ''}${final.attachStatus === 'failed' ? ' It could not be added to the product automatically.' : ''}`,
      ui: { type: 'job', job: jobsService.publicJob(final) },
    }).catch(() => {});
    return { ok: true, assetId };
  } catch (err) {
    const code = err instanceof MediaError ? err.code : (controller.signal.aborted ? 'PROVIDER_TIMEOUT' : 'PROVIDER_ERROR');
    const retryable = err instanceof MediaError ? err.retryable : true;
    logger.warn({ jobId, code, attempt: bullJob.attemptsMade + 1, err: err.message }, 'media job attempt failed');
    if (retryable && !isLastAttempt) {
      await MediaJob.updateOne({ _id: jobId, status: 'running' }, { $set: { status: 'queued' } });
      throw err; // BullMQ retries with backoff
    }
    await finalFailure(doc, code);
    return { ok: false, code };
  } finally {
    clearTimeout(timer);
  }
}

module.exports = { processMediaJob, finalFailure };
