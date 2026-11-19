'use strict';

const assert = require('node:assert/strict');
const vm = require('node:vm');
const { uiClientJs } = require('../../scripts/lib/ui-canvas/ui');
const { uiEditorJs } = require('../../scripts/lib/ui-canvas/editor');
const { editorGesturesJs } = require('../../scripts/lib/ui-canvas/editor-gestures');

let passed = 0;
let failed = 0;
const tick = async () => { for (let i = 0; i < 12; i++) await Promise.resolve(); };
async function test(name, run) {
  try { await run(); passed++; console.log(`PASS ${name}`); }
  catch (error) { failed++; console.log(`FAIL ${name}: ${error.stack}`); }
}
function element() {
  const handlers = {};
  return {
    handlers, value: '', textContent: '', innerHTML: '', style: {}, disabled: false,
    classList: { add() {}, remove() {}, toggle() {} },
    addEventListener(type, run) { handlers[type] = run; },
    setAttribute() {}, removeAttribute() {}, getAttribute() { return '/artifact/test/'; },
    append() {}, appendChild() {}, querySelector: () => element(),
    getBoundingClientRect: () => ({ width: 1200, height: 900 }),
  };
}
function client({ boot = {}, stored = {} } = {}) {
  const nodes = new Map();
  const node = id => { if (!nodes.has(id)) nodes.set(id, element()); return nodes.get(id); };
  node('uc-session').textContent = JSON.stringify({ key: 'abcdefabcdef', status: 'open', chat: [], presets: { desktop: { width: 1200, height: 900 } }, ...boot });
  const packets = [];
  const frame = { postMessage: packet => packets.push(packet) };
  node('artifact').contentWindow = frame;
  let saved = stored;
  let message;
  let events;
  let answer;
  const context = {
    document: { addEventListener() {}, getElementById: node, querySelectorAll: () => [], createElement: element, documentElement: element(), activeElement: null },
    window: { addEventListener(type, run) { if (type === 'message') message = run; } },
    sessionStorage: { getItem: () => JSON.stringify(saved), setItem: (_key, value) => { saved = JSON.parse(value); } },
    localStorage: { getItem: () => null, setItem() {} },
    setTimeout: () => 1, clearTimeout() {},
    EventSource: class { constructor() { events = {}; } addEventListener(type, run) { events[type] = run; } },
    fetch: () => new Promise(resolve => { answer = resolve; }),
  };
  vm.runInNewContext(uiClientJs(), context);
  return {
    node, packets, saved: () => saved,
    message: data => message({ source: frame, data }),
    event: (name, data = {}) => events[name]({ data: JSON.stringify(data) }),
    answer: body => answer({ ok: true, json: async () => body }),
    fail: () => answer({ ok: false, status: 500, json: async () => ({ error: 'controlled failure' }) }),
  };
}
const first = { id: 'e1', kind: 'nudge', selector: '#a', dx: 1, dy: 0 };
const later = { id: 'e2', kind: 'nudge', selector: '#a', dx: 1, dy: 0 };
async function capture(harness) {
  harness.message({ type: 'uc:edits', edits: [first], canUndo: true });
  harness.node('applyBtn').handlers.click();
  const packet = harness.packets.find(item => item.type === 'uc:export');
  harness.message({ type: 'uc:export', requestId: packet.requestId, edits: [first], html: '<html></html>' });
  await tick();
  return packet;
}

