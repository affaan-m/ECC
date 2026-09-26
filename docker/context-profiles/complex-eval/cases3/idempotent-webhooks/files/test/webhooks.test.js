'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const { createApp } = require('../src/app');
const { store } = require('../src/store');

test('a single payment event processes', async () => {
  const server = createApp();
  await new Promise(resolve => server.listen(0, '127.0.0.1', resolve));
  try {
    const port = server.address().port;
    const res = await fetch(`http://127.0.0.1:${port}/webhooks/payments`, {
      method: 'POST', headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ eventId: 'ev-test-1', orderId: 'o1', amountCents: 5000, type: 'payment.succeeded' }) });
    assert.equal(res.status, 200);
    assert.equal((await res.json()).status, 'processed');
    assert.equal(store.orders.get('o1').status, 'paid');
  } finally {
    server.close();
  }
});
