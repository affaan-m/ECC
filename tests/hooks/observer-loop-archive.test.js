/**
 * Tests for observer-loop archive-on-failure fixes (#2370, #2673).
 *
 * A batch may be archived only when the Claude process exits successfully and
 * its current stdout contains one exact completion record as the final
 * non-empty line. Process failures, semantic failures, stderr/log markers,
 * duplicate markers, and tampering with the result path must fail closed.
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
let skipped = 0;
const SKIP = Symbol('skip');

function test(name, fn) {
  try {
    fn();
    console.log(`  ✓ ${name}`);
    passed++;
  } catch (err) {
    if (err === SKIP) {
      console.log(`  - ${name} (skipped: requires bash fixture)`);
      skipped++;
      return;
    }
    console.log(`  ✗ ${name}`);
    console.log(`    Error: ${err.message}`);
    failed++;
  }
}

function skipOnWindows() {
  if (process.platform === 'win32') {
    throw SKIP;
  }
}

function createTempDir() {
  return fs.mkdtempSync(path.join(os.tmpdir(), 'ecc-observer-archive-'));
}

function cleanupDir(dir) {
  try {
    fs.rmSync(dir, { recursive: true, force: true });
  } catch {
    // Ignore cleanup errors in an already-isolated test directory.
  }
}

function processExists(pid) {
  if (!Number.isInteger(pid) || pid <= 0) return false;
  try {
    process.kill(pid, 0);
    return true;
  } catch {
    return false;
  }
}

const repoRoot = path.resolve(__dirname, '..', '..');
const observerLoopPath = path.join(
  repoRoot, 'skills', 'continuous-learning-v2', 'agents', 'observer-loop.sh'
);
const ANALYSIS_COMPLETE_RECORD = '{"status":"analysis_complete"}';
const ORIGINAL_OBSERVATIONS = '{"a":1}\n{"a":2}\n{"a":3}\n';

/**
 * Source observer-loop.sh in a sandbox and invoke analyze_observations once.
 */
