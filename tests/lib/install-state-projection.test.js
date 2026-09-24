/**
 * Regression tests for projecting canonical JSON install state into the
 * SQLite status store (#2750).
 */

const assert = require('assert');
const fs = require('fs');
const os = require('os');
const path = require('path');
const { spawnSync } = require('child_process');
const crypto = require('crypto');

const {
  buildInstallStateStoreRecord,
  createStateStore,
  reconcileInstallStateProjections,
} = require('../../scripts/lib/state-store');
const {
  projectCanonicalInstallState,
  reconcileCanonicalInstallStates,
} = require('../../scripts/lib/install-state-store-sync');
const { createInstallState, writeInstallState } = require('../../scripts/lib/install-state');

const STATUS_SCRIPT = path.join(__dirname, '..', '..', 'scripts', 'status.js');

async function test(name, fn) {
  try {
    await fn();
    console.log(`  \u2713 ${name}`);
    return true;
  } catch (error) {
    console.log(`  \u2717 ${name}`);
    console.log(`    Error: ${error.stack || error.message}`);
    return false;
  }
}

function createTempDir() {
  return fs.mkdtempSync(path.join(os.tmpdir(), 'ecc-install-projection-'));
}

function createState(options = {}) {
  const targetRoot = options.targetRoot;
  const installStatePath = options.installStatePath || path.join(targetRoot, 'ecc-install-state.json');
  return createInstallState({
    adapter: {
      id: options.targetId || 'claude-home',
      target: options.target || 'claude',
      kind: options.kind || 'home',
    },
    targetRoot,
    installStatePath,
    request: {
      profile: 'developer',
      modules: ['rules-core'],
      includeComponents: [],
      excludeComponents: [],
      legacyLanguages: [],
      legacyMode: false,
    },
    resolution: {
      selectedModules: ['rules-core'],
      skippedModules: [],
    },
    operations: Array.isArray(options.operations) ? options.operations : [],
    source: {
      repoVersion: '2.2.0',
      repoCommit: 'abc123',
      manifestVersion: 1,
    },
    installedAt: '2026-08-13T12:00:00.000Z',
  });
}

function discoveryRecord(state, options = {}) {
  const targetId = options.targetId || state.target.id;
  const targetRoot = options.targetRoot || state.target.root;
  return {
    adapter: {
      id: targetId,
      target: options.target || state.target.target || 'claude',
      kind: options.kind || state.target.kind || 'home',
    },
    targetRoot,
    installStatePath: options.installStatePath || state.target.installStatePath,
    exists: options.exists !== undefined ? options.exists : true,
    state: options.state !== undefined ? options.state : state,
    error: options.error || null,
    legacy: false,
  };
}

