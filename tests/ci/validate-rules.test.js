/**
 * Tests for validate-rules.js — rules directory validation.
 *
 * Split from the original monolithic tests/ci/validators.test.js.
 * Tests both success paths (against the real project) and error paths
 * (against temporary fixture directories via wrapper scripts).
 *
 * Run with: node tests/ci/validate-rules.test.js
 */

const assert = require('assert');
const path = require('path');
const fs = require('fs');
const {
  test,
  createTestDir,
  cleanupTestDir,
  runValidatorWithDir,
  runValidator,
  finish
} = require('./validator-test-utils');

console.log('\nvalidate-rules.js:');

test('passes on real project rules', () => {
  const result = runValidator('validate-rules');
  assert.strictEqual(result.code, 0, `Should pass, got stderr: ${result.stderr}`);
  assert.ok(result.stdout.includes('Validated'), 'Should output validation count');
});

test('exits 0 when directory does not exist', () => {
  const result = runValidatorWithDir('validate-rules', 'RULES_DIR', '/nonexistent/dir');
  assert.strictEqual(result.code, 0, 'Should skip when no rules dir');
});

test('fails on empty rule file', () => {
  const testDir = createTestDir();
  fs.writeFileSync(path.join(testDir, 'empty.md'), '');

  const result = runValidatorWithDir('validate-rules', 'RULES_DIR', testDir);
  assert.strictEqual(result.code, 1, 'Should fail on empty rule file');
  assert.ok(result.stderr.includes('Empty'), 'Should report empty file');
  cleanupTestDir(testDir);
});

test('passes on valid rule files', () => {
  const testDir = createTestDir();
  fs.writeFileSync(path.join(testDir, 'coding.md'), '# Coding Rules\nUse immutability.');

  const result = runValidatorWithDir('validate-rules', 'RULES_DIR', testDir);
  assert.strictEqual(result.code, 0, 'Should pass for valid rules');
  assert.ok(result.stdout.includes('Validated 1'), 'Should report 1 validated');
  cleanupTestDir(testDir);
});

test('fails on whitespace-only rule file', () => {
  const testDir = createTestDir();
  fs.writeFileSync(path.join(testDir, 'blank.md'), '   \n\t\n  ');

  const result = runValidatorWithDir('validate-rules', 'RULES_DIR', testDir);
  assert.strictEqual(result.code, 1, 'Should reject whitespace-only rule file');
  assert.ok(result.stderr.includes('Empty'), 'Should report empty file');
  cleanupTestDir(testDir);
});

test('validates rules in subdirectories recursively', () => {
  const testDir = createTestDir();
  const subDir = path.join(testDir, 'sub');
  fs.mkdirSync(subDir);
  fs.writeFileSync(path.join(testDir, 'top.md'), '# Top Level Rule');
  fs.writeFileSync(path.join(subDir, 'nested.md'), '# Nested Rule');

  const result = runValidatorWithDir('validate-rules', 'RULES_DIR', testDir);
  assert.strictEqual(result.code, 0, 'Should validate nested rules');
  assert.ok(result.stdout.includes('Validated 2'), 'Should find both rules');
  cleanupTestDir(testDir);
});


// --- validate-hooks.js whitespace/null edge cases ---
console.log('\nvalidate-rules.js (mixed files):');

test('fails on mix of valid and empty rule files', () => {
  const testDir = createTestDir();
  fs.writeFileSync(path.join(testDir, 'good.md'), '# Good Rule\nContent here.');
  fs.writeFileSync(path.join(testDir, 'bad.md'), '');

  const result = runValidatorWithDir('validate-rules', 'RULES_DIR', testDir);
  assert.strictEqual(result.code, 1, 'Should fail when any rule is empty');
  assert.ok(result.stderr.includes('bad.md'), 'Should report the bad file');
  cleanupTestDir(testDir);
});

// ── Round 27: hook validation edge cases ──
console.log('\nRound 32: validate-rules (non-file entries):');

test('skips directory entries even if named with .md extension', () => {
  const testDir = createTestDir();
  // Create a directory named "tricky.md" — stat.isFile() should skip it
  fs.mkdirSync(path.join(testDir, 'tricky.md'));
  fs.writeFileSync(path.join(testDir, 'real.md'), '# A real rule');

  const result = runValidatorWithDir('validate-rules', 'RULES_DIR', testDir);
  assert.strictEqual(result.code, 0, 'Should skip directory entries');
  assert.ok(result.stdout.includes('Validated 1'), 'Should count only the real file');
  cleanupTestDir(testDir);
});

test('handles deeply nested rule in subdirectory', () => {
  const testDir = createTestDir();
  const deepDir = path.join(testDir, 'cat1', 'sub1');
  fs.mkdirSync(deepDir, { recursive: true });
  fs.writeFileSync(path.join(deepDir, 'deep-rule.md'), '# Deep nested rule');

  const result = runValidatorWithDir('validate-rules', 'RULES_DIR', testDir);
  assert.strictEqual(result.code, 0, 'Should validate deeply nested rules');
  assert.ok(result.stdout.includes('Validated 1'), 'Should find the nested rule');
  cleanupTestDir(testDir);
});

console.log('\nRound 52: validate-rules (code-only content):');

test('passes rule file containing only a fenced code block', () => {
  const testDir = createTestDir();
  fs.writeFileSync(path.join(testDir, 'code-only.md'), '```javascript\nfunction example() {\n  return true;\n}\n```');

  const result = runValidatorWithDir('validate-rules', 'RULES_DIR', testDir);
  assert.strictEqual(result.code, 0, 'Rule with only code block should pass (non-empty)');
  assert.ok(result.stdout.includes('Validated 1'), 'Should count the code-only file');
  cleanupTestDir(testDir);
});

// ── Round 57: readFileSync error path, statSync catch block, adjacent code blocks ──
console.log('\nRound 57: validate-rules.js (broken symlink — statSync catch block):');

test('reports error for broken symlink .md file in rules directory', () => {
  const testDir = createTestDir();
  // Create a valid rule first
  fs.writeFileSync(path.join(testDir, 'valid.md'), '# Valid Rule');
  // Create a broken symlink (dangling → target doesn't exist)
  // statSync follows symlinks and throws ENOENT, exercising catch (lines 35-38)
  try {
    fs.symlinkSync('/nonexistent/target.md', path.join(testDir, 'broken.md'));
  } catch {
    // Skip on systems that don't support symlinks
    console.log('    (skipped — symlinks not supported)');
    cleanupTestDir(testDir);
    return;
  }

  const result = runValidatorWithDir('validate-rules', 'RULES_DIR', testDir);
  assert.strictEqual(result.code, 1, 'Should fail on broken symlink');
  assert.ok(result.stderr.includes('broken.md'), 'Should report the broken symlink file');
  cleanupTestDir(testDir);
});

console.log('\nRound 65: validate-rules.js (empty directory — no .md files):');

test('passes on rules directory with no .md files (Validated 0)', () => {
  const testDir = createTestDir();
  // Only non-.md files — readdirSync filter yields empty array
  fs.writeFileSync(path.join(testDir, 'notes.txt'), 'not a rule');
  fs.writeFileSync(path.join(testDir, 'config.json'), '{}');

  const result = runValidatorWithDir('validate-rules', 'RULES_DIR', testDir);
  assert.strictEqual(result.code, 0, 'Should pass on empty rules directory');
  assert.ok(result.stdout.includes('Validated 0'), 'Should report 0 validated rule files');
  cleanupTestDir(testDir);
});

finish();