function runAnalyzeOnce(options = {}) {
  const {
    claudeExitCode = 0,
    claudeOutput = '',
    claudeStderr = '',
    claudeDelaySeconds = 0,
    claudeIgnoreTerm = false,
    claudeSpawnChild = false,
    existingLog = '',
    observerTimeoutSeconds = 10,
    probeResultPath = false,
  } = options;
  const sandbox = createTempDir();

  try {
    const binDir = path.join(sandbox, 'bin');
    const projectDir = path.join(sandbox, 'project');
    const observerFixtureDir = path.join(sandbox, 'observer');
    fs.mkdirSync(binDir, { recursive: true });
    fs.mkdirSync(projectDir, { recursive: true });
    fs.mkdirSync(observerFixtureDir, { recursive: true });

    const claudeStub = path.join(binDir, 'claude');
    fs.writeFileSync(claudeStub, [
      '#!/usr/bin/env bash',
      "printf '%s\n' \"$$\" > \"${CLAUDE_STUB_PID_FILE}\"",
      "if [ \"${CLAUDE_STUB_IGNORE_TERM:-false}\" = \"true\" ]; then trap '' TERM; fi",
      'if [ "${CLAUDE_STUB_SPAWN_CHILD:-false}" = "true" ]; then',
      '  sleep "${CLAUDE_STUB_DELAY_SECONDS:-10}" &',
      "  printf '%s\n' \"$!\" > \"${CLAUDE_STUB_CHILD_PID_FILE}\"",
      '  wait',
      'fi',
      'if [ "${CLAUDE_STUB_PROBE_RESULT_PATH:-false}" = "true" ]; then',
      '  for candidate in "${PROJECT_DIR}"/.observer-tmp/ecc-observer-result.*; do',
      '    [ -e "$candidate" ] || [ -L "$candidate" ] || continue',
      "    printf 'found\n' > \"${CLAUDE_STUB_ATTACK_FILE}\"",
      '    rm -f "$candidate"',
      `    printf '%s\n' '${ANALYSIS_COMPLETE_RECORD}' > "$candidate"`,
      '  done',
      'fi',
      'if [ "${CLAUDE_STUB_DELAY_SECONDS:-0}" != "0" ]; then',
      '  sleep "${CLAUDE_STUB_DELAY_SECONDS}"',
      'fi',
      "printf '%s' \"${CLAUDE_STUB_OUTPUT:-}\"",
      "printf '%s' \"${CLAUDE_STUB_STDERR:-}\" >&2",
      'exit "${CLAUDE_STUB_EXIT:-0}"',
      '',
    ].join('\n'));
    fs.chmodSync(claudeStub, 0o755);

    // Source a sandbox copy so the sibling guardian is deterministic.
    const observerFixture = path.join(observerFixtureDir, 'observer-loop.sh');
    const guardianStub = path.join(observerFixtureDir, 'session-guardian.sh');
    fs.copyFileSync(observerLoopPath, observerFixture);
    fs.writeFileSync(guardianStub, '#!/usr/bin/env bash\nexit 0\n');
    fs.chmodSync(guardianStub, 0o755);

    const driver = path.join(sandbox, 'driver.sh');
    fs.writeFileSync(
      driver,
      `#!/usr/bin/env bash\nsource ${JSON.stringify(observerFixture)}\nanalyze_observations\n`
    );
    fs.chmodSync(driver, 0o755);

    const observationsFile = path.join(projectDir, 'observations.jsonl');
    const logFile = path.join(projectDir, 'observer.log');
    const claudePidFile = path.join(projectDir, 'claude-stub.pid');
    const claudeChildPidFile = path.join(projectDir, 'claude-stub-child.pid');
    const attackFile = path.join(projectDir, 'result-path-attack-found');
    fs.writeFileSync(observationsFile, ORIGINAL_OBSERVATIONS);
    if (existingLog) fs.writeFileSync(logFile, existingLog);

    const inheritedEnv = Object.fromEntries(
      Object.entries(process.env).filter(
        ([key]) => key !== 'CLAUDE_PLUGIN_ROOT' && !key.startsWith('ECC_OBSERVER_')
      )
    );
    const childEnv = {
      ...inheritedEnv,
      PATH: binDir + path.delimiter + process.env.PATH,
      CLAUDE_STUB_EXIT: String(claudeExitCode),
      CLAUDE_STUB_OUTPUT: claudeOutput,
      CLAUDE_STUB_STDERR: claudeStderr,
      CLAUDE_STUB_DELAY_SECONDS: String(claudeDelaySeconds),
      CLAUDE_STUB_IGNORE_TERM: String(claudeIgnoreTerm),
      CLAUDE_STUB_SPAWN_CHILD: String(claudeSpawnChild),
      CLAUDE_STUB_PROBE_RESULT_PATH: String(probeResultPath),
      CLAUDE_STUB_PID_FILE: claudePidFile,
      CLAUDE_STUB_CHILD_PID_FILE: claudeChildPidFile,
      CLAUDE_STUB_ATTACK_FILE: attackFile,
      OBSERVATIONS_FILE: observationsFile,
      MIN_OBSERVATIONS: '1',
      PROJECT_DIR: projectDir,
      LOG_FILE: logFile,
      PROJECT_NAME: 'test-project',
      PROJECT_ID: 'test-project',
      INSTINCTS_DIR: path.join(projectDir, 'instincts'),
      CONFIG_DIR: projectDir,
      CLV2_IS_WINDOWS: 'false',
      ECC_OBSERVER_TIMEOUT_SECONDS: String(observerTimeoutSeconds),
      ECC_OBSERVER_MAX_ANALYSIS_LINES: '500',
      ECC_OBSERVER_MAX_TURNS: '20',
      ECC_OBSERVER_MODEL: 'haiku',
      ECC_OBSERVER_ALLOW_WINDOWS: 'false',
    };

    const startedAt = Date.now();
    const result = spawnSync('bash', [driver], {
      encoding: 'utf8',
      timeout: 15000,
      env: childEnv,
    });
    const durationMs = Date.now() - startedAt;

    assert.ifError(result.error);
    assert.strictEqual(
      result.status,
      0,
      `driver should exit 0, got ${result.status}; stderr: ${result.stderr}`
    );

    const archiveDir = path.join(projectDir, 'observations.archive');
    const archivedContents = fs.existsSync(archiveDir)
      ? fs.readdirSync(archiveDir)
        .filter(file => /^processed-.*\.jsonl$/.test(file))
        .sort()
        .map(file => fs.readFileSync(path.join(archiveDir, file), 'utf8'))
      : [];
    const liveContent = fs.existsSync(observationsFile)
      ? fs.readFileSync(observationsFile, 'utf8')
      : null;
    const log = fs.existsSync(logFile) ? fs.readFileSync(logFile, 'utf8') : '';
    const observerTempDir = path.join(projectDir, '.observer-tmp');
    const tempEntries = fs.existsSync(observerTempDir)
      ? fs.readdirSync(observerTempDir)
      : [];
    const claudePid = fs.existsSync(claudePidFile)
      ? Number(fs.readFileSync(claudePidFile, 'utf8').trim())
      : null;
    const claudeChildPid = fs.existsSync(claudeChildPidFile)
      ? Number(fs.readFileSync(claudeChildPidFile, 'utf8').trim())
      : null;

    return {
      archivedContents,
      attackFound: fs.existsSync(attackFile),
      claudeStillRunning: processExists(claudePid),
      claudeChildStillRunning: processExists(claudeChildPid),
      durationMs,
      liveContent,
      log,
      tempEntries,
    };
  } finally {
    cleanupDir(sandbox);
  }
}

