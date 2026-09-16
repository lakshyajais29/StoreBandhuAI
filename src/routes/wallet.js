'use strict';
const { Router } = require('express');
const wallet = require('../domain/wallet/service');
const billing = require('../domain/billing/service');
const { Ledger } = require('../models/wallet');
const { E } = require('../lib/errors');

const router = Router();

router.get('/wallet', async (req, res) => res.json(await wallet.getBalance(req.auth.merchantId)));

router.get('/wallet/ledger', async (req, res) => {
  const limit = Math.min(Number(req.query.limit) || 50, 100);
  const q = { merchantId: req.auth.merchantId, type: { $ne: 'commit' } };
  if (req.query.cursor) {
    const d = new Date(String(req.query.cursor));
    if (Number.isNaN(d.getTime())) throw E.validation([{ field: 'cursor', problem: 'invalid' }]);
    q.createdAt = { $lt: d };
  }
  const rows = await Ledger.find(q).sort({ createdAt: -1 }).limit(limit + 1).lean();
  const page = rows.slice(0, limit);
  res.json({
    data: page.map((r) => ({ id: String(r._id), type: r.type, tokens: r.tokens, availableAfter: r.availableAfter, action: r.actionType, reason: r.reason, createdAt: r.createdAt })),
    nextCursor: rows.length > limit ? page[page.length - 1].createdAt.toISOString() : null,
  });
});

router.get('/wallet/usage', async (req, res) => {
  res.json(await billing.usage(req.auth.merchantId, { from: req.query.from, to: req.query.to }));
});

module.exports = router;
