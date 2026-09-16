'use strict';
const crypto = require('node:crypto');
const { env } = require('../../config/env');
const { AppError } = require('../../lib/errors');

function timingSafeEqualHex(a, b) {
  const ab = Buffer.from(String(a || ''), 'utf8');
  const bb = Buffer.from(String(b || ''), 'utf8');
  return ab.length === bb.length && crypto.timingSafeEqual(ab, bb);
}

/** Webhook: HMAC-SHA256 of the RAW body bytes with the webhook secret. */
function verifyWebhookSignature(rawBody, signature, secret) {
  if (!Buffer.isBuffer(rawBody) || !signature || !secret) return false;
  const expected = crypto.createHmac('sha256', secret).update(rawBody).digest('hex');
  return timingSafeEqualHex(expected, signature);
}

/** Checkout: HMAC-SHA256 of "order_id|payment_id" with the key secret. */
function verifyCheckoutSignature({ orderId, paymentId, signature }, keySecret) {
  if (!orderId || !paymentId || !signature || !keySecret) return false;
  const expected = crypto.createHmac('sha256', keySecret).update(`${orderId}|${paymentId}`).digest('hex');
  return timingSafeEqualHex(expected, signature);
}

let rzp;
function razorpay() {
  const e = env();
  if (!e.RAZORPAY_KEY_ID || !e.RAZORPAY_KEY_SECRET) throw new AppError('BILLING_NOT_CONFIGURED', 503, 'Payments are not configured');
  if (!rzp) {
    const Razorpay = require('razorpay');
    rzp = new Razorpay({ key_id: e.RAZORPAY_KEY_ID, key_secret: e.RAZORPAY_KEY_SECRET });
  }
  return rzp;
}

module.exports = { razorpay, verifyWebhookSignature, verifyCheckoutSignature };
