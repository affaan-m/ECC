/**
 * Tests for continuous-learning-v2 observe hook dispatch.
 *
 * Run with: node tests/hooks/continuous-learning-observe-runner.test.js
 */

'use strict';

const assert = require('assert');
const fs = require('fs');
const os = require('os');
const path = require('path');
const { spawnSync } = require('child_process');

const repoRoot = path.resolve(__dirname, '..', '..');
const hooksJsonPath = path.join(repoRoot, 'hooks', 'hooks.json');
const runWithFlagsPath = path.join(repoRoot, 'scripts', 'hooks', 'run-with-flags.js');
const observeRunner = require(path.join(repoRoot, 'scripts', 'hooks', 'observe-runner.js'));
const postToolUseDispatcher = require(path.join(repoRoot, 'scripts', 'hooks', 'posttooluse-dispatcher.js'));

function test(name, fn) {
  try {
    fn();
    console.log(`  \u2713 ${name}`);
    return true;
  } catch (err) {
    console.log(`  \u2717 ${name}`);
    console.log(`    Error: ${err.message}`);
    return false;
  }
}

function loadHook(id) {
  const hookGroups = JSON.parse(fs.readFileSync(hooksJsonPath, 'utf8')).hooks;
  const hooks = Object.values(hookGroups).flat();
  const hook = hooks.find(candidate => candidate.id === id);
  assert.ok(hook, `Expected ${id} in hooks/hooks.json`);
  assert.ok(Array.isArray(hook.hooks), `Expected ${id} to define hook commands`);
  assert.strictEqual(hook.hooks.length, 1, `Expected ${id} to have one command`);
  return hook.hooks[0].command;
}

function withTempPluginRoot(fn) {
  const tempRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'ecc-observe-runner-'));
  try {
    fs.mkdirSync(path.join(tempRoot, 'scripts', 'hooks'), { recursive: true });
    fs.mkdirSync(path.join(tempRoot, 'scripts', 'lib'), { recursive: true });
    fs.copyFileSync(
      path.join(repoRoot, 'scripts', 'lib', 'hook-flags.js'),
      path.join(tempRoot, 'scripts', 'lib', 'hook-flags.js')
    );
    return fn(tempRoot);
  } finally {
    fs.rmSync(tempRoot, { recursive: true, force: true });
  }
}

function withEnv(vars, fn) {
  const saved = {};
  for (const [key, value] of Object.entries(vars)) {
    saved[key] = process.env[key];
    if (value === undefined) {
      delete process.env[key];
    } else {
      process.env[key] = value;
    }
  }

  try {
    return fn();
  } finally {
    for (const [key, value] of Object.entries(saved)) {
      if (value === undefined) {
        delete process.env[key];
      } else {
        process.env[key] = value;
      }
    }
  }
}

function writeFakeObserveScript(tempRoot) {
  const scriptPath = path.join(tempRoot, 'skills', 'continuous-learning-v2', 'hooks', 'observe.sh');
  fs.mkdirSync(path.dirname(scriptPath), { recursive: true });
  fs.writeFileSync(
    scriptPath,
    [
      '#!/usr/bin/env bash',
      'input="$(cat)"',
      'printf "phase=%s input=%s root=%s" "$1" "$input" "${CLAUDE_PLUGIN_ROOT:-}"',
      ''
    ].join('\n'),
    'utf8'
  );
  fs.chmodSync(scriptPath, 0o755);
}

function runWithFlags(tempRoot, hookId, relScriptPath, stdin) {
  return spawnSync(process.execPath, [runWithFlagsPath, hookId, relScriptPath, 'standard,strict'], {
    input: stdin,
    encoding: 'utf8',
    env: {
      ...process.env,
      CLAUDE_PLUGIN_ROOT: tempRoot,
      ECC_HOOK_PROFILE: 'standard'
    },
    stdio: ['pipe', 'pipe', 'pipe'],
    timeout: 10000
  });
}

