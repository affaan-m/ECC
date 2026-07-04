/**
 * Tests for scripts/lib/install-lifecycle.js
 */

const assert = require('assert');
const fs = require('fs');
const os = require('os');
const path = require('path');

const {
  buildDoctorReport,
  discoverInstalledStates,
  normalizeTargets,
  repairInstalledStates,
  uninstallInstalledStates,
} = require('../../scripts/lib/install-lifecycle');
const { getInstallTargetAdapter } = require('../../scripts/lib/install-targets/registry');
const {
  createInstallState,
  writeInstallState,
} = require('../../scripts/lib/install-state');

const REPO_ROOT = path.join(__dirname, '..', '..');
const CURRENT_PACKAGE_VERSION = JSON.parse(
  fs.readFileSync(path.join(REPO_ROOT, 'package.json'), 'utf8')
).version;
const CURRENT_MANIFEST_VERSION = JSON.parse(
  fs.readFileSync(path.join(REPO_ROOT, 'manifests', 'install-modules.json'), 'utf8')
).version;

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

function writeState(filePath, options) {
  const state = createInstallState(options);
  writeInstallState(filePath, state);
  return state;
}

function createCursorStateOptions(projectRoot, overrides = {}) {
  const targetRoot = overrides.targetRoot || path.join(projectRoot, '.cursor');
  const installStatePath = overrides.installStatePath || path.join(targetRoot, 'ecc-install-state.json');

  return {
    adapter: { id: 'cursor-project', target: 'cursor', kind: 'project' },
    targetRoot,
    installStatePath,
    request: {
      profile: null,
      modules: [],
      includeComponents: [],
      excludeComponents: [],
      legacyLanguages: ['typescript'],
      legacyMode: true,
      ...(overrides.request || {}),
    },
    resolution: {
      selectedModules: ['legacy-cursor-install'],
      skippedModules: [],
      ...(overrides.resolution || {}),
    },
    operations: overrides.operations || [],
    source: {
      repoVersion: CURRENT_PACKAGE_VERSION,
      repoCommit: 'abc123',
      manifestVersion: CURRENT_MANIFEST_VERSION,
      ...(overrides.source || {}),
    },
  };
}

function writeCursorState(projectRoot, overrides = {}) {
  const options = createCursorStateOptions(projectRoot, overrides);
  writeState(options.installStatePath, options);
  return {
    targetRoot: options.targetRoot,
    installStatePath: options.installStatePath,
    state: options,
  };
}

function createOpencodeStateOptions(homeDir, overrides = {}) {
  const targetRoot = overrides.targetRoot || path.join(homeDir, '.opencode');
  const installStatePath = overrides.installStatePath || path.join(targetRoot, 'ecc-install-state.json');

  return {
    adapter: { id: 'opencode-home', target: 'opencode', kind: 'home' },
    targetRoot,
    installStatePath,
    request: {
      profile: null,
      modules: ['commands-core'],
      includeComponents: [],
      excludeComponents: [],
      legacyLanguages: [],
      legacyMode: false,
      ...(overrides.request || {}),
    },
    resolution: {
      selectedModules: ['commands-core'],
      skippedModules: [],
      ...(overrides.resolution || {}),
    },
    operations: overrides.operations || [],
    source: {
      repoVersion: CURRENT_PACKAGE_VERSION,
      repoCommit: 'abc123',
      manifestVersion: CURRENT_MANIFEST_VERSION,
      ...(overrides.source || {}),
    },
  };
}

function writeOpencodeState(homeDir, overrides = {}) {
  const options = createOpencodeStateOptions(homeDir, overrides);
  writeState(options.installStatePath, options);
  return {
    targetRoot: options.targetRoot,
    installStatePath: options.installStatePath,
    state: options,
  };
}

function withTemporarilyMovedPath(filePath, callback) {
  if (!fs.existsSync(filePath)) {
    try {
      return callback(null);
    } finally {
      if (fs.existsSync(filePath)) {
        fs.rmSync(filePath, { recursive: true, force: true });
      }
    }
  }

  const backupPath = `${filePath}.backup-${process.pid}-${Date.now()}`;
  fs.renameSync(filePath, backupPath);

  try {
    return callback(backupPath);
  } finally {
    if (fs.existsSync(filePath)) {
      fs.rmSync(filePath, { recursive: true, force: true });
    }
    if (fs.existsSync(backupPath)) {
      fs.renameSync(backupPath, filePath);
    }
  }
}

function managedOperation(kind, destinationPath, overrides = {}) {
  return {
    kind,
    moduleId: 'test-module',
    sourceRelativePath: 'rules/common/coding-style.md',
    destinationPath,
    strategy: kind,
    ownership: 'managed',
    scaffoldOnly: false,
    ...overrides,
  };
}

