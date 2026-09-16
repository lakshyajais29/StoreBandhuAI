'use strict';
/**
 * End-to-end through HTTP: app + in-process mock Laravel + scripted LLM + real Mongo/Redis.
 */
const http = require('node:http');
require('../helpers/env');
const test = require('node:test');
const assert = require('node:assert/strict');
const crypto = require('node:crypto');
const request = require('supertest');
const { SignJWT } = require('jose');
const { connectOrSkip, SKIP_REASON, mongoose } = require('../helpers/mongo');

let ok; let app; let laravelServer; let token; let setProviderForTests; let createScriptedProvider; let wallet; let Payment; let closeRedis;

test.before(async () => {
  ok = await connectOrSkip();
  if (!ok) return;
  const mock = require('../../mock-laravel/server');
  laravelServer = http.createServer(mock.app);
  await new Promise((r) => laravelServer.listen(0, r));
  process.env.LARAVEL_API_BASE_URL = `http://127.0.0.1:${laravelServer.address().port}`;
  process.env.LARAVEL_AGENT_SERVICE_TOKEN = 'dev-service-token';
  process.env.LARAVEL_TIMEOUT_MS = '3000';
  ({ setProviderForTests } = require('../../src/llm/provider'));
  ({ createScriptedProvider } = require('../../src/llm/providers/fake'));
  wallet = require('../../src/domain/wallet/service');
  ({ Payment } = require('../../src/models/billing'));
  ({ closeRedis } = require('../../src/lib/redis'));
  await require('../../src/lib/redis').getRedis().flushdb();
  app = require('../../src/app').createApp();
  token = await new SignJWT({ mid: 'm_flow' }).setProtectedHeader({ alg: 'HS256' }).setSubject('u_flow').setIssuer('storebandhu-laravel')
    .setAudience('bandhu-agent').setIssuedAt().setExpirationTime('10m').sign(new TextEncoder().encode(process.env.SESSION_JWT_SECRET));
  await wallet.ensureWallet('m_flow');
  await wallet.setPlan({ merchantId: 'm_flow', planCode: 'growth', renewsAt: new Date(Date.now() + 86400000) });
  await wallet.credit({ merchantId: 'm_flow', tokens: 100, source: 'topup', type: 'purchase', actionRef: 'seed:m_flow' });
});
test.after(async () => {
  if (laravelServer) laravelServer.close();
  if (closeRedis) await closeRedis();
  await mongoose.disconnect();
});

const auth = (r) => r.set('Authorization', `Bearer ${token}`);
const tc = (name, args) => ({ toolCalls: [{ id: `c_${crypto.randomUUID().slice(0, 8)}`, name, arguments: JSON.stringify(args) }] });

test('read flow: chat charges one token and answers from tool data', async (t) => {
  if (!ok) return t.skip(SKIP_REASON);
  setProviderForTests(createScriptedProvider([tc('search_products', { query: 'blue shirt' }), { content: 'You have 42.' }]));
  const before = (await wallet.getBalance('m_flow')).available;
  const r = await auth(request(app).post('/api/chat')).send({ message: 'blue shirt stock?' });
  assert.equal(r.status, 200, JSON.stringify(r.body));
  assert.equal(r.body.messages.at(-1).content, 'You have 42.');
  assert.equal(r.body.wallet.available, before - 1);
  const hist = await auth(request(app).get(`/api/conversations/${r.body.conversationId}`));
  assert.ok(hist.body.messages.every((m) => m.role !== 'tool'));
});

test('listing flow: preview → double confirm → one product, 3 tokens', async (t) => {
  if (!ok) return t.skip(SKIP_REASON);
  setProviderForTests(createScriptedProvider([
    tc('create_product_listing', { title: 'Green Kurta', price_rupees: 799, category: 'Apparel' }),
    { content: 'Please review and press Confirm.' },
  ]));
  const chat = await auth(request(app).post('/api/chat')).send({ message: 'list green kurta 799' });
  const card = chat.body.messages.at(-1).ui.find((u) => u.type === 'pending_action');
  assert.ok(card, JSON.stringify(chat.body));
  const before = (await wallet.getBalance('m_flow')).available;
  const [a, b] = await Promise.all([
    auth(request(app).post(`/api/actions/${card.action.id}/confirm`)),
    auth(request(app).post(`/api/actions/${card.action.id}/confirm`)),
  ]);
  const statuses = [a.status, b.status].sort();
  assert.deepEqual(statuses, [200, 409]);
  const winner = a.status === 200 ? a : b;
  assert.equal(winner.body.action.status, 'succeeded');
  assert.equal(winner.body.wallet.available, before, 'tokens were reserved at preview time');
  assert.equal(winner.body.wallet.reserved, 0);
  const again = await auth(request(app).post(`/api/actions/${card.action.id}/cancel`));
  assert.equal(again.status, 409);
});

test('another merchant cannot confirm my action', async (t) => {
  if (!ok) return t.skip(SKIP_REASON);
  setProviderForTests(createScriptedProvider([tc('update_inventory', { product_id: '104', mode: 'set', quantity: 0 }), { content: 'Confirm?' }]));
  const chat = await auth(request(app).post('/api/chat')).send({ message: 'diya stock zero' });
  const card = chat.body.messages.at(-1).ui.find((u) => u.type === 'pending_action');
  const other = await new SignJWT({ mid: 'm_other' }).setProtectedHeader({ alg: 'HS256' }).setSubject('x').setIssuer('storebandhu-laravel').setAudience('bandhu-agent').setExpirationTime('5m').sign(new TextEncoder().encode(process.env.SESSION_JWT_SECRET));
  const r = await request(app).post(`/api/actions/${card.action.id}/confirm`).set('Authorization', `Bearer ${other}`);
  assert.equal(r.status, 404);
  const cancel = await auth(request(app).post(`/api/actions/${card.action.id}/cancel`));
  assert.equal(cancel.body.action.status, 'cancelled');
  assert.equal(cancel.body.wallet.reserved, 0);
});

test('webhook: same event twice credits once', async (t) => {
  if (!ok) return t.skip(SKIP_REASON);
  await Payment.create({ _id: 'pay_test1', merchantId: 'm_flow', kind: 'topup', itemCode: 'pack_100', tokens: 100, amountPaise: 7900, razorpayOrderId: 'order_T1' });
  const before = (await wallet.getBalance('m_flow')).available;
  const body = JSON.stringify({ event: 'payment.captured', created_at: 1, payload: { payment: { entity: { id: 'pay_rzp1', order_id: 'order_T1', amount: 7900 } } } });
  const sig = crypto.createHmac('sha256', process.env.RAZORPAY_WEBHOOK_SECRET).update(body).digest('hex');
  const send = () => request(app).post('/webhooks/razorpay').set('content-type', 'application/json').set('x-razorpay-signature', sig).set('x-razorpay-event-id', 'evt_1').send(body);
  const [r1, r2] = await Promise.all([send(), send()]);
  assert.ok([r1.status, r2.status].every((s) => s === 200), `${r1.status} ${r2.status}`);
  const r3 = await request(app).post('/webhooks/razorpay').set('content-type', 'application/json').set('x-razorpay-signature', sig).set('x-razorpay-event-id', 'evt_2').send(body);
  assert.equal(r3.status, 200);
  assert.equal((await wallet.getBalance('m_flow')).available, before + 100);
  assert.equal((await wallet.reconcile('m_flow')).mismatches.length, 0);
});
