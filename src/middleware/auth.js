'use strict';
/** Merchant session JWT minted by Laravel (ADR-005). merchantId comes ONLY from here. */
const { jwtVerify, importSPKI } = require('jose');
const crypto = require('node:crypto');
const { env } = require('../config/env');
const { E } = require('../lib/errors');

let keyPromise;
function verificationKey() {
  if (!keyPromise) {
    const e = env();
    keyPromise = e.SESSION_JWT_PUBLIC_KEY
      ? importSPKI(e.SESSION_JWT_PUBLIC_KEY.replace(/\\n/g, '\n'), 'RS256').then((key) => ({ key, algorithms: ['RS256'] }))
      : Promise.resolve({ key: new TextEncoder().encode(e.SESSION_JWT_SECRET), algorithms: ['HS256'] });
  }
  return keyPromise;
}
function resetKeyCacheForTests() { keyPromise = undefined; }

async function verifySessionToken(token) {
  const e = env();
  const { key, algorithms } = await verificationKey();
  const { payload } = await jwtVerify(token, key, { issuer: e.SESSION_JWT_ISSUER, audience: e.SESSION_JWT_AUDIENCE, algorithms, clockTolerance: 30 });
  if (payload.mid === undefined || payload.mid === null || payload.sub === undefined) throw new Error('missing claims');
  return { userId: String(payload.sub), merchantId: String(payload.mid), scopes: Array.isArray(payload.scopes) ? payload.scopes : [], tokenId: payload.jti };
}

async function requireMerchant(req, _res, next) {
  const header = req.get('authorization') || '';
  const [scheme, token] = header.split(' ');
  if (scheme !== 'Bearer' || !token) return next(E.unauthenticated());
  try {
    req.auth = await verifySessionToken(token);
    return next();
  } catch {
    return next(E.unauthenticated('Session is invalid or expired'));
  }
}

function requireAdmin(req, _res, next) {
  const secret = env().ADMIN_SERVICE_SECRET;
  const given = req.get('x-admin-secret') || '';
  const actor = req.get('x-admin-actor');
  if (!secret) return next(E.forbidden('Admin API disabled'));
  const a = Buffer.from(given);
  const b = Buffer.from(secret);
  if (a.length !== b.length || !crypto.timingSafeEqual(a, b) || !actor) return next(E.forbidden());
  req.admin = { actor };
  return next();
}

module.exports = { requireMerchant, requireAdmin, verifySessionToken, resetKeyCacheForTests };
