/**
 * Tests for scripts/auto-update.js
 */

const assert = require('assert');
const fs = require('fs');
const os = require('os');
const path = require('path');

const {
  parseArgs,
  deriveRepoRootFromState,
  buildInstallApplyArgs,
  determineInstallCwd,
  runAutoUpdate,
} = require('../../scripts/auto-update');
const {
  createInstallState,
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

function createTempDir(prefix) {
  return fs.mkdtempSync(path.join(os.tmpdir(), prefix));
}

function cleanup(dirPath) {
  fs.rmSync(dirPath, { recursive: true, force: true });
}

function makeRecord({ repoRoot, homeDir, projectRoot, adapter, request, resolution, operations }) {
  const targetRoot = adapter.kind === 'project'
    ? path.join(projectRoot, `.${adapter.target}`)
    : path.join(homeDir, '.claude');
  const installStatePath = adapter.kind === 'project'
    ? path.join(targetRoot, 'ecc-install-state.json')
    : path.join(targetRoot, 'ecc', 'install-state.json');

  const state = createInstallState({
    adapter,
    targetRoot,
    installStatePath,
    request,
    resolution,
    operations,
    source: {
      repoVersion: '1.10.0',
      repoCommit: 'abc123',
      manifestVersion: 1,
    },
  });

  return {
    adapter,
    targetRoot,
    installStatePath,
    exists: true,
    state,
    error: null,
    repoRoot,
  };
}

function ensureFakeRepo(repoRoot) {
  fs.mkdirSync(path.join(repoRoot, 'scripts'), { recursive: true });
  fs.writeFileSync(
    path.join(repoRoot, 'package.json'),
    JSON.stringify({ name: 'everything-claude-code', version: '1.10.0' }, null, 2)
  );
  fs.writeFileSync(path.join(repoRoot, 'scripts', 'install-apply.js'), '#!/usr/bin/env node\n');
}

function runTests() {
  console.log('\n=== Testing auto-update.js ===\n');

  let passed = 0;
  let failed = 0;

  if (test('parseArgs reads repo-root, target, dry-run, and json flags', () => {
    const parsed = parseArgs([
      'node',
      'scripts/auto-update.js',
      '--target',
      'cursor',
      '--repo-root',
      '/tmp/ecc',
      '--dry-run',
      '--json',
    ]);

    assert.deepStrictEqual(parsed.targets, ['cursor']);
    assert.strictEqual(parsed.repoRoot, '/tmp/ecc');
    assert.strictEqual(parsed.dryRun, true);
    assert.strictEqual(parsed.json, true);
  })) passed += 1; else failed += 1;

  if (test('parseArgs rejects unknown arguments', () => {
    assert.throws(
      () => parseArgs(['node', 'scripts/auto-update.js', '--bogus']),
      /Unknown argument: --bogus/
    );
  })) passed += 1; else failed += 1;

  if (test('deriveRepoRootFromState uses sourcePath and sourceRelativePath', () => {
    const state = {
      operations: [
        {
          sourcePath: path.join('/tmp', 'ecc', 'scripts', 'setup-package-manager.js'),
          sourceRelativePath: path.join('scripts', 'setup-package-manager.js'),
        },
      ],
    };

    assert.strictEqual(
      deriveRepoRootFromState(state),
      path.resolve(path.join('/tmp', 'ecc'))
    );
  })) passed += 1; else failed += 1;

  if (test('deriveRepoRootFromState fails when source metadata is unavailable', () => {
    assert.throws(
      () => deriveRepoRootFromState({ operations: [{ destinationPath: '/tmp/file' }] }),
      /Unable to infer ECC repo root/
    );
  })) passed += 1; else failed += 1;

  if (test('buildInstallApplyArgs reconstructs legacy installs', () => {
    const record = {
      adapter: { target: 'claude', kind: 'home' },
      state: {
        target: { target: 'claude' },
        request: {
          profile: null,
          modules: [],
          includeComponents: [],
          excludeComponents: [],
          legacyLanguages: ['typescript', 'python'],
          legacyMode: true,
        },
      },
    };

    assert.deepStrictEqual(buildInstallApplyArgs(record), [
      '--target', 'claude',
      'typescript',
      'python',
    ]);
  })) passed += 1; else failed += 1;

  if (test('buildInstallApplyArgs reconstructs manifest installs', () => {
    const record = {
      adapter: { target: 'cursor', kind: 'project' },
      state: {
        target: { target: 'cursor' },
        request: {
          profile: 'developer',
          modules: ['platform-configs'],
          includeComponents: ['component:alpha'],
          excludeComponents: ['component:beta'],
          legacyLanguages: [],
          legacyMode: false,
        },
      },
    };

    assert.deepStrictEqual(buildInstallApplyArgs(record), [
      '--target', 'cursor',
      '--profile', 'developer',
      '--modules', 'platform-configs',
      '--with', 'component:alpha',
      '--without', 'component:beta',
    ]);
  })) passed += 1; else failed += 1;

  if (test('determineInstallCwd uses the project root for project installs', () => {
    const record = {
      adapter: { kind: 'project' },
      state: {
        target: {
          root: path.join('/tmp', 'project', '.cursor'),
        },
      },
    };

    assert.strictEqual(determineInstallCwd(record, '/tmp/ecc'), path.join('/tmp', 'project'));
  })) passed += 1; else failed += 1;

  if (test('runAutoUpdate reports when no install-state files are present', () => {
    const result = runAutoUpdate(
      {
        homeDir: '/tmp/home',
        projectRoot: '/tmp/project',
        dryRun: true,
      },
      {
        discoverInstalledStates: () => [],
      }
    );

    assert.strictEqual(result.results.length, 0);
    assert.strictEqual(result.summary.checkedCount, 0);
    assert.strictEqual(result.summary.errorCount, 0);
  })) passed += 1; else failed += 1;

  if (test('runAutoUpdate rejects mixed inferred repo roots', () => {
    const homeDir = createTempDir('auto-update-home-');
    const projectRoot = createTempDir('auto-update-project-');
    const repoOne = createTempDir('auto-update-repo-');
    const repoTwo = createTempDir('auto-update-repo-');

    try {
      ensureFakeRepo(repoOne);
      ensureFakeRepo(repoTwo);

      const records = [
        makeRecord({
          repoRoot: repoOne,
          homeDir,
          projectRoot,
          adapter: { id: 'claude-home', target: 'claude', kind: 'home' },
          request: {
            profile: null,
            modules: [],
            includeComponents: [],
            excludeComponents: [],
            legacyLanguages: ['typescript'],
            legacyMode: true,
          },
          resolution: { selectedModules: ['legacy-claude-rules'], skippedModules: [] },
          operations: [
            {
              kind: 'copy-file',
              moduleId: 'legacy-claude-rules',
              sourcePath: path.join(repoOne, 'rules', 'common', 'coding-style.md'),
              sourceRelativePath: path.join('rules', 'common', 'coding-style.md'),
              destinationPath: path.join(homeDir, '.claude', 'rules', 'common', 'coding-style.md'),
              strategy: 'preserve-relative-path',
              ownership: 'managed',
              scaffoldOnly: false,
            },
          ],
        }),
        makeRecord({
          repoRoot: repoTwo,
          homeDir,
          projectRoot,
          adapter: { id: 'cursor-project', target: 'cursor', kind: 'project' },
          request: {
            profile: 'core',
            modules: [],
            includeComponents: [],
            excludeComponents: [],
            legacyLanguages: [],
            legacyMode: false,
          },
          resolution: { selectedModules: ['rules-core'], skippedModules: [] },
          operations: [
            {
              kind: 'copy-file',
              moduleId: 'rules-core',
              sourcePath: path.join(repoTwo, '.cursor', 'mcp.json'),
              sourceRelativePath: path.join('.cursor', 'mcp.json'),
              destinationPath: path.join(projectRoot, '.cursor', 'mcp.json'),
              strategy: 'sync-root-children',
              ownership: 'managed',
              scaffoldOnly: false,
            },
          ],
        }),
      ];

      assert.throws(
        () => runAutoUpdate(
          {
            homeDir,
            projectRoot,
            dryRun: true,
          },
          {
            discoverInstalledStates: () => records,
          }
        ),
        /Multiple ECC repo roots detected/
      );
    } finally {
      cleanup(homeDir);
      cleanup(projectRoot);
      cleanup(repoOne);
      cleanup(repoTwo);
    }
  })) passed += 1; else failed += 1;

  if (test('runAutoUpdate fetches, pulls, and reinstalls using reconstructed args', () => {
    const homeDir = createTempDir('auto-update-home-');
    const projectRoot = createTempDir('auto-update-project-');
    const repoRoot = createTempDir('auto-update-repo-');

    try {
      ensureFakeRepo(repoRoot);

      const records = [
        makeRecord({
          repoRoot,
          homeDir,
          projectRoot,
          adapter: { id: 'cursor-project', target: 'cursor', kind: 'project' },
          request: {
            profile: 'developer',
            modules: [],
            includeComponents: ['component:alpha'],
            excludeComponents: ['component:beta'],
            legacyLanguages: [],
            legacyMode: false,
          },
          resolution: { selectedModules: ['rules-core'], skippedModules: [] },
          operations: [
            {
              kind: 'copy-file',
              moduleId: 'platform-configs',
              sourcePath: path.join(repoRoot, '.cursor', 'mcp.json'),
              sourceRelativePath: path.join('.cursor', 'mcp.json'),
              destinationPath: path.join(projectRoot, '.cursor', 'mcp.json'),
              strategy: 'sync-root-children',
              ownership: 'managed',
              scaffoldOnly: false,
            },
          ],
        }),
      ];

      const commands = [];
      const result = runAutoUpdate(
        {
          homeDir,
          projectRoot,
          dryRun: false,
        },
        {
          discoverInstalledStates: () => records,
          runExternalCommand: (command, args, options) => {
            commands.push({ command, args, options });
            if (command === process.execPath) {
              return {
                stdout: JSON.stringify({
                  dryRun: false,
                  result: {
                    installStatePath: path.join(projectRoot, '.cursor', 'ecc-install-state.json'),
                  },
                }),
                stderr: '',
              };
            }

            return { stdout: '', stderr: '' };
          },
        }
      );

      assert.strictEqual(result.summary.checkedCount, 1);
      assert.strictEqual(result.summary.updatedCount, 1);
      assert.deepStrictEqual(commands.map(entry => [entry.command, entry.args[0]]), [
        ['git', 'fetch'],
        ['git', 'pull'],
        [process.execPath, path.join(repoRoot, 'scripts', 'install-apply.js')],
      ]);
      assert.deepStrictEqual(commands[2].args.slice(1), [
        '--target', 'cursor',
        '--profile', 'developer',
        '--with', 'component:alpha',
        '--without', 'component:beta',
        '--json',
      ]);
      assert.strictEqual(commands[2].options.cwd, projectRoot);
    } finally {
      cleanup(homeDir);
      cleanup(projectRoot);
      cleanup(repoRoot);
    }
  })) passed += 1; else failed += 1;

  console.log(`\nResults: Passed: ${passed}, Failed: ${failed}`);
  process.exit(failed > 0 ? 1 : 0);
}

runTests();
