'use strict';
const { Router } = require('express');
const { handleChat } = require('../agent/chatService');
const conversations = require('../domain/conversations/service');
const { rateLimit } = require('../middleware/rateLimit');
const policies = require('../config/policies');
const { E } = require('../lib/errors');

const router = Router();
const chatLimiter = rateLimit({
  name: 'chat',
  windows: [
    { label: 'minute', ms: 60_000, max: policies.chatRateLimit.perMinute },
    { label: 'day', ms: 86_400_000, max: policies.chatRateLimit.perDay },
  ],
});

router.post('/chat', chatLimiter, async (req, res) => {
  res.json(await handleChat({ auth: req.auth, body: req.body, requestId: req.id }));
});

router.get('/conversations', async (req, res) => {
  const status = req.query.status === 'archived' ? 'archived' : 'active';
  const limit = Math.min(Number(req.query.limit) || 20, 50);
  const rows = await conversations.list(req.auth.merchantId, { limit: limit + 1, before: req.query.before, status });
  const page = rows.slice(0, limit);
  res.json({
    data: page.map(conversations.publicConversation),
    nextCursor: rows.length > limit && page.length ? new Date(page[page.length - 1].lastMessageAt).toISOString() : null,
  });
});

router.get('/conversations/:id', async (req, res) => {
  const { conversation, messages, assets } = await conversations.getWithMessages(req.auth.merchantId, req.params.id);
  res.json({ id: String(conversation._id), title: conversation.title, status: conversation.status, messages, assets });
});

/** Rename and/or archive. Both fields optional; at least one required. */
router.patch('/conversations/:id', async (req, res) => {
  const { title, status } = req.body || {};
  if (title === undefined && status === undefined) throw E.validation([{ field: 'title', problem: 'title or status required' }]);
  let out;
  if (title !== undefined) out = await conversations.rename(req.auth.merchantId, req.params.id, title);
  if (status !== undefined) out = await conversations.setStatus(req.auth.merchantId, req.params.id, status);
  res.json(out);
});

/** Archives (soft). History, actions and ledger rows are never destroyed. */
router.delete('/conversations/:id', async (req, res) => {
  res.json(await conversations.setStatus(req.auth.merchantId, req.params.id, 'archived'));
});

module.exports = router;
