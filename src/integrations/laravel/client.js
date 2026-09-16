'use strict';
/**
 * The ONLY place that knows Laravel URLs (docs/03-LARAVEL-API-CONTRACT.md).
 * Error mapping:
 *   timeout            → UPSTREAM_TIMEOUT (504)  — writes: outcome UNKNOWN
 *   no response / 5xx  → UPSTREAM_ERROR (502)    — writes: outcome UNKNOWN
 *   401/403            → UPSTREAM_AUTH (502)     — our service credentials are wrong
 *   other 4xx          → Laravel error code, same status — definite failure
 */
const { createHttp } = require('../../lib/http');
const { AppError } = require('../../lib/errors');

const PATHS = {
  context: () => '/api/v1/agent/context',
  salesSummary: () => '/api/v1/agent/sales-summary',
  searchProducts: () => '/api/v1/agent/products/search',
  inventory: (id) => `/api/v1/agent/inventory/${encodeURIComponent(id)}`,
  listingPreview: () => '/api/v1/agent/listings/preview',
  listings: () => '/api/v1/agent/listings',
  productMedia: (id) => `/api/v1/agent/products/${encodeURIComponent(id)}/media`,
  searchCustomers: () => '/api/v1/agent/customers/search',
  orderQuote: () => '/api/v1/agent/orders/quote',
  orders: () => '/api/v1/agent/orders',
  order: (id) => `/api/v1/agent/orders/${encodeURIComponent(id)}`,
  idempotency: (key) => `/api/v1/agent/idempotency/${encodeURIComponent(key)}`,
};

const AMBIGUOUS_CODES = new Set(['UPSTREAM_TIMEOUT', 'UPSTREAM_ERROR']);
const isAmbiguousUpstreamError = (err) => err instanceof AppError && AMBIGUOUS_CODES.has(err.code);

function mapError(err) {
  if (err instanceof AppError) return err;
  if (err.code === 'ECONNABORTED' || err.code === 'ETIMEDOUT' || /timeout/i.test(err.message || '')) {
    return new AppError('UPSTREAM_TIMEOUT', 504, 'The store did not respond in time');
  }
  return new AppError('UPSTREAM_ERROR', 502, 'Could not reach the store backend', { cause: err.code || err.message });
}

function createLaravelClient({ baseURL, serviceToken, timeout }) {
  const http = createHttp({ baseURL, timeout, headers: { Authorization: `Bearer ${serviceToken}`, Accept: 'application/json' } });

  function forMerchant({ merchantId, userId, requestId }) {
    if (!merchantId) throw new AppError('MISSING_MERCHANT_CONTEXT', 500);
    const baseHeaders = { 'X-Merchant-Id': merchantId, 'X-Acting-User-Id': userId || '', 'X-Request-Id': requestId || '' };

    async function call(method, url, { params, data, idempotencyKey, signal } = {}) {
      const headers = { ...baseHeaders };
      if (method !== 'get') {
        if (!idempotencyKey) throw new AppError('MISSING_IDEMPOTENCY_KEY', 500, `write to ${url} without Idempotency-Key`);
        headers['Idempotency-Key'] = idempotencyKey;
      }
      let res;
      try {
        res = await http.request({ method, url, params, data, headers, signal });
      } catch (err) {
        throw mapError(err);
      }
      if (res.status >= 200 && res.status < 300) return res.data;
      const body = res.data && typeof res.data === 'object' ? res.data.error || {} : {};
      if (res.status >= 500) throw new AppError('UPSTREAM_ERROR', 502, 'The store backend failed', { upstreamStatus: res.status });
      if (res.status === 401 || res.status === 403) {
        throw new AppError('UPSTREAM_AUTH', 502, 'Agent service is not authorised by the store backend', { upstreamStatus: res.status });
      }
      throw new AppError(body.code || `LARAVEL_${res.status}`, res.status, body.message || 'Store backend rejected the request', {
        upstream: true, fields: body.fields,
      });
    }

    return {
      context: (o) => call('get', PATHS.context(), o),
      salesSummary: ({ from, to }, o) => call('get', PATHS.salesSummary(), { ...o, params: { from, to } }),
      searchProducts: ({ q, limit }, o) => call('get', PATHS.searchProducts(), { ...o, params: { q, limit } }),
      getInventory: (productId, o) => call('get', PATHS.inventory(productId), o),
      previewListing: (payload, o) => call('post', PATHS.listingPreview(), { ...o, data: payload, idempotencyKey: o?.idempotencyKey || `preview-${Date.now()}-${Math.random()}` }),
      createListing: (payload, o) => call('post', PATHS.listings(), { ...o, data: payload }),
      updateInventory: (productId, payload, o) => call('patch', PATHS.inventory(productId), { ...o, data: payload }),
      attachMedia: (productId, payload, o) => call('post', PATHS.productMedia(productId), { ...o, data: payload }),
      searchCustomers: ({ q, limit }, o) => call('get', PATHS.searchCustomers(), { ...o, params: { q, limit } }),
      quoteOrder: (payload, o) => call('post', PATHS.orderQuote(), { ...o, data: payload, idempotencyKey: o?.idempotencyKey || `quote-${Date.now()}-${Math.random()}` }),
      createOrder: (payload, o) => call('post', PATHS.orders(), { ...o, data: payload }),
      getOrder: (orderId, o) => call('get', PATHS.order(orderId), o),
      getIdempotency: (key, o) => call('get', PATHS.idempotency(key), o),
    };
  }

  return { forMerchant };
}

let singleton;
function laravel() {
  if (!singleton) {
    const { env } = require('../../config/env');
    const e = env();
    singleton = createLaravelClient({ baseURL: e.LARAVEL_API_BASE_URL, serviceToken: e.LARAVEL_AGENT_SERVICE_TOKEN, timeout: e.LARAVEL_TIMEOUT_MS });
  }
  return singleton;
}

module.exports = { createLaravelClient, laravel, isAmbiguousUpstreamError, PATHS };
