# Bandhu AI — agent service

Agentic assistant for storebandhu.com merchants: chat in English / Hindi / Hinglish and it checks sales, updates stock, creates listings, places orders and generates product photos/videos — metered in Bandhu Tokens.

```
React widget (widget/) ──JWT──▶ Node API (src/server.js) ──service token──▶ Laravel /api/v1/agent/*  ──▶ MySQL
                                  │   │                                           ▲
                                  │   └─ BullMQ ─▶ Worker (src/worker.js) ─ fal.ai / storage ─┘ (attach media)
                                  └─ MongoDB (chat, wallet ledger, actions, audit) + Redis (queues, limits)
```

Design decisions and the reasoning behind them live in `docs/` (read `docs/01-DECISIONS.md` first). Rules for anyone — human or AI — changing this code: `CLAUDE.md`.

## Run it locally (Docker)

```bash
cp .env.example .env            # LLM_PROVIDER=fake works without any API key
cd widget && npm ci && npm run build && cd ..
docker compose up -d --build    # mongo (replica set), redis, mock-laravel, api, worker
open http://localhost:8000/demo # mock dashboard with the widget
```

Give the demo merchant tokens and a plan that includes video:

```bash
docker compose exec api node scripts/grant-tokens.js m_demo 500 "local testing"
docker compose exec api node scripts/set-plan.js m_demo growth
```

Use the real model: set `LLM_PROVIDER=glm` and `GLM_API_KEY`, then `docker compose up -d api`.

## Run without Docker

Needs Node ≥ 22.12, Redis, and MongoDB **as a replica set** (wallet transactions will fail on a standalone mongod).

```bash
npm ci
npm run mock:laravel      # :8000
npm run dev               # API :4000
npm run dev:worker        # media + maintenance jobs
TOKEN=$(npm run -s token:dev) && curl -s localhost:4000/api/wallet -H "Authorization: Bearer $TOKEN"
```

## Tests and evals

| Command | Needs | What it proves |
|---|---|---|
| `npm test` | Redis (skips Redis cases if absent) | env validation, PII masking, tool schemas & plan gating, executor safety, agent loop limits, Laravel client retry/idempotency/error mapping, auth, webhook raw-body signature, Redis limit atomicity |
| `npm run test:integration` | Mongo replica set + Redis | 50-way wallet race, idempotent commit/release, append-only ledger, trial-vs-video, lot expiry, preview→double-confirm, cross-merchant confirm, duplicate webhooks |
| `npm run evals` | `GLM_API_KEY` | tool selection on 40 English/Hindi/Hinglish cases incl. injection and "must ask" cases; exits 1 below 90 % |
| `npm run lint` | – | includes a rule that only the wallet service may change balances |

CI (`.github/workflows/ci.yml`) runs all of these and fails if integration tests skip.

## API (merchant, `Authorization: Bearer <session JWT>`)

| Method | Path | |
|---|---|---|
| POST | `/api/chat` | `{message, conversationId?, assetIds?}` → new messages, UI cards, wallet |
| GET | `/api/conversations`, `/api/conversations/:id` | history (tool plumbing hidden) |
| POST | `/api/actions/:id/confirm` · `/cancel` | the only way a previewed write executes |
| GET | `/api/wallet`, `/api/wallet/ledger`, `/api/wallet/usage` | balance, history, spend by action |
| POST | `/api/uploads` → PUT upload URL → `/api/uploads/:id/complete` | product photos (magic-byte checked) |
| GET/POST | `/api/jobs`, `/api/jobs/:id`, `/api/jobs/:id/attach` | media job status; re-attach without charge |
| GET/POST | `/api/billing/plans`, `/checkout`, `/verify`, `/payments` | Razorpay |
| POST | `/webhooks/razorpay` | raw body, HMAC verified, idempotent |
| * | `/admin/*` | `X-Admin-Secret` + `X-Admin-Actor`; adjust tokens, set plan, inspect tool calls |

Errors always look like `{ "error": { "code", "message", "details?", "requestId" } }`.

## Embedding the widget in Laravel

```html
<script src="https://cdn.storebandhu.com/bandhu-widget.js"></script>
<script>
  BandhuAI.mount({
    apiBaseUrl: 'https://agent.storebandhu.com',
    getToken: () => fetch('/dashboard/bandhu/session', { method: 'POST', headers: { 'X-CSRF-TOKEN': csrf } })
      .then(r => r.json()).then(j => j.token),
  });
</script>
```

## Where things are

```
src/config      env (validated), token costs, policies, plans   ← business numbers live here only
src/agent       chat turn orchestration, loop, context/prompt, sanitising
src/tools       one file per tool (zod schema = LLM JSON schema), registry, executor
src/domain      wallet (only balance mutator), actions, jobs, billing, conversations, audit
src/integrations laravel client, media gateway (mock/fal), storage (local/S3/R2), razorpay
src/queues      BullMQ queues + processors (media, maintenance schedules)
mock-laravel    contract mock + dev session minting + demo page host
widget          React embeddable widget (Shadow DOM, single IIFE bundle)
evals           dataset + scorer
docs            audit, ADRs, architecture, Laravel contract, task plan, implementation status
```

See `docs/IMPLEMENTATION-STATUS.md` for what is done, what is stubbed, and what still needs an owner decision.
