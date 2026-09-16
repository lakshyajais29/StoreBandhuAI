'use strict';
const { Asset } = require('../../models/media');
const { AppError } = require('../../lib/errors');

/** Load assets and assert they belong to the merchant and are ready. Never trust IDs from the LLM/client. */
async function resolveMerchantAssets(merchantId, ids) {
  if (!ids?.length) return [];
  const unique = [...new Set(ids)];
  const assets = await Asset.find({ _id: { $in: unique }, merchantId, status: 'ready' }).lean();
  if (assets.length !== unique.length) {
    throw new AppError('ASSET_NOT_FOUND', 422, 'One or more images were not found. Please upload them again.');
  }
  const byId = new Map(assets.map((a) => [a._id, a]));
  return unique.map((id) => byId.get(id));
}

module.exports = { resolveMerchantAssets };
