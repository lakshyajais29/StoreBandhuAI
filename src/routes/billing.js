'use strict';
const { Router } = require('express');
const billing = require('../domain/billing/service');
const { E } = require('../lib/errors');

const router = Router();

router.get('/billing/plans', (_req, res) => res.json(billing.catalogue()));

router.post('/billing/checkout', async (req, res) => {
  const { kind, code } = req.body || {};
  if (!['plan', 'topup'].includes(kind) || typeof code !== 'string') throw E.validation([{ field: 'kind/code', problem: 'kind must be plan|topup with a code' }]);
  res.status(201).json(await billing.createCheckout(req.auth, { kind, code }));
});

router.post('/billing/verify', async (req, res) => {
  const b = req.body || {};
  res.json(await billing.verifyCheckout(req.auth, {
    razorpayOrderId: b.razorpay_order_id, razorpayPaymentId: b.razorpay_payment_id, razorpaySignature: b.razorpay_signature,
  }));
});

router.get('/billing/payments', async (req, res) => {
  const rows = await billing.listPayments(req.auth.merchantId);
  res.json({ data: rows.map((p) => ({ id: p._id, kind: p.kind, code: p.itemCode, tokens: p.tokens, amountPaise: p.amountPaise, status: p.status, paidAt: p.paidAt, createdAt: p.createdAt })) });
});

module.exports = router;
