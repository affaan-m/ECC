'use strict';
const http = require('node:http');
const crypto = require('node:crypto');

// In-memory webhook relay. See README.md for the delivery contract.
//
// TODO: deliveries are accepted and stored, but the delivery worker was never
// finished — nothing ever POSTs to the destination URL, retries never happen,
// and records stay "pending" forever.

function createRelay() {
  const deliveries = new Map();

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
        deliveries.set(id, { id, url: parsed.url, payload: parsed.payload,
          status: 'pending', attempts: 0, lastError: null });
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
