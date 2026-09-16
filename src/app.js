'use strict';
const path = require('node:path');
const express = require('express');
const helmet = require('helmet');
const cors = require('cors');
const pinoHttp = require('pino-http');
const { env } = require('./config/env');
const { logger } = require('./lib/logger');
const requestId = require('./middleware/requestId');
const { requireMerchant, requireAdmin } = require('./middleware/auth');
const { notFound, errorHandler } = require('./middleware/errorHandler');

function createApp() {
  const e = env();
  const app = express();
  app.disable('x-powered-by');
  app.set('trust proxy', e.TRUST_PROXY);

  app.use(requestId);
  app.use(pinoHttp({ logger, genReqId: (req) => req.id, autoLogging: { ignore: (req) => req.url === '/health' } }));
  app.use(helmet({ crossOriginResourcePolicy: { policy: 'cross-origin' } }));
  app.use(cors({
    origin: (origin, cb) => cb(null, !origin || e.CORS_ORIGINS.includes(origin)),
    allowedHeaders: ['Authorization', 'Content-Type', 'X-Request-Id'],
    exposedHeaders: ['X-Request-Id', 'Retry-After'],
    maxAge: 600,
  }));

  // Raw-body routes first (Razorpay signature needs exact bytes).
  app.use('/webhooks', require('./routes/webhooks'));

  if (e.STORAGE_DRIVER === 'local') {
    app.use('/files', express.static(path.resolve(e.LOCAL_STORAGE_DIR), { fallthrough: false, index: false, maxAge: '1h' }));
  }

  app.use(require('./routes/health'));
  app.use(express.json({ limit: '100kb' }));

  const api = express.Router();
  api.use(requireMerchant);
  api.use(require('./routes/chat'));
  api.use(require('./routes/actions'));
  api.use(require('./routes/wallet'));
  api.use(require('./routes/uploads'));
  api.use(require('./routes/jobs'));
  api.use(require('./routes/billing'));
  app.use('/api', api);

  app.use('/admin', requireAdmin, require('./routes/admin'));

  app.use(notFound);
  app.use(errorHandler);
  return app;
}

module.exports = { createApp };
