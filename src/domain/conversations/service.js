'use strict';
const mongoose = require('mongoose');
const { Conversation, Message } = require('../../models/conversation');
const { E } = require('../../lib/errors');

async function getOrCreate({ merchantId, userId }, conversationId, firstMessage) {
  if (conversationId) {
    if (!mongoose.isValidObjectId(conversationId)) throw E.notFound('Conversation');
    const c = await Conversation.findOne({ _id: conversationId, merchantId });
    if (!c) throw E.notFound('Conversation');
    return c;
  }
  return Conversation.create({ merchantId, userId, title: String(firstMessage || 'New conversation').slice(0, 60) });
}

async function append(conversation, messages) {
  if (!messages.length) return [];
  const docs = await Message.insertMany(messages.map((m) => ({ ...m, conversationId: conversation._id, merchantId: conversation.merchantId })));
  await Conversation.updateOne({ _id: conversation._id }, { $set: { lastMessageAt: new Date() } });
  return docs;
}

async function appendSystemEvent({ conversationId, merchantId, content, ui }) {
  if (!conversationId || !mongoose.isValidObjectId(conversationId)) return null;
  const c = await Conversation.findOne({ _id: conversationId, merchantId });
  if (!c) return null;
  const [doc] = await append(c, [{ role: 'system_event', content, ui }]);
  return doc;
}

async function history(conversationId, limit) {
  const rows = await Message.find({ conversationId }).sort({ createdAt: -1, _id: -1 }).limit(limit).lean();
  return rows.reverse();
}

async function list(merchantId, { limit = 20, before } = {}) {
  const q = { merchantId, status: 'active' };
  if (before) q.lastMessageAt = { $lt: new Date(before) };
  return Conversation.find(q).sort({ lastMessageAt: -1 }).limit(Math.min(limit, 50)).lean();
}

/** Merchant-facing view: hides raw tool plumbing. */
function publicMessage(m) {
  if (m.role === 'tool') return null;
  if (m.role === 'assistant' && !m.content && m.toolCalls?.length) return null;
  return { id: String(m._id), role: m.role, content: m.content, ui: m.ui || null, attachments: m.attachments || [], createdAt: m.createdAt };
}

async function getWithMessages(merchantId, conversationId) {
  if (!mongoose.isValidObjectId(conversationId)) throw E.notFound('Conversation');
  const c = await Conversation.findOne({ _id: conversationId, merchantId }).lean();
  if (!c) throw E.notFound('Conversation');
  const msgs = await Message.find({ conversationId }).sort({ createdAt: 1, _id: 1 }).limit(500).lean();
  return { conversation: c, messages: msgs.map(publicMessage).filter(Boolean) };
}

module.exports = { getOrCreate, append, appendSystemEvent, history, list, publicMessage, getWithMessages };
