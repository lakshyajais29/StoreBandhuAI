'use strict';
require('../helpers/env');
const test = require('node:test');
const assert = require('node:assert/strict');
const { createRedis } = require('../../src/lib/redis');
const limits = require('../../src/domain/jobs/limits');

let redis;
let available = true;
test.before(async () => {
  redis = createRedis(process.env.REDIS_URL, { lazyConnect: true, maxRetriesPerRequest: 1, retryStrategy: () => null });
  try { await redis.connect(); await redis.flushdb(); } catch { available = false; }
});
test.after(async () => { if (redis) redis.disconnect(); });

test('concurrency and daily limits are atomic under parallel acquire', async (t) => {
  if (!available) return t.skip('Redis not available');
  const lim = { concurrent: 3, perDay: 10 };
  const results = await Promise.all(Array.from({ length: 20 }, (_, i) => limits.acquire({ merchantId: 'm1', kind: 'video', jobId: `j${i}`, limits: lim, staleMs: 60000, redis })));
  assert.equal(results.filter((r) => r.ok).length, 3);
  assert.ok(results.filter((r) => !r.ok).every((r) => r.reason === 'concurrent'));
});

test('daily window counts finished jobs; failures give the slot back', async (t) => {
  if (!available) return t.skip('Redis not available');
  const lim = { concurrent: 5, perDay: 2 };
  const a = { merchantId: 'm2', kind: 'image', limits: lim, staleMs: 60000, redis };
  assert.equal((await limits.acquire({ ...a, jobId: 'x1' })).ok, true);
  await limits.releaseConcurrent({ merchantId: 'm2', kind: 'image', jobId: 'x1', redis });
  assert.equal((await limits.acquire({ ...a, jobId: 'x2' })).ok, true);
  await limits.releaseAll({ merchantId: 'm2', kind: 'image', jobId: 'x2', redis });
  assert.equal((await limits.acquire({ ...a, jobId: 'x3' })).ok, true, 'failed job x2 freed its daily slot');
  const denied = await limits.acquire({ ...a, jobId: 'x4' });
  assert.equal(denied.ok, false);
  assert.equal(denied.reason, 'daily');
  assert.ok(denied.retryAt instanceof Date);
});

test('zero limits deny (plan without video)', async (t) => {
  if (!available) return t.skip('Redis not available');
  const r = await limits.acquire({ merchantId: 'm3', kind: 'video', jobId: 'v', limits: { concurrent: 0, perDay: 0 }, staleMs: 1, redis });
  assert.equal(r.ok, false);
});
