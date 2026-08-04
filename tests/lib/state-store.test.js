/**
 * Tests for the SQLite-backed ECC state store and CLI commands.
 */

const assert = require('assert');
const fs = require('fs');
const os = require('os');
const path = require('path');
const { spawnSync } = require('child_process');

const {
  createStateStore,
  resolveStateStorePath,
} = require('../../scripts/lib/state-store');

const ECC_SCRIPT = path.join(__dirname, '..', '..', 'scripts', 'ecc.js');
const STATUS_SCRIPT = path.join(__dirname, '..', '..', 'scripts', 'status.js');
const SESSIONS_SCRIPT = path.join(__dirname, '..', '..', 'scripts', 'sessions-cli.js');
const WORK_ITEMS_SCRIPT = path.join(__dirname, '..', '..', 'scripts', 'work-items.js');

async function test(name, fn) {
  try {
    await fn();
    console.log(`  \u2713 ${name}`);
    return true;
  } catch (error) {
    console.log(`  \u2717 ${name}`);
    console.log(`    Error: ${error.message}`);
    return false;
  }
}

function createTempDir(prefix) {
  return fs.mkdtempSync(path.join(os.tmpdir(), prefix));
}

function cleanupTempDir(dirPath) {
  fs.rmSync(dirPath, { recursive: true, force: true });
}

function runNode(scriptPath, args = [], options = {}) {
  return spawnSync('node', [scriptPath, ...args], {
    encoding: 'utf8',
    cwd: options.cwd || process.cwd(),
    env: {
      ...process.env,
      ...(options.env || {}),
    },
  });
}

function createGhShim(binDir) {
  fs.mkdirSync(binDir, { recursive: true });
  const shimJs = path.join(binDir, 'gh.js');
  fs.writeFileSync(shimJs, `
const mode = process.env.ECC_FAKE_GH_MODE || 'open';
const args = process.argv.slice(2);
function write(payload) {
  process.stdout.write(JSON.stringify(payload));
}
if (args[0] === 'pr' && args[1] === 'list') {
  if (mode === 'empty') write([]);
  else write([
    {
      number: 3,
      title: 'Conflicting queue cleanup',
      author: { login: 'contributor-a' },
      url: 'https://github.com/affaan-m/everything-claude-code/pull/3',
      updatedAt: '2026-05-11T10:00:00Z',
      mergeStateStatus: 'DIRTY',
      isDraft: false,
      headRefName: 'fix/conflict'
    },
    {
      number: 4,
      title: 'Clean docs update',
      author: { login: 'contributor-b' },
      url: 'https://github.com/affaan-m/everything-claude-code/pull/4',
      updatedAt: '2026-05-11T11:00:00Z',
      mergeStateStatus: 'CLEAN',
      isDraft: false,
      headRefName: 'docs/clean'
    }
  ]);
} else if (args[0] === 'issue' && args[1] === 'list') {
  if (mode === 'empty') write([]);
  else write([
    {
      number: 9,
      title: 'Track release blocker',
      author: { login: 'reporter' },
      url: 'https://github.com/affaan-m/everything-claude-code/issues/9',
      updatedAt: '2026-05-11T12:00:00Z',
      labels: [{ name: 'release' }]
    }
  ]);
} else {
  process.stderr.write('unexpected gh args: ' + args.join(' '));
  process.exit(2);
}
`, 'utf8');
  return shimJs;
}

function parseJson(stdout) {
  return JSON.parse(stdout.trim());
}

