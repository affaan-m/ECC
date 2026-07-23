'use strict';

const { createGitRunner } = require('./git');

const DEFAULT_STALE_MS = 7 * 24 * 60 * 60 * 1000; // 7 days

// Lifecycle states for a worktree, derived deterministically from git facts.
//   main          - the primary worktree (== baseBranch / repo root)
//   detached      - no branch checked out
//   dirty         - has uncommitted changes (work in progress, never auto-GC)
//   conflict      - would conflict if merged into base (queued for resolution)
//   merge-ready   - ahead of base, clean, no predicted conflicts
//   merged        - fully merged into base (ahead == 0), safe to clean
//   stale         - clean + no recent activity past the stale threshold
//   idle          - clean, behind/even with base, nothing to merge
const STATES = Object.freeze({
  MAIN: 'main',
  DETACHED: 'detached',
  DIRTY: 'dirty',
  CONFLICT: 'conflict',
  MERGE_READY: 'merge-ready',
  MERGED: 'merged',
  STALE: 'stale',
  IDLE: 'idle'
});

function classifyWorktree(facts, { staleThresholdMs, nowMs }) {
  if (facts.isMain) {
    return STATES.MAIN;
  }

  if (facts.detached || !facts.branch) {
    return STATES.DETACHED;
  }

  if (facts.dirty) {
    return STATES.DIRTY;
  }

  // Clean from here on.
  const ahead = facts.aheadBehind ? facts.aheadBehind.ahead : 0;

  // No unique commits => branch work is already in base => safe to garbage-collect.
  if (facts.aheadBehind && ahead === 0) {
    return STATES.MERGED;
  }

  if (facts.conflict) {
    return STATES.CONFLICT;
  }

  // Has unmerged commits (ahead > 0, or unknown merge-base). Stale = unmerged
  // work that has gone quiet past the threshold: a salvage candidate, never a
  // blind delete. Recent unmerged work is merge-ready.
  const isOld = facts.lastCommitMs !== null && (nowMs - facts.lastCommitMs) > staleThresholdMs;
  if (ahead > 0 || facts.aheadBehind === null) {
    return isOld ? STATES.STALE : STATES.MERGE_READY;
  }

  return STATES.IDLE;
}

function analyzeWorktree(worktree, options, git) {
  const { baseBranch, staleThresholdMs, nowMs } = options;
  const isMain = worktree.canonicalRepoRoot === git.repoRoot
    || worktree.path === git.repoRoot
    || worktree.branch === baseBranch;

  const branch = worktree.branch;
  const dirty = git.isDirty(worktree.path);
  const aheadBehind = (!isMain && branch) ? git.aheadBehind(branch, baseBranch) : null;
  const lastCommitMs = branch ? git.lastCommitMs(branch) : null;

  // Only run conflict prediction when it matters: a clean, ahead branch.
  const ahead = aheadBehind ? aheadBehind.ahead : 0;
  let conflictResult = { conflicted: false, files: [], method: null };
  if (!isMain && !dirty && branch && ahead > 0) {
    conflictResult = git.predictMergeConflicts(branch, baseBranch);
  }

  const facts = {
    isMain,
    branch,
    detached: Boolean(worktree.detached),
    dirty,
    aheadBehind,
    lastCommitMs,
    conflict: conflictResult.conflicted
  };

  const state = classifyWorktree(facts, { staleThresholdMs, nowMs });
  const ageMs = lastCommitMs !== null ? Math.max(0, nowMs - lastCommitMs) : null;

  return {
    path: worktree.path,
    branch: branch || null,
    state,
    head: worktree.head || null,
    dirty,
    ahead: aheadBehind ? aheadBehind.ahead : null,
    behind: aheadBehind ? aheadBehind.behind : null,
    lastCommitMs,
    ageMs,
    conflictFiles: conflictResult.files,
    conflictMethod: conflictResult.method
  };
}

function buildLifecycleReport(repoRoot, options = {}, deps = {}) {
  const git = deps.git || createGitRunner(repoRoot, deps.runImpl);
  const baseBranch = options.baseBranch || 'main';
  const staleThresholdMs = Number.isFinite(options.staleThresholdMs)
    ? options.staleThresholdMs
    : DEFAULT_STALE_MS;
  const nowMs = Number.isFinite(options.nowMs) ? options.nowMs : Date.now();

  const worktrees = git.listWorktrees().map(worktree =>
    analyzeWorktree(worktree, { baseBranch, staleThresholdMs, nowMs }, git)
  );

  const conflictQueue = worktrees.filter(w => w.state === STATES.CONFLICT);
  const staleQueue = worktrees.filter(w => w.state === STATES.STALE);
  const mergeReady = worktrees.filter(w => w.state === STATES.MERGE_READY);

  const states = worktrees.reduce((acc, w) => {
    acc[w.state] = (acc[w.state] || 0) + 1;
    return acc;
  }, {});

  return {
    schemaVersion: 'ecc.worktree-lifecycle.v1',
    repoRoot,
    baseBranch,
    staleThresholdMs,
    worktrees,
    conflictQueue,
    staleQueue,
    mergeReady,
    aggregates: {
      worktreeCount: worktrees.length,
      states,
      conflictCount: conflictQueue.length,
      staleCount: staleQueue.length,
      mergeReadyCount: mergeReady.length
    }
  };
}

// Plan which worktrees are SAFE to garbage-collect. Safety rule: only fully
// merged trees, or stale trees that are clean AND have nothing unmerged
// (ahead == 0 or no tracked branch). Dirty or merge-ready/conflict trees are
// never proposed for removal so in-progress or unmerged work is preserved
// (mirrors the reference-arch salvage safeguard).
function planCleanup(report) {
  const remove = [];
  const salvage = [];
  const keep = [];

  for (const w of report.worktrees) {
    if (w.state === 'main') {
      continue;
    }

    const unmergedWork = (w.ahead || 0) > 0;

    if (w.state === 'merged') {
      // Safe to remove: nothing unique to lose.
      remove.push({ path: w.path, branch: w.branch, reason: 'fully merged into base' });
    } else if (w.dirty) {
      keep.push({ path: w.path, branch: w.branch, reason: 'has uncommitted changes' });
    } else if (w.state === 'stale') {
      // Unmerged + inactive: preserve first (push/bundle), then remove. Never
      // a blind delete of unmerged work.
      salvage.push({ path: w.path, branch: w.branch, reason: `unmerged + stale (age ${Math.round((w.ageMs || 0) / 86400000)}d, ${w.ahead} ahead) - push/bundle before removing` });
    } else if (unmergedWork) {
      keep.push({ path: w.path, branch: w.branch, reason: `unmerged work (${w.ahead} commits ahead)` });
    } else {
      keep.push({ path: w.path, branch: w.branch, reason: `state ${w.state}` });
    }
  }

  return { remove, salvage, keep };
}

module.exports = {
  STATES,
  DEFAULT_STALE_MS,
  classifyWorktree,
  analyzeWorktree,
  buildLifecycleReport,
  planCleanup
};
