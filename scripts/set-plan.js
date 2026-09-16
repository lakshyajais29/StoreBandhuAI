'use strict';
/** Dev/ops: node scripts/set-plan.js <merchantId> <trial|starter|growth> [days] */
const { env } = require('../src/config/env');
const { connectMongo, disconnectMongo } = require('../src/lib/mongo');
const wallet = require('../src/domain/wallet/service');
const { plans } = require('../src/config/plans');

(async () => {
  const [merchantId, planCode, days = 30] = process.argv.slice(2);
  if (!merchantId || !plans[planCode]) throw new Error(`usage: set-plan <merchantId> <${Object.keys(plans).join('|')}> [days]`);
  await connectMongo(env().MONGO_URI);
  await wallet.ensureWallet(merchantId);
  await wallet.setPlan({ merchantId, planCode, renewsAt: new Date(Date.now() + Number(days) * 86400000) });
  console.log(await wallet.getBalance(merchantId)); // eslint-disable-line no-console
  await disconnectMongo();
})().catch((e) => { console.error(e.message); process.exit(1); }); // eslint-disable-line no-console
