'use strict';
/**
 * Deterministic provider for tests and offline development (LLM_PROVIDER=fake).
 * - createScriptedProvider(steps): returns steps in order (each step = normalised response or fn(messages)).
 * - createFakeProvider(): tiny keyword router so the widget can be demoed without an API key.
 */
function createScriptedProvider(steps) {
  const calls = [];
  let i = 0;
  return {
    name: 'scripted',
    model: 'scripted',
    calls,
    async chat(req) {
      calls.push(req);
      const step = steps[Math.min(i, steps.length - 1)];
      i += 1;
      const out = typeof step === 'function' ? await step(req) : step;
      return { content: null, toolCalls: [], usage: { inputTokens: 0, outputTokens: 0 }, finishReason: 'stop', model: 'scripted', ...out };
    },
  };
}

function createFakeProvider() {
  let n = 0;
  const call = (name, args) => ({ toolCalls: [{ id: `call_fake_${(n += 1)}`, name, arguments: JSON.stringify(args) }] });
  return {
    name: 'fake',
    model: 'fake-router',
    async chat({ messages }) {
      const last = messages[messages.length - 1];
      const base = { usage: { inputTokens: 0, outputTokens: 0 }, finishReason: 'stop', model: 'fake-router', content: null, toolCalls: [] };
      if (last.role === 'tool') {
        return { ...base, content: `Here is what I found:\n\n${last.content.slice(0, 600)}` };
      }
      const text = String(last.content || '').toLowerCase();
      if (/sell|sales|becha/.test(text)) return { ...base, ...call('get_sales_summary', { range: 'last_7_days' }) };
      if (/token|balance/.test(text)) return { ...base, ...call('get_wallet_balance', {}) };
      if (/stock|inventory/.test(text)) return { ...base, ...call('search_products', { query: text.replace(/.*(of|for)\s+/, '').slice(0, 40) || 'shirt', limit: 5 }) };
      const attached = text.match(/ast_[\w-]+/);
      if (/image|photo/.test(text) && attached) return { ...base, ...call('generate_product_image', { asset_id: attached[0], style: 'white_background' }) };
      if (/listing|create product/.test(text)) {
        return { ...base, ...call('create_product_listing', { title: 'Blue Cotton Shirt', description: 'Soft cotton shirt', price_rupees: 500, category: 'Apparel' }) };
      }
      return { ...base, content: 'I am running in offline demo mode (LLM_PROVIDER=fake). Try: "what did I sell this week", "stock of blue shirt", "create listing", "how many tokens".' };
    },
  };
}

module.exports = { createScriptedProvider, createFakeProvider };
