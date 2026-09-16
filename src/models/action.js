'use strict';
const { Schema, model, models } = require('mongoose');

const PendingActionSchema = new Schema({
  _id: { type: String },
  merchantId: { type: String, required: true },
  userId: { type: String, required: true },
  conversationId: { type: String },
  tool: { type: String, required: true },
  args: { type: Schema.Types.Mixed, required: true },
  argsHash: { type: String, required: true },
  preview: { type: Schema.Types.Mixed },
  tokenCost: { type: Number, required: true },
  reservationId: { type: String },
  requiresConfirmation: { type: Boolean, required: true },
  status: {
    type: String, required: true,
    enum: ['awaiting_confirmation', 'executing', 'succeeded', 'failed', 'unknown', 'cancelled', 'expired'],
  },
  result: { type: Schema.Types.Mixed },
  error: { type: Schema.Types.Mixed },
  expiresAt: { type: Date },
  executingSince: { type: Date },
  confirmedBy: { type: String },
  settledAt: { type: Date },
  reconcileAttempts: { type: Number, default: 0 },
}, { timestamps: true, collection: 'pending_actions', minimize: false });
PendingActionSchema.index({ merchantId: 1, createdAt: -1 });
PendingActionSchema.index({ status: 1, expiresAt: 1 });

module.exports = { PendingAction: models.PendingAction || model('PendingAction', PendingActionSchema) };
