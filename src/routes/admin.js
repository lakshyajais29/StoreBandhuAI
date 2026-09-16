'use strict';
const { Router } = require('express');
const wallet = require('../domain/wallet/service');
const audit = require('../domain/audit/service');
const { ToolCall } = require('../models/audit');
const { Message, Conversation } = require('../models/conversation');
const { PendingAction } = require('../models/action');
const { plans, PLAN_PERIOD_DAYS } = require('../config/plans');
const { E } = require('../lib/errors');

const router = Router();

router.get('/merchants/:mid/wallet', async (req, res) => res.json(await wallet.getBalance(req.params.mid)));

router.post('/merchants/:mid/adjust', async (req, res) => {
  const tokens = Number(req.body?.tokens);
  if (!Number.isInteger(tokens) || tokens === 0) throw E.validation([{ field: 'tokens', problem: 'non-zero integer' }]);
  const out = await wallet.adjust({ merchantId: req.params.mid, tokens, reason: req.body?.reason, actorId: req.admin.actor, requestId: req.id });
  await audit.recordAdmin({ actor: req.admin.actor, action: 'wallet.adjust', merchantId: req.params.mid, details: { tokens, reason: req.body?.reason } });
  res.json(out);
});

router.post('/merchants/:mid/plan', async (req, res) => {
  const { planCode, days = PLAN_PERIOD_DAYS, grantTokens = false } = req.body || {};
  if (!plans[planCode]) throw E.validation([{ field: 'planCode', problem: 'unknown plan' }]);
  const renewsAt = new Date(Date.now() + Number(days) * 86400000);
  await wallet.ensureWallet(req.params.mid);
  await wallet.setPlan({ merchantId: req.params.mid, planCode, renewsAt });
  if (grantTokens && plans[planCode].monthlyTokens > 0) {
    await wallet.credit({ merchantId: req.params.mid, tokens: plans[planCode].monthlyTokens, source: 'plan', type: 'grant', actionRef: `admin-plan:${req.params.mid}:${Date.now()}`, expiresAt: renewsAt, actorType: 'admin', actorId: req.admin.actor, reason: 'admin plan grant' });
  }
  await audit.recordAdmin({ actor: req.admin.actor, action: 'plan.set', merchantId: req.params.mid, details: { planCode, days, grantTokens } });
  res.json(await wallet.getBalance(req.params.mid));
});

router.get('/tool-calls', async (req, res) => {
  const q = {};
  if (req.query.merchantId) q.merchantId = String(req.query.merchantId);
  if (req.query.requestId) q.requestId = String(req.query.requestId);
  if (!q.merchantId && !q.requestId) throw E.validation([{ field: 'merchantId|requestId', problem: 'one is required' }]);
  res.json({ data: await ToolCall.find(q).sort({ createdAt: -1 }).limit(200).lean() });
});

router.get('/actions/:id', async (req, res) => {
  const pa = await PendingAction.findById(req.params.id).lean();
  if (!pa) throw E.notFound('Action');
  res.json(pa);
});

router.get('/conversations/:id', async (req, res) => {
  const c = await Conversation.findById(req.params.id).lean();
  if (!c) throw E.notFound('Conversation');
  const messages = await Message.find({ conversationId: c._id }).sort({ createdAt: 1 }).lean();
  await audit.recordAdmin({ actor: req.admin.actor, action: 'conversation.view', merchantId: c.merchantId, details: { conversationId: req.params.id } });
  res.json({ conversation: c, messages });
});

router.post('/reconcile', async (req, res) => res.json(await wallet.reconcile(req.body?.merchantId)));

module.exports = router;
