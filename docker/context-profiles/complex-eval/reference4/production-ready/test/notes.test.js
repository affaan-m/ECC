'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const { createApp } = require('../src/app');

let server;
let port;
test.before(async () => {
  server = createApp();
  await new Promise(resolve => server.listen(0, '127.0.0.1', resolve));
  port = server.address().port;
});
test.after(() => server.close());

const post = body => fetch(`http://127.0.0.1:${port}/notes`, {
  method: 'POST', headers: { 'content-type': 'application/json' }, body });

test('create and read a note', async () => {
  const created = await post(JSON.stringify({ title: 'first', body: 'hello' }));
  assert.equal(created.status, 201);
  const { id } = await created.json();
  const read = await fetch(`http://127.0.0.1:${port}/notes/${id}`);
  assert.equal((await read.json()).title, 'first');
});

test('malformed json is a 400 envelope', async () => {
  const res = await post('{oops');
  assert.equal(res.status, 400);
  assert.equal((await res.json()).error.code, 'INVALID_JSON');
});

test('missing title is a 400 envelope', async () => {
  const res = await post(JSON.stringify({ body: 'x' }));
  assert.equal(res.status, 400);
  assert.equal((await res.json()).error.code, 'INVALID_TITLE');
});

test('unknown note is a 404 envelope', async () => {
  const res = await fetch(`http://127.0.0.1:${port}/notes/n_9999`);
  assert.equal(res.status, 404);
  assert.equal((await res.json()).error.code, 'NOT_FOUND');
});

test('oversize body is a 413 envelope', async () => {
  const res = await post(JSON.stringify({ title: 'x', body: 'y'.repeat(100 * 1024) }));
  assert.equal(res.status, 413);
});

test('health endpoint', async () => {
  const res = await fetch(`http://127.0.0.1:${port}/health`);
  assert.equal(res.status, 200);
  assert.equal((await res.json()).status, 'ok');
});

test('nosniff header present', async () => {
  const res = await fetch(`http://127.0.0.1:${port}/notes`);
  assert.equal(res.headers.get('x-content-type-options'), 'nosniff');
});
