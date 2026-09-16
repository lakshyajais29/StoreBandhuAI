# 00 — Audit: Current State vs. Plan

> Reviewed: `bandhu-ai-architecture-v3.html`, `task.md`, `index.js`, `package.json`, `package-lock.json`, `test-harness.js`, `_env`.
> **Limitation:** `index.js` and `test-harness.js` import `./config`, `./config/db`, `./routes/*`, `./services/llm`, `./services/toolExecutor`, but those files were **not** in the upload. This audit judges them only by how they are wired and called. Re-run the audit checklist at the bottom once the full repo is available.

---

## 1. Verdict in one paragraph

The plan is good in spirit (read-only first, LLM never touches the DB, immutable ledger, refund on failure). But it has **contradictions between the two docs**, **several safety-critical designs deferred to "Phase 6" that must exist from day one** (atomic balance checks, loop caps, audit logs), **whole missing workstreams** (auth between the three systems, chat history, the React widget, file uploads, a written Laravel API contract, deployment), and the Gemini-generated code shows the service was scaffolded **all phases at once** (billing and wallet routes already mounted) without the foundations those phases need. It is a prototype skeleton, not a production system yet.

---

## 2. Contradictions between `architecture-v3.html` and `task.md`

| Topic | HTML v3 says | task.md says | Resolution (see `01-DECISIONS.md`) |
|---|---|---|---|
| Fallback LLM | Claude Haiku 4.5 circuit-breaker | No fallback | ADR-002 |
| Wallet storage | MySQL table inside Laravel | MongoDB owned by Node | ADR-003 (MongoDB) |
| Async jobs | Laravel Queues + Redis | BullMQ + Redis in Node | ADR-004 (BullMQ) |
| Who deducts tokens | "Laravel API executes the action, deducts tokens" (Fig. 3) | Node cost gate deducts | Node deducts (ADR-003) |
| Chat widget | Vue / Livewire | React | ADR-008 |
| Data residency / PII | Must decide **before Phase 2** | Not mentioned at all | ADR-006 — blocker |
| Token expiry / rollover, free trial | "Decide before build" | Not mentioned | ADR-009 — blocker |
| Order token cost | "Bulk/order action = 3" | Order creation = 3 | Keep 3, but see ADR-009 |

Fix the documents so there is **one source of truth**. `02-ARCHITECTURE.md` in this pack supersedes both for engineering purposes.

---

## 3. Design flaws in `task.md` (the phase plan)

### 3.1 Safety-critical — must change

1. **Race condition is designed in (Phase 2), fixed only in Phase 6.** "Check balance → execute → deduct after success" with a *derived* balance lets two concurrent requests both pass the check. Real money/stock is involved from Phase 2. → Atomic reserve-then-commit from the first write tool (see `02-ARCHITECTURE.md §5`).
2. **"Confirm" via a follow-up chat message is unsafe.** If the LLM interprets "confirm", it can (a) re-generate *different* parameters than the preview showed, (b) treat "yes but change price to 400" as confirmation, (c) be prompt-injected. → Server-side `pending_actions` with a frozen, hashed payload; confirmation is a **button → `POST /api/actions/:id/confirm`**, never routed through the LLM.
3. **No idempotency to Laravel.** If `POST /orders` times out but actually succeeded, the plan says "refund", and a retry creates a **duplicate order**. → Every write carries an `Idempotency-Key`; ambiguous outcomes go to an `unknown` state and are reconciled, not auto-refunded.
4. **Loop cap, timeouts, and audit logging are in Phase 6.** A runaway loop or an undisputable token deduction in Phase 1–5 is exactly what these prevent. → Move to Phase 1.
5. **Order totals previewed by the LLM.** Prices/totals must come from Laravel (a quote endpoint), never computed or echoed by the model.
6. **`merchant_id` provenance is undefined.** Nothing says how the Node service knows *who* is calling. `GET /wallet/:merchant_id` as written is an IDOR — any logged-in user can read any wallet by changing the URL. → Signed session token from Laravel; merchant ID is **never** taken from URL params or LLM tool args.
7. **Razorpay webhook will fail signature verification** with the current wiring (see §4.1).

