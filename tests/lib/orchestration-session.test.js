'use strict';

const assert = require('assert');
const fs = require('fs');
const os = require('os');
const path = require('path');

const {
  buildSessionSnapshot,
  listTmuxPanes,
  loadWorkerSnapshots,
  parseWorkerHandoff,
  parseWorkerStatus,
  parseWorkerTask,
  resolveSnapshotTarget
} = require('../../scripts/lib/orchestration-session');

console.log('=== Testing orchestration-session.js ===\n');

let passed = 0;
let failed = 0;

function test(desc, fn) {
  try {
    fn();
    console.log(`  ✓ ${desc}`);
    passed++;
  } catch (error) {
    console.log(`  ✗ ${desc}: ${error.message}`);
    failed++;
  }
}

test('parseWorkerStatus extracts structured status fields', () => {
  const status = parseWorkerStatus([
    '# Status',
    '',
    '- State: completed',
    '- Updated: 2026-03-12T14:09:15Z',
    '- Branch: feature-branch',
    '- Worktree: `/tmp/worktree`',
    '',
    '- Handoff file: `/tmp/handoff.md`'
  ].join('\n'));

  assert.deepStrictEqual(status, {
    state: 'completed',
    updated: '2026-03-12T14:09:15Z',
    branch: 'feature-branch',
    worktree: '/tmp/worktree',
    taskFile: null,
    handoffFile: '/tmp/handoff.md'
  });
});

test('parseWorkerTask extracts objective and seeded overlays', () => {
  const task = parseWorkerTask([
    '# Worker Task',
    '',
    '## Seeded Local Overlays',
    '- `scripts/orchestrate-worktrees.js`',
    '- `commands/multi-workflow.md`',
    '',
    '## Objective',
    'Verify seeded files and summarize status.'
  ].join('\n'));

  assert.deepStrictEqual(task.seedPaths, [
    'scripts/orchestrate-worktrees.js',
    'commands/multi-workflow.md'
  ]);
  assert.strictEqual(task.objective, 'Verify seeded files and summarize status.');
});

test('parseWorkerHandoff extracts summary, validation, and risks', () => {
  const handoff = parseWorkerHandoff([
    '# Handoff',
    '',
    '## Summary',
    '- Worker completed successfully',
    '',
    '## Validation',
    '- Ran tests',
    '',
    '## Remaining Risks',
    '- No runtime screenshot'
  ].join('\n'));

  assert.deepStrictEqual(handoff.summary, ['Worker completed successfully']);
  assert.deepStrictEqual(handoff.validation, ['Ran tests']);
  assert.deepStrictEqual(handoff.remainingRisks, ['No runtime screenshot']);
});

test('parseWorkerHandoff also supports bold section headers', () => {
  const handoff = parseWorkerHandoff([
    '# Handoff',
    '',
    '**Summary**',
    '- Worker completed successfully',
    '',
    '**Validation**',
    '- Ran tests',
    '',
    '**Remaining Risks**',
    '- No runtime screenshot'
  ].join('\n'));

  assert.deepStrictEqual(handoff.summary, ['Worker completed successfully']);
  assert.deepStrictEqual(handoff.validation, ['Ran tests']);
  assert.deepStrictEqual(handoff.remainingRisks, ['No runtime screenshot']);
});

