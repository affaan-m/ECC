'use strict';

const assert = require('assert');
const fs = require('fs');
const os = require('os');
const path = require('path');

const {
  createOpencodeAdapter,
  parseOpencodeTarget,
  parseOpencodeSession,
  isOpencodeSessionFileTarget,
  findLatestSessionInfo,
  findSessionInfoById
} = require('../../scripts/lib/session-adapters/opencode');
const {
  normalizeOpencodeSession,
  validateCanonicalSnapshot
} = require('../../scripts/lib/session-adapters/canonical-session');
const { createAdapterRegistry } = require('../../scripts/lib/session-adapters/registry');

console.log('=== Testing opencode session adapter ===\n');

let passed = 0;
let failed = 0;

function test(name, fn) {
  try {
    fn();
    passed += 1;
    console.log(`  ok - ${name}`);
  } catch (error) {
    failed += 1;
    console.log(`  FAIL - ${name}`);
    console.log(`        ${error && error.message}`);
  }
}

function writeOpencodeFixture({ title = 'rebuild the basket trader rebalancer', updatedAgoMs = 0 } = {}) {
  const storageDir = fs.mkdtempSync(path.join(os.tmpdir(), 'ecc-opencode-store-'));
  const repoRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'ecc-opencode-repo-'));
  const projectHash = 'b43c6d2f5bbf6e71bc3d139c1656bf3afe1935aa';
  const sessionId = 'ses_66d5468bdffeVlx1Hy2KkdIshB';

  const sessionDir = path.join(storageDir, 'session', projectHash);
  const messageDir = path.join(storageDir, 'message', sessionId);
  fs.mkdirSync(sessionDir, { recursive: true });
  fs.mkdirSync(messageDir, { recursive: true });

  const updated = Date.now() - updatedAgoMs;
  fs.writeFileSync(path.join(sessionDir, `${sessionId}.json`), JSON.stringify({
    id: sessionId,
    version: '0.12.1',
    projectID: projectHash,
    directory: repoRoot,
    title,
    time: { created: updated - 10000, updated }
  }), 'utf8');

  // one user message + one assistant message carrying the model
  fs.writeFileSync(path.join(messageDir, 'msg_user01.json'), JSON.stringify({
    id: 'msg_user01', sessionID: sessionId, role: 'user', time: { created: updated - 9000 }
  }), 'utf8');
  fs.writeFileSync(path.join(messageDir, 'msg_asst01.json'), JSON.stringify({
    id: 'msg_asst01', sessionID: sessionId, role: 'assistant',
    time: { created: updated - 8000, completed: updated - 7000 },
    modelID: 'claude-sonnet-4-5-20250929', providerID: 'anthropic'
  }), 'utf8');

  return { storageDir, repoRoot, sessionId, sessionInfoPath: path.join(sessionDir, `${sessionId}.json`) };
}

test('normalizeOpencodeSession produces a valid ecc.session.v1 snapshot', () => {
  const snapshot = normalizeOpencodeSession({
    sessionId: 'ses_x', sessionPath: '/tmp/s.json', cwd: '/repo', branch: 'main',
    objective: 'do the thing', title: 'do the thing', model: 'claude-sonnet-4-5-20250929',
    provider: 'anthropic', version: '0.12.1', projectId: 'proj', createdAt: '2026-01-01T00:00:00Z',
    updatedAt: '2026-01-01T00:05:00Z', messageCount: 2, active: false
  }, { type: 'opencode', value: 'ses_x' });

  validateCanonicalSnapshot(snapshot);
  assert.strictEqual(snapshot.adapterId, 'opencode');
  assert.strictEqual(snapshot.session.kind, 'opencode');
  assert.strictEqual(snapshot.workers[0].runtime.kind, 'opencode-session');
  assert.strictEqual(snapshot.workers[0].artifacts.provider, 'anthropic');
});

