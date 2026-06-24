'use strict';

const path = require('path');
const fs = require('fs');

// Lightweight SQLite-free storage using JSON files.
// Swap to better-sqlite3 for production scale.

const DATA_DIR = path.join(__dirname, '..', 'data');
const DB_FILE = path.join(DATA_DIR, 'analytics.json');

let _data = null;

function load() {
  if (_data) return _data;
  if (!fs.existsSync(DATA_DIR)) fs.mkdirSync(DATA_DIR, { recursive: true });
  if (!fs.existsSync(DB_FILE)) {
    _data = { requests: [], orgs: {}, totals: { requests: 0, inputTokens: 0, outputTokens: 0, savedTokens: 0, savedCost: 0, savedCo2: 0, cacheHits: 0 } };
    save();
    return _data;
  }
  try {
    _data = JSON.parse(fs.readFileSync(DB_FILE, 'utf8'));
  } catch {
    _data = { requests: [], orgs: {}, totals: { requests: 0, inputTokens: 0, outputTokens: 0, savedTokens: 0, savedCost: 0, savedCo2: 0, cacheHits: 0 } };
  }
  return _data;
}

function save() {
  // Keep only last 10k requests in file
  if (_data.requests.length > 10000) _data.requests = _data.requests.slice(-10000);
  fs.writeFileSync(DB_FILE, JSON.stringify(_data, null, 2));
}

function recordRequest(record) {
  const db = load();
  db.requests.push({ ...record, ts: Date.now() });
  db.totals.requests++;
  db.totals.inputTokens += record.inputTokens || 0;
  db.totals.outputTokens += record.outputTokens || 0;
  db.totals.savedTokens += record.savedTokens || 0;
  db.totals.savedCost += record.savedCost || 0;
  db.totals.savedCo2 += record.savedCo2 || 0;
  if (record.cacheHit) db.totals.cacheHits++;

  const orgId = record.orgId || 'default';
  if (!db.orgs[orgId]) db.orgs[orgId] = { requests: 0, savedTokens: 0, savedCost: 0, savedCo2: 0, cacheHits: 0 };
  db.orgs[orgId].requests++;
  db.orgs[orgId].savedTokens += record.savedTokens || 0;
  db.orgs[orgId].savedCost += record.savedCost || 0;
  db.orgs[orgId].savedCo2 += record.savedCo2 || 0;
  if (record.cacheHit) db.orgs[orgId].cacheHits++;

  save();
}

function getTotals() {
  return load().totals;
}

function getRecent(n = 50) {
  return load().requests.slice(-n).reverse();
}

function getOrgs() {
  return load().orgs;
}

function getTimeSeries(hours = 24) {
  const db = load();
  const cutoff = Date.now() - hours * 3600 * 1000;
  const buckets = {};
  for (const r of db.requests) {
    if (r.ts < cutoff) continue;
    const hour = new Date(r.ts).toISOString().slice(0, 13) + ':00';
    if (!buckets[hour]) buckets[hour] = { hour, requests: 0, savedTokens: 0, savedCost: 0 };
    buckets[hour].requests++;
    buckets[hour].savedTokens += r.savedTokens || 0;
    buckets[hour].savedCost += r.savedCost || 0;
  }
  return Object.values(buckets).sort((a, b) => a.hour.localeCompare(b.hour));
}

module.exports = { recordRequest, getTotals, getRecent, getOrgs, getTimeSeries };
