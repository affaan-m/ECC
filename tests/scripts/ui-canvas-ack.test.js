'use strict';

const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const http = require('node:http');
const { execFile } = require('node:child_process');
const { promisify } = require('node:util');
const { createSessionStore } = require('../../scripts/lib/plan-canvas/sessions');
const { createPlanCanvasServer } = require('../../scripts/lib/plan-canvas/server');

let passed = 0;
let failed = 0;
async function test(name, run) {
  try { await run(); passed++; console.log(`PASS ${name}`); }
  catch (error) { failed++; console.log(`FAIL ${name}: ${error.stack}`); }
}
const edit = id => ({ id, kind: 'nudge', selector: `#${id}`, dx: 1, dy: 0 });
async function fixture(run) {
  const directory = fs.mkdtempSync(path.join(os.tmpdir(), 'ecc-ui-ack-'));
  const file = path.join(directory, 'card.html');
  fs.writeFileSync(file, '<html><body>original</body></html>');
  const store = createSessionStore({ stateDir: path.join(directory, 'state') });
  const { session } = store.open(file, { mode: 'ui' });
  const server = createPlanCanvasServer({ store });
  const { port } = await server.listen(0);
  function request(method, suffix, body) {
    return new Promise((resolve, reject) => {
      const payload = body ? JSON.stringify(body) : null;
      const req = http.request({ host: '127.0.0.1', port, method, path: suffix.startsWith('/') ? suffix : `/api/session/${session.key}/${suffix}`, headers: payload ? { 'content-type': 'application/json' } : {} }, response => {
        let text = ''; response.on('data', chunk => { text += chunk; });
        response.on('end', () => { let body; try { body = JSON.parse(text); } catch { body = text; } resolve({ status: response.statusCode, body }); });
      });
      req.on('error', reject); if (payload) req.end(payload); else req.end();
    });
  }
  async function apply(edits, html, bakedEditIds = []) {
    const response = await request('POST', 'feedback', { items: [{ kind: 'edits', edits, html, bakedEditIds }] });
    assert.equal(response.status, 200); return response.body.batches[0].id;
  }
  try { await run({ store, session, file, directory, port, request, apply }); }
  finally { await server.close(); fs.rmSync(directory, { recursive: true, force: true }); }
}

