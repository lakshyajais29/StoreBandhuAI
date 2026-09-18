'use strict';
const mongoose = require('mongoose');
const { Conversation, Message } = require('../../models/conversation');
const { Asset } = require('../../models/media');
const { E } = require('../../lib/errors');

const MAX_TITLE = 80;

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

async function list(merchantId, { limit = 20, before, status = 'active' } = {}) {
  const q = { merchantId, status };
  if (before) {
    const d = new Date(String(before));
    if (Number.isNaN(d.getTime())) throw E.validation([{ field: 'before', problem: 'invalid date' }]);
    q.lastMessageAt = { $lt: d };
  }
  return Conversation.find(q).sort({ lastMessageAt: -1 }).limit(Math.min(limit, 50)).lean();
}

/** Merchant-facing view: hides raw tool plumbing. Shape unchanged — attachments stay asset ids. */
function publicMessage(m) {
  if (m.role === 'tool') return null;
  if (m.role === 'assistant' && !m.content && m.toolCalls?.length) return null;
  return { id: String(m._id), role: m.role, content: m.content, ui: m.ui || null, attachments: m.attachments || [], createdAt: m.createdAt };
}

const publicConversation = (c) => ({ id: String(c._id), title: c.title, status: c.status, lastMessageAt: c.lastMessageAt });

/** Batch-resolve the assets referenced by a conversation, scoped to the merchant. */
async function assetsFor(merchantId, messages) {
  const ids = [...new Set(messages.flatMap((m) => m.attachments || []))];
  if (!ids.length) return {};
  const rows = await Asset.find({ _id: { $in: ids }, merchantId, status: 'ready' }).select('_id url mime').lean();
  return Object.fromEntries(rows.map((a) => [a._id, { id: a._id, url: a.url || null, mime: a.mime || null }]));
}

async function getWithMessages(merchantId, conversationId) {
  if (!mongoose.isValidObjectId(conversationId)) throw E.notFound('Conversation');
  const c = await Conversation.findOne({ _id: conversationId, merchantId }).lean();
  if (!c) throw E.notFound('Conversation');
  const msgs = await Message.find({ conversationId }).sort({ createdAt: 1, _id: 1 }).limit(500).lean();
  const assets = await assetsFor(merchantId, msgs);
  return { conversation: c, messages: msgs.map(publicMessage).filter(Boolean), assets };
}

/** Rename. Title is merchant-supplied text, never LLM output. */
async function rename(merchantId, conversationId, title) {
  if (!mongoose.isValidObjectId(conversationId)) throw E.notFound('Conversation');
  const clean = String(title ?? '').trim().slice(0, MAX_TITLE);
  if (!clean) throw E.validation([{ field: 'title', problem: `must be 1..${MAX_TITLE} characters` }]);
  const c = await Conversation.findOneAndUpdate({ _id: conversationId, merchantId }, { $set: { title: clean } }, { returnDocument: 'after' });
  if (!c) throw E.notFound('Conversation');
  return publicConversation(c);
}

/** Archive / restore. Soft only — messages, actions and ledger rows are never deleted. */
async function setStatus(merchantId, conversationId, status) {
  if (!mongoose.isValidObjectId(conversationId)) throw E.notFound('Conversation');
  if (!['active', 'archived'].includes(status)) throw E.validation([{ field: 'status', problem: 'must be active or archived' }]);
  const c = await Conversation.findOneAndUpdate({ _id: conversationId, merchantId }, { $set: { status } }, { returnDocument: 'after' });
  if (!c) throw E.notFound('Conversation');
  return publicConversation(c);
}

module.exports = {
  getOrCreate, append, appendSystemEvent, history, list,
  publicMessage, publicConversation, getWithMessages, rename, setStatus, MAX_TITLE,
};
