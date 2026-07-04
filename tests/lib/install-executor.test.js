/**
 * Direct tests for scripts/lib/install-executor.js.
 */

'use strict';

const assert = require('assert');
const fs = require('fs');
const os = require('os');
const path = require('path');

const {
  applyInstallPlan,
  createLegacyCompatInstallPlan,
  createLegacyInstallPlan,
  createManifestInstallPlan,
  dedupeCopyFileOperations,
  listAvailableLanguages,
} = require('../../scripts/lib/install-executor');

const REPO_ROOT = path.resolve(__dirname, '..', '..');

function createTempDir(prefix) {
  return fs.mkdtempSync(path.join(os.tmpdir(), prefix));
}

function cleanup(dirPath) {
  fs.rmSync(dirPath, { recursive: true, force: true });
}

function writeFile(root, relativePath, content = '') {
  const filePath = path.join(root, relativePath);
  fs.mkdirSync(path.dirname(filePath), { recursive: true });
  fs.writeFileSync(filePath, content, 'utf8');
  return filePath;
}

function writeJson(root, relativePath, value) {
  writeFile(root, relativePath, `${JSON.stringify(value, null, 2)}\n`);
}

function operationFor(plan, suffix) {
  return plan.operations.find(operation => (
    operation.destinationPath.endsWith(suffix)
    || operation.sourceRelativePath.split(path.sep).join('/').endsWith(suffix.split(path.sep).join('/'))
  ));
}

function writeLegacySourceFixture(root) {
  writeJson(root, 'package.json', { version: '9.8.7' });
  writeFile(root, path.join('rules', 'common', 'coding-style.md'), '# Common\n');
  writeFile(root, path.join('rules', 'common', 'nested', 'shared.md'), '# Shared\n');
  writeFile(root, path.join('rules', 'common', 'node_modules', 'ignored.md'), '# Ignored\n');
  writeFile(root, path.join('rules', 'common', '.git', 'ignored.md'), '# Ignored\n');
  writeFile(root, path.join('rules', 'typescript', 'testing.md'), '# TS\n');
  writeFile(root, path.join('rules', 'python', 'testing.md'), '# Python\n');

  writeFile(root, path.join('.cursor', 'rules', 'common-style.md'), '# Cursor common\n');
  writeFile(root, path.join('.cursor', 'rules', 'typescript-style.md'), '# Cursor TS\n');
  writeFile(root, path.join('.cursor', 'rules', 'python-style.txt'), '# Not markdown\n');
  writeFile(root, path.join('.cursor', 'agents', 'planner.md'), '# Planner\n');
  writeFile(root, path.join('.cursor', 'skills', 'demo', 'SKILL.md'), '# Demo\n');
  writeFile(root, path.join('.cursor', 'commands', 'plan.md'), '# Plan\n');
  writeFile(root, path.join('.cursor', 'hooks', 'hook.js'), 'process.exit(0);\n');
  writeJson(root, path.join('.cursor', 'hooks.json'), { version: 1, hooks: {} });
  writeJson(root, '.mcp.json', { mcpServers: { github: { command: 'github-mcp' } } });

  writeFile(root, path.join('commands', 'plan.md'), '# Plan\n');
  writeFile(root, path.join('agents', 'architect.md'), '# Architect\n');
  writeFile(root, path.join('skills', 'demo', 'SKILL.md'), '# Demo\n');
}

