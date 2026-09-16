'use strict';
const { Router } = require('express');
const actions = require('../domain/actions/service');
const wallet = require('../domain/wallet/service');

const router = Router();
const ID = /^pa_[\w-]{10,40}$/;

router.get('/actions/:id', async (req, res) => {
  res.json(await actions.get(req.auth.merchantId, req.params.id));
});

router.post('/actions/:id/confirm', async (req, res, next) => {
  if (!ID.test(req.params.id)) return next();
  const action = await actions.confirm({ ...req.auth, requestId: req.id }, req.params.id);
  return res.json({ action, wallet: await wallet.getBalance(req.auth.merchantId) });
});

router.post('/actions/:id/cancel', async (req, res, next) => {
  if (!ID.test(req.params.id)) return next();
  const action = await actions.cancel(req.auth, req.params.id);
  return res.json({ action, wallet: await wallet.getBalance(req.auth.merchantId) });
});

module.exports = router;
