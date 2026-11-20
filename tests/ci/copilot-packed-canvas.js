'use strict';

const assert = require('node:assert/strict');
const { execFile } = require('node:child_process');
const fs = require('node:fs');
const http = require('node:http');
const os = require('node:os');
const path = require('node:path');
const { pathToFileURL } = require('node:url');
const { promisify } = require('node:util');
const {
  parseEnvironment,
  assertDownloadedArtifact,
  hashFile,
  assertHash,
  createLifecycleEnvironment,
} = require('./packed-artifact-lifecycle');

const execute = promisify(execFile);
const launcher = '.github/ecc/scripts/canvas/copilot-canvas.js';
const skill = '.github/skills/plan-canvas/SKILL.md';

async function installPackage(project, env, artifact) {
  fs.writeFileSync(path.join(project, 'package.json'), JSON.stringify({
    name: 'copilot-packed-canvas-fixture',
    version: '1.0.0',
    private: true,
    dependencies: { 'ecc-universal': pathToFileURL(artifact).href },
  }));
  const options = { cwd: project, env, timeout: 120000 };
  const args = ['install', '--ignore-scripts', '--no-audit', '--no-fund'];
  if (process.platform === 'win32') {
    await execute(env.ComSpec || 'cmd.exe', ['/d', '/s', '/c', `npm ${args.join(' ')}`], options);
  } else {
    await execute('npm', args, options);
  }
  return path.join(project, 'node_modules', 'ecc-universal');
}

function postBatch(url, headers) {
  return new Promise((resolve, reject) => {
    const request = http.request(url, { method: 'POST', headers, agent: false }, response => {
      let body = '';
      response.setEncoding('utf8');
      response.on('data', chunk => { body += chunk; });
      response.on('error', reject);
      response.on('end', () => {
        try { resolve({ statusCode: response.statusCode, body: JSON.parse(body) }); }
        catch (error) { reject(error); }
      });
    });
    request.on('error', reject);
    request.setTimeout(10000, () => request.destroy(new Error('Canvas fixture request timed out')));
    request.end();
  });
}

async function withLegacyServer(action) {
  const requests = [];
  const server = http.createServer((request, response) => {
    requests.push([request.method, new URL(request.url, 'http://localhost').pathname]);
    response.writeHead(404).end();
  });
  await new Promise(resolve => server.listen(0, '127.0.0.1', resolve));
  try {
    await action(server.address().port, requests);
  } finally {
    await new Promise(resolve => server.close(resolve));
  }
}

