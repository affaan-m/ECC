/**
 * Tests for scripts/hooks/pre-bash-tmux-reminder.js
 *
 * The hook returns an additionalContext reminder when it sees a long-running
 * package-manager or build command outside of tmux (Linux/macOS). Regression
 * coverage guards the yarn branch of the matcher against a prior bug where a
 * stray `?` made `yarn <anything>` fire the reminder.
 *
 * Run with: node tests/hooks/pre-bash-tmux-reminder.test.js
 */

const assert = require('assert');
const path = require('path');
const { spawnSync } = require('child_process');

const script = path.join(__dirname, '..', '..', 'scripts', 'hooks', 'pre-bash-tmux-reminder.js');

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

function invokeHook(cmd, extraEnv = {}) {
  // Immutably drop TMUX from the base env; callers can re-add it via extraEnv.
  const { TMUX: _tmuxDropped, ...envWithoutTmux } = process.env;
  const env = { ...envWithoutTmux, ...extraEnv };

  const result = spawnSync('node', [script], {
    encoding: 'utf8',
    input: JSON.stringify({ tool_input: { command: cmd } }),
    timeout: 10000,
    env,
  });

  // Fail loudly on spawn errors instead of coercing status to 0, which
  // would make broken tests silently pass.
  if (result.error) {
    throw new Error(`spawnSync failed for "${cmd}": ${result.error.message}`);
  }
  if (result.signal) {
    throw new Error(`spawnSync terminated by signal ${result.signal} for "${cmd}"`);
  }
  if (result.status === null || result.status === undefined) {
    throw new Error(`spawnSync returned no exit status for "${cmd}"`);
  }

  return {
    code: result.status,
    stdout: result.stdout || '',
    stderr: result.stderr || '',
  };
}

function runRaw(rawInput) {
  const { TMUX: _tmuxDropped, ...env } = process.env;
  const result = spawnSync('node', [script], {
    encoding: 'utf8',
    input: rawInput,
    timeout: 10000,
    env,
  });
  if (result.error) throw new Error(`spawnSync failed: ${result.error.message}`);
  if (result.signal) throw new Error(`spawnSync terminated by signal ${result.signal}`);
  if (result.status === null || result.status === undefined) {
    throw new Error('spawnSync returned no exit status');
  }
  return { code: result.status, stdout: result.stdout || '', stderr: result.stderr || '' };
}

function assertReminder(cmd) {
  const result = invokeHook(cmd);
  assert.strictEqual(result.code, 0, `exit code for "${cmd}"`);
  assert.ok(
    result.stdout.includes('Consider running in tmux'),
    `expected tmux reminder for "${cmd}", got: ${JSON.stringify(result.stdout)}`
  );
}

function assertNoReminder(cmd) {
  const result = invokeHook(cmd);
  assert.strictEqual(result.code, 0, `exit code for "${cmd}"`);
  assert.ok(
    !result.stdout.includes('Consider running in tmux'),
    `did not expect tmux reminder for "${cmd}", got: ${JSON.stringify(result.stdout)}`
  );
}

function tally(counter, ok) {
  if (ok) counter.passed++;
  else counter.failed++;
}

function runYarnTests(counter) {
  console.log('Yarn matches (regression: subcommand must be required):');
  tally(counter, test('fires for yarn install', () => assertReminder('yarn install')));
  tally(counter, test('fires for yarn test', () => assertReminder('yarn test')));

  console.log('\nYarn non-matches (regression for bug where every yarn command matched):');
  tally(counter, test('does not fire for yarn add react', () => assertNoReminder('yarn add react')));
  tally(counter, test('does not fire for yarn build', () => assertNoReminder('yarn build')));
  tally(counter, test('does not fire for yarn dev', () => assertNoReminder('yarn dev')));
  tally(counter, test('does not fire for yarn --version', () => assertNoReminder('yarn --version')));
  tally(counter, test('does not fire for bare yarn', () => assertNoReminder('yarn')));
}

function runSiblingPackageManagerTests(counter) {
  console.log('\nSibling package managers still behave as before:');
  tally(counter, test('fires for npm install', () => assertReminder('npm install')));
  tally(counter, test('fires for pnpm test', () => assertReminder('pnpm test')));
  tally(counter, test('fires for bun install', () => assertReminder('bun install')));
  tally(counter, test('does not fire for npm run dev', () => assertNoReminder('npm run dev')));
}

function runOtherToolTests(counter) {
  console.log('\nOther matched tools still trigger:');
  tally(counter, test('fires for pytest tests/', () => assertReminder('pytest tests/')));
  tally(counter, test('fires for cargo build', () => assertReminder('cargo build')));
}

function runTmuxBypassTests(counter) {
  console.log('\nSkips when already inside tmux:');
  tally(counter, test('does not fire when TMUX is set even for yarn install', () => {
    const result = invokeHook('yarn install', { TMUX: '/tmp/tmux-1000/default,1,0' });
    assert.strictEqual(result.code, 0);
    assert.ok(!result.stdout.includes('Consider running in tmux'));
  }));
}

function runEdgeCaseTests(counter) {
  console.log('\nEdge cases:');
  tally(counter, test('handles invalid JSON gracefully', () => {
    const result = runRaw('not json');
    assert.strictEqual(result.code, 0);
    assert.strictEqual(result.stdout, 'not json');
  }));
  tally(counter, test('handles missing command field', () => {
    const result = runRaw(JSON.stringify({ tool_input: {} }));
    assert.strictEqual(result.code, 0);
    assert.ok(!result.stdout.includes('Consider running in tmux'));
  }));
}

function runTests() {
  console.log('\n=== Testing pre-bash-tmux-reminder.js ===\n');

  if (process.platform === 'win32') {
    console.log('  (skipping: hook is a no-op on win32)\n');
    return true;
  }

  const counter = { passed: 0, failed: 0 };
  runYarnTests(counter);
  runSiblingPackageManagerTests(counter);
  runOtherToolTests(counter);
  runTmuxBypassTests(counter);
  runEdgeCaseTests(counter);

  console.log(`\nResults: ${counter.passed} passed, ${counter.failed} failed\n`);
  return counter.failed === 0;
}

if (require.main === module) {
  const ok = runTests();
  process.exit(ok ? 0 : 1);
}

module.exports = { runTests };
