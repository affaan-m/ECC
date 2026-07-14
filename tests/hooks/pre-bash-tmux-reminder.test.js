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

function runScript(input) {
  const env = { ...process.env };
  delete env.TMUX;
  const result = spawnSync('node', [script], {
    encoding: 'utf8',
    input: typeof input === 'string' ? input : JSON.stringify(input),
    timeout: 10000,
    env,
  });
  return {
    code: result.status || 0,
    stdout: result.stdout || '',
    stderr: result.stderr || '',
  };
}

function assertReminder(cmd) {
  const result = runScript({ tool_input: { command: cmd } });
  assert.strictEqual(result.code, 0, `exit code for "${cmd}"`);
  assert.ok(
    result.stdout.includes('Consider running in tmux'),
    `expected tmux reminder for "${cmd}", got: ${JSON.stringify(result.stdout)}`
  );
}

function assertNoReminder(cmd) {
  const result = runScript({ tool_input: { command: cmd } });
  assert.strictEqual(result.code, 0, `exit code for "${cmd}"`);
  assert.ok(
    !result.stdout.includes('Consider running in tmux'),
    `did not expect tmux reminder for "${cmd}", got: ${JSON.stringify(result.stdout)}`
  );
}

function runTests() {
  console.log('\n=== Testing pre-bash-tmux-reminder.js ===\n');

  let passed = 0;
  let failed = 0;

  if (process.platform === 'win32') {
    console.log('  (skipping: hook is a no-op on win32)\n');
    return true;
  }

  console.log('Yarn matches (regression: subcommand must be required):');

  if (test('fires for yarn install', () => assertReminder('yarn install'))) passed++; else failed++;
  if (test('fires for yarn test', () => assertReminder('yarn test'))) passed++; else failed++;

  console.log('\nYarn non-matches (regression for bug where every yarn command matched):');

  if (test('does not fire for yarn add react', () => assertNoReminder('yarn add react'))) passed++; else failed++;
  if (test('does not fire for yarn build', () => assertNoReminder('yarn build'))) passed++; else failed++;
  if (test('does not fire for yarn dev', () => assertNoReminder('yarn dev'))) passed++; else failed++;
  if (test('does not fire for yarn --version', () => assertNoReminder('yarn --version'))) passed++; else failed++;
  if (test('does not fire for bare yarn', () => assertNoReminder('yarn'))) passed++; else failed++;

  console.log('\nSibling package managers still behave as before:');

  if (test('fires for npm install', () => assertReminder('npm install'))) passed++; else failed++;
  if (test('fires for pnpm test', () => assertReminder('pnpm test'))) passed++; else failed++;
  if (test('fires for bun install', () => assertReminder('bun install'))) passed++; else failed++;
  if (test('does not fire for npm run dev', () => assertNoReminder('npm run dev'))) passed++; else failed++;

  console.log('\nOther matched tools still trigger:');

  if (test('fires for pytest tests/', () => assertReminder('pytest tests/'))) passed++; else failed++;
  if (test('fires for cargo build', () => assertReminder('cargo build'))) passed++; else failed++;

  console.log('\nSkips when already inside tmux:');

  if (test('does not fire when TMUX is set even for yarn install', () => {
    const result = spawnSync('node', [script], {
      encoding: 'utf8',
      input: JSON.stringify({ tool_input: { command: 'yarn install' } }),
      timeout: 10000,
      env: { ...process.env, TMUX: '/tmp/tmux-1000/default,1,0' },
    });
    assert.strictEqual(result.status || 0, 0);
    assert.ok(!(result.stdout || '').includes('Consider running in tmux'));
  })) passed++; else failed++;

  console.log('\nEdge cases:');

  if (test('handles invalid JSON gracefully', () => {
    const result = runScript('not json');
    assert.strictEqual(result.code, 0);
    assert.strictEqual(result.stdout, 'not json');
  })) passed++; else failed++;

  if (test('handles missing command field', () => {
    const result = runScript({ tool_input: {} });
    assert.strictEqual(result.code, 0);
    assert.ok(!result.stdout.includes('Consider running in tmux'));
  })) passed++; else failed++;

  console.log(`\nResults: ${passed} passed, ${failed} failed\n`);
  return failed === 0;
}

if (require.main === module) {
  const ok = runTests();
  process.exit(ok ? 0 : 1);
}

module.exports = { runTests };
