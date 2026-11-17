'use strict';

const assert = require('node:assert/strict');
const fs = require('node:fs');
const http = require('node:http');
const os = require('node:os');
const path = require('node:path');
const { test } = require('node:test');
const { createSessionStore } = require('../../scripts/lib/plan-canvas/sessions');
const { createPlanCanvasServer } = require('../../scripts/lib/plan-canvas/server');

function fixture(t) {
  const directory = fs.mkdtempSync(path.join(os.tmpdir(), 'plan-canvas-persistence-'));
  t.after(() => fs.rmSync(directory, { recursive: true, force: true }));
  const artifact = path.join(directory, 'plan.md');
  fs.writeFileSync(artifact, '# Plan\n');
  return { artifact, store: createSessionStore({ stateDir: path.join(directory, 'state') }) };
}

function blockWrites(store) {
  fs.mkdirSync(store.stateDir, { recursive: true });
  const blocker = `${store.stateFile}.tmp`;
  fs.mkdirSync(blocker);
  return () => fs.rmSync(blocker, { recursive: true, force: true });
}

function copy(value) { return JSON.parse(JSON.stringify(value)); }

test('failed drains keep feedback available until persistence succeeds', t => {
  for (const endSession of [false, true]) {
    const { store, artifact } = fixture(t);
    const key = store.open(artifact).session.key;
    const accepted = store.queueFeedback(key, [{ kind: 'chat', text: 'keep this feedback' }], { endSession }).accepted;
    const previous = copy(store.get(key));
    const previousBytes = fs.readFileSync(store.stateFile, 'utf8');
    const unblock = blockWrites(store);
    try {
      assert.throws(() => store.takeFeedback(key));
      assert.deepStrictEqual(store.get(key), previous);
      assert.strictEqual(fs.readFileSync(store.stateFile, 'utf8'), previousBytes);
    } finally { unblock(); }
    const result = store.takeFeedback(key);
    assert.deepStrictEqual(result.items, accepted);
    assert.strictEqual(result.sessionEnded, endSession ? true : undefined);
    assert.strictEqual(store.takeFeedback(key).status, endSession ? 'ended' : 'waiting');
    assert.deepStrictEqual(createSessionStore({ stateDir: store.stateDir }).get(key).pendingFeedback, []);
  }
});

test('a rename failure does not publish a drained in-memory session', t => {
  const { store, artifact } = fixture(t);
  const key = store.open(artifact).session.key;
  store.queueFeedback(key, [{ kind: 'chat', text: 'retry after rename' }]);
  const previous = copy(store.get(key));
  const previousBytes = fs.readFileSync(store.stateFile, 'utf8');
  const rename = fs.renameSync;
  try {
    fs.renameSync = (from, to) => {
      if (to === store.stateFile) throw Object.assign(new Error('synthetic rename failure'), { code: 'EACCES' });
      return rename(from, to);
    };
    assert.throws(() => store.takeFeedback(key), /synthetic rename failure/);
  } finally { fs.renameSync = rename; }
  assert.deepStrictEqual(store.get(key), previous);
  assert.strictEqual(fs.readFileSync(store.stateFile, 'utf8'), previousBytes);
  assert.strictEqual(store.takeFeedback(key).items[0].text, 'retry after rename');
});

test('failed enqueue does not duplicate chat, consume IDs, or end the session', t => {
  for (const endSession of [false, true]) {
    const { store, artifact } = fixture(t);
    const key = store.open(artifact).session.key;
    const previous = copy(store.get(key));
    const items = [{ kind: 'chat', text: 'send once' }, { kind: 'unknown' }];
    const unblock = blockWrites(store);
    try {
      assert.throws(() => store.queueFeedback(key, items, { endSession }));
      assert.deepStrictEqual(store.get(key), previous);
    } finally { unblock(); }
    const result = store.queueFeedback(key, items, { endSession });
    assert.strictEqual(result.accepted[0].id, 'fb-1');
    assert.strictEqual(result.pending, 1);
    assert.strictEqual(store.get(key).chat.length, 1);
    assert.strictEqual(JSON.parse(fs.readFileSync(store.stateFile, 'utf8')).feedbackCounter, 2);
  }
});

