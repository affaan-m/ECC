'use strict';

const assert = require('assert');

const fs = require('fs');
const os = require('os');
const path = require('path');
const { execFileSync } = require('child_process');
const { createGitRunner } = require('../../scripts/lib/worktree-lifecycle/git');
const {
  STATES,
  classifyWorktree,
  buildLifecycleReport,
  planCleanup
} = require('../../scripts/lib/worktree-lifecycle/lifecycle');
const { parseArgs, usage, formatReport, main } = require('../../scripts/worktree-lifecycle');

console.log('=== Testing worktree-lifecycle ===\n');

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

function captureStdout(fn) {
  const original = console.log;
  const lines = [];
  console.log = (...args) => lines.push(args.join(' '));
  try {
    fn();
  } finally {
    console.log = original;
  }
  return lines.join('\n');
}

const NOW = 1_750_000_000_000;
const DAY = 86_400_000;

// Build a fake git runner from a scripted command table. Keys are the joined
// argv; values are { status, stdout }. Lets us drive the whole state machine
// deterministically with zero real git.
function fakeGit(repoRoot, table, perPathDirty = {}) {
  const runImpl = (args, opts = {}) => {
    // isDirty runs status --porcelain with cwd set to the worktree path.
    if (args[0] === 'status' && args[1] === '--porcelain') {
      const dirty = perPathDirty[opts.cwd] === true;
      return { status: 0, stdout: dirty ? ' M file.js\n' : '', stderr: '' };
    }
    const key = args.join(' ');
    if (Object.prototype.hasOwnProperty.call(table, key)) {
      return { stderr: '', stdout: '', status: 0, ...table[key] };
    }
    return { status: 1, stdout: '', stderr: `unscripted: ${key}` };
  };
  return createGitRunner(repoRoot, runImpl);
}

test('classifyWorktree maps git facts to lifecycle states', () => {
  const opt = { staleThresholdMs: 7 * DAY, nowMs: NOW };
  assert.strictEqual(classifyWorktree({ isMain: true }, opt), STATES.MAIN);
  assert.strictEqual(classifyWorktree({ branch: null, detached: true }, opt), STATES.DETACHED);
  assert.strictEqual(classifyWorktree({ branch: 'x', dirty: true }, opt), STATES.DIRTY);
  assert.strictEqual(classifyWorktree({ branch: 'x', aheadBehind: { ahead: 0, behind: 3 } }, opt), STATES.MERGED);
  assert.strictEqual(classifyWorktree({ branch: 'x', aheadBehind: { ahead: 2, behind: 0 }, conflict: true }, opt), STATES.CONFLICT);
  assert.strictEqual(classifyWorktree({ branch: 'x', aheadBehind: { ahead: 2, behind: 0 }, conflict: false }, opt), STATES.MERGE_READY);
  assert.strictEqual(classifyWorktree({ branch: 'x', aheadBehind: { ahead: 0, behind: 0 }, lastCommitMs: NOW - 30 * DAY }, opt), STATES.MERGED);
  // unmerged (ahead>0) + old + no conflict => STALE (salvage candidate)
  assert.strictEqual(classifyWorktree({ branch: 'x', aheadBehind: { ahead: 2, behind: 0 }, conflict: false, lastCommitMs: NOW - 30 * DAY }, opt), STATES.STALE);
  // unmerged + recent => MERGE_READY
  assert.strictEqual(classifyWorktree({ branch: 'x', aheadBehind: { ahead: 2, behind: 0 }, conflict: false, lastCommitMs: NOW - 1 * DAY }, opt), STATES.MERGE_READY);
});

test('git.listWorktrees parses porcelain output', () => {
  const git = fakeGit('/repo', {
    'worktree list --porcelain': {
      stdout: [
        'worktree /repo', 'HEAD abc', 'branch refs/heads/main', '',
        'worktree /repo/.wt/feature', 'HEAD def', 'branch refs/heads/feature', '',
        'worktree /repo/.wt/detached', 'HEAD 999', 'detached', ''
      ].join('\n')
    }
  });
  const list = git.listWorktrees();
  assert.strictEqual(list.length, 3);
  assert.strictEqual(list[1].branch, 'feature');
  assert.strictEqual(list[2].detached, true);
});

test('git.predictMergeConflicts: clean merge (exit 0) and conflict (exit !=0)', () => {
  const clean = fakeGit('/repo', {
    'merge-tree --write-tree --name-only main feature': { status: 0, stdout: 'treeoid\n' }
  });
  assert.strictEqual(clean.predictMergeConflicts('feature', 'main').conflicted, false);

  const conflicted = fakeGit('/repo', {
    'merge-tree --write-tree --name-only main feature': {
      status: 1,
      stdout: '0123456789012345678901234567890123456789\nsrc/app.js\nsrc/util.js\n'
    }
  });
  const result = conflicted.predictMergeConflicts('feature', 'main');
  assert.strictEqual(result.conflicted, true);
  assert.deepStrictEqual(result.files, ['src/app.js', 'src/util.js']);
});

