'use strict';
const http = require('node:http');
const { store } = require('./store');

// INC-104 receiver: checks "seen this event?" and applies the payment in two
// steps with an async gap in between. Concurrent duplicates both pass the
// check. Do not keep this shape.
function createApp() {
  return http.createServer((req, res) => {
    const url = new URL(req.url, 'http://localhost');

    if (req.method === 'POST' && url.pathname === '/webhooks/payments') {
      let body = '';
      req.on('data', chunk => { body += chunk; });
      req.on('end', async () => {
        const parsed = JSON.parse(body);
        const { eventId, orderId } = parsed;
        if (store.processedEvents.has(eventId)) {
          res.writeHead(200, { 'content-type': 'application/json' });
          res.end(JSON.stringify({ status: 'duplicate', orderId }));
          return;
        }
        await new Promise(resolve => setImmediate(resolve)); // async gap
        const order = store.orders.get(orderId);
        order.status = 'paid';
        order.paidAt = new Date().toISOString();
        order.paymentsApplied++;
        store.paymentLog.push({ eventId, orderId, amountCents: parsed.amountCents });
        store.processedEvents.add(eventId);
        res.writeHead(200, { 'content-type': 'application/json' });
        res.end(JSON.stringify({ status: 'processed', orderId }));
      });
      return;
    }

    const match = /^\/orders\/([\w-]+)$/.exec(url.pathname);
    if (req.method === 'GET' && match) {
      const order = store.orders.get(match[1]);
      if (!order) {
        res.writeHead(404, { 'content-type': 'application/json' });
        res.end(JSON.stringify({ error: { code: 'NOT_FOUND', message: 'no such order' } }));
        return;
      }
      res.writeHead(200, { 'content-type': 'application/json' });
      res.end(JSON.stringify(order));
      return;
    }

    res.writeHead(404, { 'content-type': 'application/json' });
    res.end(JSON.stringify({ error: { code: 'NOT_FOUND', message: 'not found' } }));
  });
}

module.exports = { createApp };
