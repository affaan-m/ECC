/**
 * Tests for scripts/ci/validate-no-personal-paths.js.
 *
 * Run with: node tests/ci/no-personal-paths.test.js
 */

'use strict';

const assert = require('assert');
const fs = require('fs');
const os = require('os');
const path = require('path');
const { execFileSync } = require('child_process');

const repoRoot = path.join(__dirname, '..', '..');
const validatorPath = path.join(repoRoot, 'scripts', 'ci', 'validate-no-personal-paths.js');

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

function createTestDir() {
  return fs.mkdtempSync(path.join(os.tmpdir(), 'no-personal-paths-test-'));
}

function cleanupTestDir(testDir) {
  fs.rmSync(testDir, { recursive: true, force: true });
}

function writeFile(filePath, content) {
  fs.mkdirSync(path.dirname(filePath), { recursive: true });
  fs.writeFileSync(filePath, content);
}

function stripShebang(source) {
  let result = source;
  if (result.charCodeAt(0) === 0xFEFF) result = result.slice(1);
  if (result.startsWith('#!')) {
    const newline = result.indexOf('\n');
    result = newline === -1 ? '' : result.slice(newline + 1);
  }
  return result;
}

function runValidatorAgainst(testDir) {
  let source = fs.readFileSync(validatorPath, 'utf8');
  source = stripShebang(source);
  source = source.replace(
    /const ROOT = .*?;/,
    `const ROOT = ${JSON.stringify(testDir)};`,
  );

  const tmpFile = path.join(
    os.tmpdir(),
    `no-personal-paths-${Date.now()}-${Math.random().toString(36).slice(2)}.js`,
  );

  try {
    fs.writeFileSync(tmpFile, source, 'utf8');
    const stdout = execFileSync('node', [tmpFile], {
      encoding: 'utf8',
      stdio: ['pipe', 'pipe', 'pipe'],
      timeout: 10000,
      cwd: repoRoot,
    });
    return { code: 0, stdout, stderr: '' };
  } catch (err) {
    return {
      code: err.status || 1,
      stdout: err.stdout || '',
      stderr: err.stderr || '',
    };
  } finally {
    try { fs.unlinkSync(tmpFile); } catch (_) { /* ignore cleanup errors */ }
  }
}

function runValidatorAgainstRealRepo() {
  try {
    const stdout = execFileSync('node', [validatorPath], {
      encoding: 'utf8',
      stdio: ['pipe', 'pipe', 'pipe'],
      timeout: 10000,
      cwd: repoRoot,
    });
    return { code: 0, stdout, stderr: '' };
  } catch (err) {
    return {
      code: err.status || 1,
      stdout: err.stdout || '',
      stderr: err.stderr || '',
    };
  }
}

console.log('\n=== Testing validate-no-personal-paths.js ===\n');

let passed = 0;
let failed = 0;

function record(ok) {
  if (ok) passed += 1;
  else failed += 1;
}

record(test('passes against the real repository', () => {
  const result = runValidatorAgainstRealRepo();
  assert.strictEqual(result.code, 0, `expected exit 0; stderr: ${result.stderr}`);
  assert.ok(result.stdout.includes('Validated:'), 'expected success line in stdout');
}));

record(test('flags a leaked /Users/<name> path', () => {
  const testDir = createTestDir();
  try {
    writeFile(path.join(testDir, 'skills', 'leaky', 'SKILL.md'), 'See /Users/sugig/.claude/settings.json\n');
    const result = runValidatorAgainst(testDir);
    assert.strictEqual(result.code, 1, 'expected non-zero exit on leak');
    assert.ok(result.stderr.includes('/Users/sugig'), `expected stderr to mention leaked path; got: ${result.stderr}`);
    assert.ok(result.stderr.includes('skills/leaky/SKILL.md'), `expected normalized file path; got: ${result.stderr}`);
  } finally {
    cleanupTestDir(testDir);
  }
}));

record(test('flags a leaked C:\\Users\\<name> path case-insensitively', () => {
  const testDir = createTestDir();
  try {
    writeFile(path.join(testDir, 'docs', 'guide.md'), 'See C:\\Users\\Affaan\\projects\\thing\n');
    const result = runValidatorAgainst(testDir);
    assert.strictEqual(result.code, 1, 'expected non-zero exit on leak');
    assert.ok(result.stderr.includes('C:\\Users\\Affaan'), `expected stderr to mention leaked path; got: ${result.stderr}`);
  } finally {
    cleanupTestDir(testDir);
  }
}));

record(test('allows /Users/<placeholder> templates', () => {
  const testDir = createTestDir();
  try {
    writeFile(path.join(testDir, 'commands', 'demo.md'), [
      '/Users/you/.claude/session.json',
      '/Users/example/.claude/rules/foo.md',
      '/Users/yourname/projects/app',
      '/Users/your-username/.claude/settings.json',
      'C:\\Users\\USER\\.claude\\settings.json',
    ].join('\n'));
    const result = runValidatorAgainst(testDir);
    assert.strictEqual(result.code, 0, `expected exit 0 for placeholders; stderr: ${result.stderr}`);
  } finally {
    cleanupTestDir(testDir);
  }
}));

record(test('exempts docs/fixes forensic reports', () => {
  const testDir = createTestDir();
  try {
    writeFile(
      path.join(testDir, 'docs', 'fixes', 'HOOK-FIX-EXAMPLE.md'),
      'Reporter ran: C:\\Users\\sugig\\.claude\\settings.local.json\n',
    );
    const result = runValidatorAgainst(testDir);
    assert.strictEqual(result.code, 0, `expected exit 0 for docs/fixes; stderr: ${result.stderr}`);
  } finally {
    cleanupTestDir(testDir);
  }
}));

record(test('only scans configured file extensions', () => {
  const testDir = createTestDir();
  try {
    writeFile(path.join(testDir, 'skills', 'demo', 'image.png'), 'binary /Users/sugig/secret');
    const result = runValidatorAgainst(testDir);
    assert.strictEqual(result.code, 0, `expected non-text extensions to be skipped; stderr: ${result.stderr}`);
  } finally {
    cleanupTestDir(testDir);
  }
}));

record(test('reports every leak on a single offending file', () => {
  const testDir = createTestDir();
  try {
    writeFile(path.join(testDir, 'skills', 'multi', 'SKILL.md'), [
      '/Users/sugig/.claude/a.json',
      '/Users/sugig/.claude/b.json',
      'C:\\Users\\foo\\bar',
    ].join('\n'));
    const result = runValidatorAgainst(testDir);
    assert.strictEqual(result.code, 1, 'expected non-zero exit on leak');
    const sugigCount = (result.stderr.match(/\/Users\/sugig/g) || []).length;
    const fooCount = (result.stderr.match(/C:\\Users\\foo/g) || []).length;
    assert.strictEqual(sugigCount, 2, `expected both /Users/sugig occurrences reported; got: ${result.stderr}`);
    assert.strictEqual(fooCount, 1, `expected C:\\Users\\foo reported once; got: ${result.stderr}`);
  } finally {
    cleanupTestDir(testDir);
  }
}));

console.log(`\nPassed: ${passed}`);
console.log(`Failed: ${failed}\n`);

if (failed > 0) {
  process.exit(1);
}
