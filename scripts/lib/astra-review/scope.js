/**
 * Astra review: collect the code under review from git.
 *
 * Supported scopes:
 *   uncommitted        staged + unstaged + untracked changes (default)
 *   base               working tree relative to the merge-base with a branch
 *   commit             changes introduced by one commit (against its first parent)
 *   files              full contents of explicit files
 *   files-from-commit  current contents of the files a commit touched (repair rounds)
 */

'use strict';

const fs = require('fs');
const path = require('path');
const { spawnSync } = require('child_process');

const MAX_DIFF_BYTES = 200 * 1024;
// Twice the diff cap: enough to detect overflow without holding a huge diff in memory.
const MAX_GIT_BUFFER = MAX_DIFF_BYTES * 2;
const TRUNCATION_NOTE = '\n\n[diff truncated: read the listed files directly for full context]\n';
// Any git revision expression (HEAD~1, main^, origin/main@{1}) is allowed as long as it
// cannot be parsed as an option or contain whitespace/NUL. The real check happens in
// git rev-parse with --end-of-options.
const SAFE_REF = /^[^-\s\0][^\s\0]*$/;

// git's well-known empty tree object; lets an unborn HEAD diff against "nothing".
const EMPTY_TREE = '4b825dc642cb6eb9a060e54bf8d69288fbee4904';

/**
 * @param {string[]} args
 * @param {string} cwd
 * @param {{allowFailure?: boolean, partialOk?: boolean}} [options]
 *   allowFailure: a non-zero exit returns '' (probes such as rev-parse -q --verify)
 *   partialOk: output beyond the buffer is returned truncated (diff payloads only);
 *              file inventories must never be partial or files would silently
 *              drop out of the review.
 * @param {Function} [spawn] injectable for tests
 */
function defaultRunGit(args, cwd, { allowFailure = false, partialOk = false } = {}, spawn = spawnSync) {
  const result = spawn('git', args, {
    cwd,
    encoding: 'utf8',
    maxBuffer: MAX_GIT_BUFFER,
    windowsHide: true,
  });
  if (result.error && result.error.code === 'ENOBUFS') {
    if (partialOk) return result.stdout || '';
    throw new Error(`git ${args.join(' ')} output exceeded ${MAX_GIT_BUFFER} bytes; file inventory would be incomplete`);
  }
  if (result.error) throw new Error(`git ${args[0]} failed: ${result.error.message}`);
  if (result.status !== 0 && allowFailure) return '';
  // `git diff --no-index` exits 1 when the files differ, which is the expected
  // case; exit 1 with no patch and an error on stderr is an access failure.
  const genuineDiff = args[0] === 'diff' && result.status === 1
    && ((result.stdout || '').length > 0 || !(result.stderr || '').trim());
  if (result.status !== 0 && !genuineDiff) {
    const detail = (result.stderr || '').trim().split('\n').slice(-1)[0];
    throw new Error(`git ${args.join(' ')} failed${detail ? `: ${detail}` : ''}`);
  }
  return result.stdout || '';
}

function assertSafeRef(value, label) {
  if (typeof value !== 'string' || !SAFE_REF.test(value)) {
    throw new Error(`invalid ${label}: ${String(value)}`);
  }
  return value;
}

const SCOPE_KINDS = Object.freeze({ base: 'base', commit: 'commit', files: 'files', filesFromCommit: 'files-from-commit' });

/**
 * @param {{base?: string, commit?: string, files?: string[], filesFromCommit?: string}} options
 * @returns {{kind: string, value: string|string[]|null}}
 */
function parseScope(options) {
  const selected = Object.keys(SCOPE_KINDS).filter((key) => {
    const value = options[key];
    return Array.isArray(value) ? value.length > 0 : Boolean(value);
  });
  if (selected.length > 1) {
    throw new Error(`only one of --base, --commit, --files, or --files-from-commit may be given (got ${selected.join(', ')})`);
  }
  if (selected.length === 0) return { kind: 'uncommitted', value: null };

  const key = selected[0];
  const kind = SCOPE_KINDS[key];
  if (kind === 'files') return { kind, value: [...options.files] };
  return { kind, value: assertSafeRef(options[key], kind) };
}

// NUL-delimited output keeps file names with spaces, quotes, or non-ASCII intact.
function splitNul(text) {
  return text.split('\0').filter((entry) => entry.length > 0);
}

