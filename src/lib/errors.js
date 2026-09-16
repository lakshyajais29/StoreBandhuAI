'use strict';

class AppError extends Error {
  constructor(code, status = 500, message, details) {
    super(message || code);
    this.name = 'AppError';
    this.code = code;
    this.status = status;
    this.details = details;
    this.expose = status < 500;
  }
}

const E = {
  unauthenticated: (msg = 'Authentication required') => new AppError('UNAUTHENTICATED', 401, msg),
  forbidden: (msg = 'Not allowed') => new AppError('FORBIDDEN', 403, msg),
  notFound: (what = 'Resource') => new AppError('NOT_FOUND', 404, `${what} not found`),
  validation: (details, msg = 'Validation failed') => new AppError('VALIDATION_FAILED', 422, msg, details),
  insufficientTokens: (required, available) =>
    new AppError('INSUFFICIENT_TOKENS', 402, 'Not enough Bandhu Tokens', { required, available }),
  planUpgrade: (feature) => new AppError('PLAN_UPGRADE_REQUIRED', 403, `Your plan does not include ${feature}`, { feature }),
  rateLimited: (details) => new AppError('RATE_LIMITED', 429, 'Too many requests', details),
  conflict: (code, msg, details) => new AppError(code, 409, msg, details),
  gone: (code, msg) => new AppError(code, 410, msg),
  featureDisabled: (feature) => new AppError('FEATURE_DISABLED', 503, `${feature} is temporarily unavailable`, { feature }),
};

module.exports = { AppError, E };