test('failed new opens and explicit reopens do not change visible session state', t => {
  const { store, artifact } = fixture(t);
  let unblock = blockWrites(store);
  try {
    assert.throws(() => store.open(artifact));
    assert.deepStrictEqual(store.list(), []);
    assert.strictEqual(store.hasOpenSessions(), false);
  } finally { unblock(); }
  const key = store.open(artifact).session.key;
  store.end(key, 'user');
  const previous = copy(store.get(key));
  unblock = blockWrites(store);
  try {
    assert.throws(() => store.open(artifact, { reopen: true }));
    assert.deepStrictEqual(store.get(key), previous);
  } finally { unblock(); }
  assert.strictEqual(store.open(artifact).refused, true);
  assert.strictEqual(store.open(artifact, { reopen: true }).session.status, 'open');
});

for (const operation of ['reply', 'end']) {
  test(`failed ${operation} leaves the previous session intact and can be retried`, t => {
    const { store, artifact } = fixture(t);
    const key = store.open(artifact).session.key;
    const previous = copy(store.get(key));
    const update = () => operation === 'reply' ? store.addAgentReply(key, 'completed') : store.end(key, 'user');
    const unblock = blockWrites(store);
    try {
      assert.throws(update);
      assert.deepStrictEqual(store.get(key), previous);
    } finally { unblock(); }
    update();
    assert.strictEqual(store.get(key).chat.length, operation === 'reply' ? 1 : 0);
    assert.strictEqual(store.get(key).status, operation === 'end' ? 'ended' : 'open');
    assert.deepStrictEqual(createSessionStore({ stateDir: store.stateDir }).get(key), store.get(key));
  });
}

function request(port, method, requestPath, body) {
  return new Promise((resolve, reject) => {
    const data = body === undefined ? null : JSON.stringify(body);
    const req = http.request({
      host: '127.0.0.1', port, method, path: requestPath, agent: false,
      headers: data ? { 'content-type': 'application/json', 'content-length': Buffer.byteLength(data) } : {},
    }, response => {
      let text = '';
      response.setEncoding('utf8');
      response.on('data', chunk => { text += chunk; });
      response.on('end', () => {
        try { resolve({ status: response.statusCode, body: JSON.parse(text) }); } catch (error) { reject(error); }
      });
    });
    req.on('error', reject);
    req.setTimeout(5000, () => req.destroy(new Error('HTTP regression timed out')));
    req.end(data);
  });
}

test('an HTTP await retry receives feedback after a persistence error without a server restart', async t => {
  const { store, artifact } = fixture(t);
  const key = store.open(artifact).session.key;
  const server = createPlanCanvasServer({ store, idleTimeoutMs: 0, presenceSweepMs: 0 });
  const { port } = await server.listen(0);
  try {
    const queued = await request(port, 'POST', `/api/session/${key}/feedback`, { items: [{ kind: 'chat', text: 'deliver over HTTP' }] });
    assert.strictEqual(queued.status, 200);
    const unblock = blockWrites(store);
    try {
      const failed = await request(port, 'GET', `/api/await?key=${key}&timeoutMs=0`);
      assert.strictEqual(failed.status, 400);
      assert.strictEqual(typeof failed.body.error, 'string');
    } finally { unblock(); }
    const retried = await request(port, 'GET', `/api/await?key=${key}&timeoutMs=0`);
    assert.strictEqual(retried.status, 200);
    assert.strictEqual(retried.body.status, 'feedback');
    assert.strictEqual(retried.body.items[0].text, 'deliver over HTTP');
    assert.strictEqual((await request(port, 'GET', `/api/await?key=${key}&timeoutMs=0`)).body.status, 'waiting');
  } finally { await server.close(); }
});