function runTests() {
  console.log('\n=== Testing install-lifecycle.js ===\n');

  let passed = 0;
  let failed = 0;

  if (test('normalizes default targets and dedupes adapter aliases', () => {
    const defaultTargets = normalizeTargets();

    assert.ok(defaultTargets.includes('claude'));
    assert.ok(defaultTargets.includes('cursor'));
    assert.ok(defaultTargets.includes('codex'));
    assert.deepStrictEqual(
      normalizeTargets(['cursor-project', 'cursor', 'claude-home', 'claude']),
      ['cursor', 'claude']
    );
  })) passed++; else failed++;

  if (test('discovers installed states for multiple targets in the current context', () => {
    const homeDir = createTempDir('install-lifecycle-home-');
    const projectRoot = createTempDir('install-lifecycle-project-');

    try {
      const claudeStatePath = path.join(homeDir, '.claude', 'ecc', 'install-state.json');
      const cursorStatePath = path.join(projectRoot, '.cursor', 'ecc-install-state.json');

      writeState(claudeStatePath, {
        adapter: { id: 'claude-home', target: 'claude', kind: 'home' },
        targetRoot: path.join(homeDir, '.claude'),
        installStatePath: claudeStatePath,
        request: {
          profile: null,
          modules: [],
          legacyLanguages: ['typescript'],
          legacyMode: true,
        },
        resolution: {
          selectedModules: ['legacy-claude-rules'],
          skippedModules: [],
        },
        operations: [],
        source: {
          repoVersion: CURRENT_PACKAGE_VERSION,
          repoCommit: 'abc123',
          manifestVersion: CURRENT_MANIFEST_VERSION,
        },
      });

      writeState(cursorStatePath, {
        adapter: { id: 'cursor-project', target: 'cursor', kind: 'project' },
        targetRoot: path.join(projectRoot, '.cursor'),
        installStatePath: cursorStatePath,
        request: {
          profile: 'core',
          modules: [],
          legacyLanguages: [],
          legacyMode: false,
        },
        resolution: {
          selectedModules: ['rules-core', 'platform-configs'],
          skippedModules: [],
        },
        operations: [],
        source: {
          repoVersion: CURRENT_PACKAGE_VERSION,
          repoCommit: 'def456',
          manifestVersion: CURRENT_MANIFEST_VERSION,
        },
      });

      const records = discoverInstalledStates({
        homeDir,
        projectRoot,
        targets: ['claude', 'cursor'],
      });

      assert.strictEqual(records.length, 2);
      assert.strictEqual(records[0].exists, true);
      assert.strictEqual(records[1].exists, true);
      assert.strictEqual(records[0].state.target.id, 'claude-home');
      assert.strictEqual(records[1].state.target.id, 'cursor-project');
    } finally {
      cleanup(homeDir);
      cleanup(projectRoot);
    }
  })) passed++; else failed++;

  if (test('discovers missing and invalid install-state records', () => {
    const homeDir = createTempDir('install-lifecycle-home-');
    const projectRoot = createTempDir('install-lifecycle-project-');

    try {
      let records = discoverInstalledStates({
        homeDir,
        projectRoot,
        targets: ['cursor'],
      });

      assert.strictEqual(records.length, 1);
      assert.strictEqual(records[0].exists, false);
      assert.strictEqual(records[0].state, null);
      assert.strictEqual(records[0].error, null);

      const targetRoot = path.join(projectRoot, '.cursor');
      const statePath = path.join(targetRoot, 'ecc-install-state.json');
      fs.mkdirSync(targetRoot, { recursive: true });
      fs.writeFileSync(statePath, '{not-json', 'utf8');

      records = discoverInstalledStates({
        homeDir,
        projectRoot,
        targets: ['cursor'],
      });

      assert.strictEqual(records[0].exists, true);
      assert.strictEqual(records[0].state, null);
      assert.ok(records[0].error.includes('Failed to read install-state'));
    } finally {
      cleanup(homeDir);
      cleanup(projectRoot);
    }
  })) passed++; else failed++;

  if (test('doctor reports missing managed files as an error', () => {
    const homeDir = createTempDir('install-lifecycle-home-');
    const projectRoot = createTempDir('install-lifecycle-project-');

    try {
      const targetRoot = path.join(projectRoot, '.cursor');
      const statePath = path.join(targetRoot, 'ecc-install-state.json');
      fs.mkdirSync(targetRoot, { recursive: true });

      writeState(statePath, {
        adapter: { id: 'cursor-project', target: 'cursor', kind: 'project' },
        targetRoot,
        installStatePath: statePath,
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
        operations: [
          {
            kind: 'copy-file',
            moduleId: 'platform-configs',
            sourceRelativePath: '.cursor/hooks.json',
            destinationPath: path.join(targetRoot, 'hooks.json'),
            strategy: 'sync-root-children',
            ownership: 'managed',
            scaffoldOnly: false,
          },
        ],
        source: {
          repoVersion: CURRENT_PACKAGE_VERSION,
          repoCommit: 'abc123',
          manifestVersion: CURRENT_MANIFEST_VERSION,
        },
      });

      const report = buildDoctorReport({
        repoRoot: REPO_ROOT,
        homeDir,
        projectRoot,
        targets: ['cursor'],
      });

      assert.strictEqual(report.results.length, 1);
      assert.strictEqual(report.results[0].status, 'error');
      assert.ok(report.results[0].issues.some(issue => issue.code === 'missing-managed-files'));
    } finally {
      cleanup(homeDir);
      cleanup(projectRoot);
    }
  })) passed++; else failed++;

  if (test('doctor reports target mismatches, missing sources, unverified operations, and version drift', () => {
    const homeDir = createTempDir('install-lifecycle-home-');
    const projectRoot = createTempDir('install-lifecycle-project-');

    try {
      const actualTargetRoot = path.join(projectRoot, '.cursor');
      const actualStatePath = path.join(actualTargetRoot, 'ecc-install-state.json');
      const recordedTargetRoot = path.join(projectRoot, '.old-cursor');
      const recordedStatePath = path.join(recordedTargetRoot, 'state.json');
      const copyDestination = path.join(actualTargetRoot, 'rules', 'missing-source.md');
      const customDestination = path.join(actualTargetRoot, 'custom.txt');

      fs.mkdirSync(path.dirname(copyDestination), { recursive: true });
      fs.writeFileSync(copyDestination, 'managed copy\n');
      fs.writeFileSync(customDestination, 'custom\n');

      writeState(actualStatePath, createCursorStateOptions(projectRoot, {
        targetRoot: recordedTargetRoot,
        installStatePath: recordedStatePath,
        request: {
          profile: 'missing-profile',
          legacyLanguages: [],
          legacyMode: false,
        },
        resolution: {
          selectedModules: [],
          skippedModules: [],
        },
        source: {
          repoVersion: '0.0.1',
          manifestVersion: CURRENT_MANIFEST_VERSION + 100,
        },
        operations: [
          managedOperation('copy-file', copyDestination, {
            sourceRelativePath: 'missing/source.md',
            strategy: 'copy-file',
          }),
          managedOperation('custom-kind', customDestination),
        ],
      }));

      const report = buildDoctorReport({
        repoRoot: REPO_ROOT,
        homeDir,
        projectRoot,
        targets: ['cursor'],
      });
      const codes = report.results[0].issues.map(issue => issue.code);

      assert.strictEqual(report.results[0].status, 'error');
      assert.ok(codes.includes('missing-target-root'));
      assert.ok(codes.includes('target-root-mismatch'));
      assert.ok(codes.includes('install-state-path-mismatch'));
      assert.ok(codes.includes('missing-source-files'));
      assert.ok(codes.includes('unverified-managed-operations'));
      assert.ok(codes.includes('manifest-version-mismatch'));
      assert.ok(codes.includes('repo-version-mismatch'));
      assert.ok(codes.includes('resolution-unavailable'));
      assert.strictEqual(report.summary.checkedCount, 1);
      assert.ok(report.summary.errorCount >= 3);
      assert.ok(report.summary.warningCount >= 4);
    } finally {
      cleanup(homeDir);
      cleanup(projectRoot);
    }
  })) passed++; else failed++;

  if (test('doctor verifies render-template and merge-json operations by content', () => {
    const homeDir = createTempDir('install-lifecycle-home-');
    const projectRoot = createTempDir('install-lifecycle-project-');

    try {
      const targetRoot = path.join(projectRoot, '.cursor');
      const templatePath = path.join(targetRoot, 'generated.txt');
      const jsonPath = path.join(targetRoot, 'settings.json');
      fs.mkdirSync(targetRoot, { recursive: true });
      fs.writeFileSync(templatePath, 'generated\n');
      fs.writeFileSync(jsonPath, JSON.stringify({
        keep: true,
        nested: {
          managed: true,
          extra: true,
        },
      }, null, 2));

      writeCursorState(projectRoot, {
        operations: [
          managedOperation('render-template', templatePath, {
            renderedContent: 'generated\n',
          }),
          managedOperation('merge-json', jsonPath, {
            mergePayload: {
              nested: {
                managed: true,
              },
            },
          }),
        ],
      });

      const report = buildDoctorReport({
        repoRoot: REPO_ROOT,
        homeDir,
        projectRoot,
        targets: ['cursor'],
      });

      assert.strictEqual(report.results[0].status, 'ok');
      assert.strictEqual(report.results[0].issues.length, 0);
    } finally {
      cleanup(homeDir);
      cleanup(projectRoot);
    }
  })) passed++; else failed++;

  if (test('doctor classifies remove, unverified template/json, and invalid JSON operation health', () => {
    const homeDir = createTempDir('install-lifecycle-home-');
    const projectRoot = createTempDir('install-lifecycle-project-');

    try {
      const targetRoot = path.join(projectRoot, '.cursor');
      const templatePath = path.join(targetRoot, 'template.txt');
      const missingPayloadJsonPath = path.join(targetRoot, 'missing-payload.json');
      const invalidJsonPath = path.join(targetRoot, 'invalid.json');
      const removedPath = path.join(targetRoot, 'already-removed.txt');
      fs.mkdirSync(targetRoot, { recursive: true });
      fs.writeFileSync(templatePath, 'generated\n');
      fs.writeFileSync(missingPayloadJsonPath, '{"managed":true}\n');
      fs.writeFileSync(invalidJsonPath, '{not-json', 'utf8');

      writeCursorState(projectRoot, {
        operations: [
          managedOperation('remove', removedPath),
          managedOperation('render-template', templatePath),
          managedOperation('merge-json', missingPayloadJsonPath),
          managedOperation('merge-json', invalidJsonPath, {
            mergePayload: { managed: true },
          }),
        ],
      });

      const report = buildDoctorReport({
        repoRoot: REPO_ROOT,
        homeDir,
        projectRoot,
        targets: ['cursor'],
      });
      const codes = report.results[0].issues.map(issue => issue.code);

      assert.strictEqual(report.results[0].status, 'warning');
      assert.ok(codes.includes('unverified-managed-operations'));
      assert.ok(codes.includes('drifted-managed-files'));
      assert.ok(!report.results[0].issues.some(issue => issue.code === 'missing-managed-files'));
    } finally {
      cleanup(homeDir);
      cleanup(projectRoot);
    }
  })) passed++; else failed++;

  if (test('doctor reports invalid install-state files as errors', () => {
    const homeDir = createTempDir('install-lifecycle-home-');
    const projectRoot = createTempDir('install-lifecycle-project-');

    try {
      const statePath = path.join(projectRoot, '.cursor', 'ecc-install-state.json');
      fs.mkdirSync(path.dirname(statePath), { recursive: true });
      fs.writeFileSync(statePath, '{"schemaVersion":"wrong"}\n');

      const report = buildDoctorReport({
        repoRoot: REPO_ROOT,
        homeDir,
        projectRoot,
        targets: ['cursor'],
      });

      assert.strictEqual(report.results[0].status, 'error');
      assert.ok(report.results[0].issues.some(issue => issue.code === 'invalid-install-state'));
    } finally {
      cleanup(homeDir);
      cleanup(projectRoot);
    }
  })) passed++; else failed++;

  if (test('doctor reports a healthy legacy install when managed files are present', () => {
    const homeDir = createTempDir('install-lifecycle-home-');
    const projectRoot = createTempDir('install-lifecycle-project-');

    try {
      const targetRoot = path.join(homeDir, '.claude');
      const statePath = path.join(targetRoot, 'ecc', 'install-state.json');
      const managedFile = path.join(targetRoot, 'rules', 'common', 'coding-style.md');
      const sourceContent = fs.readFileSync(path.join(REPO_ROOT, 'rules', 'common', 'coding-style.md'), 'utf8');
      fs.mkdirSync(path.dirname(managedFile), { recursive: true });
      fs.writeFileSync(managedFile, sourceContent);

      writeState(statePath, {
        adapter: { id: 'claude-home', target: 'claude', kind: 'home' },
        targetRoot,
        installStatePath: statePath,
        request: {
          profile: null,
          modules: [],
          legacyLanguages: ['typescript'],
          legacyMode: true,
        },
        resolution: {
          selectedModules: ['legacy-claude-rules'],
          skippedModules: [],
        },
        operations: [
          {
            kind: 'copy-file',
            moduleId: 'legacy-claude-rules',
            sourceRelativePath: 'rules/common/coding-style.md',
            destinationPath: managedFile,
            strategy: 'preserve-relative-path',
            ownership: 'managed',
            scaffoldOnly: false,
          },
        ],
        source: {
          repoVersion: CURRENT_PACKAGE_VERSION,
          repoCommit: 'abc123',
          manifestVersion: CURRENT_MANIFEST_VERSION,
        },
      });

      const report = buildDoctorReport({
        repoRoot: REPO_ROOT,
        homeDir,
        projectRoot,
        targets: ['claude'],
      });

      assert.strictEqual(report.results.length, 1);
      assert.strictEqual(report.results[0].status, 'ok');
      assert.strictEqual(report.results[0].issues.length, 0);
    } finally {
      cleanup(homeDir);
      cleanup(projectRoot);
    }
  })) passed++; else failed++;

  if (test('repair dry-run reports planned copy repairs without writing files', () => {
    const homeDir = createTempDir('install-lifecycle-home-');
    const projectRoot = createTempDir('install-lifecycle-project-');

    try {
      const targetRoot = path.join(projectRoot, '.cursor');
      const destinationPath = path.join(targetRoot, 'rules', 'coding-style.md');
      writeCursorState(projectRoot, {
        operations: [
          managedOperation('copy-file', destinationPath, {
            sourceRelativePath: 'rules/common/coding-style.md',
            strategy: 'copy-file',
          }),
        ],
      });

      const result = repairInstalledStates({
        repoRoot: REPO_ROOT,
        homeDir,
        projectRoot,
        targets: ['cursor'],
        dryRun: true,
      });

      assert.strictEqual(result.dryRun, true);
      assert.strictEqual(result.results[0].status, 'planned');
      assert.deepStrictEqual(result.results[0].plannedRepairs, [destinationPath]);
      assert.ok(!fs.existsSync(destinationPath));
    } finally {
      cleanup(homeDir);
      cleanup(projectRoot);
    }
  })) passed++; else failed++;

  if (test('repair copies missing managed files from recorded source paths', () => {
    const homeDir = createTempDir('install-lifecycle-home-');
    const projectRoot = createTempDir('install-lifecycle-project-');

    try {
      const targetRoot = path.join(projectRoot, '.cursor');
      const destinationPath = path.join(targetRoot, 'rules', 'coding-style.md');
      const sourcePath = path.join(REPO_ROOT, 'rules', 'common', 'coding-style.md');
      writeCursorState(projectRoot, {
        operations: [
          managedOperation('copy-file', destinationPath, {
            sourceRelativePath: 'rules/common/coding-style.md',
            strategy: 'copy-file',
          }),
        ],
      });

      const result = repairInstalledStates({
        repoRoot: REPO_ROOT,
        homeDir,
        projectRoot,
        targets: ['cursor'],
      });

      assert.strictEqual(result.results[0].status, 'repaired');
      assert.ok(fs.readFileSync(destinationPath).equals(fs.readFileSync(sourcePath)));
    } finally {
      cleanup(homeDir);
      cleanup(projectRoot);
    }
  })) passed++; else failed++;

  if (test('repair reports invalid states, missing sources, unsupported operations, and no-op refreshes', () => {
    const homeDir = createTempDir('install-lifecycle-home-');
    const invalidProjectRoot = createTempDir('install-lifecycle-invalid-');
    const missingSourceProjectRoot = createTempDir('install-lifecycle-missing-source-');
    const unsupportedProjectRoot = createTempDir('install-lifecycle-unsupported-');
    const okProjectRoot = createTempDir('install-lifecycle-ok-');

    try {
      const invalidStatePath = path.join(invalidProjectRoot, '.cursor', 'ecc-install-state.json');
      fs.mkdirSync(path.dirname(invalidStatePath), { recursive: true });
      fs.writeFileSync(invalidStatePath, '{"schemaVersion":"wrong"}\n');

      let result = repairInstalledStates({
        repoRoot: REPO_ROOT,
        homeDir,
        projectRoot: invalidProjectRoot,
        targets: ['cursor'],
      });
      assert.strictEqual(result.results[0].status, 'error');
      assert.ok(result.results[0].error.includes('Invalid install-state'));

      const missingDestination = path.join(missingSourceProjectRoot, '.cursor', 'rules', 'missing.md');
      fs.mkdirSync(path.dirname(missingDestination), { recursive: true });
      fs.writeFileSync(missingDestination, 'managed\n');
      writeCursorState(missingSourceProjectRoot, {
        operations: [
          managedOperation('copy-file', missingDestination, {
            sourceRelativePath: 'missing/source.md',
            strategy: 'copy-file',
          }),
        ],
      });
      result = repairInstalledStates({
        repoRoot: REPO_ROOT,
        homeDir,
        projectRoot: missingSourceProjectRoot,
        targets: ['cursor'],
      });
      assert.strictEqual(result.results[0].status, 'error');
      assert.ok(result.results[0].error.includes('Missing source file(s)'));

      const unsupportedDestination = path.join(unsupportedProjectRoot, '.cursor', 'custom.txt');
      writeCursorState(unsupportedProjectRoot, {
        operations: [
          managedOperation('custom-kind', unsupportedDestination),
        ],
      });
      result = repairInstalledStates({
        repoRoot: REPO_ROOT,
        homeDir,
        projectRoot: unsupportedProjectRoot,
        targets: ['cursor'],
      });
      assert.strictEqual(result.results[0].status, 'error');
      assert.ok(result.results[0].error.includes('Unsupported repair operation kind'));

      writeCursorState(okProjectRoot, { operations: [] });
      result = repairInstalledStates({
        repoRoot: REPO_ROOT,
        homeDir,
        projectRoot: okProjectRoot,
        targets: ['cursor'],
      });
      assert.strictEqual(result.results[0].status, 'ok');
      assert.strictEqual(result.results[0].stateRefreshed, true);
      assert.strictEqual(result.summary.errorCount, 0);
    } finally {
      cleanup(homeDir);
      cleanup(invalidProjectRoot);
      cleanup(missingSourceProjectRoot);
      cleanup(unsupportedProjectRoot);
      cleanup(okProjectRoot);
    }
  })) passed++; else failed++;

  if (test('repair dry-run reports ok when no managed operations need changes', () => {
    const homeDir = createTempDir('install-lifecycle-home-');
    const projectRoot = createTempDir('install-lifecycle-project-');

    try {
      writeCursorState(projectRoot, { operations: [] });

      const result = repairInstalledStates({
        repoRoot: REPO_ROOT,
        homeDir,
        projectRoot,
        targets: ['cursor'],
        dryRun: true,
      });

      assert.strictEqual(result.results[0].status, 'ok');
      assert.strictEqual(result.results[0].stateRefreshed, true);
      assert.deepStrictEqual(result.results[0].plannedRepairs, []);
    } finally {
      cleanup(homeDir);
      cleanup(projectRoot);
    }
  })) passed++; else failed++;

  if (test('repair builds the OpenCode payload and clears the missing-payload warning', () => {
    const homeDir = createTempDir('install-lifecycle-home-');
    const projectRoot = createTempDir('install-lifecycle-project-');

    try {
      withTemporarilyMovedPath(path.join(REPO_ROOT, '.opencode', 'dist'), () => {
        writeOpencodeState(homeDir, {
          request: {
            profile: null,
            modules: ['commands-core'],
            includeComponents: [],
            excludeComponents: [],
            legacyLanguages: [],
            legacyMode: false,
          },
          resolution: {
            selectedModules: ['commands-core'],
            skippedModules: [],
          },
          operations: [],
        });

        const beforeValidate = getInstallTargetAdapter('opencode').validate({
          homeDir,
          repoRoot: REPO_ROOT,
        });
        assert.ok(beforeValidate.some(issue => issue.code === 'opencode-plugin-not-built'));

        const beforeDoctor = buildDoctorReport({
          repoRoot: REPO_ROOT,
          homeDir,
          projectRoot,
          targets: ['opencode'],
        });
        assert.strictEqual(beforeDoctor.results[0].status, 'error');
        assert.ok(beforeDoctor.results[0].issues.some(issue => issue.code === 'resolution-unavailable'));

        let buildCalls = 0;
        const result = repairInstalledStates({
          repoRoot: REPO_ROOT,
          homeDir,
          projectRoot,
          targets: ['opencode'],
          buildOpencodePayload: repoRoot => {
            buildCalls += 1;
            const distDir = path.join(repoRoot, '.opencode', 'dist');
            fs.mkdirSync(path.join(distDir, 'plugins'), { recursive: true });
            fs.mkdirSync(path.join(distDir, 'tools'), { recursive: true });
            fs.writeFileSync(path.join(distDir, 'index.js'), 'module.exports = {};\\n');
          },
        });

        assert.strictEqual(buildCalls, 1);
        assert.strictEqual(result.results[0].status, 'repaired');
        assert.ok(fs.existsSync(path.join(REPO_ROOT, '.opencode', 'dist', 'index.js')));

        const afterValidate = getInstallTargetAdapter('opencode').validate({
          homeDir,
          repoRoot: REPO_ROOT,
        });
        assert.deepStrictEqual(afterValidate, []);

        const afterDoctor = buildDoctorReport({
          repoRoot: REPO_ROOT,
          homeDir,
          projectRoot,
          targets: ['opencode'],
        });
        assert.strictEqual(afterDoctor.results[0].status, 'ok');
        assert.strictEqual(afterDoctor.results[0].issues.length, 0);
      });
    } finally {
      cleanup(homeDir);
      cleanup(projectRoot);
    }
  })) passed++; else failed++;

  if (test('repair dry-run plans the OpenCode payload build without creating it', () => {
    const homeDir = createTempDir('install-lifecycle-home-');
    const projectRoot = createTempDir('install-lifecycle-project-');

    try {
      withTemporarilyMovedPath(path.join(REPO_ROOT, '.opencode', 'dist'), () => {
        writeOpencodeState(homeDir, {
          request: {
            profile: null,
            modules: ['commands-core'],
            includeComponents: [],
            excludeComponents: [],
            legacyLanguages: [],
            legacyMode: false,
          },
          resolution: {
            selectedModules: ['commands-core'],
            skippedModules: [],
          },
          operations: [],
        });

        const result = repairInstalledStates({
          repoRoot: REPO_ROOT,
          homeDir,
          projectRoot,
          targets: ['opencode'],
          dryRun: true,
          buildOpencodePayload: () => {
            throw new Error('build should not run during dry-run');
          },
        });

        assert.strictEqual(result.results[0].status, 'planned');
        assert.ok(result.results[0].plannedRepairs.includes(path.join(REPO_ROOT, '.opencode', 'dist')));
        assert.ok(!fs.existsSync(path.join(REPO_ROOT, '.opencode', 'dist', 'index.js')));
      });
    } finally {
      cleanup(homeDir);
      cleanup(projectRoot);
    }
  })) passed++; else failed++;

  if (test('withTemporarilyMovedPath cleans up newly created paths when nothing was pre-existing', () => {
    const filePath = path.join(REPO_ROOT, '.opencode', 'dist');
    const backupPath = `${filePath}.backup-${process.pid}-test`;

    try {
      fs.rmSync(filePath, { recursive: true, force: true });
      fs.rmSync(backupPath, { recursive: true, force: true });

      const result = withTemporarilyMovedPath(filePath, receivedBackupPath => {
        assert.strictEqual(receivedBackupPath, null);
        fs.mkdirSync(path.join(filePath, 'plugins'), { recursive: true });
        fs.mkdirSync(path.join(filePath, 'tools'), { recursive: true });
        fs.writeFileSync(path.join(filePath, 'index.js'), '// temp build\n');
        return 'callback-result';
      });

      assert.strictEqual(result, 'callback-result');
      assert.ok(!fs.existsSync(filePath), 'Temporary path should be removed after the callback');
    } finally {
      fs.rmSync(filePath, { recursive: true, force: true });
      fs.rmSync(backupPath, { recursive: true, force: true });
    }
  })) passed++; else failed++;

  if (test('repair surfaces OpenCode build failures without blocking other targets', () => {
    const homeDir = createTempDir('install-lifecycle-home-');
    const projectRoot = createTempDir('install-lifecycle-project-');

    try {
      withTemporarilyMovedPath(path.join(REPO_ROOT, '.opencode', 'dist'), () => {
        const cursorTargetRoot = path.join(projectRoot, '.cursor');
        const cursorStatePath = path.join(cursorTargetRoot, 'ecc-install-state.json');
        const cursorDestinationPath = path.join(cursorTargetRoot, 'rules', 'coding-style.md');
        fs.mkdirSync(path.dirname(cursorDestinationPath), { recursive: true });

        writeOpencodeState(homeDir, {
          request: {
            profile: null,
            modules: ['commands-core'],
            includeComponents: [],
            excludeComponents: [],
            legacyLanguages: [],
            legacyMode: false,
          },
          resolution: {
            selectedModules: ['commands-core'],
            skippedModules: [],
          },
          operations: [],
        });

        writeState(cursorStatePath, {
          adapter: { id: 'cursor-project', target: 'cursor', kind: 'project' },
          targetRoot: cursorTargetRoot,
          installStatePath: cursorStatePath,
          request: {
            profile: null,
            modules: [],
            legacyLanguages: ['typescript'],
            legacyMode: true,
          },
          resolution: {
            selectedModules: ['legacy-cursor-install'],
            skippedModules: [],
          },
          operations: [
            managedOperation('copy-file', cursorDestinationPath, {
              sourceRelativePath: 'rules/common/coding-style.md',
              strategy: 'copy-file',
            }),
          ],
          source: {
            repoVersion: CURRENT_PACKAGE_VERSION,
            repoCommit: 'abc123',
            manifestVersion: CURRENT_MANIFEST_VERSION,
          },
        });

        const result = repairInstalledStates({
          repoRoot: REPO_ROOT,
          homeDir,
          projectRoot,
          targets: ['opencode', 'cursor'],
          buildOpencodePayload: () => {
            throw new Error('typescript dependency missing');
          },
        });

        const opencodeResult = result.results.find(entry => entry.adapter.id === 'opencode-home');
        const cursorResult = result.results.find(entry => entry.adapter.id === 'cursor-project');

        assert.strictEqual(opencodeResult.status, 'error');
        assert.ok(opencodeResult.error.includes('typescript dependency missing'));
        assert.strictEqual(cursorResult.status, 'repaired');
        assert.ok(fs.existsSync(cursorDestinationPath));
      });
    } finally {
      cleanup(homeDir);
      cleanup(projectRoot);
    }
  })) passed++; else failed++;

  if (test('repair surfaces missing source errors from execution when destination is absent', () => {
    const homeDir = createTempDir('install-lifecycle-home-');
    const projectRoot = createTempDir('install-lifecycle-project-');

    try {
      const destinationPath = path.join(projectRoot, '.cursor', 'rules', 'missing.md');
      writeCursorState(projectRoot, {
        operations: [
          managedOperation('copy-file', destinationPath, {
            sourceRelativePath: 'missing/source.md',
            strategy: 'copy-file',
          }),
        ],
      });

      const result = repairInstalledStates({
        repoRoot: REPO_ROOT,
        homeDir,
        projectRoot,
        targets: ['cursor'],
      });

      assert.strictEqual(result.results[0].status, 'error');
      assert.ok(result.results[0].error.includes('Missing source file for repair'));
    } finally {
      cleanup(homeDir);
      cleanup(projectRoot);
    }
  })) passed++; else failed++;

  if (test('doctor reports drifted managed files as a warning', () => {
    const homeDir = createTempDir('install-lifecycle-home-');
    const projectRoot = createTempDir('install-lifecycle-project-');

    try {
      const targetRoot = path.join(projectRoot, '.cursor');
      const statePath = path.join(targetRoot, 'ecc-install-state.json');
      const sourcePath = path.join(REPO_ROOT, '.cursor', 'hooks.json');
      const destinationPath = path.join(targetRoot, 'hooks.json');
      fs.mkdirSync(path.dirname(destinationPath), { recursive: true });
      fs.writeFileSync(destinationPath, '{"drifted":true}\n');

      writeState(statePath, {
        adapter: { id: 'cursor-project', target: 'cursor', kind: 'project' },
        targetRoot,
        installStatePath: statePath,
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
        operations: [
          {
            kind: 'copy-file',
            moduleId: 'platform-configs',
            sourcePath,
            sourceRelativePath: '.cursor/hooks.json',
            destinationPath,
            strategy: 'sync-root-children',
            ownership: 'managed',
            scaffoldOnly: false,
          },
        ],
        source: {
          repoVersion: CURRENT_PACKAGE_VERSION,
          repoCommit: 'abc123',
          manifestVersion: CURRENT_MANIFEST_VERSION,
        },
      });

      const report = buildDoctorReport({
        repoRoot: REPO_ROOT,
        homeDir,
        projectRoot,
        targets: ['cursor'],
      });

      assert.strictEqual(report.results.length, 1);
      assert.strictEqual(report.results[0].status, 'warning');
      assert.ok(report.results[0].issues.some(issue => issue.code === 'drifted-managed-files'));
    } finally {
      cleanup(homeDir);
      cleanup(projectRoot);
    }
  })) passed++; else failed++;

  if (test('doctor reports manifest resolution drift for non-legacy installs', () => {
    const homeDir = createTempDir('install-lifecycle-home-');
    const projectRoot = createTempDir('install-lifecycle-project-');

    try {
      const targetRoot = path.join(projectRoot, '.cursor');
      const statePath = path.join(targetRoot, 'ecc-install-state.json');
      fs.mkdirSync(targetRoot, { recursive: true });

      writeState(statePath, {
        adapter: { id: 'cursor-project', target: 'cursor', kind: 'project' },
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
          manifestVersion: CURRENT_MANIFEST_VERSION,
        },
      });

      const report = buildDoctorReport({
        repoRoot: REPO_ROOT,
        homeDir,
        projectRoot,
        targets: ['cursor'],
      });

      assert.strictEqual(report.results.length, 1);
      assert.strictEqual(report.results[0].status, 'warning');
      assert.ok(report.results[0].issues.some(issue => issue.code === 'resolution-drift'));
    } finally {
      cleanup(homeDir);
      cleanup(projectRoot);
    }
  })) passed++; else failed++;

  if (test('repair restores render-template outputs from recorded rendered content', () => {
    const homeDir = createTempDir('install-lifecycle-home-');
    const projectRoot = createTempDir('install-lifecycle-project-');

    try {
      const targetRoot = path.join(homeDir, '.claude');
      const statePath = path.join(targetRoot, 'ecc', 'install-state.json');
      const destinationPath = path.join(targetRoot, 'plugin.json');
      fs.mkdirSync(path.dirname(destinationPath), { recursive: true });
      fs.writeFileSync(destinationPath, '{"drifted":true}\n');

      writeState(statePath, {
        adapter: { id: 'claude-home', target: 'claude', kind: 'home' },
        targetRoot,
        installStatePath: statePath,
        request: {
          profile: null,
          modules: [],
          legacyLanguages: ['typescript'],
          legacyMode: true,
        },
        resolution: {
          selectedModules: ['legacy-claude-rules'],
          skippedModules: [],
        },
        operations: [
          {
            kind: 'render-template',
            moduleId: 'platform-configs',
            sourceRelativePath: '.claude-plugin/plugin.json.template',
            destinationPath,
            strategy: 'render-template',
            ownership: 'managed',
            scaffoldOnly: false,
            renderedContent: '{"ok":true}\n',
          },
        ],
        source: {
          repoVersion: CURRENT_PACKAGE_VERSION,
          repoCommit: 'abc123',
          manifestVersion: CURRENT_MANIFEST_VERSION,
        },
      });

      const result = repairInstalledStates({
        repoRoot: REPO_ROOT,
        homeDir,
        projectRoot,
        targets: ['claude'],
      });

      assert.strictEqual(result.results[0].status, 'repaired');
      assert.strictEqual(fs.readFileSync(destinationPath, 'utf8'), '{"ok":true}\n');
    } finally {
      cleanup(homeDir);
      cleanup(projectRoot);
    }
  })) passed++; else failed++;

  if (test('repair reapplies merge-json operations without clobbering unrelated keys', () => {
    const homeDir = createTempDir('install-lifecycle-home-');
    const projectRoot = createTempDir('install-lifecycle-project-');

    try {
      const targetRoot = path.join(projectRoot, '.cursor');
      const statePath = path.join(targetRoot, 'ecc-install-state.json');
      const destinationPath = path.join(targetRoot, 'hooks.json');
      fs.mkdirSync(path.dirname(destinationPath), { recursive: true });
      fs.writeFileSync(destinationPath, JSON.stringify({
        existing: true,
        nested: {
          enabled: false,
        },
      }, null, 2));

      writeState(statePath, {
        adapter: { id: 'cursor-project', target: 'cursor', kind: 'project' },
        targetRoot,
        installStatePath: statePath,
        request: {
          profile: null,
          modules: [],
          legacyLanguages: ['typescript'],
          legacyMode: true,
        },
        resolution: {
          selectedModules: ['legacy-cursor-install'],
          skippedModules: [],
        },
        operations: [
          {
            kind: 'merge-json',
            moduleId: 'platform-configs',
            sourceRelativePath: '.cursor/hooks.json',
            destinationPath,
            strategy: 'merge-json',
            ownership: 'managed',
            scaffoldOnly: false,
            mergePayload: {
              nested: {
                enabled: true,
              },
              managed: 'yes',
            },
          },
        ],
        source: {
          repoVersion: CURRENT_PACKAGE_VERSION,
          repoCommit: 'abc123',
          manifestVersion: CURRENT_MANIFEST_VERSION,
        },
      });

      const result = repairInstalledStates({
        repoRoot: REPO_ROOT,
        homeDir,
        projectRoot,
        targets: ['cursor'],
      });

      assert.strictEqual(result.results[0].status, 'repaired');
      assert.deepStrictEqual(JSON.parse(fs.readFileSync(destinationPath, 'utf8')), {
        existing: true,
        nested: {
          enabled: true,
        },
        managed: 'yes',
      });
    } finally {
      cleanup(homeDir);
      cleanup(projectRoot);
    }
  })) passed++; else failed++;

  if (test('repair re-applies managed remove operations when files reappear', () => {
    const homeDir = createTempDir('install-lifecycle-home-');
    const projectRoot = createTempDir('install-lifecycle-project-');

    try {
      const targetRoot = path.join(projectRoot, '.cursor');
      const statePath = path.join(targetRoot, 'ecc-install-state.json');
      const destinationPath = path.join(targetRoot, 'legacy-note.txt');
      fs.mkdirSync(path.dirname(destinationPath), { recursive: true });
      fs.writeFileSync(destinationPath, 'stale');

      writeState(statePath, {
        adapter: { id: 'cursor-project', target: 'cursor', kind: 'project' },
        targetRoot,
        installStatePath: statePath,
        request: {
          profile: null,
          modules: [],
          legacyLanguages: ['typescript'],
          legacyMode: true,
        },
        resolution: {
          selectedModules: ['legacy-cursor-install'],
          skippedModules: [],
        },
        operations: [
          {
            kind: 'remove',
            moduleId: 'platform-configs',
            sourceRelativePath: '.cursor/legacy-note.txt',
            destinationPath,
            strategy: 'remove',
            ownership: 'managed',
            scaffoldOnly: false,
          },
        ],
        source: {
          repoVersion: CURRENT_PACKAGE_VERSION,
          repoCommit: 'abc123',
          manifestVersion: CURRENT_MANIFEST_VERSION,
        },
      });

      const result = repairInstalledStates({
        repoRoot: REPO_ROOT,
        homeDir,
        projectRoot,
        targets: ['cursor'],
      });

      assert.strictEqual(result.results[0].status, 'repaired');
      assert.ok(!fs.existsSync(destinationPath));
    } finally {
      cleanup(homeDir);
      cleanup(projectRoot);
    }
  })) passed++; else failed++;

  if (test('uninstall restores JSON merged files from recorded previous content', () => {
    const homeDir = createTempDir('install-lifecycle-home-');
    const projectRoot = createTempDir('install-lifecycle-project-');

    try {
      const targetRoot = path.join(projectRoot, '.cursor');
      const statePath = path.join(targetRoot, 'ecc-install-state.json');
      const destinationPath = path.join(targetRoot, 'hooks.json');
      fs.mkdirSync(path.dirname(destinationPath), { recursive: true });
      fs.writeFileSync(destinationPath, JSON.stringify({
        existing: true,
        managed: true,
      }, null, 2));

      writeState(statePath, {
        adapter: { id: 'cursor-project', target: 'cursor', kind: 'project' },
        targetRoot,
        installStatePath: statePath,
        request: {
          profile: null,
          modules: [],
          legacyLanguages: ['typescript'],
          legacyMode: true,
        },
        resolution: {
          selectedModules: ['legacy-cursor-install'],
          skippedModules: [],
        },
        operations: [
          {
            kind: 'merge-json',
            moduleId: 'platform-configs',
            sourceRelativePath: '.cursor/hooks.json',
            destinationPath,
            strategy: 'merge-json',
            ownership: 'managed',
            scaffoldOnly: false,
            mergePayload: {
              managed: true,
            },
            previousContent: JSON.stringify({
              existing: true,
            }, null, 2),
          },
        ],
        source: {
          repoVersion: CURRENT_PACKAGE_VERSION,
          repoCommit: 'abc123',
          manifestVersion: CURRENT_MANIFEST_VERSION,
        },
      });

      const result = uninstallInstalledStates({
        homeDir,
        projectRoot,
        targets: ['cursor'],
      });

      assert.strictEqual(result.results[0].status, 'uninstalled');
      assert.deepStrictEqual(JSON.parse(fs.readFileSync(destinationPath, 'utf8')), {
        existing: true,
      });
      assert.ok(!fs.existsSync(statePath));
    } finally {
      cleanup(homeDir);
      cleanup(projectRoot);
    }
  })) passed++; else failed++;

  if (test('uninstall restores rendered template files from recorded previous content', () => {
    const tempDir = createTempDir('install-lifecycle-');

    try {
      const targetRoot = path.join(tempDir, '.claude');
      const statePath = path.join(targetRoot, 'ecc', 'install-state.json');
      const destinationPath = path.join(targetRoot, 'plugin.json');
      fs.mkdirSync(path.dirname(destinationPath), { recursive: true });
      fs.writeFileSync(destinationPath, '{"generated":true}\n');

      writeInstallState(statePath, createInstallState({
        adapter: { id: 'claude-home', target: 'claude', kind: 'home' },
        targetRoot,
        installStatePath: statePath,
        request: {
          profile: 'core',
          modules: ['platform-configs'],
          includeComponents: [],
          excludeComponents: [],
          legacyLanguages: [],
          legacyMode: false,
        },
        resolution: {
          selectedModules: ['platform-configs'],
          skippedModules: [],
        },
        source: {
          repoVersion: '1.8.0',
          repoCommit: 'abc123',
          manifestVersion: 1,
        },
        operations: [
          {
            kind: 'render-template',
            moduleId: 'platform-configs',
            sourceRelativePath: '.claude/plugin.json.template',
            destinationPath,
            strategy: 'render-template',
            ownership: 'managed',
            scaffoldOnly: false,
            renderedContent: '{"generated":true}\n',
            previousContent: '{"existing":true}\n',
          },
        ],
      }));

      const result = uninstallInstalledStates({
        homeDir: tempDir,
        projectRoot: tempDir,
        targets: ['claude'],
      });

      assert.strictEqual(result.summary.uninstalledCount, 1);
      assert.strictEqual(fs.readFileSync(destinationPath, 'utf8'), '{"existing":true}\n');
      assert.ok(!fs.existsSync(statePath));
    } finally {
      cleanup(tempDir);
    }
  })) passed++; else failed++;

  if (test('uninstall restores files removed during install when previous content is recorded', () => {
    const homeDir = createTempDir('install-lifecycle-home-');
    const projectRoot = createTempDir('install-lifecycle-project-');

    try {
      const targetRoot = path.join(projectRoot, '.cursor');
      const statePath = path.join(targetRoot, 'ecc-install-state.json');
      const destinationPath = path.join(targetRoot, 'legacy-note.txt');
      fs.mkdirSync(targetRoot, { recursive: true });

      writeState(statePath, {
        adapter: { id: 'cursor-project', target: 'cursor', kind: 'project' },
        targetRoot,
        installStatePath: statePath,
        request: {
          profile: null,
          modules: [],
          legacyLanguages: ['typescript'],
          legacyMode: true,
        },
        resolution: {
          selectedModules: ['legacy-cursor-install'],
          skippedModules: [],
        },
        operations: [
          {
            kind: 'remove',
            moduleId: 'platform-configs',
            sourceRelativePath: '.cursor/legacy-note.txt',
            destinationPath,
            strategy: 'remove',
            ownership: 'managed',
            scaffoldOnly: false,
            previousContent: 'restore me\n',
          },
        ],
        source: {
          repoVersion: CURRENT_PACKAGE_VERSION,
          repoCommit: 'abc123',
          manifestVersion: CURRENT_MANIFEST_VERSION,
        },
      });

      const result = uninstallInstalledStates({
        homeDir,
        projectRoot,
        targets: ['cursor'],
      });

      assert.strictEqual(result.results[0].status, 'uninstalled');
      assert.strictEqual(fs.readFileSync(destinationPath, 'utf8'), 'restore me\n');
      assert.ok(!fs.existsSync(statePath));
    } finally {
      cleanup(homeDir);
      cleanup(projectRoot);
    }
  })) passed++; else failed++;

  if (test('uninstall dry-run reports deduped managed removals without deleting files', () => {
    const homeDir = createTempDir('install-lifecycle-home-');
    const projectRoot = createTempDir('install-lifecycle-project-');

    try {
      const targetRoot = path.join(projectRoot, '.cursor');
      const destinationPath = path.join(targetRoot, 'rules', 'coding-style.md');
      fs.mkdirSync(path.dirname(destinationPath), { recursive: true });
      fs.writeFileSync(destinationPath, 'managed\n');
      const { installStatePath } = writeCursorState(projectRoot, {
        operations: [
          managedOperation('copy-file', destinationPath, { strategy: 'copy-file' }),
          managedOperation('copy-file', destinationPath, { strategy: 'copy-file' }),
        ],
      });

      const result = uninstallInstalledStates({
        homeDir,
        projectRoot,
        targets: ['cursor'],
        dryRun: true,
      });

      assert.strictEqual(result.dryRun, true);
      assert.strictEqual(result.results[0].status, 'planned');
      assert.deepStrictEqual(result.results[0].plannedRemovals, [
        destinationPath,
        installStatePath,
      ]);
      assert.ok(fs.existsSync(destinationPath));
      assert.ok(fs.existsSync(installStatePath));
    } finally {
      cleanup(homeDir);
      cleanup(projectRoot);
    }
  })) passed++; else failed++;

  if (test('uninstall reports invalid install states as errors', () => {
    const homeDir = createTempDir('install-lifecycle-home-');
    const projectRoot = createTempDir('install-lifecycle-project-');

    try {
      const statePath = path.join(projectRoot, '.cursor', 'ecc-install-state.json');
      fs.mkdirSync(path.dirname(statePath), { recursive: true });
      fs.writeFileSync(statePath, '{not-json', 'utf8');

      const result = uninstallInstalledStates({
        homeDir,
        projectRoot,
        targets: ['cursor'],
      });

      assert.strictEqual(result.results[0].status, 'error');
      assert.ok(result.results[0].error.includes('Failed to read install-state'));
      assert.strictEqual(result.summary.errorCount, 1);
    } finally {
      cleanup(homeDir);
      cleanup(projectRoot);
    }
  })) passed++; else failed++;

  if (test('uninstall removes copied files and cleans empty parent directories', () => {
    const homeDir = createTempDir('install-lifecycle-home-');
    const projectRoot = createTempDir('install-lifecycle-project-');

    try {
      const targetRoot = path.join(projectRoot, '.cursor');
      const destinationPath = path.join(targetRoot, 'rules', 'nested', 'managed.md');
      fs.mkdirSync(path.dirname(destinationPath), { recursive: true });
      fs.writeFileSync(destinationPath, 'managed\n');
      writeCursorState(projectRoot, {
        operations: [
          managedOperation('copy-file', destinationPath, { strategy: 'copy-file' }),
        ],
      });

      const result = uninstallInstalledStates({
        homeDir,
        projectRoot,
        targets: ['cursor'],
      });

      assert.strictEqual(result.results[0].status, 'uninstalled');
      assert.ok(result.results[0].removedPaths.includes(destinationPath));
      assert.ok(!fs.existsSync(destinationPath));
      assert.ok(!fs.existsSync(path.dirname(destinationPath)));
      assert.ok(fs.existsSync(targetRoot));
    } finally {
      cleanup(homeDir);
      cleanup(projectRoot);
    }
  })) passed++; else failed++;

  if (test('uninstall handles merge-json subset removal and full-file deletion', () => {
    const homeDir = createTempDir('install-lifecycle-home-');
    const partialProjectRoot = createTempDir('install-lifecycle-partial-');
    const fullProjectRoot = createTempDir('install-lifecycle-full-');

    try {
      let targetRoot = path.join(partialProjectRoot, '.cursor');
      let destinationPath = path.join(targetRoot, 'settings.json');
      fs.mkdirSync(targetRoot, { recursive: true });
      fs.writeFileSync(destinationPath, JSON.stringify({
        keep: true,
        managed: true,
        nested: {
          keep: true,
          remove: true,
        },
        list: ['a', 'b'],
      }, null, 2));
      writeCursorState(partialProjectRoot, {
        operations: [
          managedOperation('merge-json', destinationPath, {
            mergePayload: {
              managed: true,
              nested: { remove: true },
              list: ['a', 'b'],
            },
          }),
        ],
      });

      let result = uninstallInstalledStates({
        homeDir,
        projectRoot: partialProjectRoot,
        targets: ['cursor'],
      });
      assert.strictEqual(result.results[0].status, 'uninstalled');
      assert.deepStrictEqual(JSON.parse(fs.readFileSync(destinationPath, 'utf8')), {
        keep: true,
        nested: {
          keep: true,
        },
      });

      targetRoot = path.join(fullProjectRoot, '.cursor');
      destinationPath = path.join(targetRoot, 'settings.json');
      fs.mkdirSync(targetRoot, { recursive: true });
      fs.writeFileSync(destinationPath, JSON.stringify({ managed: true }, null, 2));
      writeCursorState(fullProjectRoot, {
        operations: [
          managedOperation('merge-json', destinationPath, {
            mergePayload: { managed: true },
          }),
        ],
      });

      result = uninstallInstalledStates({
        homeDir,
        projectRoot: fullProjectRoot,
        targets: ['cursor'],
      });
      assert.strictEqual(result.results[0].status, 'uninstalled');
      assert.ok(!fs.existsSync(destinationPath));
    } finally {
      cleanup(homeDir);
      cleanup(partialProjectRoot);
      cleanup(fullProjectRoot);
    }
  })) passed++; else failed++;

  if (test('uninstall handles merge-json edge shapes and absent destinations', () => {
    const homeDir = createTempDir('install-lifecycle-home-');
    const projects = [
      createTempDir('install-lifecycle-current-primitive-'),
      createTempDir('install-lifecycle-missing-key-'),
      createTempDir('install-lifecycle-nested-delete-'),
      createTempDir('install-lifecycle-array-root-'),
      createTempDir('install-lifecycle-primitive-root-'),
      createTempDir('install-lifecycle-absent-dest-'),
      createTempDir('install-lifecycle-previous-json-'),
    ];

    try {
      const cases = [
        {
          projectRoot: projects[0],
          initial: '"plain"',
          payload: { managed: true },
          expected: 'plain',
        },
        {
          projectRoot: projects[1],
          initial: { keep: true },
          payload: { missing: true },
          expected: { keep: true },
        },
        {
          projectRoot: projects[2],
          initial: { keep: true, nested: { remove: true } },
          payload: { nested: { remove: true } },
          expected: { keep: true },
        },
        {
          projectRoot: projects[3],
          initial: ['a', 'b'],
          payload: ['a', 'b'],
          removed: true,
        },
        {
          projectRoot: projects[4],
          initial: true,
          payload: true,
          removed: true,
        },
        {
          projectRoot: projects[5],
          payload: { managed: true },
          absent: true,
        },
        {
          projectRoot: projects[6],
          initial: { generated: true },
          payload: { generated: true },
          previousJson: { restored: true },
          expected: { restored: true },
        },
      ];

      for (const testCase of cases) {
        const targetRoot = path.join(testCase.projectRoot, '.cursor');
        const destinationPath = path.join(targetRoot, 'settings.json');
        fs.mkdirSync(targetRoot, { recursive: true });
        if (!testCase.absent) {
          fs.writeFileSync(
            destinationPath,
            typeof testCase.initial === 'string'
              ? `${testCase.initial}\n`
              : JSON.stringify(testCase.initial, null, 2)
          );
        }
        writeCursorState(testCase.projectRoot, {
          operations: [
            managedOperation('merge-json', destinationPath, {
              mergePayload: testCase.payload,
              previousJson: testCase.previousJson,
            }),
          ],
        });

        const result = uninstallInstalledStates({
          homeDir,
          projectRoot: testCase.projectRoot,
          targets: ['cursor'],
        });

        assert.strictEqual(result.results[0].status, 'uninstalled');
        if (testCase.removed || testCase.absent) {
          assert.ok(!fs.existsSync(destinationPath));
        } else {
          assert.deepStrictEqual(JSON.parse(fs.readFileSync(destinationPath, 'utf8')), testCase.expected);
        }
      }
    } finally {
      cleanup(homeDir);
      for (const projectRoot of projects) {
        cleanup(projectRoot);
      }
    }
  })) passed++; else failed++;

  if (test('uninstall removes generated render-template files and no-backup remove operations are no-ops', () => {
    const homeDir = createTempDir('install-lifecycle-home-');
    const projectRoot = createTempDir('install-lifecycle-project-');

    try {
      const targetRoot = path.join(projectRoot, '.cursor');
      const templatePath = path.join(targetRoot, 'generated', 'plugin.json');
      const removedPath = path.join(targetRoot, 'already-removed.txt');
      fs.mkdirSync(path.dirname(templatePath), { recursive: true });
      fs.writeFileSync(templatePath, '{"generated":true}\n');

      writeCursorState(projectRoot, {
        operations: [
          managedOperation('render-template', templatePath, {
            renderedContent: '{"generated":true}\n',
          }),
          managedOperation('remove', removedPath),
        ],
      });

      const result = uninstallInstalledStates({
        homeDir,
        projectRoot,
        targets: ['cursor'],
      });

      assert.strictEqual(result.results[0].status, 'uninstalled');
      assert.ok(result.results[0].removedPaths.includes(templatePath));
      assert.ok(!fs.existsSync(templatePath));
      assert.ok(!fs.existsSync(path.dirname(templatePath)));
    } finally {
      cleanup(homeDir);
      cleanup(projectRoot);
    }
  })) passed++; else failed++;

  if (test('uninstall restores previous JSON snapshots for template and remove operations', () => {
    const homeDir = createTempDir('install-lifecycle-home-');
    const projectRoot = createTempDir('install-lifecycle-project-');

    try {
      const targetRoot = path.join(projectRoot, '.cursor');
      const templatePath = path.join(targetRoot, 'plugin.json');
      const removedPath = path.join(targetRoot, 'legacy.json');
      fs.mkdirSync(targetRoot, { recursive: true });
      fs.writeFileSync(templatePath, '{"generated":true}\n');

      writeCursorState(projectRoot, {
        operations: [
          managedOperation('render-template', templatePath, {
            previousJson: { existing: true },
            renderedContent: '{"generated":true}\n',
          }),
          managedOperation('remove', removedPath, {
            previousJson: { restored: true },
          }),
        ],
      });

      const result = uninstallInstalledStates({
        homeDir,
        projectRoot,
        targets: ['cursor'],
      });

      assert.strictEqual(result.results[0].status, 'uninstalled');
      assert.deepStrictEqual(JSON.parse(fs.readFileSync(templatePath, 'utf8')), {
        existing: true,
      });
      assert.deepStrictEqual(JSON.parse(fs.readFileSync(removedPath, 'utf8')), {
        restored: true,
      });
    } finally {
      cleanup(homeDir);
      cleanup(projectRoot);
    }
  })) passed++; else failed++;

  if (test('uninstall reports unsupported operations and missing merge payloads as errors', () => {
    const homeDir = createTempDir('install-lifecycle-home-');
    const unsupportedProjectRoot = createTempDir('install-lifecycle-unsupported-');
    const missingPayloadProjectRoot = createTempDir('install-lifecycle-missing-payload-');

    try {
      let targetRoot = path.join(unsupportedProjectRoot, '.cursor');
      let destinationPath = path.join(targetRoot, 'custom.txt');
      fs.mkdirSync(targetRoot, { recursive: true });
      fs.writeFileSync(destinationPath, 'custom\n');
      writeCursorState(unsupportedProjectRoot, {
        operations: [
          managedOperation('custom-kind', destinationPath),
        ],
      });

      let result = uninstallInstalledStates({
        homeDir,
        projectRoot: unsupportedProjectRoot,
        targets: ['cursor'],
      });
      assert.strictEqual(result.results[0].status, 'error');
      assert.ok(result.results[0].error.includes('Unsupported uninstall operation kind'));

      targetRoot = path.join(missingPayloadProjectRoot, '.cursor');
      destinationPath = path.join(targetRoot, 'settings.json');
      fs.mkdirSync(targetRoot, { recursive: true });
      fs.writeFileSync(destinationPath, '{"managed":true}\n');
      writeCursorState(missingPayloadProjectRoot, {
        operations: [
          managedOperation('merge-json', destinationPath),
        ],
      });

      result = uninstallInstalledStates({
        homeDir,
        projectRoot: missingPayloadProjectRoot,
        targets: ['cursor'],
      });
      assert.strictEqual(result.results[0].status, 'error');
      assert.ok(result.results[0].error.includes('Missing merge payload for uninstall'));
    } finally {
      cleanup(homeDir);
      cleanup(unsupportedProjectRoot);
      cleanup(missingPayloadProjectRoot);
    }
  })) passed++; else failed++;

  console.log(`\nResults: Passed: ${passed}, Failed: ${failed}`);
  process.exit(failed > 0 ? 1 : 0);
}

runTests();
