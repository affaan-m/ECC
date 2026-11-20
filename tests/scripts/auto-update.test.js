/**
 * Tests for scripts/auto-update.js
 */

const assert = require('assert');
const fs = require('fs');
const os = require('os');
const path = require('path');
const { execFileSync } = require('child_process');
const { LOCALE_ALIAS_TO_COMPONENT_ID } = require('../../scripts/lib/install-manifests');
const { normalizeInstallRequest, parseInstallArgs } = require('../../scripts/lib/install/request');

const {
  parseArgs,
  deriveRepoRootFromState,
  buildInstallApplyArgs,
  determineInstallCwd,
  runAutoUpdate,
} = require('../../scripts/auto-update');
const {
  createInstallState,
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

function createBehindRemoteRepoFixture(fixture) {
  const remoteRepo = path.join(fixture, 'remote.git');
  const localRepo = path.join(fixture, 'local-ecc');
  const pusherRepo = path.join(fixture, 'pusher');
  execFileSync('git', ['init', '--bare', '-b', 'main', remoteRepo], { encoding: 'utf8' });
  execFileSync('git', ['clone', remoteRepo, localRepo], { encoding: 'utf8' });
  execFileSync('git', ['config', 'user.email', 'test@example.com'], { cwd: localRepo, encoding: 'utf8' });
  execFileSync('git', ['config', 'user.name', 'Test'], { cwd: localRepo, encoding: 'utf8' });
  ensureFakeRepo(localRepo);
  fs.writeFileSync(
    path.join(localRepo, 'scripts', 'install-apply.js'),
    '#!/usr/bin/env node\nprocess.stdout.write(JSON.stringify({ dryRun: process.argv.includes("--dry-run"), plan: {} }));\n'
  );
  execFileSync('git', ['add', '.'], { cwd: localRepo, encoding: 'utf8' });
  execFileSync('git', ['commit', '-m', 'initial'], { cwd: localRepo, encoding: 'utf8' });
  execFileSync('git', ['push', '-u', 'origin', 'main'], { cwd: localRepo, encoding: 'utf8' });
  const headBefore = execFileSync('git', ['rev-parse', 'HEAD'], { cwd: localRepo, encoding: 'utf8' }).trim();
  execFileSync('git', ['clone', remoteRepo, pusherRepo], { encoding: 'utf8' });
  execFileSync('git', ['config', 'user.email', 'test@example.com'], { cwd: pusherRepo, encoding: 'utf8' });
  execFileSync('git', ['config', 'user.name', 'Test'], { cwd: pusherRepo, encoding: 'utf8' });
  fs.writeFileSync(path.join(pusherRepo, 'UPSTREAM.txt'), 'new commit\n');
  execFileSync('git', ['add', 'UPSTREAM.txt'], { cwd: pusherRepo, encoding: 'utf8' });
  execFileSync('git', ['commit', '-m', 'upstream update'], { cwd: pusherRepo, encoding: 'utf8' });
  execFileSync('git', ['push', 'origin', 'main'], { cwd: pusherRepo, encoding: 'utf8' });
  return { localRepo, headBefore };
}

function seedCursorInstallState(projectRoot, headBefore) {
  const targetRoot = path.join(projectRoot, '.cursor');
  const statePath = path.join(targetRoot, 'ecc-install-state.json');
  fs.mkdirSync(targetRoot, { recursive: true });
  writeInstallState(statePath, createInstallState({
    adapter: { id: 'cursor-project', target: 'cursor', kind: 'project' },
    targetRoot,
    installStatePath: statePath,
    request: {
      profile: null,
      modules: [],
      includeComponents: [],
      excludeComponents: [],
      legacyLanguages: ['typescript'],
      legacyMode: true,
      hookConsent: 'declined',
    },
    resolution: { selectedModules: ['legacy-cursor-install'], skippedModules: [] },
    source: { repoVersion: '1.10.0', repoCommit: headBefore, manifestVersion: 1 },
    operations: [],
  }));
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

  if (test('replays every locale alias with legacy languages and hook consent', () => {
    for (const target of ['claude', 'claude-project']) {
      for (const [alias, componentId] of Object.entries(LOCALE_ALIAS_TO_COMPONENT_ID)) {
        const original = normalizeInstallRequest(parseInstallArgs([
          'node', 'install-apply.js', '--target', target,
          '--locale', alias, 'typescript', 'python', '--no-hooks',
        ]));
        const record = makeRecord({
          repoRoot: '/tmp/ecc', homeDir: '/tmp/home', projectRoot: '/tmp/project',
          adapter: { id: target, target, kind: target === 'claude' ? 'home' : 'project' },
          request: {
            profile: original.profileId, modules: original.moduleIds,
            includeComponents: original.includeComponentIds,
            excludeComponents: original.excludeComponentIds,
            legacyLanguages: original.legacyLanguages,
            legacyMode: true, hookConsent: original.hookConsent,
          },
          resolution: { selectedModules: [], skippedModules: [] }, operations: [],
        });
        const replay = normalizeInstallRequest(parseInstallArgs([
          'node', 'install-apply.js', ...buildInstallApplyArgs(record),
        ]));
        assert.deepStrictEqual(replay, original, `${target}: ${alias} -> ${componentId}`);
      }
    }
  })) passed += 1; else failed += 1;

  for (const target of ['claude', 'claude-project']) {
    if (test(`end-to-end: auto-update plans a recorded ${target} locale and language install`, () => {
      const fixture = createTempDir('auto-update-locale-');
      const homeDir = path.join(fixture, 'home');
      const projectRoot = path.join(fixture, 'project');
      const repoRoot = path.resolve(__dirname, '..', '..');
      const env = { ...process.env, HOME: homeDir, USERPROFILE: homeDir, ECC_DRY_RUN: '0' };
      fs.mkdirSync(homeDir);
      fs.mkdirSync(projectRoot);
      try {
        const installed = JSON.parse(execFileSync(process.execPath, [
          path.join(repoRoot, 'scripts', 'install-apply.js'),
          '--target', target, '--locale', 'zh', 'typescript', '--no-hooks', '--json',
        ], { cwd: projectRoot, env, encoding: 'utf8', maxBuffer: 16 * 1024 * 1024 }));
        assert.strictEqual(installed.result.applied, true);
        const statePath = installed.result.installStatePath;
        const stateBefore = fs.readFileSync(statePath, 'utf8');
        const state = JSON.parse(stateBefore);
        assert.deepStrictEqual(state.request.includeComponents, ['locale:zh-cn']);
        assert.deepStrictEqual(state.request.legacyLanguages, ['typescript']);

        const updated = JSON.parse(execFileSync(process.execPath, [
          path.join(repoRoot, 'scripts', 'auto-update.js'), '--target', target,
          '--repo-root', repoRoot, '--dry-run', '--json',
        ], { cwd: projectRoot, env, encoding: 'utf8', maxBuffer: 16 * 1024 * 1024 }));
        assert.strictEqual(updated.summary.errorCount, 0);
        assert.strictEqual(updated.summary.checkedCount, 1);
        assert.strictEqual(updated.results[0].status, 'planned');
        const plan = updated.results[0].payload.plan;
        assert.strictEqual(plan.mode, 'legacy-compat');
        assert.deepStrictEqual(plan.legacyLanguages, ['typescript']);
        assert.deepStrictEqual(plan.includedComponentIds, ['locale:zh-cn']);
        assert.ok(plan.selectedModuleIds.includes('docs-zh-cn'));
        assert.ok(plan.selectedModuleIds.includes('framework-language'));
        assert.ok(!plan.selectedModuleIds.includes('hooks-runtime'));
        assert.strictEqual(plan.statePreview.request.hookConsent, 'declined');
        assert.strictEqual(fs.readFileSync(statePath, 'utf8'), stateBefore);
      } finally {
        cleanup(fixture);
      }
    })) passed += 1; else failed += 1;
  }

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
          hookConsent: 'declined',
        },
      },
    };

    assert.deepStrictEqual(buildInstallApplyArgs(record), [
      '--target', 'cursor',
      '--profile', 'developer',
      '--modules', 'platform-configs',
      '--with', 'component:alpha',
      '--without', 'component:beta',
      '--no-hooks',
    ]);
  })) passed += 1; else failed += 1;

  if (test('buildInstallApplyArgs infers enabled hooks for older install-state records', () => {
    const record = {
      adapter: { target: 'cursor', kind: 'project' },
      state: {
        target: { target: 'cursor' },
        request: {
          profile: 'core',
          modules: [],
          includeComponents: [],
          excludeComponents: [],
          legacyLanguages: [],
          legacyMode: false,
        },
        resolution: {
          selectedModules: ['rules-core', 'hooks-runtime'],
          skippedModules: [],
        },
        operations: [
          {
            kind: 'copy-file',
            moduleId: 'hooks-runtime',
            sourceRelativePath: '.cursor/hooks.json',
            destinationPath: '/tmp/project/.cursor/hooks.json',
          },
        ],
      },
    };

    assert.deepStrictEqual(buildInstallApplyArgs(record), [
      '--target', 'cursor',
      '--profile', 'core',
      '--enable-hooks',
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

  if (test('runAutoUpdate excludes residual legacy Antigravity records', () => {
    const homeDir = createTempDir('auto-update-home-');
    const projectRoot = createTempDir('auto-update-project-');
    const repoRoot = createTempDir('auto-update-repo-');

    try {
      ensureFakeRepo(repoRoot);
      const canonical = makeRecord({
        repoRoot,
        homeDir,
        projectRoot,
        adapter: { id: 'antigravity-project', target: 'antigravity', kind: 'project' },
        request: {
          profile: null,
          modules: [],
          includeComponents: [],
          excludeComponents: [],
          legacyLanguages: ['typescript'],
          legacyMode: true,
        },
        resolution: { selectedModules: ['legacy-antigravity-install'], skippedModules: [] },
        operations: [],
      });
      const legacy = {
        ...canonical,
        installStatePath: path.join(projectRoot, '.agent', 'ecc-install-state.json'),
        legacy: true,
      };
      const commands = [];

      const result = runAutoUpdate(
        {
          homeDir,
          projectRoot,
          repoRoot,
          dryRun: true,
        },
        {
          discoverInstalledStates: () => [canonical, legacy],
          runExternalCommand(command, args) {
            commands.push({ command, args });
            return {
              stdout: JSON.stringify({ dryRun: true, plan: {} }),
              stderr: '',
            };
          },
        }
      );

      assert.strictEqual(result.summary.checkedCount, 1);
      assert.strictEqual(result.summary.updatedCount, 1);
      assert.strictEqual(commands.length, 1);
      assert.strictEqual(commands[0].command, process.execPath);
    } finally {
      cleanup(homeDir);
      cleanup(projectRoot);
      cleanup(repoRoot);
    }
  })) passed += 1; else failed += 1;

  if (test('runAutoUpdate explains a legacy-only Antigravity install', () => {
    const homeDir = createTempDir('auto-update-home-');
    const projectRoot = createTempDir('auto-update-project-');
    const repoRoot = createTempDir('auto-update-repo-');

    try {
      ensureFakeRepo(repoRoot);
      const legacy = {
        ...makeRecord({
          repoRoot,
          homeDir,
          projectRoot,
          adapter: { id: 'antigravity-project', target: 'antigravity', kind: 'project' },
          request: {
            profile: null,
            modules: [],
            includeComponents: [],
            excludeComponents: [],
            legacyLanguages: ['typescript'],
            legacyMode: true,
          },
          resolution: { selectedModules: ['legacy-antigravity-install'], skippedModules: [] },
          operations: [],
        }),
        installStatePath: path.join(projectRoot, '.agent', 'ecc-install-state.json'),
        legacy: true,
      };
      const commands = [];

      const result = runAutoUpdate(
        { homeDir, projectRoot, repoRoot, dryRun: true },
        {
          discoverInstalledStates: () => [legacy],
          runExternalCommand(command, args) {
            commands.push({ command, args });
          },
        }
      );

      assert.deepStrictEqual(result.results, []);
      assert.strictEqual(result.summary.checkedCount, 0);
      assert.strictEqual(result.summary.updatedCount, 0);
      assert.strictEqual(result.summary.errorCount, 0);
      assert.strictEqual(commands.length, 0);
      assert.ok(result.warnings.some(warning => warning.includes(
        'Run the Antigravity installer once to migrate it to .agents'
      )));
    } finally {
      cleanup(homeDir);
      cleanup(projectRoot);
      cleanup(repoRoot);
    }
  })) passed += 1; else failed += 1;

  if (test('runAutoUpdate gives legacy-only OpenCode migration guidance', () => {
    const homeDir = createTempDir('auto-update-home-');
    const projectRoot = createTempDir('auto-update-project-');
    const repoRoot = createTempDir('auto-update-repo-');

    try {
      ensureFakeRepo(repoRoot);
      const legacy = {
        ...makeRecord({
          repoRoot,
          homeDir,
          projectRoot,
          adapter: { id: 'opencode-home', target: 'opencode', kind: 'home' },
          request: {
            profile: null,
            modules: ['workflow-quality'],
            includeComponents: [],
            excludeComponents: [],
            legacyLanguages: [],
            legacyMode: false,
          },
          resolution: { selectedModules: ['workflow-quality'], skippedModules: [] },
          operations: [],
        }),
        installStatePath: path.join(homeDir, '.opencode', 'ecc-install-state.json'),
        legacy: true,
        legacyLayout: 'opencode',
      };

      const result = runAutoUpdate(
        { homeDir, projectRoot, repoRoot, dryRun: true },
        { discoverInstalledStates: () => [legacy] }
      );

      assert.deepStrictEqual(result.results, []);
      assert.ok(result.warnings.some(warning => warning.includes(
        'Run the OpenCode installer once to migrate it to the configured OpenCode directory'
      )));
      assert.ok(result.warnings.every(warning => !warning.includes('Antigravity')));
    } finally {
      cleanup(homeDir);
      cleanup(projectRoot);
      cleanup(repoRoot);
    }
  })) passed += 1; else failed += 1;

  if (test('global --dry-run skips git pull and previews auto-update without mutating the repo', () => {
    const fixture = createTempDir('auto-update-global-dry-run-');
    const homeDir = path.join(fixture, 'home');
    const projectRoot = path.join(fixture, 'project');
    const realRepoRoot = path.resolve(__dirname, '..', '..');
    fs.mkdirSync(homeDir);
    fs.mkdirSync(projectRoot);

    try {
      const { localRepo, headBefore } = createBehindRemoteRepoFixture(fixture);
      seedCursorInstallState(projectRoot, headBefore);
      const inheritedEnv = Object.fromEntries(
        Object.entries(process.env).filter(([key]) => key !== 'ECC_DRY_RUN')
      );
      const baseEnv = { ...inheritedEnv, HOME: homeDir, USERPROFILE: homeDir };
      const previewRaw = execFileSync(process.execPath, [
        path.join(realRepoRoot, 'scripts', 'ecc.js'),
        '--dry-run', 'auto-update', '--target', 'cursor', '--repo-root', localRepo, '--json',
      ], { cwd: projectRoot, env: baseEnv, encoding: 'utf8', maxBuffer: 16 * 1024 * 1024 });
      const preview = JSON.parse(previewRaw);

      assert.strictEqual(preview.dryRun, true);
      assert.strictEqual(preview.results[0].status, 'planned');
      assert.strictEqual(preview.results[0].payload.dryRun, true);
      const headAfter = execFileSync('git', ['rev-parse', 'HEAD'], { cwd: localRepo, encoding: 'utf8' }).trim();
      assert.strictEqual(headAfter, headBefore);
      assert.strictEqual(fs.existsSync(path.join(localRepo, 'UPSTREAM.txt')), false);

      assert.throws(
        () => execFileSync(process.execPath, [
          path.join(realRepoRoot, 'scripts', 'auto-update.js'), '--json',
        ], { cwd: projectRoot, env: { ...baseEnv, ECC_DRY_RUN: 'yes' }, encoding: 'utf8', stdio: 'pipe' }),
        error => /ECC_DRY_RUN must be "1" or "0"/.test(error.stderr)
      );
    } finally {
      cleanup(fixture);
    }
  })) passed += 1; else failed += 1;

  console.log(`\nResults: Passed: ${passed}, Failed: ${failed}`);
  process.exit(failed > 0 ? 1 : 0);
}

runTests();
