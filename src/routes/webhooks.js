'use strict';
const express = require('express');
const billing = require('../domain/billing/service');
const { logger } = require('../lib/logger');

/** Mounted BEFORE express.json(): signature verification needs the raw bytes. */
const router = express.Router();

router.post('/razorpay', express.raw({ type: () => true, limit: '1mb' }), async (req, res) => {
  const result = await billing.handleWebhook({
    rawBody: req.body, signature: req.get('x-razorpay-signature'), eventIdHeader: req.get('x-razorpay-event-id'),
  });
  logger.info({ result }, 'razorpay webhook handled');
  res.json({ ok: true });
});

module.exports = router;