async function runTests() {
  console.log('\n=== Testing install-state projection ===\n');
  let passed = 0;
  let failed = 0;

  if (await test('maps canonical install state to the status-store projection', () => {
    const state = createState({ targetRoot: '/tmp/home/.claude' });
    assert.deepStrictEqual(buildInstallStateStoreRecord(state), {
      targetId: 'claude-home',
      targetRoot: '/tmp/home/.claude',
      profile: 'developer',
      modules: ['rules-core'],
      operations: [],
      installedAt: '2026-08-13T12:00:00.000Z',
      sourceVersion: '2.2.0',
    });
  })) passed += 1; else failed += 1;

  if (await test('reconciles present and absent discoverable targets without deleting other scopes', async () => {
    const store = await createStateStore({ dbPath: ':memory:' });
    try {
      const currentRoot = '/tmp/current/.claude';
      const absentRoot = '/tmp/current/.codex';
      const otherRoot = '/tmp/other/.claude';
      store.upsertInstallState({
        targetId: 'codex-home',
        targetRoot: absentRoot,
        installedAt: '2026-08-01T00:00:00.000Z',
        sourceVersion: '2.1.0',
      });
      store.upsertInstallState({
        targetId: 'claude-home',
        targetRoot: otherRoot,
        installedAt: '2026-08-01T00:00:00.000Z',
        sourceVersion: '2.1.0',
      });

      const state = createState({ targetRoot: currentRoot });
      const result = reconcileInstallStateProjections(store, [
        discoveryRecord(state),
        {
          adapter: { id: 'codex-home', target: 'codex', kind: 'home' },
          targetRoot: absentRoot,
          installStatePath: path.join(absentRoot, 'ecc-install-state.json'),
          exists: false,
          state: null,
          error: null,
          legacy: false,
        },
      ]);
      const installations = store.getStatus().installHealth.installations;

      assert.strictEqual(result.status, 'ok');
      assert.strictEqual(result.projectedCount, 1);
      assert.strictEqual(result.removedCount, 1);
      assert.deepStrictEqual(
        installations.map(row => [row.targetId, row.targetRoot]).sort(),
        [
          ['claude-home', currentRoot],
          ['claude-home', otherRoot],
        ].sort()
      );
    } finally {
      store.close();
    }
  })) passed += 1; else failed += 1;

  if (await test('removes only the discoverable stale row when canonical state is invalid', async () => {
    const store = await createStateStore({ dbPath: ':memory:' });
    try {
      const targetRoot = '/tmp/current/.claude';
      store.upsertInstallState({
        targetId: 'claude-home',
        targetRoot,
        installedAt: '2026-08-01T00:00:00.000Z',
        sourceVersion: '2.1.0',
      });

      const state = createState({ targetRoot });
      const result = reconcileInstallStateProjections(store, [
        discoveryRecord(state, {
          state: null,
          error: 'Invalid install-state',
        }),
      ]);

      assert.strictEqual(result.status, 'warning');
      assert.strictEqual(result.removedCount, 1);
      assert.strictEqual(result.warningCount, 1);
      assert.strictEqual(result.warnings[0].code, 'invalid-install-state');
      assert.strictEqual(store.getStatus().installHealth.totalCount, 0);
    } finally {
      store.close();
    }
  })) passed += 1; else failed += 1;

  if (await test('returns projection failures as warnings and continues reconciling', () => {
    const first = createState({ targetRoot: '/tmp/one/.claude' });
    const second = createState({ targetRoot: '/tmp/two/.claude' });
    const projected = [];
    const store = {
      upsertInstallState(record) {
        if (record.targetRoot.includes('/one/')) {
          throw new Error('database is read-only');
        }
        projected.push(record.targetRoot);
      },
      deleteInstallState() {
        return false;
      },
    };

    const result = reconcileInstallStateProjections(store, [
      discoveryRecord(first),
      discoveryRecord(second),
    ]);

    assert.strictEqual(result.status, 'warning');
    assert.strictEqual(result.projectedCount, 1);
    assert.strictEqual(result.warningCount, 1);
    assert.strictEqual(result.warnings[0].code, 'projection-write-failed');
    assert.deepStrictEqual(projected, ['/tmp/two/.claude']);
  })) passed += 1; else failed += 1;

  if (await test('status discovers canonical JSON state before querying install health', async () => {
    const tempDir = createTempDir();
    const homeDir = path.join(tempDir, 'home');
    const projectDir = path.join(tempDir, 'project');
    const targetRoot = path.join(homeDir, '.claude');
    const installStatePath = path.join(targetRoot, 'ecc', 'install-state.json');
    const dbPath = path.join(tempDir, 'state.db');
    fs.mkdirSync(projectDir, { recursive: true });
    writeInstallState(installStatePath, createState({ targetRoot, installStatePath }));

    try {
      const result = spawnSync(process.execPath, [STATUS_SCRIPT, '--db', dbPath, '--json'], {
        cwd: projectDir,
        encoding: 'utf8',
        env: { ...process.env, HOME: homeDir },
      });
      assert.strictEqual(result.status, 0, result.stderr);
      const payload = JSON.parse(result.stdout);
      assert.strictEqual(payload.installHealth.status, 'healthy');
      assert.strictEqual(payload.installHealth.totalCount, 1);
      assert.strictEqual(payload.installHealth.installations[0].targetRoot, targetRoot);
      assert.strictEqual(payload.installStateProjection.status, 'ok');
      assert.strictEqual(payload.installStateProjection.projectedCount, 1);
    } finally {
      fs.rmSync(tempDir, { recursive: true, force: true });
    }
  })) passed += 1; else failed += 1;

  if (await test('status reports warning health when a canonical managed file is drifted or missing', async () => {
    const tempDir = createTempDir();
    const homeDir = path.join(tempDir, 'home');
    const projectDir = path.join(tempDir, 'project');
    const targetRoot = path.join(homeDir, '.claude');
    const installStatePath = path.join(targetRoot, 'ecc', 'install-state.json');
    const destinationPath = path.join(targetRoot, 'managed-package.json');
    const sourcePath = path.join(__dirname, '..', '..', 'package.json');
    const sourceRelativePath = 'package.json';
    const dbPath = path.join(tempDir, 'state.db');
    const contentSha256 = crypto.createHash('sha256').update(fs.readFileSync(sourcePath)).digest('hex');
    fs.mkdirSync(projectDir, { recursive: true });
    fs.mkdirSync(targetRoot, { recursive: true });
    fs.writeFileSync(destinationPath, 'drifted content');
    writeInstallState(installStatePath, createState({
      targetRoot,
      installStatePath,
      operations: [{
        kind: 'copy-file',
        moduleId: 'rules-core',
        sourceRelativePath,
        destinationPath,
        strategy: 'preserve-relative-path',
        ownership: 'managed',
        scaffoldOnly: false,
        contentSha256,
      }],
    }));

    try {
      const result = spawnSync(process.execPath, [STATUS_SCRIPT, '--db', dbPath, '--json'], {
        cwd: projectDir,
        encoding: 'utf8',
        env: { ...process.env, HOME: homeDir },
      });
      assert.strictEqual(result.status, 0, result.stderr);
      const payload = JSON.parse(result.stdout);
      assert.strictEqual(payload.installHealth.status, 'warning');
      assert.strictEqual(payload.installHealth.healthyCount, 0);
      assert.strictEqual(payload.installHealth.warningCount, 1);
      assert.strictEqual(payload.installHealth.installations[0].status, 'warning');
      assert.ok(payload.installHealth.installations[0].issues.some(
        issue => issue.code === 'drifted-managed-files'
      ));
      assert.strictEqual(payload.readiness.status, 'attention');

      fs.unlinkSync(destinationPath);
      const missingResult = spawnSync(process.execPath, [STATUS_SCRIPT, '--db', dbPath, '--json'], {
        cwd: projectDir,
        encoding: 'utf8',
        env: { ...process.env, HOME: homeDir },
      });
      assert.strictEqual(missingResult.status, 0, missingResult.stderr);
      const missingPayload = JSON.parse(missingResult.stdout);
      assert.strictEqual(missingPayload.installHealth.status, 'warning');
      assert.ok(missingPayload.installHealth.installations[0].issues.some(
        issue => issue.code === 'missing-managed-files'
      ));
    } finally {
      fs.rmSync(tempDir, { recursive: true, force: true });
    }
  })) passed += 1; else failed += 1;

  if (await test('command-boundary sync projects and removes canonical install state', async () => {
    const tempDir = createTempDir();
    const homeDir = path.join(tempDir, 'home');
    const projectDir = path.join(tempDir, 'project');
    const dbPath = path.join(tempDir, 'state.db');
    const targetRoot = path.join(homeDir, '.claude');
    const installStatePath = path.join(targetRoot, 'ecc', 'install-state.json');
    fs.mkdirSync(projectDir, { recursive: true });
    const state = createState({ targetRoot, installStatePath });

    try {
      const projected = await projectCanonicalInstallState(state, { dbPath, homeDir });
      assert.strictEqual(projected.status, 'projected');

      const store = await createStateStore({ dbPath });
      assert.strictEqual(store.getStatus().installHealth.totalCount, 1);
      store.close();

      const reconciled = await reconcileCanonicalInstallStates({ dbPath, homeDir, projectRoot: projectDir });
      assert.strictEqual(reconciled.status, 'ok');
      assert.strictEqual(reconciled.removedCount, 1);
    } finally {
      fs.rmSync(tempDir, { recursive: true, force: true });
    }
  })) passed += 1; else failed += 1;

  if (await test('command-boundary sync isolates database failures as warnings', async () => {
    const state = createState({ targetRoot: '/tmp/home/.claude' });
    const result = await projectCanonicalInstallState(state, {
      createStore: async () => { throw new Error('database unavailable'); },
    });
    assert.strictEqual(result.status, 'warning');
    assert.strictEqual(result.warning.code, 'projection-open-failed');
  })) passed += 1; else failed += 1;

  console.log(`\nResults: Passed: ${passed}, Failed: ${failed}`);
  process.exit(failed > 0 ? 1 : 0);
}

runTests();
