'use strict';
/**
 * Tests for the control-pane proximity integration (sessions -> airspace scan).
 */

const assert = require('assert');

const { buildProximitySnapshot, sessionsToAgents, parseDiffRanges, dispatchProximityTriggers, createProximityDispatcher, runProximityTick } = require('../../scripts/lib/control-pane/proximity');
const { parseArgs: parseTickArgs } = require('../../scripts/proximity-tick');

let passed = 0;
let failed = 0;
function test(name, fn) {
  try {
    fn();
    console.log(`  PASS ${name}`);
    passed += 1;
  } catch (e) {
    console.log(`  FAIL ${name}`);
    console.log(`    ${e.message}`);
    failed += 1;
  }
}

const sessions = [
  {
    id: 'lead-hermes',
    task: 'Build the API',
    createdAt: '2026-06-19T10:00:00Z',
    worktree: { path: '/wt/lead', base: 'main' }
  },
  {
    id: 'worker-kb',
    task: 'Also touch the API',
    createdAt: '2026-06-19T10:05:00Z',
    worktree: { path: '/wt/worker', base: 'main' }
  },
  {
    id: 'docs-bot',
    task: 'Write docs',
    createdAt: '2026-06-19T10:06:00Z',
    worktree: { path: '/wt/docs', base: 'main' }
  },
  { id: 'no-worktree', task: 'idle', createdAt: '2026-06-19T10:07:00Z', worktree: null }
];

// Injected working sets: lead + worker both edit the same API file (collision);
// docs-bot edits an unrelated file (clear).
const changedFilesFor = session =>
  ({
    'lead-hermes': ['src/api/users.js'],
    'worker-kb': ['src/api/users.js'],
    'docs-bot': ['docs/guide.md'],
    'no-worktree': []
  })[session.id] || [];

test('sessionsToAgents: only worktree sessions with edits participate', () => {
  const agents = sessionsToAgents(sessions, { changedFilesFor });
  assert.deepStrictEqual(agents.map(a => a.agentId).sort(), ['docs-bot', 'lead-hermes', 'worker-kb']);
  assert.strictEqual(agents.find(a => a.agentId === 'lead-hermes').files[0].path, 'src/api/users.js');
});

test('buildProximitySnapshot: same-file editors get a resolution; the later one steers', () => {
  const prox = buildProximitySnapshot(sessions, { changedFilesFor, graph: { adjacency: {} } });
  assert.strictEqual(prox.enabled, true);
  assert.strictEqual(prox.counts.agents, 3);
  const collision = prox.advisories.find(a => [a.a, a.b].includes('lead-hermes') && [a.a, a.b].includes('worker-kb'));
  assert.ok(collision, 'lead/worker should produce an advisory');
  assert.strictEqual(collision.level, 'resolution', `level ${collision.level} risk ${collision.risk}`);
  // lead started earlier ⇒ holds; worker steers.
  assert.strictEqual(collision.steer, 'worker-kb');
  assert.strictEqual(collision.hold, 'lead-hermes');
  // docs-bot is clear of both.
  assert.ok(!prox.advisories.some(a => a.a === 'docs-bot' || a.b === 'docs-bot'));
  // every participating agent gets a 3D position.
  assert.strictEqual(prox.positions.length, 3);
});

test('buildProximitySnapshot: fewer than two participants ⇒ no advisories', () => {
  const single = buildProximitySnapshot([sessions[0]], { changedFilesFor });
  assert.strictEqual(single.counts.agents, 1);
  assert.strictEqual(single.advisories.length, 0);
});

test('buildProximitySnapshot: advisories carry human-readable labels', () => {
  const prox = buildProximitySnapshot(sessions, { changedFilesFor, graph: { adjacency: {} } });
  const collision = prox.advisories[0];
  assert.ok(collision.aLabel && collision.bLabel, 'labels present');
});

test('parseDiffRanges: extracts new-side line ranges per file', () => {
  const diff = ['diff --git a/src/x.js b/src/x.js', '--- a/src/x.js', '+++ b/src/x.js', '@@ -10,0 +11,3 @@', '+a', '+b', '+c', '@@ -40,2 +44,1 @@', '+z'].join('\n');
  const ranges = parseDiffRanges(diff);
  assert.deepStrictEqual(ranges.get('src/x.js'), [
    [11, 13],
    [44, 44]
  ]);
});

