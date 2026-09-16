'use strict';
require('../helpers/env');
const test = require('node:test');
const assert = require('node:assert/strict');
const { connectOrSkip, SKIP_REASON, mongoose } = require('../helpers/mongo');
const wallet = require('../../src/domain/wallet/service');
const { Ledger } = require('../../src/models/wallet');

let ok;
test.before(async () => { ok = await connectOrSkip(); });
test.after(() => mongoose.disconnect());

test('P2-03: 50 parallel reservations of 10 on a 100-token wallet → exactly 10 succeed', async (t) => {
  if (!ok) return t.skip(SKIP_REASON);
  await wallet.credit({ merchantId: 'mc', tokens: 100, source: 'topup', type: 'purchase', actionRef: 'rzp:c1' });
  const results = await Promise.allSettled(Array.from({ length: 50 }, (_, i) => wallet.reserve({ merchantId: 'mc', tokens: 10, purpose: 'sync_write', actionType: 'x', refId: `r${i}` })));
  assert.equal(results.filter((r) => r.status === 'fulfilled').length, 10);
  assert.ok(results.filter((r) => r.status === 'rejected').every((r) => r.reason.code === 'INSUFFICIENT_TOKENS'));
  const b = await wallet.getBalance('mc');
  assert.equal(b.available, 0);
  assert.equal(b.reserved, 100);
  assert.equal((await wallet.reconcile('mc')).mismatches.length, 0);
});

test('commit and release are idempotent and keep the ledger reconciled', async (t) => {
  if (!ok) return t.skip(SKIP_REASON);
  await wallet.credit({ merchantId: 'mi', tokens: 20, source: 'topup', type: 'purchase', actionRef: 'rzp:i1' });
  const a = await wallet.reserve({ merchantId: 'mi', tokens: 6, purpose: 'media_job', actionType: 'generate_product_image', refId: 'j1' });
  const b = await wallet.reserve({ merchantId: 'mi', tokens: 3, purpose: 'sync_write', actionType: 'update_inventory', refId: 'p1' });
  const commits = await Promise.all([wallet.commit(a._id), wallet.commit(a._id), wallet.release(a._id)]);
  assert.equal(commits.filter((c) => c.settled).length, 1);
  await wallet.release(b._id);
  await wallet.release(b._id);
  const bal = await wallet.getBalance('mi');
  assert.equal(bal.available, 14);
  assert.equal(bal.reserved, 0);
  assert.equal((await wallet.reconcile('mi')).mismatches.length, 0);
});

test('duplicate credit with the same actionRef is rejected', async (t) => {
  if (!ok) return t.skip(SKIP_REASON);
  await wallet.credit({ merchantId: 'md', tokens: 50, source: 'topup', type: 'purchase', actionRef: 'rzp:dup' });
  await assert.rejects(wallet.credit({ merchantId: 'md', tokens: 50, source: 'topup', type: 'purchase', actionRef: 'rzp:dup' }), (e) => wallet.isDuplicateKey(e));
  assert.equal((await wallet.getBalance('md')).available, 50);
});

test('trial tokens cannot pay for video', async (t) => {
  if (!ok) return t.skip(SKIP_REASON);
  await wallet.credit({ merchantId: 'mt', tokens: 50, bucket: 'trial', source: 'trial', type: 'grant', actionRef: 'trial:mt' });
  await assert.rejects(wallet.reserve({ merchantId: 'mt', tokens: 25, purpose: 'media_job', actionType: 'generate_product_video', refId: 'v', allowTrial: false }), { code: 'INSUFFICIENT_TOKENS' });
  assert.ok(await wallet.reserve({ merchantId: 'mt', tokens: 25, purpose: 'media_job', actionType: 'generate_product_image', refId: 'i' }));
});

test('ledger is append-only', async (t) => {
  if (!ok) return t.skip(SKIP_REASON);
  await assert.rejects(Ledger.updateOne({}, { $set: { tokens: 1e6 } }), /append-only/);
  await assert.rejects(Ledger.deleteMany({}), /append-only/);
});

test('expired lots reduce balance', async (t) => {
  if (!ok) return t.skip(SKIP_REASON);
  await wallet.credit({ merchantId: 'me', tokens: 30, source: 'plan', type: 'purchase', actionRef: 'rzp:e1', expiresAt: new Date(Date.now() - 1000) });
  await wallet.credit({ merchantId: 'me', tokens: 10, source: 'topup', type: 'purchase', actionRef: 'rzp:e2' });
  await wallet.expireLots();
  assert.equal((await wallet.getBalance('me')).available, 10);
  assert.equal((await wallet.reconcile('me')).mismatches.length, 0);
});
