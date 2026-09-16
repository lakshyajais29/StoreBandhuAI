# Implementation status (against TASKS.md)

Legend: ✅ implemented and verified in the build workspace · 🟡 implemented, verified only partially here · 🔌 stub / needs real credentials · ⛔ owner decision still open

## Verified in the build workspace
- ✅ P0 config: zod env validation with production guards; token/policy/plan config files
- ✅ P1 agent core: GLM provider adapter (OpenAI-compatible), fake/scripted providers, loop with iteration/tool/time caps, history pairing, prompt versioning, sanitised tool output
- ✅ P1 tools: 11 tools, JSON schemas generated from zod, plan/flag gating, executor never throws, identity keys stripped, PII placeholders unmasked only at execution
- ✅ Laravel client: GET-only retries, mandatory Idempotency-Key on writes, ambiguous vs definite error mapping
- ✅ All 11 tools exercised over real HTTP against `mock-laravel` (search, preview+create listing with idempotent replay, idempotency lookup, customers, quote+order, inventory, sales)
- ✅ Auth: Laravel-minted JWT (HS256 or RS256), no merchant id in URLs, admin secret
- ✅ Razorpay: raw-body webhook signature, checkout signature
- ✅ Redis media limits (atomic Lua) and chat rate limiting
- ✅ Widget builds (TypeScript clean) to one 75 KB-gzip script
- ✅ Unit tests: 50 pass (`npm test`) · lint clean

## Written but NOT executed here (MongoDB could not be downloaded in the build sandbox)
- 🟡 Wallet service (reserve/commit/release/credit/expire/reconcile) and its concurrency tests
- 🟡 Pending actions confirm/cancel/expire/reconcile-unknown flows
- 🟡 Billing credit path + webhook de-duplication
- 🟡 Media job processor, maintenance schedules, chat turn persistence
- 🟡 `test/integration/*` (10 tests) — they skip without Mongo; CI is configured to fail if they skip
→ **First thing to do:** `docker compose up -d mongo redis && npm run test:integration` and fix anything that fails.

## Stubs / needs real accounts
- 🔌 fal.ai gateway: model IDs, input fields and output shapes must be checked per model page before live use
- 🔌 GLM base URL/model name: confirm against current Z.ai docs; run `npm run evals` and tune `src/llm/prompts/system.md`
- 🔌 "has person" image classifier (P4-04) returns unknown → routed by `VIDEO_UNKNOWN_PERSON_ROUTE`
- 🔌 EXIF stripping of uploads (P3-01) is a TODO
- 🔌 Real Laravel endpoints — `mock-laravel/server.js` is the executable version of `03-LARAVEL-API-CONTRACT.md` for the Laravel developer
- 🔌 Observability (Sentry/metrics dashboards, alerts) — logs are structured and contain `ALERT:` markers to hook into

## ⛔ Owner decisions still open (code has safe defaults, all configurable)
1. **ADR-005 auth handshake** with the Laravel dev (JWT claims, key type, rotation). Default: HS256 shared secret, `sub`=user, `mid`=merchant, 15-min expiry.
2. **ADR-006 PII / data residency**: customer phone/email are masked to placeholders before reaching the LLM; names/cities are not. Confirm this is acceptable for a non-Indian LLM host.
3. **ADR-009 token economics**: prices and pack sizes in `src/config/plans.js` are placeholders; chat turn = 1 token; plan tokens expire at period end; cache hits are free; refunds alert instead of auto-clawback.
