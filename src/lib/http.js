'use strict';
const axios = require('axios');

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

/** axios instance that retries ONLY idempotent GETs, on network errors or 5xx. Never retries writes. */
function createHttp({ baseURL, timeout, headers, retries = 2 }) {
  const http = axios.create({ baseURL, timeout, headers, validateStatus: () => true });
  const shouldRetry = (cfg) => cfg && cfg.method === 'get' && (cfg.__retry ?? 0) < retries;
  http.interceptors.response.use(
    async (res) => {
      if (res.status >= 500 && shouldRetry(res.config)) {
        res.config.__retry = (res.config.__retry ?? 0) + 1;
        await sleep(100 * 2 ** res.config.__retry + Math.random() * 50);
        return http.request(res.config);
      }
      return res;
    },
    async (err) => {
      if (shouldRetry(err.config) && !axios.isCancel(err)) {
        err.config.__retry = (err.config.__retry ?? 0) + 1;
        await sleep(100 * 2 ** err.config.__retry + Math.random() * 50);
        return http.request(err.config);
      }
      throw err;
    },
  );
  return http;
}

module.exports = { createHttp };
