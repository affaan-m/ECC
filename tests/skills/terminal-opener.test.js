#!/usr/bin/env node

'use strict';

const assert = require('assert');
const fs = require('fs');
const path = require('path');
const { spawnSync } = require('child_process');

const REPO_ROOT = path.join(__dirname, '..', '..');
const SKILL_ROOT = path.join(REPO_ROOT, 'skills', 'terminal-opener');
const SCRIPT = path.join(SKILL_ROOT, 'scripts', 'open-terminal.js');

const {
  buildLaunchPlan,
  detectTerminalCapability,
  formatLaunchResult,
  launch,
  parseArgs,
} = require(SCRIPT);

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

  check('returns an actionable plan for an unsupported terminal', () => {
    const plan = buildLaunchPlan(baseOptions({ terminal: 'alacritty' }));
    assert.strictEqual(plan.ok, false);
    assert.strictEqual(plan.reason, 'unsupported-terminal');
    assert.match(plan.action, /--terminal wezterm/);
    assert.match(plan.action, /Install WezTerm/);
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
    assert.match(skill, /shell:\s*false/);
    assert.match(skill, /--skip-config start --always-new-process/);
    assert.match(skill, /--launch/);
    assert.match(skill, /inherits the full environment[\s\S]*does not filter/i);
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
