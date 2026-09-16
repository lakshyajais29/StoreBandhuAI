'use strict';
const { Redis } = require('ioredis');

let shared;

/** BullMQ requires maxRetriesPerRequest: null on the connections it uses. */
function createRedis(url, opts = {}) {
  return new Redis(url, { maxRetriesPerRequest: null, enableReadyCheck: true, ...opts });
}

function getRedis() {
  if (!shared) shared = createRedis(require('../config/env').env().REDIS_URL);
  return shared;
}

function setRedisForTests(client) {
  shared = client;
}

async function closeRedis() {
  if (shared) {
    await shared.quit().catch(() => shared.disconnect());
    shared = undefined;
  }
}

module.exports = { createRedis, getRedis, closeRedis, setRedisForTests };
