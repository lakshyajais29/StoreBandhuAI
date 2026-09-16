'use strict';
const mongoose = require('mongoose');
const { logger } = require('./logger');

mongoose.set('strictQuery', true);

async function connectMongo(uri) {
  await mongoose.connect(uri, { serverSelectionTimeoutMS: 8000 });
  logger.info({ db: mongoose.connection.name }, 'mongo connected');
  return mongoose.connection;
}

const disconnectMongo = () => mongoose.disconnect();
const mongoReady = () => mongoose.connection.readyState === 1;

/**
 * Run fn inside a transaction. The driver retries on transient errors, so fn must
 * only touch the database through `session` and be safe to re-run.
 * Requires MongoDB running as a replica set (docker-compose provides rs0).
 */
async function withTransaction(fn) {
  const session = await mongoose.startSession();
  try {
    let result;
    await session.withTransaction(async () => {
      result = await fn(session);
    }, { readConcern: { level: 'snapshot' }, writeConcern: { w: 'majority' } });
    return result;
  } finally {
    await session.endSession();
  }
}

module.exports = { connectMongo, disconnectMongo, mongoReady, withTransaction, mongoose };
