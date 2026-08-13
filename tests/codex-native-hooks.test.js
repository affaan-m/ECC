/**
 * Integration checks for the native Codex plugin hook boundary.
 *
 * Run with: node tests/codex-native-hooks.test.js
 */

'use strict';

const assert = require('assert');
const fs = require('fs');
const os = require('os');
const path = require('path');
const { spawnSync } = require('child_process');

const repoRoot = path.resolve(__dirname, '..');
const hookConfig = JSON.parse(fs.readFileSync(path.join(repoRoot, 'hooks', 'codex-hooks.json'), 'utf8'));
const CODEX_EVENTS = ['SessionStart', 'PreToolUse', 'PostToolUse', 'SessionEnd'];
const TEST_SESSION_ID = 'codex-native-hook-test';

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

function createFixture() {
  const fixtureRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'ecc-codex-hook-'));
  const userHome = path.join(fixtureRoot, 'user-home');
  const projectDir = path.join(fixtureRoot, 'project');
  const pluginData = path.join(fixtureRoot, 'plugin-data');
  const homunculusDir = path.join(fixtureRoot, 'homunculus');
  fs.mkdirSync(userHome, { recursive: true });
  fs.mkdirSync(projectDir, { recursive: true });
  fs.mkdirSync(pluginData, { recursive: true });
  fs.mkdirSync(homunculusDir, { recursive: true });
  fs.writeFileSync(
    path.join(homunculusDir, 'config.json'),
    JSON.stringify({ observer: { enabled: false } })
  );

  return { fixtureRoot, userHome, projectDir, pluginData, homunculusDir };
}

function buildEnv(fixture, pluginRoot) {
  const env = {
    ...process.env,
    HOME: fixture.userHome,
    USERPROFILE: fixture.userHome,
    PLUGIN_DATA: fixture.pluginData,
    CLV2_HOMUNCULUS_DIR: fixture.homunculusDir,
    CLAUDE_CODE_ENTRYPOINT: 'cli',
    ECC_HOOK_PROFILE: 'standard',
    ECC_SESSION_START_CONTEXT: 'off'
  };
  for (const name of ['CLAUDE_PLUGIN_ROOT', 'CLAUDE_SESSION_ID', 'ECC_SKIP_OBSERVE']) {
    delete env[name];
  }
  if (pluginRoot) env.PLUGIN_ROOT = pluginRoot;
  else delete env.PLUGIN_ROOT;
  return env;
}

function eventPayload(event, fixture, extra = {}) {
  return {
    session_id: TEST_SESSION_ID,
    transcript_path: path.join(fixture.fixtureRoot, 'transcript.jsonl'),
    cwd: fixture.projectDir,
    hook_event_name: event,
    ...extra
  };
}

function runHook(event, { fixture, pluginRoot = repoRoot, extra = {} }) {
  const handler = hookConfig.hooks[event]?.[0]?.hooks?.[0];
  assert.ok(handler, `Missing native Codex ${event} hook`);

  return spawnSync(handler.command, {
    cwd: fixture.projectDir,
    env: buildEnv(fixture, pluginRoot),
    input: JSON.stringify(eventPayload(event, fixture, extra)),
    encoding: 'utf8',
    shell: true,
    timeout: 15_000
  });
}

function withFixture(run) {
  const fixture = createFixture();
  try {
    run(fixture);
  } finally {
    fs.rmSync(fixture.fixtureRoot, { recursive: true, force: true });
  }
}

test('installed Codex SessionStart hook resolves from PLUGIN_ROOT and emits Codex output', () => {
  withFixture(fixture => {
    const result = runHook('SessionStart', { fixture, extra: { source: 'startup' } });
    assert.strictEqual(result.status, 0, result.stderr || result.error?.message);
    const output = JSON.parse(result.stdout);
    assert.strictEqual(output.hookSpecificOutput.hookEventName, 'SessionStart');
    assert.strictEqual(typeof output.hookSpecificOutput.additionalContext, 'string');
  });
});

test('Codex registers the complete continuous-learning lifecycle', () => {
  assert.deepStrictEqual(Object.keys(hookConfig.hooks), CODEX_EVENTS);
  assert.deepStrictEqual(hookConfig.hooks.PreToolUse.map(group => group.id), ['pre:observe:continuous-learning']);
  assert.deepStrictEqual(hookConfig.hooks.PostToolUse.map(group => group.id), ['post:observe:continuous-learning']);
  assert.deepStrictEqual(hookConfig.hooks.SessionEnd.map(group => group.id), ['session:end:marker']);
});

test('Codex lifecycle records tool observations and releases its session lease', () => {
  withFixture(fixture => {
    const lease = path.join(fixture.homunculusDir, '.observer-sessions', `${TEST_SESSION_ID}.json`);
    const start = runHook('SessionStart', { fixture, extra: { source: 'startup' } });
    assert.strictEqual(start.status, 0, start.stderr || start.error?.message);
    assert.ok(fs.existsSync(lease), 'SessionStart must register the stdin session_id');

    const pre = runHook('PreToolUse', {
      fixture,
      extra: {
        tool_name: 'Bash',
        tool_input: { command: 'printf ok', api_key: 'test-secret-value-123' },
        tool_use_id: 'tool-1'
      }
    });
    assert.strictEqual(pre.status, 0, pre.stderr || pre.error?.message);
    const post = runHook('PostToolUse', {
      fixture,
      extra: { tool_name: 'Bash', tool_response: { output: 'ok' }, tool_use_id: 'tool-1' }
    });
    assert.strictEqual(post.status, 0, post.stderr || post.error?.message);

    const observations = fs.readFileSync(path.join(fixture.homunculusDir, 'observations.jsonl'), 'utf8')
      .trim().split('\n').map(line => JSON.parse(line));
    assert.deepStrictEqual(observations.map(item => item.event), ['tool_start', 'tool_complete']);
    assert.ok(observations.every(item => item.session === TEST_SESSION_ID));
    const serializedObservations = JSON.stringify(observations);
    assert.ok(!serializedObservations.includes('test-secret-value-123'));
    assert.ok(serializedObservations.includes('[REDACTED]'));

    const end = runHook('SessionEnd', { fixture });
    assert.strictEqual(end.status, 0, end.stderr || end.error?.message);
    assert.ok(!fs.existsSync(lease), 'SessionEnd must release the stdin session_id');
  });
});

for (const event of CODEX_EVENTS) {
  test(`Codex ${event} hook fails closed when PLUGIN_ROOT is absent`, () => {
    withFixture(fixture => {
      const result = runHook(event, { fixture, pluginRoot: null });
      assert.notStrictEqual(result.status, 0, 'Hook must not fall through to a stale ~/.claude plugin');
      assert.match(result.stderr, /Missing Codex PLUGIN_ROOT/);
    });
  });
}

test('Codex SessionStart lease uses a sanitized stdin session id', () => {
  withFixture(fixture => {
    const result = runHook('SessionStart', {
      fixture,
      extra: { session_id: '../unsafe session', source: 'startup' }
    });
    assert.strictEqual(result.status, 0, result.stderr || result.error?.message);
    const leaseDir = path.join(fixture.homunculusDir, '.observer-sessions');
    assert.deepStrictEqual(fs.readdirSync(leaseDir), ['unsafe-session.json']);
  });
});

console.log(`\nPassed: ${passed}`);
console.log(`Failed: ${failed}`);
process.exit(failed > 0 ? 1 : 0);
