'use strict';

const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const http = require('node:http');
const { createSessionStore } = require('../../scripts/lib/plan-canvas/sessions');
const { createPlanCanvasServer } = require('../../scripts/lib/plan-canvas/server');
const { UI_PROFILE } = require('../../scripts/ui-canvas');

let passed = 0;
let failed = 0;
async function test(name, run) {
  try { await run(); passed++; console.log(`PASS ${name}`); }
  catch (error) { failed++; console.log(`FAIL ${name}: ${error.stack}`); }
}
const nudge = id => ({ id, kind: 'nudge', selector: '#a', dx: 1, dy: 0 });
async function fixture(run) {
  const directory = fs.mkdtempSync(path.join(os.tmpdir(), 'ecc-ui-replay-validation-'));
  const file = path.join(directory, 'card.html');
  fs.writeFileSync(file, '<html><body><div id="a">Original</div></body></html>');
  const store = createSessionStore({ stateDir: path.join(directory, 'state') });
  const { session } = store.open(file, { mode: 'ui' });
  const server = createPlanCanvasServer({ store });
  const { port } = await server.listen(0);
  function request(items) {
    return new Promise((resolve, reject) => {
      const req = http.request({ host: '127.0.0.1', port, method: 'POST',
        path: `/api/session/${session.key}/feedback`, headers: { 'content-type': 'application/json' } }, response => {
        let text = ''; response.on('data', chunk => { text += chunk; });
        response.on('end', () => resolve({ status: response.statusCode, body: JSON.parse(text) }));
      });
      req.on('error', reject); req.end(JSON.stringify({ items }));
    });
  }
  function item(edits, extra = {}) {
    return { kind: 'edits', html: '<html><body><div id="a">Captured</div></body></html>', edits, ...extra };
  }
  try { await run({ directory, file, store, session, getSession: () => store.get(session.key), request, item }); }
  finally { await server.close(); fs.rmSync(directory, { recursive: true, force: true }); }
}

async function main() {
  for (const [label, edit] of [
    ['text markup', { id: 'e1', kind: 'text', selector: '#a', htmlAfter: 'x'.repeat(20001) }],
    ['plain text', { id: 'e1', kind: 'text', selector: '#a', after: 'x'.repeat(4001) }],
    ['style value', { id: 'e1', kind: 'style', selector: '#a', property: 'color', after: 'x'.repeat(501) }],
    ['selector', { ...nudge('e1'), selector: '#' + 'a'.repeat(500) }],
    ['edit identity', nudge('e'.repeat(41))],
    ['resize bound', { id: 'e1', kind: 'resize', selector: '#a', width: 20001 }],
    ['nudge bound', { ...nudge('e1'), dx: -20001 }],
    ['fractional resize', { id: 'e1', kind: 'resize', selector: '#a', width: 1.5 }],
    ['move index', { id: 'e1', kind: 'move', selector: '#a', from: { parent: 'body', index: 0 }, to: { parent: 'body', index: 100001 } }],
    ['move parent', { id: 'e1', kind: 'move', selector: '#a', from: { parent: 'body', index: 0 }, to: { parent: '#' + 'a'.repeat(500), index: 0 } }],
  ]) {
    await test(`rejects lossy ${label} before exports or queue mutation`, () => fixture(async ({ directory, getSession, request, item }) => {
      const before = fs.readdirSync(directory).sort();
      const state = JSON.stringify(getSession());
      const response = await request([item([edit])]);
      assert.equal(response.status, 422, JSON.stringify(response.body));
      assert.deepEqual(fs.readdirSync(directory).sort(), before);
      assert.equal(JSON.stringify(getSession()), state);
    }));
  }
  await test('a later lossy item prevents exporting an earlier valid item', () => fixture(async ({ directory, request, item }) => {
    const before = fs.readdirSync(directory).sort();
    const response = await request([item([nudge('e1')]), item([{ id: 'e2', kind: 'text', selector: '#a', htmlAfter: 'x'.repeat(20001) }])]);
    assert.equal(response.status, 422);
    assert.deepEqual(fs.readdirSync(directory).sort(), before);
  }));
  await test('boundary-size text and numeric replay payloads remain complete', () => fixture(async ({ getSession, request, item }) => {
    const text = 'x'.repeat(20000);
    const html = `<html><body><div id="a" style="width:20000px;height:1px;position:relative;left:-20000px;top:20000px">${text}</div></body></html>`;
    const response = await request([item([
      { id: 'text', kind: 'text', selector: '#a', htmlAfter: text },
      { id: 'resize', kind: 'resize', selector: '#a', width: 20000, height: 1 },
      { ...nudge('nudge'), dx: -20000, dy: 20000 },
    ], { html })]);
    assert.equal(response.status, 200);
    assert.equal(response.body.batches[0].edits[0].htmlAfter, text);
    assert.equal(getSession().uiBatches[0].edits[1].width, 20000);
    assert.equal(getSession().uiBatches[0].edits[2].dx, -20000);
    assert.equal(fs.readFileSync(getSession().pendingFeedback[0].exportPath, 'utf8'), html);
  }));
  await test('an empty older batch is not covered by unrelated edit IDs', () => fixture(async ({ store, session, getSession, request, item }) => {
    const empty = store.queueFeedback(session.key, [{ kind: 'edits', edits: [], snapshotHash: 'a'.repeat(64) }]).accepted[0].id;
    const response = await request([item([nudge('new')], { bakedEditIds: [] })]);
    assert.equal(response.status, 200);
    assert.deepEqual(getSession().uiBatches.at(-1).includedBatches, []);
    assert.ok(getSession().uiBatches.some(batch => batch.id === empty));
  }));
  for (const count of [49, 50]) {
    await test(`${count} covered older batches ${count === 49 ? 'fit' : 'exceed'} the acknowledgment limit`, () => fixture(async ({ directory, store, session, getSession, request, item }) => {
      const ids = Array.from({ length: count }, (_, index) => `old-${index}`);
      store.queueFeedback(session.key, ids.map(id => ({ kind: 'edits', edits: [nudge(id)], snapshotHash: 'a'.repeat(64) })));
      const before = fs.readdirSync(directory).sort();
      const state = JSON.stringify(getSession());
      const response = await request([item([nudge('latest')], { bakedEditIds: ids })]);
      if (count === 50) {
        assert.equal(response.status, 413);
        assert.equal(JSON.stringify(getSession()), state);
        assert.deepEqual(fs.readdirSync(directory).sort(), before);
      } else {
        assert.equal(response.status, 200);
        const latest = getSession().pendingFeedback.at(-1);
        assert.equal(latest.includedBatches.length, 49);
        const hint = UI_PROFILE.nextSteps.feedback({ items: getSession().pendingFeedback });
        assert.equal(hint.match(/--ack ([^ ]+)/)[1].split(',').length, 50);
      }
    }));
  }
  console.log(`Passed: ${passed}\nFailed: ${failed}`); process.exitCode = failed ? 1 : 0;
}
main().catch(error => { console.error(error); process.exitCode = 1; });
