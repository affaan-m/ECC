/**
 * Integration tests for the opt-in capsule recorder hook.
 *
 * Runs the real hooks/hooks.json commands (SessionStart, the PostToolUse async
 * dispatcher, SessionEnd) against an isolated home and capsule directory.
 *
 * Run with: node tests/hooks/capsule-recorder.test.js
 */

'use strict';

const assert = require('assert');
const fs = require('fs');
const os = require('os');
const path = require('path');
const { spawn, spawnSync } = require('child_process');

const { verify, readCapsule } = require('../../scripts/lib/eval-harness/capsule');
const { groupCapsules } = require('../../scripts/lib/eval-harness/retrospective');

const REPO_ROOT = path.resolve(__dirname, '..', '..');
const HOOKS = require('../../hooks/hooks.json').hooks;
const SESSION = '7c1d2e3f-4a5b-4c6d-8e9f-0a1b2c3d4e5f';
const tempRoots = [];
process.on('exit', () => {
  for (const dir of tempRoots) fs.rmSync(dir, { recursive: true, force: true });
});

function makeTempDir() {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'ecc-capsule-recorder-'));
  tempRoots.push(dir);
  return dir;
}

function hookCommand(event, needle) {
  const commands = HOOKS[event].flatMap(entry => entry.hooks.map(hook => hook.command));
  const match = commands.find(command => command.includes(needle));
  assert.ok(match, `hooks.json ${event} has no command containing ${needle}`);
  return match;
}

const COMMANDS = {
  SessionStart: hookCommand('SessionStart', 'session:start:capsule-recorder'),
  PostToolUse: hookCommand('PostToolUse', "posttooluse-dispatcher.js');process.env.CLAUDE_PLUGIN_ROOT=r;process.argv.splice(1,0,s);require(s).cli()\" async"),
  SessionEnd: hookCommand('SessionEnd', 'session:end:capsule-recorder'),
};

function hookEnv(home, extra = {}) {
  const env = { ...process.env, HOME: home, USERPROFILE: home, CLAUDE_PLUGIN_ROOT: REPO_ROOT, ...extra };
  for (const key of [
    'ECC_DISABLED_HOOKS', 'ECC_HOOK_PROFILE', 'ECC_HOOKS_ENABLED', 'ECC_DRY_RUN', 'ECC_HOOK_CONFIG', 'CLAUDE_CONFIG_DIR',
    'ECC_CAPSULE_RECORDING', 'ECC_CAPSULE_DIR', 'ECC_CAPSULE_MAX_BYTES', 'ECC_CAPSULE_TASK_FAMILY',
  ]) {
    if (!(key in extra)) delete env[key];
  }
  return env;
}

function payloadFor(event, overrides = {}) {
  const base = { hook_event_name: event, session_id: SESSION, cwd: REPO_ROOT };
  if (event === 'SessionStart') return { ...base, source: 'startup', ...overrides };
  if (event === 'SessionEnd') return { ...base, reason: 'other', ...overrides };
  return {
    ...base,
    tool_name: 'Read',
    tool_use_id: 'toolu_read_1',
    tool_input: { file_path: path.join(REPO_ROOT, 'package.json') },
    tool_response: { type: 'text', file: { content: '{}' } },
    ...overrides,
  };
}

function runHook(event, env, overrides = {}) {
  return spawnSync(COMMANDS[event], {
    shell: true,
    cwd: REPO_ROOT,
    env,
    input: JSON.stringify(payloadFor(event, overrides)),
    encoding: 'utf8',
    timeout: 30000,
  });
}

function runHookAsync(event, env, overrides) {
  return new Promise(resolve => {
    const child = spawn(COMMANDS[event], { shell: true, cwd: REPO_ROOT, env });
    let stderr = '';
    child.stderr.on('data', chunk => { stderr += chunk; });
    child.on('close', status => resolve({ status, stderr }));
    child.stdin.end(JSON.stringify(payloadFor(event, overrides)));
  });
}

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

const tests = [];

tests.push(['without ECC_CAPSULE_RECORDING the hooks write no capsule', () => {
  const home = makeTempDir();
  const capsules = path.join(home, 'capsules');
  const env = hookEnv(home, { ECC_CAPSULE_DIR: capsules });
  for (const event of ['SessionStart', 'PostToolUse', 'SessionEnd']) {
    const result = runHook(event, env);
    assert.strictEqual(result.status, 0, `${event}: ${result.stderr}`);
    assert.ok(!result.stderr.includes('[CapsuleRecorder]'), result.stderr);
  }
  assert.strictEqual(fs.existsSync(capsules), false);
}]);

