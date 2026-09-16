'use strict';
const { defineTool, z } = require('../defineTool');
const { IMAGE_STYLE_COST } = require('../../config/tokens');

module.exports = defineTool({
  name: 'generate_product_image',
  description: `Create a clean product photo from an image the merchant attached (asset_id starts with ast_). Runs in the background. Styles and token cost: ${Object.entries(IMAGE_STYLE_COST).map(([k, v]) => `${k}=${v}`).join(', ')}. If no image is attached, ask the merchant to upload one. Pass product_id only if they want it added to a product.`,
  kind: 'async',
  feature: 'media',
  schema: z.object({
    asset_id: z.string().regex(/^ast_[\w-]+$/),
    style: z.enum(Object.keys(IMAGE_STYLE_COST)),
    product_id: z.string().min(1).max(64).optional(),
  }),
  jobSpec(args) {
    return { kind: 'image', assetId: args.asset_id, style: args.style, productId: args.product_id, params: {} };
  },
});
