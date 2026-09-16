'use strict';
require('../helpers/env');
const test = require('node:test');
const assert = require('node:assert/strict');
const { loadEnv } = require('../../src/config/env');

const base = {
  LARAVEL_API_BASE_URL: 'http://x.test', LARAVEL_AGENT_SERVICE_TOKEN: 't', SESSION_JWT_SECRET: 'x'.repeat(32), MONGO_URI: 'mongodb://m', LLM_PROVIDER: 'fake',
};

test('valid minimal env loads with defaults', () => {
  const e = loadEnv(base);
  assert.equal(e.PORT, 4000);
  assert.equal(e.AGENT_MAX_ITERATIONS, 4);
  assert.deepEqual(e.CORS_ORIGINS, ['http://localhost:5173', 'http://localhost:8000']);
});

test('missing required vars produce one readable error', () => {
  assert.throws(() => loadEnv({}), (err) => err.code === 'INVALID_ENV' && /LARAVEL_API_BASE_URL/.test(err.message) && /MONGO_URI/.test(err.message));
});

test('GLM key required when provider is glm', () => {
  assert.throws(() => loadEnv({ ...base, LLM_PROVIDER: 'glm' }), /GLM_API_KEY/);
});

test('production refuses dev-only settings', () => {
  assert.throws(() => loadEnv({ ...base, NODE_ENV: 'production' }), (err) => /PII_HMAC_SECRET/.test(err.message) && /MEDIA_GATEWAY/.test(err.message) && /LLM_PROVIDER/.test(err.message));
});

test('short JWT secret rejected', () => {
  assert.throws(() => loadEnv({ ...base, SESSION_JWT_SECRET: 'short' }), /at least 32/);
});
