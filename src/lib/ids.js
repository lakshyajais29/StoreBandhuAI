'use strict';
const crypto = require('node:crypto');
const newId = (prefix) => `${prefix}_${crypto.randomBytes(12).toString('base64url')}`;
module.exports = { newId };
