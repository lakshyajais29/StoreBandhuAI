# 03 — Laravel ⇄ Agent API Contract (v1 draft)

**Audience:** the Laravel developer and the Node developer. Agree on this, then freeze it as an OpenAPI file (`docs/laravel-agent.openapi.yaml`) and build a mock server from it so both sides can work in parallel.

## Conventions

- Base: `{LARAVEL_API_BASE_URL}/api/v1/agent`
- Auth (ADR-005): `Authorization: Bearer {AGENT_SERVICE_TOKEN}`, `X-Merchant-Id`, `X-Acting-User-Id`, `X-Request-Id`.
- Laravel **must** scope every query to `X-Merchant-Id` and verify the acting user belongs to that merchant.
- All writes require `Idempotency-Key` (≤ 64 chars). Same key + same body within 24 h → return the original response (status + body). Same key + different body → `409 IDEMPOTENCY_CONFLICT`.
- Money in **paise** (integers). Dates ISO-8601 with timezone; merchant timezone returned in `/context`.
- Errors: `{ "error": { "code": "PRODUCT_NOT_FOUND", "message": "...", "fields": { "price": ["must be > 0"] } } }`.
- Status codes: 200/201 success, 401/403 auth, 404 not found, 409 conflict, 422 validation, 429 rate limit, 5xx server.
- Pagination: `?cursor=&limit=` → `{ data: [], next_cursor }`.
- Target latency p95 < 800 ms for reads.

## Endpoints

### 0. Session & context
| Method | Path | Notes |
|---|---|---|
| POST | `/session` | **Called from dashboard (user's Laravel session), not Node.** Returns `{ token (JWT), expires_at }` per ADR-005. |
| GET | `/context` | `{ merchant_id, store_name, currency: "INR", timezone, locale, categories: [{id,name}], limits: {...} }` — cached 10 min by Node. |

### 1. Reads (Phase 1)
**GET `/sales-summary?from=2026-09-08&to=2026-09-14`**
```json
{ "from":"2026-09-08","to":"2026-09-14","currency":"INR",
  "orders_count":42,"units_sold":97,"gross_paise":5423000,"net_paise":4980000,
  "refunds_paise":120000,
  "top_products":[{"product_id":"123","title":"Blue Cotton Shirt","units":20,"revenue_paise":1000000}] }
```
**GET `/products/search?q=blue shirt&limit=5`** → `{ data:[{product_id,title,sku,price_paise,stock,variants_count,status,thumbnail_url}] }`

**GET `/inventory/{product_id}`** → `{ product_id, title, sku, stock, low_stock_threshold, variants:[{variant_id,title,sku,stock}] }`

### 2. Listings & inventory (Phase 2)
**POST `/listings/preview`** (no side effects; validates + normalises)
Body: `{ title, description, price_paise, category_id | category_name, image_asset_urls[], sku?, stock? }`
→ `{ valid:true, normalized:{...}, warnings:["category 'Apparel' mapped to id 7"] }` or 422.

**POST `/listings`** (Idempotency-Key) → `201 { product_id, status:"draft"|"published", url }`
Decide: created as **draft** by default? (recommended for v1)

**PATCH `/inventory/{product_id}`** (Idempotency-Key)
Body: `{ variant_id?, mode:"set"|"adjust", quantity:int, reason:"agent" }`
→ `{ product_id, variant_id, previous_stock, new_stock }`; 409 if adjust would go negative.

### 3. Media (Phase 3)
**POST `/products/{product_id}/media`** (Idempotency-Key)
Body: `{ url, kind:"image"|"video", alt?, set_as_primary?:false, source:"bandhu_ai" }`
→ `201 { media_id, url }`. Laravel downloads/validates from our CDN domain allowlist only.

### 4. Customers & orders (Phase 5)
**GET `/customers/search?q=`** → `{ data:[{customer_ref, display_name, masked_phone:"98xxxxxx21", city, addresses:[{address_ref, label, city, pincode}]}] }`
(ADR-006: return refs + masked data; full PII not needed by the agent.)

**POST `/orders/quote`** (no side effects)
Body: `{ customer_ref, address_ref, items:[{product_id, variant_id?, qty}], payment_mode:"cod"|"prepaid_link" }`
→ `{ quote_id, expires_at, items:[{title, qty, unit_price_paise, line_total_paise, in_stock:true}], subtotal_paise, tax_paise, shipping_paise, total_paise, address_display:"Indiranagar, Bengaluru 560038", warnings:[] }`

**POST `/orders`** (Idempotency-Key)
Body: `{ quote_id }` ← order is created **from the quote**, so the preview the merchant confirmed is exactly what is placed.
→ `201 { order_id, order_number, status, total_paise }`; `409 QUOTE_EXPIRED | PRICE_CHANGED | OUT_OF_STOCK`.

**GET `/orders/{order_id}`** → `{ order_id, order_number, status, payment_status, fulfillment_status, total_paise, created_at }`

**GET `/idempotency/{key}`** → `{ found:true, status:201, body:{...} }` or `{found:false}` — used by Node's reconcile job to settle `unknown` outcomes.

## Open questions for Laravel dev (answer before Phase 1)

1. Service-token vs per-merchant Sanctum (ADR-005)?
2. Multi-store merchants: is `merchant_id` = store? Staff users with limited roles — which roles may use the agent/which tools?
3. Product variants: required in v1?
4. Do listings go live immediately or as drafts?
5. What order payment modes can a merchant create on behalf of a customer (COD only?)
6. Existing rate limits on API?
7. Staging environment + seeded test merchant for integration tests?
