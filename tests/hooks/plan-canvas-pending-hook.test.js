/**
 * Integration tests for scripts/hooks/plan-canvas-pending.js (Stop)
 *
 * The hook is the delivery guarantee for canvas chat: without it, feedback the
 * human sends while no `await` is parked simply never reaches the agent.
 *
 * Run with: node tests/hooks/plan-canvas-pending-hook.test.js
 */

const assert = require('assert');
const fs = require('fs');
const os = require('os');
const path = require('path');
const http = require('http');
const { createSessionStore } = require('../../scripts/lib/plan-canvas/sessions');
const { createPlanCanvasServer } = require('../../scripts/lib/plan-canvas/server');

const HOOK = path.join(__dirname, '..', '..', 'scripts', 'hooks', 'plan-canvas-pending.js');

async function test(name, fn) {
  try {
    await fn();
    console.log(`  ✓ ${name}`);
    return true;
  } catch (err) {
    console.log(`  ✗ ${name}`);
    console.log(`    Error: ${err.message}`);
    return false;
  }
}

function freshStateDir() {
  return fs.mkdtempSync(path.join(os.tmpdir(), 'plan-canvas-pending-'));
}

function writeState(stateDir, sessions) {
  fs.mkdirSync(stateDir, { recursive: true });
  fs.writeFileSync(path.join(stateDir, 'sessions.json'), JSON.stringify({ sessions, feedbackCounter: 0 }, null, 2));
}

function sessionRecord(key, file, pendingFeedback, overrides = {}) {
  const at = '2026-01-01T00:00:00.000Z';
  return {
    key,
    file,
    status: pendingFeedback.length ? 'feedback' : 'open',
    chat: [],
    pendingFeedback,
    createdAt: at,
    updatedAt: at,
    ...overrides
  };
}

function readPending(stateDir, key) {
  const state = JSON.parse(fs.readFileSync(path.join(stateDir, 'sessions.json'), 'utf8'));
  return state.sessions[key].pendingFeedback;
}

// The hook resolves the state dir at call time, so the env var has to be set
// before each invocation; a fresh require keeps the cases independent.
function loadHook(stateDir) {
  delete require.cache[require.resolve(HOOK)];
  process.env.ECC_PLAN_CANVAS_STATE_DIR = stateDir;
  return require(HOOK);
}

