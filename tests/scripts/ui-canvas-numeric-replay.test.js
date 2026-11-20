'use strict';

const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const http = require('node:http');
const vm = require('node:vm');
const { createSessionStore } = require('../../scripts/lib/plan-canvas/sessions');
const { createPlanCanvasServer } = require('../../scripts/lib/plan-canvas/server');
const { normalizeEdit } = require('../../scripts/lib/ui-canvas/feedback');
const { uiEditorJs } = require('../../scripts/lib/ui-canvas/editor');
const { editorGesturesJs } = require('../../scripts/lib/ui-canvas/editor-gestures');

let passed = 0;
let failed = 0;
async function test(name, run) {
  try { await run(); passed++; console.log('PASS ' + name); }
  catch (error) { failed++; console.log('FAIL ' + name + ': ' + error.stack); }
}
const section = (source, start, end) => source.slice(source.indexOf(start), source.indexOf(end, source.indexOf(start)));
function style(left, top) {
  return { left: left + 'px', top: top + 'px', position: 'relative',
    getPropertyValue(name) { return this[name] || ''; },
    setProperty(name, value) { this[name] = value; },
    removeProperty(name) { delete this[name]; } };
}
function captureDrag(left, top, nextLeft, nextTop) {
  let captured;
  const target = { style: style(nextLeft, nextTop), isConnected: true };
  const context = { document: { documentElement: { removeAttribute() {} } }, post() {}, toast() {},
    px: value => Number.parseFloat(value) || 0,
    newEdit: (kind, _el, detail) => ({ id: 'nudge1', kind, selector: '#a', ...detail }),
    record: edit => { const { _el, _inlineBefore, ...record } = edit; captured = record; },
    applyInline: (el, values) => Object.assign(el.style, values) };
  vm.createContext(context);
  vm.runInContext(section(editorGesturesJs(), '  function endDrag(', '  function nudgeBy('), context);
  context.endDrag({ kind: 'nudge', el: target, baseLeft: left, baseTop: top,
    inlineBefore: { left: left + 'px', top: top + 'px' } });
  return captured;
}
function replay(edit, left, top) {
  const target = { style: style(left, top), isConnected: true };
  const context = { px: value => Number.parseFloat(value) || 0, getComputedStyle: () => ({ position: 'relative' }), resolveForEdit: () => target };
  vm.createContext(context);
  const source = uiEditorJs();
  vm.runInContext(section(source, '  function applyInline(', '  function contentBoxDelta(')
    + section(source, '  function applyEdit(', '  function undo('), context);
  assert.equal(context.applyEdit({ ...edit }, null), true);
  return target.style;
}
async function fixture(run) {
  const directory = fs.mkdtempSync(path.join(os.tmpdir(), 'ecc-ui-numeric-'));
  const file = path.join(directory, 'card.html');
  fs.writeFileSync(file, '<html><body><div id="a"></div></body></html>');
  const stateDir = path.join(directory, 'state');
  const store = createSessionStore({ stateDir });
  const key = store.open(file, { mode: 'ui' }).session.key;
  const server = createPlanCanvasServer({ store });
  const { port } = await server.listen(0);
  function request(body) {
    return new Promise((resolve, reject) => {
      const req = http.request({ host: '127.0.0.1', port, method: 'POST',
        path: '/api/session/' + key + '/feedback', headers: { 'content-type': 'application/json' } }, res => {
        let text = ''; res.on('data', chunk => { text += chunk; });
        res.on('end', () => resolve({ status: res.statusCode, body: JSON.parse(text) }));
      });
      req.on('error', reject); req.end(JSON.stringify(body));
    });
  }
  try { await run({ directory, file, stateDir, store, key, request }); }
  finally { await server.close(); fs.rmSync(directory, { recursive: true, force: true }); }
}
async function main() {
  for (const kind of ['edits', 'finish']) {
    await test('actual fractional drag survives ' + kind + ', disk reopen, drain and generated replay', () => fixture(async ({ stateDir, store, key, request }) => {
      const edit = captureDrag(0.3, -4.1, 32.3, -3.55);
      assert.equal(edit.dx, 32.3 - 0.3);
      assert.notEqual(edit.dx, 32, 'Exercise actual binary floating subtraction, not a rounded substitute');
      assert.equal(edit.dy, -3.55 - -4.1);
      const html = '<html><body><div id="a" style="position:relative;left:32.3px;top:-3.55px"></div></body></html>';
      const response = await request({ deliveryId: (kind === 'edits' ? 'a' : 'b').repeat(32),
        items: [{ kind, html, edits: [edit] }], endSession: kind === 'finish' });
      assert.equal(response.status, 200, JSON.stringify(response.body));
      assert.deepEqual(response.body.acceptedEditIds, ['nudge1']);
      const accepted = store.get(key).pendingFeedback[0];
      assert.equal(fs.readFileSync(accepted.exportPath, 'utf8'), html);
      assert.equal(JSON.parse(fs.readFileSync(accepted.editsPath, 'utf8')).edits[0].dx, edit.dx);
      const reopened = createSessionStore({ stateDir });
      const drained = reopened.takeFeedback(key);
      assert.equal(drained.status, 'feedback');
      const saved = drained.items[0].edits[0];
      assert.equal(saved.dx, edit.dx); assert.equal(saved.dy, edit.dy);
      const replayed = replay(saved, 0.3, -4.1);
      assert.equal(Number.parseFloat(replayed.left), 32.3);
      assert.equal(Number.parseFloat(replayed.top), -3.55);
    }));
  }
  await test('genuine subpixel offsets and bounded numeric strings remain exact', () => {
    for (const [dx, dy] of [[1.5, -0.25], [-20000, 20000], ['1.125', '-0.875']]) {
      const edit = normalizeEdit({ kind: 'nudge', selector: '#a', dx, dy }, 0);
      assert.equal(edit.dx, Number(dx)); assert.equal(edit.dy, Number(dy));
    }
  });
  for (const dx of [20000.25, -20000.25, 'Infinity', 'NaN']) {
    await test('rejects invalid nudge ' + dx + ' before any export or queue write', () => fixture(async ({ directory, store, key, request }) => {
      const before = fs.readdirSync(directory).sort(); const state = JSON.stringify(store.get(key));
      const response = await request({ items: [{ kind: 'edits', html: '<html>captured</html>', edits: [{ id: 'bad', kind: 'nudge', selector: '#a', dx, dy: 0 }] }] });
      assert.equal(response.status, 422, JSON.stringify(response.body));
      assert.deepEqual(fs.readdirSync(directory).sort(), before);
      assert.equal(JSON.stringify(store.get(key)), state);
    }));
  }
  await test('nonfinite normalization stays unusable and other numeric contracts stay integers', () => {
    for (const value of [Infinity, -Infinity, NaN]) assert.equal(normalizeEdit({ kind: 'nudge', selector: '#a', dx: value, dy: 0 }, 0), null);
    assert.equal(normalizeEdit({ kind: 'resize', selector: '#a', width: 10.6 }, 0).width, 11);
    assert.equal(normalizeEdit({ kind: 'move', selector: '#a', from: { parent: 'body', index: 0 }, to: { parent: 'body', index: 1.6 } }, 0).to.index, 2);
  });
  console.log('Passed: ' + passed + '\nFailed: ' + failed); process.exitCode = failed ? 1 : 0;
}
main().catch(error => { console.error(error); process.exitCode = 1; });
