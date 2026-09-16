'use strict';
const fs = require('node:fs');
const path = require('node:path');
const { toolResultForLLM } = require('./sanitize');

const PROMPT_TEMPLATE = fs.readFileSync(path.join(__dirname, '../llm/prompts/system.md'), 'utf8');
const PROMPT_VERSION = `sys-${require('../lib/canonical').sha256(PROMPT_TEMPLATE).slice(0, 8)}`;

function renderSystemPrompt({ storeName = 'your store', timezone = 'Asia/Kolkata', now = new Date() } = {}) {
  const today = new Intl.DateTimeFormat('en-CA', { timeZone: timezone, year: 'numeric', month: '2-digit', day: '2-digit', weekday: 'long' }).format(now);
  return PROMPT_TEMPLATE.replace('{{today}}', today).replace('{{timezone}}', timezone).replace('{{store_name}}', storeName);
}

/**
 * Convert stored messages → provider messages.
 * Keeps assistant tool_calls paired with their tool results (drops orphans on either side),
 * because most providers reject unpaired tool messages.
 */
function buildMessages(stored, { systemPrompt, limit = 24 }) {
  let window = stored.slice(-limit);
  // Never start the window on a tool message or on an assistant tool-call whose results were cut.
  while (window.length && window[0].role === 'tool') window = window.slice(1);

  const out = [{ role: 'system', content: systemPrompt }];
  for (let i = 0; i < window.length; i += 1) {
    const m = window[i];
    if (m.role === 'user') {
      const att = m.attachments?.length ? `\n[Merchant attached: ${m.attachments.join(', ')}]` : '';
      out.push({ role: 'user', content: `${m.content}${att}` });
    } else if (m.role === 'assistant' && m.toolCalls?.length) {
      const ids = new Set(m.toolCalls.map((t) => t.id));
      const results = [];
      let j = i + 1;
      while (j < window.length && window[j].role === 'tool') {
        if (ids.has(window[j].toolCallId)) results.push(window[j]);
        j += 1;
      }
      const answered = m.toolCalls.filter((t) => results.some((r) => r.toolCallId === t.id));
      if (answered.length) {
        out.push({ role: 'assistant', content: m.content || null, toolCalls: answered });
        for (const r of results) out.push({ role: 'tool', toolCallId: r.toolCallId, content: r.content });
      }
      i = j - 1;
    } else if (m.role === 'assistant') {
      out.push({ role: 'assistant', content: m.content });
    } else if (m.role === 'system_event') {
      out.push({ role: 'system', content: `System update (not written by the merchant): ${m.content}` });
    }
  }
  return out;
}

module.exports = { renderSystemPrompt, buildMessages, PROMPT_VERSION, toolResultForLLM };