async function verifyInstalledCanvas(root, packageRoot, env) {
  const workspace = path.join(root, 'Canvas project café');
  const commandsWorkspace = path.join(root, 'Commands only');
  for (const dir of [workspace, commandsWorkspace]) {
    fs.mkdirSync(dir);
    fs.writeFileSync(path.join(dir, 'package.json'), '{"type":"module"}\n');
  }
  const cli = path.join(packageRoot, 'scripts', 'ecc.js');
  const install = (cwd, ...selection) => execute(process.execPath,
    [cli, 'install', '--target', 'copilot', ...selection, '--json'], { cwd, env, timeout: 30000 });
  await install(commandsWorkspace, '--modules', 'commands-core');
  assert.equal(fs.existsSync(path.join(commandsWorkspace, skill)), false);
  assert.equal(fs.existsSync(path.join(commandsWorkspace, launcher)), false);
  await install(workspace, '--skills', 'plan-canvas');
  assert.ok(fs.readFileSync(path.join(workspace, skill), 'utf8').includes(launcher));
  assert.equal(fs.existsSync(path.join(workspace, '.github/hooks')), false);
  assert.equal(fs.existsSync(path.join(workspace, '.github/ecc/scripts/lib/copilot-sessions.js')), false);
  assert.equal(JSON.parse(fs.readFileSync(path.join(workspace, '.github/ecc/scripts/package.json'))).type, 'commonjs');

  const { createSessionStore } = require(path.join(packageRoot, 'scripts/lib/plan-canvas/sessions.js'));
  const { createPlanCanvasServer } = require(path.join(packageRoot, 'scripts/lib/plan-canvas/server.js'));
  const file = path.join(workspace, 'Review plan.md');
  fs.writeFileSync(file, '# Review plan\n');
  const uiFile = path.join(workspace, 'Review mockup.html');
  fs.writeFileSync(uiFile, '<h1>Review mockup</h1>\n');
  const stateDir = path.join(root, 'canvas state');
  const store = createSessionStore({ stateDir });
  const session = store.open(file).session;
  const uiSession = store.open(uiFile, { mode: 'ui' }).session;
  const reviewServer = createPlanCanvasServer({ store });
  const { port } = await reviewServer.listen(0);
  const setServer = portNumber => fs.writeFileSync(path.join(stateDir, 'server.json'), JSON.stringify({
    pid: process.pid, port: portNumber, version: 'test', startedAt: new Date().toISOString(),
  }));

  const invoke = async (...args) => JSON.parse((await execute(process.execPath, [launcher, ...args], {
    cwd: workspace, env, timeout: 10000,
  })).stdout);
  const bind = sessionId => invoke('bind', '--session', sessionId, '--file', 'Review plan.md', '--state-dir', stateDir);
  const feedback = sessionId => invoke('feedback', '--session', sessionId);
  const unbind = sessionId => invoke('unbind', '--session', sessionId);
  const id = 'copilot-fixture';
  try {
    setServer(port);
    store.queueFeedback(uiSession.key, [{ kind: 'edits', text: 'Mockup edit', edits: [] }]);
    const uiEndpoint = new URL('/api/feedback-batch', `http://127.0.0.1:${port}`);
    uiEndpoint.searchParams.set('key', uiSession.key);
    uiEndpoint.searchParams.set('createdAt', uiSession.createdAt);
    assert.deepEqual((await postBatch(uiEndpoint)).body, { status: 'missing' });
    assert.equal(store.get(uiSession.key).pendingFeedback.length, 1);
    await assert.rejects(invoke('bind', '--session', id, '--file', path.basename(uiFile), '--state-dir', stateDir));
    const legacyAwait = new URL('/api/await', `http://127.0.0.1:${port}`);
    legacyAwait.searchParams.set('key', uiSession.key);
    const uiResult = await fetch(legacyAwait).then(response => response.json());
    const [uiItem] = uiResult.items;
    assert.equal(uiItem.kind, 'edits');
    assert.equal(store.get(uiSession.key).pendingFeedback.length, 0);
    assert.equal(store.get(uiSession.key).uiBatches[0].id, uiItem.id);
    const uiReply = await fetch(new URL(`/api/session/${uiSession.key}/reply`, legacyAwait), {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ acknowledge: [uiItem.id], text: 'Applied the mockup edit' }),
    });
    assert.equal(uiReply.status, 200);
    assert.equal(store.get(uiSession.key).uiBatches.length, 0);
    assert.equal(store.get(uiSession.key).uiAcknowledged[0].id, uiItem.id);

    assert.equal((await bind(id)).nativeStatus, 'native-unverified');
    assert.equal((await feedback(id)).status, 'waiting');
    await assert.rejects(bind('other-session'));
    store.queueFeedback(session.key, [{ kind: 'verdict', verdict: 'approve', text: 'Review completed' }]);
    assert.equal((await feedback('other-session')).status, 'unbound');
    assert.equal(store.get(session.key).pendingFeedback.length, 1);
    const endpoint = new URL('/api/feedback-batch', `http://127.0.0.1:${port}`);
    endpoint.searchParams.set('key', session.key);
    endpoint.searchParams.set('createdAt', session.createdAt);
    for (const headers of [{ host: 'example.invalid' }, { origin: 'https://example.invalid' }]) {
      const denied = await postBatch(endpoint, headers);
      assert.equal(denied.statusCode, 403);
    }
    const queued = store.get(session.key);
    const obstacle = `${store.stateFile}.tmp`;
    fs.mkdirSync(obstacle);
    try {
      const interrupted = await postBatch(endpoint);
      assert.deepEqual({ code: interrupted.statusCode, pending: store.get(session.key).pendingFeedback.length }, { code: 500, pending: 1 });
      assert.equal(store.get(session.key), queued);
      assert.equal((await feedback(id)).status, 'unavailable');
    } finally {
      fs.rmdirSync(obstacle);
    }
    endpoint.searchParams.set('createdAt', '2000-01-01T00:00:00.000Z');
    const stale = await postBatch(endpoint);
    assert.deepEqual(stale.body, { status: 'missing' });
    assert.equal(store.get(session.key).pendingFeedback.length, 1);
    const verdict = await feedback(id);
    assert.equal(verdict.trust, 'untrusted-review-data');
    assert.equal(verdict.items[0].verdict, 'approve');
    assert.equal(Object.hasOwn(verdict, 'permissionDecision'), false);

    store.queueFeedback(session.key, [{ kind: 'chat', text: 'token=ordinary-fixture' }]);
    assert.equal((await feedback(id)).items[0].text, '[unsafe or sensitive review text omitted]');

    store.queueFeedback(session.key, Array.from({ length: 21 }, () => ({ kind: 'chat', text: 'Review note' })));
    assert.equal((await feedback(id)).items.length, 20);
    assert.equal(store.get(session.key).pendingFeedback.length, 1);
    assert.equal((await feedback(id)).items.length, 1);

    store.queueFeedback(session.key, [
      ...Array.from({ length: 21 }, () => ({ kind: 'chat', text: '🧪'.repeat(1900) })),
      { kind: 'chat', text: 'Final review note' },
    ], { endSession: true });
    const first = await feedback(id);
    assert.equal(first.status, 'feedback');
    assert.ok(first.items.length > 0 && first.items.length < 20);
    assert.equal(first.sessionEnded, false);
    assert.equal(store.get(session.key).pendingFeedback.length, 22 - first.items.length);
    let final = first;
    for (let remaining = 22 - first.items.length; remaining > 0; remaining -= final.items.length) {
      final = await feedback(id);
      assert.equal(final.status, 'feedback');
      assert.ok(final.items.length > 0 && final.items.length <= remaining);
    }
    assert.equal(final.sessionEnded, true);
    assert.equal(final.items.at(-1).text, 'Final review note');
    assert.equal((await feedback(id)).status, 'ended');
    assert.equal((await unbind(id)).removed, true);
    assert.equal((await feedback(id)).status, 'unbound');

    await withLegacyServer(async (legacyPort, requests) => {
      setServer(legacyPort);
      const reopened = store.open(file, { reopen: true }).session;
      store.queueFeedback(reopened.key, [{ kind: 'chat', text: 'Retained on old server' }]);
      assert.equal((await bind(id)).bound, true);
      assert.equal((await feedback(id)).status, 'unavailable');
      assert.equal(store.get(reopened.key).pendingFeedback.length, 1);
      assert.deepEqual(requests, [['POST', '/api/feedback-batch']]);
      assert.equal((await unbind(id)).removed, true);
    });
  } finally {
    await reviewServer.close();
  }
}

async function main() {
  const { packagePath, expectedSha256 } = parseEnvironment();
  assertDownloadedArtifact(packagePath, process.cwd());
  assertHash(hashFile(packagePath), expectedSha256);
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'ecc-copilot-canvas-'));
  try {
    const packageProject = path.join(root, 'packed package');
    const home = path.join(root, 'home');
    fs.mkdirSync(packageProject);
    fs.mkdirSync(home);
    const env = { ...createLifecycleEnvironment(process.env, home), COPILOT_HOME: path.join(home, 'copilot') };
    await verifyInstalledCanvas(root, await installPackage(packageProject, env, packagePath), env);
    console.log('Packed Copilot Canvas verified');
  } finally {
    fs.rmSync(root, { recursive: true, force: true, maxRetries: 5, retryDelay: 100 });
  }
}

module.exports = { verifyInstalledCanvas };

if (require.main === module) main().catch(error => {
  console.error(error);
  process.exitCode = 1;
});
