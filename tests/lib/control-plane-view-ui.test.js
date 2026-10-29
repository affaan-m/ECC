'use strict';

const assert = require('assert');
const vm = require('vm');
const { renderControlPlaneViewHtml } = require('../../scripts/lib/control-pane/control-plane-view-ui');
const { renderProximityVizHtml } = require('../../scripts/lib/control-pane/proximity-viz');

const controlPlaneHtml = renderControlPlaneViewHtml();
assert.ok(controlPlaneHtml.includes('grid-template-rows: minmax(0, 1fr)'));
assert.ok(controlPlaneHtml.includes('#stage { position: relative; height: 100%; min-height: 0;'));

const proximityHtml = renderProximityVizHtml();
assert.ok(proximityHtml.includes('grid-template-rows: minmax(0, 1fr)'));
assert.ok(proximityHtml.includes('#stage { position: relative; height: 100%; min-height: 0;'));

// A recording 2D context, so a test can assert what the view actually drew
// rather than only what the template happens to contain.
function createContext() {
  const log = [];
  const context = { fillStyle: '', strokeStyle: '', lineWidth: 1, globalAlpha: 1, font: '', log };
  const record = fn => (...args) => { log.push({ fn, args, fillStyle: context.fillStyle }); };
  for (const fn of ['setTransform', 'clearRect', 'beginPath', 'moveTo', 'lineTo', 'stroke',
    'arc', 'rect', 'closePath', 'fill', 'fillText', 'save', 'restore']) {
    context[fn] = record(fn);
  }
  return context;
}

// Group the draw calls into paths and keep the filled ones: those are the risk
// markers, and the axis and pair-link paths only stroke.
function markerShapes(context) {
  const paths = [];
  let current = null;
  for (const entry of context.log) {
    if (entry.fn === 'beginPath') {
      if (current) paths.push(current);
      current = [];
      continue;
    }
    if (!current) current = [];
    current.push(entry);
  }
  if (current) paths.push(current);
  return paths.filter(path => path.some(entry => entry.fn === 'fill')).map(path => {
    const shape = path.some(e => e.fn === 'arc') ? 'circle'
      : path.some(e => e.fn === 'rect') ? 'square' : 'triangle';
    return { shape, color: path.find(e => e.fn === 'fill').fillStyle };
  });
}

function textOf(node) {
  return (node.textContent || '') + node.children.map(textOf).join('');
}

function findAll(node, className) {
  const found = node.className === className ? [node] : [];
  for (const child of node.children) found.push(...findAll(child, className));
  return found;
}

function element(tag, context) {
  const node = {
    tag: tag || 'div',
    className: '',
    children: [],
    style: {},
    attributes: {},
    clientWidth: 640,
    clientHeight: 480,
    parentElement: { getBoundingClientRect: () => ({ width: 640, height: 480 }) },
    appendChild(child) { node.children.push(child); return child; },
    setAttribute(name, value) { node.attributes[name] = value; },
    getContext: () => context
  };
  let text = '';
  let writes = 0;
  Object.defineProperty(node, 'textContent', {
    get() { return text; },
    set(value) { text = String(value); node.children = []; writes += 1; },
    configurable: true
  });
  Object.defineProperty(node, 'writes', { get() { return writes; }, configurable: true });
  return node;
}

// A poll settles through several chained promise callbacks, so draining needs a
// few turns of the event loop rather than a single tick.
function settle() {
  return new Promise(resolve => {
    let remaining = 5;
    const step = () => (remaining-- > 0 ? setImmediate(step) : resolve());
    step();
  });
}

