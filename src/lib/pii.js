'use strict';
const crypto = require('node:crypto');

/**
 * Reversible PII masking for LLM payloads (ADR-006 option A).
 * Values become deterministic placeholders (HMAC-based, stable across turns).
 * The vault lives for one request: the executor unmasks tool args before use.
 */
const PATTERNS = [
  { kind: 'email', re: /[A-Z0-9._%+-]+@[A-Z0-9.-]+\.[A-Z]{2,}/gi },
  { kind: 'phone', re: /(?<![\w])(?:\+?91[\s-]?)?[6-9]\d{4}[\s-]?\d{5}(?![\w])/g },
];
const PLACEHOLDER = /<(?:email|phone)_[0-9a-f]{10}>/g;

function createVault(secret) {
  const map = new Map();

  const tokenFor = (kind, value) => {
    const h = crypto.createHmac('sha256', secret).update(`${kind}:${value}`).digest('hex').slice(0, 10);
    const ph = `<${kind}_${h}>`;
    map.set(ph, value);
    return ph;
  };

  const walk = (value, fn) => {
    if (typeof value === 'string') return fn(value);
    if (Array.isArray(value)) return value.map((v) => walk(v, fn));
    if (value && typeof value === 'object') {
      return Object.fromEntries(Object.entries(value).map(([k, v]) => [k, walk(v, fn)]));
    }
    return value;
  };

  const mask = (value) => walk(value, (s) => {
    let out = s;
    for (const { kind, re } of PATTERNS) out = out.replace(re, (m) => tokenFor(kind, m));
    return out;
  });

  const unmask = (value) => walk(value, (s) => s.replace(PLACEHOLDER, (ph) => map.get(ph) ?? ph));

  return { mask, unmask, size: () => map.size };
}

/** One-way redaction for logs/audit. */
function redactForLog(value) {
  const vault = createVault('log-redaction');
  return vault.mask(value);
}

module.exports = { createVault, redactForLog };
