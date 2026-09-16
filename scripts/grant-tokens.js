'use strict';
/** Dev/ops: node scripts/grant-tokens.js <merchantId> <tokens> "<reason>" */
const { env } = require('../src/config/env');
const { connectMongo, disconnectMongo } = require('../src/lib/mongo');
const wallet = require('../src/domain/wallet/service');

(async () => {
  const [merchantId, tokens, reason = 'manual grant via script'] = process.argv.slice(2);
  if (!merchantId || !Number.isInteger(Number(tokens))) throw new Error('usage: grant-tokens <merchantId> <tokens> [reason]');
  await connectMongo(env().MONGO_URI);
  await wallet.ensureWallet(merchantId);
  await wallet.adjust({ merchantId, tokens: Number(tokens), reason, actorId: `script:${process.env.USER || 'unknown'}` });
  console.log(await wallet.getBalance(merchantId)); // eslint-disable-line no-console
  await disconnectMongo();
})().catch((e) => { console.error(e.message); process.exit(1); }); // eslint-disable-line no-console
