'use strict';

const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const http = require('node:http');
const { createSessionStore } = require('../../scripts/lib/plan-canvas/sessions');
const { createPlanCanvasServer } = require('../../scripts/lib/plan-canvas/server');

let passed = 0;
let failed = 0;
function freeze(value) {
  if (value && typeof value === 'object') {
    Object.values(value).forEach(freeze);
    Object.freeze(value);
  }
  return value;
}
async function fixture(mode, run) {
  const directory = fs.mkdtempSync(path.join(os.tmpdir(), 'ecc-ui-legacy-transitions-'));
  const file = path.join(directory, mode === 'ui' ? 'card.html' : 'plan.md');
  fs.writeFileSync(file, mode === 'ui' ? '<html><body>Card</body></html>' : '# Plan');
  const stateDir = path.join(directory, 'state');
  const store = createSessionStore({ stateDir });
  const key = store.open(file, { mode }).session.key;
  try { await run({ directory, stateDir, store, key }); }
  finally { fs.rmSync(directory, { recursive: true, force: true }); }
}
async function test(name, run) {
  try { await run(); passed++; console.log('PASS ' + name); }
  catch (error) { failed++; console.log('FAIL ' + name + ': ' + error.stack); }
}
async function main() {
  for (const mode of ['ui', 'plan']) {
    await test(mode + ' reply and End publish replacements and preserve old snapshots and public shapes', () => fixture(mode, ({ stateDir, store, key }) => {
      store.queueFeedback(key, [{ kind: 'chat', text: 'Human request' }]);
      const queued = store.get(key); const queuedBytes = JSON.stringify(queued);
      store.takeFeedback(key);
      const drained = store.get(key); const drainedBytes = JSON.stringify(drained);
      freeze(queued); freeze(drained);
      const entry = store.addAgentReply(key, 'Agent response');
      const replied = store.get(key);
      assert.notEqual(replied, drained);
      assert.deepEqual(entry, { role: 'agent', kind: 'chat', text: 'Agent response', at: entry.at });
      assert.equal(replied.chat.at(-1), entry);
      assert.equal(replied.chat.length, 2);
      assert.equal(JSON.stringify(queued), queuedBytes);
      assert.equal(JSON.stringify(drained), drainedBytes);
      assert.deepEqual(createSessionStore({ stateDir }).get(key), replied);
      const repliedBytes = JSON.stringify(replied); freeze(replied);
      const ended = store.end(key, 'user');
      assert.equal(ended, store.get(key));
      assert.notEqual(ended, replied);
      assert.equal(ended.key, key); assert.equal(ended.status, 'ended'); assert.equal(ended.endedBy, 'user');
      assert.equal(JSON.stringify(replied), repliedBytes);
      assert.deepEqual(ended.chat, replied.chat);
      assert.deepEqual(createSessionStore({ stateDir }).get(key), ended);
      assert.equal(store.addAgentReply('missing', 'unused'), null);
      assert.equal(store.end('missing', 'user'), null);
    }));
  }
  await test('failed reply and End persistence preserve live/disk state and retry without duplicates', () => fixture('ui', ({ directory, stateDir, store, key }) => {
    store.addAgentReply(key, 'Existing reply');
    const original = store.get(key); const before = JSON.stringify(original); freeze(original);
    const disk = fs.readFileSync(store.stateFile, 'utf8');
    const obstacle = path.join(directory, 'state', 'sessions.json.tmp'); fs.mkdirSync(obstacle);
    assert.throws(() => store.addAgentReply(key, 'Uncommitted reply'), error => ['EISDIR', 'EACCES', 'EPERM'].includes(error.code));
    assert.equal(store.get(key), original); assert.equal(JSON.stringify(original), before);
    assert.equal(fs.readFileSync(store.stateFile, 'utf8'), disk);
    assert.throws(() => store.end(key, 'user'), error => ['EISDIR', 'EACCES', 'EPERM'].includes(error.code));
    assert.equal(store.get(key), original); assert.equal(JSON.stringify(original), before);
    assert.equal(fs.readFileSync(store.stateFile, 'utf8'), disk);
    fs.rmdirSync(obstacle);
    const retry = store.addAgentReply(key, 'Retried reply');
    assert.equal(store.get(key).chat.length, 2); assert.equal(store.get(key).chat.at(-1), retry);
    const replied = store.get(key); freeze(replied);
    assert.equal(store.end(key, 'unexpected').endedBy, 'agent');
    assert.equal(replied.status, 'open'); assert.deepEqual(createSessionStore({ stateDir }).get(key), store.get(key));
  }));
  await test('actual HTTP reply and End preserve snapshots through failed persistence and recovery', () => fixture('ui', async ({ directory, stateDir, store, key }) => {
    const server = createPlanCanvasServer({ store }); const { port } = await server.listen(0);
    const request = (action, body) => new Promise((resolve, reject) => {
      const req = http.request({ host: '127.0.0.1', port, method: 'POST', path: '/api/session/' + key + '/' + action,
        headers: { 'content-type': 'application/json' } }, res => {
        let text = ''; res.on('data', chunk => { text += chunk; }); res.on('end', () => resolve({ status: res.statusCode, body: JSON.parse(text) }));
      });
      req.on('error', reject); req.end(body ? JSON.stringify(body) : undefined);
    });
    try {
      const original = store.get(key); const before = JSON.stringify(original); freeze(original);
      const disk = fs.readFileSync(store.stateFile, 'utf8');
      const obstacle = path.join(directory, 'state', 'sessions.json.tmp'); fs.mkdirSync(obstacle);
      assert.notEqual((await request('reply', { text: 'Not durable' })).status, 200);
      assert.notEqual((await request('end')).status, 200);
      assert.equal(store.get(key), original); assert.equal(JSON.stringify(original), before);
      assert.equal(fs.readFileSync(store.stateFile, 'utf8'), disk);
      fs.rmdirSync(obstacle);
      const sent = await request('reply', { text: 'Durable response' });
      assert.equal(sent.status, 200); assert.equal(sent.body.status, 'sent'); assert.match(sent.body.at, /^\d{4}-/);
      const replied = store.get(key); freeze(replied);
      assert.equal(JSON.stringify(original), before); assert.equal(replied.chat.length, 1);
      assert.deepEqual((await request('end')).body, { status: 'ended', endedBy: 'user' });
      assert.equal(store.get(key).status, 'ended'); assert.equal(replied.status, 'open');
      assert.deepEqual(createSessionStore({ stateDir }).get(key), store.get(key));
    } finally { await server.close(); }
  }));
  console.log('Passed: ' + passed + '\nFailed: ' + failed); process.exitCode = failed ? 1 : 0;
}
main().catch(error => { console.error(error); process.exitCode = 1; });
