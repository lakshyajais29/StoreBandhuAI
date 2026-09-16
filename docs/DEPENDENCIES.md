# Dependency notes

Versions were checked against the npm registry on 2026-09-16 and installed exactly as in `package-lock.json`. These majors changed APIs that older examples (and older AI-generated code) get wrong.

| Package | Version | Gotchas this code already handles |
|---|---|---|
| express | 5.2.x | Async handler rejections go to the error handler automatically (no wrapper). `req.query` is a getter; path wildcards syntax changed — avoid `*` routes. |
| mongoose | 9.10.x | Use `returnDocument: 'after'` (not `new: true`). `includeResultMetadata` replaces `rawResult`. No callbacks. Transactions need a replica set. |
| bullmq | 6.3.x | `new Worker(name, processor, opts)`; repeatable jobs via `queue.upsertJobScheduler(id, repeat, template)`. Connections must use `maxRetriesPerRequest: null`. |
| ioredis | 6.0.x | Use the named export `const { Redis } = require('ioredis')`. |
| openai | 7.15.x | `const { OpenAI } = require('openai')`; `client.chat.completions.create` still used for OpenAI-compatible providers (Z.ai GLM). |
| zod | 4.x | `z.toJSONSchema(schema, { io: 'input' })` — without `io:'input'` fields with defaults are marked required. Strip `$schema` before sending to the LLM. |
| jose | 6.x | Works via `require()` on Node ≥ 22.12 (require(esm)). |
| nock | 14.x | No default export on `require('nock')` interop beyond the function itself; call `nock.cleanAll()` between tests. |
| vite | 8.x / typescript 7.x (widget) | Library mode IIFE build; CSS imported with `?inline` and injected into the Shadow DOM. |
