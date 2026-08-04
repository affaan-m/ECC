'use strict';

const assert = require('assert');
const fs = require('fs');
const os = require('os');
const path = require('path');

const {
  SESSION_SCHEMA_VERSION,
  buildAggregates,
  getFallbackSessionRecordingPath,
  normalizeClaudeHistorySession,
  normalizeDmuxSnapshot,
  persistCanonicalSnapshot,
  validateCanonicalSnapshot
} = require('../../scripts/lib/session-adapters/canonical-session');
const { createClaudeHistoryAdapter } = require('../../scripts/lib/session-adapters/claude-history');
const { createDmuxTmuxAdapter } = require('../../scripts/lib/session-adapters/dmux-tmux');
const {
  createAdapterRegistry,
  inspectSessionTarget
} = require('../../scripts/lib/session-adapters/registry');

console.log('=== Testing session-adapters ===\n');

let passed = 0;
let failed = 0;

function test(name, fn) {
  try {
    fn();
    console.log(`  ✓ ${name}`);
    passed += 1;
  } catch (error) {
    console.log(`  ✗ ${name}: ${error.message}`);
    failed += 1;
  }
}

function withHome(homeDir, fn) {
  const previousHome = process.env.HOME;
  const previousUserProfile = process.env.USERPROFILE;
  process.env.HOME = homeDir;
  process.env.USERPROFILE = homeDir;

  try {
    fn();
  } finally {
    if (typeof previousHome === 'string') {
      process.env.HOME = previousHome;
    } else {
      delete process.env.HOME;
    }

    if (typeof previousUserProfile === 'string') {
      process.env.USERPROFILE = previousUserProfile;
    } else {
      delete process.env.USERPROFILE;
    }
  }
}

function canonicalSnapshot(overrides = {}) {
  const snapshot = {
    schemaVersion: SESSION_SCHEMA_VERSION,
    adapterId: 'test-adapter',
    session: {
      id: 'session-1',
      kind: 'test',
      state: 'active',
      repoRoot: null,
      sourceTarget: {
        type: 'session',
        value: 'session-1'
      }
    },
    workers: [{
      id: 'worker-1',
      label: 'Worker 1',
      state: 'running',
      health: 'healthy',
      branch: null,
      worktree: null,
      runtime: {
        kind: 'test-runtime',
        command: null,
        pid: null,
        active: true,
        dead: false
      },
      intent: {
        objective: 'Test objective',
        seedPaths: []
      },
      outputs: {
        summary: [],
        validation: [],
        remainingRisks: []
      },
      artifacts: {}
    }]
  };

  snapshot.aggregates = buildAggregates(snapshot.workers);

  if (overrides.session) {
    snapshot.session = { ...snapshot.session, ...overrides.session };
  }
  if (overrides.sourceTarget) {
    snapshot.session.sourceTarget = {
      ...snapshot.session.sourceTarget,
      ...overrides.sourceTarget
    };
  }
  if (Object.prototype.hasOwnProperty.call(overrides, 'workers')) {
    snapshot.workers = overrides.workers;
    snapshot.aggregates = buildAggregates(Array.isArray(overrides.workers) ? overrides.workers : []);
  }
  if (overrides.aggregates) {
    snapshot.aggregates = { ...snapshot.aggregates, ...overrides.aggregates };
  }

  for (const [key, value] of Object.entries(overrides)) {
    if (!['session', 'sourceTarget', 'workers', 'aggregates'].includes(key)) {
      snapshot[key] = value;
    }
  }

  return snapshot;
}

