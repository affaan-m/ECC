const assert = require('assert');
const path = require('path');
const { spawnSync } = require('child_process');

const script = path.join(__dirname, '..', '..', 'scripts', 'hooks', 'pre-bash-tmux-reminder.js');

function run(command, extraEnv = {}) {
  const { TMUX: _tmux, ...envWithoutTmux } = process.env;
  const result = spawnSync(process.execPath, [script], {
    encoding: 'utf8',
    input: JSON.stringify({ tool_input: { command } }),
    timeout: 10000,
    env: { ...envWithoutTmux, ...extraEnv }
  });

  if (result.error) throw result.error;
  if (result.signal) throw new Error(`hook terminated by ${result.signal}`);

  assert.strictEqual(result.status, 0, `unexpected exit for ${command}: ${result.stderr || ''}`);
  return result.stdout || '';
}

function hasReminder(command, extraEnv) {
  return run(command, extraEnv).includes('Consider running in tmux');
}

function runTests() {
  console.log('\n=== Testing pre-bash-tmux-reminder.js ===\n');

  if (process.platform === 'win32') {
    console.log('  SKIP: hook is a no-op on win32');
    return true;
  }

  const cases = [
    ['fires for yarn install and yarn test', () => {
      assert.ok(hasReminder('yarn install'));
      assert.ok(hasReminder('yarn test'));
    }],
    ['does not fire for ordinary yarn commands', () => {
      assert.ok(!hasReminder('yarn add react'));
      assert.ok(!hasReminder('yarn build'));
      assert.ok(!hasReminder('yarn dev'));
      assert.ok(!hasReminder('yarn --version'));
      assert.ok(!hasReminder('yarn'));
    }],
    ['keeps sibling package-manager behavior', () => {
      assert.ok(hasReminder('npm install'));
      assert.ok(hasReminder('pnpm test'));
      assert.ok(hasReminder('bun install'));
      assert.ok(!hasReminder('npm run dev'));
    }],
    ['suppresses reminders inside tmux', () => {
      assert.ok(!hasReminder('yarn install', { TMUX: '/tmp/tmux-1000/default,1,0' }));
    }]
  ];

  let failed = 0;
  for (const [name, fn] of cases) {
    try {
      fn();
      console.log(`  PASS ${name}`);
    } catch (error) {
      failed++;
      console.log(`  FAIL ${name}`);
      console.log(`       ${error.message}`);
    }
  }

  console.log(`\nResults: ${cases.length - failed} passed, ${failed} failed\n`);
  return failed === 0;
}

if (require.main === module) {
  process.exit(runTests() ? 0 : 1);
}

module.exports = { runTests };
