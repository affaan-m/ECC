#!/usr/bin/env node

'use strict';

const assert = require('assert');
const fs = require('fs');
const os = require('os');
const path = require('path');
const { spawnSync } = require('child_process');

const REPO_ROOT = path.join(__dirname, '..', '..');
const SKILL_ROOT = path.join(REPO_ROOT, 'skills', 'terminal-opener');
const SCRIPT = path.join(SKILL_ROOT, 'scripts', 'open-terminal.js');

const {
  buildLaunchPlan,
  buildSpawnEnvironment,
  buildTerminalAppScript,
  detectTerminalCapability,
  formatLaunchResult,
  launch,
  parseArgs,
  runFilteredCommand,
  runFilteredCommandFile,
} = require(SCRIPT);

function assertFilteredTarget(actualArgs, plan, expectedEnvironment) {
  const marker = actualArgs.indexOf('--run-filtered-file');
  assert.ok(marker > 0, 'filtered launches must use the target-side environment wrapper');
  assert.strictEqual(actualArgs[marker - 2], process.execPath);
  assert.strictEqual(actualArgs[marker - 1], SCRIPT);
  assert.strictEqual(actualArgs[marker - 3], '--');
  assert.strictEqual(actualArgs[marker + 2], '--temp-root');
  assert.strictEqual(actualArgs[marker + 4], '--');
  const environmentPath = actualArgs[marker + 1];
  assert.strictEqual(actualArgs[marker + 3], path.dirname(path.dirname(environmentPath)));
  assert.strictEqual(fs.statSync(environmentPath).mode & 0o777, 0o600);
  assert.deepStrictEqual(
    JSON.parse(fs.readFileSync(environmentPath, 'utf8')),
    expectedEnvironment
  );
  assert.deepStrictEqual(actualArgs.slice(marker + 5), [plan.executable, ...plan.argv]);
  fs.rmSync(path.dirname(environmentPath), { recursive: true, force: true });
}

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

function runCli(args, env = {}) {
  return spawnSync(process.execPath, [SCRIPT, ...args], {
    encoding: 'utf8',
    env: { ...process.env, ECC_TERMINAL: '', ...env },
  });
}

function baseOptions(overrides = {}) {
  return {
    argv: ['hello world'],
    cwd: '/tmp/example workspace',
    dryRun: false,
    executable: 'printf',
    help: false,
    json: false,
    mode: 'normal',
    terminal: 'wezterm',
    detect: false,
    environment: { mode: 'inherit', allowlist: [] },
    ...overrides,
  };
}