test('dmux adapter normalizes orchestration snapshots into canonical form', () => {
  const recordingDir = fs.mkdtempSync(path.join(os.tmpdir(), 'ecc-session-recordings-'));

  try {
    const recentUpdated = new Date(Date.now() - 60000).toISOString();

    const adapter = createDmuxTmuxAdapter({
      loadStateStoreImpl: () => null,
      collectSessionSnapshotImpl: () => ({
        sessionName: 'workflow-visual-proof',
        coordinationDir: '/tmp/.claude/orchestration/workflow-visual-proof',
        repoRoot: '/tmp/repo',
        targetType: 'plan',
        sessionActive: true,
        paneCount: 1,
        workerCount: 1,
        workerStates: { running: 1 },
        panes: [{
          paneId: '%95',
          windowIndex: 1,
          paneIndex: 0,
          title: 'seed-check',
          currentCommand: 'codex',
          currentPath: '/tmp/worktree',
          active: false,
          dead: false,
          pid: 1234
        }],
        workers: [{
          workerSlug: 'seed-check',
          workerDir: '/tmp/.claude/orchestration/workflow-visual-proof/seed-check',
          status: {
            state: 'running',
            updated: recentUpdated,
            branch: 'feature/seed-check',
            worktree: '/tmp/worktree',
            taskFile: '/tmp/task.md',
            handoffFile: '/tmp/handoff.md'
          },
          task: {
            objective: 'Inspect seeded files.',
            seedPaths: ['scripts/orchestrate-worktrees.js']
          },
          handoff: {
            summary: ['Pending'],
            validation: [],
            remainingRisks: ['No screenshot yet']
          },
          files: {
            status: '/tmp/status.md',
            task: '/tmp/task.md',
            handoff: '/tmp/handoff.md'
          },
          pane: {
            paneId: '%95',
            title: 'seed-check'
          }
        }]
      }),
      recordingDir
    });

    const snapshot = adapter.open('workflow-visual-proof').getSnapshot();
    const recordingPath = getFallbackSessionRecordingPath(snapshot, { recordingDir });
    const persisted = JSON.parse(fs.readFileSync(recordingPath, 'utf8'));

    assert.strictEqual(snapshot.schemaVersion, 'ecc.session.v1');
    assert.strictEqual(snapshot.adapterId, 'dmux-tmux');
    assert.strictEqual(snapshot.session.id, 'workflow-visual-proof');
    assert.strictEqual(snapshot.session.kind, 'orchestrated');
    assert.strictEqual(snapshot.session.state, 'active');
    assert.strictEqual(snapshot.session.sourceTarget.type, 'session');
    assert.strictEqual(snapshot.aggregates.workerCount, 1);
    assert.strictEqual(snapshot.workers[0].health, 'healthy');
    assert.strictEqual(snapshot.workers[0].runtime.kind, 'tmux-pane');
    assert.strictEqual(snapshot.workers[0].outputs.remainingRisks[0], 'No screenshot yet');
    assert.strictEqual(persisted.latest.session.state, 'active');
    assert.strictEqual(persisted.latest.adapterId, 'dmux-tmux');
    assert.strictEqual(persisted.history.length, 1);
  } finally {
    fs.rmSync(recordingDir, { recursive: true, force: true });
  }
});

test('dmux adapter marks finished sessions as completed and records history', () => {
  const recordingDir = fs.mkdtempSync(path.join(os.tmpdir(), 'ecc-session-recordings-'));

  try {
    const adapter = createDmuxTmuxAdapter({
      loadStateStoreImpl: () => null,
      collectSessionSnapshotImpl: () => ({
        sessionName: 'workflow-visual-proof',
        coordinationDir: '/tmp/.claude/orchestration/workflow-visual-proof',
        repoRoot: '/tmp/repo',
        targetType: 'session',
        sessionActive: false,
        paneCount: 0,
        workerCount: 2,
        workerStates: { completed: 2 },
        panes: [],
        workers: [{
          workerSlug: 'seed-check',
          workerDir: '/tmp/.claude/orchestration/workflow-visual-proof/seed-check',
          status: {
            state: 'completed',
            updated: '2026-03-13T00:00:00Z',
            branch: 'feature/seed-check',
            worktree: '/tmp/worktree-a',
            taskFile: '/tmp/task-a.md',
            handoffFile: '/tmp/handoff-a.md'
          },
          task: {
            objective: 'Inspect seeded files.',
            seedPaths: ['scripts/orchestrate-worktrees.js']
          },
          handoff: {
            summary: ['Finished'],
            validation: ['Reviewed outputs'],
            remainingRisks: []
          },
          files: {
            status: '/tmp/status-a.md',
            task: '/tmp/task-a.md',
            handoff: '/tmp/handoff-a.md'
          },
          pane: null
        }, {
          workerSlug: 'proof',
          workerDir: '/tmp/.claude/orchestration/workflow-visual-proof/proof',
          status: {
            state: 'completed',
            updated: '2026-03-13T00:10:00Z',
            branch: 'feature/proof',
            worktree: '/tmp/worktree-b',
            taskFile: '/tmp/task-b.md',
            handoffFile: '/tmp/handoff-b.md'
          },
          task: {
            objective: 'Capture proof.',
            seedPaths: ['README.md']
          },
          handoff: {
            summary: ['Delivered proof'],
            validation: ['Checked screenshots'],
            remainingRisks: []
          },
          files: {
            status: '/tmp/status-b.md',
            task: '/tmp/task-b.md',
            handoff: '/tmp/handoff-b.md'
          },
          pane: null
        }]
      }),
      recordingDir
    });

    const snapshot = adapter.open('workflow-visual-proof').getSnapshot();
    const recordingPath = getFallbackSessionRecordingPath(snapshot, { recordingDir });
    const persisted = JSON.parse(fs.readFileSync(recordingPath, 'utf8'));

    assert.strictEqual(snapshot.session.state, 'completed');
    assert.strictEqual(snapshot.aggregates.states.completed, 2);
    assert.strictEqual(snapshot.workers[0].health, 'healthy');
    assert.strictEqual(snapshot.workers[1].health, 'healthy');
    assert.strictEqual(persisted.latest.session.state, 'completed');
    assert.strictEqual(persisted.history.length, 1);
  } finally {
    fs.rmSync(recordingDir, { recursive: true, force: true });
  }
});

