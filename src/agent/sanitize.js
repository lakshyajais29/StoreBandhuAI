'use strict';
const policies = require('../config/policies');

/** Compact, truncate and label tool output before it goes back to the LLM (prompt-injection hygiene). */
function toolResultForLLM(result, maxBytes = policies.toolResultMaxBytes) {
  let json = JSON.stringify(result ?? null);
  if (json.length > maxBytes) {
    json = `${json.slice(0, maxBytes)}…[truncated ${json.length - maxBytes} chars]`;
  }
  return `<tool_data>\n${json}\n</tool_data>`;
}

/** Strip control characters and cap merchant input length. */
function cleanUserText(text, max = policies.maxUserMessageChars) {
  // eslint-disable-next-line no-control-regex
  return String(text ?? '').replace(/[\u0000-\u0008\u000B\u000C\u000E-\u001F]/g, '').trim().slice(0, max);
}

module.exports = { toolResultForLLM, cleanUserText };
