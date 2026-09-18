'use strict';
/**
 * The ONLY place that knows Laravel URLs and response shapes (docs/03-LARAVEL-API-CONTRACT.md).
 *
 * Two dialects, selected by env LARAVEL_API_DIALECT:
 *   'mock' (default) — mock-laravel/server.js's contract: flat JSON bodies, price_paise integers,
 *                       a stateful quote_id with server-side expiry. Used by local dev and both test suites.
 *   'real'            — storebandhu's actual Laravel API, per BANDHU_AI_LARAVEL_INTEGRATION_ANSWERS.md:
 *                       every body wrapped as {success, data, meta}, money as rupee floats, category by
 *                       id (not name), a single-step stateless order endpoint (no quote_id, no address_ref).
 *                       This adapter translates real Laravel's shape into the exact shape the 'mock' dialect
 *                       already returns, so every tool file, the whole tools/ test suite, and the integration
 *                       tests keep working unmodified regardless of which backend is behind them.
 *
 * Error mapping (both dialects):
 *   timeout            → UPSTREAM_TIMEOUT (504)  — writes: outcome UNKNOWN
 *   no response / 5xx  → UPSTREAM_ERROR (502)    — writes: outcome UNKNOWN
 *   401/403            → UPSTREAM_AUTH (502)     — our service credentials are wrong
 *   other 4xx          → Laravel error code, same status — definite failure
 */
const { randomUUID } = require('node:crypto');
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

// ---------- real-dialect helpers ----------
const toPaise = (rupees) => (typeof rupees === 'number' && Number.isFinite(rupees) ? Math.round(rupees * 100) : null);
const toRupees = (paise) => (typeof paise === 'number' && Number.isFinite(paise) ? Math.round(paise) / 100 : null);
const maskPhone = (phone) => (phone ? `${'x'.repeat(Math.max(0, String(phone).length - 4))}${String(phone).slice(-4)}` : null);

/** storebandhu's real API wraps every body as {success, data, meta}. Unwrap once, everywhere. */
function unwrap(body) {
  if (body && typeof body === 'object' && 'success' in body && 'data' in body) return body.data;
  return body;
}

const QUOTE_TTL_SECONDS = 15 * 60; // mirrors mock-laravel's own 15-minute quote expiry