test('fallback recording does not append duplicate history entries for unchanged snapshots', () => {
  const recordingDir = fs.mkdtempSync(path.join(os.tmpdir(), 'ecc-session-recordings-'));

  try {
    const adapter = createDmuxTmuxAdapter({
      loadStateStoreImpl: () => null,
      collectSessionSnapshotImpl: () => ({
        sessionName: 'workflow-visual-proof',
        coordinationDir: '/tmp/.claude/orchestration/workflow-visual-proof',
        repoRoot: '/tmp/repo',
        targetType: 'session',
        sessionActive: true,
        paneCount: 1,
        workerCount: 1,
        workerStates: { running: 1 },
        panes: [],
        workers: [{
          workerSlug: 'seed-check',
          workerDir: '/tmp/.claude/orchestration/workflow-visual-proof/seed-check',
          status: {
            state: 'running',
            updated: '2026-03-13T00:00:00Z',
            branch: 'feature/seed-check',
            worktree: '/tmp/worktree',
            taskFile: '/tmp/task.md',
            handoffFile: '/tmp/handoff.md'
          },
          task: {
            objective: 'Inspect seeded files.',
            seedPaths: ['scripts/orchestrate-worktrees.js']
          },
          handoff: {
            summary: ['Pending'],
            validation: [],
            remainingRisks: []
          },
          files: {
            status: '/tmp/status.md',
            task: '/tmp/task.md',
            handoff: '/tmp/handoff.md'
          },
          pane: null
        }]
      }),
      recordingDir
    });

    const handle = adapter.open('workflow-visual-proof');
    const firstSnapshot = handle.getSnapshot();
    const secondSnapshot = handle.getSnapshot();
    const recordingPath = getFallbackSessionRecordingPath(firstSnapshot, { recordingDir });
    const persisted = JSON.parse(fs.readFileSync(recordingPath, 'utf8'));

    assert.deepStrictEqual(secondSnapshot, firstSnapshot);
    assert.strictEqual(persisted.history.length, 1);
    assert.deepStrictEqual(persisted.latest, secondSnapshot);
  } finally {
    fs.rmSync(recordingDir, { recursive: true, force: true });
  }
});

