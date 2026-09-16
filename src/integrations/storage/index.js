'use strict';
/**
 * Storage abstraction. `local` is for development only (files served from /files).
 * `s3` works with AWS S3 or Cloudflare R2 (set S3_ENDPOINT).
 */
const fs = require('node:fs');
const fsp = require('node:fs/promises');
const path = require('node:path');
const crypto = require('node:crypto');
const { env } = require('../../config/env');

function localDriver() {
  const e = env();
  const root = path.resolve(e.LOCAL_STORAGE_DIR);
  const safe = (key) => {
    const p = path.resolve(root, key);
    if (!p.startsWith(root + path.sep)) throw new Error('invalid storage key');
    return p;
  };
  return {
    name: 'local',
    async createUploadTarget({ key, assetId }) {
      return { method: 'PUT', url: `${e.PUBLIC_BASE_URL}/api/uploads/${assetId}/content`, headers: {}, requiresAuth: true, key };
    },
    async putObject({ key, body }) {
      const p = safe(key);
      await fsp.mkdir(path.dirname(p), { recursive: true });
      await fsp.writeFile(p, body);
    },
    async headObject(key) {
      try {
        const st = await fsp.stat(safe(key));
        return { bytes: st.size };
      } catch { return null; }
    },
    async sha256(key) {
      const hash = crypto.createHash('sha256');
      await new Promise((resolve, reject) => fs.createReadStream(safe(key)).on('data', (d) => hash.update(d)).on('end', resolve).on('error', reject));
      return hash.digest('hex');
    },
    async readBuffer(key) { return fsp.readFile(safe(key)); },
    publicUrl(key) { return `${e.PUBLIC_BASE_URL}/files/${key}`; },
    root,
  };
}

function s3Driver() {
  const e = env();
  const { S3Client, PutObjectCommand, HeadObjectCommand, GetObjectCommand } = require('@aws-sdk/client-s3');
  const { getSignedUrl } = require('@aws-sdk/s3-request-presigner');
  const client = new S3Client({
    region: e.S3_REGION, endpoint: e.S3_ENDPOINT || undefined, forcePathStyle: Boolean(e.S3_ENDPOINT),
    credentials: { accessKeyId: e.S3_ACCESS_KEY_ID, secretAccessKey: e.S3_SECRET_ACCESS_KEY },
  });
  return {
    name: 's3',
    async createUploadTarget({ key, mime }) {
      const url = await getSignedUrl(client, new PutObjectCommand({ Bucket: e.S3_BUCKET, Key: key, ContentType: mime }), { expiresIn: 600 });
      return { method: 'PUT', url, headers: { 'Content-Type': mime }, requiresAuth: false, key };
    },
    async putObject({ key, body, mime }) {
      await client.send(new PutObjectCommand({ Bucket: e.S3_BUCKET, Key: key, Body: body, ContentType: mime }));
    },
    async headObject(key) {
      try {
        const r = await client.send(new HeadObjectCommand({ Bucket: e.S3_BUCKET, Key: key }));
        return { bytes: r.ContentLength, mime: r.ContentType };
      } catch { return null; }
    },
    async readBuffer(key) {
      const r = await client.send(new GetObjectCommand({ Bucket: e.S3_BUCKET, Key: key }));
      return Buffer.from(await r.Body.transformToByteArray());
    },
    async sha256(key) {
      return crypto.createHash('sha256').update(await this.readBuffer(key)).digest('hex');
    },
    publicUrl(key) { return `${e.CDN_BASE_URL.replace(/\/$/, '')}/${key}`; },
  };
}

let driver;
function storage() {
  if (!driver) driver = env().STORAGE_DRIVER === 's3' ? s3Driver() : localDriver();
  return driver;
}

module.exports = { storage };
