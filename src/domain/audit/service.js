'use strict';
const { ToolCall, AdminAudit } = require('../../models/audit');
const { redactForLog } = require('../../lib/pii');
const { logger } = require('../../lib/logger');

/** Best-effort: audit failures are logged loudly but never break the merchant request. */
async function recordToolCall(entry) {
  try {
    await ToolCall.create({ ...entry, args: redactForLog(entry.args) });
  } catch (err) {
    logger.error({ err, tool: entry.tool, requestId: entry.requestId }, 'AUDIT WRITE FAILED');
  }
}

async function recordAdmin(entry) {
  await AdminAudit.create(entry);
}

module.exports = { recordToolCall, recordAdmin };
