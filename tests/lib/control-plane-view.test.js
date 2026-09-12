'use strict';
/**
 * Tests for scripts/lib/control-pane/control-plane-view.js: the
 * ecc.control-plane.view.v1 contract (tasks, lanes, events, projection,
 * inventory) built from a control-pane snapshot with proximity.
 */

const assert = require('assert');

const { buildProximitySnapshot } = require('../../scripts/lib/control-pane/proximity');
const { buildControlPlaneView, createControlPlaneViewSource, buildInventoryManifest, VIEW_SCHEMA_VERSION, EVENT_KINDS, _internal } = require('../../scripts/lib/control-pane/control-plane-view');
const { createProjectionWindow } = require('../../scripts/lib/agent-proximity/projection');

let passed = 0;
let failed = 0;
async function test(name, fn) {
  try {
    await fn();
    console.log(`  PASS ${name}`);
    passed += 1;
  } catch (e) {
    console.log(`  FAIL ${name}`);
    console.log(`    ${e.message}`);
    failed += 1;
  }
}

const NOW = '2026-09-11T20:01:00.000Z';

function session(id, extra = {}) {
  return {
    id,
    task: `Task ${id}`,
    project: '',
    taskGroup: '',
    agentType: 'worker',
    harness: 'codex',
    state: 'running',
    pid: null,
    worktree: { path: `/tmp/wt/${id}`, branch: `feat/${id}`, base: 'main' },
    lastHeartbeatAt: '2026-09-11T20:00:00Z',
    updatedAt: '2026-09-11T20:00:00Z',
    unreadMessages: 0,
    metrics: { tokensUsed: 0, costUsd: 0 },
    ...extra
  };
}

const WORKING_SETS = {
  a: [{ path: 'src/api/users.js', lines: [[1, 50]] }, { path: 'src/db/schema.js' }],
  b: [{ path: 'src/api/users.js', lines: [[10, 30]] }],
  c: [{ path: 'docs/guide.md' }],
  d: [{ path: 'src/api/posts.js' }],
  idle: []
};

function snapshotFor(sessions, extra = {}) {
  const proximity = buildProximitySnapshot(sessions, {
    workingSetFor: s => WORKING_SETS[s.id] || [],
    graph: { adjacency: { 'src/api/posts.js': ['src/db/schema.js'] } }
  });
  return { schemaVersion: 'ecc.control-pane.snapshot.v1', repoRoot: '/tmp/repo', dbPath: '/tmp/ecc2.db', sessions, proximity, ...extra };
}

