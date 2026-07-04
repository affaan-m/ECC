/**
 * Tests for scripts/ci/check-spec-freshness.js
 *
 * Run with: node tests/ci/check-spec-freshness.test.js
 */

'use strict';

const assert = require('assert');
const fs = require('fs');
const os = require('os');
const path = require('path');
const { execSync } = require('child_process');

const { collectSpecs, parseSpec, git: gitHelper } = require('../../scripts/ci/check-spec-freshness');

let passed = 0;
let failed = 0;

function test(name, fn) {
  try {
    fn();
    passed++;
    console.log(`  ✓ ${name}`);
  } catch (err) {
    failed++;
    console.log(`  ✗ ${name}`);
    console.log(`    Error: ${err.message}`);
  }
}

function createTestDir() {
  return fs.mkdtempSync(path.join(os.tmpdir(), 'ecc-spec-freshness-'));
}

function cleanupTestDir(testDir) {
  fs.rmSync(testDir, { recursive: true, force: true });
}

function git(args, cwd) {
  return execSync(`git ${args}`, { cwd, encoding: 'utf-8', stdio: ['ignore', 'pipe', 'pipe'] }).trim();
}

function initGitRepo(dir) {
  git('init', dir);
  git('config user.email "test@ecc.test"', dir);
  git('config user.name "ECC Test"', dir);
}

// ================================================================
// collectSpecs
// ================================================================
console.log('\n--- collectSpecs ---');

test('returns empty array when directory does not exist', () => {
  const result = collectSpecs('/tmp/non-existent-dir-ecc-spec-test-12345');
  assert.deepStrictEqual(result, []);
});

test('finds spec.md files recursively', () => {
  const dir = createTestDir();
  try {
    const specDir = path.join(dir, 'openspec', 'specs');
    fs.mkdirSync(path.join(specDir, 'auth'), { recursive: true });
    fs.mkdirSync(path.join(specDir, 'database'), { recursive: true });
    fs.writeFileSync(path.join(specDir, 'auth', 'spec.md'), '# Auth Spec');
    fs.writeFileSync(path.join(specDir, 'database', 'spec.md'), '# DB Spec');

    const result = collectSpecs(specDir);
    assert.strictEqual(result.length, 2);
    assert.ok(result.every(f => f.endsWith('spec.md')));
  } finally {
    cleanupTestDir(dir);
  }
});

test('ignores non-spec.md files', () => {
  const dir = createTestDir();
  try {
    const specDir = path.join(dir, 'openspec', 'specs', 'misc');
    fs.mkdirSync(specDir, { recursive: true });
    fs.writeFileSync(path.join(specDir, 'spec.md'), '# Spec');
    fs.writeFileSync(path.join(specDir, 'README.md'), '# Readme');
    fs.writeFileSync(path.join(specDir, 'notes.txt'), 'notes');

    const result = collectSpecs(specDir);
    assert.strictEqual(result.length, 1);
    assert.ok(result[0].endsWith('spec.md'));
  } finally {
    cleanupTestDir(dir);
  }
});

test('handles empty directory', () => {
  const dir = createTestDir();
  try {
    const specDir = path.join(dir, 'openspec', 'specs');
    fs.mkdirSync(specDir, { recursive: true });
    const result = collectSpecs(specDir);
    assert.deepStrictEqual(result, []);
  } finally {
    cleanupTestDir(dir);
  }
});

test('finds specs nested multiple levels deep', () => {
  const dir = createTestDir();
  try {
    const specDir = path.join(dir, 'openspec', 'specs', 'deep', 'nested', 'path');
    fs.mkdirSync(specDir, { recursive: true });
    fs.writeFileSync(path.join(specDir, 'spec.md'), '# Deep Spec');
    const result = collectSpecs(path.join(dir, 'openspec', 'specs'));
    assert.strictEqual(result.length, 1);
  } finally {
    cleanupTestDir(dir);
  }
});

