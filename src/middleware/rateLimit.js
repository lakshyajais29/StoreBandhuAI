'use strict';
const { getRedis } = require('../lib/redis');
const { E } = require('../lib/errors');
const { logger } = require('../lib/logger');

/**
 * Fixed-window counters in Redis, per merchant. Fails open (logs) if Redis is down,
 * because token balance and tool limits still protect cost.
 */
function rateLimit({ name, windows }) {
  return async function limiter(req, res, next) {
    const id = req.auth?.merchantId;
    if (!id) return next();
    try {
      const now = Date.now();
      const redis = getRedis();
      const multi = redis.multi();
      const keys = windows.map((w) => {
        const bucket = Math.floor(now / w.ms);
        const key = `rl:${name}:${id}:${w.ms}:${bucket}`;
        multi.incr(key).pexpire(key, w.ms + 1000);
        return { ...w, bucket };
      });
      const results = await multi.exec();
      for (let i = 0; i < keys.length; i += 1) {
        const count = results[i * 2][1];
        if (count > keys[i].max) {
          const retryAfterMs = (keys[i].bucket + 1) * keys[i].ms - now;
          res.setHeader('retry-after', Math.ceil(retryAfterMs / 1000));
          return next(E.rateLimited({ window: keys[i].label, limit: keys[i].max, retryAfterSeconds: Math.ceil(retryAfterMs / 1000) }));
        }
      }
      return next();
    } catch (err) {
      logger.warn({ err: err.message }, 'rate limiter unavailable; allowing request');
      return next();
    }
  };
}

module.exports = { rateLimit };
