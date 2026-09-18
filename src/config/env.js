'use strict';
require('dotenv').config({ quiet: true });
const { z } = require('zod');

const bool = (def) => z.enum(['true', 'false']).default(def).transform((v) => v === 'true');
const int = (def) => z.coerce.number().int().default(def);
const csv = (def) => z.string().default(def).transform((v) => v.split(',').map((s) => s.trim()).filter(Boolean));

const schema = z
  .object({
    NODE_ENV: z.enum(['development', 'test', 'production']).default('development'),
    PORT: int(4000),
    LOG_LEVEL: z.string().default('info'),
    CORS_ORIGINS: csv('http://localhost:5173,http://localhost:8000'),
    PUBLIC_BASE_URL: z.string().url().default('http://localhost:4000'),
    TRUST_PROXY: int(1),

    SESSION_JWT_ISSUER: z.string().default('storebandhu-laravel'),
    SESSION_JWT_AUDIENCE: z.string().default('bandhu-agent'),
    SESSION_JWT_SECRET: z.string().optional(),
    SESSION_JWT_PUBLIC_KEY: z.string().optional(),
    ADMIN_SERVICE_SECRET: z.string().min(16).optional(),

    LARAVEL_API_BASE_URL: z.string().url(),
    LARAVEL_AGENT_SERVICE_TOKEN: z.string().min(1),
    LARAVEL_TIMEOUT_MS: int(8000),
    // 'mock' = mock-laravel/server.js contract (flat bodies, price_paise, quote_id flow) — local dev/tests default.
    // 'real' = storebandhu's actual Laravel API ({success,data,meta} envelope, rupee floats, stateless quote). See docs/03-LARAVEL-API-CONTRACT.md.
    LARAVEL_API_DIALECT: z.enum(['mock', 'real']).default('mock'),

    LLM_PROVIDER: z.enum(['glm', 'fake']).default('glm'),
    GLM_API_KEY: z.string().optional(),
    GLM_BASE_URL: z.string().url().default('https://api.z.ai/api/paas/v4'),
    GLM_MODEL: z.string().default('glm-4.7-flash'),
    LLM_TIMEOUT_MS: int(20000),
    LLM_TEMPERATURE: z.coerce.number().default(0.1),
    AGENT_MAX_ITERATIONS: int(4),
    AGENT_MAX_TOOL_CALLS_PER_ITERATION: int(3),
    AGENT_REQUEST_BUDGET_MS: int(45000),
    AGENT_HISTORY_MESSAGES: int(24),

    MONGO_URI: z.string().min(1),
    REDIS_URL: z.string().default('redis://localhost:6379'),

    STORAGE_DRIVER: z.enum(['local', 's3']).default('local'),
    LOCAL_STORAGE_DIR: z.string().default('./data/files'),
    S3_ENDPOINT: z.string().optional(),
    S3_REGION: z.string().default('auto'),
    S3_BUCKET: z.string().optional(),
    S3_ACCESS_KEY_ID: z.string().optional(),
    S3_SECRET_ACCESS_KEY: z.string().optional(),
    CDN_BASE_URL: z.string().optional(),
    UPLOAD_MAX_BYTES: int(10 * 1024 * 1024),

    MEDIA_GATEWAY: z.enum(['mock', 'fal']).default('mock'),
    FAL_KEY: z.string().optional(),
    IMAGE_MODEL_ID: z.string().default('fal-ai/flux-kontext/dev'),
    VIDEO_MODEL_DEFAULT_ID: z.string().default('fal-ai/seedance-2.0-fast/image-to-video'),
    VIDEO_MODEL_PERSON_ID: z.string().default('fal-ai/kling-video/v3/image-to-video'),
    VIDEO_UNKNOWN_PERSON_ROUTE: z.enum(['default', 'person']).default('person'),
    MEDIA_JOB_TIMEOUT_MS: int(5 * 60 * 1000),
    MOCK_MEDIA_FAIL_RATE: z.coerce.number().min(0).max(1).default(0),
    WORKER_IMAGE_CONCURRENCY: int(4),
    WORKER_VIDEO_CONCURRENCY: int(2),

    RAZORPAY_KEY_ID: z.string().optional(),
    RAZORPAY_KEY_SECRET: z.string().optional(),
    RAZORPAY_WEBHOOK_SECRET: z.string().optional(),

    PII_HMAC_SECRET: z.string().min(16).default('dev-only-pii-secret-change-me'),
    TRIAL_TOKENS: int(50),
    PLAN_TOKENS_EXPIRE: bool('true'),
    CHAT_TURN_COST: int(1),
    FEATURE_WRITES: bool('true'),
    FEATURE_MEDIA: bool('true'),
    FEATURE_VIDEO: bool('true'),
    FEATURE_ORDERS: bool('true'),
  })
  .superRefine((e, ctx) => {
    const req = (path, message) => ctx.addIssue({ code: 'custom', path: [path], message });
    if (!e.SESSION_JWT_SECRET && !e.SESSION_JWT_PUBLIC_KEY) req('SESSION_JWT_SECRET', 'set SESSION_JWT_SECRET (HS256) or SESSION_JWT_PUBLIC_KEY (RS256)');
    if (e.SESSION_JWT_SECRET && e.SESSION_JWT_SECRET.length < 32) req('SESSION_JWT_SECRET', 'must be at least 32 characters');
    if (e.LLM_PROVIDER === 'glm' && !e.GLM_API_KEY) req('GLM_API_KEY', 'required when LLM_PROVIDER=glm');
    if (e.STORAGE_DRIVER === 's3') {
      for (const k of ['S3_BUCKET', 'S3_ACCESS_KEY_ID', 'S3_SECRET_ACCESS_KEY', 'CDN_BASE_URL']) if (!e[k]) req(k, 'required when STORAGE_DRIVER=s3');
    }
    if (e.MEDIA_GATEWAY === 'fal' && !e.FAL_KEY) req('FAL_KEY', 'required when MEDIA_GATEWAY=fal');
    if (e.NODE_ENV === 'production') {
      if (e.PII_HMAC_SECRET.startsWith('dev-only')) req('PII_HMAC_SECRET', 'must be set in production');
      if (e.MEDIA_GATEWAY === 'mock') req('MEDIA_GATEWAY', 'mock gateway not allowed in production');
      if (e.LLM_PROVIDER === 'fake') req('LLM_PROVIDER', 'fake LLM not allowed in production');
      if (e.STORAGE_DRIVER === 'local') req('STORAGE_DRIVER', 'local storage not allowed in production');
      if (!e.RAZORPAY_WEBHOOK_SECRET) req('RAZORPAY_WEBHOOK_SECRET', 'required in production');
    }
  });

function loadEnv(source = process.env) {
  const parsed = schema.safeParse(source);
  if (!parsed.success) {
    const lines = parsed.error.issues.map((i) => `  - ${i.path.join('.')}: ${i.message}`);
    const err = new Error(`Invalid environment configuration:\n${lines.join('\n')}`);
    err.code = 'INVALID_ENV';
    throw err;
  }
  return Object.freeze(parsed.data);
}

let cached;
function env() {
  if (!cached) cached = loadEnv();
  return cached;
}
/** test helper */
function setEnvForTests(overrides) {
  cached = loadEnv({ ...process.env, ...overrides });
  return cached;
}

module.exports = { env, loadEnv, setEnvForTests };
