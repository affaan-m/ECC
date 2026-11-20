'use strict';

const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const http = require('node:http');
const { EventEmitter } = require('node:events');
const { execFile } = require('node:child_process');
const { promisify } = require('node:util');
const { createSessionStore } = require('../../scripts/lib/plan-canvas/sessions');
const { UI_PROFILE } = require('../../scripts/ui-canvas');
const { createPlanCanvasServer } = require('../../scripts/lib/plan-canvas/server');

let passed = 0;
let failed = 0;
async function test(name, run) {
  try { await run(); passed++; console.log(`PASS ${name}`); }
  catch (error) { failed++; console.log(`FAIL ${name}: ${error.stack}`); }
}
const edit = id => ({ id, kind: 'nudge', selector: `#${id}`, dx: 1, dy: 0 });
async function fixture(run, serverOptions = {}) {
  const directory = fs.mkdtempSync(path.join(os.tmpdir(), 'ecc-ui-ack-'));
  const file = path.join(directory, 'card.html');
  fs.writeFileSync(file, '<html><body>original</body></html>');
  const store = createSessionStore({ stateDir: path.join(directory, 'state') });
  const { session } = store.open(file, { mode: 'ui' });
  let server = createPlanCanvasServer({ ...serverOptions, store });
  let { port } = await server.listen(0);
  function request(method, suffix, body, onResponse) {
    return new Promise((resolve, reject) => {
      const payload = body ? JSON.stringify(body) : null;
      const req = http.request({ host: '127.0.0.1', port, method, path: suffix.startsWith('/') ? suffix : `/api/session/${session.key}/${suffix}`, headers: payload ? { 'content-type': 'application/json' } : {} }, response => {
        if (onResponse) onResponse(response.statusCode);
        let text = ''; response.on('data', chunk => { text += chunk; });
        response.on('end', () => { let body; try { body = JSON.parse(text); } catch { body = text; } resolve({ status: response.statusCode, body }); });
      });
      req.on('error', reject); if (payload) req.end(payload); else req.end();
    });
  }
  function parkAwait() {
    let resolveReady;
    let rejectReady;
    const ready = new Promise((resolve, reject) => { resolveReady = resolve; rejectReady = reject; });
    // The server flushes headers/whitespace and registers its wake listeners
    // in the same synchronous turn, before the client can receive a response.
    const result = request('GET', `/api/await?key=${session.key}&timeoutMs=1000`, undefined, resolveReady);
    result.catch(rejectReady);
    return { ready, result };
  }
  async function apply(edits, html, bakedEditIds = []) {
    const response = await request('POST', 'feedback', { items: [{ kind: 'edits', edits, html, bakedEditIds }] });
    assert.equal(response.status, 200); return response.body.batches[0].id;
  }
  async function loseResponse(body) {
    return new Promise((resolve, reject) => {
      const req = http.request({ host: '127.0.0.1', port, method: 'POST', path: `/api/session/${session.key}/feedback`, headers: { 'content-type': 'application/json' } }, response => {
        response.destroy(); resolve(response.statusCode);
      });
      req.on('error', reject); req.end(JSON.stringify(body));
    });
  }
  async function restart() {
    await server.close();
    const reopened = createSessionStore({ stateDir: path.join(directory, 'state') });
    server = createPlanCanvasServer({ ...serverOptions, store: reopened }); ({ port } = await server.listen(0));
    return reopened.get(session.key);
  }
  try { await run({ store, getSession: () => store.get(session.key), file, directory, port, request, parkAwait, apply, loseResponse, restart }); }
  finally { await server.close(); fs.rmSync(directory, { recursive: true, force: true }); }
}

