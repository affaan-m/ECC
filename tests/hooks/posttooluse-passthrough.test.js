'use strict';

/**
 * Tests for how the PostToolUse dispatcher decides to pass its input through.
 *
 * Run with: node tests/hooks/posttooluse-passthrough.test.js
 *
 * Passthrough used to be reachable only through ECC_POSTTOOLUSE_PASSTHROUGH=1.
 * The hook command now names the dispatcher directly, and there is no portable
 * way to set a per-command environment variable across cmd.exe and POSIX
 * shells, so the command carries a `--passthrough` argument instead. Two ways
 * in means two chances to diverge, so both are covered here independently,
 * along with the two conditions that must suppress passthrough whichever way
 * it was requested: a failed hook result and truncated input.
 */

const assert = require('assert');
const fs = require('fs');
const os = require('os');
const path = require('path');
const { spawnSync } = require('child_process');

const repoRoot = path.join(__dirname, '..', '..');
const dispatcherPath = path.join(repoRoot, 'scripts', 'hooks', 'posttooluse-dispatcher.js');
const { resolveMainStdout } = require(dispatcherPath);

let passed = 0;
let failed = 0;

function test(name, fn) {
  try {
    fn();
    console.log(`  ✓ ${name}`);
    passed += 1;
  } catch (error) {
    console.error(`  ✗ ${name}`);
    console.error(`    ${error.message}`);
    failed += 1;
  }
}

const CLEAN_RESULT = { stdout: '', exitCode: 0 };

// ---------------------------------------------------------------------------
// The decision itself
// ---------------------------------------------------------------------------

console.log('\nresolveMainStdout:');

test('passthrough requested, clean result, intact input -> echoes the raw event', () => {
  const raw = '{"tool_name":"Read"}';
  assert.strictEqual(resolveMainStdout(raw, CLEAN_RESULT, { passthrough: true, truncated: false }), raw);
});

test('passthrough not requested -> emits nothing', () => {
  assert.strictEqual(resolveMainStdout('{"tool_name":"Read"}', CLEAN_RESULT, { passthrough: false, truncated: false }), '');
});

test('truncated input suppresses passthrough', () => {
  // Echoing a half-read event would hand the harness malformed JSON.
  assert.strictEqual(resolveMainStdout('{"tool_name":"Re', CLEAN_RESULT, { passthrough: true, truncated: true }), '');
});

test('a failed hook result suppresses passthrough', () => {
  assert.strictEqual(resolveMainStdout('{"tool_name":"Read"}', { stdout: '', exitCode: 7 }, { passthrough: true, truncated: false }), '');
});

test('a hook that produced stdout wins over passthrough', () => {
  assert.strictEqual(resolveMainStdout('{"tool_name":"Read"}', { stdout: 'from-hook', exitCode: 0 }, { passthrough: true, truncated: false }), 'from-hook');
});

test('a hook that produced stdout is emitted even when passthrough is off', () => {
  assert.strictEqual(resolveMainStdout('{"tool_name":"Read"}', { stdout: 'from-hook', exitCode: 0 }, { passthrough: false, truncated: false }), 'from-hook');
});

// ---------------------------------------------------------------------------
// How passthrough gets requested, end to end
// ---------------------------------------------------------------------------

console.log('\nrequest mechanisms:');

const HOME_DIR = fs.mkdtempSync(path.join(os.tmpdir(), 'ecc-passthrough-home-'));

function runDispatcher(args, raw, extraEnv = {}) {
  const env = {
    ...process.env,
    CLAUDE_PLUGIN_ROOT: repoRoot,
    ECC_PLUGIN_ROOT: repoRoot,
    HOME: HOME_DIR,
    USERPROFILE: HOME_DIR,
    ECC_DRY_RUN: '1'
  };
  // Clear the ambient opt-in before applying the case's own overrides, so a
  // test asking for "neither mechanism" cannot be rescued by the developer's
  // shell, and a test asking for the env var still gets it.
  delete env.ECC_POSTTOOLUSE_PASSTHROUGH;
  Object.assign(env, extraEnv);
  for (const [name, value] of Object.entries(extraEnv)) {
    if (value === undefined) delete env[name];
  }

  return spawnSync(process.execPath, [dispatcherPath, ...args], {
    input: raw,
    encoding: 'utf8',
    cwd: repoRoot,
    env,
    timeout: 30000,
    maxBuffer: 16 * 1024 * 1024
  });
}

const EVENT = JSON.stringify({
  hook_event_name: 'PostToolUse',
  tool_name: 'Read',
  tool_input: {},
  tool_response: {}
});

test('--passthrough alone requests passthrough', () => {
  const result = runDispatcher(['sync', '--passthrough'], EVENT);
  assert.strictEqual(result.status, 0, result.stderr);
  assert.strictEqual(result.stdout, EVENT, `expected the raw event to be echoed, got ${JSON.stringify(result.stdout.slice(0, 120))}`);
});

test('ECC_POSTTOOLUSE_PASSTHROUGH=1 alone requests passthrough', () => {
  const result = runDispatcher(['sync'], EVENT, { ECC_POSTTOOLUSE_PASSTHROUGH: '1' });
  assert.strictEqual(result.status, 0, result.stderr);
  assert.strictEqual(result.stdout, EVENT, `expected the raw event to be echoed, got ${JSON.stringify(result.stdout.slice(0, 120))}`);
});

test('neither mechanism means no passthrough', () => {
  const result = runDispatcher(['sync'], EVENT);
  assert.strictEqual(result.status, 0, result.stderr);
  assert.strictEqual(result.stdout, '', `expected no stdout, got ${JSON.stringify(result.stdout.slice(0, 120))}`);
});

test('the async mode accepts --passthrough the same way', () => {
  const result = runDispatcher(['async', '--passthrough'], EVENT);
  assert.strictEqual(result.status, 0, result.stderr);
  assert.strictEqual(result.stdout, EVENT, `expected the raw event to be echoed, got ${JSON.stringify(result.stdout.slice(0, 120))}`);
});

test('truncated input suppresses passthrough however it was requested', () => {
  const oversized = JSON.stringify({
    hook_event_name: 'PostToolUse',
    tool_name: 'Read',
    tool_input: { value: 'x'.repeat(1024 * 1024 + 1024) },
    tool_response: {}
  });
  assert.ok(Buffer.byteLength(oversized, 'utf8') > 1024 * 1024);

  for (const [label, args, env] of [
    ['flag', ['sync', '--passthrough'], {}],
    ['env var', ['sync'], { ECC_POSTTOOLUSE_PASSTHROUGH: '1' }]
  ]) {
    const result = runDispatcher(args, oversized, env);
    assert.strictEqual(result.status, 0, `${label}: ${result.stderr}`);
    assert.strictEqual(result.stdout, '', `${label}: truncated input must not be echoed`);
    assert.ok(result.stderr.includes('stdin exceeded'), `${label}: truncation should be reported`);
  }
});

try {
  fs.rmSync(HOME_DIR, { recursive: true, force: true });
} catch (_) {
  // best effort
}

console.log(`\nResults: Passed: ${passed}, Failed: ${failed}`);
process.exit(failed > 0 ? 1 : 0);