// ================================================================
// git helper
// ================================================================
console.log('\n--- git helper ---');

test('git rev-parse HEAD returns a commit hash', () => {
  const dir = createTestDir();
  try {
    initGitRepo(dir);
    fs.writeFileSync(path.join(dir, 'test.txt'), 'hello');
    git('add -A', dir);
    git('commit -m "test"', dir);

    const result = gitHelper('rev-parse HEAD', { cwd: dir });
    assert.ok(result);
    assert.strictEqual(result.length, 40);
  } finally {
    cleanupTestDir(dir);
  }
});

test('git with invalid command returns null', () => {
  const dir = createTestDir();
  try {
    initGitRepo(dir);
    const result = gitHelper('invalid-command-xyz', { cwd: dir });
    assert.strictEqual(result, null);
  } finally {
    cleanupTestDir(dir);
  }
});

test('git without opts uses repo root', () => {
  // This runs against the real repo (ROOT constant in the script)
  const result = gitHelper('rev-parse HEAD');
  assert.ok(result);
  assert.ok(result.length > 0);
});

// ================================================================
// parseSpec
// ================================================================
console.log('\n--- parseSpec ---');

test('parses Last verified date and commit', () => {
  const dir = createTestDir();
  try {
    const specPath = path.join(dir, 'spec.md');
    const content = [
      '# Test Capability',
      '',
      '> Last verified: 2025-12-15 (commit abc123def456)',
      '',
      '### Requirement: Login',
      '<!-- enforced: LoginService.authenticate() -->',
      '#### Scenario: Success',
    ].join('\n');
    fs.writeFileSync(specPath, content);

    const result = parseSpec(specPath);
    assert.strictEqual(result.lastVerifiedDate, '2025-12-15');
    assert.strictEqual(result.lastVerifiedCommit, 'abc123def456');
    assert.strictEqual(result.capability, path.basename(dir));
  } finally {
    cleanupTestDir(dir);
  }
});

test('extracts enforced locations', () => {
  const dir = createTestDir();
  try {
    const specPath = path.join(dir, 'spec.md');
    const content = [
      '# Test',
      '### Requirement: Auth',
      '<!-- enforced: AuthService.authenticate() -->',
      '#### Scenario: Login',
      '### Requirement: Data',
      '<!-- enforced: DataService.validate -->',
      '#### Scenario: Validate',
    ].join('\n');
    fs.writeFileSync(specPath, content);

    const result = parseSpec(specPath);
    assert.ok(result.enforced.includes('AuthService.authenticate'));
    assert.ok(result.enforced.includes('DataService.validate'));
    assert.strictEqual(result.enforced.length, 2);
  } finally {
    cleanupTestDir(dir);
  }
});

test('extracts requirement and invariant block names', () => {
  const dir = createTestDir();
  try {
    const specPath = path.join(dir, 'spec.md');
    const content = [
      '# Test',
      '### Requirement: User Login',
      '<!-- enforced: Login.check -->',
      '#### Scenario: Success',
      '### Invariant: Session Integrity',
      '<!-- enforced: Session.check -->',
      '### Requirement: Logout',
      '<!-- enforced: Logout.check -->',
      '#### Scenario: Clean',
    ].join('\n');
    fs.writeFileSync(specPath, content);

    const result = parseSpec(specPath);
    assert.strictEqual(result.blocks.length, 3);
    assert.deepStrictEqual(result.blocks[0], { type: 'Requirement', name: 'User Login' });
    assert.deepStrictEqual(result.blocks[1], { type: 'Invariant', name: 'Session Integrity' });
    assert.deepStrictEqual(result.blocks[2], { type: 'Requirement', name: 'Logout' });
  } finally {
    cleanupTestDir(dir);
  }
});