async function seedStore(dbPath) {
  const store = await createStateStore({ dbPath });

  store.upsertSession({
    id: 'session-active',
    adapterId: 'dmux-tmux',
    harness: 'claude',
    state: 'active',
    repoRoot: '/tmp/ecc-repo',
    startedAt: '2026-03-15T08:00:00.000Z',
    endedAt: null,
    snapshot: {
      schemaVersion: 'ecc.session.v1',
      adapterId: 'dmux-tmux',
      session: {
        id: 'session-active',
        kind: 'orchestrated',
        state: 'active',
        repoRoot: '/tmp/ecc-repo',
      },
      workers: [
        {
          id: 'worker-1',
          label: 'Worker 1',
          state: 'active',
          branch: 'feat/state-store',
          worktree: '/tmp/ecc-repo/.worktrees/worker-1',
        },
        {
          id: 'worker-2',
          label: 'Worker 2',
          state: 'idle',
          branch: 'feat/state-store',
          worktree: '/tmp/ecc-repo/.worktrees/worker-2',
        },
      ],
      aggregates: {
        workerCount: 2,
        states: {
          active: 1,
          idle: 1,
        },
      },
    },
  });

  store.upsertSession({
    id: 'session-recorded',
    adapterId: 'claude-history',
    harness: 'claude',
    state: 'recorded',
    repoRoot: '/tmp/ecc-repo',
    startedAt: '2026-03-14T18:00:00.000Z',
    endedAt: '2026-03-14T19:00:00.000Z',
    snapshot: {
      schemaVersion: 'ecc.session.v1',
      adapterId: 'claude-history',
      session: {
        id: 'session-recorded',
        kind: 'history',
        state: 'recorded',
        repoRoot: '/tmp/ecc-repo',
      },
      workers: [
        {
          id: 'worker-hist',
          label: 'History Worker',
          state: 'recorded',
          branch: 'main',
          worktree: '/tmp/ecc-repo',
        },
      ],
      aggregates: {
        workerCount: 1,
        states: {
          recorded: 1,
        },
      },
    },
  });

  store.insertSkillRun({
    id: 'skill-run-1',
    skillId: 'tdd-workflow',
    skillVersion: '1.0.0',
    sessionId: 'session-active',
    taskDescription: 'Write store tests',
    outcome: 'success',
    failureReason: null,
    tokensUsed: 1200,
    durationMs: 3500,
    userFeedback: 'useful',
    createdAt: '2026-03-15T08:05:00.000Z',
  });

  store.insertSkillRun({
    id: 'skill-run-2',
    skillId: 'security-review',
    skillVersion: '1.0.0',
    sessionId: 'session-active',
    taskDescription: 'Review state-store design',
    outcome: 'failed',
    failureReason: 'timeout',
    tokensUsed: 800,
    durationMs: 1800,
    userFeedback: null,
    createdAt: '2026-03-15T08:06:00.000Z',
  });

  store.insertSkillRun({
    id: 'skill-run-3',
    skillId: 'code-reviewer',
    skillVersion: '1.0.0',
    sessionId: 'session-recorded',
    taskDescription: 'Inspect CLI formatting',
    outcome: 'success',
    failureReason: null,
    tokensUsed: 500,
    durationMs: 900,
    userFeedback: 'clear',
    createdAt: '2026-03-15T08:07:00.000Z',
  });

  store.insertSkillRun({
    id: 'skill-run-4',
    skillId: 'planner',
    skillVersion: '1.0.0',
    sessionId: 'session-recorded',
    taskDescription: 'Outline ECC 2.0 work',
    outcome: 'unknown',
    failureReason: null,
    tokensUsed: 300,
    durationMs: 500,
    userFeedback: null,
    createdAt: '2026-03-15T08:08:00.000Z',
  });

  store.upsertSkillVersion({
    skillId: 'tdd-workflow',
    version: '1.0.0',
    contentHash: 'abc123',
    amendmentReason: 'initial',
    promotedAt: '2026-03-10T00:00:00.000Z',
    rolledBackAt: null,
  });

  store.insertDecision({
    id: 'decision-1',
    sessionId: 'session-active',
    title: 'Use SQLite for durable state',
    rationale: 'Need queryable local state for ECC control plane',
    alternatives: ['json-files', 'memory-only'],
    supersedes: null,
    status: 'active',
    createdAt: '2026-03-15T08:09:00.000Z',
  });

  store.upsertInstallState({
    targetId: 'claude-home',
    targetRoot: '/tmp/home/.claude',
    profile: 'developer',
    modules: ['rules-core', 'orchestration'],
    operations: [
      {
        kind: 'copy-file',
        destinationPath: '/tmp/home/.claude/agents/planner.md',
      },
    ],
    installedAt: '2026-03-15T07:00:00.000Z',
    sourceVersion: '1.8.0',
  });

  store.insertGovernanceEvent({
    id: 'gov-1',
    sessionId: 'session-active',
    eventType: 'policy-review-required',
    payload: {
      severity: 'warning',
      owner: 'security-reviewer',
    },
    resolvedAt: null,
    resolution: null,
    createdAt: '2026-03-15T08:10:00.000Z',
  });

  store.insertGovernanceEvent({
    id: 'gov-2',
    sessionId: 'session-recorded',
    eventType: 'decision-accepted',
    payload: {
      severity: 'info',
    },
    resolvedAt: '2026-03-15T08:11:00.000Z',
    resolution: 'accepted',
    createdAt: '2026-03-15T08:09:30.000Z',
  });

  store.close();
}

