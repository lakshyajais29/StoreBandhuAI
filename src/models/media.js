'use strict';
const { Schema, model, models } = require('mongoose');

const AssetSchema = new Schema({
  _id: { type: String },
  merchantId: { type: String, required: true },
  kind: { type: String, enum: ['upload', 'generated'], required: true },
  status: { type: String, enum: ['pending_upload', 'ready', 'rejected'], default: 'pending_upload' },
  key: { type: String, required: true },
  url: { type: String },
  mime: { type: String },
  bytes: { type: Number },
  sha256: { type: String },
  sourceJobId: { type: String },
}, { timestamps: true, collection: 'assets' });
AssetSchema.index({ merchantId: 1, createdAt: -1 });

const MediaJobSchema = new Schema({
  _id: { type: String },
  merchantId: { type: String, required: true },
  userId: { type: String },
  conversationId: { type: String },
  kind: { type: String, enum: ['image', 'video'], required: true },
  model: { type: String },
  routeReason: { type: String },
  input: { type: Schema.Types.Mixed, required: true },
  cacheKey: { type: String, required: true },
  reservationId: { type: String },
  tokenCost: { type: Number, required: true },
  status: { type: String, enum: ['queued', 'running', 'succeeded', 'failed'], default: 'queued' },
  attempts: { type: Number, default: 0 },
  startedAt: { type: Date },
  finishedAt: { type: Date },
  resultAssetId: { type: String },
  resultUrl: { type: String },
  attachStatus: { type: String, enum: ['not_requested', 'attached', 'failed'], default: 'not_requested' },
  laravelMediaId: { type: String },
  errorCode: { type: String },
  errorMessage: { type: String },
  providerCostUsd: { type: Number },
}, { timestamps: true, collection: 'media_jobs' });
MediaJobSchema.index({ merchantId: 1, createdAt: -1 });
MediaJobSchema.index({ cacheKey: 1, status: 1 });
MediaJobSchema.index({ status: 1, startedAt: 1 });

module.exports = {
  Asset: models.Asset || model('Asset', AssetSchema),
  MediaJob: models.MediaJob || model('MediaJob', MediaJobSchema),
};
