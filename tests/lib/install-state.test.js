/**
 * Tests for scripts/lib/install-state.js
 */

const assert = require('assert');
const fs = require('fs');
const os = require('os');
const path = require('path');
const Ajv = require('ajv');
const CURRENT_PACKAGE_VERSION = JSON.parse(
  fs.readFileSync(path.join(__dirname, '..', '..', 'package.json'), 'utf8')
).version;
const installStateSchema = JSON.parse(
  fs.readFileSync(path.join(__dirname, '..', '..', 'schemas', 'install-state.schema.json'), 'utf8')
);
const validateInstallStateSchema = new Ajv({ allErrors: true, strict: false })
  .compile(installStateSchema);

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

  if (test('validates managed Antigravity hook group metadata and canonical destination', () => {
    const baseOptions = {
      adapter: { id: 'antigravity-project', target: 'antigravity', kind: 'project' },
      targetRoot: '/repo/.agents',
      installStatePath: '/repo/.agents/ecc-install-state.json',
      request: {
        profile: 'core',
        modules: [],
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
      kind: 'update-antigravity-hooks',
      moduleId: 'hooks-runtime',
      sourceRelativePath: 'scripts/hooks/antigravity-hooks.json',
      destinationPath: '/repo/.agents/hooks.json',
      strategy: 'merge-hook-groups',
      ownership: 'managed',
      scaffoldOnly: false,
      managedHookGroups: {
        'ecc-security-guard': {
          PreToolUse: [{
            matcher: 'run_command',
            hooks: [{ type: 'command', command: 'node guard.js' }],
          }],
        },
      },
    };

    const state = createInstallState({ ...baseOptions, operations: [operation] });
    assert.strictEqual(
      validateInstallStateSchema(state),
      true,
      JSON.stringify(validateInstallStateSchema.errors)
    );
    const invalidSchemaState = JSON.parse(JSON.stringify(state));
    delete invalidSchemaState.operations[0]
      .managedHookGroups['ecc-security-guard'].PreToolUse[0].hooks[0].type;
    assert.strictEqual(validateInstallStateSchema(invalidSchemaState), false);
    assert.throws(
      () => createInstallState({
        ...baseOptions,
        operations: [{ ...operation, destinationPath: '/repo/.agents/other.json' }],
      }),
      /outside .*hooks.json/
    );
    assert.throws(
      () => createInstallState({
        ...baseOptions,
        operations: [{ ...operation, managedHookGroups: {} }],
      }),
      /managedHookGroups/
    );
    assert.throws(
      () => createInstallState({
        ...baseOptions,
        operations: [{
          ...operation,
          managedHookGroups: {
            'user-linter': operation.managedHookGroups['ecc-security-guard'],
          },
        }],
      }),
      /only ecc-security-guard/
    );
    assert.throws(
      () => createInstallState({
        ...baseOptions,
        adapter: { id: 'cursor-project', target: 'cursor', kind: 'project' },
        targetRoot: '/repo/.cursor',
        installStatePath: '/repo/.cursor/ecc-install-state.json',
        operations: [{ ...operation, destinationPath: '/repo/.cursor/hooks.json' }],
      }),
      /only valid for the Antigravity target/
    );
    assert.throws(
      () => createInstallState({
        ...baseOptions,
        operations: [{
          ...operation,
          kind: 'copy-file',
          sourceRelativePath: 'README.md',
          contentSha256: 'a'.repeat(64),
        }],
      }),
      /must use update-antigravity-hooks/
    );
    assert.throws(
      () => createInstallState({
        ...baseOptions,
        operations: [{
          ...operation,
          kind: 'copy-file',
          sourceRelativePath: 'README.md',
          destinationPath: '/repo/.agents/subdir/HOOKS.JSON',
          contentSha256: 'a'.repeat(64),
        }],
      }),
      /must use update-antigravity-hooks/
    );
    assert.throws(
      () => createInstallState({
        ...baseOptions,
        operations: [{ ...operation, sourceRelativePath: 'README.md' }],
      }),
      /sourceRelativePath.*antigravity-hooks\.json/
    );
    assert.throws(
      () => createInstallState({
        ...baseOptions,
        operations: [{
          ...operation,
          kind: 'copy-file',
          sourceRelativePath: 'README.md',
          destinationPath: '/repo/.agents/subdir/hooks.json',
          contentSha256: 'a'.repeat(64),
        }],
      }),
      /must use update-antigravity-hooks/
    );
    assert.throws(
      () => createInstallState({
        ...baseOptions,
        operations: [{
          ...operation,
          kind: 'copy-file',
          sourceRelativePath: 'README.md',
          destinationPath: '/repo/.agents/ecc-hooks/user-important.js',
          contentSha256: 'a'.repeat(64),
        }],
      }),
      /approved Antigravity hook runtime/
    );
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

  if (test('atomically replaces an install-state symlink without overwriting its target', () => {
    if (process.platform === 'win32') return;
    const testDir = createTestDir();
    const statePath = path.join(testDir, 'ecc-install-state.json');
    const victimPath = path.join(testDir, 'victim.json');
    try {
      const state = createInstallState({
        adapter: { id: 'cursor-project', target: 'cursor', kind: 'project' },
        targetRoot: testDir,
        installStatePath: statePath,
        request: { profile: null, modules: [], legacyLanguages: [], legacyMode: false },
        resolution: { selectedModules: [], skippedModules: [] },
        operations: [],
        source: { repoVersion: CURRENT_PACKAGE_VERSION, repoCommit: null, manifestVersion: 1 },
      });
      fs.writeFileSync(victimPath, '{"sentinel":true}\n');
      fs.symlinkSync(victimPath, statePath);
      writeInstallState(statePath, state);
      assert.deepStrictEqual(JSON.parse(fs.readFileSync(victimPath, 'utf8')), { sentinel: true });
      assert.strictEqual(fs.lstatSync(statePath).isSymbolicLink(), false);
      assert.strictEqual(readInstallState(statePath).schemaVersion, 'ecc.install.v1');
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
