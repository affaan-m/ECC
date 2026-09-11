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

  console.log(`\nResults: Passed: ${passed}, Failed: ${failed}`);
  process.exit(failed > 0 ? 1 : 0);
}

runTests();