test('claude-history adapter loads the latest recorded session', () => {
  const homeDir = fs.mkdtempSync(path.join(os.tmpdir(), 'ecc-session-adapter-home-'));
  const recordingDir = fs.mkdtempSync(path.join(os.tmpdir(), 'ecc-session-recordings-'));
  const sessionsDir = path.join(homeDir, '.claude', 'sessions');
  fs.mkdirSync(sessionsDir, { recursive: true });

  const sessionPath = path.join(sessionsDir, '2026-03-13-a1b2c3d4-session.tmp');
  fs.writeFileSync(sessionPath, [
    '# Session Review',
    '',
    '**Date:** 2026-03-13',
    '**Started:** 09:00',
    '**Last Updated:** 11:30',
    '**Project:** everything-claude-code',
    '**Branch:** feat/session-adapter',
    '**Worktree:** /tmp/ecc-worktree',
    '',
    '### Completed',
    '- [x] Build snapshot prototype',
    '',
    '### In Progress',
    '- [ ] Add CLI wrapper',
    '',
    '### Notes for Next Session',
    'Need a second adapter.',
    '',
    '### Context to Load',
    '```',
    'scripts/lib/orchestration-session.js',
    '```'
  ].join('\n'));

  try {
    withHome(homeDir, () => {
      const adapter = createClaudeHistoryAdapter({
        loadStateStoreImpl: () => null,
        recordingDir
      });
      const snapshot = adapter.open('claude:latest').getSnapshot();
      const recordingPath = getFallbackSessionRecordingPath(snapshot, { recordingDir });
      const persisted = JSON.parse(fs.readFileSync(recordingPath, 'utf8'));

      assert.strictEqual(snapshot.schemaVersion, 'ecc.session.v1');
      assert.strictEqual(snapshot.adapterId, 'claude-history');
      assert.strictEqual(snapshot.session.kind, 'history');
      assert.strictEqual(snapshot.session.state, 'recorded');
      assert.strictEqual(snapshot.workers.length, 1);
      assert.strictEqual(snapshot.workers[0].branch, 'feat/session-adapter');
      assert.strictEqual(snapshot.workers[0].worktree, '/tmp/ecc-worktree');
      assert.strictEqual(snapshot.workers[0].runtime.kind, 'claude-session');
      assert.deepStrictEqual(snapshot.workers[0].intent.seedPaths, ['scripts/lib/orchestration-session.js']);
      assert.strictEqual(snapshot.workers[0].artifacts.sessionFile, sessionPath);
      assert.ok(snapshot.workers[0].outputs.summary.includes('Build snapshot prototype'));
      assert.strictEqual(persisted.latest.adapterId, 'claude-history');
      assert.strictEqual(persisted.history.length, 1);
    });
  } finally {
    fs.rmSync(homeDir, { recursive: true, force: true });
    fs.rmSync(recordingDir, { recursive: true, force: true });
  }
});

test('adapter registry routes plan files to dmux and explicit claude targets to history', () => {
  const repoRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'ecc-session-registry-repo-'));
  const planPath = path.join(repoRoot, 'workflow.json');
  fs.writeFileSync(planPath, JSON.stringify({
    sessionName: 'workflow-visual-proof',
    repoRoot,
    coordinationRoot: path.join(repoRoot, '.claude', 'orchestration')
  }));

  const homeDir = fs.mkdtempSync(path.join(os.tmpdir(), 'ecc-session-registry-home-'));
  const sessionsDir = path.join(homeDir, '.claude', 'sessions');
  fs.mkdirSync(sessionsDir, { recursive: true });
  fs.writeFileSync(
    path.join(sessionsDir, '2026-03-13-z9y8x7w6-session.tmp'),
    '# History Session\n\n**Branch:** feat/history\n'
  );

  try {
    withHome(homeDir, () => {
      const registry = createAdapterRegistry({
        adapters: [
          createDmuxTmuxAdapter({
            loadStateStoreImpl: () => null,
            collectSessionSnapshotImpl: () => ({
              sessionName: 'workflow-visual-proof',
              coordinationDir: path.join(repoRoot, '.claude', 'orchestration', 'workflow-visual-proof'),
              repoRoot,
              targetType: 'plan',
              sessionActive: false,
              paneCount: 0,
              workerCount: 0,
              workerStates: {},
              panes: [],
              workers: []
            })
          }),
          createClaudeHistoryAdapter({ loadStateStoreImpl: () => null })
        ]
      });

      const dmuxSnapshot = registry.open(planPath, { cwd: repoRoot }).getSnapshot();
      const claudeSnapshot = registry.open('claude:latest', { cwd: repoRoot }).getSnapshot();

      assert.strictEqual(dmuxSnapshot.adapterId, 'dmux-tmux');
      assert.strictEqual(claudeSnapshot.adapterId, 'claude-history');
    });
  } finally {
    fs.rmSync(repoRoot, { recursive: true, force: true });
    fs.rmSync(homeDir, { recursive: true, force: true });
  }
});

