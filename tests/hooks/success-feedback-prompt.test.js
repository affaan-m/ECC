/**
 * Integration tests for scripts/hooks/success-feedback-prompt.js
 *
 * The hook is pointed at a temporary agent data home so the developer's real
 * session history is never read or written.
 */

const assert = require('assert');
const fs = require('fs');
const os = require('os');
const path = require('path');
const { spawnSync } = require('child_process');

const HOOK = path.join(__dirname, '..', '..', 'scripts', 'hooks', 'success-feedback-prompt.js');
const { MILESTONES, OPT_OUT_ENV } = require('../../scripts/lib/success-feedback');
const { STATE_FILENAME } = require('../../scripts/hooks/success-feedback-prompt');

let failures = 0;

function test(name, fn) {
  try {
    fn();
    console.log(`  ✓ ${name}`);
  } catch (error) {
    failures += 1;
    console.log(`  ✗ ${name}`);
    console.log(`    ${error.message}`);
  }
}

function makeHome(sessionCount, { legacyCount = 0 } = {}) {
  const home = fs.mkdtempSync(path.join(os.tmpdir(), 'ecc-success-'));
  const sessionsDir = path.join(home, 'session-data');
  fs.mkdirSync(sessionsDir, { recursive: true });

  // Real session records are named `YYYY-MM-DD-<id>-session.tmp` (see
  // scripts/lib/session-manager.js). Fixtures must match this exactly, or
  // tests pass while the hook silently counts zero real sessions.
  for (let index = 0; index < sessionCount; index += 1) {
    fs.writeFileSync(path.join(sessionsDir, `2026-01-01-session-${index}-session.tmp`), 'session data', 'utf8');
  }

  let legacyDir;
  if (legacyCount > 0) {
    legacyDir = path.join(home, 'sessions');
    fs.mkdirSync(legacyDir, { recursive: true });
    for (let index = 0; index < legacyCount; index += 1) {
      fs.writeFileSync(path.join(legacyDir, `2025-12-01-legacy-${index}-session.tmp`), 'session data', 'utf8');
    }
  }

  return { home, sessionsDir, legacyDir };
}

function runHookCapturingStderr(home, extraEnv = {}) {
  const env = { ...process.env, ECC_AGENT_DATA_HOME: home };
  delete env[OPT_OUT_ENV];
  Object.assign(env, extraEnv);

  const result = spawnSync('node', [HOOK], {
    input: '{}',
    encoding: 'utf8',
    env,
    timeout: 15000
  });

  return {
    code: Number.isInteger(result.status) ? result.status : 1,
    stderr: result.stderr || ''
  };
}

console.log('\nsuccess-feedback-prompt hook');

test('stays silent below the first milestone', () => {
  const { home } = makeHome(MILESTONES[0] - 1);
  const result = runHookCapturingStderr(home);
  assert.strictEqual(result.code, 0);
  assert.strictEqual(result.stderr.trim(), '');
});

test('prompts once at the first milestone, then never again', () => {
  const { home } = makeHome(MILESTONES[0]);

  const first = runHookCapturingStderr(home);
  assert.strictEqual(first.code, 0);
  assert.ok(first.stderr.includes('quick-feedback.yml'), `expected prompt, got: ${first.stderr}`);

  const second = runHookCapturingStderr(home);
  assert.strictEqual(second.code, 0);
  assert.strictEqual(second.stderr.trim(), '', 'prompted twice for the same milestone');
});

test('writes milestone state next to the session data', () => {
  const { home, sessionsDir } = makeHome(MILESTONES[0]);
  runHookCapturingStderr(home);

  const statePath = path.join(sessionsDir, STATE_FILENAME);
  assert.ok(fs.existsSync(statePath), 'state file not written');

  const state = JSON.parse(fs.readFileSync(statePath, 'utf8'));
  assert.deepStrictEqual(state.prompted, [MILESTONES[0]]);
});

test('opt-out env silences the prompt', () => {
  const { home } = makeHome(MILESTONES[0]);
  const result = runHookCapturingStderr(home, { [OPT_OUT_ENV]: '1' });
  assert.strictEqual(result.code, 0);
  assert.strictEqual(result.stderr.trim(), '');
});

test('exits 0 when the session directory does not exist', () => {
  const home = fs.mkdtempSync(path.join(os.tmpdir(), 'ecc-success-empty-'));
  const result = runHookCapturingStderr(home);
  assert.strictEqual(result.code, 0);
  assert.strictEqual(result.stderr.trim(), '');
});

test('never blocks the session, even on unreadable state', () => {
  const { home, sessionsDir } = makeHome(MILESTONES[0]);
  fs.writeFileSync(path.join(sessionsDir, STATE_FILENAME), 'not json', 'utf8');

  const result = runHookCapturingStderr(home);
  assert.strictEqual(result.code, 0);
});

test('counts real session record filenames (*-session.tmp), not markdown files', () => {
  // Regression test: an earlier version filtered on `.md`, which matches no
  // real session file and meant the milestone could never be reached.
  const { home, sessionsDir } = makeHome(MILESTONES[0]);
  const decoyMd = path.join(sessionsDir, 'not-a-real-session.md');
  fs.writeFileSync(decoyMd, '# not a session record\n', 'utf8');

  const { countSessions } = require(HOOK);
  process.env.ECC_AGENT_DATA_HOME = home;
  try {
    assert.strictEqual(countSessions([sessionsDir]), MILESTONES[0], 'expected only *-session.tmp files to be counted');
  } finally {
    delete process.env.ECC_AGENT_DATA_HOME;
  }
});

test('counts sessions from the legacy directory too, so upgraded installs keep credit', () => {
  const { home } = makeHome(2, { legacyCount: MILESTONES[0] - 2 });

  const result = runHookCapturingStderr(home);
  assert.strictEqual(result.code, 0);
  assert.ok(result.stderr.includes('quick-feedback.yml'), `expected prompt once legacy + current sessions clear the milestone, got: ${result.stderr}`);
});

test('state file is never left partially written (atomic write)', () => {
  const { home, sessionsDir } = makeHome(MILESTONES[0]);
  runHookCapturingStderr(home);

  const statePath = path.join(sessionsDir, STATE_FILENAME);
  const entries = fs.readdirSync(sessionsDir);
  const leftoverTempFiles = entries.filter(name => name.includes(`.${STATE_FILENAME}.`) && name.endsWith('.tmp'));

  assert.strictEqual(leftoverTempFiles.length, 0, 'atomic write left a temp file behind');
  assert.doesNotThrow(() => JSON.parse(fs.readFileSync(statePath, 'utf8')), 'state file is not valid JSON');
});

if (failures > 0) {
  console.log(`\n${failures} test(s) failed`);
  process.exit(1);
}

console.log('\nAll success-feedback-prompt hook tests passed');