async function main() {
  await test('taking feedback and unrelated saves do not acknowledge queued Apply batches', () => fixture(async ({ store, getSession, file, request, apply }) => {
    const id = await apply([edit('a')], '<html><body>applied</body></html>');
    store.takeFeedback(getSession().key);
    fs.writeFileSync(file, '<html><body>earlier chat save</body></html>');
    await request('GET', `/artifact/${getSession().key}/`);
    assert.deepEqual(getSession().uiBatches.map(batch => batch.id), [id]);
  }));
  await test('exact snapshot acknowledges its batch and only verified included older batches', () => fixture(async ({ getSession, file, request, apply }) => {
    const older = await apply([edit('a'), edit('missing')], '<html><body>first snapshot</body></html>');
    const newer = await apply([edit('b')], '<html><body>partial older snapshot</body></html>', ['a']);
    fs.writeFileSync(file, '<html><body>partial older snapshot</body></html>');
    await request('GET', `/artifact/${getSession().key}/`);
    assert.deepEqual(getSession().uiBatches.map(batch => batch.id), [older]);
    assert.deepEqual(getSession().uiAcknowledged.map(batch => batch.id), [newer]);
    const all = await apply([edit('c')], '<html><body>all represented</body></html>', ['a', 'missing']);
    fs.writeFileSync(file, '<html><body>all represented</body></html>');
    await request('GET', `/artifact/${getSession().key}/`);
    assert.deepEqual(getSession().uiBatches, []);
    assert.deepEqual(getSession().uiAcknowledged.map(batch => batch.id).sort(), [newer, all, older].sort());
  }));
  await test('specific acknowledgment is durable and clears only named known batches', () => fixture(async ({ getSession, directory, request, apply }) => {
    const first = await apply([edit('a')], '<html>one</html>'); const second = await apply([edit('b')], '<html>two</html>');
    const response = await request('POST', 'reply', { acknowledge: [first], text: 'Applied first only' });
    assert.equal(response.status, 200);
    const reopened = createSessionStore({ stateDir: path.join(directory, 'state') }).get(getSession().key);
    assert.deepEqual(reopened.uiBatches.map(batch => batch.id), [second]);
    assert.deepEqual(reopened.uiAcknowledged.map(batch => batch.id), [first]);
    assert.equal((await request('POST', 'reply', { acknowledge: [first] })).status, 200, 'acknowledgment is idempotent');
    assert.equal((await request('POST', 'reply', { text: 'Legacy reply remains valid' })).status, 200);
  }));
  await test('invalid reply fields or mixed unknown IDs have no partial side effects', () => fixture(async ({ getSession, request, apply }) => {
    const id = await apply([edit('a')], '<html>one</html>');
    const count = getSession().chat.length;
    for (const acknowledge of [null, [], 'fb-1', ['fb-0'], [1], [id, 'fb-999999']]) {
      assert.equal((await request('POST', 'reply', { acknowledge, text: 'must not publish' })).status, 400);
      assert.deepEqual(getSession().uiBatches.map(batch => batch.id), [id]); assert.equal(getSession().chat.length, count);
    }
    for (const text of [3, null, '', ' ']) {
      assert.equal((await request('POST', 'reply', { acknowledge: [id], text })).status, 400);
      assert.deepEqual(getSession().uiBatches.map(batch => batch.id), [id]);
    }
  }));
  await test('state write failure rolls back acknowledgment and its accompanying reply together', () => fixture(async ({ getSession, directory, request, apply }) => {
    const id = await apply([edit('a')], '<html>one</html>'); const count = getSession().chat.length;
    fs.mkdirSync(path.join(directory, 'state', 'sessions.json.tmp'));
    const response = await request('POST', 'reply', { acknowledge: [id], text: 'must not partially publish' });
    assert.equal(response.status, 500); assert.equal(getSession().chat.length, count);
    assert.deepEqual(getSession().uiBatches.map(batch => batch.id), [id]);
    const reopened = createSessionStore({ stateDir: path.join(directory, 'state') }).get(getSession().key);
    assert.deepEqual(reopened.uiBatches.map(batch => batch.id), [id]); assert.equal(reopened.chat.length, count);
  }));
  await test('oversized or malformed proof fails before writing an export or queuing anything', () => fixture(async ({ getSession, directory, request }) => {
    const before = fs.readdirSync(directory).sort();
    for (const bakedEditIds of [Array(5001).fill('e1'), ['x'.repeat(41)], [3], 'e1']) {
      const response = await request('POST', 'feedback', { items: [{ kind: 'edits', edits: [edit('a')], html: '<html>snapshot</html>', bakedEditIds }] });
      assert.equal(response.status, 413); assert.equal(getSession().pendingFeedback.length, 0);
      assert.deepEqual(fs.readdirSync(directory).sort(), before);
    }
    const response = await request('POST', 'feedback', { items: [{ kind: 'edits', edits: Array(501).fill(edit('a')), html: '<html>snapshot</html>' }] });
    assert.equal(response.status, 413); assert.deepEqual(fs.readdirSync(directory).sort(), before);
    const mixed = await request('POST', 'feedback', { items: [
      { kind: 'edits', edits: [edit('a')], html: '<html>valid first item</html>' },
      { kind: 'edits', edits: [edit('b')], html: '<html>invalid later item</html>', bakedEditIds: Array(5001).fill('e1') },
    ] });
    assert.equal(mixed.status, 413); assert.deepEqual(fs.readdirSync(directory).sort(), before);
  }));
  await test('actual CLI preserves file/key awaits and plain replies while validating acknowledgments', () => fixture(async ({ getSession, store, file, directory, port, apply }) => {
    const first = await apply([edit('a')], '<html>one</html>'); const second = await apply([edit('b')], '<html>two</html>');
    store.takeFeedback(getSession().key);
    const cli = (...args) => promisify(execFile)(process.execPath, [path.join(__dirname, '../../scripts/ui-canvas.js'), ...args], {
      env: { ...process.env, ECC_PLAN_CANVAS_PORT: String(port), ECC_PLAN_CANVAS_STATE_DIR: path.join(directory, 'state') }, timeout: 5000,
    });
    await cli('await', file, '--ack', first, '--reply', 'First incorporated', '--timeout-ms', '1');
    assert.deepEqual(getSession().uiBatches.map(batch => batch.id), [second]);
    await cli('await', '--session-key', getSession().key, '--ack', second, '--timeout-ms', '1');
    assert.deepEqual(getSession().uiBatches, []);
    await cli('await', file, '--reply', 'Old reply without ack', '--timeout-ms', '1');
    assert.equal(getSession().chat.at(-1).text, 'Old reply without ack');
    await assert.rejects(cli('await', file, '--ack', 'fb-0'), error => { assert.match(error.stdout, /requires comma-separated UI batch IDs/); return true; });
    await assert.rejects(cli('await', file, '--ack', 'fb-999999'), error => { assert.match(error.stdout, /unknown UI batch ID/); return true; });
  }));
  await test('latest-snapshot guidance acknowledges only its batch and proven coverage', () => {
    const first = { kind: 'edits', id: 'fb-1', exportPath: '/first.html', editCount: 1 };
    const latest = { kind: 'edits', id: 'fb-2', exportPath: '/latest.html', editCount: 1, includedBatches: [] };
    const uncovered = UI_PROFILE.nextSteps.feedback({ items: [first, latest] });
    assert.match(uncovered, /--ack fb-2 --reply/); assert.doesNotMatch(uncovered, /--ack [^ ]*fb-1/);
    assert.match(uncovered, /Resolve any other Apply batches separately/);
    const covered = UI_PROFILE.nextSteps.feedback({ items: [first, { ...latest, includedBatches: ['fb-1'] }] });
    assert.match(covered, /--ack fb-2,fb-1 --reply/); assert.doesNotMatch(covered, /Resolve any other/);
    const oversized = UI_PROFILE.nextSteps.feedback({ items: [{ ...latest, includedBatches: Array.from({ length: 50 }, (_, index) => `fb-${index + 10}`) }] });
    assert.doesNotMatch(oversized, /--ack /); assert.match(oversized, /groups of at most 50/);
  });
  await test('failed Apply and Finish persistence restore session/counter so retry queues one batch', () => fixture(async ({ getSession, store, directory, request }) => {
    const before = JSON.stringify(getSession()); const original = getSession();
    const stateFile = path.join(directory, 'state', 'sessions.json'); const beforeState = fs.readFileSync(stateFile, 'utf8');
    const obstacle = path.join(directory, 'state', 'sessions.json.tmp'); fs.mkdirSync(obstacle);
    const item = { kind: 'edits', edits: [edit('a')], html: '<html>one nudge</html>' };
    const deliveryId = 'c'.repeat(32);
    assert.equal((await request('POST', 'feedback', { items: [item], deliveryId })).status, 500);
    assert.equal(store.get(getSession().key), original, 'Session object identity is preserved');
    assert.equal(JSON.stringify(getSession()), before); assert.equal(fs.readFileSync(stateFile, 'utf8'), beforeState);
    assert.equal((await request('POST', 'feedback', { items: [{ ...item, kind: 'finish' }], endSession: true, deliveryId })).status, 500);
    assert.equal(JSON.stringify(getSession()), before, 'Failed Finish must not end the session');
    fs.rmdirSync(obstacle);
    const retry = await request('POST', 'feedback', { items: [item], deliveryId }); assert.equal(retry.status, 200);
    assert.equal(retry.body.batches[0].id, 'fb-1', 'Failed saves must restore feedbackCounter too');
    assert.equal(getSession().pendingFeedback.length, 1); assert.equal(getSession().uiBatches.length, 1); assert.equal(getSession().chat.length, 1);
    assert.equal(getSession().uiBatches[0].edits[0].id, 'a'); assert.equal(getSession().status, 'feedback');
    assert.equal(Object.keys(getSession().uiDeliveries).length, 1);
  }));
  await test('readable matching artifact survives acknowledgment write failure without retiring its batch', () => fixture(async ({ getSession, file, directory, request, apply }) => {
    const html = '<html><body><article id="a" style="position:relative;left:1px">A</article></body></html>';
    const id = await apply([edit('a')], html); fs.writeFileSync(file, html);
    const obstacle = path.join(directory, 'state', 'sessions.json.tmp'); fs.mkdirSync(obstacle);
    const result = await request('GET', `/artifact/${getSession().key}/`);
    assert.equal(result.status, 200); assert.match(result.body, /left:1px/);
    assert.deepEqual(getSession().uiBatches.map(batch => batch.id), [id]);
    assert.equal((getSession().uiAcknowledged || []).length, 0);
    assert.ok(result.body.includes(`data-source-sha256="${getSession().uiBatches[0].snapshotHash}"`), 'Current frame can recognize the exact already-represented batch without clearing durable queue state');
    fs.rmdirSync(obstacle);
    assert.equal((await request('GET', `/artifact/${getSession().key}/`)).status, 200);
    assert.deepEqual(getSession().uiBatches, []);
  }));
  await test('lost successful Apply response retries the same token without another batch or export', () => fixture(async ({ getSession, directory, request, loseResponse, restart }) => {
    const item = { kind: 'edits', edits: [edit('a')], html: '<html>original immutable snapshot</html>', text: 'original note' };
    const body = { items: [item], deliveryId: 'a'.repeat(32), endSession: false };
    assert.equal(await loseResponse(body), 200);
    const files = fs.readdirSync(directory).sort(); const originalId = getSession().pendingFeedback[0].id;
    const reopened = await restart();
    const retry = await request('POST', 'feedback', { deliveryId: body.deliveryId, items: [{ html: item.html, text: item.text, edits: item.edits, kind: item.kind }] });
    assert.equal(retry.status, 200); assert.equal(retry.body.batches[0].id, originalId);
    assert.deepEqual(retry.body.acceptedEditIds, ['a']); assert.equal(retry.body.acceptedText, 'original note');
    assert.equal(reopened.pendingFeedback.length, 1); assert.equal(reopened.uiBatches.length, 1); assert.equal(reopened.chat.length, 1);
    assert.deepEqual(fs.readdirSync(directory).sort(), files);
    assert.equal((await request('POST', 'feedback', { ...body, items: [{ ...item, html: '<html>changed payload</html>' }] })).status, 409);
    assert.deepEqual(fs.readdirSync(directory).sort(), files); assert.equal(reopened.pendingFeedback.length, 1);
  }));
  await test('lost Finish response retries before ended rejection and cannot rewrite its final export', () => fixture(async ({ getSession, request, loseResponse, restart }) => {
    const item = { kind: 'finish', edits: [edit('a')], html: '<html>final immutable design</html>', text: 'final note' };
    const body = { items: [item], deliveryId: 'b'.repeat(32), endSession: true };
    assert.equal(await loseResponse(body), 200); assert.equal(getSession().status, 'ended');
    const finalPath = getSession().pendingFeedback[0].exportPath; const preserved = finalPath + '.preserved';
    fs.renameSync(finalPath, preserved); fs.mkdirSync(finalPath);
    const reopened = await restart(); const retry = await request('POST', 'feedback', body);
    assert.equal(retry.status, 200); assert.deepEqual(retry.body.acceptedEditIds, ['a']); assert.equal(retry.body.sessionEnded, true);
    assert.equal(reopened.pendingFeedback.length, 1); assert.equal(reopened.chat.length, 1); assert.ok(fs.statSync(finalPath).isDirectory());
    assert.equal((await request('POST', 'feedback', { ...body, deliveryId: 'd'.repeat(32) })).status, 409);
    assert.equal((await request('POST', 'feedback', { ...body, items: [{ ...item, text: 'changed note' }] })).status, 409);
    assert.ok(fs.statSync(finalPath).isDirectory()); fs.rmdirSync(finalPath); fs.renameSync(preserved, finalPath);
  }));
  await test('receipt retry returns durable acknowledgments missed during an exact source save', () => fixture(async ({ getSession, file, request, apply }) => {
    const first = await apply([edit('a')], '<html>first</html>');
    const body = { deliveryId: '7'.repeat(32), items: [{ kind: 'edits', edits: [edit('b')], bakedEditIds: ['a'], html: '<html>both</html>' }] };
    const accepted = await request('POST', 'feedback', body); assert.equal(accepted.status, 200);
    const second = accepted.body.batches[0].id;
    fs.writeFileSync(file, '<html>both</html>'); await request('GET', `/artifact/${getSession().key}/`);
    const retry = await request('POST', 'feedback', body);
    assert.deepEqual(retry.body.batches, []);
    assert.deepEqual(retry.body.acknowledgedBatches.map(batch => batch.id).sort(), [first, second].sort());
    assert.deepEqual(retry.body.acknowledgedBatches.flatMap(batch => batch.editIds).sort(), ['a', 'b']);
  }));
  await test('failed drain preserves live feedback and the next await delivers it once', () => fixture(async ({ getSession, directory, request, apply }) => {
    await apply([edit('a')], '<html>retained feedback</html>'); const before = JSON.stringify(getSession());
    const obstacle = path.join(directory, 'state', 'sessions.json.tmp'); fs.mkdirSync(obstacle);
    assert.equal((await request('GET', `/api/await?key=${getSession().key}&timeoutMs=1`)).status, 500);
    assert.equal(JSON.stringify(getSession()), before);
    fs.rmdirSync(obstacle);
    const received = await request('GET', `/api/await?key=${getSession().key}&timeoutMs=1`);
    assert.equal(received.body.status, 'feedback'); assert.equal(received.body.items.length, 1);
    assert.equal((await request('GET', `/api/await?key=${getSession().key}&timeoutMs=1`)).body.status, 'waiting');
  }));
  await test('postcommit drain failure cannot turn durable acceptance into a rejection', () => fixture(async ({ getSession, store, directory, request, parkAwait }) => {
    const parked = parkAwait();
    assert.equal(await parked.ready, 200);
    const original = store.queueFeedback; const obstacle = path.join(directory, 'state', 'sessions.json.tmp');
    store.queueFeedback = (...args) => { const result = original(...args); fs.mkdirSync(obstacle); return result; };
    const body = { deliveryId: 'e'.repeat(32), items: [{ kind: 'edits', edits: [edit('a')], html: '<html>accepted before wake fault</html>' }] };
    const accepted = await request('POST', 'feedback', body);
    assert.equal(accepted.status, 200); assert.deepEqual(accepted.body.acceptedEditIds, ['a']);
    assert.equal((await parked.result).body.status, 'waiting'); assert.equal(getSession().pendingFeedback.length, 1);
    store.queueFeedback = original; fs.rmdirSync(obstacle);
    const retry = await request('POST', 'feedback', body);
    assert.equal(retry.status, 200); assert.equal(getSession().uiBatches.length, 1); assert.equal(getSession().chat.length, 1);
    assert.equal((await request('GET', `/api/await?key=${getSession().key}&timeoutMs=1`)).body.items.length, 1);
  }));
  await test('immediate long-poll drain returns a fresh receipt and pending count', () => fixture(async ({ getSession, request, parkAwait }) => {
    const parked = parkAwait();
    assert.equal(await parked.ready, 200);
    const body = { deliveryId: 'f'.repeat(32), items: [{ kind: 'edits', edits: [edit('a')], html: '<html>fresh receipt</html>' }] };
    const result = await request('POST', 'feedback', body);
    assert.equal(result.status, 200); assert.deepEqual(result.body.acceptedEditIds, ['a']);
    assert.equal((await parked.result).body.items.length, 1);
    assert.equal(result.body.pending, 0); assert.equal(getSession().pendingFeedback.length, 0);
    assert.equal((await request('POST', 'feedback', body)).body.pending, 0);
    assert.equal(getSession().uiBatches.length, 1);
  }));
  await test('registered watcher callback reads the latest session and durably acknowledges its snapshot', async () => {
    let registeredCallback;
    let watchedDirectory;
    let closed = false;
    class CallbackWatcher extends EventEmitter { close() { closed = true; } }
    const watch = (directory, callback) => {
      watchedDirectory = directory;
      registeredCallback = callback;
      return new CallbackWatcher();
    };
    await fixture(async ({ getSession, file, directory, request, apply }) => {
      assert.equal((await request('POST', '/api/sessions', { file, mode: 'ui' })).status, 200);
      assert.equal(typeof registeredCallback, 'function');
      assert.equal(watchedDirectory, path.dirname(getSession().file));
      const html = '<html><body>watcher observes accepted snapshot</body></html>';
      const id = await apply([edit('a')], html);
      fs.writeFileSync(file, html);
      // Callback-state evidence, independent of platform watch startup.
      // The default native watch workflow is verified separately.
      registeredCallback('change', path.basename(file));
      const deadline = Date.now() + 2000;
      while (getSession().uiBatches.length && Date.now() < deadline) await new Promise(resolve => setTimeout(resolve, 20));
      assert.deepEqual(getSession().uiBatches, []);
      assert.deepEqual(getSession().uiAcknowledged.map(batch => batch.id), [id]);
      const durable = createSessionStore({ stateDir: path.join(directory, 'state') }).get(getSession().key);
      assert.deepEqual(durable.uiBatches, []);
      assert.deepEqual(durable.uiAcknowledged.map(batch => batch.id), [id]);
      const artifact = await request('GET', `/artifact/${getSession().key}/`);
      assert.equal(artifact.status, 200);
      assert.match(artifact.body, /watcher observes accepted snapshot/);
    }, { watch });
    assert.equal(closed, true, 'server.close must release the registered watcher');
  });
  await test('delivery tokens are validated, session scoped, and cannot bypass explicit End', () => fixture(async ({ getSession, store, directory, request }) => {
    const item = { kind: 'edits', edits: [edit('a')], html: '<html>one</html>' }; const before = fs.readdirSync(directory).sort();
    for (const deliveryId of [null, '', 'a'.repeat(31), 'A'.repeat(32), {}, 3]) {
      assert.equal((await request('POST', 'feedback', { deliveryId, items: [item] })).status, 400);
      assert.deepEqual(fs.readdirSync(directory).sort(), before);
    }
    const deliveryId = 'f'.repeat(32); const first = await request('POST', 'feedback', { deliveryId, items: [item] });
    const secondFile = path.join(directory, 'second.html'); fs.writeFileSync(secondFile, '<html>second</html>');
    const second = store.open(secondFile, { mode: 'ui' }).session;
    const accepted = await request('POST', `/api/session/${second.key}/feedback`, { deliveryId, items: [item] });
    assert.equal(accepted.status, 200); assert.notEqual(accepted.body.batches[0].id, first.body.batches[0].id);
    await request('POST', 'end');
    const files = fs.readdirSync(directory).sort();
    assert.equal((await request('POST', 'feedback', { deliveryId: '0'.repeat(32), endSession: true, items: [{ ...item, kind: 'finish' }] })).status, 409);
    assert.deepEqual(fs.readdirSync(directory).sort(), files);
    assert.equal(getSession().pendingFeedback.length, 1);
  }));
  console.log(`Passed: ${passed}\nFailed: ${failed}`); process.exitCode = failed ? 1 : 0;
}
main().catch(error => { console.error(error); process.exitCode = 1; });
