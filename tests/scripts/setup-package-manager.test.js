/**
 * Tests for scripts/node/setup-package-manager.js
 *
 * Tests CLI argument parsing and output via subprocess invocation.
 *
 * Run with: node tests/scripts/setup-package-manager.test.js
 */

const assert = require('assert');
const path = require('path');
const fs = require('fs');
const os = require('os');
const { execFileSync, spawnSync } = require('child_process');

const SCRIPT = path.join(__dirname, '..', '..', 'scripts', 'node', 'setup-package-manager.js');

// Run the script with given args, return { stdout, stderr, code }
function run(args = [], env = {}) {
  try {
    const stdout = execFileSync('node', [SCRIPT, ...args], {
      encoding: 'utf8',
      stdio: ['pipe', 'pipe', 'pipe'],
      env: { ...process.env, ...env },
      timeout: 10000
    });
    return { stdout, stderr: '', code: 0 };
  } catch (err) {
    return {
      stdout: err.stdout || '',
      stderr: err.stderr || '',
      code: err.status || 1
    };
  }
}

// Test helper
function test(name, fn) {
  try {
    fn();
    console.log(`  \u2713 ${name}`);
    return true;
  } catch (err) {
    console.log(`  \u2717 ${name}`);
    console.log(`    Error: ${err.message}`);
    return false;
  }
}

