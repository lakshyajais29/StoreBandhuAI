'use strict';
const { defineTool, z } = require('../defineTool');
const policies = require('../../config/policies');
const { AppError } = require('../../lib/errors');

module.exports = defineTool({
  name: 'update_inventory',
  description: 'Change stock for a product. mode "set" sets the exact stock ("stock 10 kar do"); mode "adjust" adds or removes units ("10 aur add karo" = +10, "5 kam karo" = -5). Needs product_id (search first). Large changes need the merchant to press Confirm. Costs 3 tokens.',
  kind: 'write',
  feature: 'writes',
  schema: z.object({
    product_id: z.string().min(1).max(64),
    variant_id: z.string().min(1).max(64).optional(),
    mode: z.enum(['set', 'adjust']),
    quantity: z.number().int().min(-1000000).max(1000000).describe('For set: new stock (>= 0). For adjust: units to add (negative to remove).'),
  }),
  async prepare(args, ctx) {
    if (args.mode === 'set' && args.quantity < 0) throw new AppError('INVALID_QUANTITY', 422, 'Stock cannot be set below zero');
    const inv = await ctx.laravel.getInventory(args.product_id, { signal: ctx.signal });
    let current = inv.stock;
    let label = inv.title;
    if (args.variant_id) {
      const v = (inv.variants || []).find((x) => String(x.variant_id) === String(args.variant_id));
      if (!v) throw new AppError('VARIANT_NOT_FOUND', 404, 'That variant does not exist for this product');
      current = v.stock;
      label = `${inv.title} – ${v.title}`;
    }
    const next = args.mode === 'set' ? args.quantity : current + args.quantity;
    if (next < 0) throw new AppError('NEGATIVE_STOCK', 422, `Only ${current} in stock; cannot remove ${Math.abs(args.quantity)}`);
    const delta = next - current;
    const c = policies.confirmation;
    const requiresConfirmation = Math.abs(delta) > c.inventoryDeltaThreshold || (c.inventoryConfirmOnSetToZero && next === 0 && current > 0);
    return {
      args: { product_id: String(args.product_id), variant_id: args.variant_id, mode: args.mode, quantity: args.quantity, reason: 'bandhu_ai' },
      requiresConfirmation,
      preview: { kind: 'inventory', title: label, current_stock: current, new_stock: next, delta },
    };
  },
  async execute(payload, ctx, { idempotencyKey }) {
    const { product_id: productId, ...body } = payload;
    return ctx.laravel.updateInventory(productId, body, { idempotencyKey, signal: ctx.signal });
  },
  summarize(result, _payload, preview) {
    return `Stock for ${preview?.title || `product ${result.product_id}`} is now ${result.new_stock} (was ${result.previous_stock}).`;
  },
});