function runTests() {
  console.log('\n=== Testing continuous-learning observe hook dispatch ===\n');

  let passed = 0;
  let failed = 0;

  if (test('observe hooks use node-mode runner instead of shell-mode dispatch', () => {
    const preCommand = loadHook('pre:observe:continuous-learning');
    assert.ok(preCommand.includes('node scripts/hooks/run-with-flags.js pre:observe scripts/hooks/observe-runner.js standard,strict'));
    assert.ok(!preCommand.includes('shell scripts/hooks/run-with-flags-shell.sh'));
    assert.ok(!preCommand.includes('skills/continuous-learning-v2/hooks/observe.sh'));

    const postHook = postToolUseDispatcher.ASYNC_HOOKS.find(hook => hook.id === 'post:observe:continuous-learning');
    assert.ok(postHook, 'PostToolUse dispatcher should retain the observe hook ID');
    assert.strictEqual(postHook.script, 'scripts/hooks/observe-runner.js');
  })) passed++; else failed++;

  if (test('run-with-flags passes hookId to direct run exports', () => {
    withTempPluginRoot(tempRoot => {
      const scriptPath = path.join(tempRoot, 'scripts', 'hooks', 'capture-hook-id.js');
      fs.writeFileSync(
        scriptPath,
        [
          "'use strict';",
          'module.exports.run = function run(raw, options) {',
          '  return { stdout: JSON.stringify({ raw, hookId: options.hookId, truncated: options.truncated }) };',
          '};',
          ''
        ].join('\n'),
        'utf8'
      );

      const result = runWithFlags(tempRoot, 'post:observe', 'scripts/hooks/capture-hook-id.js', '{"ok":true}');
      assert.strictEqual(result.status, 0, result.stderr);
      const payload = JSON.parse(result.stdout);
      assert.deepStrictEqual(payload, { raw: '{"ok":true}', hookId: 'post:observe', truncated: false });
    });
  })) passed++; else failed++;

  if (test('observe-runner derives the observe phase from the hook id', () => {
    assert.strictEqual(observeRunner.getPhaseFromHookId('pre:observe'), 'pre');
    assert.strictEqual(observeRunner.getPhaseFromHookId('post:observe'), 'post');
    assert.strictEqual(observeRunner.getPhaseFromHookId('pre:observe:continuous-learning'), 'pre');
    assert.strictEqual(observeRunner.getPhaseFromHookId('unknown'), null);
  })) passed++; else failed++;

  if (test('observe-runner invokes observe.sh with phase, stdin, and plugin root', () => {
    withTempPluginRoot(tempRoot => {
      writeFakeObserveScript(tempRoot);
      const env = fs.existsSync('/bin/sh') ? { BASH: '/bin/sh' } : {};
      withEnv(env, () => {
        const output = observeRunner.run('payload', {
          hookId: 'pre:observe',
          pluginRoot: tempRoot
        });

        assert.strictEqual(output.exitCode, 0, output.stderr);
        assert.strictEqual(output.stdout, `phase=pre input=payload root=${tempRoot}`);
      });
    });
  })) passed++; else failed++;

  if (test('observe-runner fails open when no shell runtime is available', () => {
    withTempPluginRoot(tempRoot => {
      writeFakeObserveScript(tempRoot);
      withEnv({ BASH: '', PATH: '' }, () => {
        const output = observeRunner.run('payload', {
          hookId: 'post:observe',
          pluginRoot: tempRoot
        });

        assert.strictEqual(output.exitCode, 0);
        assert.ok(!Object.prototype.hasOwnProperty.call(output, 'stdout'), 'disabled observe should preserve stdin via runner passthrough');
        assert.ok(output.stderr.includes('shell runtime unavailable'));
      });
    });
  })) passed++; else failed++;

  console.log(`\nPassed: ${passed}`);
  console.log(`Failed: ${failed}`);
  process.exit(failed > 0 ? 1 : 0);
}

runTests();