test('handles spec without Last verified', () => {
  const dir = createTestDir();
  try {
    const specPath = path.join(dir, 'spec.md');
    fs.writeFileSync(specPath, [
      '### Requirement: No Verification',
      '<!-- enforced: Test.check -->',
      '#### Scenario: Works',
    ].join('\n'));

    const result = parseSpec(specPath);
    assert.strictEqual(result.lastVerifiedDate, null);
    assert.strictEqual(result.lastVerifiedCommit, null);
    assert.strictEqual(result.blocks.length, 1);
  } finally {
    cleanupTestDir(dir);
  }
});

test('handles spec with no enforced metadata', () => {
  const dir = createTestDir();
  try {
    const specPath = path.join(dir, 'spec.md');
    fs.writeFileSync(specPath, [
      '### Requirement: No Enforced',
      '#### Scenario: Works',
    ].join('\n'));

    const result = parseSpec(specPath);
    assert.deepStrictEqual(result.enforced, []);
  } finally {
    cleanupTestDir(dir);
  }
});

test('handles non-existent file', () => {
  const result = parseSpec('/tmp/non-existent-spec-md-12345.md');
  assert.strictEqual(result, null);
});

test('returns relative path from repo root', () => {
  const dir = createTestDir();
  try {
    const specPath = path.join(dir, 'spec.md');
    fs.writeFileSync(specPath, '### Requirement: Test\n<!-- enforced: Test.check -->\n#### Scenario: One\n');
    const result = parseSpec(specPath);
    assert.ok(result.relativePath.includes('spec.md'));
  } finally {
    cleanupTestDir(dir);
  }
});

test('parses Last verified with mixed case', () => {
  const dir = createTestDir();
  try {
    const specPath = path.join(dir, 'spec.md');
    fs.writeFileSync(specPath, '> Last Verified: 2025-11-01 (commit DEADBEEF)\n');
    const result = parseSpec(specPath);
    assert.strictEqual(result.lastVerifiedDate, '2025-11-01');
    assert.strictEqual(result.lastVerifiedCommit, 'DEADBEEF');
  } finally {
    cleanupTestDir(dir);
  }
});

// ================================================================
// main() integration tests (with git)
// ================================================================
console.log('\n--- main() with git repos ---');

function runFreshnessViaTempFile(source, envVars = {}) {
  const repoRoot = path.join(__dirname, '..', '..');
  const tmpFile = path.join(repoRoot, `.tmp-freshness-${Date.now()}-${Math.random().toString(36).slice(2)}.js`);
  try {
    fs.writeFileSync(tmpFile, source, 'utf8');
    const result = require('child_process').execFileSync('node', [tmpFile], {
      encoding: 'utf8',
      stdio: ['pipe', 'pipe', 'pipe'],
      timeout: 10000,
      env: { ...process.env, ...envVars },
    });
    return { code: 0, stdout: result, stderr: '' };
  } catch (err) {
    return {
      code: err.status || 1,
      stdout: err.stdout || '',
      stderr: err.stderr || '',
    };
  } finally {
    try { fs.unlinkSync(tmpFile); } catch (_) { /* ignore */ }
  }
}

function stripShebang(source) {
  let s = source;
  if (s.charCodeAt(0) === 0xFEFF) s = s.slice(1);
  if (s.startsWith('#!')) {
    const nl = s.indexOf('\n');
    s = nl === -1 ? '' : s.slice(nl + 1);
  }
  return s;
}

test('exits 0 when no specs found', () => {
  const dir = createTestDir();
  try {
    const specDir = path.join(dir, 'openspec', 'specs');
    fs.mkdirSync(specDir, { recursive: true });

    const validatorPath = path.join(__dirname, '..', '..', 'scripts', 'ci', 'check-spec-freshness.js');
    let source = fs.readFileSync(validatorPath, 'utf8');
    source = stripShebang(source);
    source = source.replace(/const ROOT = .*?;/, `const ROOT = ${JSON.stringify(dir)};`);

    const { code, stdout } = runFreshnessViaTempFile(source);
    assert.strictEqual(code, 0);
    assert.ok(stdout.includes('No specs found'));
  } finally {
    cleanupTestDir(dir);
  }
});

