'use strict';
const { defineTool, z, rupees } = require('../defineTool');

module.exports = defineTool({
  name: 'search_products',
  description: "Find the merchant's products by name, SKU or keyword. Use this first whenever the merchant names a product but you don't have its product_id. Returns up to 10 matches with stock and price.",
  kind: 'read',
  schema: z.object({
    query: z.string().min(1).max(100).describe('Product name, SKU or keywords'),
    limit: z.number().int().min(1).max(10).default(5),
  }),
  async run(args, ctx) {
    const res = await ctx.laravel.searchProducts({ q: args.query, limit: args.limit }, { signal: ctx.signal });
    const data = (res.data || []).map((p) => ({
      product_id: String(p.product_id), title: p.title, sku: p.sku, price_rupees: rupees(p.price_paise), stock: p.stock, status: p.status, variants: p.variants_count,
    }));
    return { count: data.length, products: data };
  },
});
