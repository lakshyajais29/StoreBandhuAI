'use strict';
const { getPlan } = require('../config/plans');
const { env } = require('../config/env');

const TOOLS = [
  require('./definitions/getSalesSummary'),
  require('./definitions/searchProducts'),
  require('./definitions/checkInventory'),
  require('./definitions/getWalletBalance'),
  require('./definitions/createProductListing'),
  require('./definitions/updateInventory'),
  require('./definitions/generateProductImage'),
  require('./definitions/generateProductVideo'),
  require('./definitions/searchCustomers'),
  require('./definitions/getOrderStatus'),
  require('./definitions/createOrder'),
];
const BY_NAME = new Map(TOOLS.map((t) => [t.name, t]));

const FLAG = { writes: 'FEATURE_WRITES', media: 'FEATURE_MEDIA', video: 'FEATURE_VIDEO', orders: 'FEATURE_ORDERS' };

/** @returns {'ok'|'plan'|'flag'} */
function featureAccess(feature, planCode) {
  if (!feature) return 'ok';
  if (!env()[FLAG[feature]]) return 'flag';
  return getPlan(planCode).features[feature] ? 'ok' : 'plan';
}

const getTool = (name) => BY_NAME.get(name);
const allTools = () => TOOLS;

/** Tools offered to the LLM for this merchant (plan-gated; the executor re-checks). */
function llmToolsFor(planCode) {
  return TOOLS.filter((t) => featureAccess(t.feature, planCode) === 'ok')
    .map((t) => ({ name: t.name, description: t.description, parameters: t.parameters }));
}

module.exports = { getTool, allTools, llmToolsFor, featureAccess };
