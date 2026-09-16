'use strict';
const pino = require('pino');

const logger = pino({
  level: process.env.LOG_LEVEL || (process.env.NODE_ENV === 'test' ? 'silent' : 'info'),
  redact: {
    paths: ['req.headers.authorization', 'req.headers.cookie', 'req.headers["x-razorpay-signature"]',
      '*.phone', '*.email', '*.password', '*.token', '*.apiKey', '*.key_secret'],
    censor: '[redacted]',
  },
  base: { service: process.env.SERVICE_NAME || 'bandhu-agent' },
  timestamp: pino.stdTimeFunctions.isoTime,
});

module.exports = { logger };
