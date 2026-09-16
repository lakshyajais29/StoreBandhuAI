'use strict';
/** Guardrail thresholds (ADR-007). Numbers are policy, not code. */
module.exports = {
  confirmation: {
    inventoryDeltaThreshold: 500,
    inventoryConfirmOnSetToZero: true,
  },
  pendingActionTtlMinutes: 10,
  reservationTtlMinutes: { chat_turn: 5, pending_action: 20, media_job: 60, sync_write: 10 },
  chatRateLimit: { perMinute: 20, perDay: 300 },
  toolResultMaxBytes: 4000,
  maxUserMessageChars: 2000,
  stuckActionMinutes: 5,
};