(async () => {
  console.log('\n=== Testing control-plane view ===\n');

  await test('view: schema, counts, lanes and tasks from a four-session snapshot', () => {
    const sessions = [
      session('a', { taskGroup: 'ecc' }),
      session('b', { harness: 'claude', project: 'ecc-website' }),
      session('c', { harness: 'hermes', state: 'completed', lastHeartbeatAt: '' }),
      session('d', { pid: 4242 })
    ];
    const view = buildControlPlaneView(snapshotFor(sessions), { now: NOW });
    assert.strictEqual(view.schemaVersion, VIEW_SCHEMA_VERSION);
    assert.strictEqual(view.generatedAt, NOW);
    assert.deepStrictEqual(view.source, { snapshotSchema: 'ecc.control-pane.snapshot.v1', repoRoot: '/tmp/repo', dbPath: '/tmp/ecc2.db' });
    assert.deepStrictEqual(view.thresholds, { ta: 0.35, ra: 0.7, source: 'static' });
    assert.strictEqual(view.counts.tasks, 4);
    assert.strictEqual(view.counts.agents, 4);
    assert.strictEqual(view.counts.pairs, 6);
    assert.strictEqual(view.counts.lanes, 4);
    const laneIds = view.lanes.map(l => l.id).sort();
    assert.deepStrictEqual(laneIds, ['group:ecc', 'harness:codex', 'harness:hermes', 'project:ecc-website']);
    const group = view.lanes.find(l => l.id === 'group:ecc');
    assert.deepStrictEqual(group, { id: 'group:ecc', label: 'ecc', kind: 'task-group', taskIds: ['a'] });

    const a = view.tasks.find(t => t.id === 'a');
    assert.strictEqual(a.lane, 'group:ecc');
    assert.strictEqual(a.label, 'Task a');
    assert.strictEqual(a.harness, 'codex');
    assert.strictEqual(a.state, 'running');
    assert.deepStrictEqual(a.worktree, { path: '/tmp/wt/a', branch: 'feat/a', base: 'main' });
    assert.strictEqual(a.heartbeatAt, '2026-09-11T20:00:00.000Z');
    assert.deepStrictEqual(a.workingSet, { fileCount: 2, files: ['src/api/users.js', 'src/db/schema.js'] });
    assert.strictEqual(a.projection.point.length, 2);
    assert.strictEqual(a.projection.pairs, 3);
    assert.strictEqual(a.projection.maxRisk, 1);
    assert.strictEqual(a.inventory.authority, 'declared-only');
    assert.strictEqual(a.inventory.heartbeat.state, 'fresh');

    const c = view.tasks.find(t => t.id === 'c');
    assert.strictEqual(c.heartbeatAt, null);
    assert.strictEqual(c.inventory.heartbeat.state, 'unknown');
    assert.strictEqual(c.projection.maxRisk, 0);

    const d = view.tasks.find(t => t.id === 'd');
    assert.strictEqual(d.pid, 4242);
    assert.ok(d.projection.maxRisk >= 0.7, 'd couples to a through the import graph');
  });

  await test('view: static-threshold advisory events carry level, threshold, channels and action', () => {
    const sessions = [session('a'), session('b'), session('c'), session('d')];
    const view = buildControlPlaneView(snapshotFor(sessions), { now: NOW });
    const advisories = view.events.filter(e => e.kind === EVENT_KINDS.advisory);
    assert.strictEqual(advisories.length, 2, 'a/b overlap and a/d dependency both cross a threshold');
    assert.strictEqual(view.counts.advisories, 2);
    const ab = advisories.find(e => e.subject.a === 'a' && e.subject.b === 'b');
    assert.ok(ab, 'a/b event present');
    assert.strictEqual(ab.id, 'proximity.advisory:a|b:resolution');
    assert.strictEqual(ab.level, 'resolution');
    assert.strictEqual(ab.severity, 'critical');
    assert.strictEqual(ab.at, NOW);
    assert.strictEqual(ab.risk, 1);
    assert.deepStrictEqual(ab.channels, { x_tree: 1, x_overlap: 1, x_dep: 0 });
    assert.deepStrictEqual(ab.threshold, { ta: 0.35, ra: 0.7, crossed: 'ra', source: 'static' });
    assert.strictEqual(ab.action.type, 'steer');
    assert.ok(['a', 'b'].includes(ab.action.steer) && ['a', 'b'].includes(ab.action.hold) && ab.action.steer !== ab.action.hold);
    assert.strictEqual(ab.action.hold, 'a', 'a has more committed work, so a holds');
    assert.ok(ab.message.includes('static threshold 0.7'));
    assert.strictEqual(view.counts.resolutions, 2);
    assert.ok(view.limits.some(l => l.includes('static thresholds')));
  });

  await test('view: custom thresholds change the level and the event says which line was crossed', () => {
    const sessions = [session('a'), session('b')];
    const view = buildControlPlaneView(snapshotFor(sessions), { now: NOW, thresholds: { ta: 0.2, ra: 1.5 } });
    assert.deepStrictEqual(view.thresholds, { ta: 0.2, ra: 1.5, source: 'static' });
    assert.strictEqual(view.events.length, 1);
    const ev = view.events[0];
    assert.strictEqual(ev.level, 'traffic');
    assert.strictEqual(ev.severity, 'warning');
    assert.strictEqual(ev.threshold.crossed, 'ta');
    assert.deepStrictEqual(ev.action, { type: 'transmit', steer: null, hold: null });
    assert.strictEqual(ev.id, 'proximity.advisory:a|b:traffic');
  });

  await test('view: projection is PCA over the shipped channels with a rolling window', () => {
    const sessions = [session('a'), session('b'), session('c'), session('d')];
    const window = createProjectionWindow({ windowSize: 64 });
    const snapshot = snapshotFor(sessions);
    const first = buildControlPlaneView(snapshot, { now: NOW, window });
    assert.strictEqual(first.projection.method, 'pca');
    assert.deepStrictEqual(first.projection.channels, ['x_tree', 'x_overlap', 'x_dep']);
    assert.strictEqual(first.projection.normalization, 'raw', 'six samples is below the warm-up');
    const second = buildControlPlaneView(snapshot, { now: NOW, window });
    assert.strictEqual(second.projection.normalization, 'zscore-clipped');
    assert.strictEqual(second.projection.window.samples, 12);
    assert.deepStrictEqual(second.projection.window.percentiles, [2.5, 97.5]);
    assert.strictEqual(second.projection.pca.loadings.length, 2);
    assert.ok(second.projection.pca.explainedVariance[0] > 0);
    assert.strictEqual(second.pairs.length, 6);
    for (const pair of second.pairs) {
      assert.ok(Array.isArray(pair.point) && pair.point.length === 2);
      assert.ok(Object.keys(pair.normalized).every(k => pair.normalized[k] >= 0 && pair.normalized[k] <= 1));
    }
    assert.strictEqual(second.projection.agents.length, 4);
    assert.ok(!('pairs' in second.projection), 'pairs live at the top level, not under projection');
  });

  await test('view: inventory is declared-only, maps sanitized ids and reports lease conflicts as events', () => {
    const sessions = [session('a'), session('weird id!/x'), session('c', { state: 'stopped' })];
    const manifest = {
      leases: [
        { resource: 'browser:chrome', owner: 'a', expiresAt: '2026-09-11T21:00:00Z' },
        { resource: 'browser:chrome', owner: 'c', expiresAt: '2026-09-11T21:00:00Z' }
      ]
    };
    const view = buildControlPlaneView(snapshotFor(sessions), { now: NOW, manifest });
    assert.strictEqual(view.inventory.status, 'ok');
    assert.strictEqual(view.inventory.mode, 'read-only');
    assert.strictEqual(view.inventory.observedAt, NOW);
    assert.deepStrictEqual(view.inventory.activity.declaredSessionsByStatus, { open: 2, closed: 1, unknown: 0 });
    assert.strictEqual(view.inventory.coverage.leases, 'declared-only');
    assert.ok(Array.isArray(view.inventory.limits) && view.inventory.limits.length > 0);
    assert.deepStrictEqual(view.inventory.leaseConflicts, [{ resource: 'browser:chrome', owners: ['a', 'c'] }]);
    const weird = view.tasks.find(t => t.id === 'weird id!/x');
    assert.strictEqual(weird.inventory.id, 'weird-id--x');
    assert.strictEqual(weird.inventory.heartbeat.state, 'fresh');
    const conflict = view.events.find(e => e.kind === EVENT_KINDS.leaseConflict);
    assert.ok(conflict, 'lease conflict surfaced as an event');
    assert.strictEqual(conflict.id, 'inventory.lease-conflict:browser:chrome');
    assert.strictEqual(conflict.level, 'conflict');
    assert.deepStrictEqual(conflict.subject, { resource: 'browser:chrome', owners: ['a', 'c'] });
    assert.strictEqual(conflict.action.type, 'review');
    assert.ok(conflict.message.includes('not a lock'));
  });

  await test('view: inventory failure degrades to unavailable without breaking the view', () => {
    const sessions = [session('a'), session('b')];
    const inventoryModule = { buildInventory: () => { throw new Error('Invalid coordination input.'); } };
    const view = buildControlPlaneView(snapshotFor(sessions), { now: NOW, inventoryModule });
    assert.deepStrictEqual(view.inventory, { status: 'unavailable', truncated: false, reason: 'Invalid coordination input.' });
    assert.strictEqual(view.tasks.length, 2);
    assert.strictEqual(view.tasks[0].inventory.heartbeat, null);
    assert.strictEqual(view.events.length, 1, 'advisory events still flow');
  });

  await test('view: sessions without edits are tasks with no projection point and no pairs', () => {
    const sessions = [session('idle'), session('a')];
    const view = buildControlPlaneView(snapshotFor(sessions), { now: NOW });
    assert.strictEqual(view.counts.tasks, 2);
    assert.strictEqual(view.counts.agents, 1);
    assert.strictEqual(view.counts.pairs, 0);
    assert.strictEqual(view.events.length, 0);
    const idle = view.tasks.find(t => t.id === 'idle');
    assert.deepStrictEqual(idle.projection, { point: null, pairs: 0, maxRisk: 0 });
    assert.deepStrictEqual(idle.workingSet, { fileCount: 0, files: [] });
    assert.strictEqual(view.projection.normalization, 'raw');
  });

  await test('view: empty and missing snapshots produce an empty, well-formed view', () => {
    const empty = buildControlPlaneView({ sessions: [], proximity: null }, { now: NOW });
    assert.strictEqual(empty.schemaVersion, VIEW_SCHEMA_VERSION);
    assert.deepStrictEqual(empty.tasks, []);
    assert.deepStrictEqual(empty.lanes, []);
    assert.deepStrictEqual(empty.events, []);
    assert.deepStrictEqual(empty.pairs, []);
    assert.strictEqual(empty.inventory.status, 'ok');
    const none = buildControlPlaneView(undefined, { now: NOW });
    assert.deepStrictEqual(none.counts, { lanes: 0, tasks: 0, agents: 0, pairs: 0, events: 0, advisories: 0, resolutions: 0 });
    assert.deepStrictEqual(none.source, { snapshotSchema: null, repoRoot: null, dbPath: null });
  });

  await test('buildInventoryManifest: caps tasks at 64, filters unsafe paths and merges an external manifest', () => {
    const sessions = Array.from({ length: 70 }, (_, i) => session(`s${i}`));
    const agents = new Map([['s0', { files: ['ok/file.js', '/abs/file.js', '../up.js', 'C:/win.js', 'a//b.js'] }]]);
    const built = buildInventoryManifest(sessions, agents, { manifest: { goals: [{ id: 'g1', kind: 'native', status: 'active' }], tasks: [{ id: 'external', paths: [] }] } });
    assert.strictEqual(built.truncated, true);
    assert.strictEqual(built.manifest.tasks.length, 65);
    assert.deepStrictEqual(built.manifest.tasks[0].paths, ['ok/file.js']);
    assert.strictEqual(built.manifest.goals.length, 1);
    assert.strictEqual(built.manifest.sessions.length, 64);
    assert.strictEqual(built.manifest.sessions[0].status, 'open');
    assert.strictEqual(built.idMap.get('s0'), 's0');
  });

  await test('internal: inventory ids are sanitized and deduplicated; states map to open/closed/unknown', () => {
    const taken = new Set();
    assert.strictEqual(_internal.inventoryIdFor('plain-id', 0, taken), 'plain-id');
    assert.strictEqual(_internal.inventoryIdFor('plain-id', 1, taken), 'plain-id-2');
    assert.strictEqual(_internal.inventoryIdFor('!!!', 2, taken), 'task-3');
    assert.strictEqual(_internal.inventoryIdFor('__proto__', 3, taken), 'proto__', 'leading underscores stripped, no longer reserved');
    assert.strictEqual(_internal.inventoryIdFor('constructor', 5, taken), 'task-6', 'reserved word falls back to a positional id');
    assert.strictEqual(_internal.inventoryIdFor('a b/c', 4, taken), 'a-b-c');
    assert.strictEqual(_internal.sessionDeclarationStatus('running'), 'open');
    assert.strictEqual(_internal.sessionDeclarationStatus('failed'), 'closed');
    assert.strictEqual(_internal.sessionDeclarationStatus('weird'), 'unknown');
    assert.deepStrictEqual(_internal.laneFor({ harness: 'codex' }), { id: 'harness:codex', label: 'codex', kind: 'harness' });
  });

  await test('createControlPlaneViewSource: keeps one window across builds', async () => {
    const sessions = [session('a'), session('b'), session('c'), session('d')];
    const snapshot = snapshotFor(sessions);
    let builds = 0;
    const source = createControlPlaneViewSource({
      buildSnapshot: async () => {
        builds += 1;
        return snapshot;
      },
      projection: { windowSize: 32 },
      viewOptions: { now: NOW }
    });
    const first = await source.build();
    const second = await source.build();
    assert.strictEqual(builds, 2);
    assert.strictEqual(first.projection.window.samples, 6);
    assert.strictEqual(second.projection.window.samples, 12);
    assert.strictEqual(source.window.size, 32);
    assert.strictEqual(second.generatedAt, NOW);
  });

  console.log(`\nResults: Passed: ${passed}, Failed: ${failed}`);
  if (failed > 0) process.exit(1);
})();
