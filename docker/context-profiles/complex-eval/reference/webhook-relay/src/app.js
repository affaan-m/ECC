'use strict';
const http = require('node:http');
const crypto = require('node:crypto');

const MAX_ATTEMPTS = 5;
const BASE_DELAY_MS = 100;

function createRelay() {
  const deliveries = new Map();

  async function attempt(record) {
    record.attempts += 1;
    try {
      const response = await fetch(record.url, {
        method: 'POST', headers: { 'content-type': 'application/json' },
        body: JSON.stringify(record.payload), signal: AbortSignal.timeout(5000) });
      if (response.status >= 200 && response.status < 300) {
        record.status = 'delivered';
        record.lastError = null;
        return;
      }
      record.lastError = `HTTP ${response.status}`;
    } catch (error) {
      record.lastError = error && error.message ? error.message : 'delivery failed';
    }
    if (record.attempts >= MAX_ATTEMPTS) {
      record.status = 'dead';
      return;
    }
    const delay = BASE_DELAY_MS * 2 ** (record.attempts - 1);
    setTimeout(() => { void attempt(record); }, delay);
  }

  const server = http.createServer((req, res) => {
    if (req.method === 'POST' && req.url === '/deliveries') {
      let body = '';
      req.on('data', chunk => { body += chunk; });
      req.on('end', () => {
        let parsed;
        try { parsed = JSON.parse(body); } catch {
          res.writeHead(400, { 'content-type': 'application/json' });
          res.end(JSON.stringify({ error: 'invalid JSON body' }));
          return;
        }
        const id = crypto.randomUUID();
        const record = { id, url: parsed.url, payload: parsed.payload,
          status: 'pending', attempts: 0, lastError: null };
        deliveries.set(id, record);
        void attempt(record);
        res.writeHead(202, { 'content-type': 'application/json' });
        res.end(JSON.stringify({ id }));
      });
      return;
    }
    const match = /^\/deliveries\/([0-9a-f-]+)$/.exec(req.url || '');
    if (req.method === 'GET' && match) {
      const record = deliveries.get(match[1]);
      if (!record) {
        res.writeHead(404, { 'content-type': 'application/json' });
        res.end(JSON.stringify({ error: 'not found' }));
        return;
      }
      res.writeHead(200, { 'content-type': 'application/json' });
      res.end(JSON.stringify(record));
      return;
    }
    res.writeHead(404, { 'content-type': 'application/json' });
    res.end(JSON.stringify({ error: 'not found' }));
  });
  return server;
}

module.exports = { createRelay };
