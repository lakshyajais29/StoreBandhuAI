'use strict';
// Load BEFORE any src module in tests.
Object.assign(process.env, {
  NODE_ENV: 'test',
  LOG_LEVEL: 'silent',
  LARAVEL_API_BASE_URL: process.env.TEST_LARAVEL_URL || 'http://laravel.test',
  LARAVEL_AGENT_SERVICE_TOKEN: 'test-service-token',
  SESSION_JWT_SECRET: 'test-session-secret-0123456789-abcdefghij',
  LLM_PROVIDER: 'fake',
  MONGO_URI: process.env.TEST_MONGO_URI || 'mongodb://127.0.0.1:27017/bandhu_test?replicaSet=rs0',
  REDIS_URL: process.env.TEST_REDIS_URL || 'redis://127.0.0.1:6379/15',
  RAZORPAY_WEBHOOK_SECRET: 'whsec_test_123',
  RAZORPAY_KEY_SECRET: 'rzp_secret_test',
  ADMIN_SERVICE_SECRET: 'admin-secret-for-tests-123',
  LARAVEL_TIMEOUT_MS: '300',
  TRIAL_TOKENS: '0',
});
