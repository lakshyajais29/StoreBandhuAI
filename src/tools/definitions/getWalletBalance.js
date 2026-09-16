'use strict';
const { defineTool, z } = require('../defineTool');
const wallet = require('../../domain/wallet/service');

module.exports = defineTool({
  name: 'get_wallet_balance',
  description: 'Get how many Bandhu Tokens the merchant has, their plan, and tokens expiring soon. Free.',
  kind: 'read',
  schema: z.object({}),
  async run(_args, ctx) {
    const b = await wallet.getBalance(ctx.merchantId);
    return { available_tokens: b.available, reserved_tokens: b.reserved, plan: b.planCode, plan_status: b.planStatus, plan_renews_at: b.planRenewsAt, expiring_soon: b.expiringSoon };
  },
});