test('adapter registry resolves structured target types into the correct adapter', () => {
  const repoRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'ecc-session-typed-repo-'));
  const planPath = path.join(repoRoot, 'workflow.json');
  fs.writeFileSync(planPath, JSON.stringify({
    sessionName: 'workflow-typed-proof',
    repoRoot,
    coordinationRoot: path.join(repoRoot, '.claude', 'orchestration')
  }));

  const homeDir = fs.mkdtempSync(path.join(os.tmpdir(), 'ecc-session-typed-home-'));
  const sessionsDir = path.join(homeDir, '.claude', 'sessions');
  fs.mkdirSync(sessionsDir, { recursive: true });
  fs.writeFileSync(
    path.join(sessionsDir, '2026-03-13-z9y8x7w6-session.tmp'),
    '# Typed History Session\n\n**Branch:** feat/typed-targets\n'
  );

  try {
    withHome(homeDir, () => {
      const registry = createAdapterRegistry({
        adapters: [
          createDmuxTmuxAdapter({
            loadStateStoreImpl: () => null,
            collectSessionSnapshotImpl: () => ({
              sessionName: 'workflow-typed-proof',
              coordinationDir: path.join(repoRoot, '.claude', 'orchestration', 'workflow-typed-proof'),
              repoRoot,
              targetType: 'plan',
              sessionActive: true,
              paneCount: 0,
              workerCount: 0,
              workerStates: {},
              panes: [],
              workers: []
            })
          }),
          createClaudeHistoryAdapter({ loadStateStoreImpl: () => null })
        ]
      });

      const dmuxSnapshot = registry.open({ type: 'plan', value: planPath }, { cwd: repoRoot }).getSnapshot();
      const claudeSnapshot = registry.open({ type: 'claude-history', value: 'latest' }, { cwd: repoRoot }).getSnapshot();

      assert.strictEqual(dmuxSnapshot.adapterId, 'dmux-tmux');
      assert.strictEqual(dmuxSnapshot.session.sourceTarget.type, 'plan');
      assert.strictEqual(claudeSnapshot.adapterId, 'claude-history');
      assert.strictEqual(claudeSnapshot.session.sourceTarget.type, 'claude-history');
      assert.strictEqual(claudeSnapshot.workers[0].branch, 'feat/typed-targets');
    });
  } finally {
    fs.rmSync(repoRoot, { recursive: true, force: true });
    fs.rmSync(homeDir, { recursive: true, force: true });
  }
});

test('default registry forwards a nested state-store writer to adapters', () => {
  const homeDir = fs.mkdtempSync(path.join(os.tmpdir(), 'ecc-session-registry-home-'));
  const sessionsDir = path.join(homeDir, '.claude', 'sessions');
  fs.mkdirSync(sessionsDir, { recursive: true });
  fs.writeFileSync(
    path.join(sessionsDir, '2026-03-13-z9y8x7w6-session.tmp'),
    '# History Session\n\n**Branch:** feat/history\n'
  );

  const stateStore = {
    sessions: {
      persisted: [],
      persistCanonicalSessionSnapshot(snapshot, metadata) {
        this.persisted.push({ snapshot, metadata });
      }
    }
  };

  try {
    withHome(homeDir, () => {
      const snapshot = inspectSessionTarget('claude:latest', {
        cwd: process.cwd(),
        stateStore
      });

      assert.strictEqual(snapshot.adapterId, 'claude-history');
      assert.strictEqual(stateStore.sessions.persisted.length, 1);
      assert.strictEqual(stateStore.sessions.persisted[0].snapshot.adapterId, 'claude-history');
      assert.strictEqual(stateStore.sessions.persisted[0].metadata.sessionId, snapshot.session.id);
    });
  } finally {
    fs.rmSync(homeDir, { recursive: true, force: true });
  }
});

test('adapter registry lists adapter metadata and target types', () => {
  const registry = createAdapterRegistry();
  const adapters = registry.listAdapters();
  const ids = adapters.map(adapter => adapter.id);

  assert.ok(ids.includes('claude-history'));
  assert.ok(ids.includes('dmux-tmux'));
  assert.ok(
    adapters.some(adapter => adapter.id === 'claude-history' && adapter.targetTypes.includes('claude-history')),
    'claude-history should advertise its canonical target type'
  );
  assert.ok(
    adapters.some(adapter => adapter.id === 'dmux-tmux' && adapter.targetTypes.includes('plan')),
    'dmux-tmux should advertise plan targets'
  );
});

