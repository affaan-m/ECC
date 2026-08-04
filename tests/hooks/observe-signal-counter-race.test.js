/**
 * Regression tests for the SIGUSR1 throttle-counter race in observe.sh (#2296)
 *
 * observe.sh runs on every tool call and bumps a throttle counter in
 * ${PROJECT_DIR}/.observer-signal-counter so the observer is signaled only
 * every N observations (#521). The bump used a plain read-modify-write with no
 * locking, so concurrent hook invocations could read the same value, both
 * increment, and lose a write — the observer then fired at unpredictable
 * intervals. The fix serializes the read-modify-write with an atomic mkdir
 * lock.
 *
 * These tests drive the real observe.sh (reusing the stub harness from
 * observer-memory.test.js) and assert the lock's invariant: with the reset
 * threshold set high enough that no reset fires, the final counter must equal
 * the number of invocations — i.e. no increment is ever lost, even under heavy
 * concurrency.
 *
 * Run with: node tests/hooks/observe-signal-counter-race.test.js
 */

const assert = require('assert');
const path = require('path');
const fs = require('fs');
const os = require('os');
const { spawn, spawnSync } = require('child_process');

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

async function asyncTest(name, fn) {
  try {
    await fn();
    console.log(`  ✓ ${name}`);
    passed++;
  } catch (err) {
    console.log(`  ✗ ${name}`);
    console.log(`    Error: ${err.message}`);
    failed++;
  }
}

function createTempDir() {
  return fs.mkdtempSync(path.join(os.tmpdir(), 'ecc-signal-race-'));
}

function cleanupDir(dir) {
  try {
    fs.rmSync(dir, { recursive: true, force: true });
  } catch {
    // ignore cleanup errors
  }
}

const repoRoot = path.resolve(__dirname, '..', '..');
const observeShPath = path.join(repoRoot, 'skills', 'continuous-learning-v2', 'hooks', 'observe.sh');

const isWindows = process.platform === 'win32';
const hasPython = !isWindows && spawnSync('python3', ['--version']).status === 0;
// When the runner has flock the lock is exact (blocking, kernel auto-release);
// without it observe.sh uses a best-effort mkdir spin that may drop at most one
// increment under pathological contention.
const hasFlock = !isWindows && spawnSync('bash', ['-c', 'command -v flock']).status === 0;

// Build a self-contained observe.sh sandbox (stub detect-project.sh +
// homunculus-dir.sh, SKILL_ROOT patched to the sandbox) and return its paths.
function buildSandbox() {
  const testDir = createTempDir();
  const projectDir = path.join(testDir, 'project');
  fs.mkdirSync(projectDir, { recursive: true });

  const skillRoot = path.join(testDir, 'skill');
  const scriptsDir = path.join(skillRoot, 'scripts');
  const scriptsLibDir = path.join(scriptsDir, 'lib');
  const hooksDir = path.join(skillRoot, 'hooks');
  fs.mkdirSync(scriptsDir, { recursive: true });
  fs.mkdirSync(scriptsLibDir, { recursive: true });
  fs.mkdirSync(hooksDir, { recursive: true });

  fs.writeFileSync(
    path.join(scriptsDir, 'detect-project.sh'),
    [
      '#!/bin/bash',
      'PROJECT_ID="test-project"',
      'PROJECT_NAME="test-project"',
      `PROJECT_ROOT="${projectDir}"`,
      `PROJECT_DIR="${projectDir}"`,
      'CLV2_PYTHON_CMD="python3"',
      ''
    ].join('\n')
  );
  fs.writeFileSync(
    path.join(scriptsLibDir, 'homunculus-dir.sh'),
    [
      '#!/bin/bash',
      '_clv2_resolve_homunculus_dir() { printf "%s\\n" "$HOME/.local/share/ecc-homunculus"; }',
      ''
    ].join('\n')
  );

  let observeContent = fs.readFileSync(observeShPath, 'utf8');
  const skillRootMarker = 'SKILL_ROOT="$(cd "$SCRIPT_DIR/.." && pwd)"';
  // Fail fast if observe.sh's SKILL_ROOT definition drifts; otherwise the
  // no-op replace would leave the sandbox pointing at the real skill tree and
  // the test could pass spuriously.
  assert.ok(
    observeContent.includes(skillRootMarker),
    'observe.sh SKILL_ROOT definition changed; update the sandbox rewrite'
  );
  observeContent = observeContent.replace(
    skillRootMarker,
    `SKILL_ROOT="${skillRoot}"`
  );
  const testObserve = path.join(hooksDir, 'observe.sh');
  fs.writeFileSync(testObserve, observeContent, { mode: 0o755 });

  return { testDir, projectDir, testObserve };
}

