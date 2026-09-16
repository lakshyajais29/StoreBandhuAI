'use strict';
const { Queue } = require('bullmq');
const { createRedis } = require('../lib/redis');
const { env } = require('../config/env');

const QUEUE = { image: 'media-image', video: 'media-video', maintenance: 'maintenance' };

let connection;
const queues = {};

function bullConnection() {
  if (!connection) connection = createRedis(env().REDIS_URL);
  return connection;
}

function getQueue(name) {
  if (!queues[name]) queues[name] = new Queue(name, { connection: bullConnection(), prefix: 'bandhu' });
  return queues[name];
}

const mediaQueueFor = (kind) => getQueue(kind === 'video' ? QUEUE.video : QUEUE.image);

async function closeQueues() {
  await Promise.all(Object.values(queues).map((q) => q.close()));
  if (connection) await connection.quit().catch(() => {});
  connection = undefined;
}

module.exports = { QUEUE, getQueue, mediaQueueFor, bullConnection, closeQueues };
