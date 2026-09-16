'use strict';
/** Mint a local merchant session JWT for curl/testing. Usage: node scripts/dev-token.js [merchantId] [userId] */
require('dotenv').config({ quiet: true });
const { SignJWT } = require('jose');

(async () => {
  const [merchantId = 'm_demo', userId = 'u_demo'] = process.argv.slice(2);
  const secret = process.env.SESSION_JWT_SECRET;
  if (!secret) throw new Error('SESSION_JWT_SECRET not set');
  if (process.env.NODE_ENV === 'production') throw new Error('refusing to mint tokens in production');
  const token = await new SignJWT({ mid: merchantId, scopes: ['agent'] })
    .setProtectedHeader({ alg: 'HS256' }).setSubject(userId)
    .setIssuer(process.env.SESSION_JWT_ISSUER || 'storebandhu-laravel').setAudience(process.env.SESSION_JWT_AUDIENCE || 'bandhu-agent')
    .setIssuedAt().setExpirationTime('12h').sign(new TextEncoder().encode(secret));
  process.stdout.write(`${token}\n`);
})().catch((e) => { console.error(e.message); process.exit(1); }); // eslint-disable-line no-console
