'use strict';
/**
 * Mock of the Laravel /api/v1/agent/* contract (docs/03-LARAVEL-API-CONTRACT.md).
 * For local development, integration tests and the widget demo. NOT for production.
 *
 * Extras:
 *   POST /api/v1/agent/session   → mints a merchant JWT (in real life: Laravel, using the dashboard login)
 *   GET  /demo                   → serves the widget demo page (after `npm run build` in widget/)
 *   ?__simulate=timeout|500      → failure injection on any route
 */
require('dotenv').config({ quiet: true });
const path = require('node:path');
const express = require('express');
const { SignJWT } = require('jose');

const PORT = Number(process.env.MOCK_LARAVEL_PORT || 8000);
const SERVICE_TOKEN = process.env.LARAVEL_AGENT_SERVICE_TOKEN || 'dev-service-token';
const SECRET = new TextEncoder().encode(process.env.SESSION_JWT_SECRET || 'dev-session-secret-please-change-0123456789');

const db = {
  products: new Map([
    ['101', { product_id: '101', title: 'Blue Cotton Shirt', sku: 'SH-BLU-01', price_paise: 49900, stock: 42, low_stock_threshold: 5, status: 'published', variants: [
      { variant_id: '101-M', title: 'M', stock: 20 }, { variant_id: '101-L', title: 'L', stock: 22 }] }],
    ['102', { product_id: '102', title: 'Blue Denim Jeans', sku: 'JN-BLU-02', price_paise: 129900, stock: 8, low_stock_threshold: 5, status: 'published', variants: [] }],
    ['103', { product_id: '103', title: 'Handloom Cotton Saree', sku: 'SR-HL-03', price_paise: 249900, stock: 0, low_stock_threshold: 2, status: 'published', variants: [] }],
    ['104', { product_id: '104', title: 'Brass Diya Set (4)', sku: 'DY-BR-04', price_paise: 79900, stock: 130, low_stock_threshold: 10, status: 'published', variants: [] }],
  ]),
  customers: [
    { customer_ref: 'cust_r1', display_name: 'Priya Sharma', phone: '9876543210', masked_phone: '98xxxxxx10', city: 'Bengaluru',
      addresses: [{ address_ref: 'addr_r1a', label: 'Home', city: 'Bengaluru', pincode: '560038', display: 'Indiranagar, Bengaluru 560038' }] },
    { customer_ref: 'cust_r2', display_name: 'Rahul Verma', phone: '9123456780', masked_phone: '91xxxxxx80', city: 'Jaipur',
      addresses: [{ address_ref: 'addr_r2a', label: 'Office', city: 'Jaipur', pincode: '302001', display: 'MI Road, Jaipur 302001' }] },
  ],
  categories: [{ id: 7, name: 'Apparel' }, { id: 8, name: 'Home Decor' }, { id: 9, name: 'Sarees' }],
  quotes: new Map(),
  orders: new Map(),
  media: [],
  idempotency: new Map(), // key -> { hash, status, body }
  nextProduct: 200,
  nextOrder: 5000,
};

const app = express();
app.use(express.json());

app.use((req, res, next) => {
  const sim = req.query.__simulate;
  if (sim === 'timeout') return setTimeout(() => res.status(504).end(), 30000);
  if (sim === '500') return res.status(500).json({ error: { code: 'SERVER_ERROR', message: 'simulated' } });
  return next();
});

// Session minting (browser → Laravel). Real Laravel uses the logged-in dashboard session.
app.post('/api/v1/agent/session', async (req, res) => {
  const merchantId = String(req.body?.merchant_id || 'm_demo');
  const userId = String(req.body?.user_id || 'u_demo');
  const token = await new SignJWT({ mid: merchantId, scopes: ['agent'] })
    .setProtectedHeader({ alg: 'HS256' }).setSubject(userId).setIssuer(process.env.SESSION_JWT_ISSUER || 'storebandhu-laravel')
    .setAudience(process.env.SESSION_JWT_AUDIENCE || 'bandhu-agent').setIssuedAt().setExpirationTime('15m').setJti(String(Date.now()))
    .sign(SECRET);
  res.set('Access-Control-Allow-Origin', '*');
  res.json({ token, expires_at: new Date(Date.now() + 15 * 60000).toISOString() });
});
app.options('/api/v1/agent/session', (req, res) => {
  res.set({ 'Access-Control-Allow-Origin': '*', 'Access-Control-Allow-Headers': 'Content-Type', 'Access-Control-Allow-Methods': 'POST' }).end();
});

app.use('/demo', express.static(path.join(__dirname, '..', 'widget', 'demo')));
app.use('/demo/dist', express.static(path.join(__dirname, '..', 'widget', 'dist')));

// Service auth for everything else under /api/v1/agent
const agent = express.Router();
agent.use((req, res, next) => {
  if (req.get('authorization') !== `Bearer ${SERVICE_TOKEN}`) return res.status(401).json({ error: { code: 'UNAUTHORIZED', message: 'bad service token' } });
  if (!req.get('x-merchant-id')) return res.status(403).json({ error: { code: 'MERCHANT_REQUIRED', message: 'X-Merchant-Id missing' } });
  return next();
});

