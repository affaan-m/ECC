'use strict';

const assert = require('assert');
const fs = require('fs');
const os = require('os');
const path = require('path');
const { spawnSync, spawn } = require('child_process');
const { createStateStore } = require('../../scripts/lib/state-store');
const { claimWorkItem, moveWorkItem } = require('../../scripts/lib/control-pane/work-item-mutations');
const { MATRIX_BLOCK_START, MATRIX_BLOCK_END, renderMarkdownTable } = require('../../scripts/lib/harness-adapter-compliance');

const CLI = path.resolve(__dirname, '../../scripts/work-items.js');
const verifier = 'harness-adapter-documentation/v1';
const validDoc = () => `${MATRIX_BLOCK_START}\n${renderMarkdownTable()}\n${MATRIX_BLOCK_END}\n`;
let passed = 0;
let failed = 0;

async function fixture(fn) {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'ecc-outcome-'));
  const store = await createStateStore({ dbPath: path.join(root, 'state.db') });
  for (const id of ['session-1', 'session-2']) store.upsertSession({ id, adapterId: 'test', harness: 'test', state: 'active', snapshot: {} });
  const base = { id: 'docs-task', source: 'manual', title: 'Repair matrix', status: 'open', repoRoot: root, metadata: { verification: { contract: { verifier, artifact: 'matrix.md' } } } };
  const register = () => store.upsertWorkItem(base);
  const claim = () => claimWorkItem(store, { id: base.id, owner: 'agent', assigneeKind: 'agent', sessionId: 'session-1' });
  try { await fn({ root, store, base, register, claim, artifact: path.join(root, 'matrix.md') }); }
  finally { store.close(); fs.rmSync(root, { recursive: true, force: true }); }
}

async function test(name, fn) {
  try { await fixture(fn); passed++; console.log(`  PASS ${name}`); }
  catch (error) { failed++; console.error(`  FAIL ${name}: ${error.stack}`); }
}