test('parseOpencodeTarget strips the opencode prefix', () => {
  assert.strictEqual(parseOpencodeTarget('opencode:latest'), 'latest');
  assert.strictEqual(parseOpencodeTarget('opencode:ses_abc'), 'ses_abc');
  assert.strictEqual(parseOpencodeTarget('codex:latest'), null);
});

test('adapter reads latest session, extracts model from messages, derives objective from title', () => {
  const { storageDir, repoRoot, sessionInfoPath } = writeOpencodeFixture({ updatedAgoMs: 0 });
  const recordingDir = fs.mkdtempSync(path.join(os.tmpdir(), 'ecc-opencode-rec-'));

  assert.strictEqual(findLatestSessionInfo(storageDir), sessionInfoPath);

  const adapter = createOpencodeAdapter({
    storageDir, recordingDir, loadStateStoreImpl: () => null, resolveBranchImpl: () => 'main'
  });
  const snapshot = adapter.open('opencode:latest', { cwd: repoRoot }).getSnapshot();

  assert.strictEqual(snapshot.adapterId, 'opencode');
  assert.strictEqual(snapshot.session.state, 'active');
  assert.strictEqual(snapshot.workers[0].worktree, repoRoot);
  assert.strictEqual(snapshot.workers[0].branch, 'main');
  assert.strictEqual(snapshot.workers[0].artifacts.model, 'claude-sonnet-4-5-20250929');
  assert.strictEqual(snapshot.workers[0].artifacts.provider, 'anthropic');
  assert.strictEqual(snapshot.workers[0].artifacts.messageCount, 2);
  assert.strictEqual(snapshot.workers[0].intent.objective, 'rebuild the basket trader rebalancer');
});

test('auto-title "New session - ..." yields empty objective; stale session is recorded', () => {
  const { storageDir, repoRoot } = writeOpencodeFixture({
    title: 'New session - 2025-09-28T23:32:22.978Z',
    updatedAgoMs: 60 * 60 * 1000
  });
  const recordingDir = fs.mkdtempSync(path.join(os.tmpdir(), 'ecc-opencode-rec2-'));

  const adapter = createOpencodeAdapter({
    storageDir, recordingDir, loadStateStoreImpl: () => null, resolveBranchImpl: () => null
  });
  const snapshot = adapter.open('opencode:latest', { cwd: repoRoot }).getSnapshot();

  assert.strictEqual(snapshot.workers[0].intent.objective, '');
  assert.strictEqual(snapshot.session.state, 'recorded');
  assert.strictEqual(snapshot.workers[0].runtime.dead, true);
});

test('registry routes structured opencode target and lists the adapter', () => {
  const { storageDir, repoRoot } = writeOpencodeFixture();
  const recordingDir = fs.mkdtempSync(path.join(os.tmpdir(), 'ecc-opencode-reg-'));

  const registry = createAdapterRegistry({
    recordingDir,
    loadStateStoreImpl: () => null,
    adapterOptions: { opencode: { storageDir, resolveBranchImpl: () => null } }
  });

  const typed = registry.open({ type: 'opencode', value: 'latest' }, { cwd: repoRoot }).getSnapshot();
  assert.strictEqual(typed.adapterId, 'opencode');

  const listed = registry.listAdapters().map(a => a.id);
  assert.ok(listed.includes('opencode'), 'registry lists opencode adapter');
  assert.ok(listed.includes('codex-worktree'), 'registry still lists codex-worktree adapter');
});


// --- branch/error coverage ---

function writeSession(storageDir, projectHash, sessionId, info, messages) {
  const sdir = path.join(storageDir, 'session', projectHash);
  const mdir = path.join(storageDir, 'message', sessionId);
  fs.mkdirSync(sdir, { recursive: true });
  fs.mkdirSync(mdir, { recursive: true });
  fs.writeFileSync(path.join(sdir, sessionId + '.json'), JSON.stringify(info), 'utf8');
  (messages || []).forEach((m, i) => fs.writeFileSync(path.join(mdir, 'msg_' + i + '.json'), JSON.stringify(m), 'utf8'));
  return path.join(sdir, sessionId + '.json');
}