test('canonical snapshot validation rejects malformed required fields', () => {
  const invalidCases = [
    [null, /must be an object/],
    [canonicalSnapshot({ schemaVersion: 'ecc.session.v0' }), /Unsupported canonical session schema version/],
    [canonicalSnapshot({ adapterId: '' }), /adapterId/],
    [canonicalSnapshot({ session: { id: '' } }), /session.id/],
    [canonicalSnapshot({ session: { repoRoot: 42 } }), /session.repoRoot/],
    [canonicalSnapshot({ sourceTarget: { type: '' } }), /session.sourceTarget.type/],
    [(() => {
      const snapshot = canonicalSnapshot();
      snapshot.workers = [null];
      snapshot.aggregates = { workerCount: 1, states: { unknown: 1 }, healths: { unknown: 1 } };
      return snapshot;
    })(), /workers\[0\] to be an object/],
    [canonicalSnapshot({
      workers: [{
        ...canonicalSnapshot().workers[0],
        branch: 7
      }]
    }), /workers\[0\].branch/],
    [canonicalSnapshot({
      workers: [{
        ...canonicalSnapshot().workers[0],
        runtime: {
          ...canonicalSnapshot().workers[0].runtime,
          command: 123
        }
      }]
    }), /workers\[0\].runtime.command/],
    [canonicalSnapshot({
      workers: [{
        ...canonicalSnapshot().workers[0],
        runtime: {
          ...canonicalSnapshot().workers[0].runtime,
          active: 'yes'
        }
      }]
    }), /workers\[0\].runtime.active/],
    [canonicalSnapshot({
      workers: [{
        ...canonicalSnapshot().workers[0],
        intent: {
          objective: 'ok',
          seedPaths: ['README.md', 123]
        }
      }]
    }), /workers\[0\].intent.seedPaths/],
    [canonicalSnapshot({
      workers: [{
        ...canonicalSnapshot().workers[0],
        outputs: {
          summary: [],
          validation: 'nope',
          remainingRisks: []
        }
      }]
    }), /workers\[0\].outputs.validation/],
    [canonicalSnapshot({ aggregates: { workerCount: 99 } }), /aggregates.workerCount to match/],
    [canonicalSnapshot({ aggregates: { states: [] } }), /aggregates.states to be an object/],
    [canonicalSnapshot({ aggregates: { states: { running: -1 } } }), /aggregates.states.running/],
    [canonicalSnapshot({ aggregates: { healths: null } }), /aggregates.healths to be an object/]
  ];

  for (const [snapshot, pattern] of invalidCases) {
    assert.throws(() => validateCanonicalSnapshot(snapshot), pattern);
  }
});

function dmuxWorker(workerSlug, status = {}, overrides = {}) {
  return {
    workerSlug,
    workerDir: `/tmp/${workerSlug}`,
    status: {
      state: 'running',
      updated: new Date().toISOString(),
      branch: null,
      worktree: null,
      ...status
    },
    task: {
      objective: `${workerSlug} objective`,
      seedPaths: ['README.md'],
      ...(overrides.task || {})
    },
    handoff: {
      summary: ['summary'],
      validation: ['validation'],
      remainingRisks: ['risk'],
      ...(overrides.handoff || {})
    },
    files: {
      status: `/tmp/${workerSlug}/status.md`,
      task: `/tmp/${workerSlug}/task.md`,
      handoff: `/tmp/${workerSlug}/handoff.md`,
      ...(overrides.files || {})
    },
    pane: Object.prototype.hasOwnProperty.call(overrides, 'pane')
      ? overrides.pane
      : {
          currentCommand: 'codex',
          pid: 123,
          active: true,
          dead: false
        }
  };
}

function dmuxSnapshot(overrides = {}) {
  return {
    sessionName: 'edge-session',
    repoRoot: '/tmp/repo',
    sessionActive: false,
    workerStates: {},
    workerCount: 0,
    workers: [],
    ...overrides
  };
}

test('dmux normalization covers missing failed idle and stale worker states', () => {
  const sourceTarget = { type: 'session', value: 'edge-session' };

  const missing = normalizeDmuxSnapshot(dmuxSnapshot(), sourceTarget);
  assert.strictEqual(missing.session.state, 'missing');
  assert.strictEqual(missing.aggregates.workerCount, 0);

  const failed = normalizeDmuxSnapshot(dmuxSnapshot({
    workerStates: { failed: 1 },
    workerCount: 1,
    workers: [
      dmuxWorker('failure', { state: 'failed' }, { pane: null })
    ]
  }), sourceTarget);
  assert.strictEqual(failed.session.state, 'failed');
  assert.strictEqual(failed.workers[0].health, 'degraded');
  assert.strictEqual(failed.workers[0].runtime.active, false);
  assert.strictEqual(failed.workers[0].runtime.dead, false);

  const idle = normalizeDmuxSnapshot(dmuxSnapshot({
    workerStates: { running: 1, queued: 1 },
    workerCount: 2,
    workers: [
      dmuxWorker('missing-update', { state: 'running', updated: undefined }),
      dmuxWorker('stale-update', { state: 'active', updated: '2001-01-01T00:00:00Z' }),
      dmuxWorker('dead-pane', { state: 'running' }, { pane: { dead: true, active: false } }),
      dmuxWorker('mystery', { state: 'queued' }, {
        task: { seedPaths: 'not-array' },
        handoff: { summary: 'not-array', validation: null, remainingRisks: undefined },
        pane: null
      })
    ]
  }), sourceTarget);

  assert.strictEqual(idle.session.state, 'idle');
  assert.deepStrictEqual(
    idle.workers.map(worker => worker.health),
    ['stale', 'stale', 'degraded', 'unknown']
  );
  assert.deepStrictEqual(idle.workers[3].intent.seedPaths, []);
  assert.deepStrictEqual(idle.workers[3].outputs.summary, []);

  const completed = normalizeDmuxSnapshot(dmuxSnapshot({
    workerStates: null,
    workerCount: 2,
    workers: [
      dmuxWorker('done-a', { state: 'done' }),
      dmuxWorker('done-b', { state: 'success' })
    ]
  }), sourceTarget);
  assert.strictEqual(completed.session.state, 'completed');
  assert.deepStrictEqual(completed.workers.map(worker => worker.health), ['healthy', 'healthy']);
});

