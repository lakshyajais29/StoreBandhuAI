# 01 — Architecture Decision Records (lock these before coding)

Each ADR has a **recommended** choice. Items marked ⛔ are **blockers**: do not start the phase that depends on them until the business/owner signs off.

| ADR | Topic | Status | Blocks |
|---|---|---|---|
| 001 | Service boundaries & source of truth | Recommended | All |
| 002 | LLM: GLM-4.7-Flash only, behind an adapter | Recommended | Phase 1 |
| 003 | Wallet in MongoDB with atomic reserve/commit | Recommended | Phase 2 |
| 004 | BullMQ in a separate worker process | Recommended | Phase 3 |
| 005 | Auth between widget ↔ Node ↔ Laravel | ⛔ Needs Laravel dev | Phase 1 |
| 006 | Data residency & PII | ⛔ Needs owner/legal | Phase 2 (orders: Phase 5) |
| 007 | Confirmation = server-side pending action | Recommended | Phase 2 |
| 008 | Chat widget tech & embedding | Recommended | Phase 1 |
| 009 | Token economics (expiry, trial, chat charge) | ⛔ Needs owner | Phase 2 / 5 |
| 010 | Media storage & gateway | Recommended | Phase 3 |

---

## ADR-001 — Service boundaries & source of truth

| Data | Owner | Store |
|---|---|---|
| Products, inventory, customers, orders, prices, tax, shipping | Laravel | MySQL |
| Merchant identity & store membership | Laravel | MySQL |
| Conversations, messages | Node agent | MongoDB |
| Wallet balance, ledger, reservations | Node agent | MongoDB |
| Plans/subscriptions, payments (Razorpay) | Node agent | MongoDB |
| Pending actions, tool-call audit logs, media jobs | Node agent | MongoDB |
| Generated media files | Node agent | S3/R2 (URL attached in Laravel) |

**Rules:** Node never connects to MySQL. Laravel never writes to MongoDB. Anything that affects money totals (prices, order totals) is computed by Laravel.

## ADR-002 — LLM

- Use **GLM-4.7-Flash** only, called through `src/llm/providers/glm.js` implementing a single `LLMProvider` interface: `chat({ messages, tools, toolChoice, timeoutMs, signal }) → { content, toolCalls, usage, raw }`.
- Normalise tool-call shape inside the provider; the agent loop must never see provider-specific JSON.
- Log `usage` per call (input/output tokens) to compute real cost/merchant later.
- The Claude Haiku fallback from HTML v3 is **not** implemented, but the adapter makes it a one-file addition. Add a circuit-breaker hook point (`onProviderError`) now, empty.
- Temperature `0`–`0.2` for tool calling. Pin the exact model string in env.
- **Verify with Z.ai:** input modality (text-only vs vision), rate limits of the free/cheap tier, data retention terms (feeds ADR-006).

## ADR-003 — Wallet

- Two collections: `wallets` (one doc per merchant: `available`, `reserved`, `version`) and `wallet_ledger` (append-only).
- Every movement = **one Mongo transaction**: conditional update on `wallets` (`available >= cost`) + insert into `wallet_ledger`. No "derived balance" reads for authorisation.
- Unit is integer tokens only (no floats).
- Mongo must run as a **replica set** (single-node locally) for transactions.
- Nightly reconciliation job: sum(ledger) must equal wallet balance; alert on mismatch.

## ADR-004 — Queues

- BullMQ + Redis, queues: `media-image`, `media-video`, `reconcile`, `webhooks-retry`.
- Worker runs as `node src/worker.js` (separate process/container).
- Per-merchant concurrency via atomic Redis counter (Lua `INCR` with cap + TTL safety) — do not rely on BullMQ Pro groups unless purchased.
- Redis `maxmemory-policy noeviction` (required by BullMQ).

## ADR-005 — Authentication ⛔

Recommended flow:
1. Merchant is logged into the Laravel dashboard. The Blade page calls a Laravel route `POST /api/v1/agent/session` which returns a **short-lived JWT (15 min)** signed with a key shared with (or public key known to) Node. Claims: `sub` (user id), `mid` (merchant/store id), `plan` (hint only), `scopes`, `exp`, `jti`.
2. Widget sends `Authorization: Bearer <jwt>` to Node. Node verifies with `jose`. Refresh by calling Laravel again.
3. Node → Laravel calls use a **service token** (`Authorization: Bearer <service token>`) plus `X-Merchant-Id` and `X-Acting-User-Id`. Laravel authorises that the service may act for that merchant and enforces merchant scoping on every query.
   - Alternative if Laravel insists on per-merchant Sanctum tokens: Node must store them encrypted at rest — more risk, not recommended.
