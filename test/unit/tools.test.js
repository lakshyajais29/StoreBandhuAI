'use strict';
require('../helpers/env');
const test = require('node:test');
const assert = require('node:assert/strict');
const { allTools, llmToolsFor, getTool } = require('../../src/tools/registry');
const { resolveRange } = require('../../src/tools/definitions/getSalesSummary');
const { costOf } = require('../../src/config/tokens');

test('every tool has a JSON schema generated from zod with matching required fields', () => {
  for (const t of allTools()) {
    assert.equal(t.parameters.type, 'object', t.name);
    assert.equal(t.parameters.$schema, undefined);
    assert.ok(t.description.length > 30, `${t.name} description too short`);
    const shape = t.schema.shape;
    const required = Object.keys(shape).filter((k) => !shape[k].safeParse(undefined).success);
    assert.deepEqual([...(t.parameters.required || [])].sort(), required.sort(), t.name);
    assert.ok(!('merchant_id' in (t.parameters.properties || {})), `${t.name} must not accept merchant identity`);
  }
});

test('plan gating removes tools the plan does not include', () => {
  const trial = llmToolsFor('trial').map((t) => t.name);
  const starter = llmToolsFor('starter').map((t) => t.name);
  const growth = llmToolsFor('growth').map((t) => t.name);
  assert.ok(!trial.includes('generate_product_video'));
  assert.ok(!trial.includes('create_order'));
  assert.ok(starter.includes('create_order') && !starter.includes('generate_product_video'));
  assert.ok(growth.includes('generate_product_video'));
});

test('token costs', () => {
  assert.equal(costOf('create_product_listing'), 3);
  assert.equal(costOf('generate_product_image', { style: 'white_background' }), 6);
  assert.equal(costOf('generate_product_image', { style: 'lifestyle' }), 10);
  assert.equal(costOf('generate_product_video', { style: 'cinematic' }), 40);
  assert.throws(() => costOf('nope'));
});

test('date ranges resolve in merchant timezone', () => {
  const now = new Date('2026-09-16T20:00:00Z'); // 01:30 on the 17th in IST
  assert.deepEqual(resolveRange({ range: 'today' }, 'Asia/Kolkata', now), { from: '2026-09-17', to: '2026-09-17' });
  assert.deepEqual(resolveRange({ range: 'last_7_days' }, 'Asia/Kolkata', now), { from: '2026-09-11', to: '2026-09-17' });
  assert.deepEqual(resolveRange({ range: 'last_month' }, 'Asia/Kolkata', new Date('2026-03-10T06:00:00Z')), { from: '2026-02-01', to: '2026-02-28' });
  assert.deepEqual(resolveRange({ range: 'custom', from: '2026-09-10', to: '2026-09-01' }), { from: '2026-09-01', to: '2026-09-10' });
  assert.equal(resolveRange({ range: 'custom' }), null);
});

test('update_inventory decides confirmation from real stock', async () => {
  const tool = getTool('update_inventory');
  const ctx = { laravel: { getInventory: async () => ({ product_id: '1', title: 'Shirt', stock: 40, variants: [] }) } };
  const small = await tool.prepare({ product_id: '1', mode: 'adjust', quantity: 10 }, ctx);
  assert.equal(small.requiresConfirmation, false);
  assert.equal(small.preview.new_stock, 50);
  const big = await tool.prepare({ product_id: '1', mode: 'set', quantity: 1000 }, ctx);
  assert.equal(big.requiresConfirmation, true);
  const zero = await tool.prepare({ product_id: '1', mode: 'set', quantity: 0 }, ctx);
  assert.equal(zero.requiresConfirmation, true, 'set-to-zero needs confirmation');
  await assert.rejects(tool.prepare({ product_id: '1', mode: 'adjust', quantity: -41 }, ctx), { code: 'NEGATIVE_STOCK' });
});

test('create_order freezes only the quote id and shows Laravel totals', async () => {
  const tool = getTool('create_order');
  const ctx = { laravel: { quoteOrder: async () => ({ quote_id: 'q_1', customer_display: 'Priya', address_display: 'Blr', items: [{ title: 'Shirt', qty: 2, unit_price_paise: 49900, line_total_paise: 99800, in_stock: true }], subtotal_paise: 99800, tax_paise: 4990, shipping_paise: 0, total_paise: 104790 }) } };
  const prep = await tool.prepare({ customer_ref: 'c', address_ref: 'a', items: [{ product_id: '1', qty: 2 }], payment_mode: 'cod' }, ctx);
  assert.deepEqual(prep.args, { quote_id: 'q_1' });
  assert.equal(prep.requiresConfirmation, true);
  assert.equal(prep.preview.total_rupees, 1047.9);
});