test('git.aheadBehind + lastCommitMs parse rev-list/log output', () => {
  const git = fakeGit('/repo', {
    'rev-list --left-right --count main...feature': { stdout: '3\t5\n' },
    'log -1 --format=%ct feature': { stdout: '1700000000\n' }
  });
  assert.deepStrictEqual(git.aheadBehind('feature', 'main'), { behind: 3, ahead: 5 });
  assert.strictEqual(git.lastCommitMs('feature'), 1700000000 * 1000);
  // missing branch => null
  assert.strictEqual(git.aheadBehind('ghost', 'main'), null);
});

function fullRepoGit() {
  const recent = Math.floor((NOW - 1 * DAY) / 1000);
  const old = Math.floor((NOW - 30 * DAY) / 1000);
  return fakeGit('/repo', {
    'worktree list --porcelain': {
      stdout: [
        'worktree /repo', 'HEAD a', 'branch refs/heads/main', '',
        'worktree /repo/.wt/ready', 'HEAD b', 'branch refs/heads/ready', '',
        'worktree /repo/.wt/conflict', 'HEAD c', 'branch refs/heads/conflict', '',
        'worktree /repo/.wt/merged', 'HEAD d', 'branch refs/heads/merged', '',
        'worktree /repo/.wt/stale', 'HEAD e', 'branch refs/heads/stale', '',
        'worktree /repo/.wt/dirty', 'HEAD f', 'branch refs/heads/dirty', ''
      ].join('\n')
    },
    // ready: 2 ahead, clean merge
    'rev-list --left-right --count main...ready': { stdout: '0\t2\n' },
    'log -1 --format=%ct ready': { stdout: `${recent}\n` },
    'merge-tree --write-tree --name-only main ready': { status: 0, stdout: 'tree\n' },
    // conflict: 2 ahead, conflicts
    'rev-list --left-right --count main...conflict': { stdout: '1\t2\n' },
    'log -1 --format=%ct conflict': { stdout: `${recent}\n` },
    'merge-tree --write-tree --name-only main conflict': { status: 1, stdout: 'aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa\nsrc/x.js\n' },
    // merged: 0 ahead
    'rev-list --left-right --count main...merged': { stdout: '4\t0\n' },
    'log -1 --format=%ct merged': { stdout: `${recent}\n` },
    // stale: unmerged (2 ahead), clean merge, but old/inactive => salvage candidate
    'rev-list --left-right --count main...stale': { stdout: '0\t2\n' },
    'log -1 --format=%ct stale': { stdout: `${old}\n` },
    'merge-tree --write-tree --name-only main stale': { status: 0, stdout: 'tree\n' },
    // dirty: ahead but dirty (no merge-tree should run)
    'rev-list --left-right --count main...dirty': { stdout: '0\t1\n' },
    'log -1 --format=%ct dirty': { stdout: `${recent}\n` }
  }, { '/repo/.wt/dirty': true });
}

test('buildLifecycleReport classifies a full repo and builds queues', () => {
  const report = buildLifecycleReport('/repo', { baseBranch: 'main', staleThresholdMs: 7 * DAY, nowMs: NOW }, { git: fullRepoGit() });

  const byBranch = Object.fromEntries(report.worktrees.map(w => [w.branch, w.state]));
  assert.strictEqual(byBranch.main, 'main');
  assert.strictEqual(byBranch.ready, 'merge-ready');
  assert.strictEqual(byBranch.conflict, 'conflict');
  assert.strictEqual(byBranch.merged, 'merged');
  assert.strictEqual(byBranch.stale, 'stale');
  assert.strictEqual(byBranch.dirty, 'dirty');

  assert.strictEqual(report.aggregates.conflictCount, 1);
  assert.strictEqual(report.aggregates.staleCount, 1);
  assert.strictEqual(report.aggregates.mergeReadyCount, 1);
  assert.strictEqual(report.conflictQueue[0].conflictFiles[0], 'src/x.js');
});