test('loadWorkerSnapshots reads coordination worker directories', () => {
  const tempRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'ecc-orch-session-'));
  const coordinationDir = path.join(tempRoot, 'coordination');
  const workerDir = path.join(coordinationDir, 'seed-check');
  const proofDir = path.join(coordinationDir, 'proof');
  fs.mkdirSync(workerDir, { recursive: true });
  fs.mkdirSync(proofDir, { recursive: true });

  try {
    fs.writeFileSync(path.join(workerDir, 'status.md'), [
      '# Status',
      '',
      '- State: running',
      '- Branch: seed-branch',
      '- Worktree: `/tmp/seed-worktree`'
    ].join('\n'));
    fs.writeFileSync(path.join(workerDir, 'task.md'), [
      '# Worker Task',
      '',
      '## Objective',
      'Inspect seed paths.'
    ].join('\n'));
    fs.writeFileSync(path.join(workerDir, 'handoff.md'), [
      '# Handoff',
      '',
      '## Summary',
      '- Pending'
    ].join('\n'));

    const workers = loadWorkerSnapshots(coordinationDir);
    assert.strictEqual(workers.length, 1);
    assert.strictEqual(workers[0].workerSlug, 'seed-check');
    assert.strictEqual(workers[0].status.branch, 'seed-branch');
    assert.strictEqual(workers[0].task.objective, 'Inspect seed paths.');
  } finally {
    fs.rmSync(tempRoot, { recursive: true, force: true });
  }
});

test('buildSessionSnapshot merges tmux panes with worker metadata', () => {
  const tempRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'ecc-orch-snapshot-'));
  const coordinationDir = path.join(tempRoot, 'coordination');
  const workerDir = path.join(coordinationDir, 'seed-check');
  fs.mkdirSync(workerDir, { recursive: true });

  try {
    fs.writeFileSync(path.join(workerDir, 'status.md'), '- State: completed\n- Branch: seed-branch\n');
    fs.writeFileSync(path.join(workerDir, 'task.md'), '## Objective\nInspect seed paths.\n');
    fs.writeFileSync(path.join(workerDir, 'handoff.md'), '## Summary\n- ok\n');

    const snapshot = buildSessionSnapshot({
      sessionName: 'workflow-visual-proof',
      coordinationDir,
      panes: [
        {
          paneId: '%95',
          windowIndex: 1,
          paneIndex: 2,
          title: 'seed-check',
          currentCommand: 'codex',
          currentPath: '/tmp/worktree',
          active: false,
          dead: false,
          pid: 1234
        }
      ]
    });

    assert.strictEqual(snapshot.sessionActive, true);
    assert.strictEqual(snapshot.workerCount, 1);
    assert.strictEqual(snapshot.workerStates.completed, 1);
    assert.strictEqual(snapshot.workers[0].pane.paneId, '%95');
  } finally {
    fs.rmSync(tempRoot, { recursive: true, force: true });
  }
});

test('listTmuxPanes returns an empty array when tmux is unavailable', () => {
  const panes = listTmuxPanes('workflow-visual-proof', {
    spawnSyncImpl: () => ({
      error: Object.assign(new Error('tmux not found'), { code: 'ENOENT' })
    })
  });

  assert.deepStrictEqual(panes, []);
});

test('resolveSnapshotTarget handles plan files and direct session names', () => {
  const tempRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'ecc-orch-target-'));
  const repoRoot = path.join(tempRoot, 'repo');
  fs.mkdirSync(repoRoot, { recursive: true });
  const planPath = path.join(repoRoot, 'plan.json');
  fs.writeFileSync(planPath, JSON.stringify({
    sessionName: 'workflow-visual-proof',
    repoRoot,
    coordinationRoot: path.join(repoRoot, '.claude', 'orchestration')
  }));

  try {
    const fromPlan = resolveSnapshotTarget(planPath, repoRoot);
    assert.strictEqual(fromPlan.targetType, 'plan');
    assert.strictEqual(fromPlan.sessionName, 'workflow-visual-proof');

    const fromSession = resolveSnapshotTarget('workflow-visual-proof', repoRoot);
    assert.strictEqual(fromSession.targetType, 'session');
    assert.ok(fromSession.coordinationDir.endsWith(path.join('.claude', 'orchestration', 'workflow-visual-proof')));
  } finally {
    fs.rmSync(tempRoot, { recursive: true, force: true });
  }
});

console.log(`\n=== Results: ${passed} passed, ${failed} failed ===`);
if (failed > 0) process.exit(1);
