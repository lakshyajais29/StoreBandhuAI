'use strict';
require('../helpers/env');
const test = require('node:test');
const assert = require('node:assert/strict');
const { runAgentLoop, FALLBACK } = require('../../src/agent/loop');
const { buildMessages, renderSystemPrompt } = require('../../src/agent/context');
const { createScriptedProvider } = require('../../src/llm/providers/fake');
const { createGlmProvider } = require('../../src/llm/providers/glm');

const limits = { maxIterations: 4, maxToolCallsPerIteration: 3, budgetMs: 2000, llmTimeoutMs: 1000 };
const tc = (id, name, args) => ({ toolCalls: [{ id, name, arguments: JSON.stringify(args) }] });

test('search → inventory → final answer', async () => {
  const provider = createScriptedProvider([
    tc('c1', 'search_products', { query: 'blue shirt' }),
    tc('c2', 'check_inventory', { product_id: '101' }),
    { content: 'You have 42 Blue Cotton Shirts.' },
  ]);
  const executed = [];
  const r = await runAgentLoop({
    provider, limits, tools: [], messages: [{ role: 'system', content: 's' }, { role: 'user', content: 'stock of blue shirt?' }],
    executeTool: async (call) => { executed.push(call.name); return { forLLM: { ok: true, data: { n: 42 } } }; },
  });
  assert.deepEqual(executed, ['search_products', 'check_inventory']);
  assert.equal(r.reply, 'You have 42 Blue Cotton Shirts.');
  assert.equal(r.stopReason, 'final');
  assert.deepEqual(r.newMessages.map((m) => m.role), ['assistant', 'tool', 'assistant', 'tool', 'assistant']);
  assert.match(provider.calls[1].messages.at(-1).content, /<tool_data>/);
});

test('loop is capped at max iterations', async () => {
  let n = 0;
  const provider = createScriptedProvider([() => tc(`c${(n += 1)}`, 'search_products', { query: 'x' })]);
  const r = await runAgentLoop({ provider, limits, tools: [], messages: [], executeTool: async () => ({ forLLM: { ok: true } }) });
  assert.equal(r.stopReason, 'loop_cap');
  assert.equal(r.reply, FALLBACK.loopCap);
  assert.equal(provider.calls.length, 4);
});

test('tool calls per iteration are capped', async () => {
  const many = { toolCalls: Array.from({ length: 6 }, (_, i) => ({ id: `c${i}`, name: 't', arguments: '{}' })) };
  const provider = createScriptedProvider([many, { content: 'ok' }]);
  let count = 0;
  await runAgentLoop({ provider, limits, tools: [], messages: [], executeTool: async () => { count += 1; return { forLLM: {} }; } });
  assert.equal(count, 3);
});

test('time budget aborts a hanging provider', async () => {
  const provider = { model: 'x', chat: ({ signal }) => new Promise((_, rej) => signal.addEventListener('abort', () => rej(new Error('aborted')))) };
  const started = Date.now();
  const r = await runAgentLoop({ provider, limits: { ...limits, budgetMs: 150 }, tools: [], messages: [], executeTool: async () => ({}) });
  assert.equal(r.stopReason, 'timeout');
  assert.ok(Date.now() - started < 1000);
});

test('history builder keeps tool calls paired and drops orphans', () => {
  const stored = [
    { role: 'tool', toolCallId: 'orphan', content: 'x' },
    { role: 'user', content: 'hi' },
    { role: 'assistant', content: null, toolCalls: [{ id: 'a', name: 't', arguments: '{}' }, { id: 'b', name: 't', arguments: '{}' }] },
    { role: 'tool', toolCallId: 'a', content: 'ra' },
    { role: 'assistant', content: 'done' },
    { role: 'system_event', content: 'Image ready' },
    { role: 'user', content: 'thanks', attachments: ['ast_1'] },
  ];
  const out = buildMessages(stored, { systemPrompt: 'SYS', limit: 50 });
  assert.deepEqual(out.map((m) => m.role), ['system', 'user', 'assistant', 'tool', 'assistant', 'system', 'user']);
  assert.equal(out[2].toolCalls.length, 1, 'unanswered call b dropped');
  assert.match(out[6].content, /ast_1/);
});

test('system prompt renders store and date', () => {
  const p = renderSystemPrompt({ storeName: 'Demo', timezone: 'Asia/Kolkata', now: new Date('2026-09-16T10:00:00Z') });
  assert.match(p, /Demo/);
  assert.match(p, /2026-09-16/);
  assert.doesNotMatch(p, /\{\{/);
});

test('GLM provider normalises OpenAI-style tool calls and maps errors', async () => {
  const fakeClient = (impl) => ({ chat: { completions: { create: impl } } });
  let sent;
  const p = createGlmProvider({ model: 'glm-4.7-flash', client: fakeClient(async (req) => {
    sent = req;
    return { model: 'glm-4.7-flash', usage: { prompt_tokens: 10, completion_tokens: 5 }, choices: [{ finish_reason: 'tool_calls', message: { content: '', tool_calls: [{ id: 'x1', type: 'function', function: { name: 'check_inventory', arguments: '{"product_id":"1"}' } }] } }] };
  }) });
  const r = await p.chat({ messages: [{ role: 'assistant', content: null, toolCalls: [{ id: 'p', name: 'n', arguments: '{}' }] }, { role: 'tool', toolCallId: 'p', content: 'r' }], tools: [{ name: 'check_inventory', description: 'd', parameters: { type: 'object' } }] });
  assert.equal(sent.messages[0].tool_calls[0].function.name, 'n');
  assert.equal(sent.messages[1].tool_call_id, 'p');
  assert.deepEqual(r.toolCalls, [{ id: 'x1', name: 'check_inventory', arguments: '{"product_id":"1"}' }]);
  assert.equal(r.usage.inputTokens, 10);

  const limited = createGlmProvider({ model: 'm', client: fakeClient(async () => { const e = new Error('rate'); e.status = 429; throw e; }) });
  await assert.rejects(limited.chat({ messages: [] }), { code: 'LLM_RATE_LIMITED' });
});
