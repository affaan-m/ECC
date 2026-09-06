/**
 * Regression tests for #2090: "Stop hook error: JSON validation failed".
 *
 * Stop payloads carry `last_assistant_message`, which can be large. Silent
 * wrapper paths must emit nothing; explicit hook output must remain complete
 * and valid JSON so the harness never sees a truncated document.
 *
 * Contract under test: for every Stop hook, stdout is either empty or valid
 * JSON, and the exit code is 0 — for realistic large payloads and for
 * oversized (>1MB) payloads, via the production runner and via direct
 * invocation.
 */

'use strict';

const assert = require('assert');
const fs = require('fs');
const os = require('os');
const path = require('path');
const { spawnSync } = require('child_process');

const repoRoot = path.join(__dirname, '..', '..');
const runner = path.join(repoRoot, 'scripts', 'hooks', 'run-with-flags.js');
const hooksConfig = JSON.parse(
  fs.readFileSync(path.join(repoRoot, 'hooks', 'hooks.json'), 'utf8')
);

const MAX_STDIN = 1024 * 1024;
const SUBPROCESS_TIMEOUT_MS = process.platform === 'darwin' && process.env.CI === 'true'
  ? 120_000
  : 60_000;

const workDir = fs.mkdtempSync(path.join(os.tmpdir(), 'ecc-stop-stdout-')); // non-git cwd
const dataHome = fs.mkdtempSync(path.join(os.tmpdir(), 'ecc-stop-data-'));

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

function stopPayload(messageCharacters, character = 'm') {
  return JSON.stringify({
    session_id: `stop-stdout-test-${process.pid}`,
    transcript_path: path.join(workDir, 'missing-transcript.jsonl'),
    cwd: workDir,
    hook_event_name: 'Stop',
    stop_hook_active: false,
    last_assistant_message: character.repeat(messageCharacters)
  });
}

function hookEnv() {
  const env = {
    ...process.env,
    ECC_HOOK_PROFILE: 'standard',
    ECC_AGENT_DATA_HOME: dataHome,
    CLAUDE_SESSION_ID: `stop-stdout-test-${process.pid}`
  };
  delete env.ECC_GATEGUARD;
  delete env.ECC_DISABLED_HOOKS;
  delete env.ECC_DRY_RUN;
  return env;
}

function runViaRunner(hookId, script, input) {
  return spawnSync('node', [runner, hookId, script, 'minimal,standard,strict'], {
    input,
    encoding: 'utf8',
    cwd: workDir,
    env: hookEnv(),
    timeout: SUBPROCESS_TIMEOUT_MS,
    maxBuffer: 16 * 1024 * 1024,
    stdio: ['pipe', 'pipe', 'pipe']
  });
}

function runDirect(script, input) {
  return spawnSync('node', [path.join(repoRoot, script)], {
    input,
    encoding: 'utf8',
    cwd: workDir,
    env: hookEnv(),
    timeout: SUBPROCESS_TIMEOUT_MS,
    maxBuffer: 16 * 1024 * 1024,
    stdio: ['pipe', 'pipe', 'pipe']
  });
}

function runRegisteredStopHook(entry, input, envOverrides = {}) {
  const env = {
    ...hookEnv(),
    CLAUDE_PLUGIN_ROOT: repoRoot,
    ECC_DISABLED_HOOKS: entry.id,
    ...envOverrides
  };

  return spawnSync(entry.hooks[0].command, {
    input,
    encoding: 'utf8',
    cwd: workDir,
    env,
    shell: true,
    timeout: SUBPROCESS_TIMEOUT_MS,
    maxBuffer: 16 * 1024 * 1024,
    stdio: ['pipe', 'pipe', 'pipe']
  });
}

function runRegisteredStopHookWithMissingRoot(entry, input) {
  const missingRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'ecc-missing-root-'));
  fs.rmSync(missingRoot, { recursive: true, force: true });
  return spawnSync(entry.hooks[0].command, {
    input,
    encoding: 'utf8',
    cwd: workDir,
    env: {
      ...hookEnv(),
      CLAUDE_PLUGIN_ROOT: missingRoot,
      ECC_PLUGIN_ROOT: missingRoot
    },
    shell: true,
    timeout: 60000,
    maxBuffer: 16 * 1024 * 1024,
    stdio: ['pipe', 'pipe', 'pipe']
  });
}

