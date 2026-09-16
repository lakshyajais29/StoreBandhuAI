'use strict';
const { defineTool, z, rupees } = require('../defineTool');

module.exports = defineTool({
  name: 'get_order_status',
  description: 'Get the current status of an order by its order_id or order number.',
  kind: 'read',
  schema: z.object({ order_id: z.string().min(1).max(64) }),
  async run(args, ctx) {
    const o = await ctx.laravel.getOrder(args.order_id, { signal: ctx.signal });
    return { order_id: String(o.order_id), order_number: o.order_number, status: o.status, payment_status: o.payment_status, fulfillment_status: o.fulfillment_status, total_rupees: rupees(o.total_paise), created_at: o.created_at };
  },
});
