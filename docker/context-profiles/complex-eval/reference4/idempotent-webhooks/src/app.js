'use strict';
const http = require('node:http');
const { store } = require('./store');

// Fixed after INC-104: all state checks and mutations happen synchronously in
// one turn of the event loop — an event is claimed the instant its body is
// parsed, before any await, so concurrent duplicates can never both pass.
class HttpError extends Error {
  constructor(status, code, message) {
    super(message);
    this.status = status;
    this.code = code;
  }
}

function sendJson(res, status, value) {
  res.writeHead(status, { 'content-type': 'application/json' });
  res.end(JSON.stringify(value));
}

function sendError(res, error) {
  const known = error instanceof HttpError;
  sendJson(res, known ? error.status : 500, {
    error: { code: known ? error.code : 'INTERNAL', message: known ? error.message : 'internal error' },
  });
}

function readBody(req) {
  return new Promise((resolve, reject) => {
    let body = '';
    req.on('data', chunk => { body += chunk; });
    req.on('end', () => {
      try { resolve(JSON.parse(body)); } catch { reject(new HttpError(400, 'INVALID_JSON', 'body must be valid JSON')); }
    });
    req.on('error', reject);
  });
}

function validateEvent(parsed) {
  if (!parsed || typeof parsed.eventId !== 'string' || !parsed.eventId
    || typeof parsed.orderId !== 'string' || !parsed.orderId
    || !Number.isInteger(parsed.amountCents) || parsed.amountCents <= 0
    || parsed.type !== 'payment.succeeded') {
    throw new HttpError(400, 'INVALID_EVENT', 'body must be a valid payment.succeeded event');
  }
  return parsed;
}

// Synchronous claim-and-apply: no awaits inside, so it is atomic.
function applyEvent({ eventId, orderId, amountCents }) {
  if (store.processedEvents.has(eventId)) return { status: 'duplicate', orderId };
  const order = store.orders.get(orderId);
  if (!order) throw new HttpError(404, 'NOT_FOUND', 'no such order');
  if (order.amountCents !== amountCents) throw new HttpError(422, 'AMOUNT_MISMATCH', 'amountCents does not match the order');
  if (order.status === 'paid') return { status: 'already_paid', orderId };
  store.processedEvents.add(eventId);
  order.status = 'paid';
  order.paidAt = new Date().toISOString();
  order.paymentsApplied++;
  store.paymentLog.push({ eventId, orderId, amountCents });
  return { status: 'processed', orderId };
}

function createApp() {
  return http.createServer(async (req, res) => {
    const url = new URL(req.url, 'http://localhost');
    try {
      if (req.method === 'POST' && url.pathname === '/webhooks/payments') {
        const parsed = validateEvent(await readBody(req));
        sendJson(res, 200, applyEvent(parsed));
        return;
      }
      const match = /^\/orders\/([\w-]+)$/.exec(url.pathname);
      if (req.method === 'GET' && match) {
        const order = store.orders.get(match[1]);
        if (!order) throw new HttpError(404, 'NOT_FOUND', 'no such order');
        sendJson(res, 200, order);
        return;
      }
      throw new HttpError(404, 'NOT_FOUND', 'not found');
    } catch (error) {
      sendError(res, error);
    }
  });
}

module.exports = { createApp };
