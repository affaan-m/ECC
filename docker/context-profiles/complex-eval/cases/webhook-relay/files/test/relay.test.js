'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const { createRelay } = require('../src/app');

function listen(server) {
  return new Promise((resolve, reject) => {
    server.once('error', reject);
    server.listen(0, '127.0.0.1', () => resolve(server.address().port));
  });
}

test('accepts a delivery and reports it as pending', async () => {
  const server = createRelay();
  const port = await listen(server);
  try {
    const created = await fetch(`http://127.0.0.1:${port}/deliveries`, {
      method: 'POST', headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ url: 'http://127.0.0.1:1/hook', payload: { a: 1 } }) });
    assert.equal(created.status, 202);
    const { id } = await created.json();
    const status = await fetch(`http://127.0.0.1:${port}/deliveries/${id}`);
    assert.equal(status.status, 200);
    const record = await status.json();
    assert.equal(record.status, 'pending');
    assert.equal(record.attempts, 0);
  } finally {
    server.close();
  }
});

test('unknown delivery id returns 404', async () => {
  const server = createRelay();
  const port = await listen(server);
  try {
    const response = await fetch(`http://127.0.0.1:${port}/deliveries/00000000-0000-0000-0000-000000000000`);
    assert.equal(response.status, 404);
  } finally {
    server.close();
  }
});
