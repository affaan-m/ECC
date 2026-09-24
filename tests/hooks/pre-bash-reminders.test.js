/**
 * Tests for pre-bash-git-push-reminder.js and pre-bash-tmux-reminder.js hooks
 *
 * Run with: node tests/hooks/pre-bash-reminders.test.js
 */

const assert = require('assert');
const path = require('path');
const { spawnSync } = require('child_process');

const gitPushScript = path.join(__dirname, '..', '..', 'scripts', 'hooks', 'pre-bash-git-push-reminder.js');
const tmuxScript = path.join(__dirname, '..', '..', 'scripts', 'hooks', 'pre-bash-tmux-reminder.js');

function test(name, fn) {
  try {
    fn();
    console.log(`  ✓ ${name}`);
    return true;
  } catch (err) {
    console.log(`  ✗ ${name}`);
    console.log(`    Error: ${err.message}`);
    return false;
  }
}

function runScript(scriptPath, command, envOverrides = {}) {
  const input = { tool_input: { command } };
  const inputStr = JSON.stringify(input);
  const result = spawnSync('node', [scriptPath], {
    encoding: 'utf8',
    input: inputStr,
    timeout: 10000,
    env: { ...process.env, ...envOverrides },
  });
  return { code: result.status || 0, stdout: result.stdout || '', stderr: result.stderr || '', inputStr };
}

function parseHookOutput(stdout) {
  return JSON.parse(stdout);
}

function runTests() {
  console.log('\n=== Testing pre-bash-git-push-reminder.js & pre-bash-tmux-reminder.js ===\n');

  let passed = 0;
  let failed = 0;

  // --- git-push-reminder tests ---

  console.log('  git-push-reminder:');

  (test('git push triggers visible additionalContext warning', () => {
    const result = runScript(gitPushScript, 'git push origin main');
    assert.strictEqual(result.code, 0, `Expected exit code 0, got ${result.code}`);
    assert.strictEqual(result.stderr, '', `Expected no stderr, got: ${result.stderr}`);
    const additionalContext = parseHookOutput(result.stdout).hookSpecificOutput.additionalContext;
    assert.ok(additionalContext.includes('[Hook]'), `Expected additionalContext to contain [Hook], got: ${result.stdout}`);
    assert.ok(additionalContext.includes('Review changes before push'), `Expected additionalContext to mention review`);
  }) ? passed++ : failed++);

  (test('git status has no warning', () => {
    const result = runScript(gitPushScript, 'git status');
    assert.strictEqual(result.code, 0, `Expected exit code 0, got ${result.code}`);
    assert.strictEqual(result.stderr, '', `Expected no stderr, got: ${result.stderr}`);
  }) ? passed++ : failed++);

  (test('git push emits PreToolUse additionalContext JSON on stdout', () => {
    const result = runScript(gitPushScript, 'git push');
    const output = parseHookOutput(result.stdout);
    assert.strictEqual(output.hookSpecificOutput.hookEventName, 'PreToolUse');
    assert.ok(output.hookSpecificOutput.additionalContext.includes('Review changes before push'));
  }) ? passed++ : failed++);

  // --- tmux-reminder tests (non-Windows only) ---

  const isWindows = process.platform === 'win32';

  if (!isWindows) {
    console.log('\n  tmux-reminder:');

    (test('npm install triggers visible tmux suggestion', () => {
      const result = runScript(tmuxScript, 'npm install', { TMUX: '' });
      assert.strictEqual(result.code, 0, `Expected exit code 0, got ${result.code}`);
      assert.strictEqual(result.stderr, '', `Expected no stderr, got: ${result.stderr}`);
      const additionalContext = parseHookOutput(result.stdout).hookSpecificOutput.additionalContext;
      assert.ok(additionalContext.includes('[Hook]'), `Expected additionalContext to contain [Hook], got: ${result.stdout}`);
      assert.ok(additionalContext.includes('tmux'), `Expected additionalContext to mention tmux`);
    }) ? passed++ : failed++);

    (test('npm test triggers tmux suggestion', () => {
      const result = runScript(tmuxScript, 'npm test', { TMUX: '' });
      assert.strictEqual(result.code, 0, `Expected exit code 0, got ${result.code}`);
      assert.strictEqual(result.stderr, '', `Expected no stderr, got: ${result.stderr}`);
      assert.ok(parseHookOutput(result.stdout).hookSpecificOutput.additionalContext.includes('tmux'), `Expected additionalContext to mention tmux`);
    }) ? passed++ : failed++);

    (test('regular command like ls has no tmux suggestion', () => {
      const result = runScript(tmuxScript, 'ls -la', { TMUX: '' });
      assert.strictEqual(result.code, 0, `Expected exit code 0, got ${result.code}`);
      assert.strictEqual(result.stderr, '', `Expected no stderr for ls, got: ${result.stderr}`);
    }) ? passed++ : failed++);

    (test('tmux reminder emits PreToolUse additionalContext JSON on stdout', () => {
      const result = runScript(tmuxScript, 'npm install', { TMUX: '' });
      const output = parseHookOutput(result.stdout);
      assert.strictEqual(output.hookSpecificOutput.hookEventName, 'PreToolUse');
      assert.ok(output.hookSpecificOutput.additionalContext.includes('tmux'));
    }) ? passed++ : failed++);
  } else {
    console.log('\n  (skipping tmux-reminder tests on Windows)\n');
  }

  console.log(`\nResults: Passed: ${passed}, Failed: ${failed}`);
  process.exit(failed > 0 ? 1 : 0);
}

runTests();
