'use strict';
/**
 * Tool executor (docs/02-ARCHITECTURE.md §5.2). Never throws for tool problems:
 * returns { forLLM, ui? }. LLM output is untrusted; identity always comes from ctx.
 */
const { getTool, featureAccess } = require('./registry');
const { AppError } = require('../lib/errors');
const { logger } = require('../lib/logger');

const IDENTITY_KEYS = ['merchant_id', 'merchantId', 'store_id', 'user_id', 'userId'];

function zodIssues(error) {
  return error.issues.slice(0, 8).map((i) => ({ field: i.path.join('.') || '(root)', problem: i.message }));
}

function errorResult(code, message, details) {
  return { forLLM: { ok: false, error: { code, message, ...(details ? { details } : {}) } } };
}

const DECISION_BY_CODE = {
  INSUFFICIENT_TOKENS: 'insufficient_tokens', RATE_LIMITED: 'rate_limited', PLAN_UPGRADE_REQUIRED: 'rejected_policy', FEATURE_DISABLED: 'rejected_policy',
};

function createExecutor(deps) {
  const { actions, jobs, audit } = deps;

  return async function executeTool(call, ctx) {
    const started = Date.now();
    const base = { merchantId: ctx.merchantId, userId: ctx.userId, conversationId: ctx.conversationId && String(ctx.conversationId), requestId: ctx.requestId, tool: call.name };
    const finish = async (result, auditFields) => {
      await audit.recordToolCall({ ...base, latencyMs: Date.now() - started, ...auditFields });
      return result;
    };

    const tool = getTool(call.name);
    if (!tool) {
      return finish(errorResult('UNKNOWN_TOOL', `There is no tool named ${call.name}`), { decision: 'unknown_tool', args: call.arguments });
    }

    let raw;
    try {
      raw = call.arguments ? JSON.parse(call.arguments) : {};
      if (raw === null || typeof raw !== 'object' || Array.isArray(raw)) throw new Error('not an object');
    } catch {
      return finish(errorResult('INVALID_ARGUMENTS', 'Tool arguments were not valid JSON'), { decision: 'rejected_validation', validation: 'failed', args: call.arguments });
    }
    for (const k of IDENTITY_KEYS) delete raw[k];
    const unmasked = ctx.vault ? ctx.vault.unmask(raw) : raw;

    const parsed = tool.schema.safeParse(unmasked);
    if (!parsed.success) {
      const issues = zodIssues(parsed.error);
      return finish(errorResult('INVALID_ARGUMENTS', 'Some details are missing or invalid. Ask the merchant for them.', issues), {
        decision: 'rejected_validation', validation: 'failed', args: unmasked, resultSummary: issues,
      });
    }
    const args = parsed.data;

    const access = featureAccess(tool.feature, ctx.planCode);
    if (access !== 'ok') {
      const code = access === 'plan' ? 'PLAN_UPGRADE_REQUIRED' : 'FEATURE_DISABLED';
      const msg = access === 'plan' ? 'This is not included in the merchant\'s current plan.' : 'This feature is temporarily turned off.';
      return finish({ ...errorResult(code, msg), ui: access === 'plan' ? { type: 'upgrade_required', feature: tool.feature } : undefined }, {
        decision: 'rejected_policy', validation: 'ok', args, errorCode: code,
      });
    }

    try {
      if (tool.kind === 'read') {
        const data = await tool.run(args, ctx);
        return finish({ forLLM: data?.ok === false ? data : { ok: true, data } }, { decision: 'executed', validation: 'ok', args });
      }

      if (tool.kind === 'write') {
        const prep = await tool.prepare(args, ctx);
        const pa = await actions.create({ ctx, tool, args: prep.args, preview: prep.preview, requiresConfirmation: prep.requiresConfirmation });
        if (prep.requiresConfirmation) {
          return finish({
            forLLM: { ok: true, status: 'awaiting_confirmation', pending_action_id: pa._id, token_cost: pa.tokenCost, preview: prep.preview, note: 'Not executed yet. The merchant must press Confirm on the preview card.' },
            ui: { type: 'pending_action', action: actions.publicView(pa) },
          }, { decision: 'pending_confirmation', validation: 'ok', args: prep.args, refId: pa._id, tokensReserved: pa.tokenCost });
        }
        const done = await actions.executeAndSettle(pa, { requestId: ctx.requestId, signal: ctx.signal });
        const view = actions.publicView(done);
        const forLLM = done.status === 'succeeded'
          ? { ok: true, status: 'succeeded', summary: done.result?.summary, result: done.result }
          : done.status === 'unknown'
            ? { ok: false, status: 'unknown', error: { code: 'UNKNOWN_OUTCOME', message: 'Could not confirm whether the store applied this. It is being checked automatically; do not retry.' } }
            : { ok: false, status: 'failed', error: done.error };
        return finish({ forLLM, ui: { type: 'action_result', action: view } }, {
          decision: done.status === 'succeeded' ? 'executed' : done.status === 'unknown' ? 'unknown_outcome' : 'failed',
          validation: 'ok', args: prep.args, refId: done._id, tokensReserved: done.tokenCost, errorCode: done.error?.code,
        });
      }

      if (tool.kind === 'async') {
        const { cached, job } = await jobs.enqueue(tool, args, ctx);
        return finish({
          forLLM: cached
            ? { ok: true, status: 'succeeded', cached: true, job_id: job.id, result_url: job.resultUrl, note: 'Same request was generated before; reused at no cost.' }
            : { ok: true, status: 'queued', job_id: job.id, token_cost: job.tokenCost, note: 'Runs in the background. Result will be posted in this chat.' },
          ui: { type: 'job', job },
        }, { decision: cached ? 'executed' : 'queued', validation: 'ok', args, refId: job.id, tokensReserved: cached ? 0 : job.tokenCost });
      }

      throw new Error(`unsupported tool kind ${tool.kind}`);
    } catch (err) {
      if (err instanceof AppError) {
        const ui = err.code === 'INSUFFICIENT_TOKENS' ? { type: 'insufficient_tokens', ...err.details } : undefined;
        return finish({ ...errorResult(err.code, err.message, err.details), ui }, {
          decision: DECISION_BY_CODE[err.code] || 'failed', validation: 'ok', args, errorCode: err.code,
        });
      }
      logger.error({ err, tool: call.name, requestId: ctx.requestId }, 'tool crashed');
      return finish(errorResult('TOOL_FAILED', 'Something went wrong while doing that.'), { decision: 'failed', validation: 'ok', args, errorCode: 'TOOL_FAILED' });
    }
  };
}

module.exports = { createExecutor };
