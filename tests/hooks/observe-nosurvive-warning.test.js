/**
 * Regression tests for silent observer non-survival in observe.sh (#2489)
 *
 * On native Windows (Git Bash / MSYS2) the lazy-started observer is reaped when
 * the hook process exits and its Job Object closes. start-observer.sh's own
 * liveness check runs inside that still-living process tree, so it always sees a
 * healthy observer and prints "Observer started (PID: N)". The next hook
 * invocation then found the dead PID, deleted the PID file via
 * _CHECK_OBSERVER_RUNNING, and restarted -- silently, once per tool call,
 * forever. Users were left with an observer-start.log full of success lines and
 * an observer that never completed a cycle.
 *
 * The fix records the "well-formed PID that is no longer alive" case, counts
 * consecutive non-survivals in ${PROJECT_DIR}/.observer-nosurvive-count, and
 * logs one explanatory warning when the streak reaches
 * ECC_OBSERVER_NOSURVIVE_WARN_AFTER (default 3). Finding the observer alive
 * resets the streak.
 *
 * These tests drive the real observe.sh through the sandbox harness established
 * by observe-signal-counter-race.test.js.
 *
 * Run with: node tests/hooks/observe-nosurvive-warning.test.js
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
  return fs.mkdtempSync(path.join(os.tmpdir(), 'ecc-nosurvive-'));
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

const STREAK_FILE = '.observer-nosurvive-count';
const WARN_MARKER = 'did not survive to the next hook invocation';

// Build a self-contained observe.sh sandbox (stub detect-project.sh +
// homunculus-dir.sh, SKILL_ROOT patched to the sandbox) with the observer
// enabled, so the lazy-start branch under test is reached.
function buildSandbox() {
  const testDir = createTempDir();
  const projectDir = path.join(testDir, 'project');
  fs.mkdirSync(projectDir, { recursive: true });

  const skillRoot = path.join(testDir, 'skill');
  const scriptsDir = path.join(skillRoot, 'scripts');
  const scriptsLibDir = path.join(scriptsDir, 'lib');
  const hooksDir = path.join(skillRoot, 'hooks');
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

  // HOME is set to projectDir when observe.sh runs, so CONFIG_DIR resolves
  // under it. The observer must read as enabled for the lazy-start block to run.
  const configDir = path.join(projectDir, '.local', 'share', 'ecc-homunculus');
  fs.mkdirSync(configDir, { recursive: true });
  fs.writeFileSync(
    path.join(configDir, 'config.json'),
    JSON.stringify({ observer: { enabled: true } })
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
  // no-op replace would leave the sandbox pointing at the real skill tree.
  assert.ok(
    observeContent.includes(skillRootMarker),
    'observe.sh SKILL_ROOT definition changed; update the sandbox rewrite'
  );
  observeContent = observeContent.replace(skillRootMarker, `SKILL_ROOT="${skillRoot}"`);
  const testObserve = path.join(hooksDir, 'observe.sh');
  fs.writeFileSync(testObserve, observeContent, { mode: 0o755 });

  return { testDir, projectDir, testObserve };
}

// Run observe.sh once against the sandbox. Resolves when the process exits.
function runObserve(testObserve, projectDir, extraEnv) {
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
        ...extraEnv
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

// A well-formed PID that is guaranteed not to be alive: spawn a trivial command
// and reuse its PID after it has exited. Matches the shape observe.sh validates
// (positive integer > 1), unlike a hardcoded sentinel.
function deadPid() {
  const result = spawnSync('true');
  assert.ok(result.pid > 1, 'expected a usable PID from the probe process');
  return result.pid;
}

function readStreak(projectDir) {
  const streakFile = path.join(projectDir, STREAK_FILE);
  if (!fs.existsSync(streakFile)) {
    return null;
  }
  return parseInt(fs.readFileSync(streakFile, 'utf8').trim(), 10);
}

function readStartLog(projectDir) {
  const logFile = path.join(projectDir, 'observer-start.log');
  return fs.existsSync(logFile) ? fs.readFileSync(logFile, 'utf8') : '';
}

console.log('\n=== observe.sh observer non-survival warning (#2489) ===\n');

test('observe.sh records non-survival when clearing a live-looking stale PID', () => {
  const content = fs.readFileSync(observeShPath, 'utf8');
  assert.ok(
    /OBSERVER_DIED=true/.test(content),
    'the stale-PID branch of _CHECK_OBSERVER_RUNNING should record the death'
  );
  assert.ok(
    content.includes('_NOTE_OBSERVER_NOSURVIVE') && content.includes('_RESET_OBSERVER_NOSURVIVE_STREAK'),
    'observe.sh should define both the streak counter and its reset'
  );
});

test('the non-survival warning is threshold-gated, not logged every call', () => {
  const content = fs.readFileSync(observeShPath, 'utf8');
  assert.ok(
    /ECC_OBSERVER_NOSURVIVE_WARN_AFTER/.test(content),
    'the threshold should be overridable via ECC_OBSERVER_NOSURVIVE_WARN_AFTER'
  );
  assert.ok(
    /\[ "\$streak" -eq "\$warn_after" \]/.test(content),
    'warning should fire on equality so it logs once per streak, not once per tool call'
  );
});

// A dead PID left behind by a reaped observer must produce an explanatory
// warning once the streak reaches the threshold.
async function runWarnsAtThreshold() {
  const { testDir, projectDir, testObserve } = buildSandbox();
  try {
    fs.writeFileSync(path.join(projectDir, '.observer.pid'), `${deadPid()}\n`);
    await runObserve(testObserve, projectDir, { ECC_OBSERVER_NOSURVIVE_WARN_AFTER: '1' });

    assert.strictEqual(readStreak(projectDir), 1, 'first non-survival should record a streak of 1');
    const log = readStartLog(projectDir);
    assert.ok(
      log.includes(WARN_MARKER),
      `observer-start.log should explain the non-survival, got: ${log.trim() || '(empty)'}`
    );
    assert.ok(
      log.includes('ECC_OBSERVER_NOSURVIVE_WARN_AFTER'),
      'the warning should name the threshold knob'
    );
  } finally {
    cleanupDir(testDir);
  }
}

// Below the threshold the streak advances but stays quiet -- this is what keeps
// the warning signal rather than one line per tool call.
async function runSilentBelowThreshold() {
  const { testDir, projectDir, testObserve } = buildSandbox();
  try {
    fs.writeFileSync(path.join(projectDir, '.observer.pid'), `${deadPid()}\n`);
    await runObserve(testObserve, projectDir, { ECC_OBSERVER_NOSURVIVE_WARN_AFTER: '3' });

    assert.strictEqual(readStreak(projectDir), 1, 'streak should advance to 1');
    assert.ok(
      !readStartLog(projectDir).includes(WARN_MARKER),
      'no warning should be logged before the streak reaches the threshold'
    );

    // Second non-survival: still below a threshold of 3.
    fs.writeFileSync(path.join(projectDir, '.observer.pid'), `${deadPid()}\n`);
    await runObserve(testObserve, projectDir, { ECC_OBSERVER_NOSURVIVE_WARN_AFTER: '3' });

    assert.strictEqual(readStreak(projectDir), 2, 'streak should advance to 2');
    assert.ok(
      !readStartLog(projectDir).includes(WARN_MARKER),
      'still no warning at streak 2 with a threshold of 3'
    );
  } finally {
    cleanupDir(testDir);
  }
}

// A healthy observer clears the streak, so an unrelated one-off crash later on
// does not inherit an old count and warn spuriously.
async function runResetWhenAlive() {
  const { testDir, projectDir, testObserve } = buildSandbox();
  try {
    fs.writeFileSync(path.join(projectDir, '.observer.pid'), `${deadPid()}\n`);
    await runObserve(testObserve, projectDir, { ECC_OBSERVER_NOSURVIVE_WARN_AFTER: '3' });
    assert.strictEqual(readStreak(projectDir), 1, 'streak should be seeded by the dead observer');

    // The test runner itself is a PID that is certainly alive.
    fs.writeFileSync(path.join(projectDir, '.observer.pid'), `${process.pid}\n`);
    await runObserve(testObserve, projectDir, { ECC_OBSERVER_NOSURVIVE_WARN_AFTER: '3' });

    assert.strictEqual(
      readStreak(projectDir),
      null,
      'finding the observer alive should clear the non-survival streak'
    );
  } finally {
    cleanupDir(testDir);
  }
}

(async () => {
  if (!isWindows && hasPython) {
    await asyncTest('warns in observer-start.log once the streak reaches the threshold', runWarnsAtThreshold);
    await asyncTest('stays silent while the streak is below the threshold', runSilentBelowThreshold);
    await asyncTest('a live observer resets the non-survival streak', runResetWhenAlive);
  } else {
    console.log('  - skipping shell-execution tests (requires non-Windows + python3)');
  }

  console.log('\n=== Test Results ===');
  console.log(`Passed: ${passed}`);
  console.log(`Failed: ${failed}`);
  console.log(`Total:  ${passed + failed}`);

  process.exit(failed > 0 ? 1 : 0);
})();
