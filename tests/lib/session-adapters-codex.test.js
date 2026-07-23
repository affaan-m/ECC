'use strict';

const assert = require('assert');
const fs = require('fs');
const os = require('os');
const path = require('path');

const {
  createCodexWorktreeAdapter,
  parseCodexTarget,
  parseCodexRollout,
  isCodexRolloutFileTarget,
  findLatestRollout,
  findRolloutById
} = require('../../scripts/lib/session-adapters/codex-worktree');
const {
  normalizeCodexWorktreeSession,
  validateCanonicalSnapshot
} = require('../../scripts/lib/session-adapters/canonical-session');
const { createAdapterRegistry } = require('../../scripts/lib/session-adapters/registry');

console.log('=== Testing codex-worktree session adapter ===\n');

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

function writeRolloutFixture() {
  const sessionsDir = fs.mkdtempSync(path.join(os.tmpdir(), 'ecc-codex-sessions-'));
  const repoRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'ecc-codex-worktree-'));
  const dayDir = path.join(sessionsDir, '2026', '06', '02');
  fs.mkdirSync(dayDir, { recursive: true });

  const now = new Date().toISOString();
  const rolloutPath = path.join(dayDir, 'rollout-2026-06-02T03-01-58-019etest-codex-0001.jsonl');
  const lines = [
    { type: 'session_meta', timestamp: now, payload: {
      id: '019etest-codex-0001', timestamp: now, cwd: repoRoot,
      originator: 'Codex Desktop', cli_version: '0.136.0', source: 'vscode', model_provider: 'openai'
    } },
    { type: 'turn_context', timestamp: now, payload: { model: 'gpt-5.5-codex' } },
    { type: 'response_item', timestamp: now, payload: {
      type: 'message', role: 'user',
      content: [{ type: 'text', text: '# AGENTS.md instructions for /repo\n<cwd>/repo</cwd>' }]
    } },
    { type: 'response_item', timestamp: now, payload: {
      type: 'message', role: 'user',
      content: [{ type: 'text', text: 'continue our ecc 2.0 session and build the codex-worktree adapter' }]
    } }
  ];

  fs.writeFileSync(rolloutPath, lines.map(line => JSON.stringify(line)).join('\n') + '\n', 'utf8');
  return { sessionsDir, repoRoot, rolloutPath };
}

test('normalizeCodexWorktreeSession produces a valid ecc.session.v1 snapshot', () => {
  const snapshot = normalizeCodexWorktreeSession({
    sessionId: 'abc', sessionPath: '/tmp/r.jsonl', cwd: '/repo', branch: 'feat/x',
    objective: 'do the thing', model: 'gpt-5.5-codex', originator: 'Codex Desktop',
    cliVersion: '0.136.0', startedAt: '2026-06-02T03:01:58Z', recordCount: 4, active: true
  }, { type: 'codex-worktree', value: 'abc' });

  validateCanonicalSnapshot(snapshot);
  assert.strictEqual(snapshot.adapterId, 'codex-worktree');
  assert.strictEqual(snapshot.session.kind, 'codex-worktree');
  assert.strictEqual(snapshot.session.state, 'active');
  assert.strictEqual(snapshot.workers[0].runtime.kind, 'codex-session');
  assert.strictEqual(snapshot.workers[0].branch, 'feat/x');
  assert.strictEqual(snapshot.workers[0].artifacts.model, 'gpt-5.5-codex');
});

test('parseCodexTarget strips codex prefixes', () => {
  assert.strictEqual(parseCodexTarget('codex:latest'), 'latest');
  assert.strictEqual(parseCodexTarget('codex-worktree:019eabc'), '019eabc');
  assert.strictEqual(parseCodexTarget('/some/path.jsonl'), null);
});

test('adapter reads latest rollout, skips preamble, derives objective + model', () => {
  const { sessionsDir, repoRoot, rolloutPath } = writeRolloutFixture();
  const recordingDir = fs.mkdtempSync(path.join(os.tmpdir(), 'ecc-codex-rec-'));

  assert.strictEqual(findLatestRollout(sessionsDir), rolloutPath);

  const adapter = createCodexWorktreeAdapter({
    sessionsDir, recordingDir, loadStateStoreImpl: () => null, resolveBranchImpl: () => null
  });
  const snapshot = adapter.open('codex:latest', { cwd: repoRoot }).getSnapshot();

  assert.strictEqual(snapshot.adapterId, 'codex-worktree');
  assert.strictEqual(snapshot.session.id, '019etest-codex-0001');
  assert.strictEqual(snapshot.session.state, 'active');
  assert.strictEqual(snapshot.workers.length, 1);
  assert.strictEqual(snapshot.workers[0].worktree, repoRoot);
  assert.strictEqual(snapshot.workers[0].runtime.command, 'codex');
  assert.strictEqual(snapshot.workers[0].runtime.active, true);
  assert.strictEqual(snapshot.workers[0].artifacts.model, 'gpt-5.5-codex');
  assert.strictEqual(
    snapshot.workers[0].intent.objective,
    'continue our ecc 2.0 session and build the codex-worktree adapter'
  );
  assert.strictEqual(snapshot.aggregates.workerCount, 1);
  assert.strictEqual(snapshot.aggregates.states.active, 1);
});

