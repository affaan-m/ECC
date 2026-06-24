'use strict';

const crypto = require('crypto');

// In-memory semantic cache. In production, replace with Redis + vector similarity.
// Cache key = SHA256(provider + model + normalized messages).

const cache = new Map(); // key → { response, hits, createdAt, expiresAt }
const DEFAULT_TTL_MS = 30 * 60 * 1000; // 30 minutes

function makeKey(provider, model, messages) {
  const normalized = JSON.stringify({ provider, model, messages })
    .replace(/\s+/g, ' ')
    .toLowerCase();
  return crypto.createHash('sha256').update(normalized).digest('hex');
}

function get(provider, model, messages) {
  const key = makeKey(provider, model, messages);
  const entry = cache.get(key);
  if (!entry) return null;
  if (Date.now() > entry.expiresAt) {
    cache.delete(key);
    return null;
  }
  entry.hits++;
  return { ...entry.response, _cacheHit: true, _cacheKey: key };
}

function set(provider, model, messages, response, ttlMs = DEFAULT_TTL_MS) {
  const key = makeKey(provider, model, messages);
  cache.set(key, {
    response,
    hits: 0,
    createdAt: Date.now(),
    expiresAt: Date.now() + ttlMs,
  });
  return key;
}

function stats() {
  let total = 0, hits = 0;
  for (const [, entry] of cache) {
    total++;
    hits += entry.hits;
  }
  return { entries: total, totalHits: hits };
}

function evictExpired() {
  const now = Date.now();
  for (const [key, entry] of cache) {
    if (now > entry.expiresAt) cache.delete(key);
  }
}

// Evict every 5 minutes
setInterval(evictExpired, 5 * 60 * 1000).unref();

module.exports = { get, set, stats, makeKey };
