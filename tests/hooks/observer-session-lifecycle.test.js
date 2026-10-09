const assert = require('assert');
const fs = require('fs');
const os = require('os');
const path = require('path');
const vm = require('vm');
const { createRequire } = require('module');
const { spawnSync } = require('child_process');

const hooksDir = path.resolve(__dirname, '../../scripts/hooks');
let passed = 0;
let failed = 0;

function test(name, fn) {
  try {
    fn();
    console.log(`  ✓ ${name}`);
    passed += 1;
  } catch (error) {
    console.log(`  ✗ ${name}`);
    console.log(`    ${error.message}`);
    failed += 1;
  }
}

function withFixture(fn, extraEnv = {}) {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'ecc-observer-lifecycle-'));
  const project = path.join(root, 'project');
  const store = path.join(root, 'homunculus');
  const observerDir = path.join(store, 'projects', 'fixture-project');
  fs.mkdirSync(project, { recursive: true });
  fs.mkdirSync(observerDir, { recursive: true });
  fs.writeFileSync(path.join(store, 'projects.json'), JSON.stringify({
    fixture: { id: 'fixture-project', root: project }
  }));
  const overrides = {
    HOME: root,
    USERPROFILE: root,
    ECC_AGENT_DATA_HOME: path.join(root, 'agent-data'),
    CLAUDE_CONFIG_DIR: path.join(root, 'claude-config'),
    CLV2_HOMUNCULUS_DIR: store,
    XDG_DATA_HOME: path.join(root, 'xdg'),
    CLAUDE_PROJECT_DIR: project,
    CLAUDE_PACKAGE_MANAGER: 'npm',
    ECC_SESSION_START_CONTEXT: 'off',
    ECC_SESSION_ID: undefined,
    CLAUDE_SESSION_ID: undefined,
    ...extraEnv
  };
  for (const key of ['GIT_DIR', 'GIT_WORK_TREE', 'GIT_INDEX_FILE', 'GIT_COMMON_DIR', 'GIT_PREFIX']) {
    overrides[key] = undefined;
  }
  const env = { ...process.env, ...overrides };
  for (const [key, value] of Object.entries(env)) {
    if (value === undefined) delete env[key];
  }
  try {
    fn({ project, observerDir, overrides, env });
  } finally {
    fs.rmSync(root, { recursive: true, force: true });
  }
}

function runHook(name, input, fixture) {
  const result = spawnSync(process.execPath, [path.join(hooksDir, name)], {
    cwd: fixture.project,
    env: fixture.env,
    input,
    encoding: 'utf8',
    timeout: 10000
  });
  assert.ifError(result.error);
  assert.strictEqual(result.status, 0, result.stderr);
  return result;
}

function leaseFile(fixture, sessionId) {
  return path.join(fixture.observerDir, '.observer-sessions', `${sessionId}.json`);
}

function seedLease(fixture, sessionId) {
  const filename = leaseFile(fixture, sessionId);
  fs.mkdirSync(path.dirname(filename), { recursive: true });
  fs.writeFileSync(filename, JSON.stringify({ sessionId }));
}

function assertStartOutput(result) {
  assert.deepStrictEqual(JSON.parse(result.stdout), {
    hookSpecificOutput: { hookEventName: 'SessionStart', additionalContext: '' }
  });
  assert.ok(!result.stderr.includes('[SessionStart] Error:'), result.stderr);
}

function withEnv(overrides, fn) {
  const previous = Object.fromEntries(Object.keys(overrides).map(key => [key, process.env[key]]));
  for (const [key, value] of Object.entries(overrides)) {
    if (value === undefined) delete process.env[key];
    else process.env[key] = value;
  }
  try {
    return fn();
  } finally {
    for (const [key, value] of Object.entries(previous)) {
      if (value === undefined) delete process.env[key];
      else process.env[key] = value;
    }
  }
}

function loadEndMarkerWithStubbedStop(stops) {
  const filename = path.join(hooksDir, 'session-end-marker.js');
  const localRequire = createRequire(filename);
  const module = { exports: {} };
  const requireStub = id => id === '../lib/observer-sessions'
    ? { ...localRequire(id), stopObserverForContext: context => { stops.push(context.projectId); return true; } }
    : localRequire(id);
  vm.runInNewContext(fs.readFileSync(filename, 'utf8'), {
    require: requireStub, module,
    process: { stderr: { write() {} }, env: process.env }
  }, { filename });
  return module.exports;
}

console.log('\n=== Observer session lifecycle tests ===\n');

test('SessionStart creates separate observer leases from stdin without environment IDs', () => {
  withFixture(fixture => {
    for (const sessionId of ['payload-one', 'payload-two']) {
      assertStartOutput(runHook('session-start.js', JSON.stringify({
        session_id: sessionId, hook_event_name: 'SessionStart', source: 'startup'
      }), fixture));
      const lease = JSON.parse(fs.readFileSync(leaseFile(fixture, sessionId), 'utf8'));
      assert.strictEqual(lease.sessionId, sessionId);
      assert.strictEqual(lease.hook, 'SessionStart');
      assert.strictEqual(lease.projectRoot, fixture.project);
    }
    assert.strictEqual(fs.readdirSync(path.dirname(leaseFile(fixture, 'payload-one'))).length, 2);
  });
});

