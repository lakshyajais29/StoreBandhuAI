'use strict';
const { defineTool, z } = require('../defineTool');
const { VIDEO_STYLE_COST } = require('../../config/tokens');

module.exports = defineTool({
  name: 'generate_product_video',
  description: `Create a short 5-second product video from an image (asset_id ast_...). Runs in the background and is the most expensive action. Styles and token cost: ${Object.entries(VIDEO_STYLE_COST).map(([k, v]) => `${k}=${v}`).join(', ')}. Set has_person to "yes" only if the merchant says a person/model is in the photo, "no" if they say there isn't, otherwise "unknown".`,
  kind: 'async',
  feature: 'video',
  schema: z.object({
    asset_id: z.string().regex(/^ast_[\w-]+$/),
    style: z.enum(Object.keys(VIDEO_STYLE_COST)),
    has_person: z.enum(['yes', 'no', 'unknown']).default('unknown'),
    product_id: z.string().min(1).max(64).optional(),
  }),
  jobSpec(args) {
    return { kind: 'video', assetId: args.asset_id, style: args.style, productId: args.product_id, params: { duration: 5, hasPerson: args.has_person } };
  },
});
