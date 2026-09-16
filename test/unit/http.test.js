'use strict';
require('../helpers/env');
const test = require('node:test');
const assert = require('node:assert/strict');
const crypto = require('node:crypto');
const request = require('supertest');
const { SignJWT } = require('jose');
const { createApp } = require('../../src/app');
const { closeRedis } = require('../../src/lib/redis');

const app = createApp();
const secret = new TextEncoder().encode(process.env.SESSION_JWT_SECRET);
const sign = (claims, { iss = 'storebandhu-laravel', aud = 'bandhu-agent', exp = '5m', key = secret } = {}) =>
  new SignJWT(claims).setProtectedHeader({ alg: 'HS256' }).setSubject('u_1').setIssuer(iss).setAudience(aud).setIssuedAt().setExpirationTime(exp).sign(key);

test.after(() => closeRedis());

test('health is public', async () => {
  const r = await request(app).get('/health');
  assert.equal(r.status, 200);
  assert.ok(r.headers['x-request-id']);
});

test('API requires a valid merchant session', async () => {
  assert.equal((await request(app).get('/api/wallet')).status, 401);
  assert.equal((await request(app).get('/api/wallet').set('Authorization', 'Bearer nope')).status, 401);
  const wrongAud = await sign({ mid: 'm_1' }, { aud: 'other' });
  assert.equal((await request(app).get('/api/wallet').set('Authorization', `Bearer ${wrongAud}`)).status, 401);
  const wrongKey = await sign({ mid: 'm_1' }, { key: new TextEncoder().encode('x'.repeat(40)) });
  assert.equal((await request(app).get('/api/wallet').set('Authorization', `Bearer ${wrongKey}`)).status, 401);
  const noMid = await sign({});
  const r = await request(app).get('/api/wallet').set('Authorization', `Bearer ${noMid}`);
  assert.equal(r.status, 401);
  assert.equal(r.body.error.code, 'UNAUTHENTICATED');
});

test('no route exposes wallet by merchant id in the URL', async () => {
  const token = await sign({ mid: 'm_1' });
  const r = await request(app).get('/api/wallet/m_2').set('Authorization', `Bearer ${token}`);
  assert.equal(r.status, 404);
});

test('admin API needs secret and actor', async () => {
  assert.equal((await request(app).get('/admin/merchants/m_1/wallet')).status, 403);
  assert.equal((await request(app).get('/admin/merchants/m_1/wallet').set('x-admin-secret', 'admin-secret-for-tests-123')).status, 403);
});

test('webhook rejects bad signatures before touching the database', async () => {
  const body = JSON.stringify({ event: 'payment.captured' });
  const r = await request(app).post('/webhooks/razorpay').set('content-type', 'application/json').set('x-razorpay-signature', 'bad').send(body);
  assert.equal(r.status, 400);
  assert.equal(r.body.error.code, 'INVALID_SIGNATURE');
});

test('webhook signature is computed over raw bytes (json parser not applied)', async () => {
  // Valid signature passes verification; it then fails later only because Mongo is not connected in unit tests.
  const body = '{"event":"noop",  "created_at": 1}';
  const sig = crypto.createHmac('sha256', 'whsec_test_123').update(body).digest('hex');
  const r = await request(app).post('/webhooks/razorpay').set('content-type', 'application/json').set('x-razorpay-signature', sig).send(body);
  assert.notEqual(r.body?.error?.code, 'INVALID_SIGNATURE');
});

test('malformed JSON and unknown routes use the error envelope', async () => {
  const token = await sign({ mid: 'm_1' });
  const r = await request(app).post('/api/chat').set('Authorization', `Bearer ${token}`).set('content-type', 'application/json').send('{bad');
  assert.equal(r.status, 400);
  assert.equal(r.body.error.code, 'INVALID_JSON');
  const nf = await request(app).get('/nope');
  assert.equal(nf.body.error.code, 'NOT_FOUND');
});
