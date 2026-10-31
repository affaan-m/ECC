'use strict';
const crypto = require('node:crypto');

const MAX_URL_LENGTH = 2048;
const DEFAULT_TTL_SECONDS = 604800;
const MAX_TTL_SECONDS = 2592000;
const RATE_LIMIT_WINDOW_MS = 60000;
const RATE_LIMIT_MAX = 20;

class HttpError extends Error {
  constructor(status, code, message) {
    super(message);
    this.status = status;
    this.code = code;
  }
}

function validateUrl(url) {
  if (typeof url !== 'string' || !url) throw new HttpError(400, 'INVALID_URL', 'url is required');
  if (url.length > MAX_URL_LENGTH) throw new HttpError(400, 'INVALID_URL', 'url exceeds 2048 characters');
  let parsed;
  try { parsed = new URL(url); } catch { throw new HttpError(400, 'INVALID_URL', 'url must be a valid absolute URL'); }
  if (parsed.protocol !== 'http:' && parsed.protocol !== 'https:') {
    throw new HttpError(400, 'INVALID_URL', 'only http and https URLs are allowed');
  }
  return url;
}

function validateTtl(ttlSeconds) {
  if (ttlSeconds === undefined || ttlSeconds === null) return DEFAULT_TTL_SECONDS;
  if (!Number.isInteger(ttlSeconds) || ttlSeconds < 1 || ttlSeconds > MAX_TTL_SECONDS) {
    throw new HttpError(400, 'INVALID_TTL', 'ttlSeconds must be an integer between 1 and 2592000');
  }
  return ttlSeconds;
}

function createService(store) {
  const buckets = new Map();

  function assertRateLimit(key) {
    const now = Date.now();
    const windowHits = (buckets.get(key) || []).filter(at => now - at < RATE_LIMIT_WINDOW_MS);
    if (windowHits.length >= RATE_LIMIT_MAX) throw new HttpError(429, 'RATE_LIMITED', 'too many requests, slow down');
    windowHits.push(now);
    buckets.set(key, windowHits);
  }

  function freshCode() {
    let code = crypto.randomBytes(4).toString('hex');
    while (store.get(code)) code = crypto.randomBytes(4).toString('hex');
    return code;
  }

  return {
    assertRateLimit,
    createLink({ url, ttlSeconds } = {}) {
      const validUrl = validateUrl(url);
      const ttl = validateTtl(ttlSeconds);
      const link = { code: freshCode(), url: validUrl,
        expiresAt: new Date(Date.now() + ttl * 1000).toISOString(), hits: 0 };
      store.set(link.code, link);
      return link;
    },
    resolveLink(code) {
      const link = store.get(code);
      if (!link) throw new HttpError(404, 'NOT_FOUND', 'no link with that code');
      if (Date.parse(link.expiresAt) <= Date.now()) throw new HttpError(410, 'GONE', 'link has expired');
      store.incrementHits(code);
      return link;
    },
    deleteLink(code) {
      if (!store.delete(code)) throw new HttpError(404, 'NOT_FOUND', 'no link with that code');
    },
    stats(code) {
      const link = store.get(code);
      if (!link) throw new HttpError(404, 'NOT_FOUND', 'no link with that code');
      return { code, hits: link.hits || 0, expiresAt: link.expiresAt };
    },
  };
}

module.exports = { createService, HttpError };
