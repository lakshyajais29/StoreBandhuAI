'use strict';
const { defineTool, z, rupees } = require('../defineTool');
const { resolveMerchantAssets } = require('../../domain/jobs/assets');

module.exports = defineTool({
  name: 'create_product_listing',
  description: 'Prepare a new product listing (title, price, category, optional description, images, stock). This does NOT publish immediately: it creates a preview the merchant must confirm with the Confirm button. Ask for the price if the merchant did not give one. Costs 3 tokens when confirmed.',
  kind: 'write',
  feature: 'writes',
  schema: z.object({
    title: z.string().min(3).max(150),
    price_rupees: z.number().positive().max(10000000).describe('Selling price in rupees, e.g. 499'),
    category: z.string().min(2).max(80).describe('Category name as the merchant said it'),
    description: z.string().max(2000).optional(),
    image_asset_ids: z.array(z.string().regex(/^ast_[\w-]+$/)).max(8).optional().describe('IDs of images the merchant attached (ast_...)'),
    stock: z.number().int().min(0).max(1000000).optional(),
    sku: z.string().max(64).optional(),
  }),
  async prepare(args, ctx) {
    const assets = await resolveMerchantAssets(ctx.merchantId, args.image_asset_ids || []);
    const draft = {
      title: args.title, description: args.description || '', price_paise: Math.round(args.price_rupees * 100),
      category_name: args.category, image_urls: assets.map((a) => a.url), sku: args.sku, stock: args.stock,
    };
    const preview = await ctx.laravel.previewListing(draft, { signal: ctx.signal });
    const payload = { ...draft, ...(preview.normalized || {}) };
    return {
      args: payload,
      requiresConfirmation: true,
      preview: {
        kind: 'listing',
        title: payload.title, price_rupees: rupees(payload.price_paise), category: preview.normalized?.category_name || args.category,
        category_id: payload.category_id, description: payload.description, image_urls: payload.image_urls, stock: payload.stock ?? null,
        warnings: preview.warnings || [],
      },
    };
  },
  async execute(payload, ctx, { idempotencyKey }) {
    return ctx.laravel.createListing(payload, { idempotencyKey, signal: ctx.signal });
  },
  summarize(result, payload) {
    return `Listing "${payload.title}" created (product ${result.product_id}, ${result.status}).`;
  },
});
