'use strict';
const { test } = require('node:test');
const assert = require('node:assert/strict');
const { buildInventory, normalizeManifest } = require('../../scripts/lib/coordination-inventory');
const now = '2026-09-09T01:00:00.000Z';
const fixture = () => ({ version: 1,
  repositories: [{ id: 'repo', sources: {} }],
  tasks: [{ id: 'worker', repoId: 'repo', paths: ['src/shared.js'], status: 'running', pid: 42 },
    { id: 'peer', repoId: 'repo', paths: ['src/shared.js'] }], leases: [] });
const inventory = value => buildInventory(value, { now });

test('goal collections distinguish missing observations from explicit empty declarations', () => {
  const missing = inventory(fixture());
  const empty = inventory({ ...fixture(), goals: [], sessions: [] });
  assert.equal(missing.coverage.goals, 'missing');
  assert.equal(missing.coverage.sessions, 'missing');
  assert.equal(empty.coverage.goals, 'declared-only');
  assert.equal(empty.coverage.sessions, 'declared-only');
  assert.deepEqual(missing.goals, []);
  assert.deepEqual(missing.sessions, []);
  assert.deepEqual(missing.activity, empty.activity);
  assert.equal(missing.activity.freshActiveNativeGoalDeclarations, 0);
});

test('goal activity is never inferred from an open session, running task, heartbeat or observed PID', () => {
  const input = fixture(); input.tasks[0].heartbeatAt = now;
  input.sessions = [{ id: 'terminal', taskId: 'worker', status: 'open', updatedAt: now }];
  const report = buildInventory(input, { now, resources: {
    memory: null, processStatus: 'ok', processes: [{ pid: 42, ppid: 1, rssBytes: 1024 }] } });
  assert.equal(report.tasks[0].process.state, 'observed');
  assert.equal(report.tasks[0].heartbeat.state, 'fresh');
  assert.equal(report.activity.declaredSessionsByStatus.open, 1);
  assert.equal(report.activity.openSessionsWithoutGoalDeclaration, 1);
  assert.deepEqual(report.activity.declaredGoalsByStatus, { active: 0, complete: 0, blocked: 0, unknown: 0 });
  assert.equal(report.coverage.goals, 'missing');
});

test('goal and session declarations remain independent and count a shared goal once', () => {
  const input = { ...fixture(), goals: [
    { id: 'active', taskId: 'worker', kind: 'native', status: 'active', updatedAt: now },
    { id: 'done', kind: 'native', status: 'complete', updatedAt: now },
    { id: 'unverified', status: 'active', updatedAt: now },
    { id: 'blocked', kind: 'native', status: 'blocked' }, { id: 'unknown' }
  ], sessions: [
    { id: 'closed', goalId: 'active', status: 'closed' },
    { id: 'other', goalId: 'active', taskId: 'peer', status: 'open' },
    { id: 'open-done', goalId: 'done', status: 'open' }, { id: 'unknown-session' }
  ] };
  const before = JSON.stringify(input); const report = inventory(input);
  assert.deepEqual(report.activity.declaredGoalsByStatus, { active: 2, complete: 1, blocked: 1, unknown: 1 });
  assert.deepEqual(report.activity.declaredNativeGoalsByStatus, { active: 1, complete: 1, blocked: 1, unknown: 0 });
  assert.deepEqual(report.activity.declaredSessionsByStatus, { open: 2, closed: 1, unknown: 1 });
  assert.equal(report.activity.freshActiveNativeGoalDeclarations, 1);
  assert.equal(report.activity.openSessionsWithoutGoalDeclaration, 0);
  assert.equal(report.goals[2].kind, 'unknown');
  assert.equal(report.goals[4].status, 'unknown');
  assert.equal(report.sessions[3].status, 'unknown');
  assert.equal(report.goals[0].authority, 'declared-only');
  assert.equal(report.sessions[0].authority, 'declared-only');
  assert.equal(JSON.stringify(input), before);
  assert.deepEqual(inventory(input), report);
});

