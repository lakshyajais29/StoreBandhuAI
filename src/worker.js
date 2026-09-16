'use strict';
/** Background worker process: media generation + scheduled maintenance. Never run inside the API process. */
const { Worker } = require('bullmq');
const { env } = require('./config/env');
const { logger } = require('./lib/logger');

async function main() {
  const e = env();
  const { connectMongo, disconnectMongo } = require('./lib/mongo');
  const { createRedis, closeRedis } = require('./lib/redis');
  const { QUEUE, getQueue, closeQueues } = require('./queues');
  const { processMediaJob } = require('./queues/processors/mediaJob');
  const { processMaintenance, SCHEDULE } = require('./queues/processors/maintenance');

  await connectMongo(e.MONGO_URI);
  const connection = createRedis(e.REDIS_URL);
  const common = { connection, prefix: 'bandhu' };

  const workers = [
    new Worker(QUEUE.image, processMediaJob, { ...common, concurrency: e.WORKER_IMAGE_CONCURRENCY, lockDuration: 120000 }),
    new Worker(QUEUE.video, processMediaJob, { ...common, concurrency: e.WORKER_VIDEO_CONCURRENCY, lockDuration: 300000 }),
    new Worker(QUEUE.maintenance, processMaintenance, { ...common, concurrency: 1 }),
  ];
  for (const w of workers) {
    w.on('failed', (job, err) => logger.warn({ queue: w.name, jobId: job?.id, err: err.message }, 'job attempt failed'));
    w.on('error', (err) => logger.error({ queue: w.name, err }, 'worker error'));
  }

  const maintenance = getQueue(QUEUE.maintenance);
  for (const [name, repeat] of Object.entries(SCHEDULE)) {
    await maintenance.upsertJobScheduler(name, repeat, { name, data: {}, opts: { removeOnComplete: { count: 50 }, removeOnFail: { count: 200 } } });
  }
  logger.info({ schedules: Object.keys(SCHEDULE) }, 'worker started');

  const shutdown = async (signal) => {
    logger.info({ signal }, 'worker shutting down (finishing active jobs)');
    const force = setTimeout(() => process.exit(1), 60000).unref();
    await Promise.allSettled(workers.map((w) => w.close()));
    await Promise.allSettled([closeQueues(), connection.quit(), closeRedis(), disconnectMongo()]);
    clearTimeout(force);
    process.exit(0);
  };
  process.on('SIGTERM', shutdown);
  process.on('SIGINT', shutdown);
}

main().catch((err) => {
  logger.fatal({ err }, 'worker failed to start');
  process.exit(1);
});