// Run observe.sh once against the sandbox. Resolves when the process exits.
function runObserve(testObserve, projectDir) {
  const input = JSON.stringify({
    tool_name: 'Read',
    tool_input: { file_path: '/tmp/test.txt' },
    session_id: 'test-session',
    cwd: projectDir
  });
  return new Promise((resolve, reject) => {
    const child = spawn('bash', [testObserve, 'post'], {
      env: {
        ...process.env,
        HOME: projectDir,
        CLAUDE_CODE_ENTRYPOINT: 'cli',
        ECC_HOOK_PROFILE: 'standard',
        ECC_SKIP_OBSERVE: '0',
        CLAUDE_PROJECT_DIR: projectDir,
        // Reset threshold far above the invocation count, so no reset fires and
        // the final counter equals the number of invocations.
        ECC_OBSERVER_SIGNAL_EVERY_N: '100000'
      },
      stdio: ['pipe', 'ignore', 'pipe']
    });
    let stderr = '';
    // Fail the test on a hung hook rather than waiting forever.
    const timer = setTimeout(() => {
      child.kill('SIGKILL');
      reject(new Error('observe.sh timed out'));
    }, 20000);
    child.stderr.on('data', (chunk) => { stderr += chunk; });
    // A broken observe.sh must fail the test, not be silently swallowed.
    child.on('close', (code, signal) => {
      clearTimeout(timer);
      if (code === 0 && signal === null) {
        resolve();
      } else {
        reject(new Error(`observe.sh failed code=${code} signal=${signal}: ${stderr.trim()}`));
      }
    });
    child.on('error', (err) => {
      clearTimeout(timer);
      reject(err);
    });
    child.stdin.end(input);
  });
}

function readCounter(projectDir) {
  const counterFile = path.join(projectDir, '.observer-signal-counter');
  if (!fs.existsSync(counterFile)) {
    return null;
  }
  return parseInt(fs.readFileSync(counterFile, 'utf8').trim(), 10);
}

console.log('\n=== observe.sh signal-counter race regression (#2296) ===\n');

test('observe.sh uses a lock around the throttle-counter update', () => {
  const content = fs.readFileSync(observeShPath, 'utf8');
  assert.ok(
    content.includes('SIGNAL_COUNTER_LOCK'),
    'observe.sh should define a lock for the signal counter'
  );
  assert.ok(
    /flock 8\b/.test(content) || /mkdir "\$SIGNAL_COUNTER_LOCK"/.test(content),
    'observe.sh should acquire the counter lock via flock or an atomic mkdir'
  );
});

test('observe.sh guards against a corrupt (non-integer) counter file', () => {
  const content = fs.readFileSync(observeShPath, 'utf8');
  assert.ok(
    /''\|\*\[!0-9\]\*\) counter=0/.test(content),
    'observe.sh should reset a non-integer counter to 0 before incrementing'
  );
});

async function runSequential() {
  const { testDir, projectDir, testObserve } = buildSandbox();
  try {
    const N = 5;
    for (let i = 0; i < N; i++) {
      await runObserve(testObserve, projectDir);
    }
    const counter = readCounter(projectDir);
    assert.notStrictEqual(counter, null, 'counter file should exist after runs');
    assert.strictEqual(counter, N, `sequential counter should be ${N}, got ${counter}`);
  } finally {
    cleanupDir(testDir);
  }
}

async function runConcurrent() {
  const { testDir, projectDir, testObserve } = buildSandbox();
  try {
    const K = 20;
    // Spawn all K before awaiting any, so they genuinely contend on the counter.
    const runs = [];
    for (let i = 0; i < K; i++) {
      runs.push(runObserve(testObserve, projectDir));
    }
    await Promise.all(runs);
    const counter = readCounter(projectDir);
    assert.notStrictEqual(counter, null, 'counter file should exist after concurrent runs');
    if (hasFlock) {
      // flock serializes every invocation, so no increment is ever lost. The
      // pre-fix unlocked code drops increments under this same contention.
      assert.strictEqual(
        counter,
        K,
        `with flock the counter must be exactly ${K}, got ${counter}`
      );
    } else {
      // mkdir fallback is best-effort: it may drop at most one increment if its
      // bounded spin is exhausted, but never the multi-increment loss the
      // unlocked code exhibited.
      assert.ok(
        counter >= K - 1,
        `mkdir fallback should keep the counter >= ${K - 1}, got ${counter}`
      );
    }
  } finally {
    cleanupDir(testDir);
  }
}

(async () => {
  if (!isWindows && hasPython) {
    await asyncTest('sequential invocations increment the counter exactly once each', runSequential);
    await asyncTest('concurrent invocations never lose a counter increment', runConcurrent);
  } else {
    console.log('  - skipping shell-execution tests (requires non-Windows + python3)');
  }

  console.log('\n=== Test Results ===');
  console.log(`Passed: ${passed}`);
  console.log(`Failed: ${failed}`);
  console.log(`Total:  ${passed + failed}`);

  process.exit(failed > 0 ? 1 : 0);
})();
