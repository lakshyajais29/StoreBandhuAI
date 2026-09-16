'use strict';
const mongoose = require('mongoose');

/** Connect to the test replica set or return false so suites can skip with a clear reason. */
async function connectOrSkip() {
  try {
    await mongoose.connect(process.env.MONGO_URI, { serverSelectionTimeoutMS: 2500 });
    await mongoose.connection.db.dropDatabase();
    await Promise.all(Object.values(mongoose.models).map((m) => m.syncIndexes()));
    return true;
  } catch {
    return false;
  }
}
const SKIP_REASON = 'MongoDB replica set not reachable (run `docker compose up -d mongo redis` then `npm run test:integration`)';
module.exports = { connectOrSkip, SKIP_REASON, mongoose };