function writeManifestSourceFixture(root) {
  writeJson(root, 'package.json', { version: '1.2.3' });
  writeJson(root, path.join('manifests', 'install-modules.json'), {
    version: 7,
    modules: [
      {
        id: 'fixture-core',
        kind: 'fixture',
        description: 'Fixture module',
        paths: [
          'rules',
          'src',
          'standalone.txt',
          'missing.txt',
          'skills/demo',
          path.join('runtime', 'ecc', 'install-state.json'),
          '.claude-plugin',
        ],
        targets: ['claude'],
        dependencies: [],
        defaultInstall: true,
        cost: 'light',
        stability: 'stable',
      },
    ],
  });
  writeJson(root, path.join('manifests', 'install-profiles.json'), {
    version: 1,
    profiles: {
      minimal: {
        description: 'Minimal fixture profile',
        modules: ['fixture-core'],
      },
    },
  });
  writeFile(root, path.join('src', 'app.js'), 'console.log("app");\n');
  writeFile(root, path.join('src', 'nested', 'feature.js'), 'console.log("feature");\n');
  writeFile(root, path.join('src', 'node_modules', 'ignored.js'), 'console.log("ignored");\n');
  writeFile(root, path.join('src', '.git', 'ignored.js'), 'console.log("ignored");\n');
  writeFile(root, path.join('src', 'nested', 'ecc-install-state.json'), '{}\n');
  writeFile(root, path.join('rules', 'common', 'coding-style.md'), '# Common\n');
  writeFile(root, path.join('skills', 'demo', 'SKILL.md'), '# Demo\n');
  writeFile(root, 'standalone.txt', 'standalone\n');
  writeFile(root, path.join('runtime', 'ecc', 'install-state.json'), '{}\n');
  writeJson(root, path.join('.claude-plugin', 'plugin.json'), { name: 'fixture' });
}

function test(name, fn) {
  try {
    fn();
    console.log(`  PASS ${name}`);
    return true;
  } catch (error) {
    console.log(`  FAIL ${name}`);
    console.log(`    Error: ${error.message}`);
    return false;
  }
}

