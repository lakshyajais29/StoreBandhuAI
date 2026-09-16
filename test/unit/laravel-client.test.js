'use strict';
require('../helpers/env');
const test = require('node:test');
const assert = require('node:assert/strict');
const nock = require('nock');
const { createLaravelClient, isAmbiguousUpstreamError } = require('../../src/integrations/laravel/client');

const BASE = 'http://laravel.unit';
const client = createLaravelClient({ baseURL: BASE, serviceToken: 'svc', timeout: 200 }).forMerchant({ merchantId: 'm_1', userId: 'u_1', requestId: 'req-1' });

test.afterEach(() => nock.cleanAll());

test('sends service auth and merchant headers', async () => {
  nock(BASE, { reqheaders: { authorization: 'Bearer svc', 'x-merchant-id': 'm_1', 'x-request-id': 'req-1' } })
    .get('/api/v1/agent/inventory/101').reply(200, { stock: 3 });
  assert.deepEqual(await client.getInventory('101'), { stock: 3 });
});

test('GETs retry on 5xx', async () => {
  nock(BASE).get('/api/v1/agent/inventory/1').reply(502).get('/api/v1/agent/inventory/1').reply(200, { stock: 1 });
  assert.deepEqual(await client.getInventory('1'), { stock: 1 });
});

test('writes are never retried and require an idempotency key', async () => {
  await assert.rejects(client.createListing({ title: 'x' }, {}), { code: 'MISSING_IDEMPOTENCY_KEY' });
  const scope = nock(BASE, { reqheaders: { 'idempotency-key': 'pa_1' } }).post('/api/v1/agent/listings').reply(500);
  const err = await client.createListing({ title: 'x' }, { idempotencyKey: 'pa_1' }).catch((e) => e);
  assert.equal(err.code, 'UPSTREAM_ERROR');
  assert.equal(isAmbiguousUpstreamError(err), true);
  assert.ok(scope.isDone());
  assert.equal(nock.pendingMocks().length, 0);
});

test('timeouts map to UPSTREAM_TIMEOUT (ambiguous)', async () => {
  nock(BASE).post('/api/v1/agent/orders').delay(1000).reply(201, {});
  const err = await client.createOrder({ quote_id: 'q' }, { idempotencyKey: 'pa_2' }).catch((e) => e);
  assert.equal(err.code, 'UPSTREAM_TIMEOUT');
  assert.equal(isAmbiguousUpstreamError(err), true);
});

test('4xx map to definite business errors', async () => {
  nock(BASE).post('/api/v1/agent/orders').reply(409, { error: { code: 'QUOTE_EXPIRED', message: 'Quote expired' } });
  const err = await client.createOrder({ quote_id: 'q' }, { idempotencyKey: 'pa_3' }).catch((e) => e);
  assert.equal(err.code, 'QUOTE_EXPIRED');
  assert.equal(err.status, 409);
  assert.equal(isAmbiguousUpstreamError(err), false);
  nock(BASE).get('/api/v1/agent/context').reply(401, {});
  await assert.rejects(client.context(), { code: 'UPSTREAM_AUTH' });
});
