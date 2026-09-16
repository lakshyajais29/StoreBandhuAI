'use strict';
require('../helpers/env');
const test = require('node:test');
const assert = require('node:assert/strict');
const { canonicalJSON, hashArgs } = require('../../src/lib/canonical');
const { createVault, redactForLog } = require('../../src/lib/pii');
const { toolResultForLLM, cleanUserText } = require('../../src/agent/sanitize');
const { sniffMime } = require('../../src/routes/uploads');
const { verifyWebhookSignature, verifyCheckoutSignature } = require('../../src/integrations/razorpay/client');
const crypto = require('node:crypto');

test('canonical JSON is key-order independent', () => {
  assert.equal(canonicalJSON({ b: 1, a: { d: [1, { z: 1, y: 2 }], c: null } }), canonicalJSON({ a: { c: null, d: [1, { y: 2, z: 1 }] }, b: 1 }));
  assert.notEqual(hashArgs({ qty: 1 }), hashArgs({ qty: 2 }));
});

test('PII vault masks phones/emails deterministically and unmasks', () => {
  const v1 = createVault('secret-abcdefghijklmnop');
  const masked = v1.mask({ note: 'Call Priya on +91 98765 43210 or priya@example.com', qty: 500, price: 'Rs 129900' });
  assert.doesNotMatch(JSON.stringify(masked), /98765|priya@/);
  assert.match(masked.note, /<phone_[0-9a-f]{10}>/);
  assert.equal(masked.qty, 500);
  assert.equal(masked.price, 'Rs 129900', 'numbers that are not phones stay');
  assert.equal(v1.unmask(masked).note, 'Call Priya on +91 98765 43210 or priya@example.com');
  const v2 = createVault('secret-abcdefghijklmnop');
  assert.equal(v2.mask('9876543210'), v1.mask('9876543210'), 'stable across requests');
  assert.doesNotMatch(JSON.stringify(redactForLog({ phone: '9123456780' })), /9123456780/);
});

test('tool results are wrapped and truncated', () => {
  const out = toolResultForLLM({ text: 'x'.repeat(10000) }, 100);
  assert.match(out, /^<tool_data>/);
  assert.match(out, /truncated/);
  assert.ok(out.length < 200);
  assert.equal(cleanUserText('  hi\u0007 there  '), 'hi there');
});

test('upload magic-byte sniffing', () => {
  assert.equal(sniffMime(Buffer.from([0xff, 0xd8, 0xff, 0xe0])), 'image/jpeg');
  assert.equal(sniffMime(Buffer.from('89504e470d0a1a0a0000', 'hex')), 'image/png');
  assert.equal(sniffMime(Buffer.from('RIFF1234WEBPVP8 ')), 'image/webp');
  assert.equal(sniffMime(Buffer.from('MZ\x90\x00 exe')), null);
});

test('razorpay signatures', () => {
  const body = Buffer.from('{"event":"payment.captured" }');
  const sig = crypto.createHmac('sha256', 'whsec').update(body).digest('hex');
  assert.equal(verifyWebhookSignature(body, sig, 'whsec'), true);
  assert.equal(verifyWebhookSignature(Buffer.from('{"event":"payment.captured"}'), sig, 'whsec'), false, 're-serialised body must fail');
  assert.equal(verifyWebhookSignature(body, sig, undefined), false);
  const cs = crypto.createHmac('sha256', 'key').update('order_1|pay_1').digest('hex');
  assert.equal(verifyCheckoutSignature({ orderId: 'order_1', paymentId: 'pay_1', signature: cs }, 'key'), true);
  assert.equal(verifyCheckoutSignature({ orderId: 'order_1', paymentId: 'pay_2', signature: cs }, 'key'), false);
});
