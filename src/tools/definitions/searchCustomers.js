'use strict';
const { defineTool, z } = require('../defineTool');

module.exports = defineTool({
  name: 'search_customers',
  description: "Find the merchant's customers by name, phone or city to get a customer_ref and address_ref for an order. Results are masked. If several match, ask the merchant which one.",
  kind: 'read',
  feature: 'orders',
  schema: z.object({ query: z.string().min(2).max(100), limit: z.number().int().min(1).max(10).default(5) }),
  async run(args, ctx) {
    const res = await ctx.laravel.searchCustomers({ q: args.query, limit: args.limit }, { signal: ctx.signal });
    return {
      count: (res.data || []).length,
      customers: (res.data || []).map((c) => ({
        customer_ref: c.customer_ref, name: c.display_name, phone: c.masked_phone, city: c.city,
        addresses: (c.addresses || []).map((a) => ({ address_ref: a.address_ref, label: a.label, city: a.city, pincode: a.pincode })),
      })),
    };
  },
});
