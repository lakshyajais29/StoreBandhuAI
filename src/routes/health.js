'use strict';
const { Router } = require('express');
const { mongoReady } = require('../lib/mongo');
const { getRedis } = require('../lib/redis');

const router = Router();

router.get('/health', (_req, res) => res.json({ status: 'ok' }));

router.get('/ready', async (_req, res) => {
  const checks = { mongo: mongoReady() };
  try {
    checks.redis = (await Promise.race([getRedis().ping(), new Promise((_, r) => setTimeout(() => r(new Error('t')), 1000))])) === 'PONG';
  } catch { checks.redis = false; }
  const ok = Object.values(checks).every(Boolean);
  res.status(ok ? 200 : 503).json({ status: ok ? 'ready' : 'not_ready', checks });
});

module.exports = router;
