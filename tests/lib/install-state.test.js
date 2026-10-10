/**
 * Tests for scripts/lib/install-state.js
 */

const assert = require('assert');
const fs = require('fs');
const os = require('os');
const path = require('path');
const CURRENT_PACKAGE_VERSION = JSON.parse(
  fs.readFileSync(path.join(__dirname, '..', '..', 'package.json'), 'utf8')
).version;

const {
  createInstallState,
  readInstallState,
  writeInstallState,
} = require('../../scripts/lib/install-state');

function test(name, fn) {
  try {
    fn();
    console.log(`  \u2713 ${name}`);
    return true;
  } catch (error) {
    console.log(`  \u2717 ${name}`);
    console.log(`    Error: ${error.message}`);
    return false;
  }
}

function createTestDir() {
  return fs.mkdtempSync(path.join(os.tmpdir(), 'install-state-'));
}

function cleanupTestDir(dirPath) {
  fs.rmSync(dirPath, { recursive: true, force: true });
}

function runTests() {
  console.log('\n=== Testing install-state.js ===\n');

  let passed = 0;
  let failed = 0;

  if (test('creates a valid install-state payload', () => {
    const state = createInstallState({
      adapter: { id: 'cursor-project' },
      targetRoot: '/repo/.cursor',
      installStatePath: '/repo/.cursor/ecc-install-state.json',
      request: {
        profile: 'developer',
        modules: ['orchestration'],
        legacyLanguages: ['typescript'],
        legacyMode: true,
        hookConsent: 'declined',
      },
      resolution: {
        selectedModules: ['rules-core', 'orchestration'],
        skippedModules: [],
      },
      operations: [
        {
          kind: 'copy-path',
          moduleId: 'rules-core',
          sourceRelativePath: 'rules',
          destinationPath: '/repo/.cursor/rules',
          strategy: 'preserve-relative-path',
          ownership: 'managed',
          scaffoldOnly: true,
        },
      ],
      source: {
        repoVersion: CURRENT_PACKAGE_VERSION,
        repoCommit: 'abc123',
        manifestVersion: 1,
      },
      installedAt: '2026-03-13T00:00:00Z',
    });

    assert.strictEqual(state.schemaVersion, 'ecc.install.v1');
    assert.strictEqual(state.target.id, 'cursor-project');
    assert.strictEqual(state.request.profile, 'developer');
    assert.strictEqual(state.request.hookConsent, 'declined');
    assert.strictEqual(state.operations.length, 1);
  })) passed++; else failed++;

  if (test('validates managed hook metadata for Claude settings operations', () => {
    const baseOptions = {
      adapter: { id: 'claude-home', target: 'claude', kind: 'home' },
      targetRoot: '/home/test/.claude',
      installStatePath: '/home/test/.claude/ecc/install-state.json',
      request: {
        profile: 'core',
        modules: ['hooks-runtime'],
        includeComponents: [],
        excludeComponents: [],
        legacyLanguages: [],
        legacyMode: false,
        hookConsent: 'enabled',
      },
      resolution: { selectedModules: ['hooks-runtime'], skippedModules: [] },
      source: { repoVersion: CURRENT_PACKAGE_VERSION, repoCommit: 'abc123', manifestVersion: 1 },
    };
    const operation = {
      kind: 'update-claude-settings',
      moduleId: 'hooks-runtime',
      sourceRelativePath: 'hooks/hooks.json',
      destinationPath: '/home/test/.claude/settings.json',
      strategy: 'merge-hook-ids',
      ownership: 'managed',
      scaffoldOnly: false,
      managedHooks: {
        SessionStart: [{
          id: 'session:start',
          matcher: '.*',
          hooks: [{ type: 'command', command: 'node start.js' }],
        }],
      },
    };

    assert.doesNotThrow(() => createInstallState({ ...baseOptions, operations: [operation] }));
    assert.throws(
      () => createInstallState({
        ...baseOptions,
        operations: [{ ...operation, moduleId: 'not-hooks-runtime' }],
      }),
      /moduleId.*hooks-runtime/
    );
    assert.throws(
      () => createInstallState({
        ...baseOptions,
        operations: [{ ...operation, sourceRelativePath: 'attacker.json' }],
      }),
      /sourceRelativePath.*hooks\/hooks\.json/
    );
    assert.throws(
      () => createInstallState({
        ...baseOptions,
        operations: [{
          ...operation,
          destinationPath: '/home/test/.claude/settings.local.json',
        }],
      }),
      /destinationPath.*canonical Claude settings path/
    );
    assert.throws(
      () => createInstallState({
        ...baseOptions,
        adapter: { id: 'cursor-project', target: 'cursor', kind: 'project' },
        targetRoot: '/repo/.cursor',
        installStatePath: '/repo/.cursor/ecc-install-state.json',
        operations: [{
          ...operation,
          destinationPath: '/repo/.cursor/settings.json',
        }],
      }),
      /only valid for Claude targets/
    );
    assert.throws(
      () => createInstallState({
        ...baseOptions,
        operations: [{
          ...operation,
          managedHooks: {
            SessionStart: [{
              matcher: '.*',
              hooks: [{ type: 'command', command: 'node start.js' }],
            }],
          },
        }],
      }),
      /managedHooks.*Invalid hook entry/
    );
    assert.doesNotThrow(() => createInstallState({
      ...baseOptions,
      operations: [{
        ...operation,
        managedHooks: {
          SessionStart: [{ id: 'shared', hooks: [] }],
          LegacyEvent: [{ id: 'shared', hooks: [{ type: 'legacy' }] }],
        },
      }],
    }));
  })) passed++; else failed++;

  if (test('writes and reads install-state from disk', () => {
    const testDir = createTestDir();
    const statePath = path.join(testDir, 'ecc-install-state.json');

    try {
      const state = createInstallState({
        adapter: { id: 'claude-home' },
        targetRoot: path.join(testDir, '.claude'),
        installStatePath: statePath,
        request: {
          profile: 'core',
          modules: [],
          legacyLanguages: [],
          legacyMode: false,
        },
        resolution: {
          selectedModules: ['rules-core'],
          skippedModules: [],
        },
        operations: [],
        source: {
          repoVersion: CURRENT_PACKAGE_VERSION,
          repoCommit: 'abc123',
          manifestVersion: 1,
        },
      });

      writeInstallState(statePath, state);
      const loaded = readInstallState(statePath);

      assert.strictEqual(loaded.target.id, 'claude-home');
      assert.strictEqual(loaded.request.profile, 'core');
      assert.deepStrictEqual(loaded.resolution.selectedModules, ['rules-core']);
    } finally {
      cleanupTestDir(testDir);
    }
  })) passed++; else failed++;

  if (test('deep-clones nested operation metadata for lifecycle-managed operations', () => {
    const operation = {
      kind: 'merge-json',
      moduleId: 'platform-configs',
      sourceRelativePath: '.cursor/hooks.json',
      destinationPath: '/repo/.cursor/hooks.json',
      strategy: 'merge-json',
      ownership: 'managed',
      scaffoldOnly: false,
      mergePayload: {
        nested: {
          enabled: true,
        },
      },
      previousValue: {
        nested: {
          enabled: false,
        },
      },
    };

    const state = createInstallState({
      adapter: { id: 'cursor-project' },
      targetRoot: '/repo/.cursor',
      installStatePath: '/repo/.cursor/ecc-install-state.json',
      request: {
        profile: null,
        modules: ['platform-configs'],
        legacyLanguages: [],
        legacyMode: false,
      },
      resolution: {
        selectedModules: ['platform-configs'],
        skippedModules: [],
      },
      operations: [operation],
      source: {
        repoVersion: CURRENT_PACKAGE_VERSION,
        repoCommit: 'abc123',
        manifestVersion: 1,
      },
    });

    operation.mergePayload.nested.enabled = false;
    operation.previousValue.nested.enabled = true;

    assert.strictEqual(state.operations[0].mergePayload.nested.enabled, true);
    assert.strictEqual(state.operations[0].previousValue.nested.enabled, false);
  })) passed++; else failed++;

  if (test('rejects invalid install-state payloads on read', () => {
    const testDir = createTestDir();
    const statePath = path.join(testDir, 'ecc-install-state.json');

    try {
      fs.writeFileSync(statePath, JSON.stringify({ schemaVersion: 'ecc.install.v1' }, null, 2));
      assert.throws(
        () => readInstallState(statePath),
        /Invalid install-state/
      );
    } finally {
      cleanupTestDir(testDir);
    }
  })) passed++; else failed++;

  if (test('rejects unexpected properties and missing required request fields', () => {
    const testDir = createTestDir();
    const statePath = path.join(testDir, 'ecc-install-state.json');

    try {
      fs.writeFileSync(statePath, JSON.stringify({
        schemaVersion: 'ecc.install.v1',
        installedAt: '2026-03-13T00:00:00Z',
        unexpected: true,
        target: {
          id: 'cursor-project',
          root: '/repo/.cursor',
          installStatePath: '/repo/.cursor/ecc-install-state.json',
        },
        request: {
          modules: [],
          includeComponents: [],
          excludeComponents: [],
          legacyLanguages: [],
          legacyMode: false,
        },
        resolution: {
          selectedModules: [],
          skippedModules: [],
        },
        source: {
          repoVersion: CURRENT_PACKAGE_VERSION,
          repoCommit: 'abc123',
          manifestVersion: 1,
        },
        operations: [],
      }, null, 2));

      assert.throws(
        () => readInstallState(statePath),
        /Invalid install-state/
      );
    } finally {
      cleanupTestDir(testDir);
    }
  })) passed++; else failed++;

  function makeState(targetRoot, statePath, marker) {
    return createInstallState({
      adapter: { id: 'claude-home' },
      targetRoot,
      installStatePath: statePath,
      request: {
        profile: 'core',
        modules: [],
        legacyLanguages: [],
        legacyMode: false,
      },
      resolution: {
        selectedModules: ['rules-core'],
        skippedModules: [],
      },
      operations: [],
      source: {
        repoVersion: CURRENT_PACKAGE_VERSION,
        repoCommit: 'abc123',
        manifestVersion: 1,
      },
      lastValidatedAt: marker,
    });
  }

  function listStagingFiles(dirPath) {
    return fs.readdirSync(dirPath).filter(name => name.includes('.tmp'));
  }

  if (test('writeInstallState preserves the previous valid state when rename fails', () => {
    const testDir = createTestDir();
    const statePath = path.join(testDir, 'ecc-install-state.json');

    try {
      writeInstallState(statePath, makeState(testDir, statePath, '2026-01-01T00:00:00Z'));
      const originalRenameSync = fs.renameSync;
      fs.renameSync = () => { throw new Error('injected rename failure'); };
      try {
        assert.throws(
          () => writeInstallState(statePath, makeState(testDir, statePath, '2026-02-01T00:00:00Z')),
          /injected rename failure/
        );
      } finally {
        fs.renameSync = originalRenameSync;
      }
      assert.strictEqual(readInstallState(statePath).lastValidatedAt, '2026-01-01T00:00:00Z');
      assert.deepStrictEqual(listStagingFiles(testDir), []);
    } finally {
      cleanupTestDir(testDir);
    }
  })) passed++; else failed++;

  if (test('writeInstallState cleans up staging files when the write fails', () => {
    const testDir = createTestDir();
    const statePath = path.join(testDir, 'ecc-install-state.json');

    try {
      const originalWriteFileSync = fs.writeFileSync;
      fs.writeFileSync = () => { throw new Error('injected write failure'); };
      try {
        assert.throws(
          () => writeInstallState(statePath, makeState(testDir, statePath, '2026-01-01T00:00:00Z')),
          /injected write failure/
        );
      } finally {
        fs.writeFileSync = originalWriteFileSync;
      }
      assert.ok(!fs.existsSync(statePath));
      assert.deepStrictEqual(listStagingFiles(testDir), []);
    } finally {
      cleanupTestDir(testDir);
    }
  })) passed++; else failed++;

  if (test('writeInstallState replaces symlinks instead of following them', () => {
    if (process.platform === 'win32') return;
    const testDir = createTestDir();
    const statePath = path.join(testDir, 'ecc-install-state.json');
    const targetPath = path.join(testDir, 'link-target.json');
    fs.writeFileSync(targetPath, '{"untouched":true}\n');

    try {
      fs.symlinkSync(targetPath, statePath);
      writeInstallState(statePath, makeState(testDir, statePath, '2026-01-01T00:00:00Z'));
      assert.ok(fs.lstatSync(statePath).isFile());
      assert.strictEqual(readInstallState(statePath).lastValidatedAt, '2026-01-01T00:00:00Z');
      assert.strictEqual(fs.readFileSync(targetPath, 'utf8'), '{"untouched":true}\n');
    } finally {
      cleanupTestDir(testDir);
    }
  })) passed++; else failed++;

  if (test('concurrent writeInstallState calls always leave a complete valid state', () => {
    const testDir = createTestDir();
    const statePath = path.join(testDir, 'ecc-install-state.json');
    const markers = [
      '2026-03-01T00:00:00Z', '2026-03-02T00:00:00Z', '2026-03-03T00:00:00Z',
      '2026-03-04T00:00:00Z', '2026-03-05T00:00:00Z', '2026-03-06T00:00:00Z',
      '2026-03-07T00:00:00Z', '2026-03-08T00:00:00Z', '2026-03-09T00:00:00Z',
    ];

    try {
      writeInstallState(statePath, makeState(testDir, statePath, markers[0]));
      const { spawn } = require('child_process');
      const script = 'const fs = require("fs");' +
        'const {readInstallState, writeInstallState} = require(process.env.REPO_ROOT + "/scripts/lib/install-state");' +
        'const state = readInstallState(process.env.STATE_PATH);' +
        'state.lastValidatedAt = process.env.MARKER;' +
        'writeInstallState(process.env.STATE_PATH, state);' +
        'fs.writeFileSync(process.env.DONE_FILE, "ok");';
      const children = markers.slice(1).map(marker => {
        const tag = marker.replace(/:/g, '-');
        const doneFile = path.join(testDir, `done-${tag}.marker`);
        const errFile = path.join(testDir, `err-${tag}.log`);
        const errFd = fs.openSync(errFile, 'w');
        const child = spawn(process.execPath, ['-e', script], {
          stdio: ['ignore', 'ignore', errFd],
          env: {
            ...process.env,
            REPO_ROOT: path.join(__dirname, '..', '..'),
            STATE_PATH: statePath,
            MARKER: marker,
            DONE_FILE: doneFile,
          },
        });
        fs.closeSync(errFd);
        return { child, marker, doneFile, errFile };
      });
      assert.ok(
        children.some(entry => entry.child.exitCode === null),
        'expected writers to still be running right after launch'
      );
      let midRead = null;
      try {
        midRead = readInstallState(statePath);
      } catch (_error) {
        midRead = null;
      }
      const deadline = Date.now() + 60000;
      for (;;) {
        const pending = children.filter(entry => !fs.existsSync(entry.doneFile));
        if (pending.length === 0) break;
        if (Date.now() > deadline) {
          const details = children.map(entry =>
            `${entry.marker}: ${fs.existsSync(entry.doneFile) ? 'done' : 'PENDING'} ${fs.readFileSync(entry.errFile, 'utf8')}`
          ).join('\n');
          throw new Error(`timed out waiting for concurrent writers\n${details}`);
        }
        Atomics.wait(new Int32Array(new SharedArrayBuffer(4)), 0, 0, 10);
      }
      for (const entry of children) {
        assert.strictEqual(fs.readFileSync(entry.errFile, 'utf8'), '', `writer ${entry.marker} failed`);
      }
      if (midRead !== null) {
        assert.ok(markers.includes(midRead.lastValidatedAt));
      }
      const final = readInstallState(statePath);
      assert.ok(markers.includes(final.lastValidatedAt));
      assert.deepStrictEqual(listStagingFiles(testDir), []);
    } finally {
      cleanupTestDir(testDir);
    }
  })) passed++; else failed++;

  console.log(`\nResults: Passed: ${passed}, Failed: ${failed}`);
  process.exit(failed > 0 ? 1 : 0);
}

runTests();