test('parseOpencodeTarget handles non-string and unprefixed input', () => {
  assert.strictEqual(parseOpencodeTarget(null), null);
  assert.strictEqual(parseOpencodeTarget('/abs/ses_x.json'), null);
});

test('adapter throws for empty store and unknown id; findLatest on empty => null', () => {
  const storageDir = fs.mkdtempSync(path.join(os.tmpdir(), 'ecc-oc-empty-'));
  assert.strictEqual(findLatestSessionInfo(storageDir), null);
  const adapter = createOpencodeAdapter({ storageDir, loadStateStoreImpl: () => null });
  assert.throws(() => adapter.open('opencode:latest', { cwd: os.tmpdir() }).getSnapshot(), /No OpenCode sessions found/);
  assert.throws(() => adapter.open('opencode:ses_missing', { cwd: os.tmpdir() }).getSnapshot(), /not found/);
});

test('findSessionInfoById + direct file target + isOpencodeSessionFileTarget', () => {
  const storageDir = fs.mkdtempSync(path.join(os.tmpdir(), 'ecc-oc-byid-'));
  const now = Date.now();
  const fp = writeSession(storageDir, 'projhash', 'ses_UNIQUE001', {
    id: 'ses_UNIQUE001', directory: storageDir, title: 'real title', time: { created: now - 5000, updated: now - 5000 }
  }, []);

  assert.strictEqual(findSessionInfoById(storageDir, 'ses_UNIQUE001'), fp);
  assert.ok(isOpencodeSessionFileTarget(fp, os.tmpdir()));
  assert.ok(!isOpencodeSessionFileTarget('/tmp/not-session.json', os.tmpdir()));

  const adapter = createOpencodeAdapter({ storageDir, loadStateStoreImpl: () => null, resolveBranchImpl: () => null });
  const byId = adapter.open('opencode:ses_UNIQUE001', { cwd: os.tmpdir() }).getSnapshot();
  assert.strictEqual(byId.session.id, 'ses_UNIQUE001');
  const byFile = adapter.open(fp, { cwd: os.tmpdir() }).getSnapshot();
  assert.strictEqual(byFile.session.id, 'ses_UNIQUE001');
});

test('parseOpencodeSession: model from later assistant message, missing-time => recorded', () => {
  const storageDir = fs.mkdtempSync(path.join(os.tmpdir(), 'ecc-oc-parse-'));
  const fp = writeSession(storageDir, 'ph', 'ses_MODEL01', {
    id: 'ses_MODEL01', directory: storageDir, title: 'do work'
    // no time block => updatedMs null => recorded/inactive
  }, [
    { id: 'm0', role: 'user' },
    { id: 'm1', role: 'assistant', modelID: 'claude-sonnet-4-5-20250929', providerID: 'anthropic' }
  ]);
  const parsed = parseOpencodeSession(fp, { storageDir, resolveBranchImpl: () => null });
  assert.strictEqual(parsed.model, 'claude-sonnet-4-5-20250929');
  assert.strictEqual(parsed.provider, 'anthropic');
  assert.strictEqual(parsed.active, false);
});

test('resolveGitBranch real path returns null outside a repo', () => {
  const storageDir = fs.mkdtempSync(path.join(os.tmpdir(), 'ecc-oc-nogit-'));
  const fp = writeSession(storageDir, 'ph', 'ses_NOGIT01', {
    id: 'ses_NOGIT01', directory: storageDir, title: 't', time: { created: 1, updated: 1 }
  }, []);
  const parsed = parseOpencodeSession(fp, { storageDir }); // no resolveBranchImpl => real git path
  assert.strictEqual(parsed.branch, null);
});

console.log(`\n=== Results: ${passed} passed, ${failed} failed ===`);
if (failed > 0) process.exit(1);
