'use strict';
const http = require('node:http');
const { events } = require('./data');

// Current implementation: scan and sort per query. Known slow, and the
// analytics team says edge cases don't match the README semantics.
function summarize(type, from, to) {
  const rows = events
    .filter(e => e.type === type && (from === null || e.ts >= from) && (to === null || e.ts <= to))
    .map(e => e.value)
    .sort((a, b) => a - b);
  const count = rows.length;
  const sum = rows.reduce((a, b) => a + b, 0);
  const interpolate = p => {
    if (!count) return 0;
    const rank = (p / 100) * (count - 1);
    const low = Math.floor(rank);
    const high = Math.ceil(rank);
    return rows[low] + (rows[high] - rows[low]) * (rank - low);
  };
  return { count, sum, avg: count ? sum / count : 0,
    p50: interpolate(50), p95: interpolate(95), p99: interpolate(99),
    min: count ? rows[0] : 0, max: count ? rows[count - 1] : 0 };
}

function createApp() {
  return http.createServer((req, res) => {
    const url = new URL(req.url, 'http://localhost');
    if (req.method === 'GET' && url.pathname === '/stats') {
      const type = url.searchParams.get('type');
      const from = url.searchParams.has('from') ? Number(url.searchParams.get('from')) : null;
      const to = url.searchParams.has('to') ? Number(url.searchParams.get('to')) : null;
      const body = summarize(type, from, to);
      res.writeHead(200, { 'content-type': 'application/json' });
      res.end(JSON.stringify({ type, from, to, ...body }));
      return;
    }
    res.writeHead(404, { 'content-type': 'application/json' });
    res.end(JSON.stringify({ error: 'not found' }));
  });
}

module.exports = { createApp };
