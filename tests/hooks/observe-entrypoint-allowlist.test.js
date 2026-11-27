/**
 * Regression test for observe.sh Layer 1 entrypoint allowlist (#2102).
 *
 * The continuous-learning-v2 observe hook short-circuits with exit 0 when
 * CLAUDE_CODE_ENTRYPOINT is not in the allowlist. Before #2102 the allowlist
 * was {cli, sdk-ts, claude-desktop} and Claude Code's VS Code extension
 * (CLAUDE_CODE_ENTRYPOINT=claude-vscode) was silently dropped, so VS Code
 * users saw no observations recorded.
 *
 * This test pins the allowlist by spawning observe.sh under `bash -x` for
 * each entrypoint value and asserting that allowed entrypoints reach
 * Layer 2 (the ECC_HOOK_PROFILE check) while denied entrypoints stop at
 * Layer 1's `exit 0`. We force Layer 2 to short-circuit via
 * ECC_HOOK_PROFILE=minimal so the test is fast and side-effect-free
 * regardless of whether downstream layers find python3 / write state.
 *
 * Run with: node tests/hooks/observe-entrypoint-allowlist.test.js
 */

'use strict';

const assert = require('assert');
const fs = require('fs');
const os = require('os');
const path = require('path');
const { spawnSync } = require('child_process');

const repoRoot = path.resolve(__dirname, '..', '..');
const observeShPath = path.join(
  repoRoot,
  'skills',
  'continuous-learning-v2',
  'hooks',
  'observe.sh'
);

let passed = 0;
let failed = 0;

function test(name, fn) {
  try {
    fn();
    console.log(`  ✓ ${name}`);
    passed++;
  } catch (err) {
    console.log(`  ✗ ${name}`);
    console.log(`    Error: ${err.message}`);
    failed++;
  }
}

function makeTempHome() {
  return fs.mkdtempSync(path.join(os.tmpdir(), 'ecc-observe-allowlist-'));
}

function cleanup(dir) {
  try {
    fs.rmSync(dir, { recursive: true, force: true });
  } catch {
    // ignore
  }
}

/**
 * Spawn observe.sh under `bash -x` with a given CLAUDE_CODE_ENTRYPOINT.
 * Layer 2 is forced to short-circuit (ECC_HOOK_PROFILE=minimal) so the only
 * observable difference between an allowed entrypoint and a denied one is
 * whether the bash trace records the Layer 2 check at all.
 */
function runObserve(entrypoint) {
  const home = makeTempHome();
  try {
    const hookInput = JSON.stringify({
      tool_name: 'Read',
      tool_input: { file_path: '/tmp/test.txt' },
      session_id: 'allowlist-test-session',
      cwd: home
    });

    return spawnSync('bash', ['-x', observeShPath, 'post'], {
      input: hookInput,
      env: {
        ...process.env,
        HOME: home,
        CLAUDE_CODE_ENTRYPOINT: entrypoint,
        ECC_HOOK_PROFILE: 'minimal',
        ECC_SKIP_OBSERVE: '0',
        CLAUDE_PROJECT_DIR: home
      },
      timeout: 5000,
      encoding: 'utf8'
    });
  } finally {
    cleanup(home);
  }
}

// `bash -x` expands variables before printing trace lines. Layer 2's
// `[ "${ECC_HOOK_PROFILE:-standard}" = "minimal" ] && exit 0` therefore
// shows up as a literal `[ minimal = minimal ]` line on stderr, but only
// when Layer 1's case statement let the entrypoint pass through. We use
// that line as the discriminator between allowed and denied paths.
const LAYER2_TRACE_MARKER = "'[' minimal = minimal ']'";

function assertAllowedReachesLayer2(entrypoint) {
  const result = runObserve(entrypoint);
  assert.strictEqual(
    result.status,
    0,
    `observe.sh exit 0 expected for ${entrypoint}, got ${result.status}: ${result.stderr}`
  );
  assert.ok(
    result.stderr.includes(LAYER2_TRACE_MARKER),
    `entrypoint ${entrypoint} should reach Layer 2 (expected ${LAYER2_TRACE_MARKER} in trace); stderr tail: ${result.stderr.slice(-400)}`
  );
}

function assertDeniedStopsAtLayer1(entrypoint) {
  const result = runObserve(entrypoint);
  assert.strictEqual(
    result.status,
    0,
    `observe.sh exit 0 expected for ${entrypoint}, got ${result.status}: ${result.stderr}`
  );
  assert.ok(
    !result.stderr.includes(LAYER2_TRACE_MARKER),
    `entrypoint ${entrypoint} should stop at Layer 1 (Layer 2 marker ${LAYER2_TRACE_MARKER} should NOT appear); stderr tail: ${result.stderr.slice(-400)}`
  );
}

console.log('\n=== observe.sh Layer 1 entrypoint allowlist (#2102) ===\n');

const ALLOWED = ['cli', 'sdk-ts', 'claude-desktop', 'claude-vscode'];
const DENIED = ['unknown-host', 'claude-cody', 'mcp'];

for (const entry of ALLOWED) {
  test(`allowed entrypoint ${entry} reaches Layer 2`, () => {
    assertAllowedReachesLayer2(entry);
  });
}

for (const entry of DENIED) {
  test(`denied entrypoint ${entry} stops at Layer 1`, () => {
    assertDeniedStopsAtLayer1(entry);
  });
}

console.log(`\nPassed: ${passed}`);
console.log(`Failed: ${failed}`);
process.exit(failed > 0 ? 1 : 0);