test('exits 1 for unverified spec', () => {
  const dir = createTestDir();
  try {
    const specDir = path.join(dir, 'openspec', 'specs', 'unverified-cap');
    fs.mkdirSync(specDir, { recursive: true });
    fs.writeFileSync(path.join(specDir, 'spec.md'), [
      '### Requirement: Unverified',
      '<!-- enforced: Test.check -->',
      '#### Scenario: Works',
    ].join('\n'));

    initGitRepo(dir);
    fs.writeFileSync(path.join(dir, 'dummy.txt'), 'initial');
    git('add -A', dir);
    git('commit -m "initial"', dir);

    const validatorPath = path.join(__dirname, '..', '..', 'scripts', 'ci', 'check-spec-freshness.js');
    let source = fs.readFileSync(validatorPath, 'utf8');
    source = stripShebang(source);
    source = source.replace(/const ROOT = .*?;/, `const ROOT = ${JSON.stringify(dir)};`);

    const { code, stdout } = runFreshnessViaTempFile(source);
    assert.strictEqual(code, 1);
    assert.ok(stdout.includes('UNVERIFIED'));
  } finally {
    cleanupTestDir(dir);
  }
});

test('exits 0 for unverified spec when WARN_ONLY is true', () => {
  const dir = createTestDir();
  try {
    const specDir = path.join(dir, 'openspec', 'specs', 'unverified-cap');
    fs.mkdirSync(specDir, { recursive: true });
    fs.writeFileSync(path.join(specDir, 'spec.md'), [
      '### Requirement: Unverified',
      '<!-- enforced: Test.check -->',
      '#### Scenario: Works',
    ].join('\n'));

    initGitRepo(dir);
    fs.writeFileSync(path.join(dir, 'dummy.txt'), 'initial');
    git('add -A', dir);
    git('commit -m "initial"', dir);

    const validatorPath = path.join(__dirname, '..', '..', 'scripts', 'ci', 'check-spec-freshness.js');
    let source = fs.readFileSync(validatorPath, 'utf8');
    source = stripShebang(source);
    source = source.replace(/const ROOT = .*?;/, `const ROOT = ${JSON.stringify(dir)};`);

    const { code, stdout } = runFreshnessViaTempFile(source, { ECC_SPEC_STALE_WARN_ONLY: 'true' });
    assert.strictEqual(code, 0);
    assert.ok(stdout.includes('WARN ONLY'));
  } finally {
    cleanupTestDir(dir);
  }
});

test('exits 2 for orphaned spec (commit missing)', () => {
  const dir = createTestDir();
  try {
    const specDir = path.join(dir, 'openspec', 'specs', 'orphaned-cap');
    fs.mkdirSync(specDir, { recursive: true });
    fs.writeFileSync(path.join(specDir, 'spec.md'), [
      '> Last verified: 2025-06-01 (commit deadbeef00000000000000000000000000000000)',
      '### Requirement: Orphaned',
      '<!-- enforced: Test.check -->',
      '#### Scenario: Works',
    ].join('\n'));

    initGitRepo(dir);
    fs.writeFileSync(path.join(dir, 'dummy.txt'), 'initial');
    git('add -A', dir);
    git('commit -m "initial"', dir);

    const validatorPath = path.join(__dirname, '..', '..', 'scripts', 'ci', 'check-spec-freshness.js');
    let source = fs.readFileSync(validatorPath, 'utf8');
    source = stripShebang(source);
    source = source.replace(/const ROOT = .*?;/, `const ROOT = ${JSON.stringify(dir)};`);

    const { code, stdout } = runFreshnessViaTempFile(source);
    assert.strictEqual(code, 2);
    assert.ok(stdout.includes('ORPHANED'));
  } finally {
    cleanupTestDir(dir);
  }
});

