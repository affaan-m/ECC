/**
 * Regression tests for run-with-flags.js fallthrough behavior.
 *
 * #2222: >1MB stdin must fail open — before the fix, every fallthrough path
 * echoed the truncated payload to stdout, and the harness treated the
 * mid-stream-cut JSON as a hook failure, blocking large Edit/Write calls.
 *
 * Strict-output events (Stop/SubagentStop): the harness parses hook stdout
 * as hook-output JSON, so the passthrough convention is invalid there at any
 * payload size — a disabled or no-opinion Stop hook that echoed its stdin
 * surfaced as "invalid stop hook JSON output" on every turn stop. For those
 * events "no opinion" must be empty stdout; other events keep passthrough.
 */

'use strict';

const assert = require('assert');
const path = require('path');
const { spawnSync } = require('child_process');

const repoRoot = path.join(__dirname, '..', '..');
const runner = path.join(repoRoot, 'scripts', 'hooks', 'run-with-flags.js');

const MAX_STDIN = 1024 * 1024;

function test(name, fn) {
  try {
    fn();
    console.log(`  ✓ ${name}`);
    return true;
  } catch (error) {
    console.log(`  ✗ ${name}`);
    console.log(`    Error: ${error.message}`);
    return false;
  }
}

function runRunner(args, input, env = {}) {
  return spawnSync('node', [runner, ...args], {
    input,
    encoding: 'utf8',
    cwd: repoRoot,
    env: { ...process.env, ...env },
    timeout: 30000,
    maxBuffer: 16 * 1024 * 1024,
    stdio: ['pipe', 'pipe', 'pipe']
  });
}

function oversizedPayload() {
  // JSON document that exceeds MAX_STDIN so the runner's stdin cap trips.
  return JSON.stringify({
    tool_name: 'Write',
    tool_input: { file_path: '/tmp/big.md', content: 'x'.repeat(MAX_STDIN + 64 * 1024) }
  });
}

console.log('\nrun-with-flags truncation (fail-open) tests:');

let passed = 0;
let failed = 0;

if (
  test('oversized payload exits 0 with empty stdout for an enabled hook', () => {
    const result = runRunner(['pre:write:doc-file-warning', 'scripts/hooks/doc-file-warning.js', 'standard,strict'], oversizedPayload());
    assert.strictEqual(result.status, 0, `expected exit 0, got ${result.status}: ${result.stderr}`);
    assert.strictEqual(result.stdout, '', `stdout must be empty, got: ${result.stdout.slice(0, 120)}...`);
    assert.match(result.stderr, /stdin exceeded \d+ bytes for pre:write:doc-file-warning/);
    assert.match(result.stderr, /fail-open/);
  })
)
  passed++;
else failed++;

if (
  test('oversized payload never echoes truncated stdin when hook args are missing', () => {
    const result = runRunner([], oversizedPayload());
    assert.strictEqual(result.status, 0);
    assert.strictEqual(result.stdout, '', 'missing-args path must not echo truncated stdin');
  })
)
  passed++;
else failed++;

if (
  test('oversized payload never echoes truncated stdin for a disabled hook', () => {
    const result = runRunner(['pre:write:doc-file-warning', 'scripts/hooks/doc-file-warning.js', 'standard,strict'], oversizedPayload(), { ECC_DISABLED_HOOKS: 'pre:write:doc-file-warning' });
    assert.strictEqual(result.status, 0);
    assert.strictEqual(result.stdout, '', 'disabled-hook path must not echo truncated stdin');
  })
)
  passed++;
else failed++;

if (
  test('normal-sized payload still passes through unchanged', () => {
    const payload = JSON.stringify({
      tool_name: 'Write',
      tool_input: { file_path: '/tmp/small.js', content: 'const x = 1;\n' }
    });
    const result = runRunner(['pre:write:doc-file-warning', 'scripts/hooks/doc-file-warning.js', 'standard,strict'], payload);
    assert.strictEqual(result.status, 0, `expected exit 0, got ${result.status}: ${result.stderr}`);
    assert.ok(result.stdout.length > 0, 'normal payloads keep the pass-through behavior');
    JSON.parse(result.stdout); // stdout must remain valid JSON
  })
)
  passed++;
else failed++;

if (
  test('a hook with an opinion still emits its own stdout', () => {
    const payload = JSON.stringify({
      tool_name: 'Write',
      tool_input: { file_path: '/tmp/NOTES.md', content: 'scratch\n' }
    });
    const result = runRunner(['pre:write:doc-file-warning', 'scripts/hooks/doc-file-warning.js', 'standard,strict'], payload);
    assert.strictEqual(result.status, 0, `expected exit 0, got ${result.status}: ${result.stderr}`);
    assert.ok(result.stdout.length > 0, 'opinionated hook output must be forwarded');
    const parsed = JSON.parse(result.stdout);
    assert.ok(parsed.hookSpecificOutput, 'additionalContext output must survive as hook JSON');
  })
)
  passed++;
else failed++;