function assertStdoutContract(result, label) {
  assert.strictEqual(result.status, 0, `${label}: expected exit 0, got ${result.status}: ${result.stderr}`);
  if (result.stdout.length > 0) {
    try {
      JSON.parse(result.stdout);
    } catch (err) {
      assert.fail(`${label}: stdout is non-empty but not valid JSON (${err.message}); first 120 chars: ${result.stdout.slice(0, 120)}`);
    }
  }
}

// All registered Stop hooks (hooks/hooks.json).
const STOP_HOOKS = [
  ['stop:format-typecheck', 'scripts/hooks/stop-format-typecheck.js'],
  ['stop:check-console-log', 'scripts/hooks/check-console-log.js'],
  ['stop:session-end', 'scripts/hooks/session-end.js'],
  ['stop:evaluate-session', 'scripts/hooks/evaluate-session.js'],
  ['stop:cost-tracker', 'scripts/hooks/cost-tracker.js']
  // stop:desktop-notify is excluded from the valid-payload run because a
  // successful run() fires a real OS notification; its truncation path is
  // covered separately below (run() bails on JSON.parse before notifying).
];

// Direct-invocation legacy paths that echo stdin.
const ECHOING_STOP_HOOKS = [
  'scripts/hooks/stop-format-typecheck.js',
  'scripts/hooks/check-console-log.js',
  'scripts/hooks/cost-tracker.js',
  'scripts/hooks/desktop-notify.js'
];

console.log('\nStop hook stdout contract tests (#2090):');

let passed = 0;
let failed = 0;

// A 100KB last_assistant_message is a realistic long-session Stop payload.
// Before the fix, cost-tracker echoed it cut at 64KB through the production
// runner path, making the harness report "JSON validation failed".
const realisticPayload = stopPayload(100 * 1024);

// Exercise the command users actually run from hooks.json. Disabled and
// no-opinion registered hooks must not copy their Stop payload to stdout.
for (const entry of hooksConfig.hooks.Stop) {
  if (
    test(`${entry.id} disabled registered wrapper stays silent for a 100KB Stop payload`, () => {
      const result = runRegisteredStopHook(entry, realisticPayload);
      assert.strictEqual(
        result.status,
        0,
        `${entry.id}: expected exit 0, got ${result.status}: ${result.stderr}`
      );
      assert.strictEqual(result.stdout, '', `${entry.id}: disabled wrapper must stay silent`);
    })
  )
    passed++;
  else failed++;
}

for (const entry of hooksConfig.hooks.Stop) {
  if (
    test(`${entry.id} unresolved-root fallback stays silent`, () => {
      const result = runRegisteredStopHookWithMissingRoot(entry, realisticPayload);
      assert.strictEqual(result.status, 0, `${entry.id}: expected exit 0, got ${result.status}: ${result.stderr}`);
      assert.strictEqual(result.stdout, '', `${entry.id}: unresolved-root fallback must stay silent`);
      assert.match(result.stderr, /lifecycle bootstrap unavailable/);
    })
  )
    passed++;
  else failed++;
}

const representativeStopEntry = hooksConfig.hooks.Stop.find(
  entry => entry.id === 'stop:cost-tracker'
);
const consoleLogStopEntry = hooksConfig.hooks.Stop.find(
  entry => entry.id === 'stop:check-console-log'
);

if (
  test('enabled registered Stop wrapper suppresses legacy raw-input passthrough', () => {
    const result = runRegisteredStopHook(consoleLogStopEntry, realisticPayload, {
      ECC_DISABLED_HOOKS: ''
    });
    assert.strictEqual(result.status, 0, `expected exit 0, got ${result.status}: ${result.stderr}`);
    assert.strictEqual(result.stdout, '', 'registered Stop boundary must suppress raw-input output');
  })
)
  passed++;
else failed++;

