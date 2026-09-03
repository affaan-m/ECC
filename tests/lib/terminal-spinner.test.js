'use strict';

const assert = require('assert');
const path = require('path');
const { spawnSync } = require('child_process');

const {
  CLEAR_LINE,
  FRAMES,
  runAnimator,
  startTerminalSpinner,
} = require('../../scripts/lib/terminal-spinner');

const spinnerModule = path.join(
  __dirname,
  '..',
  '..',
  'scripts',
  'lib',
  'terminal-spinner.js'
);

let passed = 0;
let failed = 0;

function test(name, fn) {
  try {
    fn();
    console.log(`  ✓ ${name}`);
    passed += 1;
  } catch (error) {
    console.log(`  ✗ ${name}`);
    console.log(`    Error: ${error.message}`);
    failed += 1;
  }
}

console.log('\n=== Terminal spinner tests ===\n');

test('animator advances frames and exits when its parent disconnects', () => {
  const writes = [];
  let tick;
  let disconnect;
  let cleared;
  let exitCode;
  const timer = Symbol('timer');

  runAnimator('Applying ECC setup...', {
    clearSchedule: value => { cleared = value; },
    exit: code => { exitCode = code; },
    onDisconnect: handler => { disconnect = handler; },
    output: { write: value => writes.push(value) },
    schedule: (callback, interval) => {
      assert.strictEqual(interval, 80);
      tick = callback;
      return timer;
    },
  });

  tick();
  tick();
  assert.deepStrictEqual(writes, [
    `\r${FRAMES[1]} Applying ECC setup...`,
    `\r${FRAMES[2]} Applying ECC setup...`,
  ]);
  disconnect();
  assert.strictEqual(cleared, timer);
  assert.strictEqual(exitCode, 0);
});

test('spinner renders immediately and clears again after animator termination', () => {
  const writes = [];
  const spawnCalls = [];
  const handlers = {};
  const animatorErrors = [];
  let killCount = 0;
  const child = {
    kill: () => { killCount += 1; },
    on: (event, handler) => {
      assert.strictEqual(event, 'error');
      handlers[event] = handler;
    },
    once: (event, handler) => { handlers[event] = handler; },
  };
  const spinner = startTerminalSpinner('Applying ECC setup...', {
    onAnimatorError: error => animatorErrors.push(error.message),
    output: { write: value => writes.push(value) },
    spawnProcess: (...args) => {
      spawnCalls.push(args);
      return child;
    },
  });

  assert.strictEqual(writes[0], `${FRAMES[0]} Applying ECC setup...`);
  assert.strictEqual(spawnCalls.length, 1);
  assert.strictEqual(spawnCalls[0][0], process.execPath);
  assert.deepStrictEqual(spawnCalls[0][1].slice(1), [
    '--animate',
    'Applying ECC setup...',
  ]);
  assert.strictEqual(typeof handlers.error, 'function');
  handlers.error(new Error('animation unavailable'));
  assert.deepStrictEqual(animatorErrors, ['animation unavailable']);

  spinner.stop();
  writes.push(`\r${FRAMES[2]} late frame`);
  handlers.close();
  spinner.stop();
  assert.strictEqual(killCount, 1);
  assert.strictEqual(writes.at(-1), CLEAR_LINE);
  assert.deepStrictEqual(writes.slice(-3), [
    CLEAR_LINE,
    `\r${FRAMES[2]} late frame`,
    CLEAR_LINE,
  ]);
});

test('spinner keeps a visible first frame when the animator cannot launch', () => {
  const writes = [];
  const spinner = startTerminalSpinner('Applying ECC setup...', {
    output: { write: value => writes.push(value) },
    spawnProcess: () => { throw new Error('spawn unavailable'); },
  });

  spinner.stop();
  assert.deepStrictEqual(writes, [
    `${FRAMES[0]} Applying ECC setup...`,
    CLEAR_LINE,
  ]);
});

test('real animator advances independently and cannot write after cleanup', () => {
  const source = `
    const { startTerminalSpinner } = require(${JSON.stringify(spinnerModule)});
    const spinner = startTerminalSpinner('Applying ECC setup...');
    Atomics.wait(new Int32Array(new SharedArrayBuffer(4)), 0, 0, 250);
    spinner.stop();
  `;
  const result = spawnSync(process.execPath, ['-e', source], {
    encoding: 'utf8',
    timeout: 3000,
  });

  assert.ifError(result.error);
  assert.strictEqual(result.status, 0, result.stderr);
  assert.match(result.stdout, new RegExp(`${FRAMES[0]} Applying ECC setup`));
  assert.match(result.stdout, new RegExp(`${FRAMES[1]} Applying ECC setup`));
  const clearIndex = result.stdout.lastIndexOf(CLEAR_LINE);
  assert.ok(clearIndex > 0, 'real animator should clear its line');
  assert.doesNotMatch(
    result.stdout.slice(clearIndex + CLEAR_LINE.length),
    /Applying ECC setup/,
    'real animator should not render after cleanup'
  );
});

test('real animator exits when its parent process disappears', () => {
  const source = `
    const { startTerminalSpinner } = require(${JSON.stringify(spinnerModule)});
    startTerminalSpinner('Applying ECC setup...');
    process.exit(0);
  `;
  const result = spawnSync(process.execPath, ['-e', source], {
    encoding: 'utf8',
    timeout: 3000,
  });

  assert.ifError(result.error);
  assert.strictEqual(result.status, 0, result.stderr);
  assert.match(result.stdout, new RegExp(`${FRAMES[0]} Applying ECC setup`));
});

console.log(`\nResults: Passed: ${passed}, Failed: ${failed}`);
process.exit(failed > 0 ? 1 : 0);
