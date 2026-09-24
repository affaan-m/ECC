/**
 * Tests for .cursor/hooks/before-shell-execution-block-no-verify.js
 *
 * Issue #2107: previously .cursor/hooks.json wired `npx block-no-verify@1.1.2`,
 * which over-matches and blocks legitimate commits whose message body
 * mentions `--no-verify` or `-n`. The wrapper added in this PR delegates
 * to the local scripts/hooks/block-no-verify.js so Cursor users get the
 * same flag-position-aware matcher Claude Code already uses.
 */

'use strict';

const assert = require('assert');
const path = require('path');
const { spawnSync } = require('child_process');

const wrapper = path.join(
  __dirname, '..', '..',
  '.cursor', 'hooks', 'before-shell-execution-block-no-verify.js'
);

function runWrapper(input, env = {}) {
  const rawInput = typeof input === 'string' ? input : JSON.stringify(input);
  const result = spawnSync('node', [wrapper], {
    input: rawInput,
    encoding: 'utf8',
    env: { ...process.env, ECC_HOOK_PROFILE: 'standard', ...env },
    timeout: 15000,
    stdio: ['pipe', 'pipe', 'pipe'],
  });

  return {
    code: Number.isInteger(result.status) ? result.status : 1,
    stdout: result.stdout || '',
    stderr: result.stderr || '',
  };
}

function test(name, fn) {
  try {
    fn();
    console.log(`  ✓ ${name}`);
    return true;
  } catch (error) {
    console.log(`  ✗ ${name}`);
    console.log(`    Error: ${error.message}`);
    return false;
  }
}

let passed = 0;
let failed = 0;

console.log('\ncursor block-no-verify wrapper tests');
console.log('─'.repeat(50));

// --- Cursor input shapes ---

if (test('reads Cursor top-level command field', () => {
  const r = runWrapper({ command: 'git commit -m "hello"' });
  assert.strictEqual(r.code, 0, `expected 0, got ${r.code}: ${r.stderr}`);
})) passed++; else failed++;

if (test('reads Cursor args.command field', () => {
  const r = runWrapper({ args: { command: 'git commit -m "hello"' } });
  assert.strictEqual(r.code, 0, `expected 0, got ${r.code}: ${r.stderr}`);
})) passed++; else failed++;

// --- Issue #2107 false positives now allowed ---

if (test('#2107: allows --no-verify mentioned in double-quoted message body', () => {
  const r = runWrapper({ command: 'git commit -m "docs: explain why we never pass --no-verify"' });
  assert.strictEqual(r.code, 0, `expected 0, got ${r.code}: ${r.stderr}`);
})) passed++; else failed++;

if (test('#2107: allows --no-verify mentioned in single-quoted message body', () => {
  const r = runWrapper({ command: "git commit -m 'docs: discuss --no-verify risk'" });
  assert.strictEqual(r.code, 0, `expected 0, got ${r.code}: ${r.stderr}`);
})) passed++; else failed++;

if (test('#2107: allows -n mentioned in quoted message body', () => {
  const r = runWrapper({ command: 'git commit -m "fix: handle -n flag in parser"' });
  assert.strictEqual(r.code, 0, `expected 0, got ${r.code}: ${r.stderr}`);
})) passed++; else failed++;

if (test('#2107: allows commit message containing the literal string "block-no-verify"', () => {
  const r = runWrapper({ command: 'git commit -m "feat: add block-no-verify hook"' });
  assert.strictEqual(r.code, 0, `expected 0, got ${r.code}: ${r.stderr}`);
})) passed++; else failed++;

// --- Real bypass attempts still blocked ---

if (test('still blocks real --no-verify flag', () => {
  const r = runWrapper({ command: 'git commit --no-verify -m "msg"' });
  assert.strictEqual(r.code, 2, `expected 2, got ${r.code}`);
  assert.ok(r.stderr.includes('BLOCKED'), `stderr should contain BLOCKED: ${r.stderr}`);
})) passed++; else failed++;

if (test('still blocks -n shorthand on git commit', () => {
  const r = runWrapper({ command: 'git commit -n -m "msg"' });
  assert.strictEqual(r.code, 2, `expected 2, got ${r.code}`);
})) passed++; else failed++;

if (test('still blocks core.hooksPath override', () => {
  const r = runWrapper({ command: 'git -c core.hooksPath=/dev/null commit -m "msg"' });
  assert.strictEqual(r.code, 2, `expected 2, got ${r.code}`);
  assert.ok(r.stderr.includes('core.hooksPath'), `stderr should mention core.hooksPath: ${r.stderr}`);
})) passed++; else failed++;

if (test('still blocks --no-verify on git push', () => {
  const r = runWrapper({ command: 'git push --no-verify' });
  assert.strictEqual(r.code, 2, `expected 2, got ${r.code}`);
})) passed++; else failed++;

// --- Pass-through cases ---

if (test('allows non-git commands', () => {
  const r = runWrapper({ command: 'npm test' });
  assert.strictEqual(r.code, 0, `expected 0, got ${r.code}: ${r.stderr}`);
})) passed++; else failed++;

if (test('handles empty stdin gracefully', () => {
  const r = runWrapper('');
  assert.strictEqual(r.code, 0, `expected 0, got ${r.code}: ${r.stderr}`);
})) passed++; else failed++;

if (test('handles malformed JSON gracefully (treats raw as command string)', () => {
  const r = runWrapper('git commit -m "hello"');
  assert.strictEqual(r.code, 0, `expected 0, got ${r.code}: ${r.stderr}`);
})) passed++; else failed++;

// --- Disable via ECC_DISABLED_HOOKS ---

if (test('respects ECC_DISABLED_HOOKS=pre:bash:block-no-verify', () => {
  const r = runWrapper(
    { command: 'git commit --no-verify -m "msg"' },
    { ECC_DISABLED_HOOKS: 'pre:bash:block-no-verify' }
  );
  // When the hook is disabled, the wrapper should pass through (exit 0)
  // even on a real bypass attempt.
  assert.strictEqual(r.code, 0, `expected 0 when disabled, got ${r.code}: ${r.stderr}`);
})) passed++; else failed++;

console.log('─'.repeat(50));
console.log(`Passed: ${passed}  Failed: ${failed}`);

process.exit(failed > 0 ? 1 : 0);
