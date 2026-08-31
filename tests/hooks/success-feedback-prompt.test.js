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

function makeHome(sessionCount) {
  const home = fs.mkdtempSync(path.join(os.tmpdir(), 'ecc-success-'));
  const sessionsDir = path.join(home, 'session-data');
  fs.mkdirSync(sessionsDir, { recursive: true });

  for (let index = 0; index < sessionCount; index += 1) {
    fs.writeFileSync(path.join(sessionsDir, `session-${index}.md`), '# session\n', 'utf8');
  }

  return { home, sessionsDir };
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

if (failures > 0) {
  console.log(`\n${failures} test(s) failed`);
  process.exit(1);
}

console.log('\nAll success-feedback-prompt hook tests passed');