// Drives the view's inline script against a queue of poll responses, so one run
// can cover several polls and the state each one leaves behind. A response may
// carry a `hold` promise to park until the test releases it, or `never: true` to
// stay pending so the request timeout can be exercised.
async function render(responses) {
  const context = createContext();
  const elements = new Map();
  const timers = [];
  const timeouts = [];
  const queue = responses.slice();
  const listeners = new Map();
  let jsonReads = 0;
  const document = {
    getElementById(id) { if (!elements.has(id)) elements.set(id, element(null, context)); return elements.get(id); },
    createElement: tag => element(tag, context)
  };
  const html = renderControlPlaneViewHtml();
  const start = html.indexOf('<script>');
  const end = html.indexOf('</script>', start);
  assert.ok(start >= 0 && end > start, 'fixed renderer template must contain its inline script');
  const code = html.slice(start + '<script>'.length, end);
  vm.runInNewContext(code, {
    document,
    window: { addEventListener(name, listener) { listeners.set(name, listener); }, devicePixelRatio: 1 },
    AbortController,
    setInterval(fn) { timers.push(fn); },
    // Timers are collected rather than run, so a test can fire the request
    // timeout on demand instead of waiting ten seconds for it.
    setTimeout(fn, ms) { const entry = { fn, ms, fired: false }; timeouts.push(entry); return entry; },
    clearTimeout(entry) { if (entry) entry.fired = true; },
    fetch: async (url, options) => {
      const next = queue.length > 1 ? queue.shift() : queue[0];
      if (next.never) {
        // A request that never answers. Honour the abort the view sends, so the
        // timeout can drive it to a failure.
        return new Promise((_, reject) => {
          if (!options || !options.signal) return;
          options.signal.addEventListener('abort', () => reject(new Error('aborted')));
        });
      }
      if (next.hold) await next.hold;
      if (options && options.signal && options.signal.aborted) throw new Error('aborted');
      return { ok: next.ok, json: () => {
        jsonReads += 1;
        return next.body || Promise.resolve(next.data);
      } };
    }
  });
  await new Promise(resolve => setImmediate(resolve));
  return {
    elements,
    context,
    jsonReads() { return jsonReads; },
    resizeAgain() { listeners.get('resize')(); },
    writesTo(id) { return elements.get(id).writes; },
    labelOf(id) { return elements.get(id).attributes['aria-label']; },
    // Fire every pending request timeout, then let the rejections propagate.
    async fireTimeouts() {
      for (const entry of timeouts) {
        if (!entry.fired) { entry.fired = true; entry.fn(); }
      }
      await settle();
    },
    timeoutBudgetMs() { return timeouts.length ? timeouts[0].ms : null; },
    async pollAgain() {
      for (const fn of timers) fn();
      await settle();
    }
  };
}

function populatedView(overrides) {
  return Object.assign({
    schemaVersion: 'ecc.control-plane.view.v1',
    tasks: [
      { id: 'task-clear', harness: 'claude', state: 'running', workingSet: { fileCount: 1 },
        projection: { maxRisk: 0.1, point: [1, 0] } },
      { id: 'task-traffic', harness: 'codex', state: 'running', workingSet: { fileCount: 4 },
        projection: { maxRisk: 0.5, point: [0, 1] } },
      { id: 'task-resolution', harness: 'gemini', state: 'blocked', workingSet: { fileCount: 9 },
        projection: { maxRisk: 0.9, point: [-1, -1] } }
    ],
    lanes: [{ label: 'main', kind: 'lane', taskIds: ['task-clear', 'task-traffic', 'task-resolution'] }],
    pairs: [{ a: 'task-clear', b: 'task-traffic', risk: 0.5 }],
    events: [{ level: 'resolution', kind: 'pair', message: 'overlap', risk: 0.9 }],
    projection: {
      agents: [
        { agentId: 'task-clear', point: [1, 0], maxRisk: 0.1 },
        { agentId: 'task-traffic', point: [0, 1], maxRisk: 0.5 },
        { agentId: 'task-resolution', point: [-1, -1], maxRisk: 0.9 }
      ],
      normalization: 'raw'
    },
    thresholds: { ta: 0.35, ra: 0.7 },
    counts: { tasks: 3, lanes: 1, agents: 2, advisories: 2, resolutions: 1 }
  }, overrides);
}

