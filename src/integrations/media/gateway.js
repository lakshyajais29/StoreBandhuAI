'use strict';
/**
 * Media generation gateway (ADR-010). One contract, swappable providers:
 *   run({ kind, modelId, imageUrl, prompt, params, signal }) → { url, mime, costUsd? }
 *   classifyPerson({ imageUrl }) → true | false | null (unknown)
 * Errors: MediaError with code NSFW_REJECTED | INVALID_INPUT | PROVIDER_TIMEOUT | PROVIDER_ERROR, `retryable` flag.
 *
 * ⚠️ fal.ai model IDs, input field names and output shapes differ per model and change over time.
 * Verify each model page on fal.ai and adjust `buildInput`/`extractOutput` before going live.
 */
const axios = require('axios');
const { env } = require('../../config/env');

class MediaError extends Error {
  constructor(code, message, retryable) {
    super(message);
    this.code = code;
    this.retryable = retryable;
  }
}

const sleep = (ms, signal) => new Promise((resolve, reject) => {
  const t = setTimeout(resolve, ms);
  signal?.addEventListener('abort', () => { clearTimeout(t); reject(new MediaError('PROVIDER_TIMEOUT', 'aborted', true)); }, { once: true });
});

const STYLE_PROMPTS = {
  white_background: 'Place the product on a clean pure white studio background with soft natural shadow. Keep the product exactly as it is.',
  studio: 'Professional e-commerce studio shot, soft box lighting, neutral backdrop. Keep the product unchanged.',
  lifestyle: 'Realistic lifestyle scene that suits the product, natural light, Indian home setting. Keep the product unchanged.',
  festive: 'Festive Indian setting with diyas and marigold decor, warm light. Keep the product unchanged.',
  showcase: 'Slow smooth 360-degree product showcase, stable camera.',
  cinematic: 'Cinematic slow dolly-in with soft depth of field, product stays sharp.',
};

function mockGateway() {
  const { storage } = require('../storage');
  return {
    name: 'mock',
    async run({ kind, imageUrl, signal, sourceKey }) {
      await sleep(kind === 'video' ? 3000 : 1200, signal);
      if (Math.random() < env().MOCK_MEDIA_FAIL_RATE) throw new MediaError('PROVIDER_ERROR', 'mock failure', false);
      // Development only: echo the source file back so the whole pipeline is testable without spend.
      const buffer = await storage().readBuffer(sourceKey);
      return { buffer, mime: 'image/jpeg', costUsd: 0, mock: true, sourceUrl: imageUrl };
    },
    async classifyPerson() { return null; },
  };
}

function falGateway() {
  const e = env();
  const http = axios.create({ headers: { Authorization: `Key ${e.FAL_KEY}` }, timeout: 30000, validateStatus: () => true });

  const buildInput = ({ kind, imageUrl, style, params }) => (kind === 'image'
    ? { image_url: imageUrl, prompt: STYLE_PROMPTS[style] || STYLE_PROMPTS.studio, ...params }
    : { image_url: imageUrl, prompt: STYLE_PROMPTS[style] || STYLE_PROMPTS.showcase, duration: String(params?.duration || 5) });

  const extractOutput = (kind, data) => {
    if (kind === 'image') {
      const img = data?.images?.[0] || data?.image;
      if (!img?.url) throw new MediaError('PROVIDER_ERROR', 'no image in response', false);
      return { url: img.url, mime: img.content_type || 'image/png' };
    }
    const vid = data?.video;
    if (!vid?.url) throw new MediaError('PROVIDER_ERROR', 'no video in response', false);
    return { url: vid.url, mime: vid.content_type || 'video/mp4' };
  };

  return {
    name: 'fal',
    async run({ kind, modelId, imageUrl, style, params, signal }) {
      const submit = await http.post(`https://queue.fal.run/${modelId}`, buildInput({ kind, imageUrl, style, params }), { signal });
      if (submit.status === 422) throw new MediaError('INVALID_INPUT', 'provider rejected input', false);
      if (submit.status >= 400) throw new MediaError('PROVIDER_ERROR', `submit failed ${submit.status}`, submit.status >= 500 || submit.status === 429);
      const { status_url: statusUrl, response_url: responseUrl } = submit.data;
      const deadline = Date.now() + e.MEDIA_JOB_TIMEOUT_MS;
      for (;;) {
        if (Date.now() > deadline) throw new MediaError('PROVIDER_TIMEOUT', 'generation timed out', true);
        await sleep(kind === 'video' ? 5000 : 2000, signal);
        const st = await http.get(statusUrl, { signal });
        if (st.status >= 500) continue;
        if (st.data?.status === 'COMPLETED') break;
        if (st.data?.status === 'FAILED' || st.data?.error) throw new MediaError('PROVIDER_ERROR', 'generation failed', false);
      }
      const out = await http.get(responseUrl, { signal });
      if (out.status >= 400) {
        const detail = JSON.stringify(out.data || {});
        if (/nsfw|safety|content policy/i.test(detail)) throw new MediaError('NSFW_REJECTED', 'content rejected', false);
        throw new MediaError('PROVIDER_ERROR', `result fetch failed ${out.status}`, out.status >= 500);
      }
      return extractOutput(kind, out.data);
    },
    async classifyPerson() {
      // TODO(P4-04): wire a cheap vision classifier model; until then "unknown" routes per VIDEO_UNKNOWN_PERSON_ROUTE.
      return null;
    },
  };
}

let gw;
function gateway() {
  if (!gw) gw = env().MEDIA_GATEWAY === 'fal' ? falGateway() : mockGateway();
  return gw;
}

module.exports = { gateway, MediaError, STYLE_PROMPTS };
