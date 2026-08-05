/**
 * Tests for scripts/doctor.js
 */

const assert = require('assert');
const fs = require('fs');
const os = require('os');
const path = require('path');
const { execFileSync } = require('child_process');

const SCRIPT = path.join(__dirname, '..', '..', 'scripts', 'doctor.js');
const REPO_ROOT = path.join(__dirname, '..', '..');
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
      timeout: 10000,
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
  console.log('\n=== Testing doctor.js ===\n');

  let passed = 0;
  let failed = 0;

  if (test('points users without install state to the guided problem report', () => {
    const homeDir = createTempDir('doctor-home-');
    const projectRoot = createTempDir('doctor-project-');

    try {
      const result = run([], { cwd: projectRoot, homeDir });
      assert.strictEqual(result.code, 0, result.stderr);
      assert.ok(result.stdout.includes('install-problem.yml'));
      assert.ok(result.stdout.includes('does not upload diagnostics'));
    } finally {
      cleanup(homeDir);
      cleanup(projectRoot);
    }
  })) passed++; else failed++;

  if (test('reports a healthy install with exit code 0', () => {
    const homeDir = createTempDir('doctor-home-');
    const projectRoot = createTempDir('doctor-project-');

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

      const result = run(['--target', 'claude'], { cwd: projectRoot, homeDir });
      assert.strictEqual(result.code, 0, result.stderr);
      assert.ok(result.stdout.includes('Doctor report'));
      assert.ok(result.stdout.includes('Status: OK'));
    } finally {
      cleanup(homeDir);
      cleanup(projectRoot);
    }
  })) passed++; else failed++;

  if (test('reports issues and exits 1 for unhealthy installs', () => {
    const homeDir = createTempDir('doctor-home-');
    const projectRoot = createTempDir('doctor-project-');

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

      const result = run(['--target', 'cursor', '--json'], { cwd: projectRoot, homeDir });
      assert.strictEqual(result.code, 1);
      const parsed = JSON.parse(result.stdout);
      assert.strictEqual(parsed.summary.errorCount, 1);
      assert.ok(parsed.results[0].issues.some(issue => issue.code === 'missing-managed-files'));
    } finally {
      cleanup(homeDir);
      cleanup(projectRoot);
    }
  })) passed++; else failed++;

  console.log(`\nResults: Passed: ${passed}, Failed: ${failed}`);
  process.exit(failed > 0 ? 1 : 0);
}

runTests();