async function runTests() {
  console.log('\n=== Testing state-store ===\n');

  let passed = 0;
  let failed = 0;

  if (await test('creates the default state.db path and applies migrations idempotently', async () => {
    const homeDir = createTempDir('ecc-state-home-');

    try {
      const expectedPath = path.join(homeDir, '.claude', 'ecc', 'state.db');
      assert.strictEqual(resolveStateStorePath({ homeDir }), expectedPath);

      const firstStore = await createStateStore({ homeDir });
      const firstMigrations = firstStore.getAppliedMigrations();
      firstStore.close();

      assert.strictEqual(firstMigrations.length, 2);
      assert.strictEqual(firstMigrations[0].version, 1);
      assert.strictEqual(firstMigrations[1].version, 2);
      assert.ok(fs.existsSync(expectedPath));

      const secondStore = await createStateStore({ homeDir });
      const secondMigrations = secondStore.getAppliedMigrations();
      secondStore.close();

      assert.strictEqual(secondMigrations.length, 2);
      assert.strictEqual(secondMigrations[0].version, 1);
    } finally {
      cleanupTempDir(homeDir);
    }
  })) passed += 1; else failed += 1;

  if (await test('preserves SQLite special database names like :memory:', async () => {
    const tempDir = createTempDir('ecc-state-memory-');
    const previousCwd = process.cwd();

    try {
      process.chdir(tempDir);
      assert.strictEqual(resolveStateStorePath({ dbPath: ':memory:' }), ':memory:');

      const store = await createStateStore({ dbPath: ':memory:' });
      assert.strictEqual(store.dbPath, ':memory:');
      assert.strictEqual(store.getAppliedMigrations().length, 2);
      store.close();

      assert.ok(!fs.existsSync(path.join(tempDir, ':memory:')));
    } finally {
      process.chdir(previousCwd);
      cleanupTempDir(tempDir);
    }
  })) passed += 1; else failed += 1;

  if (await test('stores sessions and returns detailed session views with workers, skill runs, and decisions', async () => {
    const testDir = createTempDir('ecc-state-db-');
    const dbPath = path.join(testDir, 'state.db');

    try {
      await seedStore(dbPath);

      const store = await createStateStore({ dbPath });
      const listResult = store.listRecentSessions({ limit: 10 });
      const detail = store.getSessionDetail('session-active');
      store.close();

      assert.strictEqual(listResult.totalCount, 2);
      assert.strictEqual(listResult.sessions[0].id, 'session-active');
      assert.strictEqual(detail.session.id, 'session-active');
      assert.strictEqual(detail.workers.length, 2);
      assert.strictEqual(detail.skillRuns.length, 2);
      assert.strictEqual(detail.decisions.length, 1);
      assert.deepStrictEqual(detail.decisions[0].alternatives, ['json-files', 'memory-only']);
    } finally {
      cleanupTempDir(testDir);
    }
  })) passed += 1; else failed += 1;

  if (await test('builds a status snapshot with active sessions, skill rates, install health, and pending governance', async () => {
    const testDir = createTempDir('ecc-state-db-');
    const dbPath = path.join(testDir, 'state.db');

    try {
      await seedStore(dbPath);

      const store = await createStateStore({ dbPath });
      const status = store.getStatus();
      store.close();

      assert.strictEqual(status.readiness.status, 'attention');
      assert.strictEqual(status.readiness.attentionCount, 2);
      assert.strictEqual(status.readiness.activeSessions, 1);
      assert.strictEqual(status.readiness.failedSkillRuns, 1);
      assert.strictEqual(status.readiness.warningInstallations, 0);
      assert.strictEqual(status.readiness.pendingGovernanceEvents, 1);
      assert.strictEqual(status.readiness.blockedWorkItems, 0);
      assert.strictEqual(status.activeSessions.activeCount, 1);
      assert.strictEqual(status.activeSessions.sessions[0].id, 'session-active');
      assert.strictEqual(status.skillRuns.summary.totalCount, 4);
      assert.strictEqual(status.skillRuns.summary.successCount, 2);
      assert.strictEqual(status.skillRuns.summary.failureCount, 1);
      assert.strictEqual(status.skillRuns.summary.unknownCount, 1);
      assert.strictEqual(status.installHealth.status, 'healthy');
      assert.strictEqual(status.installHealth.totalCount, 1);
      assert.strictEqual(status.governance.pendingCount, 1);
      assert.strictEqual(status.governance.events[0].id, 'gov-1');
      assert.strictEqual(status.workItems.openCount, 0);
    } finally {
      cleanupTempDir(testDir);
    }
  })) passed += 1; else failed += 1;

  if (await test('builds an empty status snapshot with null rates and missing install health', async () => {
    const testDir = createTempDir('ecc-state-empty-');
    const dbPath = path.join(testDir, 'state.db');

    try {
      const store = await createStateStore({ dbPath });
      const status = store.getStatus({ activeLimit: 1, recentSkillRunLimit: 1, pendingLimit: 1 });
      const missingDetail = store.getSessionDetail('missing-session');
      store.close();

      assert.strictEqual(missingDetail, null);
      assert.strictEqual(status.readiness.status, 'ok');
      assert.strictEqual(status.readiness.attentionCount, 0);
      assert.strictEqual(status.readiness.activeSessions, 0);
      assert.strictEqual(status.activeSessions.activeCount, 0);
      assert.deepStrictEqual(status.activeSessions.sessions, []);
      assert.strictEqual(status.skillRuns.summary.totalCount, 0);
      assert.strictEqual(status.skillRuns.summary.knownCount, 0);
      assert.strictEqual(status.skillRuns.summary.successRate, null);
      assert.strictEqual(status.skillRuns.summary.failureRate, null);
      assert.strictEqual(status.installHealth.status, 'missing');
      assert.strictEqual(status.installHealth.totalCount, 0);
      assert.deepStrictEqual(status.installHealth.installations, []);
      assert.strictEqual(status.governance.pendingCount, 0);
      assert.deepStrictEqual(status.governance.events, []);
      assert.strictEqual(status.workItems.totalCount, 0);
      assert.deepStrictEqual(status.workItems.items, []);
    } finally {
      cleanupTempDir(testDir);
    }
  })) passed += 1; else failed += 1;

  if (await test('tracks linked work items for Linear, GitHub, and handoff progress', async () => {
    const testDir = createTempDir('ecc-state-work-items-');
    const dbPath = path.join(testDir, 'state.db');

    try {
      await seedStore(dbPath);

      const store = await createStateStore({ dbPath });
      const linearItem = store.upsertWorkItem({
        id: 'linear-ecc-20-control-plane',
        source: 'linear',
        sourceId: 'ECC-20',
        title: 'Define harness-neutral session/worktree contract',
        status: 'in-progress',
        priority: 'high',
        url: 'https://linear.app/ecctools/issue/ECC-20',
        owner: 'control-plane',
        repoRoot: '/tmp/ecc-repo',
        sessionId: 'session-active',
        metadata: {
          project: 'ECC 2.0: Control Plane',
        },
        createdAt: '2026-03-15T08:12:00.000Z',
        updatedAt: '2026-03-15T08:15:00.000Z',
      });

      store.upsertWorkItem({
        id: 'handoff-release-gate',
        source: 'handoff',
        sourceId: 'ecc-rc1-release-decision-20260511.md',
        title: 'Rerun rc.1 release gate before tag',
        status: 'blocked',
        priority: 'high',
        owner: 'release',
        repoRoot: '/tmp/ecc-repo',
        metadata: {
          blocker: 'tag decision pending',
        },
        createdAt: '2026-03-15T08:13:00.000Z',
        updatedAt: '2026-03-15T08:16:00.000Z',
      });

      store.upsertWorkItem({
        id: 'github-pr-1738',
        source: 'github',
        sourceId: '1738',
        title: 'Add Qwen install target',
        status: 'merged',
        priority: 'normal',
        url: 'https://github.com/affaan-m/everything-claude-code/pull/1738',
        owner: 'maintainer',
        createdAt: '2026-03-15T08:14:00.000Z',
        updatedAt: '2026-03-15T08:17:00.000Z',
      });

      const status = store.getStatus();
      store.close();

      assert.strictEqual(linearItem.id, 'linear-ecc-20-control-plane');
      assert.strictEqual(linearItem.metadata.project, 'ECC 2.0: Control Plane');
      assert.strictEqual(status.workItems.totalCount, 3);
      assert.strictEqual(status.workItems.openCount, 2);
      assert.strictEqual(status.workItems.blockedCount, 1);
      assert.strictEqual(status.workItems.closedCount, 1);
      assert.strictEqual(status.readiness.blockedWorkItems, 1);
      assert.strictEqual(status.readiness.attentionCount, 3);
      assert.strictEqual(status.workItems.items[0].id, 'github-pr-1738');
    } finally {
      cleanupTempDir(testDir);
    }
  })) passed += 1; else failed += 1;

  if (await test('normalizes default optional fields and reports warning install health', async () => {
    const testDir = createTempDir('ecc-state-defaults-');
    const dbPath = path.join(testDir, 'state.db');

    try {
      const store = await createStateStore({ dbPath });
      const session = store.upsertSession({
        id: 'session-defaults',
        adapterId: 'manual',
        harness: 'codex',
        state: 'running',
      });

      store.insertSkillRun({
        id: 'skill-run-defaults',
        skillId: 'planner',
        skillVersion: '1.0.0',
        sessionId: 'session-defaults',
        taskDescription: 'Exercise defaults',
        outcome: 'passed',
      });

      const version = store.upsertSkillVersion({
        skillId: 'planner',
        version: '1.0.0',
        contentHash: 'hash-defaults',
      });

      store.insertDecision({
        id: 'decision-defaults',
        sessionId: 'session-defaults',
        title: 'Use defaults',
        rationale: 'Optional decision fields should normalize',
        status: 'active',
      });

      const installState = store.upsertInstallState({
        targetId: 'claude-project',
        targetRoot: path.join(testDir, '.claude'),
      });

      store.insertGovernanceEvent({
        id: 'gov-defaults',
        eventType: 'manual-review',
      });

      const detail = store.getSessionDetail('session-defaults');
      const status = store.getStatus();
      store.close();

      assert.strictEqual(session.repoRoot, null);
      assert.strictEqual(session.startedAt, null);
      assert.strictEqual(session.endedAt, null);
      assert.deepStrictEqual(session.snapshot, {});
      assert.strictEqual(session.workerCount, 0);

      assert.strictEqual(version.amendmentReason, null);
      assert.strictEqual(version.promotedAt, null);
      assert.strictEqual(version.rolledBackAt, null);

      assert.deepStrictEqual(detail.workers, []);
      assert.strictEqual(detail.skillRuns[0].failureReason, null);
      assert.strictEqual(detail.skillRuns[0].tokensUsed, null);
      assert.strictEqual(detail.skillRuns[0].durationMs, null);
      assert.strictEqual(detail.skillRuns[0].userFeedback, null);
      assert.deepStrictEqual(detail.decisions[0].alternatives, []);
      assert.strictEqual(detail.decisions[0].supersedes, null);

      assert.strictEqual(installState.profile, null);
      assert.deepStrictEqual(installState.modules, []);
      assert.deepStrictEqual(installState.operations, []);
      assert.strictEqual(installState.sourceVersion, null);

      assert.strictEqual(status.activeSessions.activeCount, 1);
      assert.strictEqual(status.skillRuns.summary.successRate, 100);
      assert.strictEqual(status.installHealth.status, 'warning');
      assert.strictEqual(status.installHealth.warningCount, 1);
      assert.strictEqual(status.installHealth.installations[0].status, 'warning');
      assert.strictEqual(status.governance.pendingCount, 1);
      assert.strictEqual(status.governance.events[0].payload, null);
      assert.strictEqual(status.governance.events[0].sessionId, null);
      assert.strictEqual(status.governance.events[0].resolution, null);
    } finally {
      cleanupTempDir(testDir);
    }
  })) passed += 1; else failed += 1;

  if (await test('validates entity payloads before writing to the database', async () => {
    const testDir = createTempDir('ecc-state-db-');
    const dbPath = path.join(testDir, 'state.db');

    try {
      const store = await createStateStore({ dbPath });
      assert.throws(() => {
        store.upsertSession({
          id: '',
          adapterId: 'dmux-tmux',
          harness: 'claude',
          state: 'active',
          repoRoot: '/tmp/repo',
          startedAt: '2026-03-15T08:00:00.000Z',
          endedAt: null,
          snapshot: {},
        });
      }, /Invalid session/);

      assert.throws(() => {
        store.insertDecision({
          id: 'decision-invalid',
          sessionId: 'missing-session',
          title: 'Reject non-array alternatives',
          rationale: 'alternatives must be an array',
          alternatives: { unexpected: true },
          supersedes: null,
          status: 'active',
          createdAt: '2026-03-15T08:15:00.000Z',
        });
      }, /Invalid decision/);

      assert.throws(() => {
        store.upsertInstallState({
          targetId: 'claude-home',
          targetRoot: '/tmp/home/.claude',
          profile: 'developer',
          modules: 'rules-core',
          operations: [],
          installedAt: '2026-03-15T07:00:00.000Z',
          sourceVersion: '1.8.0',
        });
      }, /Invalid installState/);

      store.close();
    } finally {
      cleanupTempDir(testDir);
    }
  })) passed += 1; else failed += 1;

  if (await test('rejects invalid limits and unserializable JSON payloads', async () => {
    const testDir = createTempDir('ecc-state-errors-');
    const dbPath = path.join(testDir, 'state.db');

    try {
      const store = await createStateStore({ dbPath });
      const circularSnapshot = {};
      circularSnapshot.self = circularSnapshot;

      assert.throws(
        () => store.listRecentSessions({ limit: 0 }),
        /Invalid limit: 0/
      );
      assert.throws(
        () => store.getStatus({ activeLimit: 'many' }),
        /Invalid limit: many/
      );
      assert.throws(
        () => store.upsertSession({
          id: 'session-circular',
          adapterId: 'manual',
          harness: 'codex',
          state: 'active',
          snapshot: circularSnapshot,
        }),
        /Failed to serialize session\.snapshot/
      );

      store.close();
    } finally {
      cleanupTempDir(testDir);
    }
  })) passed += 1; else failed += 1;

  if (await test('status CLI supports human-readable and --json output', async () => {
    const testDir = createTempDir('ecc-state-cli-');
    const dbPath = path.join(testDir, 'state.db');

    try {
      await seedStore(dbPath);

      const jsonResult = runNode(STATUS_SCRIPT, ['--db', dbPath, '--json']);
      assert.strictEqual(jsonResult.status, 0, jsonResult.stderr);
      const jsonPayload = parseJson(jsonResult.stdout);
      assert.strictEqual(jsonPayload.readiness.status, 'attention');
      assert.strictEqual(jsonPayload.readiness.attentionCount, 2);
      assert.strictEqual(jsonPayload.activeSessions.activeCount, 1);
      assert.strictEqual(jsonPayload.governance.pendingCount, 1);

      const humanResult = runNode(STATUS_SCRIPT, ['--db', dbPath]);
      assert.strictEqual(humanResult.status, 0, humanResult.stderr);
      assert.match(humanResult.stdout, /Readiness: attention/);
      assert.match(humanResult.stdout, /Attention items: 2/);
      assert.match(humanResult.stdout, /Active sessions: 1/);
      assert.match(humanResult.stdout, /Skill runs \(last 20\):/);
      assert.match(humanResult.stdout, /Install health: healthy/);
      assert.match(humanResult.stdout, /Pending governance events: 1/);
    } finally {
      cleanupTempDir(testDir);
    }
  })) passed += 1; else failed += 1;

  if (await test('status CLI --exit-code reports attention without suppressing output', async () => {
    const attentionDir = createTempDir('ecc-state-attention-');
    const okDir = createTempDir('ecc-state-ok-');
    const attentionDbPath = path.join(attentionDir, 'state.db');
    const okDbPath = path.join(okDir, 'state.db');

    try {
      await seedStore(attentionDbPath);

      const attentionResult = runNode(STATUS_SCRIPT, ['--db', attentionDbPath, '--json', '--exit-code']);
      assert.strictEqual(attentionResult.status, 2, attentionResult.stderr);
      const attentionPayload = parseJson(attentionResult.stdout);
      assert.strictEqual(attentionPayload.readiness.status, 'attention');
      assert.strictEqual(attentionPayload.readiness.attentionCount, 2);

      const okStore = await createStateStore({ dbPath: okDbPath });
      okStore.close();

      const okResult = runNode(STATUS_SCRIPT, ['--db', okDbPath, '--json', '--exit-code']);
      assert.strictEqual(okResult.status, 0, okResult.stderr);
      const okPayload = parseJson(okResult.stdout);
      assert.strictEqual(okPayload.readiness.status, 'ok');
    } finally {
      cleanupTempDir(attentionDir);
      cleanupTempDir(okDir);
    }
  })) passed += 1; else failed += 1;

  if (await test('status CLI can emit and write markdown operator snapshots', async () => {
    const testDir = createTempDir('ecc-state-cli-');
    const dbPath = path.join(testDir, 'state.db');
    const outputPath = path.join(testDir, 'status.md');

    try {
      await seedStore(dbPath);

      const result = runNode(STATUS_SCRIPT, ['--db', dbPath, '--markdown', '--write', outputPath]);
      assert.strictEqual(result.status, 0, result.stderr);
      assert.ok(fs.existsSync(outputPath));

      const written = fs.readFileSync(outputPath, 'utf8');
      assert.strictEqual(result.stdout, written);
      assert.match(written, /^# ECC Status/m);
      assert.match(written, /Database: `[^`]+state\.db`/);
      assert.match(written, /## Readiness/);
      assert.match(written, /Status: attention/);
      assert.match(written, /Attention items: 2/);
      assert.match(written, /Blocked work items: 0/);
      assert.match(written, /- `session-active` \[claude\/dmux-tmux\] active/);
      assert.match(written, /Success rate: 66\.7%/);
      assert.match(written, /Install health: healthy/);
      assert.match(written, /Pending governance events: 1/);
      assert.match(written, /## Work Items/);
      assert.match(written, /Open: 0/);
    } finally {
      cleanupTempDir(testDir);
    }
  })) passed += 1; else failed += 1;

  if (await test('work-items CLI supports upsert, list, show, and close', async () => {
    const testDir = createTempDir('ecc-work-items-cli-');
    const dbPath = path.join(testDir, 'state.db');

    try {
      const upsertResult = runNode(WORK_ITEMS_SCRIPT, [
        'upsert',
        'linear-ecc-99',
        '--db',
        dbPath,
        '--source',
        'linear',
        '--source-id',
        'ECC-99',
        '--title',
        'Ship work item CLI',
        '--status',
        'blocked',
        '--priority',
        'high',
        '--url',
        'https://linear.app/example/issue/ECC-99',
        '--owner',
        'control-plane',
        '--metadata-json',
        '{"project":"ECC 2.0"}',
        '--json',
      ], { cwd: testDir });
      assert.strictEqual(upsertResult.status, 0, upsertResult.stderr);
      const upsertPayload = parseJson(upsertResult.stdout);
      assert.strictEqual(upsertPayload.id, 'linear-ecc-99');
      assert.strictEqual(upsertPayload.status, 'blocked');
      assert.strictEqual(upsertPayload.repoRoot, fs.realpathSync(testDir));
      assert.strictEqual(upsertPayload.metadata.project, 'ECC 2.0');

      const updateResult = runNode(WORK_ITEMS_SCRIPT, [
        'upsert',
        'linear-ecc-99',
        '--db',
        dbPath,
        '--status',
        'in-progress',
        '--json',
      ]);
      assert.strictEqual(updateResult.status, 0, updateResult.stderr);
      const updatePayload = parseJson(updateResult.stdout);
      assert.strictEqual(updatePayload.title, 'Ship work item CLI');
      assert.strictEqual(updatePayload.source, 'linear');
      assert.strictEqual(updatePayload.status, 'in-progress');

      const listResult = runNode(WORK_ITEMS_SCRIPT, ['list', '--db', dbPath, '--json']);
      assert.strictEqual(listResult.status, 0, listResult.stderr);
      const listPayload = parseJson(listResult.stdout);
      assert.strictEqual(listPayload.totalCount, 1);
      assert.strictEqual(listPayload.items[0].id, 'linear-ecc-99');

      const showResult = runNode(WORK_ITEMS_SCRIPT, ['show', 'linear-ecc-99', '--db', dbPath]);
      assert.strictEqual(showResult.status, 0, showResult.stderr);
      assert.match(showResult.stdout, /linear\/#ECC-99 in-progress: Ship work item CLI/);

      const closeResult = runNode(WORK_ITEMS_SCRIPT, ['close', 'linear-ecc-99', '--db', dbPath, '--json']);
      assert.strictEqual(closeResult.status, 0, closeResult.stderr);
      const closePayload = parseJson(closeResult.stdout);
      assert.strictEqual(closePayload.status, 'done');
      assert.strictEqual(closePayload.title, 'Ship work item CLI');
    } finally {
      cleanupTempDir(testDir);
    }
  })) passed += 1; else failed += 1;

  if (await test('work-items CLI syncs GitHub PRs and issues into readiness', async () => {
    const testDir = createTempDir('ecc-work-items-github-');
    const dbPath = path.join(testDir, 'state.db');
    const binDir = path.join(testDir, 'bin');
    const repo = 'affaan-m/everything-claude-code';

    try {
      const env = {
        ECC_GH_SHIM: createGhShim(binDir),
      };

      const syncResult = runNode(WORK_ITEMS_SCRIPT, [
        'sync-github',
        '--repo',
        repo,
        '--db',
        dbPath,
        '--limit',
        '10',
        '--json',
      ], { cwd: testDir, env });
      assert.strictEqual(syncResult.status, 0, syncResult.stderr);
      const syncPayload = parseJson(syncResult.stdout);
      assert.strictEqual(syncPayload.repo, repo);
      assert.strictEqual(syncPayload.prCount, 2);
      assert.strictEqual(syncPayload.issueCount, 1);
      assert.strictEqual(syncPayload.closedCount, 0);
      assert.strictEqual(syncPayload.items.length, 3);
      assert.strictEqual(syncPayload.items[0].id, 'github-affaan-m-everything-claude-code-pr-3');
      assert.strictEqual(syncPayload.items[0].status, 'blocked');
      assert.strictEqual(syncPayload.items[1].status, 'needs-review');
      assert.strictEqual(syncPayload.items[2].metadata.labels[0], 'release');

      const statusResult = runNode(STATUS_SCRIPT, ['--db', dbPath, '--json', '--exit-code']);
      assert.strictEqual(statusResult.status, 2, statusResult.stderr);
      const statusPayload = parseJson(statusResult.stdout);
      assert.strictEqual(statusPayload.readiness.blockedWorkItems, 3);

      const closeResult = runNode(WORK_ITEMS_SCRIPT, [
        'sync-github',
        '--repo',
        repo,
        '--db',
        dbPath,
        '--json',
      ], {
        cwd: testDir,
        env: {
          ...env,
          ECC_FAKE_GH_MODE: 'empty',
        },
      });
      assert.strictEqual(closeResult.status, 0, closeResult.stderr);
      const closePayload = parseJson(closeResult.stdout);
      assert.strictEqual(closePayload.prCount, 0);
      assert.strictEqual(closePayload.issueCount, 0);
      assert.strictEqual(closePayload.closedCount, 3);
      assert.ok(closePayload.closedItems.every(item => item.status === 'closed'));

      const cleanStatusResult = runNode(STATUS_SCRIPT, ['--db', dbPath, '--json', '--exit-code']);
      assert.strictEqual(cleanStatusResult.status, 0, cleanStatusResult.stderr);
      const cleanStatusPayload = parseJson(cleanStatusResult.stdout);
      assert.strictEqual(cleanStatusPayload.readiness.blockedWorkItems, 0);
      assert.strictEqual(cleanStatusPayload.workItems.closedCount, 3);
    } finally {
      cleanupTempDir(testDir);
    }
  })) passed += 1; else failed += 1;

  if (await test('sessions CLI supports list and detail views in human-readable and --json output', async () => {
    const testDir = createTempDir('ecc-state-cli-');
    const dbPath = path.join(testDir, 'state.db');

    try {
      await seedStore(dbPath);

      const listJsonResult = runNode(SESSIONS_SCRIPT, ['--db', dbPath, '--json']);
      assert.strictEqual(listJsonResult.status, 0, listJsonResult.stderr);
      const listPayload = parseJson(listJsonResult.stdout);
      assert.strictEqual(listPayload.totalCount, 2);
      assert.strictEqual(listPayload.sessions[0].id, 'session-active');

      const detailJsonResult = runNode(SESSIONS_SCRIPT, ['session-active', '--db', dbPath, '--json']);
      assert.strictEqual(detailJsonResult.status, 0, detailJsonResult.stderr);
      const detailPayload = parseJson(detailJsonResult.stdout);
      assert.strictEqual(detailPayload.session.id, 'session-active');
      assert.strictEqual(detailPayload.workers.length, 2);
      assert.strictEqual(detailPayload.skillRuns.length, 2);
      assert.strictEqual(detailPayload.decisions.length, 1);

      const detailHumanResult = runNode(SESSIONS_SCRIPT, ['session-active', '--db', dbPath]);
      assert.strictEqual(detailHumanResult.status, 0, detailHumanResult.stderr);
      assert.match(detailHumanResult.stdout, /Session: session-active/);
      assert.match(detailHumanResult.stdout, /Workers: 2/);
      assert.match(detailHumanResult.stdout, /Skill runs: 2/);
      assert.match(detailHumanResult.stdout, /Decisions: 1/);
    } finally {
      cleanupTempDir(testDir);
    }
  })) passed += 1; else failed += 1;

  if (await test('ecc CLI delegates the new status, sessions, and work-items subcommands', async () => {
    const testDir = createTempDir('ecc-state-cli-');
    const dbPath = path.join(testDir, 'state.db');

    try {
      await seedStore(dbPath);

      const statusResult = runNode(ECC_SCRIPT, ['status', '--db', dbPath, '--json']);
      assert.strictEqual(statusResult.status, 0, statusResult.stderr);
      const statusPayload = parseJson(statusResult.stdout);
      assert.strictEqual(statusPayload.activeSessions.activeCount, 1);

      const sessionsResult = runNode(ECC_SCRIPT, ['sessions', 'session-active', '--db', dbPath, '--json']);
      assert.strictEqual(sessionsResult.status, 0, sessionsResult.stderr);
      const sessionsPayload = parseJson(sessionsResult.stdout);
      assert.strictEqual(sessionsPayload.session.id, 'session-active');
      assert.strictEqual(sessionsPayload.skillRuns.length, 2);

      const workItemResult = runNode(ECC_SCRIPT, [
        'work-items',
        'upsert',
        'handoff-roadmap',
        '--db',
        dbPath,
        '--source',
        'handoff',
        '--title',
        'Track roadmap handoff',
        '--status',
        'blocked',
        '--json',
      ], { cwd: testDir });
      assert.strictEqual(workItemResult.status, 0, workItemResult.stderr);
      const workItemPayload = parseJson(workItemResult.stdout);
      assert.strictEqual(workItemPayload.id, 'handoff-roadmap');

      const delegatedStatusResult = runNode(ECC_SCRIPT, ['status', '--db', dbPath, '--json']);
      assert.strictEqual(delegatedStatusResult.status, 0, delegatedStatusResult.stderr);
      const delegatedStatusPayload = parseJson(delegatedStatusResult.stdout);
      assert.strictEqual(delegatedStatusPayload.readiness.blockedWorkItems, 1);
    } finally {
      cleanupTempDir(testDir);
    }
  })) passed += 1; else failed += 1;

  console.log(`\nResults: Passed: ${passed}, Failed: ${failed}`);
  process.exit(failed > 0 ? 1 : 0);
}

runTests();
