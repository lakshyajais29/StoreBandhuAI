'use strict';
/**
 * GLM-4.7-Flash through Z.ai's OpenAI-compatible Chat Completions API.
 * ⚠️ Verify GLM_BASE_URL and GLM_MODEL against current Z.ai docs before production.
 */
const { OpenAI } = require('openai');
const { LLMError } = require('../provider');

function toOpenAIMessages(messages) {
  return messages.map((m) => {
    if (m.role === 'assistant' && m.toolCalls?.length) {
      return {
        role: 'assistant',
        content: m.content || null,
        tool_calls: m.toolCalls.map((tc) => ({ id: tc.id, type: 'function', function: { name: tc.name, arguments: tc.arguments } })),
      };
    }
    if (m.role === 'tool') return { role: 'tool', tool_call_id: m.toolCallId, content: m.content };
    return { role: m.role, content: m.content };
  });
}

function createGlmProvider({ apiKey, baseURL, model, temperature = 0.1, timeoutMs = 20000, client }) {
  const openai = client || new OpenAI({ apiKey, baseURL, timeout: timeoutMs, maxRetries: 1 });

  return {
    name: 'glm',
    model,
    async chat({ messages, tools, signal, timeoutMs: perCall }) {
      let res;
      try {
        res = await openai.chat.completions.create({
          model,
          temperature,
          messages: toOpenAIMessages(messages),
          tools: tools?.length ? tools.map((t) => ({ type: 'function', function: { name: t.name, description: t.description, parameters: t.parameters } })) : undefined,
          tool_choice: tools?.length ? 'auto' : undefined,
        }, { signal, timeout: perCall || timeoutMs });
      } catch (err) {
        const status = err?.status;
        if (err?.name === 'AbortError' || /timed? ?out/i.test(err?.message || '')) throw new LLMError('LLM_TIMEOUT', 'LLM timed out', err);
        if (status === 429) throw new LLMError('LLM_RATE_LIMITED', 'LLM rate limited', err);
        throw new LLMError('LLM_UNAVAILABLE', `LLM request failed${status ? ` (${status})` : ''}`, err);
      }
      const choice = res?.choices?.[0];
      if (!choice?.message) throw new LLMError('LLM_BAD_RESPONSE', 'LLM returned no message');
      const msg = choice.message;
      return {
        content: typeof msg.content === 'string' ? msg.content : null,
        toolCalls: (msg.tool_calls || []).filter((tc) => tc.type === 'function' || tc.function).map((tc) => ({
          id: tc.id || `call_${Math.random().toString(36).slice(2, 10)}`,
          name: tc.function?.name,
          arguments: typeof tc.function?.arguments === 'string' ? tc.function.arguments : JSON.stringify(tc.function?.arguments ?? {}),
        })),
        usage: { inputTokens: res.usage?.prompt_tokens ?? 0, outputTokens: res.usage?.completion_tokens ?? 0 },
        finishReason: choice.finish_reason,
        model: res.model || model,
      };
    },
  };
}

module.exports = { createGlmProvider, toOpenAIMessages };
