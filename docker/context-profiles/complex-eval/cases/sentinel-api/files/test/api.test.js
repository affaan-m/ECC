'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const { createApp } = require('../src/app');

function listen(server) {
  return new Promise((resolve, reject) => {
    server.once('error', reject);
    server.listen(0, '127.0.0.1', () => resolve(server.address().port));
  });
}

test('create and read back a paste', async () => {
  const server = createApp();
  const port = await listen(server);
  try {
    const created = await fetch(`http://127.0.0.1:${port}/pastes`, {
      method: 'POST', headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ content: 'hello paste' }) });
    assert.equal(created.status, 201);
    const { id } = await created.json();
    const read = await fetch(`http://127.0.0.1:${port}/pastes/${id}`);
    assert.equal(read.status, 200);
    assert.equal((await read.json()).content, 'hello paste');
  } finally {
    server.close();
  }
});