4. Razorpay webhooks: signature verification only (no JWT).
5. Laravel → Node internal calls (if any, e.g. plan change): HMAC-signed requests.

Decide with the Laravel developer this week.

## ADR-006 — Data residency & PII ⛔

GLM's first-party API is served from China-based infrastructure. The assistant will see customer names, phone numbers, and addresses (orders). India's DPDP Act 2023 obligations apply to you as the data fiduciary. Options:
- **A (recommended for launch):** PII minimisation — Laravel/Node replace customer PII with opaque refs (`cust_ref_8f2`) before text reaches the LLM; the preview UI resolves them from Laravel. The model never needs a phone number to place an order.
- **B:** Use the open-weight GLM via a non-China host.
- **C:** Both.

Get a written decision + update your privacy policy/merchant terms before Phase 5 at the latest. (This is not legal advice — have counsel review.)

## ADR-007 — Confirmation

- A write tool that requires confirmation **does not execute**. The executor validates args, fetches a server-side quote/preview from Laravel if relevant, stores a `pending_action` `{ id, merchantId, conversationId, tool, args (frozen), argsHash, preview, tokenCost, status: 'awaiting_confirmation', expiresAt (+10 min) }`, reserves tokens, and returns the preview.
- The widget renders a card with **Confirm / Cancel** buttons → `POST /api/actions/:id/confirm` or `/cancel`.
- Confirm: atomic status transition `awaiting_confirmation → executing` (prevents double click), call Laravel with `Idempotency-Key = pending_action.id`, commit or release tokens, write result back into the conversation as a tool message so the LLM can summarise.
- Typing "yes" in chat → the agent replies "Please use the Confirm button on the preview" (or the UI shows it). The LLM has **no** `confirm_action` tool.
- Edits ("change price to 400") create a **new** pending action; the old one is cancelled.

Confirmation required: `create_product_listing` (always), `update_inventory` (when |delta| > 500 **or** setting to 0 **or** mode=set on >50 items), `create_order` (always). Thresholds live in config, not code.

## ADR-008 — Widget

- React + TypeScript + Vite, built as a **single embeddable bundle** mounted into a `<div id="bandhu-ai">` on the Blade dashboard, isolated with Shadow DOM or CSS-prefixed classes so dashboard styles don't collide.
- Streaming: start with request/response; add SSE streaming in Phase 7 if needed.
- Job updates: polling `GET /api/jobs/:id` every 3s with backoff; websocket later.

## ADR-009 — Token economics ⛔

Owner must decide and write down:
1. Do unused plan tokens **expire** monthly or **roll over** (cap?). Top-up tokens: expiry?
2. **Free trial** grant size; video excluded (HTML v3 recommends this).
3. **Chat query charge:** recommended — 1 token per user message that results in an LLM call, charged only if the LLM returns successfully; tool actions charge their own cost on top. Clarifying questions from the bot still cost 1 (or free — decide).
4. **Refund policy** for "success but merchant dislikes result" (image looked bad) — none / one free regenerate?
5. Token→₹ price points per plan, GST handling on invoices.
6. Plan tiers and which include video.

Recommended implementation: token **lots** (`grant`, `expiresAt`) consumed FIFO by earliest expiry — even if you choose "no expiry" now, the schema supports changing your mind without migration.

## ADR-010 — Media

- Gateway: pick **one** of fal.ai or Replicate for v1 (fal.ai is usually simpler for image/video queue APIs — verify current model availability & prices on the day). Wrap it in `src/media/gateway.js`; model IDs in config.
- Uploads: `POST /api/uploads` → presigned S3/R2 PUT URL → widget uploads directly → Node records `asset {id, merchantId, key, mime, size, sha256}`. Only `asset_id` enters the LLM conversation.
- Validate mime (jpeg/png/webp), max size (e.g. 10 MB), strip EXIF.
- Result files are downloaded from the gateway and **re-uploaded to our bucket**; Laravel receives our CDN URL.
- Cache key: `sha256(source asset) + model + style + params` → reuse result, charge 0 or reduced (decide under ADR-009).
