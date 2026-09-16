'use strict';
const { defineTool, z } = require('../defineTool');

module.exports = defineTool({
  name: 'check_inventory',
  description: 'Get current stock for one product (and its variants) by product_id. If you only know the name, call search_products first.',
  kind: 'read',
  schema: z.object({ product_id: z.string().min(1).max(64) }),
  async run(args, ctx) {
    const inv = await ctx.laravel.getInventory(args.product_id, { signal: ctx.signal });
    return {
      product_id: String(inv.product_id), title: inv.title, sku: inv.sku, stock: inv.stock, low_stock_threshold: inv.low_stock_threshold,
      variants: (inv.variants || []).map((v) => ({ variant_id: String(v.variant_id), title: v.title, stock: v.stock })),
    };
  },
});
