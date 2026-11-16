/**
 * Tests for the hook watchdog: hook runners must not outlive the harness
 * process that spawned them.
 */

'use strict';

const assert = require('assert');
const fs = require('fs');
const os = require('os');
const path = require('path');
const { spawn } = require('child_process');
const {
  DEFAULT_HARD_DEADLINE_MS,
  installHookWatchdog,
  isProcessAlive,
  resolveDeadline,
} = require('../../scripts/hooks/hook-watchdog');

const RUNNER = path.join(__dirname, '..', '..', 'scripts', 'hooks', 'run-with-flags.js');
const ORPHAN_EXIT_BUDGET_MS = 8000;

async function test(name, fn) {
  try {
    await fn();
    console.log(`  ✓ ${name}`);
    return true;
  } catch (error) {
    console.log(`  ✗ ${name}`);
    console.log(`    Error: ${error.message}`);
    return false;
  }
}

function fakeClock() {
  const timers = [];
  return {
    timers,
    setTimer: (fn, ms) => { const t = { fn, ms, kind: 'once', unref() {} }; timers.push(t); return t; },
    setRepeating: (fn, ms) => { const t = { fn, ms, kind: 'repeat', unref() {} }; timers.push(t); return t; },
    clearTimer: t => { t.cleared = true; },
    clearRepeating: t => { t.cleared = true; },
  };
}

function harness(overrides = {}) {
  const clock = fakeClock();
  const exits = [];
  const messages = [];
  let ppid = overrides.ppid === undefined ? 4242 : overrides.ppid;
  const alive = new Set([4242]);
  const disarm = installHookWatchdog({
    label: 'test hook',
    env: overrides.env || {},
    now: () => 1000,
    getPpid: () => ppid,
    isAlive: pid => alive.has(pid),
    exit: code => exits.push(code),
    writeStderr: message => messages.push(message),
    ...clock,
  });
  return {
    clock, exits, messages, disarm, alive,
    setPpid: value => { ppid = value; },
    deadline: () => clock.timers.find(t => t.kind === 'once'),
    poll: () => clock.timers.find(t => t.kind === 'repeat'),
  };
}

function waitForExit(pid, budgetMs) {
  const started = Date.now();
  return new Promise(resolve => {
    const check = () => {
      if (!isProcessAlive(pid)) return resolve(Date.now() - started);
      if (Date.now() - started > budgetMs) return resolve(null);
      setTimeout(check, 100);
    };
    check();
  });
}

