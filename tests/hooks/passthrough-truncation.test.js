/**
 * Regression tests for #2924: passthrough hooks must not emit truncated JSON.
 *
 * Two failure modes were fixed:
 *   Bug 1 - process.exit() without flushing stdout can drop buffered output
 *           when stdout is a pipe, truncating the pass-through payload.
 *   Bug 2 - MAX_STDIN cap cut `data` mid-string and the cut payload was echoed.
 *
 * The scripts under test are spawned exactly like Claude Code spawns them,
 * with stdout piped, so pipe-buffer truncation is observable via size mismatch
 * and via JSON.parse of the echoed output.
 */

const assert = require('assert');
const { spawnSync } = require('child_process');
const fs = require('fs');
const os = require('os');
const path = require('path');

const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'e2924-payload-'));

/**
 * Run a hook with the given stdin payload. Stdin is fed from a file fd so an
 * early-exiting child cannot EPIPE the parent (which happens with spawnSync
 * `input` strings larger than the child consumes).
 */
function runHook(hook, payload) {
  const payloadFile = path.join(tmpDir, `payload-${process.pid}-${Math.random().toString(36).slice(2)}.json`);
  fs.writeFileSync(payloadFile, payload, 'utf8');
  const fd = fs.openSync(payloadFile, 'r');
  try {
    return spawnSync('node', [path.join(__dirname, '..', '..', hook)], {
      encoding: 'utf8',
      timeout: 20000,
      stdio: [fd, 'pipe', 'pipe'],
    });
  } finally {
    fs.closeSync(fd);
    try { fs.unlinkSync(payloadFile); } catch (_) { /* best effort */ }
  }
}

const hooks = [
  'scripts/hooks/post-edit-typecheck.js',
  'scripts/hooks/post-edit-format.js',
  'scripts/hooks/post-edit-console-warn.js',
  'scripts/hooks/pre-write-doc-warn.js',
];

let passed = 0;
let failed = 0;

function test(name, fn) {
  try {
    fn();
    console.log(`  ✓ ${name}`);
    passed++;
  } catch (error) {
    console.log(`  ✗ ${name}`);
    console.log(`    Error: ${error.message}`);
    failed++;
  }
}

/**
 * Feed payload of the given size to the hook and assert the echoed stdout
 * round-trips: same bytes, valid JSON. Returns nothing; asserts internally.
 */
function assertPassthroughIntact(hook, size, label) {
  const payload = JSON.stringify({
    session_id: 'e2924-test',
    hook_event_name: 'Stop',
    tool_input: { file_path: '/tmp/does-not-exist-2924.ts' },
    pad: 'x'.repeat(size),
  });
  const result = spawnSync('node', [path.join(__dirname, '..', '..', hook)], {
    input: payload,
    encoding: 'utf8',
    timeout: 20000,
    stdio: ['pipe', 'pipe', 'pipe'],
  });
  assert.strictEqual(result.status, 0, `${hook} ${label}: exit 0`);
  assert.strictEqual(result.stdout.length, payload.length,
    `${hook} ${label}: echoed length must match input length`);
  let parsed;
  assert.doesNotThrow(() => { parsed = JSON.parse(result.stdout); },
    `${hook} ${label}: echoed output must be valid JSON`);
  assert.strictEqual(parsed.pad, 'x'.repeat(size),
    `${hook} ${label}: echoed payload must be intact`);
}

// Sizes chosen to cross both truncation points:
//  - 200 KB sits past the 64 KB pipe buffer (Bug 1)
//  - 2 MB exceeds the 1 MB MAX_STDIN cap (Bug 2) -> hook suppresses pass-through
const PROBE_SIZES = [
  [1000, '1KB'],
  [200000, '200KB'],
];

for (const hook of hooks) {
  for (const [size, label] of PROBE_SIZES) {
    test(`${path.basename(hook)} round-trips ${label} payload (no truncation)`, () => {
      assertPassthroughIntact(hook, size, `(${label})`);
    });
  }
}

// Over-MAX_STDIN payloads must NOT be echoed (invalid JSON would be emitted);
// the hook must exit cleanly and stay silent on stdout (fail-open suppression).
for (const hook of hooks) {
  test(`${path.basename(hook)} suppresses pass-through for 2MB payload (over MAX_STDIN)`, () => {
    const payload = JSON.stringify({
      session_id: 'e2924-test',
      hook_event_name: 'Stop',
      tool_input: { file_path: '/tmp/does-not-exist-2924.ts' },
      pad: 'x'.repeat(2000000),
    });
    const result = runHook(hook, payload);
    assert.strictEqual(result.status, 0, 'exit 0');
    assert.strictEqual(result.stdout, '', 'truncated payload must not be echoed');
    assert.ok(/exceeded 1MB/.test(result.stderr || ''), 'suppression must be logged to stderr');
  });
}

try { fs.rmSync(tmpDir, { recursive: true, force: true }); } catch (_) { /* best effort */ }

console.log(`\n  ${passed} passed, ${failed} failed\n`);
process.exit(failed > 0 ? 1 : 0);