if (
  test('registered Stop wrapper applies a configured byte cap', () => {
    const result = runRegisteredStopHook(representativeStopEntry, realisticPayload, {
      ECC_HOOK_INPUT_MAX_BYTES: '64'
    });
    assert.strictEqual(result.status, 0, result.stderr);
    assert.strictEqual(result.stdout, '');
    assert.match(result.stderr, /lifecycle stdin exceeded 64 bytes/);
  })
)
  passed++;
else failed++;

if (
  test('registered Plan Canvas Stop wrapper preserves an explicit block decision', () => {
    const stateDir = fs.mkdtempSync(path.join(os.tmpdir(), 'ecc-plan-canvas-stop-'));
    const artifact = path.join(workDir, 'feature.plan.md');
    const timestamp = '2026-01-01T00:00:00.000Z';
    const state = {
      sessions: {
        aaaaaaaaaaaa: {
          key: 'aaaaaaaaaaaa',
          file: artifact,
          status: 'feedback',
          chat: [],
          pendingFeedback: [
            { id: 'feedback-1', kind: 'chat', text: 'move phase 2 up', at: timestamp }
          ],
          createdAt: timestamp,
          updatedAt: timestamp
        }
      },
      feedbackCounter: 1
    };
    try {
      fs.writeFileSync(path.join(stateDir, 'sessions.json'), JSON.stringify(state));
      const entry = hooksConfig.hooks.Stop.find(candidate => candidate.id === 'stop:plan-canvas-pending');
      const input = JSON.stringify({ cwd: workDir, hook_event_name: 'Stop', stop_hook_active: false });
      const result = runRegisteredStopHook(entry, input, {
        ECC_DISABLED_HOOKS: '',
        ECC_PLAN_CANVAS_STATE_DIR: stateDir
      });
      assert.strictEqual(result.status, 0, result.stderr);
      const output = JSON.parse(result.stdout);
      assert.strictEqual(output.decision, 'block');
      assert.match(output.reason, /move phase 2 up/);
    } finally {
      fs.rmSync(stateDir, { recursive: true, force: true });
    }
  })
)
  passed++;
else failed++;
if (
  test('all registered lifecycle hooks use the bounded shared bootstrap', () => {
    const lifecycleEntries = [
      ...hooksConfig.hooks.Stop,
      ...hooksConfig.hooks.SessionEnd
    ];
    for (const entry of lifecycleEntries) {
      assert.ok(
        entry.hooks[0].command.includes('scripts/hooks/lifecycle-hook-bootstrap.js'),
        `${entry.id}: expected the shared lifecycle bootstrap`
      );
    }
  })
)
  passed++;
else failed++;

if (
  test('registered Stop wrapper stays silent for a 100KB dry-run payload', () => {
    const result = runRegisteredStopHook(representativeStopEntry, realisticPayload, {
      ECC_DISABLED_HOOKS: '',
      ECC_DRY_RUN: '1'
    });
    assert.strictEqual(result.status, 0, `expected exit 0, got ${result.status}: ${result.stderr}`);
    assert.strictEqual(result.stdout, '', 'dry-run wrapper must stay silent');
  })
)
  passed++;
else failed++;

// spawnSync limits captured output by bytes while the runner's stdin cap is
// counted after UTF-8 decoding. A payload can therefore be below MAX_STDIN in
// characters but above Node's default 1MB child-process buffer in bytes.
const multibytePayload = stopPayload(400 * 1024, '한');
assert.ok(multibytePayload.length < MAX_STDIN, 'fixture must stay below the runner character cap');
assert.ok(Buffer.byteLength(multibytePayload) > MAX_STDIN, 'fixture must exceed the default byte buffer');

for (const entry of hooksConfig.hooks.Stop) {
  if (
    test(`${entry.id} disabled registered wrapper stays silent for a multibyte payload`, () => {
      const result = runRegisteredStopHook(entry, multibytePayload);
      assert.strictEqual(result.status, 0, `${entry.id}: expected exit 0, got ${result.status}: ${result.stderr}`);
      assert.strictEqual(result.stdout, '', `${entry.id}: disabled wrapper must stay silent`);
    })
  )
    passed++;
  else failed++;
}