async function main() {
  await test('delayed Apply removes only captured edits and preserves later undoable work', async () => {
    const h = client();
    const packet = await capture(h);
    assert.equal(packet.lock, true);
    h.message({ type: 'uc:edits', edits: [first, later], canUndo: true });
    h.answer({ batches: [{ id: 'fb-1', edits: [first] }] });
    await tick();
    assert.deepEqual(h.saved().edits, [later]);
    assert.deepEqual(h.saved().submittedBatches.map(batch => batch.id), ['fb-1']);
    const completed = h.packets.find(item => item.type === 'uc:delivery-end');
    assert.equal(completed.accepted, true);
    assert.deepEqual(Array.from(completed.editIds), ['e1']);
  });
  await test('unrelated reload retains submitted batches; explicit ack clears only known batch', () => {
    const h = client({ boot: { uiBatches: [{ id: 'fb-1', edits: [first] }, { id: 'fb-2', edits: [later] }] } });
    h.event('reload'); h.message({ type: 'uc:ready' });
    assert.deepEqual(h.saved().submittedBatches.map(batch => batch.id), ['fb-1', 'fb-2']);
    const restored = h.packets.filter(packet => packet.type === 'uc:restore').pop();
    assert.deepEqual(Array.from(restored.baked, edit => edit.id), ['e1', 'e2']);
    h.event('ui-ack', { batches: [{ id: 'fb-1', editIds: ['e1'] }] });
    assert.deepEqual(h.saved().submittedBatches.map(batch => batch.id), ['fb-2']);
  });
  await test('ack arriving before delayed Apply response does not resurrect submitted edits', async () => {
    const h = client(); await capture(h);
    h.message({ type: 'uc:edits', edits: [first, later], canUndo: true });
    h.event('ui-ack', { batches: [{ id: 'fb-1', editIds: ['e1'] }] });
    h.answer({ batches: [{ id: 'fb-1', edits: [first] }] }); await tick();
    assert.deepEqual(h.saved().edits, [later]);
    assert.deepEqual(h.saved().submittedBatches, []);
  });
  await test('failed Apply retains all edits and releases the snapshot lock', async () => {
    const h = client(); await capture(h);
    h.message({ type: 'uc:edits', edits: [first, later], canUndo: true });
    h.fail(); await tick();
    assert.deepEqual(h.saved().edits, [first, later]);
    assert.equal(h.packets.find(packet => packet.type === 'uc:delivery-end').accepted, false);
  });
  await test('snapshot boundary prevents rapid nudge, style and resize coalescing', () => {
    const source = editorGesturesJs();
    const start = source.indexOf('  function nudgeBy(');
    const end = source.indexOf('\n  function removeSelected', start);
    const selected = { style: { left: '1px', top: '0px' } };
    const edits = [{ kind: 'nudge', _el: selected, _exported: true, dx: 1, dy: 0, at: new Date().toISOString() }];
    const context = { selected, edits, px: parseFloat, applyInline: (el, values) => Object.assign(el.style, values), captureInline: () => ({}), getComputedStyle: () => ({ position: 'relative' }), newEdit: (kind, _el, detail) => ({ kind, ...detail }), record: edit => edits.push(edit), postEdits() {}, scheduleBoxes() {} };
    vm.runInNewContext(source.slice(start, end) + '\nnudgeBy(1,0);', context);
    assert.equal(edits.length, 2); assert.equal(edits[0].dx, 1); assert.equal(edits[1].dx, 1);
    assert.equal((source.match(/last && !last\._exported/g) || []).length, 3);
  });
  await test('forward reorder A after B uses the post-removal index', () => {
    const source = editorGesturesJs(); const start = source.indexOf('  function endDrag('); const end = source.indexOf('\n  function nudgeBy', start);
    const a = { id: 'a', style: {}, getAttribute: () => '', removeAttribute() {} }; const b = { id: 'b' }; const c = { id: 'c' }; const parent = { children: [a, b, c] };
    const recorded = [];
    vm.runInNewContext(source.slice(start, end) + '\nendDrag(g);', {
      g: { kind: 'move', el: a, fromParent: parent, fromIndex: 0, plan: { container: parent, index: 1 } },
      document: { documentElement: { removeAttribute() {} } }, post() {}, selBox: { classList: { remove() {} } }, ghostEl: { style: {} }, dropEl: { style: {} },
      selectorFor: el => el.id || '#cards', insertAt: (container, el, index) => { container.children = container.children.filter(child => child !== el); container.children.splice(index, 0, el); }, indexIn: (container, el) => container.children.indexOf(el),
      newEdit: (kind, _el, detail) => ({ kind, ...detail }), record: edit => recorded.push(edit), toast() {}, labelFor: () => 'a',
    });
    assert.deepEqual(parent.children.map(child => child.id), ['b', 'a', 'c']); assert.equal(recorded.length, 1);
  });
  await test('delivery acknowledgment preserves later editor edits and refreshes inspector selection', () => {
    const source = uiEditorJs(); const start = source.indexOf("window.addEventListener('message', function (e) {"); const end = source.indexOf('\n  });', start) + 6;
    let listener; let selectionUpdates = 0; const parent = {};
    const context = { window: { parent, addEventListener: (_event, run) => { listener = run; } }, deliveryRequest: 'x1', bakedEditIds: [], edits: [{ id: 'e1' }, { id: 'e2' }], postEdits() {}, postSelection: () => selectionUpdates++ };
    vm.runInNewContext(source.slice(start, end), context);
    listener({ source: parent, data: { type: 'uc:delivery-end', requestId: 'x1', accepted: true, editIds: ['e1'] } });
    assert.deepEqual(context.edits.map(edit => edit.id), ['e2']); assert.equal(selectionUpdates, 1); assert.equal(context.deliveryRequest, null);
  });
  await test('partially replayable submitted batch rolls back represented nudge and survives Reset', () => {
    const source = uiEditorJs();
    const section = (start, end) => source.slice(source.indexOf(start), source.indexOf(end, source.indexOf(start)));
    const style = { left: '1px', top: '0px', position: 'relative', getPropertyValue(name) { return this[name] || ''; }, setProperty(name, value) { this[name] = value; }, removeProperty(name) { delete this[name]; } };
    const target = { style, isConnected: true };
    const context = {
      edits: [], bakedEditIds: [], editSeq: 0, redoStack: [], deliveryRequest: null,
      resolve: selector => selector === '#a' ? target : null, resolveForEdit: selector => selector === '#a' ? target : null,
      px: value => Number.parseFloat(value) || 0, getComputedStyle: () => ({ position: 'relative' }),
      copyEdit: edit => ({ ...edit }), postEdits() {}, postSelection() {}, updateBoxes() {}, scheduleBoxes() {}, toast() {},
    };
    vm.createContext(context);
    vm.runInContext(section('  function applyInline(', '  function contentBoxDelta(')
      + section('  function applyEdit(', '  function undo(')
      + section('  function resetAll(', '  // After the agent')
      + section('  function restore(', '  // ---- text editing'), context);
    context.restore({ batches: [{ edits: [first, { ...later, selector: '#missing' }] }], edits: [] });
    assert.equal(style.left, '1px', 'A failed later target must roll back the already-represented nudge');
    assert.deepEqual(Array.from(context.bakedEditIds), []);
    assert.equal(context.edits.length, 2); assert.ok(context.edits.every(edit => edit.stale && edit.submitted));
    context.edits.push({ id: 'unsent', kind: 'nudge', _el: target, _inlineBefore: { left: '1px' } }); style.left = '2px';
    context.resetAll();
    assert.equal(style.left, '1px');
    assert.deepEqual(Array.from(context.edits, edit => edit.id), ['e1', 'e2']);
  });
  await test('unresolved submitted rows block Apply and Finish without dropping newer pending edits', () => {
    const h = client(); const unresolved = { ...first, submitted: true, stale: true };
    h.message({ type: 'uc:edits', edits: [unresolved, later], canUndo: true });
    h.node('applyBtn').handlers.click(); h.node('finishBtn').handlers.click();
    assert.equal(h.node('applyBtn').disabled, true); assert.equal(h.node('finishBtn').disabled, true);
    assert.equal(h.packets.filter(packet => packet.type === 'uc:export').length, 0);
    assert.deepEqual(h.saved().edits, [unresolved, later]);
    assert.match(h.node('sendStatus').textContent, /resolve/);
  });
  await test('replay requires unique identity and original revision for positional targets', () => {
    const source = uiEditorJs(); const start = source.indexOf('  function resolve('); const end = source.indexOf('  function snippetFor(', start);
    const original = {}; const inserted = {}; let matches = [inserted];
    const context = { sourceRevision: 'new-revision', isOurs: () => false, document: { querySelectorAll: () => matches } };
    vm.runInNewContext(source.slice(start, end), context);
    assert.equal(context.resolveForEdit('#cards > article:nth-of-type(1)', 'old-revision'), null, 'A shifted selector must not target the new sibling');
    matches = [original];
    assert.equal(context.resolveForEdit('#cards > article:nth-of-type(1)', 'new-revision'), original);
    assert.equal(context.resolveForEdit('#stable', 'old-revision'), original, 'Unique stable ID survives an unrelated save');
    matches = [original, inserted];
    assert.equal(context.resolveForEdit('#stable', 'old-revision'), null, 'Duplicate IDs are ambiguous');
  });
  console.log(`Passed: ${passed}\nFailed: ${failed}`); process.exitCode = failed ? 1 : 0;
}
main().catch(error => { console.error(error); process.exitCode = 1; });