function runTests() {
  console.log('\n=== Testing setup-package-manager.js ===\n');

  let passed = 0;
  let failed = 0;

  // --help flag
  console.log('--help:');

  if (test('shows help with --help flag', () => {
    const result = run(['--help']);
    assert.strictEqual(result.code, 0);
    assert.ok(result.stdout.includes('Package Manager Setup'));
    assert.ok(result.stdout.includes('--detect'));
    assert.ok(result.stdout.includes('--global'));
    assert.ok(result.stdout.includes('--project'));
  })) passed++; else failed++;

  if (test('shows help with -h flag', () => {
    const result = run(['-h']);
    assert.strictEqual(result.code, 0);
    assert.ok(result.stdout.includes('Package Manager Setup'));
  })) passed++; else failed++;

  if (test('shows help with no arguments', () => {
    const result = run([]);
    assert.strictEqual(result.code, 0);
    assert.ok(result.stdout.includes('Package Manager Setup'));
  })) passed++; else failed++;

  // --detect flag
  console.log('\n--detect:');

  if (test('detects current package manager', () => {
    const result = run(['--detect']);
    assert.strictEqual(result.code, 0);
    assert.ok(result.stdout.includes('Package Manager Detection'));
    assert.ok(result.stdout.includes('Current selection'));
  })) passed++; else failed++;

  if (test('shows detection sources', () => {
    const result = run(['--detect']);
    assert.ok(result.stdout.includes('From package.json'));
    assert.ok(result.stdout.includes('From lock file'));
    assert.ok(result.stdout.includes('Environment var'));
  })) passed++; else failed++;

  if (test('shows available managers in detection output', () => {
    const result = run(['--detect']);
    assert.ok(result.stdout.includes('npm'));
    assert.ok(result.stdout.includes('pnpm'));
    assert.ok(result.stdout.includes('yarn'));
    assert.ok(result.stdout.includes('bun'));
  })) passed++; else failed++;

  // --list flag
  console.log('\n--list:');

  if (test('lists available package managers', () => {
    const result = run(['--list']);
    assert.strictEqual(result.code, 0);
    assert.ok(result.stdout.includes('Available Package Managers'));
    assert.ok(result.stdout.includes('npm'));
    assert.ok(result.stdout.includes('Lock file'));
    assert.ok(result.stdout.includes('Install'));
  })) passed++; else failed++;

  // --global flag
  console.log('\n--global:');

  if (test('rejects --global without package manager name', () => {
    const result = run(['--global']);
    assert.strictEqual(result.code, 1);
    assert.ok(result.stderr.includes('requires a package manager name'));
  })) passed++; else failed++;

  if (test('rejects --global with unknown package manager', () => {
    const result = run(['--global', 'unknown-pm']);
    assert.strictEqual(result.code, 1);
    assert.ok(result.stderr.includes('Unknown package manager'));
  })) passed++; else failed++;

  // --project flag
  console.log('\n--project:');

  if (test('rejects --project without package manager name', () => {
    const result = run(['--project']);
    assert.strictEqual(result.code, 1);
    assert.ok(result.stderr.includes('requires a package manager name'));
  })) passed++; else failed++;

  if (test('rejects --project with unknown package manager', () => {
    const result = run(['--project', 'unknown-pm']);
    assert.strictEqual(result.code, 1);
    assert.ok(result.stderr.includes('Unknown package manager'));
  })) passed++; else failed++;

  // Positional argument
  console.log('\npositional argument:');

  if (test('rejects unknown positional argument', () => {
    const result = run(['not-a-pm']);
    assert.strictEqual(result.code, 1);
    assert.ok(result.stderr.includes('Unknown option or package manager'));
  })) passed++; else failed++;

  // Environment variable
  console.log('\nenvironment variable:');

  if (test('detects env var override', () => {
    const result = run(['--detect'], { CLAUDE_PACKAGE_MANAGER: 'pnpm' });
    assert.strictEqual(result.code, 0);
    assert.ok(result.stdout.includes('pnpm'));
  })) passed++; else failed++;

  // --detect output completeness
  console.log('\n--detect output completeness:');

  if (test('shows all three command types in detection output', () => {
    const result = run(['--detect']);
    assert.strictEqual(result.code, 0);
    assert.ok(result.stdout.includes('Install:'), 'Should show Install command');
    assert.ok(result.stdout.includes('Run script:'), 'Should show Run script command');
    assert.ok(result.stdout.includes('Execute binary:'), 'Should show Execute binary command');
  })) passed++; else failed++;

  if (test('shows current marker for active package manager', () => {
    const result = run(['--detect']);
    assert.ok(result.stdout.includes('(current)'), 'Should mark current PM');
  })) passed++; else failed++;

  // Flag-as-PM-name behavior (local code treats flags as PM names)
  console.log('\n--global flag-as-PM-name (local behavior):');

  if (test('--global --project treats --project as unknown PM', () => {
    const result = run(['--global', '--project']);
    assert.strictEqual(result.code, 1);
    assert.ok(result.stderr.includes('Unknown package manager'),
      'Local code passes flag as PM name to setGlobal');
  })) passed++; else failed++;

  if (test('--global --unknown-flag treats flag as unknown PM', () => {
    const result = run(['--global', '--foo-bar']);
    assert.strictEqual(result.code, 1);
    assert.ok(result.stderr.includes('Unknown package manager'));
  })) passed++; else failed++;

  if (test('--global --list is handled by --list check first (exit 0)', () => {
    const result = run(['--global', '--list']);
    assert.strictEqual(result.code, 0);
    assert.ok(result.stdout.includes('Available Package Managers'));
  })) passed++; else failed++;

  console.log('\n--project flag-as-PM-name (local behavior):');

  if (test('--project --global is caught by global handler first', () => {
    // args = ['--project', '--global']
    // globalIdx = 1, pmName = args[2] = undefined → requires a package manager name
    const result = run(['--project', '--global']);
    assert.strictEqual(result.code, 1);
    assert.ok(result.stderr.includes('requires a package manager name'));
  })) passed++; else failed++;

  if (test('--project --unknown-flag treats flag as unknown PM', () => {
    const result = run(['--project', '--bar']);
    assert.strictEqual(result.code, 1);
    assert.ok(result.stderr.includes('Unknown package manager'));
  })) passed++; else failed++;

  // --detect marker uniqueness
  console.log('\n--detect marker uniqueness:');

  if (test('--detect output shows exactly one (current) marker', () => {
    const result = run(['--detect']);
    assert.strictEqual(result.code, 0);
    const lines = result.stdout.split('\n');
    const currentLines = lines.filter(l => l.includes('(current)'));
    assert.strictEqual(currentLines.length, 1, `Expected exactly 1 "(current)" marker, found ${currentLines.length}`);
    assert.ok(/\b(npm|pnpm|yarn|bun)\b/.test(currentLines[0]), 'Current marker should be on a PM line');
  })) passed++; else failed++;

  console.log('\n--list output completeness:');

  if (test('--list shows all four supported package managers', () => {
    const result = run(['--list']);
    assert.strictEqual(result.code, 0);
    for (const pm of ['npm', 'pnpm', 'yarn', 'bun']) {
      assert.ok(result.stdout.includes(pm), `Should list ${pm}`);
    }
    const lockFileCount = (result.stdout.match(/Lock file:/g) || []).length;
    assert.strictEqual(lockFileCount, 4, `Expected 4 "Lock file:" entries, found ${lockFileCount}`);
    const installCount = (result.stdout.match(/Install:/g) || []).length;
    assert.strictEqual(installCount, 4, `Expected 4 "Install:" entries, found ${installCount}`);
  })) passed++; else failed++;

  // --global success path
  console.log('\n--global success path:');

  if (test('--global npm writes config and succeeds', () => {
    const tmpDir = path.join(os.tmpdir(), `spm-test-global-${Date.now()}`);
    fs.mkdirSync(tmpDir, { recursive: true });
    try {
      const result = run(['--global', 'npm'], { HOME: tmpDir, USERPROFILE: tmpDir });
      assert.strictEqual(result.code, 0, `Expected exit 0, got ${result.code}. stderr: ${result.stderr}`);
      assert.ok(result.stdout.includes('Global preference set to'), 'Should show success message');
      assert.ok(result.stdout.includes('npm'), 'Should mention npm');
      const configPath = path.join(tmpDir, '.claude', 'package-manager.json');
      assert.ok(fs.existsSync(configPath), 'Config file should be created');
      const config = JSON.parse(fs.readFileSync(configPath, 'utf8'));
      assert.strictEqual(config.packageManager, 'npm', 'Config should contain npm');
    } finally {
      fs.rmSync(tmpDir, { recursive: true, force: true });
    }
  })) passed++; else failed++;

  console.log('\nbare PM name success:');

  if (test('bare npm sets global preference and succeeds', () => {
    const tmpDir = path.join(os.tmpdir(), `spm-test-bare-${Date.now()}`);
    fs.mkdirSync(tmpDir, { recursive: true });
    try {
      const result = run(['npm'], { HOME: tmpDir, USERPROFILE: tmpDir });
      assert.strictEqual(result.code, 0, `Expected exit 0, got ${result.code}. stderr: ${result.stderr}`);
      assert.ok(result.stdout.includes('Global preference set to'), 'Should show success message');
      const configPath = path.join(tmpDir, '.claude', 'package-manager.json');
      assert.ok(fs.existsSync(configPath), 'Config file should be created');
      const config = JSON.parse(fs.readFileSync(configPath, 'utf8'));
      assert.strictEqual(config.packageManager, 'npm', 'Config should contain npm');
    } finally {
      fs.rmSync(tmpDir, { recursive: true, force: true });
    }
  })) passed++; else failed++;

  console.log('\n--detect source label:');

  if (test('--detect with env var shows source as environment', () => {
    const result = run(['--detect'], { CLAUDE_PACKAGE_MANAGER: 'pnpm' });
    assert.strictEqual(result.code, 0);
    assert.ok(result.stdout.includes('Source: environment'), 'Should show environment as source');
  })) passed++; else failed++;

  // --project success path
  console.log('\n--project success path:');

  if (test('--project npm writes project config and succeeds', () => {
    const tmpDir = path.join(os.tmpdir(), `spm-test-project-${Date.now()}`);
    fs.mkdirSync(tmpDir, { recursive: true });
    try {
      const result = spawnSync('node', [SCRIPT, '--project', 'npm'], {
        encoding: 'utf8',
        stdio: ['pipe', 'pipe', 'pipe'],
        env: { ...process.env },
        timeout: 10000,
        cwd: tmpDir
      });
      assert.strictEqual(result.status, 0, `Expected exit 0, got ${result.status}. stderr: ${result.stderr}`);
      assert.ok(result.stdout.includes('Project preference set to'), 'Should show project success message');
      assert.ok(result.stdout.includes('npm'), 'Should mention npm');
      const configPath = path.join(tmpDir, '.claude', 'package-manager.json');
      assert.ok(fs.existsSync(configPath), 'Project config file should be created in CWD');
      const config = JSON.parse(fs.readFileSync(configPath, 'utf8'));
      assert.strictEqual(config.packageManager, 'npm', 'Config should contain npm');
    } finally {
      fs.rmSync(tmpDir, { recursive: true, force: true });
    }
  })) passed++; else failed++;

  console.log('\n--list (current) marker:');

  if (test('--list output includes (current) marker for active PM', () => {
    const result = run(['--list']);
    assert.strictEqual(result.code, 0);
    assert.ok(result.stdout.includes('(current)'), '--list should mark the active PM with (current)');
    const currentCount = (result.stdout.match(/\(current\)/g) || []).length;
    assert.strictEqual(currentCount, 1, `Expected exactly 1 "(current)" in --list, found ${currentCount}`);
  })) passed++; else failed++;

  // Error path: save failure
  console.log('\n--global save failure:');

  if (test('--global npm fails when HOME is not a directory', () => {
    if (process.platform === 'win32') {
      console.log('    (skipped - /dev/null not available on Windows)');
      return;
    }
    const result = run(['--global', 'npm'], { HOME: '/dev/null', USERPROFILE: '/dev/null' });
    assert.strictEqual(result.code, 1, `Expected exit 1, got ${result.code}`);
    assert.ok(result.stderr.includes('Error:'),
      `stderr should contain Error:, got: ${result.stderr}`);
  })) passed++; else failed++;

  console.log('\n--project save failure:');

  if (test('--project npm fails when CWD is read-only', () => {
    if (process.platform === 'win32' || process.getuid?.() === 0) {
      console.log('    (skipped - chmod ineffective on Windows/root)');
      return;
    }
    const tmpDir = path.join(os.tmpdir(), `spm-test-ro-${Date.now()}`);
    fs.mkdirSync(tmpDir, { recursive: true });
    try {
      fs.chmodSync(tmpDir, 0o555);
      const result = spawnSync('node', [SCRIPT, '--project', 'npm'], {
        encoding: 'utf8',
        stdio: ['pipe', 'pipe', 'pipe'],
        env: { ...process.env },
        timeout: 10000,
        cwd: tmpDir
      });
      assert.strictEqual(result.status, 1,
        `Expected exit 1, got ${result.status}. stderr: ${result.stderr}`);
      assert.ok(result.stderr.includes('Error:'),
        `stderr should contain Error:, got: ${result.stderr}`);
    } finally {
      try { fs.chmodSync(tmpDir, 0o755); } catch { /* best-effort */ }
      fs.rmSync(tmpDir, { recursive: true, force: true });
    }
  })) passed++; else failed++;

  // Summary
  console.log(`\n=== Test Results ===`);
  console.log(`Passed: ${passed}, Failed: ${failed}`);
  process.exit(failed > 0 ? 1 : 0);
}

runTests();
