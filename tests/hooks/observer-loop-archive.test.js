/**
 * Tests for observer-loop archive-on-failure fix (#2370)
 *
 * Bug: analyze_observations() in observer-loop.sh moved the live
 * observations.jsonl into observations.archive/ unconditionally, even when
 * the Claude analysis step failed (timeout, non-zero exit, rate limit).
 * Because the analyzer only ever reads the live file, a failed batch could
 * never be re-analyzed and its instincts were silently lost.
 *
 * Fix: archive only after a successful analysis; on failure log and return,
 * retaining observations for the next cycle to retry.
 *
 * Strategy: source observer-loop.sh (a BASH_SOURCE guard stops the main
 * loop from running when sourced) and drive analyze_observations directly
 * with a stub `claude` (exit code controlled per case) and a stub sibling
 * session-guardian.sh. Assert symmetric outcomes for failure vs success.
 *
 * Run with: node tests/hooks/observer-loop-archive.test.js
 */

const assert = require('assert');
const path = require('path');
const fs = require('fs');
const os = require('os');
const { spawnSync } = require('child_process');

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

function createTempDir() {
  return fs.mkdtempSync(path.join(os.tmpdir(), 'ecc-observer-archive-'));
}

function cleanupDir(dir) {
  try {
    fs.rmSync(dir, { recursive: true, force: true });
  } catch {
    // ignore cleanup errors
  }
}

const repoRoot = path.resolve(__dirname, '..', '..');
const observerLoopPath = path.join(
  repoRoot, 'skills', 'continuous-learning-v2', 'agents', 'observer-loop.sh'
);

/**
 * Run analyze_observations once with the given stub claude exit code.
 * Returns { liveExists, archivedCount, log } describing the resulting state.
 */
function runAnalyzeOnce(claudeExitCode) {
  const sandbox = createTempDir();
  try {
    const binDir = path.join(sandbox, 'bin');
    const projectDir = path.join(sandbox, 'project');
    fs.mkdirSync(binDir, { recursive: true });
    fs.mkdirSync(projectDir, { recursive: true });

    // Stub claude: exit with the requested code, ignoring all args.
    const claudeStub = path.join(binDir, 'claude');
    fs.writeFileSync(claudeStub, '#!/usr/bin/env bash\nexit ${CLAUDE_STUB_EXIT:-0}\n');
    fs.chmodSync(claudeStub, 0o755);

    // analyze_observations resolves the real session-guardian.sh via its own
    // ${BASH_SOURCE[0]}-derived SCRIPT_DIR, so we drive the real guardian with
    // all of its gates disabled/isolated (see env below) rather than stubbing it.

    // Driver sources observer-loop.sh (guard stops the main loop) then runs
    // the single function under test.
    const driver = path.join(sandbox, 'driver.sh');
    fs.writeFileSync(
      driver,
      `#!/usr/bin/env bash\nsource ${JSON.stringify(observerLoopPath)}\nanalyze_observations\n`
    );
    fs.chmodSync(driver, 0o755);

    const observationsFile = path.join(projectDir, 'observations.jsonl');
    fs.writeFileSync(observationsFile, '{"a":1}\n{"a":2}\n{"a":3}\n');

    // Defensive: never leak CLAUDE_PLUGIN_ROOT into the ECC test shell (it
    // contaminates this project's hook-root resolution).
    const childEnv = Object.assign({}, process.env);
    delete childEnv.CLAUDE_PLUGIN_ROOT;
    childEnv.PATH = binDir + path.delimiter + process.env.PATH;
    childEnv.CLAUDE_STUB_EXIT = String(claudeExitCode);
    childEnv.OBSERVATIONS_FILE = observationsFile;
    childEnv.MIN_OBSERVATIONS = '1';
    childEnv.PROJECT_DIR = projectDir;
    childEnv.LOG_FILE = path.join(projectDir, 'observer.log');
    childEnv.PROJECT_NAME = 'test-project';
    childEnv.PROJECT_ID = 'test-project';
    childEnv.INSTINCTS_DIR = path.join(projectDir, 'instincts');
    childEnv.CONFIG_DIR = projectDir;
    childEnv.CLV2_IS_WINDOWS = 'false';
    childEnv.ECC_OBSERVER_TIMEOUT_SECONDS = '2';
    // Make the real session-guardian.sh deterministically proceed (exit 0):
    // disable the active-hours and idle gates, isolate the cooldown log, and
    // zero the cooldown interval so a fresh project always passes.
    childEnv.OBSERVER_ACTIVE_HOURS_START = '0';
    childEnv.OBSERVER_ACTIVE_HOURS_END = '0';
    childEnv.OBSERVER_MAX_IDLE_SECONDS = '0';
    childEnv.OBSERVER_INTERVAL_SECONDS = '0';
    childEnv.OBSERVER_LAST_RUN_LOG = path.join(projectDir, 'observer-last-run.log');

    const result = spawnSync('bash', [driver], {
      encoding: 'utf8',
      timeout: 15000,
      env: childEnv
    });

    assert.strictEqual(
      result.status, 0,
      `driver should exit 0, got ${result.status}; stderr: ${result.stderr}`
    );

    const archiveDir = path.join(projectDir, 'observations.archive');
    let archivedCount = 0;
    if (fs.existsSync(archiveDir)) {
      archivedCount = fs.readdirSync(archiveDir)
        .filter(f => /^processed-.*\.jsonl$/.test(f)).length;
    }
    let log = '';
    try { log = fs.readFileSync(childEnv.LOG_FILE, 'utf8'); } catch { /* none */ }

    return { liveExists: fs.existsSync(observationsFile), archivedCount, log };
  } finally {
    cleanupDir(sandbox);
  }
}

