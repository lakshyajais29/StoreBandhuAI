'use strict';
const { Router } = require('express');
const { handleChat } = require('../agent/chatService');
const conversations = require('../domain/conversations/service');
const { rateLimit } = require('../middleware/rateLimit');
const policies = require('../config/policies');

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
  const rows = await conversations.list(req.auth.merchantId, { limit: Number(req.query.limit) || 20, before: req.query.before });
  res.json({ data: rows.map((c) => ({ id: String(c._id), title: c.title, lastMessageAt: c.lastMessageAt })) });
});

router.get('/conversations/:id', async (req, res) => {
  const { conversation, messages } = await conversations.getWithMessages(req.auth.merchantId, req.params.id);
  res.json({ id: String(conversation._id), title: conversation.title, messages });
});

module.exports = router;
