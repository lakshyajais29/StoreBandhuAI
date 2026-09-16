'use strict';
const { defineTool, z, rupees } = require('../defineTool');

module.exports = defineTool({
  name: 'create_order',
  description: 'Prepare an order for a customer. Needs customer_ref and address_ref from search_customers and product_id values from search_products. The store calculates prices, tax and shipping; the merchant ALWAYS has to press Confirm before the order is placed. Costs 3 tokens when placed.',
  kind: 'write',
  feature: 'orders',
  schema: z.object({
    customer_ref: z.string().min(1).max(64),
    address_ref: z.string().min(1).max(64),
    items: z.array(z.object({
      product_id: z.string().min(1).max(64),
      variant_id: z.string().min(1).max(64).optional(),
      qty: z.number().int().min(1).max(1000),
    })).min(1).max(50),
    payment_mode: z.enum(['cod', 'prepaid_link']).default('cod'),
  }),
  async prepare(args, ctx) {
    const q = await ctx.laravel.quoteOrder(args, { signal: ctx.signal });
    return {
      args: { quote_id: q.quote_id },
      requiresConfirmation: true,
      preview: {
        kind: 'order',
        quote_id: q.quote_id, expires_at: q.expires_at, payment_mode: args.payment_mode,
        customer: q.customer_display, address: q.address_display,
        items: (q.items || []).map((i) => ({ title: i.title, qty: i.qty, unit_price_rupees: rupees(i.unit_price_paise), line_total_rupees: rupees(i.line_total_paise), in_stock: i.in_stock })),
        subtotal_rupees: rupees(q.subtotal_paise), tax_rupees: rupees(q.tax_paise), shipping_rupees: rupees(q.shipping_paise), total_rupees: rupees(q.total_paise),
        warnings: q.warnings || [],
      },
    };
  },
  async execute(payload, ctx, { idempotencyKey }) {
    return ctx.laravel.createOrder(payload, { idempotencyKey, signal: ctx.signal });
  },
  summarize(result) {
    return `Order ${result.order_number || result.order_id} placed. Total ₹${rupees(result.total_paise)}.`;
  },
});
