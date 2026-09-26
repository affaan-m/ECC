'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const { createApp } = require('../src/app');
const { store } = require('../src/store');

let server;
let port;
test.before(async () => {
  server = createApp();
  await new Promise(resolve => server.listen(0, '127.0.0.1', resolve));
  port = server.address().port;
});
test.after(() => server.close());

const send = (eventId, orderId, amountCents) => fetch(`http://127.0.0.1:${port}/webhooks/payments`, {
  method: 'POST', headers: { 'content-type': 'application/json' },
  body: JSON.stringify({ eventId, orderId, amountCents, type: 'payment.succeeded' }) });

test('a single payment event processes', async () => {
  const res = await send('ev-t-1', 'o1', 5000);
  assert.equal(res.status, 200);
  assert.equal((await res.json()).status, 'processed');
  assert.equal(store.orders.get('o1').status, 'paid');
});

test('a sequential retry is an inert duplicate', async () => {
  await send('ev-t-2', 'o3', 800);
  const before = store.paymentLog.filter(p => p.orderId === 'o3').length;
  const res = await send('ev-t-2', 'o3', 800);
  assert.equal((await res.json()).status, 'duplicate');
  assert.equal(store.paymentLog.filter(p => p.orderId === 'o3').length, before);
});

test('fifty concurrent duplicates apply exactly once (INC-104 regression)', async () => {
  const storm = await Promise.all(Array.from({ length: 50 }, () => send('ev-t-storm', 'o4', 9999)));
  const bodies = [];
  for (const r of storm) bodies.push(await r.json());
  assert.equal(bodies.filter(b => b.status === 'processed').length, 1);
  assert.equal(bodies.filter(b => b.status === 'duplicate').length, 49);
  assert.equal(store.orders.get('o4').paymentsApplied, 1);
});

test('a second event for a paid order is already_paid', async () => {
  const res = await send('ev-t-3', 'o4', 9999);
  assert.equal((await res.json()).status, 'already_paid');
  assert.equal(store.orders.get('o4').paymentsApplied, 1);
});

test('amount mismatch is 422 and inert', async () => {
  const res = await send('ev-t-4', 'o5', 1);
  assert.equal(res.status, 422);
  assert.equal(store.orders.get('o5').status, 'pending');
});

test('unknown order is a 404 envelope', async () => {
  const res = await send('ev-t-5', 'nope', 100);
  assert.equal(res.status, 404);
  assert.equal((await res.json()).error.code, 'NOT_FOUND');
});
