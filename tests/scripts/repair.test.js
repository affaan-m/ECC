/**
 * Tests for scripts/repair.js
 */

const assert = require('assert');
const fs = require('fs');
const os = require('os');
const path = require('path');
const { execFileSync } = require('child_process');

const INSTALL_SCRIPT = path.join(__dirname, '..', '..', 'scripts', 'install-apply.js');
const DOCTOR_SCRIPT = path.join(__dirname, '..', '..', 'scripts', 'doctor.js');
const REPAIR_SCRIPT = path.join(__dirname, '..', '..', 'scripts', 'repair.js');
const REPO_ROOT = path.join(__dirname, '..', '..');
const CLI_TIMEOUT_MS = 30000;
const CURRENT_PACKAGE_VERSION = JSON.parse(
  fs.readFileSync(path.join(REPO_ROOT, 'package.json'), 'utf8')
).version;
const CURRENT_MANIFEST_VERSION = JSON.parse(
  fs.readFileSync(path.join(REPO_ROOT, 'manifests', 'install-modules.json'), 'utf8')
).version;
const {
  createInstallState,
  writeInstallState,
} = require('../../scripts/lib/install-state');

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

function runNode(scriptPath, args = [], options = {}) {
  const homeDir = options.homeDir || process.env.HOME;
  const env = {
    ...process.env,
    HOME: homeDir,
    USERPROFILE: homeDir,
  };

  try {
    const stdout = execFileSync('node', [scriptPath, ...args], {
      cwd: options.cwd,
      env,
      encoding: 'utf8',
      stdio: ['pipe', 'pipe', 'pipe'],
      timeout: options.timeout || CLI_TIMEOUT_MS,
    });

    return { code: 0, stdout, stderr: '' };
  } catch (error) {
    return {
      code: error.status || 1,
      stdout: error.stdout || '',
      stderr: error.stderr || error.message || '',
    };
  }
}

function normalizeComparablePath(filePath) {
  const normalized = path.normalize(filePath);
  return process.platform === 'win32' ? normalized.toLowerCase() : normalized;
}

function pathListIncludes(paths, expectedPath) {
  const normalizedExpected = normalizeComparablePath(expectedPath);
  return paths.some(filePath => normalizeComparablePath(filePath) === normalizedExpected);
}

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

