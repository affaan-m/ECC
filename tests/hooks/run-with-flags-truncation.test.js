/**
 * Regression tests for #2222: run-with-flags.js must fail open on >1MB stdin.
 *
 * Before the fix, every fallthrough path echoed the truncated payload to
 * stdout. The harness parses hook stdout as JSON, got a document cut
 * mid-stream, and treated the hook as failed — blocking every Edit/Write
 * whose hook payload exceeded the 1MB cap.
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

console.log(`\n  ${passed} passed, ${failed} failed\n`);
process.exit(failed > 0 ? 1 : 0);