function assertOriginalBatchIsRetryable(state) {
  assert.strictEqual(
    state.liveContent,
    ORIGINAL_OBSERVATIONS,
    'the live batch must remain byte-for-byte intact for retry'
  );
  assert.deepStrictEqual(state.archivedContents, []);
}

console.log('\n=== Observer-loop Archive-on-Failure Tests (#2370, #2673) ===\n');
console.log('--- behavioral ---');

test('failed analysis retains observations and archives nothing', () => {
  skipOnWindows();
  const state = runAnalyzeOnce({
    claudeExitCode: 1,
    claudeOutput: `${ANALYSIS_COMPLETE_RECORD}\n`,
  });
  assertOriginalBatchIsRetryable(state);
  assert.match(state.log, /retaining observations for retry/);
  assert.deepStrictEqual(state.tempEntries, []);
});

test('zero-exit analysis without a completion record retains observations', () => {
  skipOnWindows();
  const state = runAnalyzeOnce({
    claudeOutput: 'Analysis blocked because the sampled file was not found.\n',
  });
  assertOriginalBatchIsRetryable(state);
  assert.match(state.log, /completion record missing.*retaining observations for retry/i);
  assert.deepStrictEqual(state.tempEntries, []);
});

test('mentioning the completion record in prose does not authorize archival', () => {
  skipOnWindows();
  const state = runAnalyzeOnce({
    claudeOutput: `I would emit ${ANALYSIS_COMPLETE_RECORD} after analysis, but the read failed.\n`,
  });
  assertOriginalBatchIsRetryable(state);
});

test('completion record followed by failure text does not authorize archival', () => {
  skipOnWindows();
  const state = runAnalyzeOnce({
    claudeOutput: `${ANALYSIS_COMPLETE_RECORD}\nLater failure: instinct write did not complete.\n`,
  });
  assertOriginalBatchIsRetryable(state);
});

test('a completion record from an older log entry cannot authorize this run', () => {
  skipOnWindows();
  const state = runAnalyzeOnce({
    existingLog: `prior run\n${ANALYSIS_COMPLETE_RECORD}\n`,
    claudeOutput: 'Current run could not read its analysis file.\n',
  });
  assertOriginalBatchIsRetryable(state);
});