function resolveCommit(runGit, revision) {
  const sha = runGit(['rev-parse', '--verify', '--end-of-options', `${revision}^{commit}`]).trim();
  if (!/^[0-9a-f]{7,64}$/.test(sha)) throw new Error(`cannot resolve revision: ${revision}`);
  return sha;
}

const PARTIAL_OK = Object.freeze({ partialOk: true });
// Machine-consumed patches must not be replaced by a configured external diff
// tool (diff.external / GIT_EXTERNAL_DIFF) or altered by textconv filters.
const PLAIN_PATCH = Object.freeze(['--no-ext-diff', '--no-textconv']);

function unique(list) {
  return list.filter((entry, index) => list.indexOf(entry) === index);
}

/**
 * Staged and unstaged changes are collected separately so a change that is
 * staged but reverted in the working tree is still reviewed (git commit would
 * still commit it). Untracked files are appended as diffs against /dev/null.
 */
function collectWorkingTree(runGit, from) {
  const staged = splitNul(runGit(['diff', '--cached', '--name-only', '-z', from, '--']));
  const unstaged = splitNul(runGit(['diff', '--name-only', '-z', '--']));
  const untracked = splitNul(runGit(['ls-files', '--others', '--exclude-standard', '-z']));
  const stagedDiff = runGit(['diff', ...PLAIN_PATCH, '--cached', from, '--'], PARTIAL_OK);
  const unstagedDiff = runGit(['diff', ...PLAIN_PATCH, '--'], PARTIAL_OK);
  // git lists an untracked embedded repository as "dir/"; it cannot be diffed
  // from here, so it is reported rather than silently producing nothing.
  const untrackedDiffs = untracked.map((file) => (file.endsWith('/')
    ? `=== ${file} === (untracked nested repository; contents not reviewed, inspect it separately)`
    : runGit(['diff', ...PLAIN_PATCH, '--no-index', '--', '/dev/null', file], PARTIAL_OK)));
  const sections = [
    stagedDiff && `### staged (index vs ${from})\n${stagedDiff}`,
    unstagedDiff && `### unstaged (working tree vs index)\n${unstagedDiff}`,
    ...untrackedDiffs,
  ];
  return {
    files: unique([...staged, ...unstaged, ...untracked]),
    diff: sections.filter(Boolean).join('\n'),
    recovery: [
      `staged section: \`git diff --cached ${from} -- <path>\` (index content: \`git show :<path>\`)`,
      'unstaged section: `git diff -- <path>`',
      'untracked files: read the file directly',
    ].join('; '),
  };
}

/** HEAD does not exist before the first commit; diff the index against the empty tree then. */
function resolveHead(runGit) {
  const sha = runGit(['rev-parse', '-q', '--verify', 'HEAD^{commit}'], { allowFailure: true }).trim();
  return sha ? 'HEAD' : EMPTY_TREE;
}

function collectBase(runGit, base) {
  const mergeBase = runGit(['merge-base', base, 'HEAD']).trim();
  if (!mergeBase) throw new Error(`no merge base between ${base} and HEAD`);
  return collectWorkingTree(runGit, mergeBase);
}

/**
 * A commit is reviewed against its first parent so merge commits show the
 * changes they bring in. A root commit has no parent and uses --root/show.
 */
function collectCommit(runGit, revision) {
  const sha = resolveCommit(runGit, revision);
  const parents = runGit(['rev-list', '--parents', '-n', '1', sha]).trim().split(/\s+/).slice(1);
  if (parents.length === 0) {
    return {
      files: splitNul(runGit(['diff-tree', '--no-renames', '--no-commit-id', '--root', '--name-only', '-r', '-z', sha])),
      diff: runGit(['show', ...PLAIN_PATCH, '--format=', sha, '--'], PARTIAL_OK),
      recovery: `\`git show ${sha} -- <path>\` (file content at the commit: \`git show ${sha}:<path>\`)`,
    };
  }
  const parent = parents[0];
  return {
    files: splitNul(runGit(['diff', '--no-renames', '--name-only', '-z', parent, sha, '--'])),
    diff: runGit(['diff', ...PLAIN_PATCH, parent, sha, '--'], PARTIAL_OK),
    recovery: `\`git diff ${parent} ${sha} -- <path>\` (file content at the commit: \`git show ${sha}:<path>\`)`,
  };
}