test('line-range channel: same file but disjoint ranges ⇒ no resolution', () => {
  // Two agents in the same file, far-apart functions. workingSetFor provides ranges.
  const workingSetFor = s =>
    ({
      'lead-hermes': [{ path: 'src/api/users.js', lines: [[1, 20]] }],
      'worker-kb': [{ path: 'src/api/users.js', lines: [[500, 540]] }]
    })[s.id] || [];
  const prox = buildProximitySnapshot([sessions[0], sessions[1]], { workingSetFor, graph: { adjacency: {} } });
  const collision = prox.advisories.find(a => [a.a, a.b].includes('worker-kb'));
  // Disjoint line ranges in the same file should NOT be a resolution-level collision.
  assert.ok(!collision || collision.level !== 'resolution', `disjoint ranges should not force a steer (got ${collision && collision.level})`);
});

test('line-range channel: same file overlapping ranges ⇒ resolution', () => {
  // worker's edit sits inside the lead's region — a definite conflict zone.
  const workingSetFor = s =>
    ({
      'lead-hermes': [{ path: 'src/api/users.js', lines: [[1, 120]] }],
      'worker-kb': [{ path: 'src/api/users.js', lines: [[30, 70]] }]
    })[s.id] || [];
  const prox = buildProximitySnapshot([sessions[0], sessions[1]], { workingSetFor, graph: { adjacency: {} } });
  const collision = prox.advisories.find(a => [a.a, a.b].includes('worker-kb'));
  assert.ok(collision && collision.level === 'resolution', 'overlapping ranges should force a steer');
});

test('triggers: resolution produces a steer message to the yielding agent and a hold notice', () => {
  const prox = buildProximitySnapshot(sessions, { changedFilesFor, graph: { adjacency: {} } });
  const steer = prox.triggers.find(t => t.type === 'proximity_steer');
  const hold = prox.triggers.find(t => t.type === 'proximity_hold');
  assert.ok(steer && steer.to === 'worker-kb', 'steer message goes to the yielding worker');
  assert.ok(hold && hold.to === 'lead-hermes', 'hold notice goes to the lead');
  assert.ok(/steer away/i.test(steer.content));
});

test('dispatchProximityTriggers: delivers each trigger through the injected sink', () => {
  const prox = buildProximitySnapshot(sessions, { changedFilesFor, graph: { adjacency: {} } });
  const sent = [];
  const result = dispatchProximityTriggers(prox.triggers, {
    sendMessage: m => sent.push(m)
  });
  assert.strictEqual(result.dispatched, prox.triggers.length);
  assert.ok(sent.every(m => m.fromSession && m.toSession && m.content && m.msgType));
});

test('dispatchProximityTriggers: no sink ⇒ nothing thrown, all skipped', () => {
  const r = dispatchProximityTriggers([{ to: 'a', from: 'b', type: 'x', content: 'c' }], {});
  assert.strictEqual(r.dispatched, 0);
  assert.strictEqual(r.skipped, 1);
});

test('runProximityTick: dispatches the snapshot triggers via the dispatcher', async () => {
  const snapshot = {
    proximity: {
      counts: { agents: 2, advisories: 1, resolutions: 1 },
      advisories: [{ a: 'lead', b: 'worker', level: 'resolution', risk: 0.9, steer: 'worker', hold: 'lead' }],
      triggers: [
        { to: 'worker', from: 'lead', type: 'proximity_steer', content: 'steer' },
        { to: 'lead', from: 'worker', type: 'proximity_hold', content: 'hold' }
      ]
    }
  };
  const sent = [];
  const dispatcher = createProximityDispatcher({ sendMessage: m => sent.push(m), now: () => 0 });
  const tick = await runProximityTick({ buildSnapshot: async () => snapshot, dispatcher });
  assert.strictEqual(tick.result.dispatched, 2);
  assert.strictEqual(sent.length, 2);
});

test('runProximityTick: dry-run sends nothing', async () => {
  const snapshot = { proximity: { counts: {}, advisories: [], triggers: [{ to: 'a', from: 'b', type: 'x', content: 'c' }] } };
  const sent = [];
  const dispatcher = createProximityDispatcher({ sendMessage: m => sent.push(m) });
  const tick = await runProximityTick({ buildSnapshot: async () => snapshot, dispatcher, dryRun: true });
  assert.strictEqual(tick.result.dispatched, 0);
  assert.strictEqual(tick.result.dryRun, true);
  assert.strictEqual(sent.length, 0);
});

test('proximity-tick parseArgs: parses flags', () => {
  const a = parseTickArgs(['node', 'proximity-tick.js', '--watch', '30', '--dry-run', '--db', '/x']);
  assert.strictEqual(a.watchSec, 30);
  assert.strictEqual(a.dryRun, true);
  assert.strictEqual(a.dbPath, '/x');
  assert.throws(() => parseTickArgs(['node', 'p', '--watch', 'nope']), /positive seconds/);
});

console.log(`\nResults: Passed: ${passed}, Failed: ${failed}`);
if (failed > 0) process.exit(1);