let passed = 0;
let failures = 0;
(async () => {
  const failed = await render([{ ok: false, data: { ok: false, error: 'snapshot unavailable' } }]);
  assert.strictEqual(failed.elements.get('status').textContent, 'offline', 'HTTP errors must not display a healthy empty view');
  passed += 1;

  const malformed = await render([{ ok: true, data: { schemaVersion: 'wrong' } }]);
  assert.strictEqual(malformed.elements.get('status').textContent, 'offline', 'invalid schemas must be rejected');
  passed += 1;

  const valid = await render([{ ok: true, data: populatedView({ tasks: [], lanes: [], pairs: [], events: [], projection: { agents: [] }, counts: {} }) }]);
  assert.ok(valid.elements.get('status').textContent.includes('0 tasks'));
  passed += 1;

  // A populated view has to name each task's risk level in words, not leave the
  // level encoded only in the marker colour. Assert on the rendered risk cells
  // rather than the whole panel, so a level word cannot be satisfied by a task
  // id that happens to contain it.
  const populated = await render([{ ok: true, data: populatedView() }]);
  const riskCells = findAll(populated.elements.get('lanes'), 'risk').map(node => textOf(node));
  assert.deepStrictEqual(riskCells,
    ['10% - clear', '50% - traffic', '90% - resolution'],
    'each task must state its risk level in words beside the percentage');
  passed += 1;

  // Each risk level draws its own shape, so a colour-blind operator still sees
  // the three levels apart on the canvas.
  assert.deepStrictEqual(markerShapes(populated.context).map(marker => marker.shape),
    ['circle', 'square', 'triangle'], 'the three risk levels must draw circle, square, and triangle');
  passed += 1;

  const canvasLabel = populated.elements.get('c').attributes['aria-label'];
  assert.ok(canvasLabel.includes('3 tasks') && canvasLabel.includes('2 advisories') && canvasLabel.includes('1 steering'),
    `the canvas label must carry the polled counts, got ${canvasLabel}`);
  passed += 1;

  const announced = populated.elements.get('announce').textContent;
  assert.ok(announced.includes('2 advisories') && announced.includes('Steering is required.'),
    `a populated view must announce the steering state, got ${announced}`);
  passed += 1;

  // Polling every few seconds must not repeat an unchanged announcement. Setting
  // the same text again is a no-op for a real DOM, but the view should not even
  // attempt the write, so count the assignments rather than comparing strings.
  await populated.pollAgain();
  assert.strictEqual(populated.writesTo('announce'), 1,
    'an unchanged poll must not write the live region again');
  passed += 1;

  const changed = await render([
    { ok: true, data: populatedView() },
    { ok: true, data: populatedView({ counts: { tasks: 3, lanes: 1, agents: 2, advisories: 3, resolutions: 0 } }) }
  ]);
  await changed.pollAgain();
  assert.ok(changed.elements.get('announce').textContent.includes('3 advisories')
    && changed.elements.get('announce').textContent.includes('No steering is required.'),
    `a changed poll must announce the new counts, got ${changed.elements.get('announce').textContent}`);
  passed += 1;

  // An outage must not leave the live region holding the last known guidance,
  // which would read as a current "airspace is clear" after data stopped.
  const outage = await render([
    { ok: true, data: populatedView() },
    { ok: false, data: { ok: false, error: 'snapshot unavailable' } }
  ]);
  const beforeOutage = outage.elements.get('announce').textContent;
  await outage.pollAgain();
  assert.strictEqual(outage.elements.get('status').textContent, 'offline');
  assert.ok(outage.elements.get('announce').textContent !== beforeOutage,
    'a failed poll must not leave the previous guidance in the live region');
  assert.ok(/unavailable/i.test(outage.elements.get('announce').textContent)
    && /unknown/i.test(outage.elements.get('announce').textContent),
    `an outage must say the counts are unknown, got ${outage.elements.get('announce').textContent}`);
  passed += 1;

  // The canvas label is the on-demand description, so an outage has to clear
  // the last counts there too, not just in the live region.
  assert.ok(/unavailable/i.test(outage.labelOf('c')) && /unknown/i.test(outage.labelOf('c')),
    `the canvas label must not keep the last counts during an outage, got ${outage.labelOf('c')}`);
  passed += 1;

  // A repeated failure stays silent, but recovering online must speak again.
  const writesAfterOutage = outage.writesTo('announce');
  await outage.pollAgain();
  assert.strictEqual(outage.writesTo('announce'), writesAfterOutage,
    'a repeated failure must not re-announce the same outage');
  passed += 1;

  const recovered = await render([
    { ok: true, data: populatedView() },
    { ok: false, data: { ok: false, error: 'snapshot unavailable' } },
    { ok: true, data: populatedView({ counts: { tasks: 3, lanes: 1, agents: 2, advisories: 1, resolutions: 1 } }) }
  ]);
  await recovered.pollAgain();
  await recovered.pollAgain();
  assert.ok(recovered.elements.get('status').textContent.includes('3 tasks'),
    'a recovered poll must restore the live status');
  assert.ok(recovered.elements.get('announce').textContent.includes('1 advisories')
    && recovered.elements.get('announce').textContent.includes('Steering is required.'),
    `a recovered poll must announce the restored counts, got ${recovered.elements.get('announce').textContent}`);
  passed += 1;

  // apply() must put the counts back on the canvas once data flows again.
  assert.ok(recovered.labelOf('c').includes('1 advisories') && recovered.labelOf('c').includes('1 steering'),
    `a recovered poll must restore the count label on the canvas, got ${recovered.labelOf('c')}`);
  passed += 1;

  // Polls are not sequenced. An older poll that settles after a newer one must
  // not overwrite it, or the live region and the canvas disagree. The initial
  // poll takes the first response, the second response is the slow older poll,
  // and the third is the newer success that lands while the older is parked.
  let releaseOlder;
  const olderSettles = new Promise(resolve => { releaseOlder = resolve; });
  const overlapping = await render([
    { ok: true, data: populatedView() },
    { ok: false, data: { ok: false, error: 'snapshot unavailable' }, hold: olderSettles },
    { ok: true, data: populatedView({ counts: { tasks: 3, lanes: 1, agents: 2, advisories: 4, resolutions: 0 } }) }
  ]);
  await overlapping.pollAgain();
  await overlapping.pollAgain();
  assert.ok(overlapping.labelOf('c').includes('4 advisories'),
    `the newer success should land first, got ${overlapping.labelOf('c')}`);
  releaseOlder();
  await new Promise(resolve => setImmediate(resolve));
  assert.ok(overlapping.labelOf('c').includes('4 advisories')
    && !/unavailable/i.test(overlapping.labelOf('c')),
    `a superseded failure must not clear the newer canvas counts, got ${overlapping.labelOf('c')}`);
  assert.ok(!/unavailable/i.test(overlapping.elements.get('announce').textContent),
    `a superseded failure must not announce an outage, got ${overlapping.elements.get('announce').textContent}`);
  assert.notStrictEqual(overlapping.elements.get('status').textContent, 'offline',
    'a superseded failure must not mark the view offline');
  passed += 1;

  // The mirror of the case above. An older SUCCESS settling after a newer
  // success must not drag the view back to the older counts.
  let releaseStale;
  const staleSettles = new Promise(resolve => { releaseStale = resolve; });
  const staleSuccess = await render([
    { ok: true, data: populatedView() },
    { ok: true, data: populatedView({ counts: { tasks: 3, lanes: 1, agents: 2, advisories: 2, resolutions: 1 } }), hold: staleSettles },
    { ok: true, data: populatedView({ counts: { tasks: 3, lanes: 1, agents: 2, advisories: 7, resolutions: 0 } }) }
  ]);
  await staleSuccess.pollAgain();
  await staleSuccess.pollAgain();
  assert.ok(staleSuccess.labelOf('c').includes('7 advisories'),
    `the newer success should land first, got ${staleSuccess.labelOf('c')}`);
  releaseStale();
  await settle();
  assert.ok(staleSuccess.labelOf('c').includes('7 advisories'),
    `a superseded success must not overwrite the newer counts, got ${staleSuccess.labelOf('c')}`);
  assert.ok(!staleSuccess.elements.get('announce').textContent.includes('Steering is required.'),
    `a superseded success must not re-announce the older guidance, got ${staleSuccess.elements.get('announce').textContent}`);
  passed += 1;

  // A failure must still surface while a newer poll is already in flight and has
  // not answered. The older failure is still the newest thing to have settled,
  // so a guard anchored to the last settled poll lets it through, while one
  // anchored to the last poll started would silently drop it and leave stale
  // steering guidance on screen.
  let releaseFailure;
  const failureSettles = new Promise(resolve => { releaseFailure = resolve; });
  let releasePending;
  const pendingSettles = new Promise(resolve => { releasePending = resolve; });
  const failureWhilePending = await render([
    { ok: true, data: populatedView() },
    { ok: false, data: { ok: false, error: 'snapshot unavailable' }, hold: failureSettles },
    { ok: true, data: populatedView({ counts: { tasks: 3, lanes: 1, agents: 2, advisories: 9, resolutions: 0 } }), hold: pendingSettles }
  ]);
  // Start the failing poll, then the newer pending one, so the failure settles
  // with a newer request still in flight.
  await failureWhilePending.pollAgain();
  await failureWhilePending.pollAgain();
  releaseFailure();
  await settle();
  assert.strictEqual(failureWhilePending.elements.get('status').textContent, 'offline',
    'a failure must surface while a newer poll is still pending');
  assert.ok(/unavailable/i.test(failureWhilePending.labelOf('c')),
    `a failure must clear the canvas counts while a newer poll is pending, got ${failureWhilePending.labelOf('c')}`);
  assert.ok(/unavailable/i.test(failureWhilePending.elements.get('announce').textContent),
    `a failure must announce the outage while a newer poll is pending, got ${failureWhilePending.elements.get('announce').textContent}`);
  passed += 1;

  // The newer poll that was pending must still be able to restore the view.
  await failureWhilePending.pollAgain();
  releasePending();
  await settle();
  assert.ok(failureWhilePending.labelOf('c').includes('9 advisories')
    && !/unavailable/i.test(failureWhilePending.labelOf('c')),
    `the pending poll must still restore the counts, got ${failureWhilePending.labelOf('c')}`);
  passed += 1;

  // A poll that never answers must not leave the last steering guidance on
  // screen forever.
  const hung = await render([
    { ok: true, data: populatedView() },
    { ok: false, data: { ok: false, error: 'snapshot unavailable' }, never: true }
  ]);
  await hung.pollAgain();
  assert.ok(!/unavailable/i.test(hung.labelOf('c')),
    'the hung poll should not have reported anything yet');
  assert.ok(hung.timeoutBudgetMs() !== null && hung.timeoutBudgetMs() <= 15000,
    `a request timeout should be bounded, got ${hung.timeoutBudgetMs()}`);
  await hung.fireTimeouts();
  assert.strictEqual(hung.elements.get('status').textContent, 'offline',
    'a poll that never answers must time out into the offline state');
  assert.ok(/unavailable/i.test(hung.labelOf('c')),
    `a timed out poll must clear the canvas label, got ${hung.labelOf('c')}`);
  assert.ok(/unavailable/i.test(hung.elements.get('announce').textContent),
    `a timed out poll must announce the outage, got ${hung.elements.get('announce').textContent}`);
  passed += 1;

  // Three polls settling out of order as #3, #1, #2. The ignored #1 must not
  // pull the staleness mark back to 1, or the even older #2 would then be let
  // through on top of #3's counts.
  async function settleOutOfOrder(second, third) {
    let releaseFirst, releaseSecond, releaseThird;
    const holdOne = new Promise(resolve => { releaseFirst = resolve; });
    const holdTwo = new Promise(resolve => { releaseSecond = resolve; });
    const holdThree = new Promise(resolve => { releaseThird = resolve; });
    const view = await render([
      { ok: true, data: populatedView({ counts: { tasks: 3, lanes: 1, agents: 2, advisories: 1, resolutions: 0 } }), hold: holdOne },
      second(holdTwo),
      third(holdThree)
    ]);
    // Start all three, then settle them newest first.
    await view.pollAgain();
    await view.pollAgain();
    await view.pollAgain();
    releaseThird();
    await settle();
    releaseFirst();
    await settle();
    releaseSecond();
    await settle();
    return view;
  }

  const newest = { tasks: 3, lanes: 1, agents: 2, advisories: 9, resolutions: 0 };
  // The ignored #1 is a success, and the older #2 is also a success.
  const outOfOrderSuccess = await settleOutOfOrder(
    hold => ({ ok: true, data: populatedView({ counts: { tasks: 3, lanes: 1, agents: 2, advisories: 2, resolutions: 1 } }), hold }),
    hold => ({ ok: true, data: populatedView({ counts: newest }), hold })
  );
  assert.ok(outOfOrderSuccess.labelOf('c').includes('9 advisories')
    && !outOfOrderSuccess.labelOf('c').includes('2 advisories'),
    `an older success must not lower the staleness mark, got ${outOfOrderSuccess.labelOf('c')}`);
  passed += 1;

  // The ignored #1 is a success, and the older #2 is a failure, which would
  // otherwise mark a healthy view offline.
  const outOfOrderFailure = await settleOutOfOrder(
    hold => ({ ok: false, data: { ok: false, error: 'snapshot unavailable' }, hold }),
    hold => ({ ok: true, data: populatedView({ counts: newest }), hold })
  );
  assert.notStrictEqual(outOfOrderFailure.elements.get('status').textContent, 'offline',
    'a superseded failure must not mark a healthy view offline');
  assert.ok(outOfOrderFailure.labelOf('c').includes('9 advisories')
    && !/unavailable/i.test(outOfOrderFailure.labelOf('c')),
    `the newest counts must survive an ignored poll, got ${outOfOrderFailure.labelOf('c')}`);
  passed += 1;

  // Both response headers have arrived before independently held JSON bodies
  // resolve newest-first in the SAME turn. No drain separates those resolves.
  // This specifically exercises the promise-continuation watermark gap.
  function deferredBody() {
    let resolve;
    const promise = new Promise(done => { resolve = done; });
    return { promise, resolve };
  }

  const prior = populatedView({ lanes: [{ label: 'prior', kind: 'lane', taskIds: ['task-clear'] }] });
  const oldBody = populatedView({
    lanes: [{ label: 'older', kind: 'lane', taskIds: ['task-clear'] }],
    projection: { agents: [{ agentId: 'task-clear', point: [1, 0], maxRisk: 0.1 }] },
    counts: { tasks: 1, lanes: 1, agents: 1, advisories: 0, resolutions: 0 }
  });
  const newBody = populatedView({
    lanes: [{ label: 'newest', kind: 'lane', taskIds: ['task-resolution'] }],
    projection: { agents: [{ agentId: 'task-resolution', point: [-1, -1], maxRisk: 0.9 }] },
    counts: { tasks: 1, lanes: 1, agents: 1, advisories: 1, resolutions: 1 }
  });
  for (const [name, body, unavailable] of [
    ['newest valid body', newBody, false],
    ['newest invalid body', { schemaVersion: 'invalid' }, true],
    ['newest render failure', populatedView({ events: [null] }), true]
  ]) {
    try {
      const older = deferredBody();
      const newer = deferredBody();
      const sameTurn = await render([
        { ok: true, data: prior },
        { ok: true, body: older.promise },
        { ok: true, body: newer.promise }
      ]);
      await sameTurn.pollAgain();
      await sameTurn.pollAgain();
      assert.strictEqual(sameTurn.jsonReads(), 3, 'both deferred JSON bodies must be pending after headers');
      const priorLanes = textOf(sameTurn.elements.get('lanes'));
      const priorDraws = sameTurn.context.log.length;
      newer.resolve(body);
      older.resolve(oldBody);
      await settle();
      const laneText = textOf(sameTurn.elements.get('lanes'));
      const label = sameTurn.labelOf('c');
      const announcement = sameTurn.elements.get('announce').textContent;
      const status = sameTurn.elements.get('status').textContent;
      if (unavailable) {
        assert.strictEqual(laneText, priorLanes, `${name}: older body must not replace retained lanes`);
        assert.strictEqual(sameTurn.context.log.length, priorDraws, `${name}: older body must not render markers`);
        assert.strictEqual(status, 'offline', `${name}: the claimed token must report its failure`);
        assert.match(label, /unavailable.*unknown/i);
        assert.match(announcement, /unavailable.*unknown/i);
      } else {
        assert.match(laneText, /newest/, 'newest lanes must survive same-turn body completion');
        assert.doesNotMatch(laneText, /older/);
        assert.deepStrictEqual(markerShapes({ log: sameTurn.context.log.slice(priorDraws) }),
          [{ shape: 'triangle', color: '#ff7b72' }], 'only the newest marker may be drawn');
        assert.match(label, /1 tasks.*1 advisories.*1 steering/);
        assert.match(announcement, /1 advisories.*1 steering.*Steering is required/);
        assert.match(status, /1 tasks.*1 advisories.*1 steering/);
      }
      passed += 1;
    } catch (error) {
      failures += 1;
      console.error(`${name}: ${error.message}`);
    }
  }

  for (const [name, malformed] of [
    ['events', { events: [null] }],
    ['lanes', { lanes: [null] }],
    ['drawing', { projection: { agents: [null] } }],
  ]) {
    try {
      const retained = populatedView({ events: [{ level: 'advisory', kind: 'accepted', message: 'retained event' }] });
      const invalid = populatedView({
        events: [{ level: 'resolution', kind: 'rejected', message: 'invalid event' }],
        lanes: [{ label: 'rejected lane', kind: 'lane', taskIds: ['task-clear'] }],
        projection: { agents: [{ agentId: 'task-clear', point: [1, 0], maxRisk: 0.1 }] },
        ...malformed,
      });
      const repaired = await render([
        { ok: true, data: retained }, { ok: true, data: invalid }, { ok: true, data: newBody },
      ]);
      const eventsBefore = textOf(repaired.elements.get('events'));
      const lanesBefore = textOf(repaired.elements.get('lanes'));
      const markersBefore = markerShapes(repaired.context);
      const logBeforeMalformed = repaired.context.log.length;
      await repaired.pollAgain();
      assert.strictEqual(textOf(repaired.elements.get('events')), eventsBefore, `${name}: retain previous events`);
      assert.strictEqual(textOf(repaired.elements.get('lanes')), lanesBefore, `${name}: retain previous lanes`);
      assert.strictEqual(repaired.elements.get('status').textContent, 'offline');
      const drawStart = repaired.context.log.length;
      // When the malformed data fails after draw() started, the rollback
      // redraws immediately, so the retained markers must be on the canvas
      // before any resize. Checking only after resizeAgain() would pass even
      // with the immediate redraw removed, since resize redraws the accepted
      // view on its own.
      if (name === 'drawing') {
        assert.deepStrictEqual(markerShapes({ log: repaired.context.log.slice(logBeforeMalformed) }), markersBefore,
          `${name}: the rollback must redraw the retained markers immediately`);
      }
      assert.doesNotThrow(() => repaired.resizeAgain(), `${name}: resize must use the last accepted view`);
      assert.deepStrictEqual(markerShapes({ log: repaired.context.log.slice(drawStart) }), markersBefore);
      assert.match(repaired.labelOf('c'), /unavailable.*unknown/i);
      assert.match(repaired.elements.get('announce').textContent, /unavailable.*unknown/i);
      await repaired.pollAgain();
      assert.match(textOf(repaired.elements.get('lanes')), /newest/);
      assert.doesNotMatch(repaired.labelOf('c'), /unavailable/i);
      passed += 1;
    } catch (error) {
      failures += 1;
      console.error(`render rollback ${name}: ${error.message}`);
    }
  }

  console.log(`Results: Passed: ${passed}, Failed: ${failures}`);
  process.exitCode = failures > 0 ? 1 : 0;

})().catch(error => {
  console.error(error.message);
  console.log(`Results: Passed: ${passed}, Failed: ${failures + 1}`);
  process.exitCode = 1;
});