/**
 * Read one file for the prompt without following symlinks or leaving the
 * repository: a committed symlink to an external file must never leak that
 * file's contents to the reviewer.
 */
function readForReview(absolute, root, io) {
  // Resolve the parent directory so a symlinked directory cannot smuggle in
  // files from outside the repository; the final component is checked by lstat.
  const resolved = path.join(io.realpathSync(path.dirname(absolute)), path.basename(absolute));
  const inside = resolved === root || resolved.startsWith(root + path.sep);
  if (!inside) throw new Error(`refusing to read ${absolute}: outside the repository root ${root}`);
  const stat = io.lstatSync(resolved);
  if (stat.isSymbolicLink()) return `(symlink -> ${io.readlinkSync(resolved)})`;
  if (!stat.isFile()) throw new Error(`refusing to read ${absolute}: not a regular file`);
  return io.readFile(resolved);
}

/** Git-style (forward-slash) display path, so reports look the same on every OS. */
function toGitPath(filePath) {
  return filePath.split(path.sep).join('/');
}

function collectFiles(io, files, cwd, root) {
  const entries = files.map((file) => {
    const absolute = path.resolve(cwd, file);
    const display = toGitPath(path.relative(root, absolute)) || file;
    return { display, content: readForReview(absolute, root, io) };
  });
  return {
    files: entries.map((entry) => entry.display),
    diff: entries.map((entry) => `=== ${entry.display} ===\n${entry.content}`).join('\n\n'),
    recovery: 'read each listed file directly from the working tree',
  };
}

/**
 * Files a commit touched, as they exist now (paths still deleted are skipped),
 * so a repair round after a FAIL can be reviewed even for merges and root commits.
 */
function collectFilesFromCommit(runGit, io, revision, root) {
  const sha = resolveCommit(runGit, revision);
  const parents = runGit(['rev-list', '--parents', '-n', '1', sha]).trim().split(/\s+/).slice(1);
  // --no-renames keeps both endpoints of a rename in the inventory, so the
  // removed source path still gets the absent-path treatment below.
  const touched = parents.length === 0
    ? splitNul(runGit(['diff-tree', '--no-renames', '--no-commit-id', '--root', '-r', '--name-only', '-z', sha]))
    : splitNul(runGit(['diff', '--no-renames', '--name-only', '-z', parents[0], sha, '--']));
  // Baseline is the reviewed commit's parent, so an unfixed change is still
  // visible in the repair round (HEAD would hide it).
  const baseline = parents.length === 0 ? EMPTY_TREE : parents[0];
  // lstat, not exists: a dangling symlink is still a current file to review.
  const existing = touched.filter((file) => pathEntryExists(io, path.resolve(root, file)));
  // A submodule (gitlink) shows up as a directory; report its pointer change
  // instead of trying to read it as a file.
  const directories = existing.filter((file) => isDirectory(io, path.resolve(root, file)));
  const present = existing.filter((file) => !directories.includes(file));
  const directorySections = directories.map((file) => {
    const pointer = runGit(['diff', ...PLAIN_PATCH, '--submodule=short', baseline, '--', file], PARTIAL_OK);
    return `=== ${file} === (directory or submodule; current pointer vs ${baseline} follows)\n${pointer || `(no change vs ${baseline})`}`;
  });
  // Paths that are absent now (deleted by the commit and never restored, or
  // removed during repair) stay under review as a deletion against the parent
  // baseline, so an unresolved or new deletion can never become an empty PASS.
  const absent = touched.filter((file) => !existing.includes(file));
  const absentSections = absent.map((file) => {
    const hunk = runGit(['diff', ...PLAIN_PATCH, baseline, '--', file], PARTIAL_OK);
    const status = hunk
      ? `absent now; deletion relative to ${baseline} (parent of ${sha}) follows`
      : `absent now; added by commit ${sha} and since removed, nothing left to diff`;
    return `=== ${file} === (${status})\n${hunk || '(no content)'}`;
  });
  const current = collectFiles(io, present, root, root);
  return {
    files: [...current.files, ...directories, ...absent],
    diff: [current.diff, ...directorySections, ...absentSections].filter(Boolean).join('\n\n'),
    recovery: `present files: ${current.recovery}; absent files: \`git diff ${baseline} -- <path>\` (original change: \`git show ${sha} -- <path>\`)`,
  };
}

