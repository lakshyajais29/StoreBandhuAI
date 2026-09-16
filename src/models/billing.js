'use strict';
const { Schema, model, models } = require('mongoose');

const PaymentSchema = new Schema({
  _id: { type: String },
  merchantId: { type: String, required: true },
  kind: { type: String, enum: ['topup', 'plan'], required: true },
  itemCode: { type: String, required: true },
  tokens: { type: Number, required: true },
  amountPaise: { type: Number, required: true },
  currency: { type: String, default: 'INR' },
  razorpayOrderId: { type: String, unique: true, sparse: true },
  razorpayPaymentId: { type: String, unique: true, sparse: true },
  status: { type: String, enum: ['created', 'paid', 'failed', 'refunded'], default: 'created' },
  paidAt: { type: Date },
  invoice: { type: Schema.Types.Mixed },
}, { timestamps: true, collection: 'payments' });
PaymentSchema.index({ merchantId: 1, createdAt: -1 });

const WebhookEventSchema = new Schema({
  provider: { type: String, required: true },
  eventId: { type: String, required: true },
  type: { type: String },
  payload: { type: Schema.Types.Mixed },
  processedAt: { type: Date },
  error: { type: String },
}, { timestamps: true, collection: 'webhook_events' });
WebhookEventSchema.index({ provider: 1, eventId: 1 }, { unique: true });

module.exports = {
  Payment: models.Payment || model('Payment', PaymentSchema),
  WebhookEvent: models.WebhookEvent || model('WebhookEvent', WebhookEventSchema),
};
