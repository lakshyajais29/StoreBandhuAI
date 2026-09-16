'use strict';
const { getRedis } = require('../../lib/redis');
const { laravel } = require('../../integrations/laravel/client');
const wallet = require('../wallet/service');
const { getPlan } = require('../../config/plans');
const { logger } = require('../../lib/logger');

const TTL_SECONDS = 600;

/** Store context from Laravel (cached) + plan from our wallet (source of truth for plans, ADR-001). */
async function getMerchantContext({ merchantId, userId, requestId }) {
  const redis = getRedis();
  const key = `ctx:${merchantId}`;
  let store = null;
  try {
    const cached = await redis.get(key);
    if (cached) store = JSON.parse(cached);
  } catch (err) { logger.warn({ err }, 'context cache read failed'); }
  if (!store) {
    try {
      store = await laravel().forMerchant({ merchantId, userId, requestId }).context();
      await redis.set(key, JSON.stringify(store), 'EX', TTL_SECONDS).catch(() => {});
    } catch (err) {
      logger.warn({ err: err.message, merchantId }, 'could not load store context; using defaults');
      store = {};
    }
  }
  const w = await wallet.ensureWallet(merchantId);
  const planCode = w.planStatus === 'active' ? w.planCode : 'trial';
  return {
    merchantId, userId, requestId,
    storeName: store.store_name || 'your store',
    timezone: store.timezone || 'Asia/Kolkata',
    planCode,
    plan: getPlan(planCode),
  };
}

module.exports = { getMerchantContext };