async function run() {
  await test('failure then repair yields bound independent outcomes and completes only on repair', ({ store, register, claim, artifact }) => {
    const registered = register();
    assert.deepStrictEqual(registered.metadata.verification.attempts, []);
    claim(); fs.writeFileSync(artifact, 'broken matrix');
    const failure = store.verifyWorkItem('docs-task');
    assert.strictEqual(failure.attempt.outcome, 'failure');
    assert.strictEqual(failure.item.status, 'blocked');
    assert.match(failure.attempt.reasons.join(' '), /matrix/);
    fs.writeFileSync(artifact, validDoc());
    const success = store.verifyWorkItem('docs-task');
    assert.strictEqual(success.attempt.outcome, 'success');
    assert.strictEqual(success.item.status, 'done');
    assert.strictEqual(success.item.metadata.verification.attempts.length, 2);
    assert.strictEqual(success.attempt.previousAttemptId, failure.attempt.attemptId);
    assert.strictEqual(success.attempt.sessionId, 'session-1');
    assert.strictEqual(success.attempt.taskId, 'docs-task');
    assert.match(success.attempt.artifactDigest, /^[a-f0-9]{64}$/);
    assert.match(success.attempt.contractDigest, /^[a-f0-9]{64}$/);
    assert.ok(success.attempt.durationMs >= 0);
    assert.notStrictEqual(success.attempt.artifactDigest, failure.attempt.artifactDigest);
    assert.strictEqual(success.attempt.verifier, verifier);
  });

  await test('legacy tasks remain compatible and are visibly unverified', ({ store, root }) => {
    store.upsertWorkItem({ id: 'legacy', source: 'manual', title: 'Legacy', status: 'done' });
    const result = spawnSync(process.execPath, [CLI, 'show', 'legacy', '--db', path.join(root, 'state.db')], { encoding: 'utf8' });
    assert.strictEqual(result.status, 0, result.stderr);
    assert.match(result.stdout, /unverified/i);
    assert.throws(() => store.verifyWorkItem('legacy'), /contract/i);
  });

  await test('terminal status, metadata replacement and contract edits cannot bypass verification', ({ store, register, claim }) => {
    const original = register(); claim();
    const current = store.getWorkItemById('docs-task');
    for (const status of ['done', 'closed', 'resolved', 'merged']) assert.throws(() => store.upsertWorkItem({ ...current, status }), /verif/i);
    assert.throws(() => moveWorkItem(store, { id: current.id, lane: 'done' }), /verif/i);
    for (const metadata of [null, {}, { verification: null }, { verification: { ...current.metadata.verification, attempts: [{ outcome: 'success' }] } }, { verification: { ...current.metadata.verification, contract: { verifier, artifact: 'other.md' } } }]) {
      assert.throws(() => store.upsertWorkItem({ ...current, metadata }), /verif|contract/i);
    }
    assert.strictEqual(store.getWorkItemById('docs-task').metadata.verification.registeredAt, original.metadata.verification.registeredAt);
    assert.strictEqual(store.upsertWorkItem({ ...current, status: 'cancelled' }).status, 'cancelled');
  });

  await test('registration must precede work and cannot forge outcome history', ({ store, base }) => {
    for (const change of [{ status: 'running' }, { owner: 'agent' }, { status: 'done' }, { metadata: { verification: { contract: { verifier, artifact: 'matrix.md' }, attempts: [{ outcome: 'success' }] } } }]) {
      assert.throws(() => store.upsertWorkItem({ ...base, ...change }), /contract|verif|register/i);
    }
    store.upsertWorkItem({ ...base, metadata: {}, status: 'running' });
    store.upsertWorkItem({ ...base, metadata: {}, status: 'open' });
    assert.throws(() => store.upsertWorkItem(base), /new work item|creation/i);
  });

  await test('contract validation rejects unknown verifier and escaping or invalid paths', ({ store, base }) => {
    for (const contract of [null, {}, { verifier: 'shell', artifact: 'matrix.md' }, { verifier, artifact: '../matrix.md' }, { verifier, artifact: '/tmp/matrix.md' }, { verifier, artifact: 'a/../../matrix.md' }, { verifier, artifact: 'a\\..\\matrix.md' }, { verifier, artifact: 'bad\0.md' }, { verifier, artifact: 'matrix.txt' }, { verifier, artifact: 'matrix.md', command: 'touch file' }]) {
      assert.throws(() => store.upsertWorkItem({ ...base, metadata: { verification: { contract } } }), /contract|verif|artifact/i);
    }
    assert.throws(() => store.upsertWorkItem({ ...base, repoRoot: 'relative' }), /root|absolute/i);
  });

  await test('missing artifact is unknown and claimed session is required', ({ store, register, claim }) => {
    register();
    assert.throws(() => store.verifyWorkItem('docs-task'), /owner|claim|session/i);
    assert.throws(() => claimWorkItem(store, { id: 'docs-task', owner: 'agent' }), /session/i);
    claim();
    const result = store.verifyWorkItem('docs-task');
    assert.strictEqual(result.attempt.outcome, 'unknown');
    assert.strictEqual(result.item.status, 'blocked');
    assert.strictEqual(result.attempt.artifactDigest, null);
    assert.throws(() => store.verifyWorkItem('missing'), /not found/i);
  });

  await test('old success cannot complete after artifact, session, owner or identity changes', ({ store, register, claim, artifact }) => {
    register(); claim(); fs.writeFileSync(artifact, validDoc());
    let success = store.verifyWorkItem('docs-task');
    fs.writeFileSync(artifact, 'changed');
    const rejected = store.upsertWorkItem({ ...success.item, status: 'done' });
    assert.strictEqual(rejected.status, 'blocked');
    assert.strictEqual(rejected.metadata.verification.attempts.at(-1).outcome, 'failure');
    assert.strictEqual(store.getWorkItemById('docs-task').status, 'blocked');
    assert.throws(() => moveWorkItem(store, { id: 'docs-task', lane: 'done' }), /verif|artifact/i);
    fs.writeFileSync(artifact, validDoc());
    success = store.verifyWorkItem('docs-task');
    for (const patch of [{ sessionId: 'session-2' }, { owner: 'other' }, { title: 'Different objective' }, { source: 'different' }, { sourceId: 'different' }]) {
      assert.throws(() => store.upsertWorkItem({ ...success.item, ...patch }), /verif|identity|new work item/i);
    }
    const reopened = store.upsertWorkItem({ ...success.item, sessionId: 'session-2', status: 'running' });
    assert.throws(() => store.upsertWorkItem({ ...reopened, status: 'done' }), /verif/i);
    const repeated = store.verifyWorkItem('docs-task');
    assert.strictEqual(repeated.attempt.sessionId, 'session-2');
    assert.strictEqual(repeated.item.metadata.verification.attempts.length, 4);
  });

  await test('duplicate verification creates distinct ordered attempts with identical artifact binding', ({ store, register, claim, artifact }) => {
    register(); claim(); fs.writeFileSync(artifact, validDoc());
    const first = store.verifyWorkItem('docs-task');
    const second = store.verifyWorkItem('docs-task');
    assert.notStrictEqual(first.attempt.attemptId, second.attempt.attemptId);
    assert.strictEqual(second.attempt.previousAttemptId, first.attempt.attemptId);
    assert.strictEqual(first.attempt.artifactDigest, second.attempt.artifactDigest);
    assert.strictEqual(second.item.metadata.verification.attempts.length, 2);
  });

  await test('symlink artifacts, directories and oversized files fail closed', ({ root, store, register, claim, artifact }) => {
    register(); claim();
    const outside = fs.mkdtempSync(path.join(os.tmpdir(), 'ecc-outside-'));
    try {
      fs.writeFileSync(path.join(outside, 'matrix.md'), validDoc());
      fs.symlinkSync(path.join(outside, 'matrix.md'), artifact);
      assert.strictEqual(store.verifyWorkItem('docs-task').attempt.outcome, 'unknown');
      fs.unlinkSync(artifact); fs.mkdirSync(artifact);
      assert.strictEqual(store.verifyWorkItem('docs-task').attempt.outcome, 'unknown');
      fs.rmdirSync(artifact); fs.writeFileSync(artifact, Buffer.alloc(1024 * 1024 + 1));
      assert.strictEqual(store.verifyWorkItem('docs-task').attempt.outcome, 'unknown');
      const nested = { id: 'nested', source: 'manual', title: 'nested', status: 'open', repoRoot: root, metadata: { verification: { contract: { verifier, artifact: 'linked/matrix.md' } } } };
      fs.symlinkSync(outside, path.join(root, 'linked'));
      store.upsertWorkItem(nested); claimWorkItem(store, { id: 'nested', owner: 'agent', sessionId: 'session-1' });
      assert.strictEqual(store.verifyWorkItem('nested').attempt.outcome, 'unknown');
    } finally { fs.rmSync(outside, { recursive: true, force: true }); }
  });

  await test('CLI register claim verify show repair close form an end-to-end flow', ({ root, artifact }) => {
    function cli(args) { return spawnSync(process.execPath, [CLI, ...args, '--db', path.join(root, 'state.db'), '--json'], { encoding: 'utf8' }); }
    const registration = cli(['upsert', 'cli-task', '--title', 'Repair actual matrix', '--repo-root', root, '--verify', verifier, '--artifact', 'matrix.md']);
    assert.strictEqual(registration.status, 0, registration.stderr);
    const claimed = cli(['claim', 'cli-task', '--owner', 'codex', '--session-id', 'session-1']);
    assert.strictEqual(claimed.status, 0, claimed.stderr);
    const failedClose = cli(['close', 'cli-task']);
    assert.notStrictEqual(failedClose.status, 0);
    fs.writeFileSync(artifact, 'wrong');
    const failure = cli(['verify', 'cli-task']);
    assert.strictEqual(failure.status, 1);
    assert.strictEqual(JSON.parse(failure.stdout).attempt.outcome, 'failure');
    fs.writeFileSync(artifact, validDoc());
    const success = cli(['verify', 'cli-task']);
    assert.strictEqual(success.status, 0, success.stderr);
    assert.strictEqual(JSON.parse(success.stdout).item.status, 'done');
    const shown = cli(['show', 'cli-task']);
    assert.strictEqual(JSON.parse(shown.stdout).metadata.verification.attempts.length, 2);
    assert.strictEqual(cli(['close', 'cli-task']).status, 0);
    fs.writeFileSync(artifact, 'regression');
    assert.notStrictEqual(cli(['close', 'cli-task']).status, 0);
    const regressed = JSON.parse(cli(['show', 'cli-task']).stdout);
    assert.strictEqual(regressed.status, 'blocked');
    assert.strictEqual(regressed.metadata.verification.attempts.at(-1).outcome, 'failure');
  });

  await test('board preserves a failed completion check and reports that done was refused', ({ store, register, claim, artifact }) => {
    register(); claim(); fs.writeFileSync(artifact, validDoc()); store.verifyWorkItem('docs-task');
    fs.writeFileSync(artifact, 'regression');
    const result = moveWorkItem(store, { id: 'docs-task', lane: 'done' });
    assert.strictEqual(result.moved, false);
    assert.strictEqual(result.reason, 'verification-failed');
    assert.strictEqual(result.item.status, 'blocked');
    assert.strictEqual(result.item.metadata.verification.attempts.length, 2);
  });

  await test('completion rechecks changed valid bytes and records their new digest', ({ store, register, claim, artifact }) => {
    register(); claim(); fs.writeFileSync(artifact, validDoc());
    const success = store.verifyWorkItem('docs-task');
    fs.writeFileSync(artifact, `# Updated introduction\n${validDoc()}`);
    const updated = store.upsertWorkItem({ ...success.item, status: 'done' });
    assert.strictEqual(updated.status, 'done');
    assert.notStrictEqual(updated.metadata.verification.attempts.at(-1).artifactDigest, success.attempt.artifactDigest);
    assert.strictEqual(updated.metadata.verification.attempts.at(-1).kind, 'completion-recheck');
  });

  await test('concurrent verifications preserve both ordered attempts', async ({ root, store, register, claim, artifact }) => {
    register(); claim(); fs.writeFileSync(artifact, validDoc());
    const results = await Promise.all([1, 2].map(() => new Promise((resolve, reject) => {
      const child = spawn(process.execPath, [CLI, 'verify', 'docs-task', '--db', path.join(root, 'state.db'), '--json']);
      let stdout = ''; let stderr = '';
      child.stdout.on('data', chunk => { stdout += chunk; });
      child.stderr.on('data', chunk => { stderr += chunk; });
      child.on('error', reject);
      child.on('close', code => resolve({ code, stdout, stderr }));
    })));
    for (const result of results) assert.strictEqual(result.code, 0, result.stderr);
    const attempts = store.getWorkItemById('docs-task').metadata.verification.attempts;
    assert.strictEqual(attempts.length, 2);
    assert.strictEqual(attempts[1].previousAttemptId, attempts[0].attemptId);
  });

  await test('cancelled work stays cancelled until explicitly reopened and legacy verification cannot be forged', ({ store, register, claim, artifact }) => {
    const registered = register();
    const cancelled = store.upsertWorkItem({ ...registered, status: 'cancelled' });
    assert.throws(() => store.verifyWorkItem('docs-task'), /claim|session/i);
    assert.strictEqual(store.getWorkItemById('docs-task').status, 'cancelled');
    store.upsertWorkItem({ ...cancelled, status: 'open' }); claim();
    fs.writeFileSync(artifact, validDoc());
    assert.strictEqual(store.verifyWorkItem('docs-task').verified, true);
  });

  await test('FIFO artifacts and regular files replaced by FIFOs never block verification', ({ root }) => {
    if (process.platform === 'win32') return;
    const worker = path.join(__dirname, 'helpers', 'work-item-fifo-worker.js');
    for (const scenario of ['fifo', 'replace']) {
      const result = spawnSync(process.execPath, [worker, path.join(root, scenario), scenario], {
        encoding: 'utf8', timeout: 5000,
      });
      assert.ifError(result.error);
      assert.strictEqual(result.status, 0, result.stderr);
      assert.deepStrictEqual(JSON.parse(result.stdout), {
        outcome: 'unknown', replaced: scenario === 'replace',
      });
    }
  });

  await test('the validator comes from ECC, never a module supplied by the artifact repository', ({ root, store, register, claim, artifact }) => {
    fs.mkdirSync(path.join(root, 'scripts/lib'), { recursive: true });
    fs.writeFileSync(path.join(root, 'scripts/lib/harness-adapter-compliance.js'), 'throw new Error("must never execute");');
    register(); claim(); fs.writeFileSync(artifact, 'invalid matrix');
    assert.strictEqual(store.verifyWorkItem('docs-task').attempt.outcome, 'failure');
    fs.writeFileSync(artifact, validDoc());
    assert.strictEqual(store.verifyWorkItem('docs-task').attempt.outcome, 'success');
  });

  console.log(`\nPassed: ${passed}, Failed: ${failed}`);
  if (failed) process.exitCode = 1;
}
run();