test('planCleanup removes merged + stale-clean, preserves dirty + unmerged', () => {
  const report = buildLifecycleReport('/repo', { baseBranch: 'main', staleThresholdMs: 7 * DAY, nowMs: NOW }, { git: fullRepoGit() });
  const plan = planCleanup(report);

  const removeBranches = plan.remove.map(r => r.branch).sort();
  assert.deepStrictEqual(removeBranches, ['merged'], 'only fully-merged is auto-removable');

  const salvageBranches = plan.salvage.map(s => s.branch);
  assert.ok(salvageBranches.includes('stale'), 'stale (unmerged+old) goes to salvage, never blind delete');

  const keptBranches = plan.keep.map(k => k.branch);
  assert.ok(keptBranches.includes('dirty'), 'dirty preserved');
  assert.ok(keptBranches.includes('ready'), 'unmerged merge-ready preserved');
  assert.ok(keptBranches.includes('conflict'), 'conflict preserved');
});

test('CLI parseArgs handles flags and valued options', () => {
  const o = parseArgs(['node', 's', '--json', '--base', 'develop', '--stale-days', '14', '--repo', '/x']);
  assert.strictEqual(o.json, true);
  assert.strictEqual(o.baseBranch, 'develop');
  assert.strictEqual(o.staleDays, 14);
  assert.strictEqual(o.repoRoot, '/x');
  assert.strictEqual(parseArgs(['node', 's', '-h']).help, true);
  assert.strictEqual(parseArgs(['node', 's', '--conflicts']).conflictsOnly, true);
  assert.strictEqual(parseArgs(['node', 's', '--stale']).staleOnly, true);
  assert.strictEqual(parseArgs(['node', 's', '--cleanup-plan']).cleanupPlan, true);
});

test('formatReport renders default, conflicts, stale, and cleanup-plan views', () => {
  const report = buildLifecycleReport('/repo', { baseBranch: 'main', staleThresholdMs: 7 * DAY, nowMs: NOW }, { git: fullRepoGit() });
  assert.ok(formatReport(report).includes('Worktree Lifecycle'));
  assert.ok(formatReport(report, { conflictsOnly: true }).includes('Conflict queue'));
  assert.ok(formatReport(report, { staleOnly: true }).includes('Stale queue'));
  const cleanup = formatReport(report, { cleanupPlan: true });
  assert.ok(cleanup.includes('Safe to remove') && cleanup.includes('Kept'));
});

test('CLI usage() and main(--help) print help', () => {
  assert.ok(usage().includes('Usage: worktree-lifecycle'));
  const out = captureStdout(() => main(['node', 's', '--help']));
  assert.ok(out.includes('git merge-tree'));
});

test('empty-queue branches: no conflicts / no stale render friendly messages', () => {
  const git = fakeGit('/repo', {
    'worktree list --porcelain': { stdout: 'worktree /repo\nHEAD a\nbranch refs/heads/main\n' }
  });
  const report = buildLifecycleReport('/repo', { baseBranch: 'main', nowMs: NOW }, { git });
  assert.ok(formatReport(report, { conflictsOnly: true }).includes('No worktrees would conflict'));
  assert.ok(formatReport(report, { staleOnly: true }).includes('No stale worktrees'));
});


test('real git: createGitRunner drives an actual repo (covers default spawn path)', () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'ecc-wl-realgit-'));
  const cleanEnv = { ...process.env };
  for (const k of ['GIT_DIR', 'GIT_WORK_TREE', 'GIT_INDEX_FILE', 'GIT_COMMON_DIR', 'GIT_PREFIX']) delete cleanEnv[k];
  const git = (args) => execFileSync('git', ['-C', dir, ...args], { stdio: ['ignore', 'pipe', 'ignore'], env: cleanEnv });
  try {
    git(['init', '-q', '-b', 'main']);
    git(['config', 'user.email', 't@e.st']);
    git(['config', 'user.name', 'Test']);
    fs.writeFileSync(path.join(dir, 'a.txt'), 'hello\n');
    git(['add', '-A']);
    git(['commit', '-q', '-m', 'init']);
  } catch (e) {
    // git not available in this environment; skip without failing the suite.
    console.log('  (skipped real-git: ' + (e && e.message ? e.message.split('\n')[0] : 'git unavailable') + ')');
    return;
  }

  const runner = createGitRunner(dir);
  assert.strictEqual(runner.isGitRepo(), true);
  assert.strictEqual(runner.branchExists('main'), true);
  assert.strictEqual(runner.branchExists('nope'), false);
  assert.strictEqual(runner.isDirty(dir), false);

  const wts = runner.listWorktrees();
  assert.ok(wts.length >= 1 && wts[0].branch === 'main');

  // dirty detection
  fs.writeFileSync(path.join(dir, 'a.txt'), 'changed\n');
  assert.strictEqual(runner.isDirty(dir), true);

  // lastCommitMs returns a real epoch-ms
  assert.ok(runner.lastCommitMs('main') > 0);

  fs.rmSync(dir, { recursive: true, force: true });
});

console.log(`\n=== Results: ${passed} passed, ${failed} failed ===`);
if (failed > 0) process.exit(1);