test('goal freshness exposes missing stale future and boundary observations without rewriting status', () => {
  const times = [null, '2026-09-09T00:54:59.999Z', '2026-09-09T01:00:00.001Z',
    '2026-09-09T00:55:00.000Z', now];
  const report = inventory({ ...fixture(), goals: times.map((updatedAt, i) =>
    ({ id: `g${i}`, kind: 'native', status: 'active', updatedAt })) });
  assert.deepEqual(report.goals.map(g => g.freshness.state), ['unknown', 'stale', 'clock-skew', 'fresh', 'fresh']);
  assert.equal(report.activity.declaredNativeGoalsByStatus.active, 5);
  assert.equal(report.activity.freshActiveNativeGoalDeclarations, 2);
  assert.ok(report.goals.every(g => g.status === 'active'));
});

test('goal declarations do not change existing task resource lease or overlap outputs', () => {
  const base = fixture();
  base.leases = [{ resource: 'browser', owner: 'worker', expiresAt: now }];
  const legacy = inventory(base);
  const report = inventory({ ...base, goals: [{ id: 'completed', status: 'complete' }],
    sessions: [{ id: 'closed', status: 'closed', goalId: 'completed' }] });
  for (const key of ['tasks', 'warnings', 'resources', 'leases', 'leaseConflicts']) {
    assert.deepEqual(report[key], legacy[key]);
  }
  assert.equal(report.warnings.length, 1);
  assert.equal(report.warnings[0].action, 'review-declared-work');
});

test('goal metadata drops objectives commands native blobs and other unrecognized fields', () => {
  const report = inventory({ ...fixture(), goals: [{ id: 'g', objective: 'CANARY',
    tool_result: { secret: 'CANARY' }, status: 'active', authority: 'CANARY' }],
  sessions: [{ id: 's', goalId: 'g', command: 'CANARY', environment: 'CANARY' }] });
  assert.ok(!JSON.stringify(report).includes('CANARY'));
  assert.equal(report.goals[0].authority, 'declared-only');
});

test('goal input rejects malformed scalars enums dates duplicate IDs and dangling links', () => {
  for (const collection of ['goals', 'sessions']) {
    for (const value of [null, false, '', {}, 1]) {
      assert.throws(() => normalizeManifest({ ...fixture(), [collection]: value }), /Invalid coordination input/);
    }
    for (const value of [null, false, [], 1, { id: 'bad/id' }, { id: '__proto__' },
      { id: 'x', status: null }, { id: 'x', status: true }, { id: 'x', status: 'running' },
      { id: 'x', updatedAt: '2026-02-30T00:00:00Z' }, { id: 'x', updatedAt: true },
      { id: 'x', taskId: 'missing' }, { id: 'x', taskId: 1 }]) {
      assert.throws(() => normalizeManifest({ ...fixture(), [collection]: [value] }), /Invalid coordination input/);
    }
    assert.throws(() => normalizeManifest({ ...fixture(), [collection]: [{ id: 'same' }, { id: 'same' }] }));
  }
  for (const kind of [null, true, 1, 'verified', 'declared']) {
    assert.throws(() => normalizeManifest({ ...fixture(), goals: [{ id: 'g', kind }] }));
  }
  assert.throws(() => normalizeManifest({ ...fixture(), sessions: [{ id: 's', goalId: 'missing' }] }));
  assert.throws(() => normalizeManifest({ ...fixture(), sessions: [{ id: 's', goalId: 1 }] }));
});

test('goal and session cardinality and total input bounds remain enforced', () => {
  const declarations = Array.from({ length: 64 }, (_, i) => ({ id: `item${i}` }));
  const report = inventory({ ...fixture(), goals: declarations, sessions: declarations });
  assert.equal(report.goals.length, 64); assert.equal(report.sessions.length, 64);
  for (const collection of ['goals', 'sessions']) {
    assert.throws(() => inventory({ ...fixture(), [collection]: [...declarations, { id: 'extra' }] }));
  }
  assert.throws(() => inventory({ ...fixture(), goals: [{ id: 'g', ignored: 'x'.repeat(1024 * 1024) }] }));
});
