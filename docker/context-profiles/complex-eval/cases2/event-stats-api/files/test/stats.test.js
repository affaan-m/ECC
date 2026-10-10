'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const { createApp } = require('../src/app');
const { EPOCH_MS } = require('../src/data');

test('stats endpoint answers a broad query', async () => {
  const server = createApp();
  await new Promise(resolve => server.listen(0, '127.0.0.1', resolve));
  try {
    const port = server.address().port;
    const response = await fetch(`http://127.0.0.1:${port}/stats?type=click&from=${EPOCH_MS}&to=${EPOCH_MS + 30 * 86400000}`);
    assert.equal(response.status, 200);
    const body = await response.json();
    assert.equal(body.type, 'click');
    assert.ok(body.count > 0);
  } finally {
    server.close();
  }
});
