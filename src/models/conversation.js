'use strict';
const { Schema, model, models } = require('mongoose');

const ConversationSchema = new Schema({
  merchantId: { type: String, required: true },
  userId: { type: String, required: true },
  title: { type: String, default: 'New conversation' },
  lastMessageAt: { type: Date, default: Date.now },
  status: { type: String, enum: ['active', 'archived'], default: 'active' },
}, { timestamps: true, collection: 'conversations' });
ConversationSchema.index({ merchantId: 1, lastMessageAt: -1 });

const ToolCallSubSchema = new Schema({ id: String, name: String, arguments: String }, { _id: false });

const MessageSchema = new Schema({
  conversationId: { type: Schema.Types.ObjectId, required: true, ref: 'Conversation' },
  merchantId: { type: String, required: true },
  role: { type: String, enum: ['user', 'assistant', 'tool', 'system_event'], required: true },
  content: { type: String, default: '' },
  toolCalls: { type: [ToolCallSubSchema], default: undefined },
  toolCallId: { type: String },
  toolName: { type: String },
  attachments: { type: [String], default: undefined },
  ui: { type: Schema.Types.Mixed },
  llmUsage: { type: Schema.Types.Mixed },
  promptVersion: { type: String },
  requestId: { type: String },
}, { timestamps: { createdAt: true, updatedAt: false }, collection: 'messages' });
MessageSchema.index({ conversationId: 1, createdAt: 1 });

module.exports = {
  Conversation: models.Conversation || model('Conversation', ConversationSchema),
  Message: models.Message || model('Message', MessageSchema),
};
