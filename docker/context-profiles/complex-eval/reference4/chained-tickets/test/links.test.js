'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const { createApp } = require('../src/app');

process.env.DATA_FILE = require('node:path').join(require('node:os').tmpdir(),
  `shortlink-test-${process.pid}.json`);

let server;
let port;
test.before(async () => {
  server = createApp();
  await new Promise(resolve => server.listen(0, '127.0.0.1', resolve));
  port = server.address().port;
});
test.after(() => server.close());

const post = body => fetch(`http://127.0.0.1:${port}/links`, {
  method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify(body) });
const get = p => fetch(`http://127.0.0.1:${port}${p}`, { redirect: 'manual' });

test('creates a link with default expiry', async () => {
  const res = await post({ url: 'https://example.com/a' });
  assert.equal(res.status, 201);
  const body = await res.json();
  assert.match(body.code, /^[A-Za-z0-9]{6,10}$/);
  assert.ok(Date.parse(body.expiresAt) > Date.now());
});

test('redirects with 302 and location', async () => {
  const { code } = await (await post({ url: 'https://example.com/b' })).json();
  const res = await get(`/${code}`);
  assert.equal(res.status, 302);
  assert.equal(res.headers.get('location'), 'https://example.com/b');
});

test('unknown code is a 404 envelope', async () => {
  const res = await get('/zzzzzz');
  assert.equal(res.status, 404);
  assert.equal((await res.json()).error.code, 'NOT_FOUND');
});

test('invalid url is a 400 envelope', async () => {
  const res = await post({ url: 'notaurl' });
  assert.equal(res.status, 400);
  assert.equal((await res.json()).error.code, 'INVALID_URL');
});

test('javascript scheme rejected', async () => {
  const res = await post({ url: 'javascript:alert(1)' });
  assert.equal(res.status, 400);
});

test('ttl bounds enforced', async () => {
  const res = await post({ url: 'https://example.com', ttlSeconds: 99999999 });
  assert.equal(res.status, 400);
  assert.equal((await res.json()).error.code, 'INVALID_TTL');
});

test('delete flow', async () => {
  const { code } = await (await post({ url: 'https://example.com/c' })).json();
  const del = await fetch(`http://127.0.0.1:${port}/links/${code}`, { method: 'DELETE' });
  assert.equal(del.status, 204);
  assert.equal((await get(`/${code}`)).status, 404);
});

test('stats start at zero and count redirects', async () => {
  const { code } = await (await post({ url: 'https://example.com/d' })).json();
  const zero = await (await fetch(`http://127.0.0.1:${port}/links/${code}/stats`)).json();
  assert.equal(zero.hits, 0);
  await get(`/${code}`);
  await get(`/${code}`);
  const two = await (await fetch(`http://127.0.0.1:${port}/links/${code}/stats`)).json();
  assert.equal(two.hits, 2);
});

test('stats for unknown code are a 404 envelope', async () => {
  const res = await fetch(`http://127.0.0.1:${port}/links/zzzzzz/stats`);
  assert.equal(res.status, 404);
  assert.equal((await res.json()).error.code, 'NOT_FOUND');
});

test('expired links are 410', async () => {
  const { code } = await (await post({ url: 'https://example.com/e', ttlSeconds: 1 })).json();
  await new Promise(resolve => setTimeout(resolve, 1200));
  assert.equal((await get(`/${code}`)).status, 410);
});

test('malformed json is a 400 envelope', async () => {
  const res = await fetch(`http://127.0.0.1:${port}/links`, {
    method: 'POST', headers: { 'content-type': 'application/json' }, body: '{nope' });
  assert.equal(res.status, 400);
  assert.equal((await res.json()).error.code, 'INVALID_JSON');
});

test('error responses never leak html', async () => {
  const res = await get('/zzzzzz');
  assert.match(res.headers.get('content-type'), /application\/json/);
});

// Last: the flood exhausts the per-client rate-limit bucket.
test('rate limiting kicks in under a flood', async () => {
  const responses = await Promise.all(Array.from({ length: 30 }, (_, i) =>
    post({ url: `https://example.com/flood-${i}` })));
  assert.ok(responses.some(r => r.status === 429));
});
