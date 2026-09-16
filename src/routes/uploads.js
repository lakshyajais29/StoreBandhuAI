'use strict';
const express = require('express');
const { Asset } = require('../models/media');
const { storage } = require('../integrations/storage');
const { env } = require('../config/env');
const { newId } = require('../lib/ids');
const { E, AppError } = require('../lib/errors');

const router = express.Router();
const MIME_EXT = { 'image/jpeg': 'jpg', 'image/png': 'png', 'image/webp': 'webp' };

function sniffMime(buf) {
  if (buf.length >= 3 && buf[0] === 0xff && buf[1] === 0xd8 && buf[2] === 0xff) return 'image/jpeg';
  if (buf.length >= 8 && buf.subarray(0, 8).equals(Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]))) return 'image/png';
  if (buf.length >= 12 && buf.subarray(0, 4).toString() === 'RIFF' && buf.subarray(8, 12).toString() === 'WEBP') return 'image/webp';
  return null;
}

router.post('/uploads', async (req, res) => {
  const { mime, bytes } = req.body || {};
  if (!MIME_EXT[mime]) throw E.validation([{ field: 'mime', problem: 'only JPEG, PNG or WebP images' }]);
  if (!Number.isInteger(bytes) || bytes <= 0 || bytes > env().UPLOAD_MAX_BYTES) {
    throw E.validation([{ field: 'bytes', problem: `must be 1..${env().UPLOAD_MAX_BYTES}` }]);
  }
  const id = newId('ast');
  const key = `uploads/${req.auth.merchantId}/${id}.${MIME_EXT[mime]}`;
  await Asset.create({ _id: id, merchantId: req.auth.merchantId, kind: 'upload', status: 'pending_upload', key, mime, bytes });
  const target = await storage().createUploadTarget({ key, mime, assetId: id });
  res.status(201).json({ assetId: id, upload: target });
});

// Local development driver only: receives the file body directly.
router.put('/uploads/:id/content', express.raw({ type: () => true, limit: '12mb' }), async (req, res) => {
  if (storage().name !== 'local') throw E.notFound('Route');
  const a = await Asset.findOne({ _id: req.params.id, merchantId: req.auth.merchantId, status: 'pending_upload' });
  if (!a) throw E.notFound('Upload');
  if (!Buffer.isBuffer(req.body) || req.body.length === 0) throw E.validation([{ field: 'body', problem: 'empty file' }]);
  if (req.body.length > env().UPLOAD_MAX_BYTES) throw new AppError('PAYLOAD_TOO_LARGE', 413, 'File too large');
  await storage().putObject({ key: a.key, body: req.body, mime: a.mime });
  res.status(204).end();
});

router.post('/uploads/:id/complete', async (req, res) => {
  const a = await Asset.findOne({ _id: req.params.id, merchantId: req.auth.merchantId });
  if (!a) throw E.notFound('Upload');
  if (a.status === 'ready') return res.json({ assetId: a._id, url: a.url, status: a.status });
  const head = await storage().headObject(a.key);
  if (!head) throw new AppError('UPLOAD_MISSING', 409, 'File has not been uploaded yet');
  const reject = async (problem) => {
    await Asset.updateOne({ _id: a._id }, { $set: { status: 'rejected' } });
    throw E.validation([{ field: 'file', problem }]);
  };
  if (head.bytes > env().UPLOAD_MAX_BYTES) return reject('file too large');
  const buf = await storage().readBuffer(a.key);
  const sniffed = sniffMime(buf.subarray(0, 16));
  if (!sniffed) return reject('not a JPEG, PNG or WebP image');
  const url = storage().publicUrl(a.key);
  const sha = require('../lib/canonical').sha256(buf);
  await Asset.updateOne({ _id: a._id }, { $set: { status: 'ready', bytes: buf.length, mime: sniffed, url, sha256: sha } });
  // TODO(P3-01): strip EXIF metadata (GPS) before the file is used publicly — e.g. with `sharp` in the worker.
  return res.json({ assetId: a._id, url, status: 'ready' });
});

module.exports = router;
module.exports.sniffMime = sniffMime;
