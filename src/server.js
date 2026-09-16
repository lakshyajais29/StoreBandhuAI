'use strict';
const { env } = require('./config/env');
const { logger } = require('./lib/logger');

async function main() {
  let e;
  try {
    e = env();
  } catch (err) {
    console.error(err.message); // eslint-disable-line no-console
    process.exit(1);
  }
  const { connectMongo, disconnectMongo } = require('./lib/mongo');
  const { closeRedis, getRedis } = require('./lib/redis');
  const { closeQueues } = require('./queues');
  const { createApp } = require('./app');

  await connectMongo(e.MONGO_URI);
  await getRedis().ping();

  const server = createApp().listen(e.PORT, () => logger.info({ port: e.PORT, env: e.NODE_ENV }, 'Bandhu AI agent API listening'));
  server.requestTimeout = e.AGENT_REQUEST_BUDGET_MS + 15000;

  let shuttingDown = false;
  const shutdown = async (signal) => {
    if (shuttingDown) return;
    shuttingDown = true;
    logger.info({ signal }, 'shutting down');
    const force = setTimeout(() => process.exit(1), 30000).unref();
    server.close(async () => {
      await Promise.allSettled([closeQueues(), closeRedis(), disconnectMongo()]);
      clearTimeout(force);
      process.exit(0);
    });
  };
  process.on('SIGTERM', shutdown);
  process.on('SIGINT', shutdown);
}

process.on('unhandledRejection', (err) => logger.error({ err }, 'unhandled rejection'));

main().catch((err) => {
  logger.fatal({ err }, 'failed to start');
  process.exit(1);
});