test('claude history normalization falls back to filename ids and empty metadata defaults', () => {
  const snapshot = normalizeClaudeHistorySession({
    shortId: 'no-id',
    filename: '2026-03-13-no-id-session.tmp',
    sessionPath: '/tmp/2026-03-13-no-id-session.tmp',
    metadata: {
      title: '',
      completed: 'not-array',
      inProgress: ['Resume from filename fallback'],
      context: '',
      notes: ''
    }
  }, {
    type: 'claude-history',
    value: 'latest'
  });

  assert.strictEqual(snapshot.session.id, '2026-03-13-no-id-session');
  assert.strictEqual(snapshot.workers[0].id, '2026-03-13-no-id-session');
  assert.strictEqual(snapshot.workers[0].label, '2026-03-13-no-id-session.tmp');
  assert.strictEqual(snapshot.workers[0].intent.objective, 'Resume from filename fallback');
  assert.deepStrictEqual(snapshot.workers[0].intent.seedPaths, []);
  assert.deepStrictEqual(snapshot.workers[0].outputs.summary, []);
  assert.deepStrictEqual(snapshot.workers[0].outputs.remainingRisks, []);

  const pathOnly = normalizeClaudeHistorySession({
    sessionPath: '/tmp/path-only-session.tmp',
    metadata: {
      title: 'Path Only',
      inProgress: ['Continue work'],
      context: ' README.md \n\n scripts/ecc.js ',
      notes: 'No risks'
    }
  }, {
    type: 'claude-history',
    value: '/tmp/path-only-session.tmp'
  });

  assert.strictEqual(pathOnly.session.id, 'path-only-session');
  assert.strictEqual(pathOnly.workers[0].intent.objective, 'Continue work');
  assert.deepStrictEqual(pathOnly.workers[0].intent.seedPaths, ['README.md', 'scripts/ecc.js']);
  assert.deepStrictEqual(pathOnly.workers[0].outputs.remainingRisks, ['No risks']);
});

test('fallback recordings sanitize paths, use env dirs, and preserve changed history', () => {
  const recordingDir = fs.mkdtempSync(path.join(os.tmpdir(), 'ecc-session-recordings-env-'));
  const previousRecordingDir = process.env.ECC_SESSION_RECORDING_DIR;

  try {
    process.env.ECC_SESSION_RECORDING_DIR = recordingDir;
    const first = canonicalSnapshot({
      adapterId: 'adapter with spaces',
      session: { id: 'session id/with:chars' }
    });
    const recordingPath = getFallbackSessionRecordingPath(first);
    assert.ok(recordingPath.includes(`${path.sep}adapter_with_spaces${path.sep}`));
    assert.ok(recordingPath.endsWith(`${path.sep}session_id_with_chars.json`));

    fs.mkdirSync(path.dirname(recordingPath), { recursive: true });
    fs.writeFileSync(recordingPath, '{not json', 'utf8');

    const firstPersistence = persistCanonicalSnapshot(first, {
      loadStateStoreImpl: () => null
    });
    const changed = canonicalSnapshot({
      adapterId: 'adapter with spaces',
      session: { id: 'session id/with:chars', state: 'idle' }
    });
    persistCanonicalSnapshot(changed, { loadStateStoreImpl: () => null });
    persistCanonicalSnapshot(changed, { loadStateStoreImpl: () => null });

    const persisted = JSON.parse(fs.readFileSync(recordingPath, 'utf8'));
    assert.strictEqual(firstPersistence.backend, 'json-file');
    assert.strictEqual(firstPersistence.path, recordingPath);
    assert.strictEqual(persisted.schemaVersion, 'ecc.session.recording.v1');
    assert.strictEqual(persisted.latest.session.state, 'idle');
    assert.strictEqual(persisted.history.length, 2);
    assert.strictEqual(persisted.history[0].snapshot.session.state, 'active');
    assert.strictEqual(persisted.history[1].snapshot.session.state, 'idle');
    assert.strictEqual(persisted.createdAt, persisted.history[0].recordedAt);
  } finally {
    if (typeof previousRecordingDir === 'string') {
      process.env.ECC_SESSION_RECORDING_DIR = previousRecordingDir;
    } else {
      delete process.env.ECC_SESSION_RECORDING_DIR;
    }
    fs.rmSync(recordingDir, { recursive: true, force: true });
  }
});

