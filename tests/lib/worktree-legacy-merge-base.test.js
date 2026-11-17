'use strict';

const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { execFileSync } = require('node:child_process');
const test = require('node:test');
const { createGitRunner, defaultRunImpl } = require('../../scripts/lib/worktree-lifecycle/git');
const { buildLifecycleReport } = require('../../scripts/lib/worktree-lifecycle/lifecycle');

function withRepository(fn) {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'ecc-legacy-merge-'));
  const repo = path.join(root, 'repo');
  fs.mkdirSync(repo);
  const env = { ...process.env };
  for (const key of ['GIT_DIR', 'GIT_WORK_TREE', 'GIT_INDEX_FILE', 'GIT_COMMON_DIR', 'GIT_PREFIX']) delete env[key];
  const git = (...args) => execFileSync('git', args, { cwd: repo, env, encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'] }).trim();
  function commit(message) {
    git('add', '.');
    git('-c', 'user.name=ECC Test', '-c', 'user.email=ecc@example.test', '-c', 'core.hooksPath=', 'commit', '-m', message);
  }
  git('init', '-b', 'main');
  fs.writeFileSync(path.join(repo, 'shared.txt'), 'base\n');
  commit('base');
  const ancestor = git('rev-parse', 'HEAD');
  const calls = [];
  function legacyRun(args, options) {
    calls.push(args);
    // Only emulate the missing modern option. Merge-base, the three-tree
    // merge, worktree discovery and status all run against real Git objects.
    if (args[0] === 'merge-tree' && args.includes('--write-tree')) {
      return { status: 129, stdout: '', stderr: 'unknown option: write-tree' };
    }
    return defaultRunImpl(args, options);
  }
  try { fn({ root, repo, git, commit, ancestor, calls, legacyRun }); }
  finally { fs.rmSync(root, { recursive: true, force: true }); }
}

test('legacy prediction detects divergent edits and queues the real worktree for resolution', () => withRepository(({ root, repo, git, commit, ancestor, calls, legacyRun }) => {
  git('checkout', '-b', 'feature');
  fs.writeFileSync(path.join(repo, 'shared.txt'), 'feature\n');
  commit('feature edit');
  git('checkout', 'main');
  fs.writeFileSync(path.join(repo, 'shared.txt'), 'main\n');
  commit('main edit');
  const worker = path.join(root, 'worker');
  git('worktree', 'add', worker, 'feature');
  const initialHead = git('rev-parse', 'HEAD');
  const runner = createGitRunner(repo, legacyRun);
  const result = runner.predictMergeConflicts('feature', 'main');
  assert.equal(result.conflicted, true);
  assert.equal(result.method, 'merge-tree-legacy');
  assert.ok(calls.some(args => args[0] === 'merge-tree' && args[1] === ancestor));
  const report = buildLifecycleReport(repo, { baseBranch: 'main' }, { git: runner });
  assert.deepEqual(report.conflictQueue.map(worktree => worktree.branch), ['feature']);
  assert.equal(report.mergeReady.length, 0);
  assert.equal(git('rev-parse', 'HEAD'), initialHead);
  assert.equal(git('status', '--porcelain'), '');
  assert.equal(fs.readFileSync(path.join(repo, 'shared.txt'), 'utf8'), 'main\n');
  assert.equal(fs.readFileSync(path.join(worker, 'shared.txt'), 'utf8'), 'feature\n');
}));

test('legacy prediction retains clean results for independent edits and fast-forwards', () => withRepository(({ repo, git, commit, legacyRun }) => {
  git('checkout', '-b', 'feature');
  fs.writeFileSync(path.join(repo, 'feature.txt'), 'feature\n');
  commit('new feature file');
  git('checkout', 'main');
  const runner = createGitRunner(repo, legacyRun);
  assert.equal(runner.predictMergeConflicts('feature', 'main').conflicted, false);
  fs.writeFileSync(path.join(repo, 'main.txt'), 'main\n');
  commit('independent main file');
  assert.equal(runner.predictMergeConflicts('feature', 'main').conflicted, false);
  assert.equal(git('status', '--porcelain'), '');
}));

test('an unrelated history is not reported as a clean legacy merge', () => withRepository(({ repo, git, commit, calls, legacyRun }) => {
  git('checkout', '--orphan', 'unrelated');
  git('rm', '-f', 'shared.txt');
  fs.writeFileSync(path.join(repo, 'unrelated.txt'), 'unrelated\n');
  commit('separate root');
  git('checkout', 'main');
  const runner = createGitRunner(repo, legacyRun);
  assert.throws(() => runner.predictMergeConflicts('unrelated', 'main'), /merge base/i);
  assert.ok(!calls.some(args => args[0] === 'merge-tree' && !args.includes('--write-tree')));
}));

test('legacy merge execution failures cannot become conflict-free predictions', () => withRepository(({ repo, legacyRun }) => {
  const runner = createGitRunner(repo, (args, options) => {
    if (args[0] === 'merge-tree' && !args.includes('--write-tree')) {
      return { status: 128, stdout: '', stderr: 'fixture object unavailable' };
    }
    return legacyRun(args, options);
  });
  assert.throws(() => runner.predictMergeConflicts('main', 'main'), /fixture object unavailable/);
}));
