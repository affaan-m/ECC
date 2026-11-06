/**
 * Tests for scripts/setup-package-manager.js
 *
 * Tests CLI argument parsing and output via subprocess invocation.
 *
 * Run with: node tests/scripts/setup-package-manager.test.js
 */

const assert = require('assert');
const path = require('path');
const fs = require('fs');
const os = require('os');
const { execFileSync } = require('child_process');

const SCRIPT = path.join(__dirname, '..', '..', 'scripts', 'setup-package-manager.js');

// Run the script with given args, return { stdout, stderr, code }
function run(args = [], env = {}, cwd = process.cwd()) {
  try {
    const stdout = execFileSync('node', [SCRIPT, ...args], {
      encoding: 'utf8',
      cwd,
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

  for (const name of ['constructor', 'toString', '__proto__']) {
    for (const args of [[name], ['--global', name], ['--project', name]]) {
      if (test(`rejects inherited package manager: ${args.join(' ')}`, () => {
        const home = fs.mkdtempSync(path.join(os.tmpdir(), 'pm-cli-invalid-'));
        try {
          const result = run(args, {
            HOME: home,
            USERPROFILE: home,
            ECC_AGENT_DATA_HOME: path.join(home, '.claude')
          }, home);
          assert.strictEqual(result.code, 1);
          assert.ok(result.stderr.includes('Unknown'));
          assert.ok(!fs.existsSync(path.join(home, '.claude', 'package-manager.json')));
        } finally {
          fs.rmSync(home, { recursive: true, force: true });
        }
      })) passed++; else failed++;
    }
  }

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

  // ── Round 31: flag-as-PM-name rejection ──
  // Note: --help, --detect, --list are checked BEFORE --global/--project in argv
  // parsing, so passing e.g. --global --list triggers the --list handler first.
  // The startsWith('-') fix protects against flags that AREN'T caught earlier,
  // like --global --project or --project --unknown-flag.
  console.log('\n--global flag validation (Round 31):');

  if (test('rejects --global --project (flag not caught by earlier checks)', () => {
    const result = run(['--global', '--project']);
    assert.strictEqual(result.code, 1);
    assert.ok(result.stderr.includes('requires a package manager name'));
  })) passed++; else failed++;

  if (test('rejects --global --unknown-flag (arbitrary flag as PM name)', () => {
    const result = run(['--global', '--foo-bar']);
    assert.strictEqual(result.code, 1);
    assert.ok(result.stderr.includes('requires a package manager name'));
  })) passed++; else failed++;

  if (test('rejects --global -x (single-dash flag as PM name)', () => {
    const result = run(['--global', '-x']);
    assert.strictEqual(result.code, 1);
    assert.ok(result.stderr.includes('requires a package manager name'));
  })) passed++; else failed++;

  if (test('--global --list is handled by --list check first (exit 0)', () => {
    // --list is checked before --global in the parsing order
    const result = run(['--global', '--list']);
    assert.strictEqual(result.code, 0);
    assert.ok(result.stdout.includes('Available Package Managers'));
  })) passed++; else failed++;

  console.log('\n--project flag validation (Round 31):');

  if (test('rejects --project --global (cross-flag confusion)', () => {
    // --global handler runs before --project, catches it first
    const result = run(['--project', '--global']);
    assert.strictEqual(result.code, 1);
    assert.ok(result.stderr.includes('requires a package manager name'));
  })) passed++; else failed++;

  if (test('rejects --project --unknown-flag', () => {
    const result = run(['--project', '--bar']);
    assert.strictEqual(result.code, 1);
    assert.ok(result.stderr.includes('requires a package manager name'));
  })) passed++; else failed++;

  if (test('rejects --project -z (single-dash flag)', () => {
    const result = run(['--project', '-z']);
    assert.strictEqual(result.code, 1);
    assert.ok(result.stderr.includes('requires a package manager name'));
  })) passed++; else failed++;

  // ── Round 45: output completeness and marker uniqueness ──
  console.log('\n--detect marker uniqueness (Round 45):');

  if (test('--detect output shows exactly one (current) marker', () => {
    const result = run(['--detect']);
    assert.strictEqual(result.code, 0);
    const lines = result.stdout.split('\n');
    const currentLines = lines.filter(l => l.includes('(current)'));
    assert.strictEqual(currentLines.length, 1, `Expected exactly 1 "(current)" marker, found ${currentLines.length}`);
    // The (current) marker should be on a line with a PM name
    assert.ok(/\b(npm|pnpm|yarn|bun)\b/.test(currentLines[0]), 'Current marker should be on a PM line');
  })) passed++; else failed++;

  console.log('\n--list output completeness (Round 45):');

  if (test('--list shows all four supported package managers', () => {
    const result = run(['--list']);
    assert.strictEqual(result.code, 0);
    for (const pm of ['npm', 'pnpm', 'yarn', 'bun']) {
      assert.ok(result.stdout.includes(pm), `Should list ${pm}`);
    }
    // Each PM should show Lock file and Install info
    const lockFileCount = (result.stdout.match(/Lock file:/g) || []).length;
    assert.strictEqual(lockFileCount, 4, `Expected 4 "Lock file:" entries, found ${lockFileCount}`);
    const installCount = (result.stdout.match(/Install:/g) || []).length;
    assert.strictEqual(installCount, 4, `Expected 4 "Install:" entries, found ${installCount}`);
  })) passed++; else failed++;

  // ── Round 62: --global success path and bare PM name ──
  console.log('\n--global success path (Round 62):');

  if (test('--global npm writes config and succeeds', () => {
    const tmpDir = path.join(os.tmpdir(), `spm-test-global-${Date.now()}`);
    fs.mkdirSync(tmpDir, { recursive: true });
    try {
      const result = run(['--global', 'npm'], { HOME: tmpDir, USERPROFILE: tmpDir });
      assert.strictEqual(result.code, 0, `Expected exit 0, got ${result.code}. stderr: ${result.stderr}`);
      assert.ok(result.stdout.includes('Global preference set to'), 'Should show success message');
      assert.ok(result.stdout.includes('npm'), 'Should mention npm');
      // Verify config file was created
      const configPath = path.join(tmpDir, '.claude', 'package-manager.json');
      assert.ok(fs.existsSync(configPath), 'Config file should be created');
      const config = JSON.parse(fs.readFileSync(configPath, 'utf8'));
      assert.strictEqual(config.packageManager, 'npm', 'Config should contain npm');
    } finally {
      fs.rmSync(tmpDir, { recursive: true, force: true });
    }
  })) passed++; else failed++;

  console.log('\nbare PM name success (Round 62):');

  if (test('bare npm sets global preference and succeeds', () => {
    const tmpDir = path.join(os.tmpdir(), `spm-test-bare-${Date.now()}`);
    fs.mkdirSync(tmpDir, { recursive: true });
    try {
      const result = run(['npm'], { HOME: tmpDir, USERPROFILE: tmpDir });
      assert.strictEqual(result.code, 0, `Expected exit 0, got ${result.code}. stderr: ${result.stderr}`);
      assert.ok(result.stdout.includes('Global preference set to'), 'Should show success message');
      // Verify config file was created
      const configPath = path.join(tmpDir, '.claude', 'package-manager.json');
      assert.ok(fs.existsSync(configPath), 'Config file should be created');
      const config = JSON.parse(fs.readFileSync(configPath, 'utf8'));
      assert.strictEqual(config.packageManager, 'npm', 'Config should contain npm');
    } finally {
      fs.rmSync(tmpDir, { recursive: true, force: true });
    }
  })) passed++; else failed++;

  console.log('\n--detect source label (Round 62):');

  if (test('--detect with env var shows source as environment', () => {
    const result = run(['--detect'], { CLAUDE_PACKAGE_MANAGER: 'pnpm' });
    assert.strictEqual(result.code, 0);
    assert.ok(result.stdout.includes('Source: environment'), 'Should show environment as source');
  })) passed++; else failed++;

  // ── Round 68: --project success path and --list (current) marker ──
  console.log('\n--project success path (Round 68):');

  if (test('--project npm writes project config and succeeds', () => {
    const tmpDir = path.join(os.tmpdir(), `spm-test-project-${Date.now()}`);
    fs.mkdirSync(tmpDir, { recursive: true });
    try {
      const result = require('child_process').spawnSync('node', [SCRIPT, '--project', 'npm'], {
        encoding: 'utf8',
        stdio: ['pipe', 'pipe', 'pipe'],
        env: { ...process.env },
        timeout: 10000,
        cwd: tmpDir
      });
      assert.strictEqual(result.status, 0, `Expected exit 0, got ${result.status}. stderr: ${result.stderr}`);
      assert.ok(result.stdout.includes('Project preference set to'), 'Should show project success message');
      assert.ok(result.stdout.includes('npm'), 'Should mention npm');
      // Verify config file was created in the project CWD
      const configPath = path.join(tmpDir, '.claude', 'package-manager.json');
      assert.ok(fs.existsSync(configPath), 'Project config file should be created in CWD');
      const config = JSON.parse(fs.readFileSync(configPath, 'utf8'));
      assert.strictEqual(config.packageManager, 'npm', 'Config should contain npm');
    } finally {
      fs.rmSync(tmpDir, { recursive: true, force: true });
    }
  })) passed++; else failed++;

  console.log('\n--list (current) marker (Round 68):');

  if (test('--list output includes (current) marker for active PM', () => {
    const result = run(['--list']);
    assert.strictEqual(result.code, 0);
    assert.ok(result.stdout.includes('(current)'), '--list should mark the active PM with (current)');
    // The (current) marker should appear exactly once
    const currentCount = (result.stdout.match(/\(current\)/g) || []).length;
    assert.strictEqual(currentCount, 1, `Expected exactly 1 "(current)" in --list, found ${currentCount}`);
  })) passed++; else failed++;

  // ── Round 74: setGlobal catch — setPreferredPackageManager throws ──
  console.log('\nRound 74: setGlobal catch (save failure):');

  if (test('--global npm fails when HOME is not a directory', () => {
    if (process.platform === 'win32') {
      console.log('    (skipped — /dev/null not available on Windows)');
      return;
    }
    // HOME=/dev/null causes ensureDir to throw ENOTDIR when creating ~/.claude/
    const result = run(['--global', 'npm'], { HOME: '/dev/null', USERPROFILE: '/dev/null' });
    assert.strictEqual(result.code, 1, `Expected exit 1, got ${result.code}`);
    assert.ok(result.stderr.includes('Error:'),
      `stderr should contain Error:, got: ${result.stderr}`);
  })) passed++; else failed++;

  // ── Round 74: setProject catch — setProjectPackageManager throws ──
  console.log('\nRound 74: setProject catch (save failure):');

  if (test('--project npm fails when CWD is read-only', () => {
    if (process.platform === 'win32' || process.getuid?.() === 0) {
      console.log('    (skipped — chmod ineffective on Windows/root)');
      return;
    }
    const tmpDir = path.join(os.tmpdir(), `spm-test-ro-${Date.now()}`);
    fs.mkdirSync(tmpDir, { recursive: true });
    try {
      // Make CWD read-only so .claude/ dir creation fails with EACCES
      fs.chmodSync(tmpDir, 0o555);
      const result = require('child_process').spawnSync('node', [SCRIPT, '--project', 'npm'], {
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
  console.log(`\nResults: Passed: ${passed}, Failed: ${failed}`);
  process.exit(failed > 0 ? 1 : 0);
}

runTests();