async function runTests() {
  console.log('\n=== Testing plan-canvas-pending Stop hook ===\n');
  let passed = 0;
  let failed = 0;
  const originalStateDir = process.env.ECC_PLAN_CANVAS_STATE_DIR;

  if (await test('blocks the stop and hands over undelivered feedback', async () => {
    const stateDir = freshStateDir();
    const projectDir = fs.mkdtempSync(path.join(os.tmpdir(), 'plan-canvas-project-'));
    const artifact = path.join(projectDir, 'feature.plan.md');
    writeState(stateDir, {
      aaaaaaaaaaaa: sessionRecord('aaaaaaaaaaaa', artifact, [
        { id: 'fb-1', kind: 'chat', text: 'move phase 2 up', at: '2026-01-01T00:00:00.000Z' }
      ])
    });
    const hook = loadHook(stateDir);
    const result = await hook.run(JSON.stringify({ cwd: projectDir, stop_hook_active: false }));
    const decision = JSON.parse(result.stdout);
    assert.strictEqual(decision.decision, 'block');
    assert.ok(decision.reason.includes('move phase 2 up'), 'reason carries the message text');
    assert.ok(decision.reason.includes('--reply'), 'reason tells the agent to answer in the canvas');
    // Drained, so the next Stop does not block on the same message.
    assert.deepStrictEqual(readPending(stateDir, 'aaaaaaaaaaaa'), []);
  })) passed++; else failed++;

  if (await test('a drained queue does not block a second time', async () => {
    const stateDir = freshStateDir();
    const projectDir = fs.mkdtempSync(path.join(os.tmpdir(), 'plan-canvas-project-'));
    const artifact = path.join(projectDir, 'feature.plan.md');
    writeState(stateDir, {
      aaaaaaaaaaaa: sessionRecord('aaaaaaaaaaaa', artifact, [
        { id: 'fb-1', kind: 'chat', text: 'first', at: '2026-01-01T00:00:00.000Z' }
      ])
    });
    const hook = loadHook(stateDir);
    const input = JSON.stringify({ cwd: projectDir });
    const first = await hook.run(input);
    assert.strictEqual(JSON.parse(first.stdout).decision, 'block');
    const second = await hook.run(input);
    assert.strictEqual(second.stdout, input, 'second stop passes stdin through');
  })) passed++; else failed++;

  if (await test('never blocks twice in a row via stop_hook_active', async () => {
    const stateDir = freshStateDir();
    const projectDir = fs.mkdtempSync(path.join(os.tmpdir(), 'plan-canvas-project-'));
    writeState(stateDir, {
      aaaaaaaaaaaa: sessionRecord('aaaaaaaaaaaa', path.join(projectDir, 'a.plan.md'), [
        { id: 'fb-1', kind: 'chat', text: 'hello', at: '2026-01-01T00:00:00.000Z' }
      ])
    });
    const hook = loadHook(stateDir);
    const input = JSON.stringify({ cwd: projectDir, stop_hook_active: true });
    const result = await hook.run(input);
    assert.strictEqual(result.stdout, input);
    assert.strictEqual(readPending(stateDir, 'aaaaaaaaaaaa').length, 1, 'nothing drained');
  })) passed++; else failed++;

  if (await test('ignores sessions outside the project, unless scope=all', async () => {
    const stateDir = freshStateDir();
    const projectDir = fs.mkdtempSync(path.join(os.tmpdir(), 'plan-canvas-project-'));
    const otherDir = fs.mkdtempSync(path.join(os.tmpdir(), 'plan-canvas-other-'));
    const state = {
      bbbbbbbbbbbb: sessionRecord('bbbbbbbbbbbb', path.join(otherDir, 'other.plan.md'), [
        { id: 'fb-1', kind: 'chat', text: 'not yours', at: '2026-01-01T00:00:00.000Z' }
      ])
    };
    writeState(stateDir, state);
    const hook = loadHook(stateDir);
    assert.strictEqual(hook.pendingSessions({ sessions: state }, projectDir, {}).length, 0);
    assert.strictEqual(
      hook.pendingSessions({ sessions: state }, projectDir, { ECC_PLAN_CANVAS_STOP_SCOPE: 'all' }).length,
      1
    );
  })) passed++; else failed++;

  if (await test('ended sessions and empty queues are left alone', async () => {
    const stateDir = freshStateDir();
    const projectDir = fs.mkdtempSync(path.join(os.tmpdir(), 'plan-canvas-project-'));
    const state = {
      cccccccccccc: sessionRecord(
        'cccccccccccc',
        path.join(projectDir, 'ended.plan.md'),
        [{ id: 'fb-1', kind: 'chat', text: 'stale', at: '2026-01-01T00:00:00.000Z' }],
        { status: 'ended', endedBy: 'user' }
      ),
      dddddddddddd: sessionRecord('dddddddddddd', path.join(projectDir, 'quiet.plan.md'), [])
    };
    writeState(stateDir, state);
    const hook = loadHook(stateDir);
    assert.strictEqual(hook.pendingSessions({ sessions: state }, projectDir, {}).length, 0);
    const input = JSON.stringify({ cwd: projectDir });
    assert.strictEqual((await hook.run(input)).stdout, input);
  })) passed++; else failed++;

  if (await test('renders annotations and verdicts readably', async () => {
    const hook = loadHook(freshStateDir());
    assert.strictEqual(
      hook.describeItem({ kind: 'annotation', text: 'split this', anchor: { snippet: 'Phase 2' } }),
      'on "Phase 2": split this'
    );
    assert.strictEqual(hook.describeItem({ kind: 'verdict', verdict: 'approve' }), 'APPROVED the plan');
    assert.strictEqual(
      hook.describeItem({ kind: 'verdict', verdict: 'request-changes', text: 'too vague' }),
      'REQUESTED CHANGES: too vague'
    );
    assert.strictEqual(hook.describeItem({ kind: 'chat', text: '' }), null);
    assert.strictEqual(hook.describeItem(null), null);
  })) passed++; else failed++;

  if (await test('malformed stdin and a missing state dir fail open', async () => {
    const hook = loadHook(path.join(os.tmpdir(), 'plan-canvas-does-not-exist-xyz'));
    assert.strictEqual((await hook.run('not json')).stdout, 'not json');
    assert.strictEqual((await hook.run('{}')).exitCode, 0);
  })) passed++; else failed++;

  if (await test('actual loopback server drains only the current project using an opaque fixed-shape URL', async () => {
    const root = fs.realpathSync.native(fs.mkdtempSync(path.join(os.tmpdir(), 'plan-canvas-ipc-')));
    const stateDir = path.join(root, 'state');
    const project = path.join(root, 'project');
    const other = path.join(root, 'other');
    fs.mkdirSync(project); fs.mkdirSync(other);
    const artifact = path.join(project, 'plan.md');
    const otherArtifact = path.join(other, 'plan.md');
    fs.writeFileSync(artifact, '# Plan'); fs.writeFileSync(otherArtifact, '# Other');
    const store = createSessionStore({ stateDir });
    const own = store.open(artifact).session;
    const foreign = store.open(otherArtifact).session;
    store.queueFeedback(own.key, [{ kind: 'chat', text: 'OWN_FEEDBACK' }]);
    store.queueFeedback(foreign.key, [{ kind: 'chat', text: 'OTHER_FEEDBACK' }]);
    const canvas = createPlanCanvasServer({ store, idleTimeoutMs: 0 });
    const requests = [];
    canvas.server.prependListener('request', req => requests.push({ path: req.url, host: req.headers.host }));
    let closed = false;
    try {
      const bound = await canvas.listen(0);
      assert.ok(bound.port > 0, 'ephemeral listen0 is recorded as its actual assigned port');
      fs.writeFileSync(path.join(stateDir, 'server.json'), JSON.stringify({ pid: process.pid, port: bound.port, version: 'test' }));
      const hook = loadHook(stateDir);
      const raw = JSON.stringify({ cwd: project });
      const result = await hook.run(raw);
      assert.strictEqual(JSON.parse(result.stdout).decision, 'block');
      assert.ok(result.stdout.includes('OWN_FEEDBACK'));
      assert.ok(!result.stdout.includes('OTHER_FEEDBACK'));
      assert.deepStrictEqual(store.get(own.key).pendingFeedback, []);
      assert.strictEqual(store.get(foreign.key).pendingFeedback.length, 1);
      assert.deepStrictEqual(requests, [{ path: `/api/await?key=${own.key}&timeoutMs=0`, host: `127.0.0.1:${bound.port}` }]);
      assert.match(own.key, /^[a-f0-9]{12}$/);
      assert.strictEqual((await hook.run(raw)).stdout, raw, 'empty queue passes through');
      await canvas.close(); closed = true;
      // Stale but valid locator fails open, preserving the queued feedback.
      store.queueFeedback(own.key, [{ kind: 'chat', text: 'OFFLINE_FEEDBACK' }]);
      assert.strictEqual((await hook.run(raw)).stdout, raw);
      assert.strictEqual(readPending(stateDir, own.key).length, 1);
      fs.unlinkSync(path.join(stateDir, 'server.json'));
      const fallback = await hook.run(raw);
      assert.ok(JSON.parse(fallback.stdout).reason.includes('OFFLINE_FEEDBACK'));
      assert.deepStrictEqual(readPending(stateDir, own.key), [], 'missing locator still drains offline file queue');
      assert.strictEqual(readPending(stateDir, foreign.key).length, 1, 'offline fallback preserves other project queue');
    } finally {
      if (!closed) await canvas.close();
      fs.rmSync(root, { recursive: true, force: true });
    }
  })) passed++; else failed++;

  if (await test('HTTP errors and redirects fail open without following another destination', async () => {
    const root = fs.realpathSync.native(fs.mkdtempSync(path.join(os.tmpdir(), 'plan-canvas-http-failure-')));
    const stateDir = path.join(root, 'state');
    const artifact = path.join(root, 'plan.md');
    fs.writeFileSync(artifact, '# Plan');
    let status = 302;
    let requests = 0;
    const server = http.createServer((_req, res) => {
      requests++;
      res.writeHead(status, { 'Content-Type': 'application/json', Location: 'http://example.invalid/should-not-follow' });
      res.end(JSON.stringify({ status: 'feedback', items: [{ kind: 'chat', text: 'UNTRUSTED_ERROR_BODY' }] }));
    });
    try {
      await new Promise(resolve => server.listen(0, '127.0.0.1', resolve));
      const port = server.address().port;
      writeState(stateDir, { aaaaaaaaaaaa: sessionRecord('aaaaaaaaaaaa', artifact, [{ kind: 'chat', text: 'KEEP' }]) });
      fs.writeFileSync(path.join(stateDir, 'server.json'), JSON.stringify({ port }));
      const hook = loadHook(stateDir);
      const raw = JSON.stringify({ cwd: root });
      for (status of [302, 500]) {
        assert.strictEqual((await hook.run(raw)).stdout, raw);
        assert.strictEqual(readPending(stateDir, 'aaaaaaaaaaaa').length, 1);
      }
      assert.strictEqual(requests, 2, 'each attempt makes one loopback request; redirects are not followed');
    } finally {
      await new Promise(resolve => server.close(resolve));
      fs.rmSync(root, { recursive: true, force: true });
    }
  })) passed++; else failed++;

  if (await test('invalid keys and malformed locator ports make no HTTP request and preserve feedback', async () => {
    const root = fs.realpathSync.native(fs.mkdtempSync(path.join(os.tmpdir(), 'plan-canvas-invalid-ipc-')));
    const stateDir = path.join(root, 'state');
    const artifact = path.join(root, 'plan.md');
    fs.writeFileSync(artifact, '# Plan');
    const hook = loadHook(stateDir);
    const originalRequest = http.request;
    let calls = 0;
    http.request = () => { calls++; throw new Error('unexpected HTTP request'); };
    try {
      for (const port of [0, -1, 65536, 1.5, '4321', null]) {
        writeState(stateDir, { aaaaaaaaaaaa: sessionRecord('aaaaaaaaaaaa', artifact, [{ kind: 'chat', text: 'KEEP' }]) });
        fs.writeFileSync(path.join(stateDir, 'server.json'), JSON.stringify({ port }));
        const raw = JSON.stringify({ cwd: root });
        assert.strictEqual((await hook.run(raw)).stdout, raw);
        assert.strictEqual(readPending(stateDir, 'aaaaaaaaaaaa').length, 1);
        assert.strictEqual(await hook.drainViaServer(port, 'aaaaaaaaaaaa'), null);
      }
      fs.writeFileSync(path.join(stateDir, 'server.json'), JSON.stringify({ port: 4321 }));
      for (const key of ['bad?key=SECRET&other=1', 'A'.repeat(12), 'a'.repeat(13), 'a'.repeat(12) + '\n', 'a'.repeat(12) + '\r\n', 'a'.repeat(100000), {}, null]) {
        writeState(stateDir, { aaaaaaaaaaaa: sessionRecord(key, artifact, [{ kind: 'chat', text: 'KEEP' }]) });
        const raw = JSON.stringify({ cwd: root });
        assert.strictEqual((await hook.run(raw)).stdout, raw);
        assert.strictEqual(readPending(stateDir, 'aaaaaaaaaaaa').length, 1);
        assert.strictEqual(await hook.drainViaServer(4321, key), null);
      }
      assert.strictEqual(calls, 0);
    } finally {
      http.request = originalRequest;
      fs.rmSync(root, { recursive: true, force: true });
    }
  })) passed++; else failed++;

  if (originalStateDir === undefined) delete process.env.ECC_PLAN_CANVAS_STATE_DIR;
  else process.env.ECC_PLAN_CANVAS_STATE_DIR = originalStateDir;

  console.log('\n========================================');
  console.log(`Passed: ${passed}`);
  console.log(`Failed: ${failed}`);
  console.log('========================================\n');
  return failed === 0;
}

if (require.main === module) {
  runTests().then(ok => process.exit(ok ? 0 : 1));
}

module.exports = { runTests };
