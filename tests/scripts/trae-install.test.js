/**
 * Tests for .trae/install.sh and .trae/uninstall.sh
 */

const assert = require('assert');
const fs = require('fs');
const os = require('os');
const path = require('path');
const { execFileSync } = require('child_process');

const REPO_ROOT = path.join(__dirname, '..', '..');
const INSTALL_SCRIPT = path.join(REPO_ROOT, '.trae', 'install.sh');
const UNINSTALL_SCRIPT = path.join(REPO_ROOT, '.trae', 'uninstall.sh');

function createTempDir(prefix) {
  return fs.mkdtempSync(path.join(os.tmpdir(), prefix));
}

function cleanup(dirPath) {
  fs.rmSync(dirPath, { recursive: true, force: true });
}

function runInstall(options = {}) {
  return execFileSync('bash', [INSTALL_SCRIPT, ...(options.args || [])], {
    cwd: options.cwd,
    env: {
      ...process.env,
      HOME: options.homeDir || process.env.HOME,
    },
    encoding: 'utf8',
    stdio: ['pipe', 'pipe', 'pipe'],
    timeout: 300000,
  });
}

function runUninstall(options = {}) {
  return execFileSync('bash', [UNINSTALL_SCRIPT, ...(options.args || [])], {
    cwd: options.cwd,
    env: {
      ...process.env,
      HOME: options.homeDir || process.env.HOME,
    },
    encoding: 'utf8',
    input: options.input || 'y\n',
    stdio: ['pipe', 'pipe', 'pipe'],
    timeout: 300000,
  });
}

function readManifestLines(projectRoot) {
  const manifestPath = path.join(projectRoot, '.trae', '.ecc-manifest');
  return fs.readFileSync(manifestPath, 'utf8')
    .split(/\r?\n/)
    .map((line) => line.trim())
    .filter(Boolean);
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
  console.log('\n=== Testing Trae install/uninstall scripts ===\n');

  let passed = 0;
  let failed = 0;

  if (process.platform === 'win32') {
    console.log('  - skipped on Windows; Trae shell scripts are Unix-only');
    console.log(`\nResults: Passed: ${passed}, Failed: ${failed}`);
    process.exit(0);
  }

  if (test('does not claim ownership of preexisting target files', () => {
    const homeDir = createTempDir('trae-home-');
    const projectRoot = createTempDir('trae-project-');

    try {
      const preexistingCommandPath = path.join(projectRoot, '.trae', 'commands', 'quality-gate.md');
      fs.mkdirSync(path.dirname(preexistingCommandPath), { recursive: true });
      fs.writeFileSync(preexistingCommandPath, 'user owned command\n');

      runInstall({ cwd: projectRoot, homeDir });

      const manifestLines = readManifestLines(projectRoot);
      assert.ok(!manifestLines.includes('commands/quality-gate.md'), 'Preexisting file should not be recorded in manifest');

      runUninstall({ cwd: projectRoot, homeDir });

      assert.strictEqual(fs.readFileSync(preexistingCommandPath, 'utf8'), 'user owned command\n');
    } finally {
      cleanup(homeDir);
      cleanup(projectRoot);
    }
  })) passed++; else failed++;

  if (test('records nested skill files and the full rules tree in the manifest', () => {
    const homeDir = createTempDir('trae-home-');
    const projectRoot = createTempDir('trae-project-');

    try {
      runInstall({ cwd: projectRoot, homeDir });

      const manifestLines = readManifestLines(projectRoot);
      assert.ok(manifestLines.includes('skills/skill-comply/pyproject.toml'));
      assert.ok(manifestLines.includes('rules/common/code-review.md'));
      assert.ok(manifestLines.includes('rules/python/coding-style.md'));
      assert.ok(manifestLines.includes('rules/web/performance.md'));

      assert.ok(fs.existsSync(path.join(projectRoot, '.trae', 'skills', 'skill-comply', 'pyproject.toml')));
      assert.ok(fs.existsSync(path.join(projectRoot, '.trae', 'rules', 'python', 'coding-style.md')));
      assert.ok(fs.existsSync(path.join(projectRoot, '.trae', 'rules', 'web', 'performance.md')));
    } finally {
      cleanup(homeDir);
      cleanup(projectRoot);
    }
  })) passed++; else failed++;

  if (test('reinstall preserves managed manifest coverage without duplicate entries', () => {
    const homeDir = createTempDir('trae-home-');
    const projectRoot = createTempDir('trae-project-');

    try {
      runInstall({ cwd: projectRoot, homeDir });

      const managedCommandPath = path.join(projectRoot, '.trae', 'commands', 'quality-gate.md');
      fs.rmSync(managedCommandPath);

      runInstall({ cwd: projectRoot, homeDir });

      const manifestLines = readManifestLines(projectRoot);
      const entryCount = manifestLines.filter((line) => line === 'commands/quality-gate.md').length;

      assert.strictEqual(entryCount, 1, 'Managed file should appear once in manifest after reinstall');
      assert.ok(fs.existsSync(managedCommandPath), 'Managed file should be recreated on reinstall');
    } finally {
      cleanup(homeDir);
      cleanup(projectRoot);
    }
  })) passed++; else failed++;

  if (test('uninstall rejects manifest entries that escape the Trae root via symlink traversal', () => {
    const homeDir = createTempDir('trae-home-');
    const projectRoot = createTempDir('trae-project-');
    const externalRoot = createTempDir('trae-outside-');

    try {
      const traeRoot = path.join(projectRoot, '.trae');
      fs.mkdirSync(traeRoot, { recursive: true });

      const outsideSecretPath = path.join(externalRoot, 'secret.txt');
      fs.writeFileSync(outsideSecretPath, 'do not remove\n');
      fs.symlinkSync(externalRoot, path.join(traeRoot, 'escape-link'));
      fs.writeFileSync(path.join(traeRoot, '.ecc-manifest'), 'escape-link/secret.txt\n.ecc-manifest\n');

      const stdout = runUninstall({ cwd: projectRoot, homeDir });

      assert.ok(stdout.includes('Skipped: escape-link/secret.txt (invalid manifest entry)'));
      assert.strictEqual(fs.readFileSync(outsideSecretPath, 'utf8'), 'do not remove\n');
    } finally {
      cleanup(homeDir);
      cleanup(projectRoot);
      cleanup(externalRoot);
    }
  })) passed++; else failed++;

  console.log(`\nResults: Passed: ${passed}, Failed: ${failed}`);
  process.exit(failed > 0 ? 1 : 0);
}

runTests();
