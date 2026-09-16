'use strict';
/** One merchant chat turn: persist → charge → LLM loop with tools → settle → persist (docs/02 §5.1). */
const { z } = require('zod');
const { env } = require('../config/env');
const { costOf } = require('../config/tokens');
const { E, AppError } = require('../lib/errors');
const { createVault } = require('../lib/pii');
const { logger } = require('../lib/logger');
const { getProvider, LLMError } = require('../llm/provider');
const { runAgentLoop } = require('./loop');
const { buildMessages, renderSystemPrompt, PROMPT_VERSION } = require('./context');
const { cleanUserText } = require('./sanitize');
const { llmToolsFor } = require('../tools/registry');
const { createExecutor } = require('../tools/executor');
const conversations = require('../domain/conversations/service');
const wallet = require('../domain/wallet/service');
const actions = require('../domain/actions/service');
const jobs = require('../domain/jobs/service');
const audit = require('../domain/audit/service');
const { resolveMerchantAssets } = require('../domain/jobs/assets');
const { getMerchantContext } = require('../domain/merchant/context');
const { laravel } = require('../integrations/laravel/client');

const bodySchema = z.object({
  conversationId: z.string().max(64).optional(),
  message: z.string().min(1).max(4000),
  assetIds: z.array(z.string().regex(/^ast_[\w-]+$/)).max(4).optional(),
});

const executeTool = createExecutor({ actions, jobs, audit });

async function handleChat({ auth, body, requestId }) {
  const parsed = bodySchema.safeParse(body);
  if (!parsed.success) throw E.validation(parsed.error.issues.map((i) => ({ field: i.path.join('.'), problem: i.message })));
  const message = cleanUserText(parsed.data.message);
  if (!message) throw E.validation([{ field: 'message', problem: 'empty' }]);
  const e = env();

  const mctx = await getMerchantContext({ merchantId: auth.merchantId, userId: auth.userId, requestId });
  const conversation = await conversations.getOrCreate(auth, parsed.data.conversationId, message);
  const assets = await resolveMerchantAssets(auth.merchantId, parsed.data.assetIds || []);

  const [userDoc] = await conversations.append(conversation, [{ role: 'user', content: message, attachments: assets.map((a) => a._id), requestId }]);

  // Chat-turn charge (ADR-009 default): reserve before the LLM, commit on success, release on LLM failure.
  let chatReservation;
  try {
    chatReservation = await wallet.reserve({ merchantId: auth.merchantId, tokens: costOf('chat_turn'), purpose: 'chat_turn', actionType: 'chat_turn', refId: String(userDoc._id), requestId });
  } catch (err) {
    if (err.code !== 'INSUFFICIENT_TOKENS') throw err;
    const [reply] = await conversations.append(conversation, [{
      role: 'assistant', requestId,
      content: "You're out of Bandhu Tokens, so I can't process new requests right now. Top up to continue.",
      ui: [{ type: 'insufficient_tokens', ...err.details }],
    }]);
    return respond(conversation, [userDoc, reply], auth.merchantId, { code: 'INSUFFICIENT_TOKENS' });
  }

  const vault = createVault(e.PII_HMAC_SECRET);
  const stored = await conversations.history(conversation._id, e.AGENT_HISTORY_MESSAGES);
  const messages = vault.mask(buildMessages(stored, { systemPrompt: renderSystemPrompt({ storeName: mctx.storeName, timezone: mctx.timezone }), limit: e.AGENT_HISTORY_MESSAGES }));

  const toolCtx = {
    ...mctx, conversationId: conversation._id, vault,
    laravel: laravel().forMerchant({ merchantId: auth.merchantId, userId: auth.userId, requestId }),
  };

  let result;
  try {
    result = await runAgentLoop({
      provider: getProvider(),
      messages,
      tools: llmToolsFor(mctx.planCode),
      limits: {
        maxIterations: e.AGENT_MAX_ITERATIONS, maxToolCallsPerIteration: e.AGENT_MAX_TOOL_CALLS_PER_ITERATION,
        budgetMs: e.AGENT_REQUEST_BUDGET_MS, llmTimeoutMs: e.LLM_TIMEOUT_MS,
      },
      executeTool: async (call, { signal }) => {
        const out = await executeTool(call, { ...toolCtx, signal });
        return { forLLM: vault.mask(out.forLLM), ui: out.ui };
      },
    });
  } catch (err) {
    await wallet.release(chatReservation?._id, { reason: 'llm failed', requestId }).catch(() => {});
    const code = err instanceof LLMError ? err.code : 'INTERNAL';
    logger.error({ err: err.message, code, requestId }, 'agent loop failed');
    const [reply] = await conversations.append(conversation, [{
      role: 'assistant', requestId, content: 'I am having trouble thinking right now. Please try again in a minute. No tokens were charged for this message.',
    }]);
    return respond(conversation, [userDoc, reply], auth.merchantId, { code: code === 'INTERNAL' ? 'INTERNAL' : 'LLM_UNAVAILABLE' });
  }

  await wallet.commit(chatReservation?._id, { requestId });

  // Store un-masked content; placeholders are re-created deterministically next turn.
  const toStore = result.newMessages.map((m, idx) => {
    const isFinal = idx === result.newMessages.length - 1;
    return {
      role: m.role, requestId, promptVersion: PROMPT_VERSION,
      content: vault.unmask(m.content || ''),
      toolCalls: m.toolCalls ? m.toolCalls.map((tc) => ({ ...tc, arguments: vault.unmask(tc.arguments) })) : undefined,
      toolCallId: m.toolCallId, toolName: m.name,
      ui: isFinal && result.ui.length ? result.ui : undefined,
      llmUsage: isFinal ? { ...result.usage, stopReason: result.stopReason, model: getProvider().model } : undefined,
    };
  });
  const saved = await conversations.append(conversation, toStore);
  return respond(conversation, [userDoc, ...saved], auth.merchantId);
}

async function respond(conversation, docs, merchantId, error) {
  return {
    conversationId: String(conversation._id),
    messages: docs.map((d) => conversations.publicMessage(d.toObject ? d.toObject() : d)).filter(Boolean),
    wallet: await wallet.getBalance(merchantId),
    ...(error ? { error } : {}),
  };
}

module.exports = { handleChat, AppError };
