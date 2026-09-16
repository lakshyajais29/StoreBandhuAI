'use strict';
require('../helpers/env');
const test = require('node:test');
const assert = require('node:assert/strict');
const { createExecutor } = require('../../src/tools/executor');
const { AppError, E } = require('../../src/lib/errors');
const { createVault } = require('../../src/lib/pii');
const { getPlan } = require('../../src/config/plans');

function setup(overrides = {}) {
  const audits = [];
  const calls = { create: [], execute: [], enqueue: [] };
  const deps = {
    audit: { recordToolCall: async (e) => { audits.push(e); } },
    actions: {
      create: async (p) => { calls.create.push(p); return { _id: 'pa_test1234567', tokenCost: 3, status: p.requiresConfirmation ? 'awaiting_confirmation' : 'executing', preview: p.preview }; },
      executeAndSettle: async (pa) => { calls.execute.push(pa); return { ...pa, status: 'succeeded', result: { summary: 'Stock updated' } }; },
      publicView: (pa) => ({ id: pa._id, status: pa.status }),
    },
    jobs: { enqueue: async (tool, args) => { calls.enqueue.push(args); return { cached: false, job: { id: 'job_1', tokenCost: 6 } }; } },
    ...overrides,
  };
  const laravel = {
    searchProducts: async () => ({ data: [{ product_id: 101, title: 'Blue Shirt', price_paise: 49900, stock: 42 }] }),
    getInventory: async () => ({ product_id: '101', title: 'Blue Shirt', stock: 42, variants: [] }),
    searchCustomers: async (q) => ({ data: [{ customer_ref: 'c1', display_name: q.q }] }),
  };
  const ctx = { merchantId: 'm_1', userId: 'u_1', requestId: 'r1', planCode: 'growth', plan: getPlan('growth'), laravel, vault: createVault('k'.repeat(20)) };
  return { exec: createExecutor(deps), audits, calls, ctx };
}
const call = (name, args, raw) => ({ id: 'c1', name, arguments: raw ?? JSON.stringify(args) });

test('unknown tool is rejected and audited', async () => {
  const { exec, audits, ctx } = setup();
  const r = await exec(call('drop_database', {}), ctx);
  assert.equal(r.forLLM.error.code, 'UNKNOWN_TOOL');
  assert.equal(audits[0].decision, 'unknown_tool');
});

test('malformed JSON arguments', async () => {
  const { exec, ctx } = setup();
  const r = await exec(call('search_products', null, '{"query":'), ctx);
  assert.equal(r.forLLM.error.code, 'INVALID_ARGUMENTS');
});

test('schema violations are returned as field problems, not executed', async () => {
  const { exec, calls, ctx, audits } = setup();
  const r = await exec(call('update_inventory', { product_id: '101', mode: 'multiply', quantity: 1.5 }), ctx);
  assert.equal(r.forLLM.ok, false);
  assert.ok(r.forLLM.error.details.some((d) => d.field === 'mode'));
  assert.equal(calls.create.length, 0);
  assert.equal(audits[0].validation, 'failed');
});

test('merchant identity supplied by the LLM is ignored', async () => {
  const { exec, ctx, calls } = setup();
  await exec(call('update_inventory', { product_id: '101', mode: 'adjust', quantity: 5, merchant_id: 'm_EVIL' }), ctx);
  assert.equal(calls.create[0].ctx.merchantId, 'm_1');
  assert.ok(!('merchant_id' in calls.create[0].args));
});

test('read tool executes and shapes data', async () => {
  const { exec, ctx } = setup();
  const r = await exec(call('search_products', { query: 'blue shirt' }), ctx);
  assert.equal(r.forLLM.ok, true);
  assert.equal(r.forLLM.data.products[0].price_rupees, 499);
  assert.equal(r.forLLM.data.products[0].product_id, '101');
});

test('small inventory change executes immediately through the actions service', async () => {
  const { exec, ctx, calls } = setup();
  const r = await exec(call('update_inventory', { product_id: '101', mode: 'adjust', quantity: 10 }), ctx);
  assert.equal(calls.create[0].requiresConfirmation, false);
  assert.equal(calls.execute.length, 1);
  assert.equal(r.forLLM.status, 'succeeded');
  assert.equal(r.ui.type, 'action_result');
});

test('large inventory change becomes a pending action with a card', async () => {
  const { exec, ctx, calls } = setup();
  const r = await exec(call('update_inventory', { product_id: '101', mode: 'set', quantity: 5000 }), ctx);
  assert.equal(calls.execute.length, 0);
  assert.equal(r.forLLM.status, 'awaiting_confirmation');
  assert.equal(r.ui.type, 'pending_action');
});

test('plan gate blocks features not in plan', async () => {
  const { exec, ctx, calls } = setup();
  const r = await exec(call('generate_product_video', { asset_id: 'ast_abc', style: 'showcase' }), { ...ctx, planCode: 'trial', plan: getPlan('trial') });
  assert.equal(r.forLLM.error.code, 'PLAN_UPGRADE_REQUIRED');
  assert.equal(r.ui.type, 'upgrade_required');
  assert.equal(calls.enqueue.length, 0);
});

test('async tool enqueues a job', async () => {
  const { exec, ctx } = setup();
  const r = await exec(call('generate_product_image', { asset_id: 'ast_abc', style: 'white_background' }), ctx);
  assert.equal(r.forLLM.status, 'queued');
  assert.equal(r.ui.job.id, 'job_1');
});

test('insufficient tokens is surfaced with a top-up card', async () => {
  const { exec, ctx } = setup({ jobs: { enqueue: async () => { throw E.insufficientTokens(10, 2); } } });
  const r = await exec(call('generate_product_image', { asset_id: 'ast_abc', style: 'lifestyle' }), ctx);
  assert.equal(r.forLLM.error.code, 'INSUFFICIENT_TOKENS');
  assert.equal(r.ui.type, 'insufficient_tokens');
  assert.equal(r.ui.required, 10);
});

test('PII placeholders from the LLM are unmasked before reaching Laravel', async () => {
  const { exec, ctx } = setup();
  const masked = ctx.vault.mask('9876543210');
  const r = await exec(call('search_customers', { query: masked }), ctx);
  assert.equal(r.forLLM.data.customers[0].name, '9876543210');
});

test('unexpected crash never throws out of the executor', async () => {
  const { exec, ctx } = setup();
  ctx.laravel.searchProducts = async () => { throw new TypeError('boom'); };
  const r = await exec(call('search_products', { query: 'x' }), ctx);
  assert.equal(r.forLLM.error.code, 'TOOL_FAILED');
  ctx.laravel.searchProducts = async () => { throw new AppError('UPSTREAM_TIMEOUT', 504, 'slow'); };
  const r2 = await exec(call('search_products', { query: 'x' }), ctx);
  assert.equal(r2.forLLM.error.code, 'UPSTREAM_TIMEOUT');
});