### 3.2 Functional gaps

8. **`has_person` "set by the model based on the image"** — GLM-4.7-Flash is (as far as the docs show) a *text* model; it cannot see the image. It would guess. → Use a cheap vision classification call on the gateway, or let the merchant pick, default to Kling when unknown. Verify GLM modality with Z.ai before deciding.
9. **`create_order(customer_id, …)`** — merchants don't know customer IDs. Needs `search_customers` / `search_products` read tools and disambiguation ("I found 3 'Blue Shirts' — which one?").
10. **`check_inventory(product_id_or_name)`** — Laravel needs a *search* endpoint that can return multiple matches.
11. **`update_inventory(product_id, quantity)`** — is `quantity` absolute or a delta? The confirm rule says "delta > 500". Define `mode: "set" | "adjust"` explicitly.
12. **Media URLs from fal.ai/Replicate expire.** Results must be copied to our own storage (S3/R2) before attaching to Laravel.
13. **Raw photo upload path is missing.** The widget needs a presigned-upload endpoint; the LLM should receive an internal `asset_id`, not arbitrary URLs (SSRF risk).
14. **Chat/conversation persistence is mentioned in the context but no phase builds it.**
15. **Per-merchant concurrency "in the queue layer":** BullMQ's group/per-key concurrency is a paid (Pro) feature. Implement with an atomic Redis/Mongo counter instead, or budget for BullMQ Pro.
16. **Plan tier source of truth is vague** ("wallet/profile record"). Plans are bought via Razorpay in Node → Node owns `subscriptions`.
17. **No frontend phase at all.** Confirmation cards, job progress, balance, top-up checkout, low-balance states — all undesigned.
18. **No Laravel API contract document.** "I'll confirm field names later" guarantees integration churn. See `03-LARAVEL-API-CONTRACT.md`.
19. **No deployment, environments, CI, observability, backups, or incident plan.**
20. **Chat query = 1 token — when?** Charged per user turn? Refunded if the LLM errors? Undefined.

---

## 4. Code review of the uploaded files

### 4.1 `index.js`

| # | Severity | Issue | Fix |
|---|---|---|---|
| 1 | 🔴 Critical | `express.json()` runs globally **before** `/api/billing`. Razorpay webhook signatures are computed over the **raw bytes**; once parsed and re-stringified, verification fails (or someone "fixes" it by skipping verification). | Mount the webhook route with `express.raw({ type: 'application/json' })` **before** `express.json()`. |
| 2 | 🔴 Critical | No authentication middleware on any route. `/api/wallet` and `/api/chat` are open. | `requireMerchantSession` middleware (JWT from Laravel), `requireServiceAuth` for internal routes. |
| 3 | 🔴 Critical | Phases 1–5 routes all mounted at once (`wallet`, `billing`) — phases were not built/verified sequentially. | Feature-flag unfinished routes; ship per phase. |
| 4 | 🟠 High | `connectDB()` not awaited — server accepts traffic before Mongo is ready; a failed connection may leave a zombie server. | `await connectDB()` then `listen`; exit non-zero on failure. |
| 5 | 🟠 High | `cors()` allows every origin. | Allowlist `https://storebandhu.com` (+ staging). |
| 6 | 🟠 High | No central error handler; Express 5 forwards async errors, but nothing formats them, so stack traces/HTML error pages may leak. | `errorHandler` middleware with typed `AppError`s. |
| 7 | 🟠 High | No request size limit, `helmet`, or rate limiting. `express.json()` default is fine but chat should be capped. | `helmet()`, `express.json({ limit: '100kb' })`, per-merchant rate limit. |
| 8 | 🟡 Medium | No graceful shutdown (SIGTERM) — in-flight tool calls and BullMQ workers get killed mid-write. | Close server → drain → close Mongo/Redis. |
| 9 | 🟡 Medium | No job-status route and no separate worker entrypoint; BullMQ processors must not run inside the API process in production. | `src/server.js` + `src/worker.js`. |
| 10 | 🟡 Medium | `/health` is liveness only (presumably). | Add `/ready` that checks Mongo + Redis. |
| 11 | 🟡 Medium | No request ID / structured logging. | `pino-http` with `x-request-id`. |

