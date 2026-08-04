/**
 * Tests for scripts/hooks/block-no-verify.js via run-with-flags.js
 */

const assert = require('assert');
const path = require('path');
const { spawnSync } = require('child_process');

const runner = path.join(__dirname, '..', '..', 'scripts', 'hooks', 'run-with-flags.js');

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

function runHook(input, env = {}) {
  const rawInput = typeof input === 'string' ? input : JSON.stringify(input);
  const result = spawnSync('node', [runner, 'pre:bash:block-no-verify', 'scripts/hooks/block-no-verify.js', 'minimal,standard,strict'], {
    input: rawInput,
    encoding: 'utf8',
    env: {
      ...process.env,
      ECC_HOOK_PROFILE: 'standard',
      ...env
    },
    timeout: 15000,
    stdio: ['pipe', 'pipe', 'pipe']
  });

  return {
    code: Number.isInteger(result.status) ? result.status : 1,
    stdout: result.stdout || '',
    stderr: result.stderr || ''
  };
}

let passed = 0;
let failed = 0;

console.log('\nblock-no-verify hook tests');
console.log('─'.repeat(50));

// --- Basic allow/block ---

if (test('allows plain git commit', () => {
  const r = runHook({ tool_input: { command: 'git commit -m "hello"' } });
  assert.strictEqual(r.code, 0, `expected exit 0, got ${r.code}: ${r.stderr}`);
})) passed++; else failed++;

if (test('blocks --no-verify on git commit', () => {
  const r = runHook({ tool_input: { command: 'git commit --no-verify -m "msg"' } });
  assert.strictEqual(r.code, 2, `expected exit 2, got ${r.code}`);
  assert.ok(r.stderr.includes('BLOCKED'), `stderr should contain BLOCKED: ${r.stderr}`);
})) passed++; else failed++;

if (test('blocks -n shorthand on git commit', () => {
  const r = runHook({ tool_input: { command: 'git commit -n -m "msg"' } });
  assert.strictEqual(r.code, 2, `expected exit 2, got ${r.code}`);
  assert.ok(r.stderr.includes('BLOCKED'), `stderr should contain BLOCKED: ${r.stderr}`);
})) passed++; else failed++;

if (test('blocks core.hooksPath override', () => {
  const r = runHook({ tool_input: { command: 'git -c core.hooksPath=/dev/null commit -m "msg"' } });
  assert.strictEqual(r.code, 2, `expected exit 2, got ${r.code}`);
  assert.ok(r.stderr.includes('core.hooksPath'), `stderr should mention core.hooksPath: ${r.stderr}`);
})) passed++; else failed++;

if (test('blocks quoted core.hooksPath override argument', () => {
  const r = runHook({ tool_input: { command: 'git -c "core.hooksPath=/dev/null" commit -m "msg"' } });
  assert.strictEqual(r.code, 2, `expected exit 2, got ${r.code}`);
  assert.ok(r.stderr.includes('core.hooksPath'), `stderr should mention core.hooksPath: ${r.stderr}`);
})) passed++; else failed++;

// --- Chained command false positive prevention (Comment 2) ---

if (test('does not false-positive on -n belonging to git log in a chain', () => {
  const r = runHook({ tool_input: { command: 'git log -n 10 && git commit -m "msg"' } });
  assert.strictEqual(r.code, 0, `expected exit 0, got ${r.code}: ${r.stderr}`);
})) passed++; else failed++;

if (test('does not false-positive on --no-verify in a prior non-git command', () => {
  const r = runHook({ tool_input: { command: 'echo --no-verify && git commit -m "msg"' } });
  assert.strictEqual(r.code, 0, `expected exit 0, got ${r.code}: ${r.stderr}`);
})) passed++; else failed++;

if (test('allows --no-verify discussed in a double-quoted commit message', () => {
  const r = runHook({ tool_input: { command: 'git commit -m "fix: --no-verify edge case"' } });
  assert.strictEqual(r.code, 0, `expected exit 0, got ${r.code}: ${r.stderr}`);
})) passed++; else failed++;

if (test('allows --no-verify discussed in a single-quoted commit message', () => {
  const r = runHook({ tool_input: { command: "git commit -m 'fix: --no-verify edge case'" } });
  assert.strictEqual(r.code, 0, `expected exit 0, got ${r.code}: ${r.stderr}`);
})) passed++; else failed++;

if (test('allows -n discussed in a quoted commit message', () => {
  const r = runHook({ tool_input: { command: 'git commit -m "Fixed -n bug in module"' } });
  assert.strictEqual(r.code, 0, `expected exit 0, got ${r.code}: ${r.stderr}`);
})) passed++; else failed++;

if (test('allows --no-verify after combined -am message option', () => {
  const r = runHook({ tool_input: { command: 'git commit -am "--no-verify"' } });
  assert.strictEqual(r.code, 0, `expected exit 0, got ${r.code}: ${r.stderr}`);
})) passed++; else failed++;

