'use strict';
/**
 * Tool-calling loop (docs/02-ARCHITECTURE.md §5.1).
 * Hard limits: max iterations, max tool calls per iteration, overall time budget.
 * The executor never throws for tool problems; it returns structured results.
 */
const { toolResultForLLM } = require('./sanitize');
const { LLMError } = require('../llm/provider');

const FALLBACK = {
  loopCap: "I couldn't finish that in one go. Could you tell me a bit more specifically what you need?",
  timeout: 'That took too long. Please try again in a moment.',
};

/**
 * @param {object} p
 * @param {object} p.provider      LLMProvider
 * @param {Array}  p.messages      provider-format messages (system + history + new user msg), PII-masked
 * @param {Array}  p.tools         [{name, description, parameters}]
 * @param {Function} p.executeTool async (toolCall) => { forLLM: object, ui?: object }
 * @param {object} p.limits        { maxIterations, maxToolCallsPerIteration, budgetMs, llmTimeoutMs }
 * @returns {{ reply, newMessages, ui, usage, stopReason }}
 */
async function runAgentLoop({ provider, messages, tools, executeTool, limits, signal: outerSignal }) {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(new Error('budget')), limits.budgetMs);
  outerSignal?.addEventListener('abort', () => controller.abort(outerSignal.reason), { once: true });
  const convo = [...messages];
  const newMessages = [];
  const ui = [];
  const usage = { inputTokens: 0, outputTokens: 0, llmCalls: 0 };

  try {
    for (let iter = 0; iter < limits.maxIterations; iter += 1) {
      if (controller.signal.aborted) return done(FALLBACK.timeout, 'timeout');
      const remaining = Math.max(1000, limits.budgetMs - 500);
      const res = await provider.chat({ messages: convo, tools, signal: controller.signal, timeoutMs: Math.min(limits.llmTimeoutMs, remaining) });
      usage.llmCalls += 1;
      usage.inputTokens += res.usage?.inputTokens ?? 0;
      usage.outputTokens += res.usage?.outputTokens ?? 0;

      if (!res.toolCalls?.length) {
        const reply = (res.content || '').trim() || "Sorry, I didn't get that. Could you rephrase?";
        return done(reply, 'final');
      }

      const calls = res.toolCalls.slice(0, limits.maxToolCallsPerIteration);
      const assistantMsg = { role: 'assistant', content: res.content || null, toolCalls: calls };
      convo.push(assistantMsg);
      newMessages.push(assistantMsg);

      for (const call of calls) {
        if (controller.signal.aborted) break;
        const { forLLM, ui: card } = await executeTool(call, { signal: controller.signal });
        const toolMsg = { role: 'tool', toolCallId: call.id, name: call.name, content: toolResultForLLM(forLLM) };
        convo.push(toolMsg);
        newMessages.push(toolMsg);
        if (card) ui.push(card);
      }
    }
    return done(FALLBACK.loopCap, 'loop_cap');
  } catch (err) {
    if (controller.signal.aborted && !(err instanceof LLMError && err.code !== 'LLM_TIMEOUT')) return done(FALLBACK.timeout, 'timeout');
    throw err;
  } finally {
    clearTimeout(timer);
  }

  function done(reply, stopReason) {
    const finalMsg = { role: 'assistant', content: reply };
    newMessages.push(finalMsg);
    return { reply, newMessages, ui, usage, stopReason };
  }
}

module.exports = { runAgentLoop, FALLBACK };