console.log('\n=== Observer-loop Archive-on-Failure Tests (#2370) ===\n');

console.log('--- behavioral ---');

test('failed analysis retains observations and archives nothing', () => {
  // Shell-driven behavioral check; skip on Windows where the bash driver's
  // $0 path handling differs (matches observer-memory.test.js convention).
  if (process.platform === 'win32') {
    return;
  }
  const { liveExists, archivedCount, log } = runAnalyzeOnce(1);
  assert.ok(liveExists, 'live observations.jsonl must be retained when analysis fails');
  assert.strictEqual(archivedCount, 0, 'nothing should be archived when analysis fails');
  assert.ok(
    /retaining observations for retry/.test(log),
    `failure log should note retention; got: ${log}`
  );
});

test('successful analysis archives the batch (happy path preserved)', () => {
  // Shell-driven behavioral check; skip on Windows (see note above).
  if (process.platform === 'win32') {
    return;
  }
  const { liveExists, archivedCount } = runAnalyzeOnce(0);
  assert.ok(!liveExists, 'live observations.jsonl should be moved after a successful analysis');
  assert.strictEqual(archivedCount, 1, 'exactly one processed-*.jsonl should be archived on success');
});

console.log('--- static guards ---');

test('analyze_observations returns on failure before the archive mv', () => {
  const content = fs.readFileSync(observerLoopPath, 'utf8');
  // Operate on full file content with explicit anchors rather than a lazy
  // function-body extraction (which could truncate on a future inner "\n}"
  // and pass vacuously). These tokens each occur once, inside the function.
  const failIdx = content.search(/exit_code"?\s+-ne\s+0/);
  const returnIdx = content.indexOf('return', failIdx);
  const archiveIdx = content.indexOf('observations.archive');
  assert.ok(failIdx !== -1, 'should find the non-zero exit_code check');
  assert.ok(archiveIdx !== -1, 'should find the archive block');
  assert.ok(returnIdx !== -1, 'failure branch should contain a return');
  assert.ok(returnIdx < archiveIdx,
    'failure branch must return before reaching the archive block');
});

test('observer-loop.sh has a source-guard so it can be sourced in tests', () => {
  const content = fs.readFileSync(observerLoopPath, 'utf8');
  assert.ok(
    content.includes('BASH_SOURCE[0]') && content.includes('return 0 2>/dev/null'),
    'observer-loop.sh should short-circuit when sourced rather than executed'
  );
});

console.log('\n=== Test Results ===');
console.log(`Passed: ${passed}`);
console.log(`Failed: ${failed}`);
console.log(`Total:  ${passed + failed}\n`);

process.exit(failed > 0 ? 1 : 0);