tests.push(['a recorded session verifies and groups through the eval harness', () => {
  const home = makeTempDir();
  const capsules = path.join(home, 'capsules');
  const env = hookEnv(home, { ECC_CAPSULE_RECORDING: '1', ECC_CAPSULE_DIR: capsules });
  for (const event of ['SessionStart', 'PostToolUse', 'SessionEnd']) {
    const result = runHook(event, env);
    assert.strictEqual(result.status, 0, `${event}: ${result.stderr}`);
    assert.ok(!result.stderr.includes('[CapsuleRecorder]'), result.stderr);
  }
  const dir = path.join(capsules, SESSION);
  assert.strictEqual(verify(dir).ok, true);
  const entries = readCapsule(dir).entries;
  assert.deepStrictEqual(entries.map(entry => `${entry.lineage}/${entry.kind}/${entry.effect_class}`),
    ['environment/session.start/SE0', 'interaction/tool.call/SE0', 'environment/session.end/SE0']);
  assert.strictEqual(entries[1].payload.tool, 'Read');
  const report = groupCapsules([dir]);
  assert.strictEqual(report.task_family, 'session');
}]);

tests.push(['ECC_DISABLED_HOOKS turns off each recorder hook id', () => {
  const home = makeTempDir();
  const capsules = path.join(home, 'capsules');
  const env = hookEnv(home, {
    ECC_CAPSULE_RECORDING: '1',
    ECC_CAPSULE_DIR: capsules,
    ECC_DISABLED_HOOKS: 'session:start:capsule-recorder,post:capsule-recorder,session:end:capsule-recorder',
  });
  for (const event of ['SessionStart', 'PostToolUse', 'SessionEnd']) {
    assert.strictEqual(runHook(event, env).status, 0);
  }
  assert.strictEqual(fs.existsSync(capsules), false);
}]);

tests.push(['a refused entry is reported on stderr and never blocks the tool', () => {
  const home = makeTempDir();
  const capsules = path.join(home, 'capsules');
  const env = hookEnv(home, { ECC_CAPSULE_RECORDING: '1', ECC_CAPSULE_DIR: capsules });
  const result = runHook('PostToolUse', env, { session_id: '../outside' });
  assert.strictEqual(result.status, 0);
  assert.match(result.stderr, /\[CapsuleRecorder\] skipped: session_id/);
  assert.strictEqual(fs.existsSync(capsules), false);
}]);

tests.push(['concurrent tool calls in one new session all land in one valid chain', async () => {
  const home = makeTempDir();
  const capsules = path.join(home, 'capsules');
  const env = hookEnv(home, { ECC_CAPSULE_RECORDING: '1', ECC_CAPSULE_DIR: capsules });
  const calls = Array.from({ length: 8 }, (_, index) => runHookAsync('PostToolUse', env, {
    tool_name: 'Grep',
    tool_use_id: `toolu_grep_${index}`,
    tool_input: { pattern: `p${index}` },
  }));
  const results = await Promise.all(calls);
  for (const result of results) {
    assert.strictEqual(result.status, 0);
    assert.ok(!result.stderr.includes('[CapsuleRecorder]'), result.stderr);
  }
  const dir = path.join(capsules, SESSION);
  assert.strictEqual(verify(dir).ok, true);
  const ids = readCapsule(dir).entries.map(entry => entry.payload.tool_call_id).sort();
  assert.deepStrictEqual(ids, Array.from({ length: 8 }, (_, index) => `toolu_grep_${index}`).sort());
  assert.deepStrictEqual(fs.readdirSync(capsules), [SESSION], 'no staging directory may remain');
}]);

async function main() {
  let passed = 0;
  let failed = 0;
  console.log('\n=== Testing capsule-recorder hook ===\n');
  for (const [name, fn] of tests) {
    if (await test(name, fn)) passed += 1; else failed += 1;
  }
  console.log(`\nResults: Passed: ${passed}, Failed: ${failed}`);
  process.exitCode = failed > 0 ? 1 : 0;
}

main();
