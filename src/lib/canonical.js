'use strict';
const crypto = require('node:crypto');

/** Deterministic JSON (sorted keys) so the same args always hash the same. */
function canonicalJSON(value) {
  if (value === null || typeof value !== 'object') return JSON.stringify(value);
  if (Array.isArray(value)) return `[${value.map(canonicalJSON).join(',')}]`;
  const keys = Object.keys(value).filter((k) => value[k] !== undefined).sort();
  return `{${keys.map((k) => `${JSON.stringify(k)}:${canonicalJSON(value[k])}`).join(',')}}`;
}

const sha256 = (s) => crypto.createHash('sha256').update(s).digest('hex');
const hashArgs = (args) => sha256(canonicalJSON(args));

module.exports = { canonicalJSON, sha256, hashArgs };
