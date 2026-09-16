'use strict';
const { Router } = require('express');
const jobs = require('../domain/jobs/service');
const { MediaJob } = require('../models/media');
const { laravel } = require('../integrations/laravel/client');
const { E, AppError } = require('../lib/errors');

const router = Router();

router.get('/jobs', async (req, res) => res.json({ data: await jobs.list(req.auth.merchantId, Number(req.query.limit) || 20) }));
router.get('/jobs/:id', async (req, res) => res.json(await jobs.get(req.auth.merchantId, req.params.id)));

/** Attach a finished result to a product — never charged again. */
router.post('/jobs/:id/attach', async (req, res) => {
  const j = await MediaJob.findOne({ _id: req.params.id, merchantId: req.auth.merchantId, status: 'succeeded' });
  if (!j) throw E.notFound('Finished job');
  const productId = String(req.body?.productId || j.input.productId || '');
  if (!productId) throw E.validation([{ field: 'productId', problem: 'required' }]);
  try {
    const r = await laravel().forMerchant({ ...req.auth, requestId: req.id })
      .attachMedia(productId, { url: j.resultUrl, kind: j.kind, source: 'bandhu_ai', set_as_primary: false }, { idempotencyKey: `media-${j._id}-${productId}` });
    await MediaJob.updateOne({ _id: j._id }, { $set: { attachStatus: 'attached', laravelMediaId: String(r.media_id), 'input.productId': productId } });
  } catch (err) {
    await MediaJob.updateOne({ _id: j._id }, { $set: { attachStatus: 'failed' } });
    if (err instanceof AppError) throw err;
    throw new AppError('ATTACH_FAILED', 502, 'Could not add the file to the product');
  }
  res.json(await jobs.get(req.auth.merchantId, j._id));
});

module.exports = router;
