'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const { createApp } = require('../src/app');

test('create and read a note', async () => {
  const server = createApp();
  await new Promise(resolve => server.listen(0, '127.0.0.1', resolve));
  try {
    const port = server.address().port;
    const created = await fetch(`http://127.0.0.1:${port}/notes`, {
      method: 'POST', headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ title: 'first', body: 'hello' }) });
    assert.equal(created.status, 201);
    const { id } = await created.json();
    const read = await fetch(`http://127.0.0.1:${port}/notes/${id}`);
    assert.equal((await read.json()).title, 'first');
  } finally {
    server.close();
  }
});
