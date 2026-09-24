'use strict';

const { spawnSync } = require('child_process');

// Thin, injectable git command layer. All git interaction in the lifecycle
// service goes through a runner so tests can feed canned output without a real
// repository. The default runner shells out with spawnSync.
// Git env vars that, if inherited (e.g. when this service runs inside a git
// hook), would override the -C/cwd target and point git at the host repo.
const INHERITED_GIT_ENV = ['GIT_DIR', 'GIT_WORK_TREE', 'GIT_INDEX_FILE', 'GIT_COMMON_DIR', 'GIT_PREFIX'];

function hermeticGitEnv() {
  const env = { ...process.env };
  for (const key of INHERITED_GIT_ENV) {
    delete env[key];
  }
  return env;
}

function defaultRunImpl(args, options = {}) {
  const result = spawnSync('git', args, {
    cwd: options.cwd,
    encoding: 'utf8',
    stdio: ['ignore', 'pipe', 'pipe'],
    maxBuffer: 32 * 1024 * 1024,
    env: hermeticGitEnv()
  });

  return {
    status: typeof result.status === 'number' ? result.status : 1,
    stdout: result.stdout || '',
    stderr: result.stderr || ''
  };
}

function createGitRunner(repoRoot, runImpl = defaultRunImpl) {
  function run(args) {
    return runImpl(args, { cwd: repoRoot });
  }

  function succeeds(args) {
    return run(args).status === 0;
  }

  function stdoutOf(args) {
    const result = run(args);
    return result.status === 0 ? (result.stdout || '').trim() : '';
  }

  return {
    repoRoot,
    run,
    succeeds,

    isGitRepo() {
      return succeeds(['rev-parse', '--is-inside-work-tree']);
    },

    branchExists(branch) {
      return succeeds(['show-ref', '--verify', '--quiet', `refs/heads/${branch}`]);
    },

    // Porcelain worktree list -> [{ path, branch, head, detached, bare }]
    listWorktrees() {
      const result = run(['worktree', 'list', '--porcelain']);
      if (result.status !== 0) {
        return [];
      }

      const worktrees = [];
      let current = null;

      for (const rawLine of (result.stdout || '').split('\n')) {
        const line = rawLine.trim();
        if (line.startsWith('worktree ')) {
          if (current) {
            worktrees.push(current);
          }
          current = { path: line.slice('worktree '.length).trim(), branch: null, head: null, detached: false, bare: false };
        } else if (current && line.startsWith('branch ')) {
          current.branch = line.slice('branch '.length).replace(/^refs\/heads\//, '').trim();
        } else if (current && line.startsWith('HEAD ')) {
          current.head = line.slice('HEAD '.length).trim();
        } else if (current && line === 'detached') {
          current.detached = true;
        } else if (current && line === 'bare') {
          current.bare = true;
        }
      }

      if (current) {
        worktrees.push(current);
      }

      return worktrees;
    },

    // Uncommitted changes in a worktree (status --porcelain over its own path).
    isDirty(worktreePath) {
      const result = runImpl(['status', '--porcelain'], { cwd: worktreePath });
      return result.status === 0 ? (result.stdout || '').trim().length > 0 : false;
    },

    // Commits a branch is ahead of / behind its base. Returns null if either
    // ref is missing (e.g. branch already merged-and-deleted).
    aheadBehind(branch, baseBranch) {
      const out = stdoutOf(['rev-list', '--left-right', '--count', `${baseBranch}...${branch}`]);
      const match = out.match(/^(\d+)\s+(\d+)$/);
      if (!match) {
        return null;
      }
      return { behind: Number(match[1]), ahead: Number(match[2]) };
    },

    // Last commit time (epoch ms) on a branch.
    lastCommitMs(branch) {
      const out = stdoutOf(['log', '-1', '--format=%ct', branch]);
      const seconds = Number(out);
      return Number.isFinite(seconds) && seconds > 0 ? seconds * 1000 : null;
    },

    // Predict merge conflicts WITHOUT touching the working tree using
    // `git merge-tree`. Prefers the modern --write-tree form (Git 2.38+),
    // which exits non-zero and lists conflicted paths on conflict.
    predictMergeConflicts(branch, baseBranch) {
      const modern = run(['merge-tree', '--write-tree', '--name-only', baseBranch, branch]);
      if (modern.status === 0) {
        return { conflicted: false, files: [], method: 'merge-tree' };
      }

      // Non-zero with parseable output => real conflict (modern form).
      if (modern.stdout && /\S/.test(modern.stdout)) {
        const lines = modern.stdout.split('\n').map(l => l.trim()).filter(Boolean);
        // First line is the tree oid; subsequent lines are conflicted paths.
        const files = lines.slice(1).filter(line => !/^[0-9a-f]{40}$/i.test(line));
        return { conflicted: true, files, method: 'merge-tree' };
      }

      // Fallback to the legacy form (older Git): conflict markers in output.
      const legacy = run(['merge-tree', baseBranch, baseBranch, branch]);
      const hasMarkers = /^<{7}|^={7}|^>{7}/m.test(legacy.stdout || '')
        || /\+<{7}|changed in both/m.test(legacy.stdout || '');
      return { conflicted: hasMarkers, files: [], method: 'merge-tree-legacy' };
    }
  };
}

module.exports = {
  createGitRunner,
  defaultRunImpl
};