function runTests() {
  console.log('\n=== Testing terminal-opener skill ===\n');

  let passed = 0;
  let failed = 0;

  const check = (name, fn) => {
    if (test(name, fn)) passed += 1;
    else failed += 1;
  };

  check('parses an executable and exact argv entries after --', () => {
    const options = parseArgs(
      ['--terminal', 'wezterm', '--cwd', '/tmp/demo', '--', 'docker', 'exec', '-it', 'demo', 'bash'],
      { cwd: '/fallback', env: {} }
    );
    assert.strictEqual(options.executable, 'docker');
    assert.deepStrictEqual(options.argv, ['exec', '-it', 'demo', 'bash']);
    assert.strictEqual(options.cwd, '/tmp/demo');
  });

  check('normalizes macOS Terminal aliases from arguments and preferences', () => {
    for (const alias of ['terminal', 'terminal.app', 'macos-terminal']) {
      const explicit = parseArgs(['--terminal', alias, '--', 'echo'], {
        cwd: '/tmp', env: {},
      });
      assert.strictEqual(explicit.terminal, 'terminal.app');

      const preferred = parseArgs(['--', 'echo'], {
        cwd: '/tmp', env: { ECC_TERMINAL: alias },
      });
      assert.strictEqual(preferred.terminal, 'terminal.app');
    }
  });

  check('rejects an interpolated shell command string', () => {
    assert.throws(
      () => parseArgs(['--', 'printf hello; touch /tmp/pwned'], { cwd: '/tmp', env: {} }),
      /executable.*argv entry.*shell command string/i
    );
  });

  check('preserves shell metacharacters as inert argument entries', () => {
    const options = parseArgs(
      ['--', 'printf', '%s', '$(touch /tmp/never)', '; rm -rf /'],
      { cwd: '/tmp', env: {} }
    );
    assert.deepStrictEqual(options.argv, ['%s', '$(touch /tmp/never)', '; rm -rf /']);
  });

  check('accepts literal executable paths with spaces and metacharacters', () => {
    const spaced = parseArgs(
      ['--', '/Applications/My App/bin/tool', '--flag'],
      { cwd: '/tmp', env: {} }
    );
    assert.strictEqual(spaced.executable, '/Applications/My App/bin/tool');
    assert.deepStrictEqual(spaced.argv, ['--flag']);

    const metacharacter = parseArgs(
      ['--', '/tmp/tool;$name', '--flag'],
      { cwd: '/tmp', env: {} }
    );
    assert.strictEqual(metacharacter.executable, '/tmp/tool;$name');
  });

  check('requires the -- argv boundary and an executable', () => {
    assert.throws(() => parseArgs(['echo', 'hello'], { cwd: '/tmp', env: {} }), /Unknown option.*--/);
    assert.throws(() => parseArgs(['--'], { cwd: '/tmp', env: {} }), /executable is required/i);
  });

  check('defaults to a non-launching plan and requires an explicit launch gate', () => {
    const planned = parseArgs(['--', 'echo', 'hello'], { cwd: '/tmp', env: {} });
    assert.strictEqual(planned.dryRun, true);

    const launched = parseArgs(['--launch', '--', 'echo', 'hello'], {
      cwd: '/tmp',
      env: {},
    });
    assert.strictEqual(launched.dryRun, false);

    assert.throws(
      () => parseArgs(['--launch', '--dry-run', '--', 'echo'], {
        cwd: '/tmp',
        env: {},
      }),
      /mutually exclusive/i
    );
  });

  check('parses an explicit filtered environment allowlist', () => {
    const options = parseArgs([
      '--filtered-env', '--allow-env', 'PATH', '--allow-env', 'TERM', '--allow-env', 'PATH',
      '--', 'echo', 'hello',
    ], { cwd: '/tmp', env: {} });
    assert.deepStrictEqual(options.environment, {
      mode: 'filtered',
      allowlist: ['PATH', 'TERM'],
    });
    assert.throws(
      () => parseArgs(['--allow-env', 'PATH', '--', 'echo'], { cwd: '/tmp', env: {} }),
      /--allow-env requires --filtered-env/
    );
    assert.throws(
      () => parseArgs(['--filtered-env', '--allow-env', 'BAD-NAME', '--', 'echo'], {
        cwd: '/tmp', env: {},
      }),
      /environment variable name/
    );
  });

  check('builds only explicitly allowlisted environment values', () => {
    const source = {
      PATH: '/safe/bin',
      TERM: 'xterm-256color',
      API_TOKEN: 'must-not-leak',
      EMPTY: '',
    };
    assert.deepStrictEqual(
      buildSpawnEnvironment({ mode: 'filtered', allowlist: ['PATH', 'TERM', 'MISSING', 'EMPTY'] }, source),
      { PATH: '/safe/bin', TERM: 'xterm-256color', EMPTY: '' }
    );
    assert.strictEqual(buildSpawnEnvironment({ mode: 'inherit', allowlist: [] }, source), undefined);
  });

  check('runs a filtered target with exact argv, environment, and no shell', () => {
    const calls = [];
    const environment = { PATH: '/safe/bin', TERM: 'xterm-256color' };
    const payload = Buffer.from(JSON.stringify(environment), 'utf8').toString('base64url');
    const status = runFilteredCommand(payload, ['printf', '%s', 'hello world'], {
      spawnSync(command, argv, options) {
        calls.push({ command, argv, options });
        return { status: 7 };
      },
    });
    assert.strictEqual(status, 7);
    assert.deepStrictEqual(calls[0].command, 'printf');
    assert.deepStrictEqual(calls[0].argv, ['%s', 'hello world']);
    assert.deepStrictEqual(calls[0].options.env, environment);
    assert.strictEqual(calls[0].options.shell, false);
    assert.strictEqual(calls[0].options.stdio, 'inherit');
  });

  check('consumes and removes a private filtered environment file', () => {
    const temporaryRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'ecc-terminal-env-'));
    const environmentPath = path.join(temporaryRoot, 'environment.json');
    fs.writeFileSync(environmentPath, JSON.stringify({ PATH: '/safe/bin' }), { mode: 0o600 });
    fs.chmodSync(temporaryRoot, 0o700);
    let received;
    const status = runFilteredCommandFile(environmentPath, ['printf', 'hello'], {
      spawnSync(executable, argv, options) {
        received = { executable, argv, options };
        return { status: 0 };
      },
    });
    assert.strictEqual(status, 0);
    assert.deepStrictEqual(received.executable, 'printf');
    assert.deepStrictEqual(received.argv, ['hello']);
    assert.deepStrictEqual(received.options.env, { PATH: '/safe/bin' });
    assert.strictEqual(received.options.shell, false);
    assert.strictEqual(fs.existsSync(temporaryRoot), false);
  });

  check('rejects a filtered environment file swapped between inspection and open', () => {
    const temporaryRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'ecc-terminal-env-'));
    const environmentPath = path.join(temporaryRoot, 'environment.json');
    const inspectedPath = path.join(temporaryRoot, 'inspected.json');
    fs.writeFileSync(environmentPath, JSON.stringify({ PATH: '/safe/bin' }), { mode: 0o600 });
    fs.chmodSync(temporaryRoot, 0o700);
    let swapped = false;
    const fsImpl = {
      ...fs,
      openSync(filePath, flags) {
        if (!swapped && filePath === environmentPath) {
          swapped = true;
          fs.renameSync(environmentPath, inspectedPath);
          fs.writeFileSync(environmentPath, JSON.stringify({ PATH: '/substituted/bin' }), { mode: 0o600 });
        }
        return fs.openSync(filePath, flags);
      },
    };

    assert.throws(
      () => runFilteredCommandFile(environmentPath, ['printf', 'hello'], {
        fs: fsImpl,
        spawnSync() { throw new Error('substituted environment executed'); },
      }),
      /changed during validation/i
    );
    assert.strictEqual(fs.existsSync(temporaryRoot), false);
  });

  check('expires an unconsumed private terminal launch artifact', () => {
    const temporaryRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'ecc-terminal-env-'));
    const environmentPath = path.join(temporaryRoot, 'environment.json');
    fs.chmodSync(temporaryRoot, 0o700);
    fs.writeFileSync(environmentPath, '{}', { mode: 0o600 });

    const cleanup = spawnSync(process.execPath, [
      SCRIPT,
      '--cleanup-temp-root',
      temporaryRoot,
      '--temp-root',
      os.tmpdir(),
      '--after',
      '0',
    ], { encoding: 'utf8', env: {} });

    assert.strictEqual(cleanup.status, 0, cleanup.stderr);
    assert.strictEqual(fs.existsSync(temporaryRoot), false);
  });

  check('rejects unsafe values at input boundaries', () => {
    assert.throws(() => parseArgs(['--cwd', 'relative', '--', 'echo'], { cwd: '/tmp', env: {} }), /absolute/);
    assert.throws(() => parseArgs(['--terminal', '../wezterm', '--', 'echo'], { cwd: '/tmp', env: {} }), /terminal name/);
    assert.throws(() => parseArgs(['--', 'echo', 'bad\0arg'], { cwd: '/tmp', env: {} }), /NUL/);
  });

  check('builds the mux-first WezTerm launch plan without a shell', () => {
    const plan = buildLaunchPlan(baseOptions());
    assert.strictEqual(plan.ok, true);
    assert.strictEqual(plan.launchMode, 'mux');
    assert.strictEqual(plan.command, 'wezterm');
    assert.deepStrictEqual(plan.args, [
      'cli', 'spawn', '--new-window', '--cwd', '/tmp/example workspace', '--', 'printf', 'hello world',
    ]);
    assert.deepStrictEqual(plan.fallback.args, [
      'start', '--cwd', '/tmp/example workspace', '--', 'printf', 'hello world',
    ]);
    assert.deepStrictEqual(plan.probe, { command: 'wezterm', args: ['--version'] });
    assert.deepStrictEqual(plan.environment, { mode: 'inherit', allowlist: [] });
  });

  check('records a filtered environment policy without exposing values', () => {
    const plan = buildLaunchPlan(baseOptions({
      environment: { mode: 'filtered', allowlist: ['PATH', 'TERM'] },
    }));
    assert.deepStrictEqual(plan.environment, {
      mode: 'filtered',
      allowlist: ['PATH', 'TERM'],
    });
    assert.ok(!JSON.stringify(plan).includes('must-not-leak'));
  });

  check('builds standalone recovery with stock config and a new process', () => {
    const plan = buildLaunchPlan(baseOptions({ mode: 'recover' }));
    assert.strictEqual(plan.launchMode, 'recover');
    assert.deepStrictEqual(plan.args, [
      '--skip-config', 'start', '--always-new-process', '--cwd', '/tmp/example workspace', '--',
      'printf', 'hello world',
    ]);
    assert.strictEqual(plan.fallback, null);
  });

  check('builds a secret-free Terminal.app dry-run plan', () => {
    const plan = buildLaunchPlan(baseOptions({
      terminal: 'macos-terminal',
      environment: { mode: 'filtered', allowlist: ['PATH', 'SANDBOX_TOKEN'] },
    }));
    assert.strictEqual(plan.ok, true);
    assert.strictEqual(plan.terminal, 'terminal.app');
    assert.strictEqual(plan.launchMode, 'app');
    assert.strictEqual(plan.command, '/usr/bin/osascript');
    assert.strictEqual(plan.args.at(-1), '__ECC_TERMINAL_WRAPPER__');
    assert.ok(!plan.args.includes(plan.executable));
    assert.ok(!plan.args.includes('hello world'));
    assert.deepStrictEqual(plan.probe, {
      command: '/usr/bin/osascript',
      args: ['-e', 'id of application "Terminal"'],
    });
    assert.deepStrictEqual(plan.environment, {
      mode: 'filtered', allowlist: ['PATH', 'SANDBOX_TOKEN'],
    });
    assert.ok(!JSON.stringify(plan).includes('must-not-leak'));
  });

  check('uses an argv-bound AppleScript handoff instead of opening the command document', () => {
    const plan = buildLaunchPlan(baseOptions({ terminal: 'terminal.app' }));
    assert.strictEqual(plan.command, '/usr/bin/osascript');
    assert.deepStrictEqual(plan.args.slice(0, -1), [
      '-e', 'on run argv',
      '-e', 'set launcherPath to item 1 of argv',
      '-e', 'tell application "Terminal"',
      '-e', 'activate',
      '-e', 'do script (quoted form of launcherPath)',
      '-e', 'end tell',
      '-e', 'end run',
    ]);
    assert.strictEqual(plan.args.at(-1), '__ECC_TERMINAL_WRAPPER__');
    assert.ok(!plan.args.includes('-na'));
    assert.ok(!plan.args.includes('Terminal.app'));
  });

  check('returns an actionable plan for an unsupported terminal', () => {
    const plan = buildLaunchPlan(baseOptions({ terminal: 'alacritty' }));
    assert.strictEqual(plan.ok, false);
    assert.strictEqual(plan.reason, 'unsupported-terminal');
    assert.match(plan.action, /--terminal wezterm/);
    assert.match(plan.action, /--terminal terminal\.app/);
    assert.strictEqual(plan.command, null);
  });

  check('detects an available terminal with shell disabled', () => {
    const calls = [];
    const capability = detectTerminalCapability(buildLaunchPlan(baseOptions()), (command, args, options) => {
      calls.push({ command, args, options });
      return { status: 0, stdout: 'wezterm 20260101\n', stderr: '' };
    });
    assert.deepStrictEqual(calls.map(({ command, args }) => ({ command, args })), [
      { command: 'wezterm', args: ['--version'] },
    ]);
    assert.strictEqual(calls[0].options.shell, false);
    assert.strictEqual(calls[0].options.timeout, 10_000);
    assert.strictEqual(calls[0].options.killSignal, 'SIGTERM');
    assert.strictEqual(capability.available, true);
    assert.strictEqual(capability.version, 'wezterm 20260101');
  });

  check('detects Terminal.app through its bundle id without a shell', () => {
    const calls = [];
    const plan = buildLaunchPlan(baseOptions({ terminal: 'terminal.app' }));
    const capability = detectTerminalCapability(plan, (command, args, options) => {
      calls.push({ command, args, options });
      return { status: 0, stdout: 'com.apple.Terminal\n', stderr: '' };
    });
    assert.deepStrictEqual(calls.map(({ command, args }) => ({ command, args })), [{
      command: '/usr/bin/osascript',
      args: ['-e', 'id of application "Terminal"'],
    }]);
    assert.strictEqual(calls[0].options.shell, false);
    assert.strictEqual(capability.available, true);
    assert.strictEqual(capability.version, 'com.apple.Terminal');
  });

  check('does not expose filtered target values to the Terminal.app probe', () => {
    const calls = [];
    const plan = buildLaunchPlan(baseOptions({
      terminal: 'terminal.app',
      environment: { mode: 'filtered', allowlist: ['PATH', 'SANDBOX_TOKEN'] },
    }));
    const capability = detectTerminalCapability(plan, (command, args, options) => {
      calls.push({ command, args, options });
      return { status: 0, stdout: 'com.apple.Terminal\n', stderr: '' };
    }, {
      env: { PATH: '/safe/bin', SANDBOX_TOKEN: 'terminal-secret-must-not-leak' },
    });
    assert.strictEqual(capability.available, true);
    assert.deepStrictEqual(calls[0].options.env, {});
  });

  check('filters the environment used by terminal detection', () => {
    const calls = [];
    const plan = buildLaunchPlan(baseOptions({
      environment: { mode: 'filtered', allowlist: ['PATH', 'TERM'] },
    }));
    const capability = detectTerminalCapability(plan, (command, args, options) => {
      calls.push({ command, args, options });
      return { status: 0, stdout: 'wezterm 1\n', stderr: '' };
    }, {
      env: { PATH: '/safe/bin', TERM: 'xterm-256color', API_TOKEN: 'must-not-leak' },
    });
    assert.strictEqual(capability.available, true);
    assert.deepStrictEqual(calls[0].options.env, {
      PATH: '/safe/bin',
      TERM: 'xterm-256color',
    });
    assert.strictEqual(calls[0].options.shell, false);
  });

  check('reports actionable missing and unsupported capabilities', () => {
    const missing = detectTerminalCapability(buildLaunchPlan(baseOptions()), () => ({
      error: Object.assign(new Error('spawn wezterm ENOENT'), { code: 'ENOENT' }),
      status: null,
    }));
    assert.strictEqual(missing.supported, true);
    assert.strictEqual(missing.available, false);
    assert.match(missing.action, /Install WezTerm/);

    const unsupported = detectTerminalCapability(
      buildLaunchPlan(baseOptions({ terminal: 'kitty' })),
      () => { throw new Error('must not probe unsupported adapters'); }
    );
    assert.strictEqual(unsupported.supported, false);
    assert.match(unsupported.action, /--terminal wezterm/);
  });

  check('classifies probe timeouts and non-zero exits as probe failures', () => {
    const timedOut = detectTerminalCapability(buildLaunchPlan(baseOptions()), () => ({
      error: Object.assign(new Error('spawnSync wezterm ETIMEDOUT'), { code: 'ETIMEDOUT' }),
      status: null,
    }));
    assert.strictEqual(timedOut.available, false);
    assert.strictEqual(timedOut.reason, 'probe-failed');

    const nonZero = detectTerminalCapability(
      buildLaunchPlan(baseOptions()),
      () => ({ status: 3, stdout: '', stderr: 'broken' })
    );
    assert.strictEqual(nonZero.available, false);
    assert.strictEqual(nonZero.reason, 'probe-failed');
    assert.match(nonZero.detail, /status 3/);
  });

  check('refuses to launch when the terminal is unavailable', () => {
    let spawned = false;
    assert.throws(
      () => launch(buildLaunchPlan(baseOptions()), {
        spawnSync() {
          return { error: new Error('spawn wezterm ENOENT'), status: null };
        },
        spawn() {
          spawned = true;
          return { unref() {} };
        },
      }),
      /not-installed/
    );
    assert.strictEqual(spawned, false);
  });

  check('launches Terminal.app through a private self-cleaning command file', () => {
    const targetArgv = [
      'hello world',
      '$HOME',
      "quote's",
      '; touch /tmp/never',
      'line\nbreak',
    ];
    const printArgv = 'process.stdout.write(JSON.stringify(process.argv.slice(1)))';
    const plan = buildLaunchPlan(baseOptions({
      terminal: 'terminal',
      cwd: REPO_ROOT,
      executable: process.execPath,
      argv: ['-e', printArgv, ...targetArgv],
      environment: { mode: 'filtered', allowlist: ['PATH', 'SANDBOX_TOKEN'] },
    }));
    const syncCalls = [];
    const scheduledCleanupRoots = [];
    const secret = 'terminal-secret-must-not-leak';
    const result = launch(plan, {
      env: { PATH: process.env.PATH, SANDBOX_TOKEN: secret, OMITTED_TOKEN: 'also-secret' },
      scheduleCleanup(temporaryRoots) {
        scheduledCleanupRoots.push(...temporaryRoots);
      },
      spawnSync(command, args, options) {
        syncCalls.push({ command, args, options });
        if (args[1] === 'id of application "Terminal"') {
          return { status: 0, stdout: 'com.apple.Terminal\n', stderr: '' };
        }
        return { status: 0, stdout: '', stderr: '' };
      },
    });

    assert.strictEqual(result.strategy, 'terminal-app');
    assert.strictEqual(syncCalls.length, 2);
    const launchCall = syncCalls[1];
    assert.strictEqual(launchCall.command, '/usr/bin/osascript');
    assert.strictEqual(launchCall.options.shell, false);
    assert.deepStrictEqual(launchCall.options.env, {});
    assert.ok(!JSON.stringify(launchCall.args).includes(secret));
    assert.ok(!JSON.stringify(launchCall.args).includes('also-secret'));
    assert.ok(!launchCall.args.includes(process.execPath));
    for (const argument of targetArgv) assert.ok(!launchCall.args.includes(argument));

    const wrapperPath = launchCall.args.at(-1);
    const wrapperRoot = path.dirname(wrapperPath);
    assert.strictEqual(fs.statSync(wrapperRoot).mode & 0o777, 0o700);
    assert.strictEqual(fs.statSync(wrapperPath).mode & 0o777, 0o700);
    const wrapper = fs.readFileSync(wrapperPath, 'utf8');
    assert.ok(!wrapper.includes(secret));
    assert.ok(!wrapper.includes('SANDBOX_TOKEN='));
    assert.ok(!wrapper.includes('OMITTED_TOKEN'));
    assert.match(wrapper, /--run-filtered-file/);
    assert.strictEqual(scheduledCleanupRoots.length, 2);
    assert.ok(scheduledCleanupRoots.some(root => path.basename(root).startsWith('ecc-terminal-app-')));
    assert.ok(scheduledCleanupRoots.some(root => path.basename(root).startsWith('ecc-terminal-env-')));

    const targetResult = spawnSync('/bin/sh', [wrapperPath], {
      encoding: 'utf8',
      env: {},
    });
    assert.strictEqual(targetResult.status, 0, targetResult.stderr);
    assert.deepStrictEqual(JSON.parse(targetResult.stdout), targetArgv);
    assert.strictEqual(fs.existsSync(wrapperPath), false);
    assert.strictEqual(fs.existsSync(wrapperRoot), false);
    assert.ok(scheduledCleanupRoots.every(root => !fs.existsSync(root)));
  });

  check('removes the private Terminal.app launcher when its AppleScript handoff fails', () => {
    for (const launchFailure of [
      { error: Object.assign(new Error('spawn osascript EACCES'), { code: 'EACCES' }), status: null },
      { error: null, status: 7, stderr: 'LaunchServices refused the file' },
    ]) {
      let wrapperPath;
      const plan = buildLaunchPlan(baseOptions({ terminal: 'terminal.app', cwd: REPO_ROOT }));
      assert.throws(() => launch(plan, {
        spawnSync(command, args) {
          if (args[1] === 'id of application "Terminal"') {
            return { status: 0, stdout: 'com.apple.Terminal\n', stderr: '' };
          }
          wrapperPath = args.at(-1);
          assert.strictEqual(fs.existsSync(wrapperPath), true);
          return launchFailure;
        },
      }), /Unable to start Terminal\.app/);
      assert.strictEqual(fs.existsSync(wrapperPath), false);
      assert.strictEqual(fs.existsSync(path.dirname(wrapperPath)), false);
    }
  });

  check('rejects a malformed Terminal.app plan before creating a launcher', () => {
    let madeTemporaryDirectory = false;
    const plan = { ...buildLaunchPlan(baseOptions({ terminal: 'terminal.app' })), args: null };
    assert.throws(() => launch(plan, {
      mkdtempSync() {
        madeTemporaryDirectory = true;
        throw new Error('must not create a directory');
      },
      spawnSync() {
        return { status: 0, stdout: 'com.apple.Terminal\n', stderr: '' };
      },
    }), /Terminal\.app launch plan/);
    assert.strictEqual(madeTemporaryDirectory, false);
  });

  check('quotes every Terminal.app target entry as one exact shell word', () => {
    const plan = buildLaunchPlan(baseOptions({
      terminal: 'terminal.app',
      cwd: REPO_ROOT,
      executable: '/usr/bin/printf',
      argv: ['%s', 'value'],
    }));
    const script = buildTerminalAppScript(plan, undefined);
    assert.match(script, /exec '\/usr\/bin\/printf' '%s' 'value'/);
    assert.doesNotMatch(script, /eval|sh -c/);
  });

  check('uses the WezTerm mux when available', () => {
    const syncCalls = [];
    const asyncCalls = [];
    const result = launch(buildLaunchPlan(baseOptions()), {
      spawnSync(command, args, options) {
        syncCalls.push({ command, args, options });
        return syncCalls.length === 1
          ? { status: 0, stdout: 'wezterm 1\n', stderr: '' }
          : { status: 0, stdout: '42\n', stderr: '' };
      },
      spawn(...args) { asyncCalls.push(args); },
    });
    assert.strictEqual(result.strategy, 'mux');
    assert.strictEqual(syncCalls.length, 2);
    assert.strictEqual(syncCalls[1].options.shell, false);
    assert.strictEqual(asyncCalls.length, 0);
  });

  check('filters mux launch environment without changing argv or shell mode', () => {
    const syncCalls = [];
    const scheduledCleanupRoots = [];
    const plan = buildLaunchPlan(baseOptions({
      environment: { mode: 'filtered', allowlist: ['PATH', 'TERM'] },
    }));
    const result = launch(plan, {
      env: { PATH: '/safe/bin', TERM: 'xterm-256color', SSH_AUTH_SOCK: '/secret/socket' },
      scheduleCleanup(temporaryRoots) {
        scheduledCleanupRoots.push(...temporaryRoots);
      },
      spawnSync(command, args, options) {
        syncCalls.push({ command, args, options });
        return args[0] === '--version'
          ? { status: 0, stdout: 'wezterm 1\n', stderr: '' }
          : { status: 0, stdout: '42\n', stderr: '' };
      },
    });
    assert.strictEqual(result.strategy, 'mux');
    assertFilteredTarget(syncCalls[1].args, plan, {
      PATH: '/safe/bin', TERM: 'xterm-256color',
    });
    assert.ok(!syncCalls[1].args.join(' ').includes('secret/socket'));
    const reversiblePayload = Buffer.from(JSON.stringify({
      PATH: '/safe/bin', TERM: 'xterm-256color',
    })).toString('base64url');
    assert.ok(!syncCalls[1].args.includes(reversiblePayload));
    assert.deepStrictEqual(syncCalls[1].options.env, {
      PATH: '/safe/bin', TERM: 'xterm-256color',
    });
    assert.strictEqual(syncCalls[1].options.shell, false);
    assert.strictEqual(scheduledCleanupRoots.length, 1);
    assert.ok(path.basename(scheduledCleanupRoots[0]).startsWith('ecc-terminal-env-'));
  });

  check('falls back to a detached process and unreferences it', () => {
    const spawnCalls = [];
    const syncCalls = [];
    let unrefCount = 0;
    const result = launch(buildLaunchPlan(baseOptions()), {
      spawnSync(command, args, options) {
        syncCalls.push({ command, args, options });
        if (args[0] === '--version') return { status: 0, stdout: 'wezterm 1\n', stderr: '' };
        return { status: 1, stdout: '', stderr: 'mux unavailable' };
      },
      spawn(command, args, options) {
        spawnCalls.push({ command, args, options });
        return { unref() { unrefCount += 1; } };
      },
    });
    assert.strictEqual(result.strategy, 'detached-fallback');
    assert.strictEqual(spawnCalls[0].options.detached, true);
    assert.strictEqual(spawnCalls[0].options.shell, false);
    assert.strictEqual(spawnCalls[0].options.stdio, 'ignore');
    assert.strictEqual(unrefCount, 1);
    assert.strictEqual(syncCalls[1].options.timeout, 10_000);
    assert.strictEqual(syncCalls[1].options.killSignal, 'SIGTERM');
    assert.match(result.muxFailure, /status 1.*mux unavailable/);
  });

  check('filters the detached fallback environment', () => {
    const spawnCalls = [];
    const plan = buildLaunchPlan(baseOptions({
      environment: { mode: 'filtered', allowlist: ['PATH'] },
    }));
    const result = launch(plan, {
      env: { PATH: '/safe/bin', API_TOKEN: 'must-not-leak' },
      spawnSync(command, args) {
        return args[0] === '--version'
          ? { status: 0, stdout: 'wezterm 1\n', stderr: '' }
          : { status: 1, stdout: '', stderr: 'mux unavailable' };
      },
      spawn(command, args, options) {
        spawnCalls.push({ command, args, options });
        return { unref() {} };
      },
    });
    assert.strictEqual(result.strategy, 'detached-fallback');
    assertFilteredTarget(spawnCalls[0].args, plan, { PATH: '/safe/bin' });
    assert.ok(!spawnCalls[0].args.join(' ').includes('must-not-leak'));
    assert.deepStrictEqual(spawnCalls[0].options.env, { PATH: '/safe/bin' });
    assert.strictEqual(spawnCalls[0].options.shell, false);
  });

  check('surfaces mux fallback failures in human and JSON launch output', () => {
    const plan = buildLaunchPlan(baseOptions());
    const result = {
      strategy: 'detached-fallback',
      capability: { available: true, terminal: 'wezterm', version: 'wezterm 1' },
      muxFailure: 'wezterm cli spawn exited with status 1: mux unavailable',
    };

    const human = formatLaunchResult(plan, result, false);
    assert.match(human, /Open printf in wezterm using mux mode\./);
    assert.match(human, /Mux launch failed: .*status 1.*mux unavailable/);

    const json = JSON.parse(formatLaunchResult(plan, result, true));
    assert.strictEqual(json.executable, 'printf');
    assert.strictEqual(json.strategy, 'detached-fallback');
    assert.strictEqual(json.muxFailure, result.muxFailure);
  });

  check('preserves existing human launch output for non-fallback strategies', () => {
    const plan = buildLaunchPlan(baseOptions());
    const result = {
      strategy: 'mux',
      capability: { available: true, terminal: 'wezterm', version: 'wezterm 1' },
    };

    assert.strictEqual(
      formatLaunchResult(plan, result, false),
      'Open printf in wezterm using mux mode.\n'
    );
  });

  check('launches recovery directly as a detached process', () => {
    const syncArgs = [];
    const spawnCalls = [];
    const result = launch(buildLaunchPlan(baseOptions({ mode: 'recover' })), {
      spawnSync(command, args) {
        syncArgs.push(args);
        return { status: 0, stdout: 'wezterm 1\n', stderr: '' };
      },
      spawn(command, args, options) {
        spawnCalls.push({ command, args, options });
        return { unref() {} };
      },
    });
    assert.strictEqual(result.strategy, 'detached-recover');
    assert.deepStrictEqual(syncArgs, [['--version']]);
    assert.strictEqual(spawnCalls.length, 1);
    assert.ok(spawnCalls[0].args.includes('--always-new-process'));
  });

  check('filters the detached recovery environment', () => {
    const spawnCalls = [];
    const plan = buildLaunchPlan(baseOptions({
      mode: 'recover',
      environment: { mode: 'filtered', allowlist: ['PATH', 'LANG'] },
    }));
    const result = launch(plan, {
      env: { PATH: '/safe/bin', LANG: 'C.UTF-8', GH_TOKEN: 'must-not-leak' },
      spawnSync() {
        return { status: 0, stdout: 'wezterm 1\n', stderr: '' };
      },
      spawn(command, args, options) {
        spawnCalls.push({ command, args, options });
        return { unref() {} };
      },
    });
    assert.strictEqual(result.strategy, 'detached-recover');
    assertFilteredTarget(spawnCalls[0].args, plan, {
      PATH: '/safe/bin', LANG: 'C.UTF-8',
    });
    assert.ok(!spawnCalls[0].args.join(' ').includes('must-not-leak'));
    assert.deepStrictEqual(spawnCalls[0].options.env, {
      PATH: '/safe/bin', LANG: 'C.UTF-8',
    });
  });

  check('reports synchronous detached spawn failures actionably', () => {
    assert.throws(
      () => launch(buildLaunchPlan(baseOptions({ mode: 'recover' })), {
        spawnSync() {
          return { status: 0, stdout: 'wezterm 1\n', stderr: '' };
        },
        spawn() {
          throw new Error('EACCES');
        },
      }),
      /Unable to start wezterm: EACCES/
    );
  });

  check('routes asynchronous detached spawn errors to the caller', () => {
    let errorHandler;
    let reportedError;
    launch(buildLaunchPlan(baseOptions({ mode: 'recover' })), {
      spawnSync() {
        return { status: 0, stdout: 'wezterm 1\n', stderr: '' };
      },
      spawn() {
        return {
          once(event, handler) {
            if (event === 'error') errorHandler = handler;
          },
          unref() {},
        };
      },
      onDetachedError(error) {
        reportedError = error;
      },
    });
    assert.strictEqual(typeof errorHandler, 'function');
    errorHandler(new Error('terminal disappeared'));
    assert.match(reportedError.message, /Unable to start wezterm: terminal disappeared/);
  });

  check('sets a failing exit code for an unhandled asynchronous spawn error', () => {
    let errorHandler;
    let stderr = '';
    const originalExitCode = process.exitCode;
    const originalWrite = process.stderr.write;
    try {
      process.exitCode = undefined;
      process.stderr.write = chunk => {
        stderr += chunk;
        return true;
      };
      launch(buildLaunchPlan(baseOptions({ mode: 'recover' })), {
        spawnSync() {
          return { status: 0, stdout: 'wezterm 1\n', stderr: '' };
        },
        spawn() {
          return {
            once(event, handler) {
              if (event === 'error') errorHandler = handler;
            },
            unref() {},
          };
        },
      });
      errorHandler(new Error('terminal disappeared'));
      assert.strictEqual(process.exitCode, 1);
      assert.match(stderr, /Unable to start wezterm: terminal disappeared/);
    } finally {
      process.stderr.write = originalWrite;
      process.exitCode = originalExitCode;
    }
  });

  check('emits a machine-readable dry-run without launching', () => {
    const result = runCli([
      '--dry-run', '--json', '--cwd', '/tmp/demo', '--', 'ssh', '-t', 'example.test', 'echo $HOME; id',
    ]);
    assert.strictEqual(result.status, 0, result.stderr);
    const plan = JSON.parse(result.stdout);
    assert.strictEqual(plan.executable, 'ssh');
    assert.deepStrictEqual(plan.argv, ['-t', 'example.test', 'echo $HOME; id']);
    assert.strictEqual(plan.dryRun, true);
    assert.strictEqual(result.stderr, '');
  });

  check('emits a filtered environment dry-run without leaking source values', () => {
    const result = runCli([
      '--filtered-env', '--allow-env', 'PATH', '--allow-env', 'TERM',
      '--dry-run', '--json', '--cwd', '/tmp/demo', '--', 'podman', 'exec', '-it', 'review', 'bash',
    ], {
      PATH: process.env.PATH,
      TERM: 'xterm-256color',
      API_TOKEN: 'must-not-leak',
    });
    assert.strictEqual(result.status, 0, result.stderr);
    const plan = JSON.parse(result.stdout);
    assert.deepStrictEqual(plan.environment, {
      mode: 'filtered',
      allowlist: ['PATH', 'TERM'],
    });
    assert.ok(!result.stdout.includes('must-not-leak'));
  });

  check('keeps the CLI non-launching unless --launch is explicit', () => {
    const result = runCli(['--json', '--', 'printf', 'safe']);
    assert.strictEqual(result.status, 0, result.stderr);
    assert.strictEqual(JSON.parse(result.stdout).dryRun, true);
  });

  check('supports terminal capability detection without a command', () => {
    const result = runCli(['--detect', '--terminal', 'unsupported', '--json']);
    assert.strictEqual(result.status, 1);
    const capability = JSON.parse(result.stdout);
    assert.strictEqual(capability.supported, false);
    assert.match(capability.action, /--terminal wezterm/);
  });

  check('documents the safe reusable workflow in concise skill metadata', () => {
    const skill = fs.readFileSync(path.join(SKILL_ROOT, 'SKILL.md'), 'utf8');
    const frontmatterMatch = skill.match(/^---\n([\s\S]*?)\n---/);
    assert.ok(frontmatterMatch, 'SKILL.md must start with a YAML frontmatter block');
    const frontmatter = frontmatterMatch[1];
    const frontmatterKeys = frontmatter
      .split('\n')
      .filter(line => /^[a-z][a-z-]*:/.test(line))
      .map(line => line.split(':')[0]);
    assert.deepStrictEqual(frontmatterKeys, ['name', 'description']);
    assert.match(frontmatter, /executable.*argument array/i);
    assert.match(frontmatter, /visible terminal/i);
    assert.match(frontmatter, /use when an agent needs/i);
    assert.doesNotMatch(skill, /\b(?:Claude Code|Codex|Kimi Code)\b/i);
    assert.match(skill, /shell:\s*false/);
    assert.match(skill, /--skip-config start --always-new-process/);
    assert.match(skill, /--launch/);
    assert.match(skill, /--filtered-env/);
    assert.match(skill, /--allow-env/);
    assert.match(skill, /no environment variables[\s\S]*explicitly allowlist/i);
    assert.match(skill, /Terminal\.app/);
    assert.match(skill, /terminal[\s/|,]+terminal\.app[\s/|,]+macos-terminal/i);
    assert.match(skill, /private[\s\S]*temporary[\s\S]*self-delete/i);
    assert.match(skill, /macOS/i);
    assert.ok(!skill.includes('[TODO'));
    assert.ok(!fs.existsSync(path.join(SKILL_ROOT, 'README.md')));
  });

  check('keeps generated OpenAI metadata minimal and valid', () => {
    const yaml = fs.readFileSync(path.join(SKILL_ROOT, 'agents', 'openai.yaml'), 'utf8');
    const keys = [...yaml.matchAll(/^\s{2}([a-z_]+):/gm)].map(match => match[1]);
    const shortDescriptionMatch = yaml.match(/short_description:\s*"([^"]+)"/);
    assert.ok(shortDescriptionMatch, 'openai.yaml must define a quoted short_description');
    const shortDescription = shortDescriptionMatch[1];
    assert.deepStrictEqual(keys, ['display_name', 'short_description', 'default_prompt']);
    assert.ok(shortDescription.length >= 25 && shortDescription.length <= 64);
    assert.match(yaml, /default_prompt:.*\$terminal-opener/);
  });

  console.log(`\nPassed: ${passed}`);
  console.log(`Failed: ${failed}`);
  process.exitCode = failed > 0 ? 1 : 0;
}

runTests();