### 4.2 `package.json`

- No `start`, `worker`, `test`, `lint` scripts; `dev` is just `node index.js` (no reload — use `node --watch`).
- No `engines` field → Node version drift between laptops and servers. Pin (e.g. `"node": ">=22"`).
- Missing production essentials: schema validation (`zod`), logging (`pino`, `pino-http`), `helmet`, rate limiting, JWT verification (`jose`), S3 client, test stack (`vitest`/`jest`, `supertest`, `nock`/`msw`, `mongodb-memory-server`), lint/format.
- Using the `openai` SDK against GLM via an OpenAI-compatible base URL is a reasonable choice — keep it behind the adapter.
- The lockfile resolves `express 5.2.1`, `mongoose 9.10.1`, `bullmq 6.3.6`, `openai 7.15.0`, `ioredis 6.0.0`. These are newer majors than many tutorials/AI tools assume — **check each changelog for breaking changes** and make sure generated code targets these versions, not older APIs.
- `ioredis` should match what BullMQ expects; let BullMQ own its connection config.

### 4.3 `test-harness.js`

| Issue | Why it matters |
|---|---|
| Counts a pass if **any** tool is called | "What did I sell?" calling `create_order` would score 100%. The 100% number is meaningless. |
| No expected tool or expected params per prompt | Parameter extraction is the actual risk (plan says so). |
| Only 4 prompts, all English | Merchants will write Hinglish/Hindi ("is hafte kitna becha?"). |
| Prompt 2 includes "Confirm it." | Tests the model self-confirming — exactly the behaviour we must prevent. |
| Prompt 4 has no product ID/asset | Tests an under-specified call; a good model *should* ask a question, and the harness marks that as a failure. |
| No negative cases | Needs prompts where the correct answer is **no tool** ("hi", "what can you do?") and adversarial/injection prompts. |
| `process.exit(0)` always | CI can never fail. Exit non-zero below the threshold. |
| Hits the live LLM with a fake merchant, no Laravel mocking | Not repeatable; fine for evals but must be separate from unit tests. |
| Only first tool call inspected | Multi-tool turns aren't evaluated. |

Replacement design: `evals/` dataset in JSONL with `expected_tool`, `expected_args` (with matchers), `expect_no_tool`, `expect_clarification`, language tag; scored report per tool; runs N times to measure variance. See Phase 7 in `TASKS.md`.

### 4.4 `_env`

- Razorpay keys are placeholders; `MONGO_URI` points to a **standalone** local Mongo with no `replicaSet` — **MongoDB transactions will not work** on a standalone server, so the ledger design below cannot be tested locally until you run a single-node replica set (see `docker-compose` in Phase 0).
- The file was shared around as `_env`. If `GLM_API_KEY` is a real key, **rotate it**. Commit only `.env.example`; add `.env` to `.gitignore`; validate env at boot.
- Missing variables for: GLM base URL/model, JWT secrets, Laravel service token, fal/Replicate, S3, Razorpay webhook secret, CORS origins, log level, `NODE_ENV`. See `.env.example`.

---

## 5. Re-audit checklist (run on the full repo)

- [ ] Is `merchant_id` ever read from `req.params`, `req.body`, or LLM tool args for authorisation? (must be **no**)
- [ ] Is there any Mongo write to a balance outside a single atomic operation/transaction?
- [ ] Is every tool arg validated with a schema **after** the LLM returns it?
- [ ] Does any write tool execute without a `pending_action` confirmed by an API call (where confirmation is required)?
- [ ] Does every Laravel write send an `Idempotency-Key`?
- [ ] Is the tool loop capped and is there a per-request timeout?
- [ ] Are tool results truncated/sanitised before going back to the LLM (prompt-injection via product descriptions)?
- [ ] Does the webhook verify the signature on the raw body and dedupe by payment ID?
- [ ] Does the BullMQ worker run in its own process?
- [ ] Are secrets absent from git history?