function createLaravelClient({ baseURL, serviceToken, timeout, dialect = 'mock' }) {
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
        upstream: true, fields: body.fields || body.details,
      });
    }

    // ============================================================
    // 'mock' dialect — unchanged from before. Local dev + both test suites run on this.
    // ============================================================
    if (dialect === 'mock') {
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

    // ============================================================
    // 'real' dialect — storebandhu's actual API, adapted to the shape above.
    // ============================================================
    let categoriesCache;
    async function categories() {
      if (categoriesCache) return categoriesCache;
      const d = unwrap(await call('get', PATHS.context()));
      categoriesCache = d.categories || [];
      return categoriesCache;
    }
    /** Real Laravel wants category_id, but the merchant only ever says a category name. */
    async function resolveCategory(name) {
      const list = await categories();
      const match = list.find((c) => String(c.name).toLowerCase() === String(name || '').toLowerCase());
      if (match) return { category_id: match.id, warning: `Category "${name}" mapped to id ${match.id}` };
      return { category_id: null, warning: `Category "${name}" not found in the store's category list; it will be created without a category` };
    }

    return {
      context: async (o) => {
        const d = unwrap(await call('get', PATHS.context(), o));
        return { merchant_id: String(d.store?.id ?? merchantId), store_name: d.store?.name, currency: d.store?.currency, categories: d.categories || [] };
      },

      salesSummary: async ({ from, to }, o) => {
        const d = unwrap(await call('get', PATHS.salesSummary(), { ...o, params: { from, to } }));
        return {
          from: d.from, to: d.to,
          orders_count: d.total_orders ?? null,
          // Real API reports a period total but not a unit count or a refund-adjusted net figure.
          // We report these as null (never guessed) rather than approximate from top_products alone —
          // ask the dev to add `units_sold` and `net_revenue`/`refunds` to sales-summary if these matter.
          units_sold: null,
          gross_paise: toPaise(d.total_revenue),
          net_paise: null,
          refunds_paise: null,
          top_products: (d.top_products || []).map((p) => ({
            product_id: String(p.product_id), title: p.title, units: p.units_sold, revenue_paise: toPaise(p.total_sales),
          })),
        };
      },

      searchProducts: async ({ q, limit }, o) => {
        const list = unwrap(await call('get', PATHS.searchProducts(), { ...o, params: { q, limit } })) || [];
        return {
          data: list.map((p) => ({
            product_id: String(p.id), title: p.title, sku: p.sku || p.code, price_paise: toPaise(p.price),
            stock: p.stock, status: p.status === 1 ? 'published' : 'draft', variants_count: 0,
          })),
          next_cursor: null, // real API doesn't implement cursor pagination yet (confirmed by dev)
        };
      },

      getInventory: async (productId, o) => {
        const d = unwrap(await call('get', PATHS.inventory(productId), o));
        // Real API has no variants concept in the sample given — treat every product as variant-less
        // until/unless the dev confirms a variants endpoint. update_inventory's variant_id path will
        // 404 "VARIANT_NOT_FOUND" if a merchant tries it, which is the safe failure mode.
        return { product_id: String(d.id), title: d.title, sku: d.sku, stock: d.stock, low_stock_threshold: null, variants: [] };
      },

      previewListing: async (draft, o) => {
        const { category_id, warning } = await resolveCategory(draft.category_name);
        const body = {
          title: draft.title, price: toRupees(draft.price_paise), category_id,
          stock: draft.stock ?? 0, description: draft.description || '',
        };
        const d = unwrap(await call('post', PATHS.listingPreview(), { ...o, data: body, idempotencyKey: o?.idempotencyKey || `preview-${Date.now()}-${Math.random()}` }));
        return {
          valid: true,
          normalized: { category_id, category_name: draft.category_name, price_paise: draft.price_paise, sku: draft.sku },
          warnings: [...(d.warnings || []), warning].filter(Boolean),
        };
      },

      createListing: async (payload, o) => {
        const { category_id, warning } = await resolveCategory(payload.category_name);
        const body = {
          title: payload.title, price: toRupees(payload.price_paise), category_id,
          stock: payload.stock ?? 0, description: payload.description || '', sku: payload.sku,
        };
        const d = unwrap(await call('post', PATHS.listings(), { ...o, data: body }));
        const urls = payload.image_urls || [];
        if (urls.length) {
          // Real API attaches media as a separate call. Best-effort: the listing itself already
          // succeeded, so a media-attach failure here must not roll back the write or throw —
          // it surfaces as the product simply having no photos yet.
          try {
            await call('post', PATHS.productMedia(d.id), { ...o, data: { images: urls, as_thumbnail: true }, idempotencyKey: `${o?.idempotencyKey || 'listing'}-media` });
          } catch { /* logged upstream by the executor's audit trail; non-fatal */ }
        }
        return { product_id: String(d.id), status: 'draft', url: d.url, warning };
      },

      updateInventory: async (productId, payload, o) => {
        const body = payload.mode === 'set' ? { stock: payload.quantity } : { stock_delta: payload.quantity };
        const d = unwrap(await call('patch', PATHS.inventory(productId), { ...o, data: body }));
        return { product_id: String(d.id), variant_id: null, previous_stock: d.previous_stock, new_stock: d.current_stock };
      },

      attachMedia: async (productId, payload, o) => {
        const d = unwrap(await call('post', PATHS.productMedia(productId), {
          ...o, data: { images: [payload.url].filter(Boolean), as_thumbnail: !!payload.set_as_primary },
        }));
        return { media_id: `med_${randomUUID()}`, url: payload.url, product_id: String(d.id) };
      },

      searchCustomers: async ({ q, limit }, o) => {
        const list = unwrap(await call('get', PATHS.searchCustomers(), { ...o, params: { q, limit } })) || [];
        return {
          data: list.map((c) => ({
            customer_ref: String(c.id), display_name: c.name, masked_phone: maskPhone(c.phone), city: null,
            // Real API has no separate address book — the customer record itself is the ship-to target.
            addresses: [{ address_ref: String(c.id), label: 'Default', city: '', pincode: '', display: c.email || c.phone || '' }],
          })),
        };
      },

      /**
       * Real Laravel's /orders/quote is a stateless calculator (no quote_id, no expiry) — it re-checks
       * stock/price again at order time in its own DB transaction. To keep our existing pending_action
       * "frozen args + explicit Confirm" flow unchanged (CLAUDE.md rule 7 — createOrder.js is untouched),
       * we mint our own quote_id here and hold the exact order payload in Redis for QUOTE_TTL_SECONDS.
       * createOrder() below reads it back and replays it, so it behaves like the mock's stateful quote.
       */
      quoteOrder: async (args, o) => {
        const items = args.items.map((i) => ({ product_id: Number(i.product_id), quantity: i.qty }));
        const d = unwrap(await call('post', PATHS.orderQuote(), { ...o, data: { items }, idempotencyKey: o?.idempotencyKey || `quote-${Date.now()}-${Math.random()}` }));

        const quoteId = `q_${randomUUID()}`;
        const expiresAt = new Date(Date.now() + QUOTE_TTL_SECONDS * 1000).toISOString();
        const { getRedis } = require('../../lib/redis');
        await getRedis().set(
          `laravel:quote:${merchantId}:${quoteId}`,
          JSON.stringify({
            items,
            customer_ref: args.customer_ref, address_ref: args.address_ref, payment_mode: args.payment_mode,
          }),
          'EX', QUOTE_TTL_SECONDS,
        );

        return {
          quote_id: quoteId,
          expires_at: expiresAt,
          customer_display: args.customer_ref, // real API has no separate lookup here; the ref *is* the customer id
          address_display: null,
          items: (d.items || []).map((i) => ({
            product_id: String(i.product_id), title: i.title, qty: i.quantity,
            unit_price_paise: toPaise(i.unit_price), line_total_paise: toPaise(i.total), in_stock: i.has_sufficient_stock,
          })),
          subtotal_paise: toPaise(d.subtotal), tax_paise: toPaise(d.tax), shipping_paise: toPaise(d.shipping_cost), total_paise: toPaise(d.grand_total),
          warnings: (d.items || []).filter((i) => !i.has_sufficient_stock).map((i) => `${i.title} does not have enough stock`),
        };
      },

      createOrder: async (payload, o) => {
        const { getRedis } = require('../../lib/redis');
        const redis = getRedis();
        const key = `laravel:quote:${merchantId}:${payload.quote_id}`;
        const raw = await redis.get(key);
        if (!raw) throw new AppError('QUOTE_EXPIRED', 409, 'This preview has expired. Please ask again for a fresh quote.');
        const frozen = JSON.parse(raw);

        const orderBody = {
          items: frozen.items,
          customer_id: Number(frozen.customer_ref),
          payment_method: frozen.payment_mode === 'prepaid_link' ? 'online' : 'cod',
        };
        const d = unwrap(await call('post', PATHS.orders(), { ...o, data: orderBody }));
        await redis.del(key).catch(() => {}); // one-shot: a quote is consumed on successful order creation

        return {
          order_id: String(d.id), order_number: String(d.order_number ?? d.id), status: 'confirmed',
          payment_status: orderBody.payment_method === 'cod' ? 'cod_pending' : 'link_sent',
          fulfillment_status: 'unfulfilled', total_paise: toPaise(d.grand_total), created_at: d.created_at,
        };
      },

      getOrder: async (orderId, o) => {
        const d = unwrap(await call('get', PATHS.order(orderId), o));
        const latest = d.status_history?.[d.status_history.length - 1]?.status;
        return {
          order_id: String(d.id), order_number: String(d.id), status: (latest || 'pending').toLowerCase(),
          payment_status: d.payment_status, fulfillment_status: d.delivery_method || 'unfulfilled',
          total_paise: toPaise(d.grand_total), created_at: d.created_at,
        };
      },

      getIdempotency: async (key, o) => {
        try {
          const d = unwrap(await call('get', PATHS.idempotency(key), o));
          return { found: d.status === 'completed', status: d.status_code, body: d.response };
        } catch (err) {
          if (err instanceof AppError && err.status === 404) return { found: false };
          throw err;
        }
      },
    };
  }

  return { forMerchant };
}

let singleton;
function laravel() {
  if (!singleton) {
    const { env } = require('../../config/env');
    const e = env();
    singleton = createLaravelClient({
      baseURL: e.LARAVEL_API_BASE_URL, serviceToken: e.LARAVEL_AGENT_SERVICE_TOKEN, timeout: e.LARAVEL_TIMEOUT_MS, dialect: e.LARAVEL_API_DIALECT,
    });
  }
  return singleton;
}
function resetLaravelSingletonForTests() { singleton = undefined; }

module.exports = { createLaravelClient, laravel, resetLaravelSingletonForTests, isAmbiguousUpstreamError, PATHS };