test('a completion record written only to stderr does not authorize archival', () => {
  skipOnWindows();
  const state = runAnalyzeOnce({
    claudeOutput: 'Analysis did not complete.\n',
    claudeStderr: `${ANALYSIS_COMPLETE_RECORD}\n`,
  });
  assertOriginalBatchIsRetryable(state);
  assert.ok(state.log.includes(ANALYSIS_COMPLETE_RECORD));
});

test('duplicate exact completion records do not authorize archival', () => {
  skipOnWindows();
  const state = runAnalyzeOnce({
    claudeOutput: `${ANALYSIS_COMPLETE_RECORD}\n${ANALYSIS_COMPLETE_RECORD}\n`,
  });
  assertOriginalBatchIsRetryable(state);
});

test('replacing the result pathname cannot forge completion', () => {
  skipOnWindows();
  const state = runAnalyzeOnce({
    claudeOutput: 'Analysis did not complete.\n',
    probeResultPath: true,
  });
  assertOriginalBatchIsRetryable(state);
  assert.strictEqual(state.attackFound, false, 'the open result inode must not remain path-addressable');
});

test('successful analysis archives the original batch byte-for-byte', () => {
  skipOnWindows();
  const state = runAnalyzeOnce({
    claudeOutput: `Analysis finished.\n\n${ANALYSIS_COMPLETE_RECORD}\n\n`,
  });
  assert.strictEqual(state.liveContent, null);
  assert.deepStrictEqual(state.archivedContents, [ORIGINAL_OBSERVATIONS]);
  assert.deepStrictEqual(state.tempEntries, []);
});

test('completion record accepts a CRLF line ending', () => {
  skipOnWindows();
  const state = runAnalyzeOnce({
    claudeOutput: `Analysis complete.\r\n${ANALYSIS_COMPLETE_RECORD}\r\n\r\n`,
  });
  assert.strictEqual(state.liveContent, null);
  assert.deepStrictEqual(state.archivedContents, [ORIGINAL_OBSERVATIONS]);
});

test('watchdog force-stops a process that ignores TERM and retains observations', () => {
  skipOnWindows();
  const state = runAnalyzeOnce({
    claudeDelaySeconds: 10,
    claudeIgnoreTerm: true,
    claudeSpawnChild: true,
    observerTimeoutSeconds: 1,
  });
  assertOriginalBatchIsRetryable(state);
  assert.ok(state.durationMs < 8000, `watchdog should return promptly; took ${state.durationMs}ms`);
  assert.strictEqual(state.claudeStillRunning, false, 'timed-out Claude process must be reaped');
  assert.strictEqual(state.claudeChildStillRunning, false, 'timed-out Claude descendants must stop');
  assert.match(state.log, /timed out after 1s/);
  assert.deepStrictEqual(state.tempEntries, []);
});

console.log('--- static guards ---');

test('process and semantic failure guards run before archival', () => {
  const content = fs.readFileSync(observerLoopPath, 'utf8');
  const processGuardIdx = content.search(/exit_code"?\s+-ne\s+0/);
  const semanticGuardIdx = content.indexOf('if [ "$analysis_complete" -ne 1 ]');
  const archiveIdx = content.indexOf('observations.archive');
  assert.ok(processGuardIdx !== -1);
  assert.ok(semanticGuardIdx !== -1);
  assert.ok(archiveIdx !== -1);
  assert.ok(processGuardIdx < archiveIdx);
  assert.ok(semanticGuardIdx < archiveIdx);
});

test('observer-loop.sh has a source guard', () => {
  const content = fs.readFileSync(observerLoopPath, 'utf8');
  assert.ok(
    content.includes('BASH_SOURCE[0]') && content.includes('return 0 2>/dev/null')
  );
});

console.log('\n=== Test Results ===');
console.log(`Passed: ${passed}`);
console.log(`Failed: ${failed}`);
console.log(`Skipped: ${skipped}`);
console.log(`Total:  ${passed + failed + skipped}\n`);

process.exit(failed > 0 ? 1 : 0);