async function main() {
  await test('taking feedback and unrelated saves do not acknowledge queued Apply batches', () => fixture(async ({ store, session, file, request, apply }) => {
    const id = await apply([edit('a')], '<html><body>applied</body></html>');
    store.takeFeedback(session.key);
    fs.writeFileSync(file, '<html><body>earlier chat save</body></html>');
    await request('GET', `/artifact/${session.key}/`);
    assert.deepEqual(session.uiBatches.map(batch => batch.id), [id]);
  }));
  await test('exact snapshot acknowledges its batch and only verified included older batches', () => fixture(async ({ session, file, request, apply }) => {
    const older = await apply([edit('a'), edit('missing')], '<html><body>first snapshot</body></html>');
    const newer = await apply([edit('b')], '<html><body>partial older snapshot</body></html>', ['a']);
    fs.writeFileSync(file, '<html><body>partial older snapshot</body></html>');
    await request('GET', `/artifact/${session.key}/`);
    assert.deepEqual(session.uiBatches.map(batch => batch.id), [older]);
    assert.deepEqual(session.uiAcknowledged.map(batch => batch.id), [newer]);
    const all = await apply([edit('c')], '<html><body>all represented</body></html>', ['a', 'missing']);
    fs.writeFileSync(file, '<html><body>all represented</body></html>');
    await request('GET', `/artifact/${session.key}/`);
    assert.deepEqual(session.uiBatches, []);
    assert.deepEqual(session.uiAcknowledged.map(batch => batch.id).sort(), [newer, all, older].sort());
  }));
  await test('specific acknowledgment is durable and clears only named known batches', () => fixture(async ({ session, directory, request, apply }) => {
    const first = await apply([edit('a')], '<html>one</html>'); const second = await apply([edit('b')], '<html>two</html>');
    const response = await request('POST', 'reply', { acknowledge: [first], text: 'Applied first only' });
    assert.equal(response.status, 200);
    const reopened = createSessionStore({ stateDir: path.join(directory, 'state') }).get(session.key);
    assert.deepEqual(reopened.uiBatches.map(batch => batch.id), [second]);
    assert.deepEqual(reopened.uiAcknowledged.map(batch => batch.id), [first]);
    assert.equal((await request('POST', 'reply', { acknowledge: [first] })).status, 200, 'acknowledgment is idempotent');
    assert.equal((await request('POST', 'reply', { text: 'Legacy reply remains valid' })).status, 200);
  }));
  await test('invalid reply fields or mixed unknown IDs have no partial side effects', () => fixture(async ({ session, request, apply }) => {
    const id = await apply([edit('a')], '<html>one</html>');
    const count = session.chat.length;
    for (const acknowledge of [null, [], 'fb-1', ['fb-0'], [1], [id, 'fb-999999']]) {
      assert.equal((await request('POST', 'reply', { acknowledge, text: 'must not publish' })).status, 400);
      assert.deepEqual(session.uiBatches.map(batch => batch.id), [id]); assert.equal(session.chat.length, count);
    }
    for (const text of [3, null, '', ' ']) {
      assert.equal((await request('POST', 'reply', { acknowledge: [id], text })).status, 400);
      assert.deepEqual(session.uiBatches.map(batch => batch.id), [id]);
    }
  }));
  await test('state write failure rolls back acknowledgment and its accompanying reply together', () => fixture(async ({ session, directory, request, apply }) => {
    const id = await apply([edit('a')], '<html>one</html>'); const count = session.chat.length;
    fs.mkdirSync(path.join(directory, 'state', 'sessions.json.tmp'));
    const response = await request('POST', 'reply', { acknowledge: [id], text: 'must not partially publish' });
    assert.equal(response.status, 500); assert.equal(session.chat.length, count);
    assert.deepEqual(session.uiBatches.map(batch => batch.id), [id]);
    const reopened = createSessionStore({ stateDir: path.join(directory, 'state') }).get(session.key);
    assert.deepEqual(reopened.uiBatches.map(batch => batch.id), [id]); assert.equal(reopened.chat.length, count);
  }));
  await test('oversized or malformed proof fails before writing an export or queuing anything', () => fixture(async ({ session, directory, request }) => {
    const before = fs.readdirSync(directory).sort();
    for (const bakedEditIds of [Array(5001).fill('e1'), ['x'.repeat(41)], [3], 'e1']) {
      const response = await request('POST', 'feedback', { items: [{ kind: 'edits', edits: [edit('a')], html: '<html>snapshot</html>', bakedEditIds }] });
      assert.equal(response.status, 413); assert.equal(session.pendingFeedback.length, 0);
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
  await test('actual CLI preserves file/key awaits and plain replies while validating acknowledgments', () => fixture(async ({ session, store, file, directory, port, apply }) => {
    const first = await apply([edit('a')], '<html>one</html>'); const second = await apply([edit('b')], '<html>two</html>');
    store.takeFeedback(session.key);
    const cli = (...args) => promisify(execFile)(process.execPath, [path.join(__dirname, '../../scripts/ui-canvas.js'), ...args], {
      env: { ...process.env, ECC_PLAN_CANVAS_PORT: String(port), ECC_PLAN_CANVAS_STATE_DIR: path.join(directory, 'state') }, timeout: 5000,
    });
    await cli('await', file, '--ack', first, '--reply', 'First incorporated', '--timeout-ms', '1');
    assert.deepEqual(session.uiBatches.map(batch => batch.id), [second]);
    await cli('await', '--session-key', session.key, '--ack', second, '--timeout-ms', '1');
    assert.deepEqual(session.uiBatches, []);
    await cli('await', file, '--reply', 'Old reply without ack', '--timeout-ms', '1');
    assert.equal(session.chat.at(-1).text, 'Old reply without ack');
    await assert.rejects(cli('await', file, '--ack', 'fb-0'), error => { assert.match(error.stdout, /requires comma-separated UI batch IDs/); return true; });
    await assert.rejects(cli('await', file, '--ack', 'fb-999999'), error => { assert.match(error.stdout, /unknown UI batch ID/); return true; });
  }));
  console.log(`Passed: ${passed}\nFailed: ${failed}`); process.exitCode = failed ? 1 : 0;
}
main().catch(error => { console.error(error); process.exitCode = 1; });