for (const [hookId, script] of STOP_HOOKS) {
  if (
    test(`${hookId} via runner keeps stdout valid for a 100KB Stop payload`, () => {
      const result = runViaRunner(hookId, script, realisticPayload);
      assertStdoutContract(result, hookId);
      if (result.stdout.length > 0) {
        assert.strictEqual(result.stdout, realisticPayload, `${hookId}: explicit raw output must remain complete`);
      }
    })
  )
    passed++;
  else failed++;
}

const oversizedPayload = stopPayload(MAX_STDIN + 64 * 1024);

if (
  test('registered Stop wrapper suppresses a >1MB dry-run payload', () => {
    const result = runRegisteredStopHook(representativeStopEntry, oversizedPayload, {
      ECC_DISABLED_HOOKS: '',
      ECC_DRY_RUN: '1'
    });
    assert.strictEqual(result.status, 0, `expected exit 0, got ${result.status}: ${result.stderr}`);
    assert.strictEqual(
      result.stdout.length,
      0,
      `dry-run wrapper must preserve oversized-input suppression (got ${result.stdout.length} characters)`
    );
  })
)
  passed++;
else failed++;

if (
  test('registered Stop wrapper suppresses a >1MB Stop payload', () => {
    const result = runRegisteredStopHook(representativeStopEntry, oversizedPayload);
    assert.strictEqual(result.status, 0, `expected exit 0, got ${result.status}: ${result.stderr}`);
    assert.strictEqual(
      result.stdout.length,
      0,
      `wrapper must preserve oversized-input suppression (got ${result.stdout.length} characters)`
    );
    assert.match(result.stderr, /lifecycle stdin exceeded 1048576 bytes/);
  })
)
  passed++;
else failed++;

for (const [hookId, script] of [...STOP_HOOKS, ['stop:desktop-notify', 'scripts/hooks/desktop-notify.js']]) {
  if (
    test(`${hookId} via runner fails open on a >1MB Stop payload`, () => {
      const result = runViaRunner(hookId, script, oversizedPayload);
      assert.strictEqual(result.status, 0, `${hookId}: expected exit 0, got ${result.status}: ${result.stderr}`);
      assert.strictEqual(result.stdout, '', `${hookId}: oversized payloads must not be echoed`);
    })
  )
    passed++;
  else failed++;
}

for (const script of ECHOING_STOP_HOOKS) {
  if (
    test(`${path.basename(script)} invoked directly never echoes truncated stdin`, () => {
      const result = runDirect(script, oversizedPayload);
      assert.strictEqual(result.status, 0, `${script}: expected exit 0, got ${result.status}: ${result.stderr}`);
      assert.strictEqual(result.stdout, '', `${script}: truncated stdin must not be echoed`);
    })
  )
    passed++;
  else failed++;
}

if (
  test('check-console-log invoked directly echoes a sub-cap >64KB payload uncut', () => {
    const result = runDirect('scripts/hooks/check-console-log.js', realisticPayload);
    assert.strictEqual(result.status, 0);
    assert.strictEqual(result.stdout, realisticPayload, 'pass-through must not be cut at the pipe buffer');
    JSON.parse(result.stdout);
  })
)
  passed++;
else failed++;

if (
  test('cost-tracker invoked directly echoes a sub-cap >64KB payload uncut', () => {
    const result = runDirect('scripts/hooks/cost-tracker.js', realisticPayload);
    assert.strictEqual(result.status, 0);
    assert.strictEqual(result.stdout, realisticPayload, 'the old 64KB cap must not cut realistic Stop payloads');
    JSON.parse(result.stdout);
  })
)
  passed++;
else failed++;

try {
  fs.rmSync(workDir, { recursive: true, force: true });
  fs.rmSync(dataHome, { recursive: true, force: true });
} catch {
  /* best-effort cleanup */
}

console.log(`\nPassed: ${passed}`);
console.log(`Failed: ${failed}\n`);
process.exit(failed > 0 ? 1 : 0);
