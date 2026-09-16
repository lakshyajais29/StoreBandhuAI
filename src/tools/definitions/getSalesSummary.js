'use strict';
const { defineTool, z, rupees } = require('../defineTool');

const DATE = z.string().regex(/^\d{4}-\d{2}-\d{2}$/, 'YYYY-MM-DD');

function ymd(date, tz) {
  return new Intl.DateTimeFormat('en-CA', { timeZone: tz, year: 'numeric', month: '2-digit', day: '2-digit' }).format(date);
}

/** Resolve a named range to inclusive local dates in the merchant's timezone. */
function resolveRange({ range, from, to }, tz = 'Asia/Kolkata', now = new Date()) {
  const day = 86400000;
  const today = ymd(now, tz);
  const [y, m] = today.split('-').map(Number);
  const shift = (n) => ymd(new Date(now.getTime() - n * day), tz);
  switch (range) {
    case 'today': return { from: today, to: today };
    case 'yesterday': return { from: shift(1), to: shift(1) };
    case 'last_7_days': return { from: shift(6), to: today };
    case 'last_30_days': return { from: shift(29), to: today };
    case 'this_month': return { from: `${today.slice(0, 7)}-01`, to: today };
    case 'last_month': {
      const py = m === 1 ? y - 1 : y;
      const pm = m === 1 ? 12 : m - 1;
      const last = new Date(Date.UTC(py, pm, 0)).getUTCDate();
      const mm = String(pm).padStart(2, '0');
      return { from: `${py}-${mm}-01`, to: `${py}-${mm}-${String(last).padStart(2, '0')}` };
    }
    case 'custom':
      if (!from || !to) return null;
      return from <= to ? { from, to } : { from: to, to: from };
    default: return null;
  }
}

module.exports = defineTool({
  name: 'get_sales_summary',
  description: 'Get sales totals (orders, units, revenue, top products) for a date range. Use for questions like "what did I sell this week", "aaj kitna becha", "last month revenue". Read-only and free.',
  kind: 'read',
  schema: z.object({
    range: z.enum(['today', 'yesterday', 'last_7_days', 'last_30_days', 'this_month', 'last_month', 'custom'])
      .describe('Named range. Use custom only with explicit from/to dates. "this week" means last_7_days.'),
    from: DATE.optional().describe('Start date YYYY-MM-DD, only for custom'),
    to: DATE.optional().describe('End date YYYY-MM-DD, only for custom'),
  }),
  async run(args, ctx) {
    const dates = resolveRange(args, ctx.timezone);
    if (!dates) return { ok: false, error: { code: 'INVALID_RANGE', message: 'custom range needs from and to dates' } };
    const s = await ctx.laravel.salesSummary(dates, { signal: ctx.signal });
    return {
      from: s.from, to: s.to, orders: s.orders_count, units_sold: s.units_sold,
      gross_rupees: rupees(s.gross_paise), net_rupees: rupees(s.net_paise), refunds_rupees: rupees(s.refunds_paise),
      top_products: (s.top_products || []).slice(0, 5).map((p) => ({ product_id: p.product_id, title: p.title, units: p.units, revenue_rupees: rupees(p.revenue_paise) })),
    };
  },
});
module.exports.resolveRange = resolveRange;