// Idempotency for writes
agent.use((req, res, next) => {
  if (req.method === 'GET') return next();
  const key = req.get('idempotency-key');
  if (!key) return res.status(400).json({ error: { code: 'IDEMPOTENCY_KEY_REQUIRED', message: 'Idempotency-Key header required' } });
  const scoped = `${req.get('x-merchant-id')}:${key}`;
  const hash = JSON.stringify([req.method, req.path, req.body]);
  const prior = db.idempotency.get(scoped);
  if (prior) {
    if (prior.hash !== hash) return res.status(409).json({ error: { code: 'IDEMPOTENCY_CONFLICT', message: 'Key reused with different body' } });
    return res.status(prior.status).json(prior.body);
  }
  const json = res.json.bind(res);
  res.json = (body) => {
    if (!req.path.endsWith('/preview') && !req.path.endsWith('/quote')) db.idempotency.set(scoped, { hash, status: res.statusCode, body });
    return json(body);
  };
  return next();
});

const err = (res, status, code, message, fields) => res.status(status).json({ error: { code, message, fields } });

agent.get('/context', (req, res) => res.json({
  merchant_id: req.get('x-merchant-id'), store_name: 'Demo Fashion Store', currency: 'INR', timezone: 'Asia/Kolkata', locale: 'en-IN', categories: db.categories,
}));

agent.get('/sales-summary', (req, res) => {
  const { from, to } = req.query;
  if (!from || !to) return err(res, 422, 'VALIDATION_FAILED', 'from and to required');
  const days = Math.max(1, Math.round((new Date(to) - new Date(from)) / 86400000) + 1);
  return res.json({
    from, to, currency: 'INR', orders_count: 6 * days, units_sold: 14 * days, gross_paise: 823000 * days, net_paise: 771000 * days, refunds_paise: 12000 * days,
    top_products: [
      { product_id: '101', title: 'Blue Cotton Shirt', units: 5 * days, revenue_paise: 249500 * days },
      { product_id: '104', title: 'Brass Diya Set (4)', units: 4 * days, revenue_paise: 319600 * days },
    ],
  });
});

agent.get('/products/search', (req, res) => {
  const q = String(req.query.q || '').toLowerCase();
  const words = q.split(/\s+/).filter(Boolean);
  const data = [...db.products.values()]
    .filter((p) => words.every((w) => `${p.title} ${p.sku}`.toLowerCase().includes(w)))
    .slice(0, Number(req.query.limit) || 5)
    .map((p) => ({ product_id: p.product_id, title: p.title, sku: p.sku, price_paise: p.price_paise, stock: p.stock, variants_count: p.variants.length, status: p.status }));
  res.json({ data, next_cursor: null });
});

agent.get('/inventory/:id', (req, res) => {
  const p = db.products.get(req.params.id);
  if (!p) return err(res, 404, 'PRODUCT_NOT_FOUND', 'Product not found');
  return res.json({ product_id: p.product_id, title: p.title, sku: p.sku, stock: p.stock, low_stock_threshold: p.low_stock_threshold, variants: p.variants });
});

agent.patch('/inventory/:id', (req, res) => {
  const p = db.products.get(req.params.id);
  if (!p) return err(res, 404, 'PRODUCT_NOT_FOUND', 'Product not found');
  const { mode, quantity, variant_id: variantId } = req.body || {};
  if (!['set', 'adjust'].includes(mode) || !Number.isInteger(quantity)) return err(res, 422, 'VALIDATION_FAILED', 'mode and integer quantity required');
  const target = variantId ? p.variants.find((v) => v.variant_id === variantId) : p;
  if (!target) return err(res, 404, 'VARIANT_NOT_FOUND', 'Variant not found');
  const previous = target.stock;
  const next = mode === 'set' ? quantity : previous + quantity;
  if (next < 0) return err(res, 409, 'NEGATIVE_STOCK', 'Stock would go negative');
  target.stock = next;
  if (variantId) p.stock = p.variants.reduce((s, v) => s + v.stock, 0);
  return res.json({ product_id: p.product_id, variant_id: variantId || null, previous_stock: previous, new_stock: next });
});

function normalizeListing(body) {
  const fields = {};
  if (!body.title || body.title.length < 3) fields.title = ['must be at least 3 characters'];
  if (!Number.isInteger(body.price_paise) || body.price_paise <= 0) fields.price_paise = ['must be > 0'];
  const cat = db.categories.find((c) => c.name.toLowerCase() === String(body.category_name || '').toLowerCase());
  const warnings = [];
  if (!cat) warnings.push(`Category "${body.category_name}" not found; it will be created`);
  else warnings.push(`Category "${body.category_name}" mapped to id ${cat.id}`);
  return { fields, warnings, normalized: { ...body, category_id: cat?.id ?? null, category_name: cat?.name ?? body.category_name } };
}

agent.post('/listings/preview', (req, res) => {
  const n = normalizeListing(req.body || {});
  if (Object.keys(n.fields).length) return err(res, 422, 'VALIDATION_FAILED', 'Invalid listing', n.fields);
  return res.json({ valid: true, normalized: n.normalized, warnings: n.warnings });
});

