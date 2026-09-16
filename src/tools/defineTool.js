'use strict';
/**
 * Tool contract. Every tool file exports defineTool({...}).
 *
 *  name, description         – what the LLM sees
 *  schema                    – zod object; JSON schema for the LLM is generated from it, so they can never drift
 *  kind: 'read'|'write'|'async'
 *  feature: null|'writes'|'media'|'video'|'orders'   – plan/flag gate
 *  read:   run(args, ctx) → data
 *  write:  prepare(args, ctx) → { args: frozenPayload, preview, requiresConfirmation }
 *          execute(frozenArgs, ctx, { idempotencyKey }) → result
 *          summarize(result, frozenArgs, preview) → merchant-facing text (template, not LLM)
 *  async:  jobSpec(args, ctx) → { kind, assetId, style, productId, params }
 */
const { z } = require('zod');

function defineTool(def) {
  for (const k of ['name', 'description', 'schema', 'kind']) {
    if (!def[k]) throw new Error(`tool definition missing "${k}"`);
  }
  if (def.kind === 'read' && typeof def.run !== 'function') throw new Error(`${def.name}: read tools need run()`);
  if (def.kind === 'write' && (typeof def.prepare !== 'function' || typeof def.execute !== 'function')) {
    throw new Error(`${def.name}: write tools need prepare() and execute()`);
  }
  if (def.kind === 'async' && typeof def.jobSpec !== 'function') throw new Error(`${def.name}: async tools need jobSpec()`);

  // io:'input' so fields with defaults are optional for the LLM (zod 4 defaults to output shape).
  const parameters = z.toJSONSchema(def.schema, { io: 'input' });
  delete parameters.$schema;
  return { feature: null, summarize: () => 'Done.', ...def, parameters };
}

const rupees = (paise) => (typeof paise === 'number' ? Math.round(paise) / 100 : null);

module.exports = { defineTool, z, rupees };
