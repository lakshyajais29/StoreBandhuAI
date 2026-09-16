'use strict';
/**
 * Bandhu Token cost table. Business-owned numbers: change here, not in tool code.
 * See docs/TASKS.md Appendix A and ADR-009.
 */
const IMAGE_STYLE_COST = { white_background: 6, studio: 8, lifestyle: 10, festive: 10 };
const VIDEO_STYLE_COST = { showcase: 25, lifestyle: 35, cinematic: 40 };

const costs = {
  chat_turn: () => require('./env').env().CHAT_TURN_COST,
  get_sales_summary: () => 0,
  search_products: () => 0,
  check_inventory: () => 0,
  get_wallet_balance: () => 0,
  search_customers: () => 0,
  get_order_status: () => 0,
  create_product_listing: () => 3,
  update_inventory: () => 3,
  create_order: () => 3,
  generate_product_image: (args) => IMAGE_STYLE_COST[args.style] ?? 10,
  generate_product_video: (args) => VIDEO_STYLE_COST[args.style] ?? 40,
};

function costOf(action, args = {}) {
  const fn = costs[action];
  if (!fn) throw new Error(`No token cost defined for action "${action}"`);
  const n = fn(args);
  if (!Number.isInteger(n) || n < 0) throw new Error(`Invalid cost for ${action}`);
  return n;
}

module.exports = { costOf, IMAGE_STYLE_COST, VIDEO_STYLE_COST };