agent.post('/listings', (req, res) => {
  const n = normalizeListing(req.body || {});
  if (Object.keys(n.fields).length) return err(res, 422, 'VALIDATION_FAILED', 'Invalid listing', n.fields);
  const id = String((db.nextProduct += 1));
  db.products.set(id, { product_id: id, title: req.body.title, sku: req.body.sku || `SKU-${id}`, price_paise: req.body.price_paise, stock: req.body.stock ?? 0, low_stock_threshold: 5, status: 'draft', variants: [] });
  return res.status(201).json({ product_id: id, status: 'draft', url: `https://demo.storebandhu.com/p/${id}` });
});

agent.post('/products/:id/media', (req, res) => {
  if (!db.products.has(req.params.id)) return err(res, 404, 'PRODUCT_NOT_FOUND', 'Product not found');
  const m = { media_id: `med_${db.media.length + 1}`, url: req.body.url, product_id: req.params.id };
  db.media.push(m);
  return res.status(201).json(m);
});

agent.get('/customers/search', (req, res) => {
  const q = String(req.query.q || '').toLowerCase().replace(/\s/g, '');
  const data = db.customers.filter((c) => `${c.display_name}${c.city}${c.phone}`.toLowerCase().replace(/\s/g, '').includes(q))
    .map(({ phone: _phone, ...c }) => ({ ...c, addresses: c.addresses.map(({ display: _display, ...a }) => a) }));
  res.json({ data, next_cursor: null });
});

agent.post('/orders/quote', (req, res) => {
  const { customer_ref: cref, address_ref: aref, items = [], payment_mode: paymentMode } = req.body || {};
  const c = db.customers.find((x) => x.customer_ref === cref);
  const a = c?.addresses.find((x) => x.address_ref === aref);
  if (!c || !a) return err(res, 422, 'CUSTOMER_OR_ADDRESS_NOT_FOUND', 'Unknown customer or address');
  const lines = [];
  for (const it of items) {
    const p = db.products.get(String(it.product_id));
    if (!p) return err(res, 422, 'PRODUCT_NOT_FOUND', `Product ${it.product_id} not found`);
    lines.push({ product_id: p.product_id, title: p.title, qty: it.qty, unit_price_paise: p.price_paise, line_total_paise: p.price_paise * it.qty, in_stock: p.stock >= it.qty });
  }
  const subtotal = lines.reduce((s, l) => s + l.line_total_paise, 0);
  const tax = Math.round(subtotal * 0.05);
  const shipping = subtotal >= 99900 ? 0 : 4900;
  const quoteId = `q_${Date.now()}_${Math.floor(Math.random() * 1000)}`;
  const quote = {
    quote_id: quoteId, expires_at: new Date(Date.now() + 15 * 60000).toISOString(), customer_display: c.display_name, address_display: a.display,
    items: lines, subtotal_paise: subtotal, tax_paise: tax, shipping_paise: shipping, total_paise: subtotal + tax + shipping, payment_mode: paymentMode,
    warnings: lines.filter((l) => !l.in_stock).map((l) => `${l.title} does not have enough stock`),
  };
  db.quotes.set(quoteId, { ...quote, merchant: req.get('x-merchant-id') });
  return res.json(quote);
});

agent.post('/orders', (req, res) => {
  const q = db.quotes.get(req.body?.quote_id);
  if (!q || q.merchant !== req.get('x-merchant-id')) return err(res, 404, 'QUOTE_NOT_FOUND', 'Quote not found');
  if (new Date(q.expires_at) < new Date()) return err(res, 409, 'QUOTE_EXPIRED', 'Quote expired');
  if (q.items.some((l) => !l.in_stock)) return err(res, 409, 'OUT_OF_STOCK', 'Some items are out of stock');
  const id = String((db.nextOrder += 1));
  const order = { order_id: id, order_number: `SB-${id}`, status: 'confirmed', payment_status: q.payment_mode === 'cod' ? 'cod_pending' : 'link_sent', fulfillment_status: 'unfulfilled', total_paise: q.total_paise, created_at: new Date().toISOString() };
  db.orders.set(id, order);
  for (const l of q.items) db.products.get(l.product_id).stock -= l.qty;
  db.quotes.delete(q.quote_id);
  return res.status(201).json(order);
});

agent.get('/orders/:id', (req, res) => {
  const o = db.orders.get(req.params.id) || [...db.orders.values()].find((x) => x.order_number === req.params.id);
  if (!o) return err(res, 404, 'ORDER_NOT_FOUND', 'Order not found');
  return res.json(o);
});

agent.get('/idempotency/:key', (req, res) => {
  const hit = db.idempotency.get(`${req.get('x-merchant-id')}:${req.params.key}`);
  res.json(hit ? { found: true, status: hit.status, body: hit.body } : { found: false });
});

app.use('/api/v1/agent', agent);

if (require.main === module) {
  app.listen(PORT, () => console.log(`mock-laravel listening on :${PORT}  (demo: http://localhost:${PORT}/demo)`)); // eslint-disable-line no-console
}
module.exports = { app, db };
