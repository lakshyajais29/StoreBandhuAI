'use strict';
/**
 * Per-merchant media limits enforced in Redis, independent of token balance (P4-03).
 * Concurrency: sorted set of running job ids (score = start ms; stale entries auto-expire).
 * Rolling window: sorted set of job ids scored by start ms, trimmed to 24h.
 * Acquire is one atomic Lua script, so parallel requests cannot overshoot.
 */
const { getRedis } = require('../../lib/redis');

const DAY_MS = 24 * 60 * 60 * 1000;

const ACQUIRE = `
local active = KEYS[1]
local day = KEYS[2]
local now = tonumber(ARGV[1])
local maxConc = tonumber(ARGV[2])
local maxDay = tonumber(ARGV[3])
local staleMs = tonumber(ARGV[4])
local id = ARGV[5]
redis.call('ZREMRANGEBYSCORE', active, '-inf', now - staleMs)
redis.call('ZREMRANGEBYSCORE', day, '-inf', now - ${DAY_MS})
if redis.call('ZSCORE', active, id) then return 1 end
if redis.call('ZCARD', active) >= maxConc then return -1 end
if redis.call('ZCARD', day) >= maxDay then
  local oldest = redis.call('ZRANGE', day, 0, 0, 'WITHSCORES')
  return -2 - tonumber(oldest[2] or now)
end
redis.call('ZADD', active, now, id)
redis.call('ZADD', day, now, id)
redis.call('PEXPIRE', active, staleMs + 60000)
redis.call('PEXPIRE', day, ${DAY_MS} + 60000)
return 1
`;

const keys = (merchantId, kind) => [`lim:${merchantId}:${kind}:active`, `lim:${merchantId}:${kind}:day`];

function planLimits(plan, kind) {
  return kind === 'video'
    ? { concurrent: plan.limits.videoConcurrent, perDay: plan.limits.videoPerDay }
    : { concurrent: plan.limits.imageConcurrent, perDay: plan.limits.imagePerDay };
}

/** @returns {{ok:true}|{ok:false, reason:'concurrent'|'daily', retryAt?:Date}} */
async function acquire({ merchantId, kind, jobId, limits, staleMs, redis = getRedis(), now = Date.now() }) {
  if (limits.concurrent <= 0 || limits.perDay <= 0) return { ok: false, reason: 'daily' };
  const r = await redis.eval(ACQUIRE, 2, ...keys(merchantId, kind), now, limits.concurrent, limits.perDay, staleMs, jobId);
  if (r === 1) return { ok: true };
  if (r === -1) return { ok: false, reason: 'concurrent' };
  const oldest = -(r + 2);
  return { ok: false, reason: 'daily', retryAt: new Date(oldest + DAY_MS) };
}

/** Job finished (success or failure): frees a concurrency slot. */
async function releaseConcurrent({ merchantId, kind, jobId, redis = getRedis() }) {
  await redis.zrem(keys(merchantId, kind)[0], jobId);
}

/** Job failed or was never started: also give back the daily slot. */
async function releaseAll({ merchantId, kind, jobId, redis = getRedis() }) {
  const [a, d] = keys(merchantId, kind);
  await redis.multi().zrem(a, jobId).zrem(d, jobId).exec();
}

module.exports = { acquire, releaseConcurrent, releaseAll, planLimits };
