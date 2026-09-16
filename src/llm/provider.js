'use strict';
/**
 * LLMProvider contract (ADR-002). The agent loop only sees this normalised shape.
 *
 * chat({ messages, tools, timeoutMs, signal }) → {
 *   content: string|null,
 *   toolCalls: [{ id, name, arguments: string }],
 *   usage: { inputTokens, outputTokens },
 *   finishReason: string, model: string
 * }
 * messages: [{ role: 'system'|'user'|'assistant'|'tool', content, toolCalls?, toolCallId?, name? }]
 * tools:    [{ name, description, parameters (JSON schema) }]
 * Throws LLMError { code: 'LLM_TIMEOUT'|'LLM_RATE_LIMITED'|'LLM_UNAVAILABLE'|'LLM_BAD_RESPONSE' }.
 */
class LLMError extends Error {
  constructor(code, message, cause) {
    super(message);
    this.code = code;
    this.cause = cause;
  }
}

let override;
function getProvider() {
  if (override) return override;
  const { env } = require('../config/env');
  const e = env();
  if (e.LLM_PROVIDER === 'fake') return require('./providers/fake').createFakeProvider();
  return require('./providers/glm').createGlmProvider({
    apiKey: e.GLM_API_KEY, baseURL: e.GLM_BASE_URL, model: e.GLM_MODEL, temperature: e.LLM_TEMPERATURE, timeoutMs: e.LLM_TIMEOUT_MS,
  });
}
function setProviderForTests(p) { override = p; }

module.exports = { LLMError, getProvider, setProviderForTests };
