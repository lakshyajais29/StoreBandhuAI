'use strict';
const { AppError } = require('../lib/errors');
const { logger } = require('../lib/logger');

function notFound(req, _res, next) {
  next(new AppError('NOT_FOUND', 404, `No route for ${req.method} ${req.path}`));
}

function errorHandler(err, req, res, _next) {
  let e = err;
  if (err?.type === 'entity.too.large') e = new AppError('PAYLOAD_TOO_LARGE', 413, 'Request body too large');
  else if (err?.type === 'entity.parse.failed') e = new AppError('INVALID_JSON', 400, 'Malformed JSON body');
  else if (!(err instanceof AppError)) e = new AppError('INTERNAL', 500, 'Something went wrong');

  if (e.status >= 500) logger.error({ err, requestId: req.id, path: req.path }, 'request failed');
  res.status(e.status).json({
    error: { code: e.code, message: e.expose ? e.message : 'Something went wrong', details: e.expose ? e.details : undefined, requestId: req.id },
  });
}

module.exports = { notFound, errorHandler };
