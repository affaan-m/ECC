'use strict';
const http = require('node:http');
const { events } = require('./data');

// Indexed implementation: per-type arrays sorted by timestamp, with prefix
// sums, built once at startup. Per query the range is located with binary
// search; only the matching slice is touched.
function buildIndex() {
  const byType = new Map();
  for (const event of events) {
    if (!byType.has(event.type)) byType.set(event.type, []);
    byType.get(event.type).push(event);
  }
  for (const rows of byType.values()) {
    rows.sort((a, b) => a.ts - b.ts);
    const prefix = new Float64Array(rows.length + 1);
    for (let i = 0; i < rows.length; i++) prefix[i + 1] = prefix[i] + rows[i].value;
    rows.prefixSums = prefix;
  }
  return byType;
}

function lowerBound(rows, ts) {
  let lo = 0;
  let hi = rows.length;
  while (lo < hi) {
    const mid = (lo + hi) >> 1;
    if (rows[mid].ts < ts) lo = mid + 1; else hi = mid;
  }
  return lo;
}

function upperBound(rows, ts) {
  let lo = 0;
  let hi = rows.length;
  while (lo < hi) {
    const mid = (lo + hi) >> 1;
    if (rows[mid].ts <= ts) lo = mid + 1; else hi = mid;
  }
  return lo;
}

const EMPTY = { count: 0, sum: 0, avg: null, p50: null, p95: null, p99: null, min: null, max: null };

function summarize(index, type, from, to) {
  const rows = index.get(type);
  if (!rows) return EMPTY;
  const lo = from === null ? 0 : lowerBound(rows, from);
  const hi = to === null ? rows.length : upperBound(rows, to);
  const count = hi - lo;
  if (count <= 0) return EMPTY;
  const sum = rows.prefixSums[hi] - rows.prefixSums[lo];
  const values = new Array(count);
  for (let i = 0; i < count; i++) values[i] = rows[lo + i].value;
  values.sort((a, b) => a - b);
  const rank = p => values[Math.ceil((p / 100) * count) - 1];
  const avgCents = Math.floor((sum * 200 + count) / (count * 2));
  return { count, sum, avg: avgCents / 100,
    p50: rank(50), p95: rank(95), p99: rank(99), min: values[0], max: values[count - 1] };
}

function createApp() {
  const index = buildIndex();
  return http.createServer((req, res) => {
    const url = new URL(req.url, 'http://localhost');
    if (req.method === 'GET' && url.pathname === '/stats') {
      const type = url.searchParams.get('type');
      const hasFrom = url.searchParams.has('from');
      const hasTo = url.searchParams.has('to');
      const from = hasFrom ? Number(url.searchParams.get('from')) : null;
      const to = hasTo ? Number(url.searchParams.get('to')) : null;
      if ((hasFrom && !Number.isFinite(from)) || (hasTo && !Number.isFinite(to))
        || (from !== null && to !== null && from > to)) {
        res.writeHead(400, { 'content-type': 'application/json' });
        res.end(JSON.stringify({ error: 'invalid bounds' }));
        return;
      }
      res.writeHead(200, { 'content-type': 'application/json' });
      res.end(JSON.stringify({ type, from, to, ...summarize(index, type, from, to) }));
      return;
    }
    res.writeHead(404, { 'content-type': 'application/json' });
    res.end(JSON.stringify({ error: 'not found' }));
  });
}

module.exports = { createApp };