test('persistence supports skip mode, writer variants, and missing state-store fallback', () => {
  const snapshot = canonicalSnapshot();
  const skipped = persistCanonicalSnapshot(snapshot, { persist: false });
  assert.deepStrictEqual(skipped, {
    backend: 'skipped',
    path: null,
    recordedAt: null
  });

  const topLevelStore = {
    calls: [],
    recordCanonicalSessionSnapshot(snapshotArg, metadata) {
      this.calls.push({ snapshot: snapshotArg, metadata });
    }
  };
  const stateStoreResult = persistCanonicalSnapshot(snapshot, { stateStore: topLevelStore });
  assert.strictEqual(stateStoreResult.backend, 'state-store');
  assert.strictEqual(topLevelStore.calls.length, 1);
  assert.strictEqual(topLevelStore.calls[0].metadata.sessionId, 'session-1');

  const nestedStore = {
    sessions: {
      calls: [],
      recordSessionSnapshot(snapshotArg, metadata) {
        this.calls.push({ snapshot: snapshotArg, metadata });
      }
    }
  };
  persistCanonicalSnapshot(snapshot, { stateStore: nestedStore });
  assert.strictEqual(nestedStore.sessions.calls.length, 1);

  const noWriterDir = fs.mkdtempSync(path.join(os.tmpdir(), 'ecc-session-no-writer-'));
  const missingModuleDir = fs.mkdtempSync(path.join(os.tmpdir(), 'ecc-session-missing-module-'));
  try {
    const noWriter = persistCanonicalSnapshot(snapshot, {
      recordingDir: noWriterDir,
      stateStore: { createStateStore() {} }
    });
    assert.strictEqual(noWriter.backend, 'json-file');

    const missingModule = new Error("Cannot find module '../state-store'");
    missingModule.code = 'MODULE_NOT_FOUND';
    const fallback = persistCanonicalSnapshot(snapshot, {
      recordingDir: missingModuleDir,
      loadStateStoreImpl() {
        throw missingModule;
      }
    });
    assert.strictEqual(fallback.backend, 'json-file');
  } finally {
    fs.rmSync(noWriterDir, { recursive: true, force: true });
    fs.rmSync(missingModuleDir, { recursive: true, force: true });
  }
});

test('persistence only falls back when the state-store module is missing', () => {
  const snapshot = {
    schemaVersion: 'ecc.session.v1',
    adapterId: 'claude-history',
    session: {
      id: 'a1b2c3d4',
      kind: 'history',
      state: 'recorded',
      repoRoot: null,
      sourceTarget: {
        type: 'claude-history',
        value: 'latest'
      }
    },
    workers: [{
      id: 'a1b2c3d4',
      label: 'Session Review',
      state: 'recorded',
      health: 'healthy',
      branch: null,
      worktree: null,
      runtime: {
        kind: 'claude-session',
        command: 'claude',
        pid: null,
        active: false,
        dead: true
      },
      intent: {
        objective: 'Session Review',
        seedPaths: []
      },
      outputs: {
        summary: [],
        validation: [],
        remainingRisks: []
      },
      artifacts: {
        sessionFile: '/tmp/session.tmp',
        context: null
      }
    }],
    aggregates: {
      workerCount: 1,
      states: {
        recorded: 1
      },
      healths: {
        healthy: 1
      }
    }
  };

  const loadError = new Error('state-store bootstrap failed');
  loadError.code = 'ERR_STATE_STORE_BOOT';

  assert.throws(() => {
    persistCanonicalSnapshot(snapshot, {
      loadStateStoreImpl() {
        throw loadError;
      }
    });
  }, /state-store bootstrap failed/);
});

console.log(`\n=== Results: ${passed} passed, ${failed} failed ===`);
if (failed > 0) process.exit(1);
