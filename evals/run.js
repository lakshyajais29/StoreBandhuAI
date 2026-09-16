'use strict';
/**
 * Tool-selection evals (replaces the old test-harness.js, which passed if ANY tool was called).
 * Checks the FIRST model turn only (no tools executed): right tool, right key args, or no tool when it must ask.
 *
 *   GLM_API_KEY=... npm run evals                 # real model, all cases
 *   npm run evals -- --filter=hinglish --threshold=0.85 --out=evals/report.json
 * Exits 1 below threshold (default 0.9). Soft cases are reported but not scored.
 */
require('dotenv').config({ quiet: true });
const fs = require('node:fs');
const path = require('node:path');

const argv = Object.fromEntries(process.argv.slice(2).map((a) => a.replace(/^--/, '').split('=')));
process.env.LLM_PROVIDER = argv.provider || process.env.EVAL_LLM_PROVIDER || 'glm';
process.env.LOG_LEVEL = 'silent';
for (const [k, v] of Object.entries({ LARAVEL_API_BASE_URL: 'http://unused.local', LARAVEL_AGENT_SERVICE_TOKEN: 'unused', MONGO_URI: 'mongodb://unused', SESSION_JWT_SECRET: 'eval-only-secret-0123456789-abcdefgh' })) {
  if (!process.env[k]) process.env[k] = v;
}

const { getProvider } = require('../src/llm/provider');
const { llmToolsFor } = require('../src/tools/registry');
const { renderSystemPrompt } = require('../src/agent/context');

function matchValue(expected, actual) {
  if (expected && typeof expected === 'object' && !Array.isArray(expected)) {
    if ('oneOf' in expected) return expected.oneOf.some((v) => (v === null ? actual === undefined : matchValue(v, actual)));
    if ('contains' in expected) return typeof actual === 'string' && actual.toLowerCase().includes(String(expected.contains).toLowerCase());
    if ('approx' in expected) return typeof actual === 'number' && Math.abs(actual - expected.approx) <= (expected.tolerance ?? 0.01);
  }
  if (typeof expected === 'string' && typeof actual === 'string') return expected.toLowerCase() === actual.toLowerCase();
  if (typeof expected === 'number') return Number(actual) === expected;
  return JSON.stringify(expected) === JSON.stringify(actual);
}

function score(c, res) {
  const calls = res.toolCalls || [];
  const first = calls[0];
  let args;
  try { args = first ? JSON.parse(first.arguments || '{}') : {}; } catch { return { pass: false, why: 'invalid JSON args' }; }
  if (c.expect_no_tool) return calls.length === 0 ? { pass: true } : { pass: false, why: `called ${first.name}` };
  if (c.expect_no_tool_named) {
    const bad = calls.find((x) => c.expect_no_tool_named.includes(x.name));
    return bad ? { pass: false, why: `called forbidden ${bad.name}` } : { pass: true };
  }
  if (!first) return { pass: false, why: 'no tool called' };
  if (!matchValue(c.expect_tool, first.name)) return { pass: false, why: `tool ${first.name}` };
  for (const [k, v] of Object.entries(c.expect_args || {})) {
    if (!matchValue(v, args[k])) return { pass: false, why: `arg ${k}=${JSON.stringify(args[k])}` };
  }
  return { pass: true };
}

async function main() {
  const threshold = Number(argv.threshold ?? 0.9);
  const cases = fs.readFileSync(path.join(__dirname, 'dataset.jsonl'), 'utf8').split('\n').filter(Boolean).map((l) => JSON.parse(l))
    .filter((c) => !argv.filter || c.lang === argv.filter || c.id.includes(argv.filter));
  const provider = getProvider();
  const tools = llmToolsFor('growth');
  const system = renderSystemPrompt({ storeName: 'Demo Fashion Store' });
  const results = [];
  for (const c of cases) {
    const started = Date.now();
    try {
      const res = await provider.chat({ messages: [{ role: 'system', content: system }, { role: 'user', content: c.input }], tools });
      results.push({ id: c.id, lang: c.lang, soft: !!c.soft, ms: Date.now() - started, got: res.toolCalls?.map((t) => `${t.name}(${t.arguments})`) || [], ...score(c, res) });
    } catch (err) {
      results.push({ id: c.id, lang: c.lang, soft: !!c.soft, pass: false, why: `error ${err.code || err.message}` });
    }
    const r = results.at(-1);
    process.stdout.write(`${r.pass ? 'PASS' : 'FAIL'}  ${c.id.padEnd(22)} ${r.why || ''}\n`);
  }
  const scored = results.filter((r) => !r.soft);
  const rate = scored.filter((r) => r.pass).length / Math.max(1, scored.length);
  const byLang = {};
  for (const r of scored) {
    byLang[r.lang] ??= { pass: 0, total: 0 };
    byLang[r.lang].total += 1;
    if (r.pass) byLang[r.lang].pass += 1;
  }
  const report = { provider: provider.name, model: provider.model, at: new Date().toISOString(), passRate: rate, threshold, byLang, results };
  if (argv.out) fs.writeFileSync(argv.out, JSON.stringify(report, null, 2));
  process.stdout.write(`\npass rate ${(rate * 100).toFixed(1)}% (threshold ${(threshold * 100).toFixed(0)}%) ${JSON.stringify(byLang)}\n`);
  process.exit(rate >= threshold ? 0 : 1);
}

main().catch((e) => { console.error(e); process.exit(2); }); // eslint-disable-line no-console
