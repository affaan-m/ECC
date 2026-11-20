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
function client({ boot = {}, stored = {}, storageFailure = false } = {}) {
  const nodes = new Map();
  const node = id => { if (!nodes.has(id)) nodes.set(id, element()); return nodes.get(id); };
  node('uc-session').textContent = JSON.stringify({ key: 'abcdefabcdef', status: 'open', chat: [], presets: { desktop: { width: 1200, height: 900 } }, ...boot });
  const packets = [];
  const requests = [];
  const frame = { postMessage: packet => packets.push(packet) };
  node('artifact').contentWindow = frame;
  let saved = stored;
  let message;
  let events;
  let answer;
  let deliverySequence = 0;
  const context = {
    crypto: { randomUUID: () => '00000000-0000-4000-8000-' + String(++deliverySequence).padStart(12, '0'), subtle: { digest: async (_algorithm, bytes) => Uint8Array.from(require('node:crypto').createHash('sha256').update(bytes).digest()).buffer } },
    TextEncoder,
    document: { addEventListener() {}, getElementById: node, querySelectorAll: () => [], createElement: element, documentElement: element(), activeElement: null },
    window: { addEventListener(type, run) { if (type === 'message') message = run; } },
    sessionStorage: { getItem: () => JSON.stringify(saved), setItem: (_key, value) => { const next = JSON.parse(value); if (storageFailure && next.pendingDelivery) throw new Error('Storage full'); saved = next; } },
    localStorage: { getItem: () => null, setItem() {} },
    setTimeout: () => 1, clearTimeout() {},
    EventSource: class { constructor() { events = {}; } addEventListener(type, run) { events[type] = run; } close() {} },
    fetch: (url, options) => { requests.push({ url, body: JSON.parse(options.body) }); return new Promise(resolve => { answer = resolve; }); },
  };
  vm.runInNewContext(uiClientJs(), context);
  message({ source: frame, data: { type: 'uc:ready' } });
  return {
    node, packets, requests, saved: () => saved,
    message: data => message({ source: frame, data }),
    event: (name, data = {}) => events[name]({ data: JSON.stringify(data) }),
    answer: body => answer({ ok: true, json: async () => ({ acceptedEditIds: (body.batches || []).flatMap(batch => batch.edits.map(edit => edit.id)), acceptedText: requests.at(-1).body.items[0].text || '', ...body }) }),
    lose: () => answer({ ok: true, json: async () => { throw new Error('Response body lost'); } }),
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
    assert.ok(h.node('artifact').src.includes('?t='), 'Acceptance reconciles against the current source');
    assert.ok(!h.packets.some(item => item.type === 'uc:delivery-end' && item.accepted), 'An old frame receipt cannot promote proof');
    h.message({ type: 'uc:ready' });
    const restored = h.packets.filter(packet => packet.type === 'uc:restore').at(-1);
    assert.deepEqual(Array.from(restored.edits, edit => edit.id), ['e2']);
    assert.deepEqual(Array.from(restored.batches, batch => batch.id), ['fb-1']);
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
  await test('retry receipt reconciles missed durable acknowledgments without discarding newer edits', async () => {
    const h = client({ boot: { uiBatches: [{ id: 'fb-1', edits: [first] }] } });
    h.message({ type: 'uc:edits', edits: [later] }); h.node('applyBtn').handlers.click();
    const packet = h.packets.find(item => item.type === 'uc:export');
    h.message({ type: 'uc:export', requestId: packet.requestId, edits: [later], bakedEditIds: ['e1'], html: '<html>both</html>' }); await tick();
    h.lose(); await tick(); h.message({ type: 'uc:ready' });
    assert.deepEqual(h.packets.filter(item => item.type === 'uc:restore').at(-1).pendingBakedEditIds, ['e1']);
    const newest = { ...later, id: 'e3' }; h.message({ type: 'uc:edits', edits: [later, newest] });
    h.node('applyBtn').handlers.click(); await tick();
    h.answer({ acceptedEditIds: ['e2'], batches: [], acknowledgedBatches: [{ id: 'fb-1', editIds: ['e1'] }, { id: 'fb-2', editIds: ['e2'] }] }); await tick();
    assert.deepEqual(h.saved().submittedBatches, []); assert.deepEqual(h.saved().edits, [newest]);
    assert.equal(h.saved().pendingDelivery, null);
  });
  await test('failed Apply retains all edits and releases the snapshot lock', async () => {
    const h = client(); await capture(h);
    h.message({ type: 'uc:edits', edits: [first, later], canUndo: true });
    h.fail(); await tick();
    assert.deepEqual(h.saved().edits, [first, later]);
    assert.equal(h.packets.find(packet => packet.type === 'uc:delivery-end').accepted, false);
  });
  await test('late old-frame messages retain new edits without replaying accepted or acknowledged IDs', async () => {
    const h = client(); await capture(h);
    h.message({ type: 'uc:edits', edits: [first, later], canUndo: true });
    h.answer({ batches: [{ id: 'fb-1', edits: [first] }] }); await tick();
    h.message({ type: 'uc:edits', edits: [first, later], canUndo: true });
    assert.deepEqual(h.saved().edits, [later]);
    h.message({ type: 'uc:ready' });
    const restored = h.packets.filter(packet => packet.type === 'uc:restore').at(-1);
    assert.deepEqual(Array.from(restored.edits, edit => edit.id), ['e2']);
    assert.deepEqual(Array.from(restored.batches[0].edits, edit => edit.id), ['e1']);
    h.message({ type: 'uc:edits', edits: [{ ...first, stale: true, submitted: true }, later] });
    assert.equal(h.saved().edits[0].submitted, true, 'Active unresolved submitted rows stay visible');
    h.event('ui-ack', { batches: [{ id: 'fb-1', editIds: ['e1'] }] });
    h.message({ type: 'uc:edits', edits: [{ ...first, stale: true, submitted: true }, later] });
    assert.deepEqual(h.saved().edits, [later], 'An old frame cannot resurrect retired rows');
  });
  await test('unknown Apply outcome retries its immutable item and preserves newer IDs and draft text', async () => {
    const h = client(); h.node('chatInput').value = 'Original note'; await capture(h);
    const firstRequest = h.requests[0].body; h.lose(); await tick();
    assert.equal(h.saved().pendingDelivery.id, firstRequest.deliveryId);
    assert.equal(h.node('undoBtn').disabled, true); assert.equal(h.node('finishBtn').disabled, true);
    assert.equal(h.packets.filter(packet => packet.type === 'uc:delivery-end').at(-1).retryPending, true);
    h.message({ type: 'uc:edits', edits: [first, later], canUndo: true }); h.node('chatInput').value = 'New unsent draft';
    h.node('applyBtn').handlers.click(); await tick();
    assert.deepEqual(h.requests[1].body, firstRequest, 'Retry must not substitute the newer preview or note');
    h.answer({ acceptedEditIds: ['e1'], acceptedText: 'Original note', batches: [{ id: 'fb-1', edits: [first] }] }); await tick();
    assert.deepEqual(h.saved().edits, [later]); assert.equal(h.node('chatInput').value, 'New unsent draft');
    assert.equal(h.saved().pendingDelivery, null);
    h.message({ type: 'uc:ready' }); h.message({ type: 'uc:edits', edits: [later], canUndo: true });
    h.node('applyBtn').handlers.click(); const packet = h.packets.filter(item => item.type === 'uc:export').at(-1);
    h.message({ type: 'uc:export', requestId: packet.requestId, edits: [later], html: '<html>new preview</html>' }); await tick();
    assert.notEqual(h.requests[2].body.deliveryId, firstRequest.deliveryId, 'A later batch needs its own token');
  });
  await test('uncertain Finish stays frozen and retries the original snapshot after a shell reload', async () => {
    const h = client(); h.message({ type: 'uc:edits', edits: [first], canUndo: true }); h.node('chatInput').value = 'Final note';
    h.node('finishBtn').handlers.click(); const packet = h.packets.find(item => item.type === 'uc:export');
    h.message({ type: 'uc:export', requestId: packet.requestId, edits: [first], html: '<html>original final design</html>' }); await tick();
    const original = h.requests[0].body; h.lose(); await tick();
    assert.equal(h.node('stage').inert, true); assert.equal(h.node('chatInput').disabled, true);
    const reopened = client({ stored: h.saved() }); assert.equal(reopened.node('stage').inert, true);
    reopened.node('finishBtn').handlers.click(); await tick();
    assert.deepEqual(reopened.requests[0].body, original);
    reopened.answer({ acceptedEditIds: ['e1'], acceptedText: 'Final note' }); await tick();
    assert.equal(reopened.saved().pendingDelivery, null); assert.equal(reopened.node('finishBtn').disabled, true);
  });
  await test('snapshot-storage failure stops submission and leaves the live edits retryable', async () => {
    const h = client({ storageFailure: true }); h.node('chatInput').value = 'Unsent note'; await capture(h);
    assert.equal(h.requests.length, 0); assert.deepEqual(h.saved().edits, [first]);
    assert.equal(h.node('chatInput').value, 'Unsent note'); assert.equal(h.node('applyBtn').disabled, false);
    assert.match(h.node('sendStatus').textContent, /preserve a retryable snapshot/);
  });
  await test('correlated durable Finish SSE confirms a lost body while explicit End does not', async () => {
    async function start() {
      const h = client(); h.message({ type: 'uc:edits', edits: [first] }); h.node('finishBtn').handlers.click();
      const packet = h.packets.find(item => item.type === 'uc:export');
      h.message({ type: 'uc:export', requestId: packet.requestId, edits: [first], html: '<html>final</html>' }); await tick(); return h;
    }
    const own = await start(); const id = own.requests[0].body.deliveryId;
    own.event('ended', { endedBy: 'user', finished: true, deliveryId: id }); own.lose(); await tick();
    assert.equal(own.saved().pendingDelivery, null); assert.equal(own.node('endedTitle').textContent, 'Saved and handed to agent');
    assert.doesNotMatch(own.node('sendStatus').textContent, /failed/);
    const late = await start(); const lateId = late.requests[0].body.deliveryId; late.lose(); await tick();
    assert.match(late.node('sendStatus').textContent, /failed/);
    late.event('ended', { endedBy: 'user', finished: true, deliveryId: lateId });
    assert.equal(late.saved().pendingDelivery, null); assert.doesNotMatch(late.node('sendStatus').textContent, /failed/);
    const other = await start(); other.event('ended', { endedBy: 'user' }); other.lose(); await tick();
    assert.ok(other.saved().pendingDelivery); assert.equal(other.node('endedTitle').textContent, 'Session ended');
  });
  await test('Apply captures the original note before export and preserves newer draft input', async () => {
    const h = client(); h.node('chatInput').value = '  Original Apply note  ';
    h.message({ type: 'uc:edits', edits: [first], canUndo: true }); h.node('applyBtn').handlers.click();
    h.node('chatInput').value = 'New draft while export is pending';
    const packet = h.packets.find(item => item.type === 'uc:export');
    h.message({ type: 'uc:export', requestId: packet.requestId, edits: [first], html: '<html></html>' }); await tick();
    assert.equal(h.requests[0].body.items[0].text, 'Original Apply note');
    h.answer({ batches: [{ id: 'fb-1', edits: [first] }] }); await tick();
    assert.equal(h.node('chatInput').value, 'New draft while export is pending');
  });
  await test('chat response preserves a newer draft and clears only unchanged submitted raw text', async () => {
    const h = client(); h.node('chatInput').value = '  Original chat  '; h.node('send').handlers.click(); await tick();
    assert.equal(h.requests[0].body.items[0].text, 'Original chat');
    h.node('chatInput').value = 'New chat draft'; h.answer({}); await tick();
    assert.equal(h.node('chatInput').value, 'New chat draft');
    h.node('send').handlers.click(); await tick(); h.answer({}); await tick();
    assert.equal(h.node('chatInput').value, '');
  });
  await test('Finish freezes preview and inspector mutations immediately and restores editing on failure', async () => {
    const h = client(); h.message({ type: 'uc:edits', edits: [first], canUndo: true });
    h.node('finishBtn').handlers.click();
    assert.equal(h.node('stage').inert, true); assert.equal(h.node('groups').inert, true);
    assert.equal(h.node('chatInput').disabled, true);
    assert.ok(h.packets.some(packet => packet.type === 'uc:set-mode' && packet.mode === 'interact'));
    h.message({ type: 'uc:ready' });
    assert.equal(h.packets.filter(packet => packet.type === 'uc:set-mode').at(-1).mode, 'interact', 'A frame reload must retain the Finish freeze');
    h.node('removeBtn').handlers.click();
    assert.ok(!h.packets.some(packet => packet.type === 'uc:remove'));
    const packet = h.packets.find(item => item.type === 'uc:export');
    h.message({ type: 'uc:export', requestId: packet.requestId, edits: [first], html: '<html></html>' }); await tick();
    h.fail(); await tick();
    assert.equal(h.node('stage').inert, false); assert.equal(h.node('groups').inert, false);
    assert.equal(h.node('chatInput').disabled, false); assert.equal(h.node('finishBtn').disabled, false);
    assert.deepEqual(h.saved().edits, [first]);
    assert.ok(h.packets.some(packet => packet.type === 'uc:set-mode' && packet.mode === 'edit'));
    h.message({ type: 'uc:toggle-mode' });
    h.node('finishBtn').handlers.click();
    const retry = h.packets.filter(item => item.type === 'uc:export').at(-1);
    h.message({ type: 'uc:export', requestId: retry.requestId, edits: [first], html: '<html></html>' }); await tick();
    h.fail(); await tick();
    assert.equal(h.packets.filter(packet => packet.type === 'uc:set-mode').at(-1).mode, 'interact', 'Failure restores the prior interaction mode');
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
    context.deliveryRequest = 'reloaded'; context.bakedEditIds = []; context.edits = [{ id: 'e1', stale: true }, { id: 'e2' }];
    listener({ source: parent, data: { type: 'uc:delivery-end', requestId: 'reloaded', accepted: true, editIds: ['e1'] } });
    assert.equal(context.edits[0].submitted, true); assert.equal(context.edits[0].stale, true);
    assert.deepEqual(context.bakedEditIds, [], 'An accepted old capture cannot prove a stale edit survived the current frame');
    assert.equal(context.edits[1].id, 'e2');
    listener({ source: parent, data: { type: 'uc:forget' } });
    assert.deepEqual(context.edits.map(edit => edit.id), ['e1'], 'Legacy forget clears unsent edits but cannot bypass unresolved-submitted protection');
  });
  await test('partially replayable submitted batch rolls back represented nudge and survives Reset', () => {
    const source = uiEditorJs();
    const section = (start, end) => source.slice(source.indexOf(start), source.indexOf(end, source.indexOf(start)));
    const style = { left: '1px', top: '0px', position: 'relative', getPropertyValue(name) { return this[name] || ''; }, setProperty(name, value) { this[name] = value; }, removeProperty(name) { delete this[name]; } };
    const target = { style, isConnected: true };
    const context = {
      edits: [], bakedEditIds: [], sourceRevision: 'original-source', editSeq: 0, redoStack: [], deliveryRequest: null,
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
    context.sourceRevision = 'known-snapshot';
    context.restore({ batches: [{ id: 'fb-1', snapshotHash: 'known-snapshot', edits: [first] }], edits: [] });
    assert.equal(style.left, '1px', 'An exact already-represented snapshot must not receive its nudge again');
    assert.deepEqual(Array.from(context.bakedEditIds), ['e1']); assert.equal(context.edits.length, 0);
    const normalApply = context.applyEdit;
    context.applyEdit = (edit, el) => { if (edit.kind === 'move') throw new Error('HierarchyRequestError'); return normalApply(edit, el); };
    context.restore({ batches: [{ edits: [first, { id: 'move', kind: 'move', selector: '#a', to: { parent: '#nested', index: 0 } }] }], edits: [] });
    assert.equal(style.left, '1px', 'Thrown replay must still roll back the earlier nudge');
    assert.equal(context.edits.length, 2); assert.ok(context.edits.every(edit => edit.stale && edit.submitted));
    assert.deepEqual(Array.from(context.bakedEditIds), []);
    context.applyEdit = normalApply; context.sourceRevision = 'local-snapshot'; style.left = '1px';
    context.restore({ batches: [], edits: [first, later], deliveryRequest: 'unknown', pendingSnapshotHash: 'local-snapshot', pendingSourceRevision: 'old-source', pendingEditIds: ['e1'] });
    assert.equal(style.left, '2px', 'Exact local snapshot skips only its original pending nudge, preserving newer work');
    assert.deepEqual(Array.from(context.bakedEditIds), [], 'Local preview evidence is not durable submitted proof');
    style.left = '2px';
    context.restore({ batches: [{ id: 'fb-1', snapshotHash: 'older-snapshot', edits: [first] }], edits: [later, { ...later, id: 'e3' }], deliveryRequest: 'unknown', pendingSnapshotHash: 'local-snapshot', pendingSourceRevision: 'old-source', pendingEditIds: ['e2'], pendingBakedEditIds: ['e1'] });
    assert.equal(style.left, '3px', 'An exact pending snapshot already contains its fully captured submitted batches and pending nudge; replay only newer work');
    assert.deepEqual(Array.from(context.bakedEditIds), ['e1']);
    assert.deepEqual(Array.from(context.edits, edit => edit.id), ['e2', 'e3'], 'Unknown delivery remains pending without acknowledgment');
    style.left = '2px';
    context.restore({ batches: [{ id: 'fb-1', snapshotHash: 'older-snapshot', edits: [first, { ...first, id: 'missing', selector: '#missing' }] }, { id: 'empty', edits: [] }], edits: [later], deliveryRequest: 'unknown', pendingSnapshotHash: 'local-snapshot', pendingSourceRevision: 'old-source', pendingEditIds: ['e2'], pendingBakedEditIds: ['e1'] });
    assert.equal(style.left, '2px', 'Partial captured membership cannot bypass atomic missing-target rollback');
    assert.deepEqual(Array.from(context.bakedEditIds), []); assert.ok(context.edits.slice(0, 2).every(edit => edit.stale && edit.submitted));
    style.left = '1px'; context.sourceRevision = 'changed-source';
    context.restore({ batches: [], edits: [first, later], deliveryRequest: 'unknown', pendingSnapshotHash: 'local-snapshot', pendingSourceRevision: 'old-source', pendingEditIds: ['e1'] });
    assert.equal(style.left, '2px'); assert.equal(context.edits[0].stale, true); assert.ok(!context.edits[1].stale);
    assert.deepEqual(Array.from(context.bakedEditIds), []);
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
