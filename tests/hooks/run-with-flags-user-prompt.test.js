/**
 * Tests for run-with-flags.js UserPromptSubmit handling.
 *
 * For every other event the wrapper's disabled/dry-run/missing-script
 * paths echo raw stdin as a pass-through. For UserPromptSubmit the harness
 * injects stdout into the model's context, so those paths must emit
 * nothing: echoing would inject the whole hook payload (prompt, cwd,
 * session id, transcript path) into the turn whenever the hook is gated
 * off.
 *
 * Run with: node tests/hooks/run-with-flags-user-prompt.test.js
 */

'use strict';

const assert = require('assert');
const path = require('path');
const { spawnSync } = require('child_process');

const repoRoot = path.resolve(__dirname, '../..');
const wrapper = path.join(repoRoot, 'scripts', 'hooks', 'run-with-flags.js');

let passed = 0;
let failed = 0;

function check(name, fn) {
  try {
    fn();
    console.log(`  ✓ ${name}`);
    passed++;
  } catch (error) {
    console.log(`  ✗ ${name}`);
    console.log(`    ${error.message}`);
    failed++;
  }
}

function runWrapper(args, stdin, extraEnv = {}) {
  return spawnSync(process.execPath, [wrapper, ...args], {
    input: stdin,
    encoding: 'utf8',
    env: { ...process.env, CLAUDE_PLUGIN_ROOT: repoRoot, ...extraEnv },
    timeout: 30000,
  });
}

const secretPayload = JSON.stringify({
  prompt: 'apply react patterns when refactoring this component',
  cwd: '/home/user/secret-project',
  session_id: 'sess-should-not-leak',
  transcript_path: '/home/user/.claude/transcript-should-not-leak.jsonl',
});

console.log('=== Testing run-with-flags.js UserPromptSubmit handling ===');

check('a disabled UserPromptSubmit hook injects nothing into context', () => {
  const result = runWrapper(
    ['user-prompt:example', 'scripts/hooks/no-such-hook.js'],
    secretPayload,
    { ECC_DISABLED_HOOKS: 'user-prompt:example' }
  );
  assert.strictEqual(result.status, 0, `stderr: ${result.stderr}`);
  assert.strictEqual(result.stdout, '', 'A disabled UserPromptSubmit hook must emit nothing');
});

check('a missing UserPromptSubmit hook script injects nothing into context', () => {
  const result = runWrapper(['user-prompt:does-not-exist', 'scripts/hooks/no-such-hook.js'], secretPayload);
  assert.strictEqual(result.status, 0);
  assert.strictEqual(result.stdout, '', 'A missing UserPromptSubmit hook must emit nothing');
  assert.ok(!result.stdout.includes('should-not-leak'));
});

check('a dry-run UserPromptSubmit hook injects nothing into context', () => {
  const result = runWrapper(['user-prompt:example', 'scripts/hooks/no-such-hook.js'], secretPayload, { ECC_DRY_RUN: '1' });
  assert.strictEqual(result.status, 0);
  assert.strictEqual(result.stdout, '', 'Dry run must not echo the payload for UserPromptSubmit');
});

check('non-UserPromptSubmit hooks keep raw pass-through when disabled', () => {
  const payload = JSON.stringify({ tool_name: 'Bash', tool_input: { command: 'ls' } });
  const result = runWrapper(
    ['pre:bash:dispatcher', 'scripts/hooks/bash-hook-dispatcher.js'],
    payload,
    { ECC_DISABLED_HOOKS: 'pre:bash:dispatcher' }
  );
  assert.strictEqual(result.status, 0, `stderr: ${result.stderr}`);
  assert.strictEqual(result.stdout, payload, 'PreToolUse pass-through must be preserved');
});

console.log(`\nPassed: ${passed}`);
console.log(`Failed: ${failed}`);
process.exit(failed > 0 ? 1 : 0);