function runTests() {
  console.log('\n=== Testing repair.js ===\n');

  let passed = 0;
  let failed = 0;

  if (test('repairs drifted files from a real install-apply state', () => {
    const homeDir = createTempDir('repair-home-');
    const projectRoot = createTempDir('repair-project-');

    try {
      const installResult = runNode(INSTALL_SCRIPT, ['--target', 'cursor', 'typescript'], {
        cwd: projectRoot,
        homeDir,
      });
      assert.strictEqual(installResult.code, 0, installResult.stderr);

      const normalizedProjectRoot = fs.realpathSync(projectRoot);
      const managedPath = path.join(normalizedProjectRoot, '.cursor', 'hooks', 'session-start.js');
      const statePath = path.join(normalizedProjectRoot, '.cursor', 'ecc-install-state.json');
      const expectedContent = fs.readFileSync(
        path.join(REPO_ROOT, '.cursor', 'hooks', 'session-start.js'),
        'utf8'
      );
      fs.writeFileSync(managedPath, '// drifted\n');

      const doctorBefore = runNode(DOCTOR_SCRIPT, ['--target', 'cursor', '--json'], {
        cwd: projectRoot,
        homeDir,
      });
      assert.strictEqual(doctorBefore.code, 1);
      assert.ok(JSON.parse(doctorBefore.stdout).results[0].issues.some(issue => issue.code === 'drifted-managed-files'));

      const repairResult = runNode(REPAIR_SCRIPT, ['--target', 'cursor', '--json'], {
        cwd: projectRoot,
        homeDir,
      });
      assert.strictEqual(repairResult.code, 0, repairResult.stderr);

      const parsed = JSON.parse(repairResult.stdout);
      assert.strictEqual(parsed.results[0].status, 'repaired');
      assert.ok(pathListIncludes(parsed.results[0].repairedPaths, managedPath));
      assert.strictEqual(fs.readFileSync(managedPath, 'utf8'), expectedContent);
      assert.ok(fs.existsSync(statePath));
    } finally {
      cleanup(homeDir);
      cleanup(projectRoot);
    }
  })) passed++; else failed++;

  if (test('repairs drifted non-copy managed operations and refreshes install-state', () => {
    const homeDir = createTempDir('repair-home-');
    const projectRoot = createTempDir('repair-project-');

    try {
      const targetRoot = path.join(projectRoot, '.cursor');
      fs.mkdirSync(targetRoot, { recursive: true });
      const normalizedTargetRoot = fs.realpathSync(targetRoot);
      const statePath = path.join(normalizedTargetRoot, 'ecc-install-state.json');
      const jsonPath = path.join(normalizedTargetRoot, 'hooks.json');
      const renderedPath = path.join(normalizedTargetRoot, 'generated.md');
      const removedPath = path.join(normalizedTargetRoot, 'legacy-note.txt');
      fs.writeFileSync(jsonPath, JSON.stringify({ existing: true, managed: false }, null, 2));
      fs.writeFileSync(renderedPath, '# drifted\n');
      fs.writeFileSync(removedPath, 'stale\n');

      writeState(statePath, {
        adapter: { id: 'cursor-project', target: 'cursor', kind: 'project' },
        targetRoot: normalizedTargetRoot,
        installStatePath: statePath,
        request: {
          profile: null,
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
        operations: [
          {
            kind: 'merge-json',
            moduleId: 'platform-configs',
            sourceRelativePath: '.cursor/hooks.json',
            destinationPath: jsonPath,
            strategy: 'merge-json',
            ownership: 'managed',
            scaffoldOnly: false,
            mergePayload: {
              managed: true,
              nested: {
                enabled: true,
              },
            },
          },
          {
            kind: 'render-template',
            moduleId: 'platform-configs',
            sourceRelativePath: '.cursor/generated.md.template',
            destinationPath: renderedPath,
            strategy: 'render-template',
            ownership: 'managed',
            scaffoldOnly: false,
            renderedContent: '# generated\n',
          },
          {
            kind: 'remove',
            moduleId: 'platform-configs',
            sourceRelativePath: '.cursor/legacy-note.txt',
            destinationPath: removedPath,
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

      const doctorBefore = runNode(DOCTOR_SCRIPT, ['--target', 'cursor', '--json'], {
        cwd: projectRoot,
        homeDir,
      });
      assert.strictEqual(doctorBefore.code, 1);
      assert.ok(JSON.parse(doctorBefore.stdout).results[0].issues.some(issue => issue.code === 'drifted-managed-files'));

      const installedAtBefore = JSON.parse(fs.readFileSync(statePath, 'utf8')).installedAt;
      const repairResult = runNode(REPAIR_SCRIPT, ['--target', 'cursor', '--json'], {
        cwd: projectRoot,
        homeDir,
      });
      assert.strictEqual(repairResult.code, 0, repairResult.stderr);

      const parsed = JSON.parse(repairResult.stdout);
      assert.strictEqual(parsed.results[0].status, 'repaired');
      assert.ok(parsed.results[0].repairedPaths.includes(jsonPath));
      assert.ok(parsed.results[0].repairedPaths.includes(renderedPath));
      assert.ok(parsed.results[0].repairedPaths.includes(removedPath));
      assert.deepStrictEqual(JSON.parse(fs.readFileSync(jsonPath, 'utf8')), {
        existing: true,
        managed: true,
        nested: {
          enabled: true,
        },
      });
      assert.strictEqual(fs.readFileSync(renderedPath, 'utf8'), '# generated\n');
      assert.ok(!fs.existsSync(removedPath));

      const repairedState = JSON.parse(fs.readFileSync(statePath, 'utf8'));
      assert.strictEqual(repairedState.installedAt, installedAtBefore);
      assert.ok(repairedState.lastValidatedAt);

      const doctorAfter = runNode(DOCTOR_SCRIPT, ['--target', 'cursor'], {
        cwd: projectRoot,
        homeDir,
      });
      assert.strictEqual(doctorAfter.code, 0, doctorAfter.stderr);
      assert.ok(doctorAfter.stdout.includes('Status: OK'));
    } finally {
      cleanup(homeDir);
      cleanup(projectRoot);
    }
  })) passed++; else failed++;

  if (test('supports dry-run without mutating drifted non-copy operations', () => {
    const homeDir = createTempDir('repair-home-');
    const projectRoot = createTempDir('repair-project-');

    try {
      const targetRoot = path.join(projectRoot, '.cursor');
      fs.mkdirSync(targetRoot, { recursive: true });
      const normalizedTargetRoot = fs.realpathSync(targetRoot);
      const statePath = path.join(normalizedTargetRoot, 'ecc-install-state.json');
      const renderedPath = path.join(normalizedTargetRoot, 'generated.md');
      fs.writeFileSync(renderedPath, '# drifted\n');

      writeState(statePath, {
        adapter: { id: 'cursor-project', target: 'cursor', kind: 'project' },
        targetRoot: normalizedTargetRoot,
        installStatePath: statePath,
        request: {
          profile: null,
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
        operations: [
          {
            kind: 'render-template',
            moduleId: 'platform-configs',
            sourceRelativePath: '.cursor/generated.md.template',
            destinationPath: renderedPath,
            strategy: 'render-template',
            ownership: 'managed',
            scaffoldOnly: false,
            renderedContent: '# generated\n',
          },
        ],
        source: {
          repoVersion: CURRENT_PACKAGE_VERSION,
          repoCommit: 'abc123',
          manifestVersion: CURRENT_MANIFEST_VERSION,
        },
      });

      const repairResult = runNode(REPAIR_SCRIPT, ['--target', 'cursor', '--dry-run', '--json'], {
        cwd: projectRoot,
        homeDir,
      });
      assert.strictEqual(repairResult.code, 0, repairResult.stderr);
      const parsed = JSON.parse(repairResult.stdout);
      assert.strictEqual(parsed.dryRun, true);
      assert.ok(parsed.results[0].plannedRepairs.includes(renderedPath));
      assert.strictEqual(fs.readFileSync(renderedPath, 'utf8'), '# drifted\n');
    } finally {
      cleanup(homeDir);
      cleanup(projectRoot);
    }
  })) passed++; else failed++;

  console.log(`\nResults: Passed: ${passed}, Failed: ${failed}`);
  process.exit(failed > 0 ? 1 : 0);
}

runTests();
