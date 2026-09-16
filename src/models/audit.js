'use strict';
const { Schema, model, models } = require('mongoose');

const ToolCallSchema = new Schema({
  merchantId: { type: String, required: true },
  userId: { type: String },
  conversationId: { type: String },
  requestId: { type: String },
  tool: { type: String, required: true },
  args: { type: Schema.Types.Mixed },
  validation: { type: String, enum: ['ok', 'failed'] },
  decision: {
    type: String,
    enum: ['executed', 'pending_confirmation', 'queued', 'rejected_validation', 'rejected_policy',
      'insufficient_tokens', 'rate_limited', 'failed', 'unknown_tool', 'unknown_outcome'],
  },
  resultSummary: { type: Schema.Types.Mixed },
  errorCode: { type: String },
  tokensReserved: { type: Number, default: 0 },
  latencyMs: { type: Number },
  refId: { type: String },
}, { timestamps: { createdAt: true, updatedAt: false }, collection: 'tool_calls' });
ToolCallSchema.index({ merchantId: 1, createdAt: -1 });
ToolCallSchema.index({ requestId: 1 });

const AdminAuditSchema = new Schema({
  actor: String, action: String, merchantId: String, details: Schema.Types.Mixed,
}, { timestamps: { createdAt: true, updatedAt: false }, collection: 'admin_audit' });

module.exports = {
  ToolCall: models.ToolCall || model('ToolCall', ToolCallSchema),
  AdminAudit: models.AdminAudit || model('AdminAudit', AdminAuditSchema),
};
