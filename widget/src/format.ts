export const rupees = (n: number | null | undefined) =>
  n == null ? '—' : `₹${n.toLocaleString('en-IN', { maximumFractionDigits: 2 })}`;

export const TOOL_LABEL: Record<string, string> = {
  create_product_listing: 'New listing',
  update_inventory: 'Stock change',
  create_order: 'New order',
};

export const STATUS_LABEL: Record<string, string> = {
  awaiting_confirmation: 'Waiting for you',
  executing: 'Working…',
  succeeded: 'Done',
  failed: 'Did not go through',
  unknown: 'Checking with your store',
  cancelled: 'Cancelled',
  expired: 'Expired',
  queued: 'Queued',
  running: 'Generating…',
};
