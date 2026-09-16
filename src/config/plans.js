'use strict';
/**
 * Plan catalogue. ⚠️ Prices/token amounts are PLACEHOLDERS — owner must finalise (ADR-009).
 * All money in paise. Prices are only ever taken from here, never from the client.
 */
const plans = {
  trial: {
    code: 'trial', name: 'Free trial', pricePaise: 0, monthlyTokens: 0,
    features: { writes: true, media: true, video: false, orders: false },
    limits: { videoConcurrent: 0, videoPerDay: 0, imageConcurrent: 2, imagePerDay: 20 },
  },
  starter: {
    code: 'starter', name: 'Starter', pricePaise: 29900, monthlyTokens: 500,
    features: { writes: true, media: true, video: false, orders: true },
    limits: { videoConcurrent: 0, videoPerDay: 0, imageConcurrent: 3, imagePerDay: 60 },
  },
  growth: {
    code: 'growth', name: 'Growth', pricePaise: 79900, monthlyTokens: 1500,
    features: { writes: true, media: true, video: true, orders: true },
    limits: { videoConcurrent: 3, videoPerDay: 10, imageConcurrent: 4, imagePerDay: 150 },
  },
};

const tokenPacks = {
  pack_100: { code: 'pack_100', tokens: 100, pricePaise: 7900 },
  pack_500: { code: 'pack_500', tokens: 500, pricePaise: 34900 },
  pack_1500: { code: 'pack_1500', tokens: 1500, pricePaise: 94900 },
};

const PLAN_PERIOD_DAYS = 30;

function getPlan(code) {
  return plans[code] || plans.trial;
}

module.exports = { plans, tokenPacks, getPlan, PLAN_PERIOD_DAYS };
