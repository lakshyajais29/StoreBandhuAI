'use strict';
const { Schema, model, models } = require('mongoose');

/** Authoritative balance per merchant. Two buckets so trial tokens can be excluded from video. */
const WalletSchema = new Schema({
  merchantId: { type: String, required: true, unique: true },
  paidAvailable: { type: Number, required: true, default: 0, min: 0 },
  trialAvailable: { type: Number, required: true, default: 0, min: 0 },
  reserved: { type: Number, required: true, default: 0, min: 0 },
  version: { type: Number, required: true, default: 0 },
  planCode: { type: String, default: 'trial' },
  planStatus: { type: String, enum: ['active', 'expired', 'none'], default: 'active' },
  planRenewsAt: { type: Date },
  trialGrantedAt: { type: Date },
}, { timestamps: true, collection: 'wallets' });

WalletSchema.virtual('available').get(function available() {
  return this.paidAvailable + this.trialAvailable;
});

/** Append-only. Never update or delete documents in this collection. */
const LedgerSchema = new Schema({
  merchantId: { type: String, required: true },
  type: { type: String, required: true, enum: ['purchase', 'grant', 'reserve', 'commit', 'release', 'refund', 'expire', 'adjust'] },
  tokens: { type: Number, required: true }, // signed change in AVAILABLE tokens
  spent: { type: Number, default: 0 }, // only on commit rows: tokens actually consumed
  availableAfter: { type: Number, required: true },
  reservedAfter: { type: Number, required: true },
  actionType: { type: String },
  actionRef: { type: String, required: true },
  reservationId: { type: String },
  lotId: { type: String },
  actorType: { type: String, enum: ['system', 'merchant', 'admin'], default: 'system' },
  actorId: { type: String },
  reason: { type: String },
  requestId: { type: String },
}, { timestamps: { createdAt: true, updatedAt: false }, collection: 'wallet_ledger' });
LedgerSchema.index({ merchantId: 1, createdAt: -1 });
LedgerSchema.index({ actionRef: 1, type: 1 }, { unique: true });
const blockMutation = function block() { throw new Error('wallet_ledger is append-only'); };
for (const op of ['updateOne', 'updateMany', 'findOneAndUpdate', 'deleteOne', 'deleteMany', 'findOneAndDelete', 'replaceOne']) {
  LedgerSchema.pre(op, blockMutation);
}

const TokenLotSchema = new Schema({
  _id: { type: String },
  merchantId: { type: String, required: true },
  source: { type: String, enum: ['plan', 'topup', 'trial', 'bonus', 'adjust'], required: true },
  granted: { type: Number, required: true },
  remaining: { type: Number, required: true, min: 0 },
  expiresAt: { type: Date },
  ref: { type: String },
}, { timestamps: true, collection: 'token_lots' });
TokenLotSchema.index({ merchantId: 1, source: 1, expiresAt: 1 });
TokenLotSchema.index({ expiresAt: 1, remaining: 1 });

const ReservationSchema = new Schema({
  _id: { type: String },
  merchantId: { type: String, required: true },
  tokens: { type: Number, required: true, min: 0 },
  fromTrial: { type: Number, required: true, default: 0 },
  fromPaid: { type: Number, required: true, default: 0 },
  status: { type: String, enum: ['held', 'committed', 'released'], default: 'held' },
  purpose: { type: String, enum: ['chat_turn', 'pending_action', 'media_job', 'sync_write'], required: true },
  actionType: { type: String, required: true },
  refId: { type: String, required: true },
  expiresAt: { type: Date, required: true },
}, { timestamps: true, collection: 'reservations' });
ReservationSchema.index({ status: 1, expiresAt: 1 });
ReservationSchema.index({ merchantId: 1, status: 1 });

module.exports = {
  Wallet: models.Wallet || model('Wallet', WalletSchema),
  Ledger: models.Ledger || model('Ledger', LedgerSchema),
  TokenLot: models.TokenLot || model('TokenLot', TokenLotSchema),
  Reservation: models.Reservation || model('Reservation', ReservationSchema),
};
