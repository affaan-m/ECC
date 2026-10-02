/**
 * Tests for install.ps1 wrapper delegation
 */

const assert = require('assert');
const fs = require('fs');
const os = require('os');
const path = require('path');
const { execFileSync, spawnSync } = require('child_process');

const SCRIPT = path.join(__dirname, '..', '..', 'install.ps1');
const PACKAGE_JSON = path.join(__dirname, '..', '..', 'package.json');

function createTempDir(prefix) {
  return fs.mkdtempSync(path.join(os.tmpdir(), prefix));
}

function cleanup(dirPath) {
  fs.rmSync(dirPath, { recursive: true, force: true });
}

function normalizePathForOutput(value) {
  const normalized = String(value).replace(/\\/g, '/');
  return process.platform === 'win32' ? normalized.toLowerCase() : normalized;
}

function canonicalizePlannedPath(value) {
  const resolved = path.resolve(String(value).trim());
  const canonicalParent = fs.realpathSync.native(path.dirname(resolved));
  return normalizePathForOutput(path.join(canonicalParent, path.basename(resolved)));
}

function extractInstallRoot(stdout) {
  const match = String(stdout).match(/^Install root:\s*(.+?)\r?$/m);
  assert.ok(match, `dry-run output should include an Install root field:\n${stdout}`);
  return match[1];
}

function resolvePowerShellCommand() {
  const candidates = process.platform === 'win32'
    ? ['powershell.exe', 'pwsh.exe', 'pwsh']
    : ['pwsh'];

  for (const candidate of candidates) {
    const result = spawnSync(candidate, ['-NoLogo', '-NoProfile', '-Command', '$PSVersionTable.PSVersion.ToString()'], {
      encoding: 'utf8',
      stdio: ['pipe', 'pipe', 'pipe'],
      timeout: 5000,
    });

    if (!result.error && result.status === 0) {
      return candidate;
    }
  }

  return null;
}

function run(powerShellCommand, args = [], options = {}) {
  const env = {
    ...process.env,
    HOME: options.homeDir || process.env.HOME,
    USERPROFILE: options.homeDir || process.env.USERPROFILE,
  };

  try {
    const stdout = execFileSync(powerShellCommand, ['-NoLogo', '-NoProfile', '-ExecutionPolicy', 'Bypass', '-File', SCRIPT, ...args], {
      cwd: options.cwd,
      env,
      encoding: 'utf8',
      stdio: ['pipe', 'pipe', 'pipe'],
      timeout: 30000,
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
  console.log('\n=== Testing install.ps1 ===\n');

  let passed = 0;
  let failed = 0;
  const powerShellCommand = resolvePowerShellCommand();

  if (test('publishes ecc-install through the Node installer runtime for cross-platform npm usage', () => {
    const packageJson = JSON.parse(fs.readFileSync(PACKAGE_JSON, 'utf8'));
    assert.strictEqual(packageJson.bin['ecc-install'], 'scripts/install-apply.js');
  })) passed++; else failed++;

  if (test('compares planned install roots by canonical path instead of leaf name', () => {
    const fixtureRoot = createTempDir('install-ps1-paths-');
    const expectedProject = path.join(fixtureRoot, 'expected', 'same-project');
    const unrelatedProject = path.join(fixtureRoot, 'unrelated', 'same-project');

    try {
      fs.mkdirSync(expectedProject, { recursive: true });
      fs.mkdirSync(unrelatedProject, { recursive: true });
      assert.notStrictEqual(
        canonicalizePlannedPath(path.join(expectedProject, '.agents')),
        canonicalizePlannedPath(path.join(unrelatedProject, '.agents'))
      );
    } finally {
      cleanup(fixtureRoot);
    }
  })) passed++; else failed++;

  if (!powerShellCommand) {
    console.log('  - skipped delegation test; PowerShell is not available in PATH');
  } else if (test('delegates to the Antigravity installer while preserving the project cwd', () => {
    const homeDir = createTempDir('install-ps1-home-');
    const projectDir = createTempDir('install-ps1-project-');

    try {
      const result = run(powerShellCommand, ['--target', 'antigravity', '--dry-run', 'typescript'], {
        cwd: projectDir,
        homeDir,
      });

      assert.strictEqual(result.code, 0, result.stderr);
      assert.ok(result.stdout.includes('Dry-run install plan'));
      assert.strictEqual(
        canonicalizePlannedPath(extractInstallRoot(result.stdout)),
        canonicalizePlannedPath(path.join(projectDir, '.agents')),
        `dry-run output should target the project .agents directory:\n${result.stdout}`
      );
      assert.ok(!fs.existsSync(path.join(projectDir, '.agents')));
    } finally {
      cleanup(homeDir);
      cleanup(projectDir);
    }
  })) passed++; else failed++;

  if (!powerShellCommand) {
    console.log('  - skipped help text test; PowerShell is not available in PATH');
  } else if (test('exposes the corrected Claude target help text', () => {
    const result = run(powerShellCommand, ['--help']);
    assert.strictEqual(result.code, 0, result.stderr);
    assert.ok(
      result.stdout.includes('claude       (default) - Install ECC into ~/.claude/'),
      'help text should describe the Claude target as a full ~/.claude install surface'
    );
  })) passed++; else failed++;

  console.log(`\nResults: Passed: ${passed}, Failed: ${failed}`);
  process.exit(failed > 0 ? 1 : 0);
}

runTests();