function isDirectory(io, absolute) {
  const stat = io.lstatSync(absolute);
  return !stat.isSymbolicLink() && typeof stat.isDirectory === 'function' && stat.isDirectory();
}

function pathEntryExists(io, absolute) {
  try {
    io.lstatSync(absolute);
    return true;
  } catch (error) {
    // ENOTDIR: a parent directory was replaced by a regular file, so the path is gone too.
    if (error && (error.code === 'ENOENT' || error.code === 'ENOTDIR')) return false;
    throw error;
  }
}

function truncateDiff(diff) {
  if (Buffer.byteLength(diff, 'utf8') <= MAX_DIFF_BYTES) {
    return { diff, truncated: false };
  }
  const clipped = Buffer.from(diff, 'utf8').subarray(0, MAX_DIFF_BYTES).toString('utf8');
  return { diff: clipped + TRUNCATION_NOTE, truncated: true };
}

/**
 * @param {{kind: string, value: any}} scope
 * @param {{runGit?: Function, readFile?: Function, lstatSync?: Function, readlinkSync?: Function, realpathSync?: Function, cwd?: string}} [deps]
 * @returns {{files: string[], diff: string, truncated: boolean, root: string, recovery: string}}
 *   recovery: git commands that reproduce omitted diff sections for this exact revision
 */
function safeRealpath(target) {
  try {
    return fs.realpathSync(target);
  } catch {
    return target;
  }
}

/**
 * Canonical, platform-native paths keep the containment check honest when
 * /tmp is a symlink or when git reports a forward-slash path on Windows.
 * @param {{cwd?: string, runGit?: Function, realpathSync?: Function}} [deps]
 * @returns {{cwd: string, root: string}}
 */
function resolveRepoRoot(deps = {}) {
  const realpath = deps.realpathSync || safeRealpath;
  const cwd = realpath(path.resolve(deps.cwd || process.cwd()));
  const runGitIn = deps.runGit || defaultRunGit;
  const root = realpath(path.resolve(runGitIn(['rev-parse', '--show-toplevel'], cwd).trim() || cwd));
  return { cwd, root };
}

function collectChanges(scope, deps = {}) {
  const realpath = deps.realpathSync || safeRealpath;
  const runGitIn = deps.runGit || defaultRunGit;
  // Always work from the repository root so paths are root-relative and
  // untracked files outside the current subdirectory are not missed.
  const { cwd, root } = resolveRepoRoot(deps);
  const runGit = (args, options) => runGitIn(args, root, options);
  const io = {
    readFile: deps.readFile || ((file) => fs.readFileSync(file, 'utf8')),
    lstatSync: deps.lstatSync || fs.lstatSync,
    readlinkSync: deps.readlinkSync || fs.readlinkSync,
    realpathSync: realpath,
  };

  const collectors = {
    uncommitted: () => collectWorkingTree(runGit, resolveHead(runGit)),
    base: () => collectBase(runGit, scope.value),
    commit: () => collectCommit(runGit, scope.value),
    files: () => collectFiles(io, scope.value, cwd, root),
    'files-from-commit': () => collectFilesFromCommit(runGit, io, scope.value, root),
  };
  const collector = collectors[scope.kind];
  if (!collector) throw new Error(`unknown scope kind: ${scope.kind}`);

  const raw = collector();
  const { diff, truncated } = truncateDiff(raw.diff);
  return { files: raw.files, diff, truncated, root, recovery: raw.recovery };
}

function describeScope(scope) {
  if (scope.kind === 'uncommitted') return 'uncommitted changes';
  if (scope.kind === 'base') return `working tree relative to ${scope.value} (merge-base)`;
  if (scope.kind === 'commit') return `commit ${scope.value}`;
  if (scope.kind === 'files-from-commit') return `current contents of files touched by commit ${scope.value}`;
  return `${scope.value.length} explicit file(s)`;
}

module.exports = {
  MAX_DIFF_BYTES,
  MAX_GIT_BUFFER,
  collectChanges,
  defaultRunGit,
  describeScope,
  parseScope,
  resolveRepoRoot,
};