test('SessionEnd CLI removes the payload lease, retains others, then cleans up the final observer', () => {
  withFixture(fixture => {
    seedLease(fixture, 'first');
    seedLease(fixture, 'second');
    const pidFile = path.join(fixture.observerDir, '.observer.pid');
    // PID 1 is rejected before process.kill, so this fixture never signals any process.
    fs.writeFileSync(pidFile, '1');
    for (const sessionId of ['first', 'second']) {
      const input = ` {"session_id":"${sessionId}","hook_event_name":"SessionEnd"}\n`;
      assert.strictEqual(runHook('session-end-marker.js', input, fixture).stdout, input);
      assert.ok(!fs.existsSync(leaseFile(fixture, sessionId)));
      assert.strictEqual(fs.existsSync(pidFile), sessionId === 'first');
      if (sessionId === 'first') assert.ok(fs.existsSync(leaseFile(fixture, 'second')));
    }
  });
});

test('in-process SessionEnd stops the observer only after the final payload lease ends', () => {
  withFixture(fixture => withEnv(fixture.overrides, () => {
    seedLease(fixture, 'first');
    seedLease(fixture, 'second');
    const stops = [];
    const { run } = loadEndMarkerWithStubbedStop(stops);
    const first = '{"session_id":"first"}\n';
    assert.strictEqual(run(first), first);
    assert.ok(!fs.existsSync(leaseFile(fixture, 'first')));
    assert.ok(fs.existsSync(leaseFile(fixture, 'second')));
    assert.deepStrictEqual(stops, []);
    const second = '{"session_id":"second"}\n';
    assert.strictEqual(run(second), second);
    assert.ok(!fs.existsSync(leaseFile(fixture, 'second')));
    assert.deepStrictEqual(stops, ['fixture-project']);
  }));
});

for (const envKey of ['ECC_SESSION_ID', 'CLAUDE_SESSION_ID']) {
  test(`both lifecycle hooks retain ${envKey} fallback for malformed stdin`, () => {
    withFixture(fixture => {
      const input = '{malformed payload\n';
      assertStartOutput(runHook('session-start.js', input, fixture));
      assert.ok(fs.existsSync(leaseFile(fixture, 'env-session')));
      assert.strictEqual(runHook('session-end-marker.js', input, fixture).stdout, input);
      assert.ok(!fs.existsSync(leaseFile(fixture, 'env-session')));
    }, { [envKey]: 'env-session' });
  });
}

test('payload ID overrides environment IDs in both lifecycle hooks', () => {
  withFixture(fixture => {
    const input = '{"session_id":"payload-session","hook_event_name":"SessionStart","source":"startup"}';
    assertStartOutput(runHook('session-start.js', input, fixture));
    assert.ok(fs.existsSync(leaseFile(fixture, 'payload-session')));
    assert.ok(!fs.existsSync(leaseFile(fixture, 'ecc-session')));
    assert.ok(!fs.existsSync(leaseFile(fixture, 'claude-session')));
    seedLease(fixture, 'ecc-session');
    assert.strictEqual(runHook('session-end-marker.js', input, fixture).stdout, input);
    assert.ok(!fs.existsSync(leaseFile(fixture, 'payload-session')));
    assert.ok(fs.existsSync(leaseFile(fixture, 'ecc-session')));
  }, { ECC_SESSION_ID: 'ecc-session', CLAUDE_SESSION_ID: 'claude-session' });
});

test('observer lease filenames sanitize path characters and Windows reserved IDs', () => {
  withFixture(fixture => {
    for (const sessionId of ['../session\\alpha:*?', 'CON']) {
      const input = JSON.stringify({ session_id: sessionId, hook_event_name: 'SessionStart', source: 'startup' });
      assertStartOutput(runHook('session-start.js', input, fixture));
      const leaseDir = path.dirname(leaseFile(fixture, 'unused'));
      const entries = fs.readdirSync(leaseDir);
      assert.strictEqual(entries.length, 1);
      assert.match(entries[0], sessionId === 'CON' ? /^CON-[a-f0-9]{6}\.json$/ : /^session-alpha\.json$/);
      assert.strictEqual(runHook('session-end-marker.js', input, fixture).stdout, input);
      assert.deepStrictEqual(fs.readdirSync(leaseDir), []);
    }
  });
});

test('null JSON is harmless without session IDs and SessionEnd preserves the raw payload', () => {
  withFixture(fixture => {
    const input = 'null\n';
    assertStartOutput(runHook('session-start.js', input, fixture));
    assert.strictEqual(runHook('session-end-marker.js', input, fixture).stdout, input);
    assert.ok(!fs.existsSync(path.dirname(leaseFile(fixture, 'unused'))));
  });
});

console.log(`\nPassed: ${passed}`);
console.log(`Failed: ${failed}`);
process.exit(failed > 0 ? 1 : 0);