if (test('allows -n after combined -am message option', () => {
  const r = runHook({ tool_input: { command: 'git commit -am "-n"' } });
  assert.strictEqual(r.code, 0, `expected exit 0, got ${r.code}: ${r.stderr}`);
})) passed++; else failed++;

if (test('allows core.hooksPath discussed in a quoted commit message', () => {
  const r = runHook({ tool_input: { command: 'git commit -m "doc: explain core.hooksPath= setting"' } });
  assert.strictEqual(r.code, 0, `expected exit 0, got ${r.code}: ${r.stderr}`);
})) passed++; else failed++;

if (test('allows git bypass phrase discussed in a quoted commit message', () => {
  const r = runHook({ tool_input: { command: 'git commit -m "doc: explain git push --no-verify risk"' } });
  assert.strictEqual(r.code, 0, `expected exit 0, got ${r.code}: ${r.stderr}`);
})) passed++; else failed++;

if (test('still blocks --no-verify on the git commit part of a chain', () => {
  const r = runHook({ tool_input: { command: 'git log -n 5 && git commit --no-verify -m "msg"' } });
  assert.strictEqual(r.code, 2, `expected exit 2, got ${r.code}`);
})) passed++; else failed++;

if (test('still blocks a real quoted --no-verify flag', () => {
  const r = runHook({ tool_input: { command: 'git commit "--no-verify" -m "msg"' } });
  assert.strictEqual(r.code, 2, `expected exit 2, got ${r.code}`);
  assert.ok(r.stderr.includes('BLOCKED'), `stderr should contain BLOCKED: ${r.stderr}`);
})) passed++; else failed++;

if (test('still blocks bypass flags in later chained git commands', () => {
  const r = runHook({ tool_input: { command: 'git commit -m "msg" && git push --no-verify' } });
  assert.strictEqual(r.code, 2, `expected exit 2, got ${r.code}`);
  assert.ok(r.stderr.includes('git push'), `stderr should mention git push: ${r.stderr}`);
})) passed++; else failed++;

// --- Subcommand detection (Comment 4) ---

if (test('does not misclassify "commit" as subcommand when it is an argument to push', () => {
  // "git push origin commit" — "commit" is a refspec arg, not the subcommand
  const r = runHook({ tool_input: { command: 'git push origin commit' } });
  // This should detect "push" as the subcommand, not "commit"
  // Either way it should not block since there's no --no-verify
  assert.strictEqual(r.code, 0, `expected exit 0, got ${r.code}: ${r.stderr}`);
})) passed++; else failed++;

// --- Blocks on push --no-verify ---

if (test('blocks --no-verify on git push', () => {
  const r = runHook({ tool_input: { command: 'git push --no-verify' } });
  assert.strictEqual(r.code, 2, `expected exit 2, got ${r.code}`);
  assert.ok(r.stderr.includes('git push'), `stderr should mention git push: ${r.stderr}`);
})) passed++; else failed++;

// --- Non-git commands pass through ---

if (test('allows non-git commands', () => {
  const r = runHook({ tool_input: { command: 'npm test' } });
  assert.strictEqual(r.code, 0, `expected exit 0, got ${r.code}: ${r.stderr}`);
})) passed++; else failed++;

// --- Plain text input (not JSON) ---

if (test('handles plain text input', () => {
  const r = runHook('git commit -m "hello"');
  assert.strictEqual(r.code, 0, `expected exit 0, got ${r.code}: ${r.stderr}`);
})) passed++; else failed++;

if (test('blocks plain text input with --no-verify', () => {
  const r = runHook('git commit --no-verify -m "msg"');
  assert.strictEqual(r.code, 2, `expected exit 2, got ${r.code}`);
})) passed++; else failed++;

// --- Case-insensitivity of git config keys + -t template short option ---

if (test('blocks case-variant core.hooksPath (lowercase)', () => {
  const r = runHook({ tool_input: { command: 'git -c core.hookspath=/dev/null commit -m "msg"' } });
  assert.strictEqual(r.code, 2, `expected exit 2, got ${r.code}`);
  assert.ok(/core\.hookspath/i.test(r.stderr), `stderr should mention core.hooksPath: ${r.stderr}`);
})) passed++; else failed++;

if (test('blocks case-variant core.hooksPath (uppercase)', () => {
  const r = runHook({ tool_input: { command: 'git -c core.HOOKSPATH=/dev/null commit -m "msg"' } });
  assert.strictEqual(r.code, 2, `expected exit 2, got ${r.code}`);
})) passed++; else failed++;

if (test('still allows -tn (n is the -t template path, not a flag)', () => {
  const r = runHook({ tool_input: { command: 'git commit -tn -m "msg"' } });
  assert.strictEqual(r.code, 0, `expected exit 0, got ${r.code}: ${r.stderr}`);
})) passed++; else failed++;

console.log('─'.repeat(50));
console.log(`Passed: ${passed}  Failed: ${failed}`);

process.exit(failed > 0 ? 1 : 0);