async function runTests() {
  console.log('\n=== Testing hook-watchdog ===\n');
  let passed = 0;
  let failed = 0;
  const record = ok => (ok ? passed++ : failed++);

  record(await test('default deadline sits above the longest hook timeout (300s)', () => {
    assert.ok(DEFAULT_HARD_DEADLINE_MS > 300000);
    assert.strictEqual(resolveDeadline(0, {}), DEFAULT_HARD_DEADLINE_MS);
  }));

  record(await test('an earlier inherited ECC_HOOK_DEADLINE_MS wins', () => {
    assert.strictEqual(resolveDeadline(1000, { ECC_HOOK_DEADLINE_MS: '6000' }), 6000);
  }));

  record(await test('a later, past or malformed inherited deadline is ignored', () => {
    const hard = 1000 + DEFAULT_HARD_DEADLINE_MS;
    assert.strictEqual(resolveDeadline(1000, { ECC_HOOK_DEADLINE_MS: String(hard + 5) }), hard);
    assert.strictEqual(resolveDeadline(1000, { ECC_HOOK_DEADLINE_MS: '500' }), hard);
    assert.strictEqual(resolveDeadline(1000, { ECC_HOOK_DEADLINE_MS: 'soon' }), hard);
  }));

  record(await test('stays quiet while the parent is alive', () => {
    const h = harness();
    h.poll().fn();
    h.poll().fn();
    assert.deepStrictEqual(h.exits, []);
  }));

  record(await test('exits 0 when the parent PID disappears (Windows orphan)', () => {
    const h = harness();
    h.alive.delete(4242);
    h.poll().fn();
    assert.deepStrictEqual(h.exits, [0]);
    assert.match(h.messages.join(''), /parent process 4242 is gone; exiting test hook/);
  }));

  record(await test('exits 0 when the process is re-parented (POSIX orphan)', () => {
    const h = harness();
    h.setPpid(1);
    h.poll().fn();
    assert.deepStrictEqual(h.exits, [0]);
  }));

  record(await test('exits 0 when the hard deadline fires', () => {
    const h = harness();
    assert.strictEqual(h.deadline().ms, DEFAULT_HARD_DEADLINE_MS);
    h.deadline().fn();
    assert.deepStrictEqual(h.exits, [0]);
    assert.match(h.messages.join(''), /deadline/);
  }));

  record(await test('fires at most once', () => {
    const h = harness();
    h.alive.delete(4242);
    h.poll().fn();
    h.deadline().fn();
    assert.deepStrictEqual(h.exits, [0]);
  }));

  record(await test('disarm clears both timers and suppresses exits', () => {
    const h = harness();
    h.disarm();
    assert.ok(h.deadline().cleared && h.poll().cleared);
    h.deadline().fn();
    assert.deepStrictEqual(h.exits, []);
  }));

  record(await test('no parent polling when started without a real parent', () => {
    const h = harness({ ppid: 1 });
    assert.strictEqual(h.poll(), undefined);
  }));

  record(await test('a throwing stderr write still exits', () => {
    const clock = fakeClock();
    const exits = [];
    installHookWatchdog({
      env: {}, now: () => 0, getPpid: () => 1, exit: code => exits.push(code),
      writeStderr: () => { throw new Error('EPIPE'); }, ...clock,
    });
    clock.timers[0].fn();
    assert.deepStrictEqual(exits, [0]);
  }));

  record(await test('isProcessAlive sees this process and not a dead one', async () => {
    assert.strictEqual(isProcessAlive(process.pid), true);
    const child = spawn(process.execPath, ['-e', '']);
    await new Promise(resolve => child.on('exit', resolve));
    assert.strictEqual(isProcessAlive(child.pid), false);
  }));

  record(await test('regression: runner waiting on stdin exits after its parent is killed', async () => {
    // The wrapper plays the bash.exe that Claude Code kills on timeout. It
    // starts the runner detached, because bash.exe (unlike node) does not take
    // its children down with it. The runner inherits the wrapper's stdin, and a
    // holder process keeps a copy of that pipe's write end, as a sibling process
    // that inherited the handle would. So the runner never sees EOF, and without
    // the watchdog it would wait on stdin forever.
    const wrapperFile = path.join(fs.mkdtempSync(path.join(os.tmpdir(), 'ecc-watchdog-')), 'wrapper.js');
    fs.writeFileSync(wrapperFile, [
      "const { spawn } = require('child_process');",
      "const runner = spawn(process.execPath, [process.argv[2], 'pre:test:watchdog', 'scripts/hooks/none.js', 'minimal'],",
      "  { stdio: ['inherit', 'ignore', 'ignore'], detached: true });",
      "process.stdout.write(runner.pid + '\\n');",
      "setInterval(() => {}, 1000);",
    ].join('\n'));
    const wrapper = spawn(process.execPath, [wrapperFile, RUNNER], { stdio: ['pipe', 'pipe', 'pipe'] });
    const holder = spawn(process.execPath, ['-e', `setTimeout(() => {}, ${ORPHAN_EXIT_BUDGET_MS * 2})`],
      { stdio: [wrapper.stdin, 'ignore', 'ignore'] });
    let wrapperStderr = '';
    wrapper.stderr.on('data', chunk => { wrapperStderr += chunk; });
    const runnerPid = await new Promise((resolve, reject) => {
      wrapper.stdout.once('data', chunk => resolve(Number(String(chunk).trim())));
      wrapper.once('error', reject);
      wrapper.once('exit', code => reject(new Error(`wrapper exited early (${code}): ${wrapperStderr.trim()}`)));
    });
    try {
      assert.ok(isProcessAlive(runnerPid), 'runner should be running before the wrapper is killed');
      wrapper.kill('SIGKILL');
      const exitedAfter = await waitForExit(runnerPid, ORPHAN_EXIT_BUDGET_MS);
      assert.notStrictEqual(exitedAfter, null, `orphaned runner ${runnerPid} still alive after ${ORPHAN_EXIT_BUDGET_MS}ms`);
    } finally {
      try { process.kill(runnerPid, 'SIGKILL'); } catch { /* already gone */ }
      holder.kill('SIGKILL');
      wrapper.stdin.destroy();
      fs.rmSync(path.dirname(wrapperFile), { recursive: true, force: true });
    }
  }));

  console.log(`\nResults: Passed: ${passed}, Failed: ${failed}`);
  process.exit(failed > 0 ? 1 : 0);
}

runTests();