if (
  test('disabled Stop hook emits empty stdout, never the Stop payload', () => {
    // The exact live regression: a Stop event with the hook disabled used to
    // echo the input payload, which the harness rejected as
    // "invalid stop hook JSON output" on every turn stop.
    const payload = JSON.stringify({
      session_id: 'test-session',
      transcript_path: '/tmp/transcript.jsonl',
      hook_event_name: 'Stop',
      stop_hook_active: false
    });
    const result = runRunner(['stop:desktop-notify', 'scripts/hooks/desktop-notify.js', 'standard,strict'], payload, { ECC_DISABLED_HOOKS: 'stop:desktop-notify' });
    assert.strictEqual(result.status, 0, `expected exit 0, got ${result.status}: ${result.stderr}`);
    assert.strictEqual(result.stdout, '', 'disabled Stop hook must emit empty stdout');
  })
)
  passed++;
else failed++;

if (
  test('a security hook can still block on an oversized payload (no blanket skip)', () => {
    // config-protection refuses to fail open on truncated payloads. The
    // runner must still execute the hook and forward its verdict — only the
    // runner's own raw-echo is suppressed.
    const payload = JSON.stringify({
      tool_name: 'Write',
      tool_input: { file_path: '.eslintrc.js', content: 'x'.repeat(MAX_STDIN + 2048) }
    });
    const result = runRunner(['pre:config-protection', 'scripts/hooks/config-protection.js', 'standard,strict'], payload);
    assert.strictEqual(result.status, 2, `expected block exit 2, got ${result.status}: ${result.stderr}`);
    assert.strictEqual(result.stdout, '', 'blocked truncated payload must not echo raw input');
  })
)
  passed++;
else failed++;

if (
  test('payload just under the cap echoes through completely (no 64KB pipe cut)', () => {
    // process.exit() right after stdout.write() used to drop everything past
    // the ~64KB pipe buffer, cutting the echoed JSON mid-stream.
    const content = 'y'.repeat(MAX_STDIN - 1024);
    const payload = JSON.stringify({ tool_name: 'Write', tool_input: { file_path: '/tmp/edge.md', content } });
    assert.ok(payload.length < MAX_STDIN, 'fixture must stay under the stdin cap');
    const result = runRunner([], payload);
    assert.strictEqual(result.status, 0);
    assert.strictEqual(result.stdout.length, payload.length, 'echo must not be cut at the pipe buffer');
    assert.strictEqual(result.stdout, payload, 'sub-cap payloads still echo through fallthrough paths');
  })
)
  passed++;
else failed++;

if (
  test('disabled-hook passthrough of a >64KB payload stays valid JSON', () => {
    const payload = JSON.stringify({
      tool_name: 'Write',
      tool_input: { file_path: '/tmp/medium.md', content: 'z'.repeat(256 * 1024) }
    });
    const result = runRunner(['pre:write:doc-file-warning', 'scripts/hooks/doc-file-warning.js', 'standard,strict'], payload, { ECC_DISABLED_HOOKS: 'pre:write:doc-file-warning' });
    assert.strictEqual(result.status, 0);
    assert.strictEqual(result.stdout, payload);
    JSON.parse(result.stdout);
  })
)
  passed++;
else failed++;

// Strict-output events must suppress an *echo*, never a hook's own opinion.
// The runner distinguishes the two by byte-identity with the stdin payload, so
// this asserts the genuine-output side of that boundary on Stop/SubagentStop —
// the events where over-suppression would silently drop real hook JSON.
for (const event of ['Stop', 'SubagentStop']) {
  if (
    test(`a hook with an opinion still emits its own stdout on ${event}`, () => {
      const payload = JSON.stringify({
        hook_event_name: event,
        stop_hook_active: false,
        tool_name: 'Write',
        tool_input: { file_path: '/tmp/NOTES.md', content: 'scratch\n' }
      });
      const result = runRunner(['pre:write:doc-file-warning', 'scripts/hooks/doc-file-warning.js', 'standard,strict'], payload);
      assert.strictEqual(result.status, 0, `expected exit 0, got ${result.status}: ${result.stderr}`);
      assert.ok(result.stdout.length > 0, `opinionated hook output must survive on ${event}`);
      assert.notStrictEqual(result.stdout, payload, 'genuine output must not be the echoed payload');
      const parsed = JSON.parse(result.stdout);
      assert.ok(parsed.hookSpecificOutput, `valid hook JSON must remain unchanged on ${event}`);
    })
  )
    passed++;
  else failed++;

  if (
    test(`a no-opinion hook emits empty stdout on ${event}`, () => {
      // Same runner, same hook, a path the hook has no opinion about: the
      // fallthrough echo is what the harness rejects, so it must be empty.
      const payload = JSON.stringify({
        hook_event_name: event,
        stop_hook_active: false,
        tool_name: 'Write',
        tool_input: { file_path: '/tmp/src/index.ts', content: 'export {};\n' }
      });
      const result = runRunner(['pre:write:doc-file-warning', 'scripts/hooks/doc-file-warning.js', 'standard,strict'], payload);
      assert.strictEqual(result.status, 0, `expected exit 0, got ${result.status}: ${result.stderr}`);
      assert.strictEqual(result.stdout, '', `${event} no-opinion must be empty stdout, got: ${result.stdout.slice(0, 120)}`);
    })
  )
    passed++;
  else failed++;
}

console.log(`\n  ${passed} passed, ${failed} failed\n`);
process.exit(failed > 0 ? 1 : 0);