function runTests() {
  console.log('\n=== Testing install-executor.js ===\n');

  let passed = 0;
  let failed = 0;

  if (test('lists legacy and local rule languages while ignoring common', () => {
    const sourceRoot = createTempDir('install-executor-source-');
    try {
      fs.mkdirSync(path.join(sourceRoot, 'rules', 'common'), { recursive: true });
      fs.mkdirSync(path.join(sourceRoot, 'rules', 'zig'), { recursive: true });

      const languages = listAvailableLanguages(sourceRoot);

      assert.ok(languages.includes('typescript'));
      assert.ok(languages.includes('ruby'));
      assert.ok(languages.includes('rails'));
      assert.ok(languages.includes('zig'));
      assert.ok(!languages.includes('common'));
      assert.deepStrictEqual([...languages].sort(), languages);
    } finally {
      cleanup(sourceRoot);
    }
  })) passed++; else failed++;

  if (test('rejects unknown legacy install targets before planning', () => {
    assert.throws(
      () => createLegacyInstallPlan({ target: 'not-a-target' }),
      /Unknown install target: not-a-target/
    );
  })) passed++; else failed++;

  if (test('plans Claude legacy rules with warnings and state preview', () => {
    const sourceRoot = createTempDir('install-executor-source-');
    const homeDir = createTempDir('install-executor-home-');
    const projectRoot = createTempDir('install-executor-project-');
    const claudeRulesDir = path.join(homeDir, 'custom-rules');
    try {
      writeLegacySourceFixture(sourceRoot);
      writeFile(homeDir, path.join('custom-rules', 'existing.md'), '# Existing\n');

      const plan = createLegacyInstallPlan({
        sourceRoot,
        homeDir,
        projectRoot,
        claudeRulesDir,
        target: 'claude',
        languages: ['typescript', 'missing-lang', '../bad'],
      });

      assert.strictEqual(plan.mode, 'legacy');
      assert.strictEqual(plan.target, 'claude');
      assert.strictEqual(plan.installRoot, claudeRulesDir);
      assert.ok(plan.warnings.some(warning => warning.includes('files may be overwritten')));
      assert.ok(plan.warnings.some(warning => warning.includes("rules/missing-lang/ does not exist")));
      assert.ok(plan.warnings.some(warning => warning.includes("Invalid language name '../bad'")));
      assert.ok(operationFor(plan, path.join('custom-rules', 'common', 'coding-style.md')));
      assert.ok(operationFor(plan, path.join('custom-rules', 'common', 'nested', 'shared.md')));
      assert.ok(operationFor(plan, path.join('custom-rules', 'typescript', 'testing.md')));
      assert.ok(!plan.operations.some(operation => operation.sourceRelativePath.includes('node_modules')));
      assert.ok(!plan.operations.some(operation => operation.sourceRelativePath.includes('.git')));
      assert.deepStrictEqual(plan.statePreview.request.legacyLanguages, ['typescript', 'missing-lang', '../bad']);
      assert.strictEqual(plan.statePreview.request.legacyMode, true);
      assert.strictEqual(plan.statePreview.source.repoVersion, '9.8.7');
      assert.strictEqual(plan.statePreview.source.manifestVersion, 1);
    } finally {
      cleanup(sourceRoot);
      cleanup(homeDir);
      cleanup(projectRoot);
    }
  })) passed++; else failed++;

  if (test('plans Claude legacy rules under the default ECC-managed rules directory', () => {
    const sourceRoot = createTempDir('install-executor-source-');
    const homeDir = createTempDir('install-executor-home-');
    const projectRoot = createTempDir('install-executor-project-');
    try {
      writeLegacySourceFixture(sourceRoot);
      writeFile(homeDir, path.join('.claude', 'rules', 'common', 'coding-style.md'), '# User custom rule\n');

      const plan = createLegacyInstallPlan({
        sourceRoot,
        homeDir,
        projectRoot,
        target: 'claude',
        languages: ['typescript'],
      });

      const managedRulesDir = path.join(homeDir, '.claude', 'rules', 'ecc');
      assert.strictEqual(plan.installRoot, managedRulesDir);
      assert.ok(operationFor(plan, path.join('.claude', 'rules', 'ecc', 'common', 'coding-style.md')));
      assert.ok(operationFor(plan, path.join('.claude', 'rules', 'ecc', 'typescript', 'testing.md')));
      assert.ok(!operationFor(plan, path.join('.claude', 'rules', 'common', 'coding-style.md')));
      assert.ok(!plan.warnings.some(warning => warning.includes('files may be overwritten')));
    } finally {
      cleanup(sourceRoot);
      cleanup(homeDir);
      cleanup(projectRoot);
    }
  })) passed++; else failed++;

  if (test('plans Cursor legacy assets and JSON merge payloads', () => {
    const sourceRoot = createTempDir('install-executor-source-');
    const projectRoot = createTempDir('install-executor-project-');
    const homeDir = createTempDir('install-executor-home-');
    try {
      writeLegacySourceFixture(sourceRoot);

      const plan = createLegacyInstallPlan({
        sourceRoot,
        projectRoot,
        homeDir,
        target: 'cursor',
        languages: ['typescript', 'ruby', 'bad/name'],
      });

      const targetRoot = path.join(projectRoot, '.cursor');
      assert.strictEqual(plan.installRoot, targetRoot);
      assert.ok(operationFor(plan, path.join('.cursor', 'rules', 'common-style.md')));
      assert.ok(operationFor(plan, path.join('.cursor', 'rules', 'typescript-style.md')));
      assert.ok(operationFor(plan, path.join('.cursor', 'agents', 'ecc-planner.md')));
      assert.ok(!plan.operations.some(operation => (
        operation.destinationPath.endsWith(path.join('.cursor', 'agents', 'planner.md'))
      )));
      assert.ok(operationFor(plan, path.join('.cursor', 'skills', 'demo', 'SKILL.md')));
      assert.ok(operationFor(plan, path.join('.cursor', 'commands', 'plan.md')));
      assert.ok(operationFor(plan, path.join('.cursor', 'hooks', 'hook.js')));
      assert.ok(operationFor(plan, path.join('.cursor', 'hooks.json')));
      const mergeOperation = plan.operations.find(operation => operation.kind === 'merge-json');
      assert.ok(mergeOperation, 'Should merge shared MCP config into Cursor');
      assert.deepStrictEqual(mergeOperation.mergePayload.mcpServers.github.command, 'github-mcp');
      assert.ok(plan.warnings.some(warning => warning.includes("No Cursor rules for 'ruby'")));
      assert.ok(plan.warnings.some(warning => warning.includes("Invalid language name 'bad/name'")));
      assert.strictEqual(plan.statePreview.target.id, 'cursor-project');
    } finally {
      cleanup(sourceRoot);
      cleanup(projectRoot);
      cleanup(homeDir);
    }
  })) passed++; else failed++;

  if (test('surfaces invalid Cursor MCP JSON while planning legacy install', () => {
    const sourceRoot = createTempDir('install-executor-source-');
    const projectRoot = createTempDir('install-executor-project-');
    const homeDir = createTempDir('install-executor-home-');
    try {
      writeLegacySourceFixture(sourceRoot);
      fs.writeFileSync(path.join(sourceRoot, '.mcp.json'), '[]\n', 'utf8');

      assert.throws(
        () => createLegacyInstallPlan({ sourceRoot, projectRoot, homeDir, target: 'cursor' }),
        /Invalid \.mcp\.json/
      );
    } finally {
      cleanup(sourceRoot);
      cleanup(projectRoot);
      cleanup(homeDir);
    }
  })) passed++; else failed++;

  if (test('plans Antigravity legacy files with flattened rule names', () => {
    const sourceRoot = createTempDir('install-executor-source-');
    const projectRoot = createTempDir('install-executor-project-');
    const homeDir = createTempDir('install-executor-home-');
    try {
      writeLegacySourceFixture(sourceRoot);
      writeFile(projectRoot, path.join('.agent', 'rules', 'existing.md'), '# Existing\n');

      const plan = createLegacyInstallPlan({
        sourceRoot,
        projectRoot,
        homeDir,
        target: 'antigravity',
        languages: ['typescript', 'missing-lang', 'bad/name'],
      });

      assert.strictEqual(plan.installRoot, path.join(projectRoot, '.agent'));
      assert.ok(plan.warnings.some(warning => warning.includes('files may be overwritten')));
      assert.ok(plan.warnings.some(warning => warning.includes("rules/missing-lang/ does not exist")));
      assert.ok(plan.warnings.some(warning => warning.includes("Invalid language name 'bad/name'")));
      assert.ok(operationFor(plan, path.join('.agent', 'rules', 'common-coding-style.md')));
      assert.ok(operationFor(plan, path.join('.agent', 'rules', 'typescript-testing.md')));
      assert.ok(operationFor(plan, path.join('.agent', 'workflows', 'plan.md')));
      assert.ok(operationFor(plan, path.join('.agent', 'skills', 'architect.md')));
      assert.ok(operationFor(plan, path.join('.agent', 'skills', 'demo', 'SKILL.md')));
      assert.strictEqual(plan.statePreview.target.id, 'antigravity-project');
    } finally {
      cleanup(sourceRoot);
      cleanup(projectRoot);
      cleanup(homeDir);
    }
  })) passed++; else failed++;

  if (test('materializes manifest scaffold operations and filters generated runtime state', () => {
    const sourceRoot = createTempDir('install-executor-source-');
    const homeDir = createTempDir('install-executor-home-');
    try {
      writeManifestSourceFixture(sourceRoot);

      const plan = createManifestInstallPlan({
        sourceRoot,
        homeDir,
        target: 'claude',
        profileId: 'minimal',
        requestIncludeComponentIds: ['capability:fixture'],
        requestExcludeComponentIds: ['capability:skip'],
        warnings: ['fixture warning'],
      });

      const normalizedSources = plan.operations.map(operation => (
        operation.sourceRelativePath.split(path.sep).join('/')
      ));
      assert.ok(normalizedSources.includes('src/app.js'));
      assert.ok(normalizedSources.includes('src/nested/feature.js'));
      assert.ok(normalizedSources.includes('rules/common/coding-style.md'));
      assert.ok(normalizedSources.includes('skills/demo/SKILL.md'));
      assert.ok(normalizedSources.includes('standalone.txt'));
      assert.ok(normalizedSources.includes('.claude-plugin/plugin.json'));
      assert.ok(!normalizedSources.includes('missing.txt'));
      assert.ok(!normalizedSources.includes('runtime/ecc/install-state.json'));
      assert.ok(!normalizedSources.includes('src/nested/ecc-install-state.json'));
      assert.ok(!normalizedSources.some(source => source.includes('node_modules')));
      assert.ok(!normalizedSources.some(source => source.includes('.git')));
      assert.ok(plan.operations.some(operation => (
        operation.sourceRelativePath === path.join('.claude-plugin', 'plugin.json')
        && operation.destinationPath === path.join(homeDir, '.claude', 'plugin.json')
      )));
      assert.ok(plan.operations.some(operation => (
        operation.sourceRelativePath === path.join('rules', 'common', 'coding-style.md')
        && operation.destinationPath === path.join(homeDir, '.claude', 'rules', 'ecc', 'common', 'coding-style.md')
      )));
      assert.ok(plan.operations.some(operation => (
        operation.sourceRelativePath === path.join('skills', 'demo', 'SKILL.md')
        && operation.destinationPath === path.join(homeDir, '.claude', 'skills', 'ecc', 'demo', 'SKILL.md')
      )));
      assert.deepStrictEqual(plan.warnings, ['fixture warning']);
      assert.strictEqual(plan.statePreview.request.profile, 'minimal');
      assert.deepStrictEqual(plan.statePreview.request.includeComponents, ['capability:fixture']);
      assert.deepStrictEqual(plan.statePreview.request.excludeComponents, ['capability:skip']);
      assert.strictEqual(plan.statePreview.source.repoVersion, '1.2.3');
      assert.strictEqual(plan.statePreview.source.manifestVersion, 7);
    } finally {
      cleanup(sourceRoot);
      cleanup(homeDir);
    }
  })) passed++; else failed++;

  if (test('creates legacy compatibility manifest plans from language selections', () => {
    const projectRoot = createTempDir('install-executor-project-');
    const homeDir = createTempDir('install-executor-home-');
    try {
      const plan = createLegacyCompatInstallPlan({
        sourceRoot: REPO_ROOT,
        projectRoot,
        homeDir,
        target: 'cursor',
        legacyLanguages: ['rust'],
      });

      assert.strictEqual(plan.mode, 'legacy-compat');
      assert.deepStrictEqual(plan.legacyLanguages, ['rust']);
      assert.ok(plan.selectedModuleIds.includes('framework-language'));
      assert.strictEqual(plan.statePreview.request.legacyMode, true);
      assert.deepStrictEqual(plan.statePreview.request.legacyLanguages, ['rust']);
      assert.deepStrictEqual(plan.statePreview.request.modules, []);
    } finally {
      cleanup(projectRoot);
      cleanup(homeDir);
    }
  })) passed++; else failed++;

  if (test('applyInstallPlan re-export applies a manifest plan and writes install state', () => {
    const sourceRoot = createTempDir('install-executor-source-');
    const homeDir = createTempDir('install-executor-home-');
    try {
      writeManifestSourceFixture(sourceRoot);
      const plan = createManifestInstallPlan({
        sourceRoot,
        homeDir,
        target: 'claude',
        profileId: 'minimal',
      });

      const applied = applyInstallPlan(plan);

      assert.strictEqual(applied.applied, true);
      assert.ok(fs.existsSync(path.join(homeDir, '.claude', 'rules', 'ecc', 'common', 'coding-style.md')));
      assert.ok(fs.existsSync(path.join(homeDir, '.claude', 'skills', 'ecc', 'demo', 'SKILL.md')));
      assert.ok(fs.existsSync(path.join(homeDir, '.claude', 'src', 'app.js')));
      assert.ok(fs.existsSync(path.join(homeDir, '.claude', 'standalone.txt')));
      assert.ok(fs.existsSync(path.join(homeDir, '.claude', 'plugin.json')));
      const state = JSON.parse(fs.readFileSync(path.join(homeDir, '.claude', 'ecc', 'install-state.json'), 'utf8'));
      assert.strictEqual(state.request.profile, 'minimal');
      assert.deepStrictEqual(state.resolution.selectedModules, ['fixture-core']);
    } finally {
      cleanup(sourceRoot);
      cleanup(homeDir);
    }
  })) passed++; else failed++;

  if (test('dedupeCopyFileOperations keeps the last writer per destination (issue #2414)', () => {
    // Mirrors the OpenCode command scenario: a generic commands/<name>.md source
    // (preserve-relative-path) and an override .opencode/commands/<name>.md source
    // (sync-root-children) both write the same destination. Before the fix both
    // ops were recorded, so `doctor` reported perpetual drift and `repair`
    // clobbered the override. Only the last writer (the override) should survive.
    const dest = '/home/.opencode/commands/build-fix.md';
    const operations = [
      { kind: 'copy-file', sourceRelativePath: 'commands/build-fix.md', destinationPath: dest, strategy: 'preserve-relative-path' },
      { kind: 'copy-file', sourceRelativePath: '.opencode/commands/build-fix.md', destinationPath: dest, strategy: 'sync-root-children' },
      { kind: 'copy-file', sourceRelativePath: 'commands/other.md', destinationPath: '/home/.opencode/commands/other.md', strategy: 'preserve-relative-path' },
    ];

    const deduped = dedupeCopyFileOperations(operations);

    const destinations = deduped
      .filter(operation => operation.kind === 'copy-file')
      .map(operation => operation.destinationPath);
    assert.deepStrictEqual(
      destinations,
      [dest, '/home/.opencode/commands/other.md'],
      'each copy-file destination must appear exactly once'
    );
    const survivor = deduped.find(operation => operation.destinationPath === dest);
    assert.strictEqual(
      survivor.sourceRelativePath,
      '.opencode/commands/build-fix.md',
      'the last writer (override) must win, not the generic source'
    );
  })) passed++; else failed++;

  if (test('dedupeCopyFileOperations leaves non copy-file operations and order intact', () => {
    // merge-json operations legitimately accumulate into a shared config file, so
    // multiple writes to one destination must be preserved; only redundant
    // copy-file writes are collapsed, and surviving ops keep their relative order.
    const mergeDest = '/home/.opencode/opencode.json';
    const operations = [
      { kind: 'merge-json', sourceRelativePath: 'a.json', destinationPath: mergeDest },
      { kind: 'copy-file', sourceRelativePath: 'src/x.md', destinationPath: '/home/x.md' },
      { kind: 'merge-json', sourceRelativePath: 'b.json', destinationPath: mergeDest },
      { kind: 'copy-file', sourceRelativePath: 'other/x.md', destinationPath: '/home/x.md' },
      { kind: 'remove', destinationPath: '/home/legacy.md' },
    ];

    const deduped = dedupeCopyFileOperations(operations);

    assert.deepStrictEqual(
      deduped.map(operation => `${operation.kind}:${operation.sourceRelativePath || operation.destinationPath}`),
      ['merge-json:a.json', 'merge-json:b.json', 'copy-file:other/x.md', 'remove:/home/legacy.md'],
      'both merge-json writes and the remove op survive; only the shadowed copy-file is dropped, order preserved'
    );
  })) passed++; else failed++;

  console.log(`\nResults: Passed: ${passed}, Failed: ${failed}`);
  process.exit(failed > 0 ? 1 : 0);
}

runTests();