test('registry routes structured codex-worktree target and direct rollout path', () => {
  const { sessionsDir, repoRoot, rolloutPath } = writeRolloutFixture();
  const recordingDir = fs.mkdtempSync(path.join(os.tmpdir(), 'ecc-codex-reg-'));

  const registry = createAdapterRegistry({
    recordingDir,
    loadStateStoreImpl: () => null,
    adapterOptions: { 'codex-worktree': { sessionsDir, resolveBranchImpl: () => null } }
  });

  const typed = registry.open({ type: 'codex-worktree', value: 'latest' }, { cwd: repoRoot }).getSnapshot();
  assert.strictEqual(typed.adapterId, 'codex-worktree');
  assert.strictEqual(typed.session.id, '019etest-codex-0001');

  const byPath = registry.open(rolloutPath, { cwd: repoRoot }).getSnapshot();
  assert.strictEqual(byPath.adapterId, 'codex-worktree');

  const listed = registry.listAdapters().map(a => a.id);
  assert.ok(listed.includes('codex-worktree'), 'registry lists codex-worktree adapter');
});


// --- branch/error coverage ---

function writeRollout(dir, name, lines) {
  const fp = require('path').join(dir, name);
  require('fs').writeFileSync(fp, lines.map(l => JSON.stringify(l)).join('\n') + '\n', 'utf8');
  return fp;
}

test('parseCodexTarget handles non-string and unprefixed input', () => {
  assert.strictEqual(parseCodexTarget(null), null);
  assert.strictEqual(parseCodexTarget(42), null);
  assert.strictEqual(parseCodexTarget('/abs/path.jsonl'), null);
});

test('adapter throws clear errors for missing sessions and unknown ids', () => {
  const sessionsDir = fs.mkdtempSync(path.join(os.tmpdir(), 'ecc-codex-empty-'));
  const adapter = createCodexWorktreeAdapter({ sessionsDir, loadStateStoreImpl: () => null });
  assert.throws(() => adapter.open('codex:latest', { cwd: os.tmpdir() }).getSnapshot(), /No Codex rollout sessions found/);
  assert.throws(() => adapter.open('codex:nope-not-real', { cwd: os.tmpdir() }).getSnapshot(), /not found/);
  assert.throws(() => adapter.open('/not/a/rollout.txt', { cwd: os.tmpdir() }).getSnapshot(), /Unsupported Codex session target/);
});

test('findRolloutById + direct file target + isCodexRolloutFileTarget', () => {
  const sessionsDir = fs.mkdtempSync(path.join(os.tmpdir(), 'ecc-codex-byid-'));
  const day = path.join(sessionsDir, '2026', '06', '02');
  fs.mkdirSync(day, { recursive: true });
  const now = new Date().toISOString();
  const fp = writeRollout(day, 'rollout-2026-06-02T03-00-00-019eUNIQUEID0001.jsonl', [
    { type: 'session_meta', timestamp: now, payload: { id: '019eUNIQUEID0001', cwd: sessionsDir } }
  ]);

  assert.strictEqual(findRolloutById(sessionsDir, '019eUNIQUEID0001'), fp);
  assert.ok(isCodexRolloutFileTarget(fp, os.tmpdir()));
  assert.ok(!isCodexRolloutFileTarget('not-a-file.jsonl', os.tmpdir()));

  const adapter = createCodexWorktreeAdapter({ sessionsDir, loadStateStoreImpl: () => null, resolveBranchImpl: () => null });
  const byId = adapter.open('codex:019eUNIQUEID0001', { cwd: os.tmpdir() }).getSnapshot();
  assert.strictEqual(byId.session.id, '019eUNIQUEID0001');
  const byFile = adapter.open(fp, { cwd: os.tmpdir() }).getSnapshot();
  assert.strictEqual(byFile.session.id, '019eUNIQUEID0001');
});

test('parseCodexRollout: model fallbacks, objective truncation, corrupt-line skip, mtime fallback', () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'ecc-codex-parse-'));
  const longObjective = 'x'.repeat(400);
  const fp = path.join(dir, 'rollout-2026-06-02T03-00-00-019eMODELFALL0002.jsonl');
  // include a corrupt line, no turn_context (force meta.model_provider fallback), no timestamps (force mtime)
  fs.writeFileSync(fp, [
    JSON.stringify({ type: 'session_meta', payload: { id: '019eMODELFALL0002', cwd: dir, model_provider: 'openai' } }),
    '{ this is corrupt json',
    JSON.stringify({ type: 'response_item', payload: { type: 'message', role: 'user', content: [{ type: 'text', text: longObjective }] } })
  ].join('\n') + '\n', 'utf8');

  const parsed = parseCodexRollout(fp, { resolveBranchImpl: () => null });
  assert.strictEqual(parsed.model, 'openai', 'falls back to model_provider when no turn_context/model');
  assert.ok(parsed.objective.endsWith('...'), 'long objective is truncated');
  assert.ok(parsed.objective.length <= 280);
  assert.strictEqual(parsed.active, true, 'no record timestamps => falls back to (recent) file mtime');
});

test('resolveGitBranch returns null when cwd is not a git repo (real path)', () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'ecc-codex-nogit-'));
  const fp = path.join(dir, 'rollout-2026-06-02T03-00-00-019eNOGIT00003.jsonl');
  fs.writeFileSync(fp, JSON.stringify({ type: 'session_meta', payload: { id: '019eNOGIT00003', cwd: dir } }) + '\n', 'utf8');
  // no resolveBranchImpl => exercises the real execFileSync + catch path
  const parsed = parseCodexRollout(fp, {});
  assert.strictEqual(parsed.branch, null);
});

console.log(`\n=== Results: ${passed} passed, ${failed} failed ===`);
if (failed > 0) process.exit(1);
