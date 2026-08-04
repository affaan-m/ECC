/**
 * Tests for scripts/uninstall.js
 */

const assert = require('assert');
const fs = require('fs');
const os = require('os');
const path = require('path');
const { execFileSync } = require('child_process');

const INSTALL_SCRIPT = path.join(__dirname, '..', '..', 'scripts', 'install-apply.js');
const SCRIPT = path.join(__dirname, '..', '..', 'scripts', 'uninstall.js');
const REPO_ROOT = path.join(__dirname, '..', '..');
const CURRENT_PACKAGE_VERSION = JSON.parse(
  fs.readFileSync(path.join(REPO_ROOT, 'package.json'), 'utf8')
).version;
const CURRENT_MANIFEST_VERSION = JSON.parse(
  fs.readFileSync(path.join(REPO_ROOT, 'manifests', 'install-modules.json'), 'utf8')
).version;
const CLI_TIMEOUT_MS = 30000;
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

function run(args = [], options = {}) {
  const env = {
    ...process.env,
    HOME: options.homeDir || process.env.HOME,
  };

  try {
    const stdout = execFileSync('node', [SCRIPT, ...args], {
      cwd: options.cwd,
      env,
      encoding: 'utf8',
      stdio: ['pipe', 'pipe', 'pipe'],
      timeout: CLI_TIMEOUT_MS,
    });

    return { code: 0, stdout, stderr: '' };
  } catch (error) {
    return {
      code: error.status || 1,
      stdout: error.stdout || '',
      stderr: error.stderr || '',
    };
  }
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
  console.log('\n=== Testing uninstall.js ===\n');

  let passed = 0;
  let failed = 0;

  if (test('uninstalls files from a real install-apply state and preserves unrelated files', () => {
    const homeDir = createTempDir('uninstall-home-');
    const projectRoot = createTempDir('uninstall-project-');

    try {
      const installStdout = execFileSync('node', [INSTALL_SCRIPT, '--target', 'cursor', 'typescript'], {
        cwd: projectRoot,
        env: {
          ...process.env,
          HOME: homeDir,
        },
        encoding: 'utf8',
        stdio: ['pipe', 'pipe', 'pipe'],
        timeout: CLI_TIMEOUT_MS,
      });
      assert.ok(installStdout.includes('Done. Install-state written'));

      const normalizedProjectRoot = fs.realpathSync(projectRoot);
      const managedPath = path.join(normalizedProjectRoot, '.cursor', 'hooks.json');
      const statePath = path.join(normalizedProjectRoot, '.cursor', 'ecc-install-state.json');
      const unrelatedPath = path.join(normalizedProjectRoot, '.cursor', 'custom-user-note.txt');
      fs.writeFileSync(unrelatedPath, 'leave me alone');

      const uninstallResult = run(['--target', 'cursor'], {
        cwd: projectRoot,
        homeDir,
      });
      assert.strictEqual(uninstallResult.code, 0, uninstallResult.stderr);
      assert.ok(uninstallResult.stdout.includes('Uninstall summary'));
      assert.ok(!fs.existsSync(managedPath));
      assert.ok(!fs.existsSync(statePath));
      assert.ok(fs.existsSync(unrelatedPath));
    } finally {
      cleanup(homeDir);
      cleanup(projectRoot);
    }
  })) passed++; else failed++;

  if (test('reverses non-copy operations and keeps unrelated files', () => {
    const homeDir = createTempDir('uninstall-home-');
    const projectRoot = createTempDir('uninstall-project-');

    try {
      const targetRoot = path.join(projectRoot, '.cursor');
      fs.mkdirSync(targetRoot, { recursive: true });
      const normalizedTargetRoot = fs.realpathSync(targetRoot);
      const statePath = path.join(normalizedTargetRoot, 'ecc-install-state.json');
      const copiedPath = path.join(normalizedTargetRoot, 'managed-rule.md');
      const mergedPath = path.join(normalizedTargetRoot, 'hooks.json');
      const removedPath = path.join(normalizedTargetRoot, 'legacy-note.txt');
      const unrelatedPath = path.join(normalizedTargetRoot, 'custom-user-note.txt');
      fs.writeFileSync(copiedPath, 'managed\n');
      fs.writeFileSync(mergedPath, JSON.stringify({
        existing: true,
        managed: true,
      }, null, 2));
      fs.writeFileSync(unrelatedPath, 'leave me alone');

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
            kind: 'copy-file',
            moduleId: 'platform-configs',
            sourceRelativePath: 'rules/common/coding-style.md',
            destinationPath: copiedPath,
            strategy: 'preserve-relative-path',
            ownership: 'managed',
            scaffoldOnly: false,
          },
          {
            kind: 'merge-json',
            moduleId: 'platform-configs',
            sourceRelativePath: '.cursor/hooks.json',
            destinationPath: mergedPath,
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
          {
            kind: 'remove',
            moduleId: 'platform-configs',
            sourceRelativePath: '.cursor/legacy-note.txt',
            destinationPath: removedPath,
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

      const uninstallResult = run(['--target', 'cursor'], {
        cwd: projectRoot,
        homeDir,
      });
      assert.strictEqual(uninstallResult.code, 0, uninstallResult.stderr);
      assert.ok(uninstallResult.stdout.includes('Uninstall summary'));
      assert.ok(!fs.existsSync(copiedPath));
      assert.deepStrictEqual(JSON.parse(fs.readFileSync(mergedPath, 'utf8')), {
        existing: true,
      });
      assert.strictEqual(fs.readFileSync(removedPath, 'utf8'), 'restore me\n');
      assert.ok(!fs.existsSync(statePath));
      assert.ok(fs.existsSync(unrelatedPath));
    } finally {
      cleanup(homeDir);
      cleanup(projectRoot);
    }
  })) passed++; else failed++;

  if (test('supports dry-run without mutating managed files', () => {
    const homeDir = createTempDir('uninstall-home-');
    const projectRoot = createTempDir('uninstall-project-');

    try {
      const targetRoot = path.join(projectRoot, '.cursor');
      fs.mkdirSync(targetRoot, { recursive: true });
      const normalizedTargetRoot = fs.realpathSync(targetRoot);
      const statePath = path.join(normalizedTargetRoot, 'ecc-install-state.json');
      const renderedPath = path.join(normalizedTargetRoot, 'generated.md');
      fs.writeFileSync(renderedPath, '# generated\n');

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

      const uninstallResult = run(['--target', 'cursor', '--dry-run', '--json'], {
        cwd: projectRoot,
        homeDir,
      });
      assert.strictEqual(uninstallResult.code, 0, uninstallResult.stderr);

      const parsed = JSON.parse(uninstallResult.stdout);
      assert.strictEqual(parsed.dryRun, true);
      assert.ok(parsed.results[0].plannedRemovals.includes(renderedPath));
      assert.ok(fs.existsSync(renderedPath));
      assert.ok(fs.existsSync(statePath));
    } finally {
      cleanup(homeDir);
      cleanup(projectRoot);
    }
  })) passed++; else failed++;

  console.log(`\nResults: Passed: ${passed}, Failed: ${failed}`);
  process.exit(failed > 0 ? 1 : 0);
}

runTests();