test('exits 0 for fresh spec with recent verification', () => {
  const dir = createTestDir();
  try {
    const specDir = path.join(dir, 'openspec', 'specs', 'fresh-cap');
    fs.mkdirSync(specDir, { recursive: true });
    fs.writeFileSync(path.join(specDir, 'spec.md'), '');

    initGitRepo(dir);
    fs.writeFileSync(path.join(dir, 'dummy.txt'), 'initial');
    git('add -A', dir);
    git('commit -m "initial"', dir);

    const headCommit = git('rev-parse HEAD', dir);
    const today = new Date().toISOString().split('T')[0];

    fs.writeFileSync(path.join(specDir, 'spec.md'), [
      `> Last verified: ${today} (commit ${headCommit})`,
      '### Requirement: Fresh',
      '<!-- enforced: Test.check -->',
      '#### Scenario: Works',
    ].join('\n'));

    const validatorPath = path.join(__dirname, '..', '..', 'scripts', 'ci', 'check-spec-freshness.js');
    let source = fs.readFileSync(validatorPath, 'utf8');
    source = stripShebang(source);
    source = source.replace(/const ROOT = .*?;/, `const ROOT = ${JSON.stringify(dir)};`);

    const { code, stdout } = runFreshnessViaTempFile(source);
    assert.strictEqual(code, 0);
    assert.ok(stdout.includes('FRESH'));
  } finally {
    cleanupTestDir(dir);
  }
});

test('respects ECC_SPEC_STALE_DAYS env var', () => {
  // With STALE_DAYS=0, any spec older than 0 days becomes stale (including today's)
  const dir = createTestDir();
  try {
    const specDir = path.join(dir, 'openspec', 'specs', 'stale-cap');
    fs.mkdirSync(specDir, { recursive: true });

    initGitRepo(dir);
    fs.writeFileSync(path.join(dir, 'dummy.txt'), 'initial');
    git('add -A', dir);
    git('commit -m "initial"', dir);

    const headCommit = git('rev-parse HEAD', dir);
    const yesterday = new Date(Date.now() - 86400000).toISOString().split('T')[0];

    fs.writeFileSync(path.join(specDir, 'spec.md'), [
      `> Last verified: ${yesterday} (commit ${headCommit})`,
      '### Requirement: Stale',
      '<!-- enforced: Test.check -->',
      '#### Scenario: Works',
    ].join('\n'));

    const validatorPath = path.join(__dirname, '..', '..', 'scripts', 'ci', 'check-spec-freshness.js');
    let source = fs.readFileSync(validatorPath, 'utf8');
    source = stripShebang(source);
    source = source.replace(/const ROOT = .*?;/, `const ROOT = ${JSON.stringify(dir)};`);

    const { code, stdout } = runFreshnessViaTempFile(source, { ECC_SPEC_STALE_DAYS: '0' });
    assert.strictEqual(code, 1);
    assert.ok(stdout.includes('STALE'));
  } finally {
    cleanupTestDir(dir);
  }
});

// ================================================================
// Direct script invocation (for c8 coverage of main())
// ================================================================
console.log('\n--- direct script invocation ---');

test('script exits 0 against real repo (no specs)', () => {
  const { execFileSync } = require('child_process');
  const scriptPath = path.join(__dirname, '..', '..', 'scripts', 'ci', 'check-spec-freshness.js');
  try {
    const stdout = execFileSync('node', [scriptPath], {
      encoding: 'utf8',
      stdio: ['pipe', 'pipe', 'pipe'],
      timeout: 10000,
      env: { ...process.env, ECC_SPEC_STALE_WARN_ONLY: 'true' },
    });
    assert.ok(stdout.includes('No specs found'));
  } catch (err) {
    if (err.status !== 0) {
      throw new Error(`Script exited with ${err.status}: ${err.stderr}`);
    }
    const output = err.stdout || '';
    assert.ok(output.includes('No specs found'));
  }
});

// ================================================================
// Results
// ================================================================
console.log(`\nPassed: ${passed}`);
console.log(`Failed: ${failed}`);
process.exit(failed > 0 ? 1 : 0);
