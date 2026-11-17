/**
 * Tests for scripts/lib/astra-review/scope.js
 *
 * Run with: node tests/lib/astra-review-scope.test.js
 */

'use strict';

const assert = require('assert');
const path = require('path');
const scope = require('../../scripts/lib/astra-review/scope');

let passed = 0;
let failed = 0;

function test(name, fn) {
  try {
    fn();
    console.log(`  ✓ ${name}`);
    passed++;
  } catch (err) {
    console.log(`  ✗ ${name}`);
    console.log(`    Error: ${err.message}`);
    failed++;
  }
}

// Git reports slash-separated paths; the filesystem side must be native so
// these fixtures hold on Windows as well as POSIX.
const ROOT = path.resolve('/repo');
const R = (...parts) => path.join(ROOT, ...parts);
const OUTSIDE = path.resolve('/outside');
const REGULAR_FILE = () => ({ isSymbolicLink: () => false, isFile: () => true });
const enoent = () => { throw Object.assign(new Error('ENOENT'), { code: 'ENOENT' }); };
const lstatOnly = (present) => (file) => (present.includes(file) ? REGULAR_FILE() : enoent());
const HEAD_RESOLVES = [/^rev-parse -q --verify HEAD\^\{commit\}$/, 'headsha\n'];

function fakeGit(responses, { unbornHead = false } = {}) {
  const calls = [];
  const rules = unbornHead ? responses : [...responses, HEAD_RESOLVES];
  const runGit = (args) => {
    calls.push(args);
    const key = args.join(' ');
    for (const [pattern, value] of rules) {
      if (pattern.test(key)) return value;
    }
    return '';
  };
  return { runGit, calls };
}

console.log('=== Testing astra-review/scope.js ===\n');

test('parseScope defaults to uncommitted changes', () => {
  assert.deepStrictEqual(scope.parseScope({}), { kind: 'uncommitted', value: null });
});

test('parseScope rejects more than one scope selector', () => {
  assert.throws(
    () => scope.parseScope({ base: 'main', commit: 'abc' }),
    /only one of/
  );
});

test('parseScope rejects git-option-like or blank revisions', () => {
  assert.throws(() => scope.parseScope({ base: '--output=/tmp/x' }), /invalid base/);
  assert.throws(() => scope.parseScope({ commit: 'a b' }), /invalid commit/);
});

test('parseScope accepts revision expressions such as HEAD~1 and main^', () => {
  assert.strictEqual(scope.parseScope({ commit: 'HEAD~1' }).value, 'HEAD~1');
  assert.strictEqual(scope.parseScope({ base: 'origin/main^' }).value, 'origin/main^');
});

test('collectChanges keeps file names with spaces and non-ASCII characters intact', () => {
  const git = fakeGit([
    [/^diff --cached --name-only -z HEAD --$/, ' lead.js\0日本語 ファイル.js\0'],
    [/^diff --no-ext-diff --no-textconv --cached HEAD --$/, '+d\n'],
  ]);

  const result = scope.collectChanges({ kind: 'uncommitted', value: null }, { runGit: git.runGit });

  assert.deepStrictEqual(result.files, [' lead.js', '日本語 ファイル.js']);
});

test('collectChanges (uncommitted) merges staged, unstaged, and untracked changes', () => {
  const git = fakeGit([
    [/^rev-parse --show-toplevel$/, '/repo\n'],
    [/^diff --cached --name-only -z HEAD --$/, 'src/staged.js\0src/both.js\0'],
    [/^diff --name-only -z --$/, 'src/both.js\0src/unstaged.js\0'],
    [/^ls-files --others --exclude-standard -z$/, 'src/new.js\0'],
    [/^diff --no-ext-diff --no-textconv --cached HEAD --$/, '+staged change\n'],
    [/^diff --no-ext-diff --no-textconv --$/, '+unstaged change\n'],
    [/^diff --no-ext-diff --no-textconv --no-index -- \/dev\/null src\/new\.js$/, '+brand new\n'],
  ]);

  const result = scope.collectChanges({ kind: 'uncommitted', value: null }, { runGit: git.runGit });

  assert.deepStrictEqual(result.files, ['src/staged.js', 'src/both.js', 'src/unstaged.js', 'src/new.js']);
  assert.ok(result.diff.includes('+staged change'));
  assert.ok(result.diff.includes('+unstaged change'));
  assert.ok(result.diff.includes('+brand new'));
  assert.strictEqual(result.root, ROOT);
  assert.strictEqual(result.truncated, false);
});

test('collectChanges still reports a staged change that was reverted only in the working tree', () => {
  const git = fakeGit([
    [/^rev-parse --show-toplevel$/, '/repo\n'],
    [/^diff --cached --name-only -z HEAD --$/, 'src/a.js\0'],
    [/^diff --no-ext-diff --no-textconv --cached HEAD --$/, '+staged only\n'],
    [/^diff --name-only -z --$/, 'src/a.js\0'],
    [/^diff --no-ext-diff --no-textconv --$/, '-staged only\n'],
  ]);

  const result = scope.collectChanges({ kind: 'uncommitted', value: null }, { runGit: git.runGit });

  assert.deepStrictEqual(result.files, ['src/a.js']);
  assert.ok(result.diff.includes('+staged only'));
});

test('collectChanges runs git from the repository root, not the current subdirectory', () => {
  const cwds = [];
  const runGit = (args, cwd) => {
    cwds.push(cwd);
    if (args.join(' ') === 'rev-parse --show-toplevel') return '/repo\n';
    return '';
  };

  scope.collectChanges({ kind: 'uncommitted', value: null }, { runGit, cwd: R('scripts') });

  assert.strictEqual(cwds[0], R('scripts'));
  assert.ok(cwds.slice(1).every((cwd) => cwd === ROOT), `expected ${ROOT}, got ${cwds.slice(1)}`);
});

test('collectChanges against a base branch diffs merge-base to the working tree, plus untracked files', () => {
  const git = fakeGit([
    [/^merge-base main HEAD$/, 'mb123\n'],
    [/^diff --cached --name-only -z mb123 --$/, 'lib/x.js\0'],
    [/^ls-files --others --exclude-standard -z$/, 'lib/new.js\0'],
    [/^diff --no-ext-diff --no-textconv --cached mb123 --$/, '+x\n'],
    [/^diff --no-ext-diff --no-textconv --no-index -- \/dev\/null lib\/new\.js$/, '+new\n'],
  ]);

  const result = scope.collectChanges({ kind: 'base', value: 'main' }, { runGit: git.runGit });

  assert.deepStrictEqual(result.files, ['lib/x.js', 'lib/new.js']);
  assert.ok(result.diff.includes('+x'));
  assert.ok(result.diff.includes('+new'));
});

test('collectChanges for a commit resolves the revision, then diffs against its first parent', () => {
  const git = fakeGit([
    [/^rev-parse --verify --end-of-options HEAD~1\^\{commit\}$/, 'abc1234\n'],
    [/^rev-list --parents -n 1 abc1234$/, 'abc1234 parent1 parent2\n'],
    [/^diff --no-renames --name-only -z parent1 abc1234 --$/, 'a.js\0b.js\0'],
    [/^diff --no-ext-diff --no-textconv parent1 abc1234 --$/, '+commit diff\n'],
  ]);

  const result = scope.collectChanges({ kind: 'commit', value: 'HEAD~1' }, { runGit: git.runGit });

  assert.deepStrictEqual(result.files, ['a.js', 'b.js']);
  assert.strictEqual(result.diff, '+commit diff\n');
});

test('collectChanges for a root commit falls back to diff-tree --root and git show', () => {
  const git = fakeGit([
    [/^rev-parse --verify --end-of-options root0\^\{commit\}$/, 'a00b000\n'],
    [/^rev-list --parents -n 1 a00b000$/, 'a00b000\n'],
    [/^diff-tree --no-renames --no-commit-id --root --name-only -r -z a00b000$/, 'init.js\0'],
    [/^show --no-ext-diff --no-textconv --format= a00b000 --$/, '+init\n'],
  ]);

  const result = scope.collectChanges({ kind: 'commit', value: 'root0' }, { runGit: git.runGit });

  assert.deepStrictEqual(result.files, ['init.js']);
  assert.strictEqual(result.diff, '+init\n');
});

test('collectChanges for explicit files reads file contents', () => {
  const readFile = (file) => `content of ${path.basename(file)}`;

  const result = scope.collectChanges(
    { kind: 'files', value: ['one.js', 'two.js'] },
    { runGit: () => '', readFile, cwd: ROOT, lstatSync: REGULAR_FILE }
  );

  assert.deepStrictEqual(result.files, ['one.js', 'two.js']);
  assert.ok(result.diff.includes('content of one.js'));
  assert.ok(result.diff.includes('=== two.js ==='));
});

test('collectChanges resolves explicit relative paths against the invocation directory, displayed root-relative', () => {
  const read = [];
  const readFile = (file) => { read.push(file); return 'x'; };
  const runGit = (args) => (args.join(' ') === 'rev-parse --show-toplevel' ? '/repo\n' : '');

  const result = scope.collectChanges(
    { kind: 'files', value: ['AGENTS.md'] },
    { runGit, readFile, cwd: R('docs', 'zh-CN'), lstatSync: REGULAR_FILE }
  );

  assert.deepStrictEqual(read, [R('docs', 'zh-CN', 'AGENTS.md')]);
  assert.deepStrictEqual(result.files, ['docs/zh-CN/AGENTS.md']);
  assert.ok(result.diff.includes('=== docs/zh-CN/AGENTS.md ==='));
});

test('collectChanges compares the index against the empty tree when HEAD is unborn', () => {
  const git = fakeGit([
    [/^diff --cached --name-only -z 4b825dc642cb6eb9a060e54bf8d69288fbee4904 --$/, 'first.js\0'],
    [/^diff --no-ext-diff --no-textconv --cached 4b825dc642cb6eb9a060e54bf8d69288fbee4904 --$/, '+first\n'],
    [/^ls-files --others --exclude-standard -z$/, 'draft.js\0'],
    [/^diff --no-ext-diff --no-textconv --no-index -- \/dev\/null draft\.js$/, '+draft\n'],
  ], { unbornHead: true });

  const result = scope.collectChanges({ kind: 'uncommitted', value: null }, { runGit: git.runGit });

  assert.deepStrictEqual(result.files, ['first.js', 'draft.js']);
  assert.ok(result.diff.includes('+first'));
  assert.ok(result.diff.includes('+draft'));
});

test('collectChanges truncates oversized diffs and flags it', () => {
  const big = 'x'.repeat(scope.MAX_DIFF_BYTES + 100);
  const git = fakeGit([
    [/^diff --cached --name-only -z HEAD --$/, 'big.js\0'],
    [/^diff --no-ext-diff --no-textconv --cached HEAD --$/, big],
  ]);

  const result = scope.collectChanges({ kind: 'uncommitted', value: null }, { runGit: git.runGit });

  assert.strictEqual(result.truncated, true);
  assert.ok(Buffer.byteLength(result.diff, 'utf8') <= scope.MAX_DIFF_BYTES + 200);
});

test('collectChanges returns empty result when nothing changed', () => {
  const git = fakeGit([]);

  const result = scope.collectChanges({ kind: 'uncommitted', value: null }, { runGit: git.runGit });

  assert.deepStrictEqual(result.files, []);
  assert.strictEqual(result.diff, '');
});

test('collectChanges returns a recovery hint naming the resolved commit and parent', () => {
  const git = fakeGit([
    [/^rev-parse --verify --end-of-options HEAD~1\^\{commit\}$/, 'abc1234\n'],
    [/^rev-list --parents -n 1 abc1234$/, 'abc1234 parent1\n'],
  ]);

  const result = scope.collectChanges({ kind: 'commit', value: 'HEAD~1' }, { runGit: git.runGit });

  assert.ok(result.recovery.includes('git diff parent1 abc1234 --'));
  assert.ok(result.recovery.includes('git show abc1234:'));
});

test('collectChanges returns a recovery hint for index and working tree on uncommitted reviews', () => {
  const git = fakeGit([]);

  const result = scope.collectChanges({ kind: 'uncommitted', value: null }, { runGit: git.runGit });

  assert.ok(result.recovery.includes('git diff --cached HEAD --'));
  assert.ok(result.recovery.includes('git show :<path>'));
  assert.ok(result.recovery.includes('git diff --'));
});

test('collectChanges returns a recovery hint that reads files directly for explicit files', () => {
  const result = scope.collectChanges(
    { kind: 'files', value: ['a.js'] },
    { runGit: () => '', readFile: () => 'x', cwd: ROOT, lstatSync: REGULAR_FILE }
  );

  assert.ok(/read/i.test(result.recovery));
});

test('parseScope accepts --files-from-commit as its own scope kind', () => {
  assert.deepStrictEqual(scope.parseScope({ filesFromCommit: 'HEAD' }), { kind: 'files-from-commit', value: 'HEAD' });
  assert.throws(() => scope.parseScope({ filesFromCommit: 'HEAD', commit: 'HEAD' }), /only one of/);
});

test('files-from-commit reviews current contents of touched files and keeps still-deleted ones with their hunk', () => {
  const git = fakeGit([
    [/^rev-parse --show-toplevel$/, '/repo\n'],
    [/^rev-parse --verify --end-of-options HEAD\^\{commit\}$/, 'abc1234\n'],
    [/^rev-list --parents -n 1 abc1234$/, 'abc1234 parent1\n'],
    [/^diff --no-renames --name-only -z parent1 abc1234 --$/, 'kept.js\0gone-later.js\0'],
    [/^diff --no-ext-diff --no-textconv parent1 -- gone-later\.js$/, '-was here\n'],
  ]);
  const readFile = (file) => `now: ${path.basename(file)}`;

  const result = scope.collectChanges({ kind: 'files-from-commit', value: 'HEAD' }, { runGit: git.runGit, readFile, cwd: R('sub'), lstatSync: lstatOnly([R('kept.js')]) });

  assert.deepStrictEqual(result.files, ['kept.js', 'gone-later.js']);
  assert.ok(result.diff.includes('now: kept.js'));
  assert.ok(result.diff.includes('=== gone-later.js === (absent now'));
  assert.ok(result.diff.includes('-was here'));
});

test('files-from-commit handles a root commit', () => {
  const git = fakeGit([
    [/^rev-parse --show-toplevel$/, '/repo\n'],
    [/^rev-parse --verify --end-of-options a00b000\^\{commit\}$/, 'a00b000\n'],
    [/^rev-list --parents -n 1 a00b000$/, 'a00b000\n'],
    [/^diff-tree --no-renames --no-commit-id --root -r --name-only -z a00b000$/, 'init.js\0'],
  ]);

  const result = scope.collectChanges({ kind: 'files-from-commit', value: 'a00b000' }, { runGit: git.runGit, readFile: () => 'x', cwd: ROOT, lstatSync: REGULAR_FILE });

  assert.deepStrictEqual(result.files, ['init.js']);
});

test('files-from-commit includes a file the commit deleted once it has been restored', () => {
  const git = fakeGit([
    [/^rev-parse --show-toplevel$/, '/repo\n'],
    [/^rev-parse --verify --end-of-options HEAD\^\{commit\}$/, 'abc1234\n'],
    [/^rev-list --parents -n 1 abc1234$/, 'abc1234 parent1\n'],
    [/^diff --no-renames --name-only -z parent1 abc1234 --$/, 'restored.js\0'],
  ]);

  const result = scope.collectChanges(
    { kind: 'files-from-commit', value: 'HEAD' },
    { runGit: git.runGit, readFile: () => 'back', cwd: ROOT, lstatSync: lstatOnly([R('restored.js')]) }
  );

  assert.deepStrictEqual(result.files, ['restored.js']);
});

test('collectFiles serializes symlinks instead of following them', () => {
  let readCalled = false;
  const result = scope.collectChanges(
    { kind: 'files', value: ['link.js'] },
    {
      runGit: (args) => (args.join(' ') === 'rev-parse --show-toplevel' ? '/repo\n' : ''),
      cwd: ROOT,
      lstatSync: () => ({ isSymbolicLink: () => true, isFile: () => false }),
      readlinkSync: () => '/etc/passwd',
      readFile: () => { readCalled = true; return 'secret'; },
    }
  );

  assert.strictEqual(readCalled, false);
  assert.ok(result.diff.includes('symlink -> /etc/passwd'));
  assert.ok(!result.diff.includes('secret'));
});

test('collectFiles refuses paths that resolve outside the repository root', () => {
  assert.throws(
    () => scope.collectChanges(
      { kind: 'files', value: ['../outside.js'] },
      {
        runGit: (args) => (args.join(' ') === 'rev-parse --show-toplevel' ? '/repo\n' : ''),
        cwd: ROOT,
        lstatSync: () => ({ isSymbolicLink: () => false, isFile: () => true }),
        readFile: () => 'x',
      }
    ),
    /outside the repository/
  );
});

test('collectFiles refuses non-regular files such as directories', () => {
  assert.throws(
    () => scope.collectChanges(
      { kind: 'files', value: ['src'] },
      {
        runGit: (args) => (args.join(' ') === 'rev-parse --show-toplevel' ? '/repo\n' : ''),
        cwd: ROOT,
        lstatSync: () => ({ isSymbolicLink: () => false, isFile: () => false }),
        readFile: () => 'x',
      }
    ),
    /not a regular file/
  );
});

test('collectFiles refuses files under a symlinked parent directory that resolves outside the repo', () => {
  assert.throws(
    () => scope.collectChanges(
      { kind: 'files', value: ['external/secret.txt'] },
      {
        runGit: (args) => (args.join(' ') === 'rev-parse --show-toplevel' ? '/repo\n' : ''),
        cwd: ROOT,
        realpathSync: (target) => (target === R('external') ? OUTSIDE : target),
        lstatSync: REGULAR_FILE,
        readFile: () => 'secret',
      }
    ),
    /outside the repository/
  );
});

test('files-from-commit keeps unresolved deletions in scope with their deletion diff', () => {
  const git = fakeGit([
    [/^rev-parse --show-toplevel$/, '/repo\n'],
    [/^rev-parse --verify --end-of-options HEAD\^\{commit\}$/, 'abc1234\n'],
    [/^rev-list --parents -n 1 abc1234$/, 'abc1234 parent1\n'],
    [/^diff --no-renames --name-only -z parent1 abc1234 --$/, 'removed.js\0'],
    [/^diff --no-ext-diff --no-textconv parent1 -- removed\.js$/, 'deleted file mode 100644\n-old code\n'],
  ]);

  const result = scope.collectChanges(
    { kind: 'files-from-commit', value: 'HEAD' },
    { runGit: git.runGit, readFile: () => 'x', cwd: ROOT, lstatSync: lstatOnly([]) }
  );

  assert.deepStrictEqual(result.files, ['removed.js']);
  assert.ok(result.diff.includes('absent now'));
  assert.ok(result.diff.includes('-old code'));
  assert.ok(result.recovery.includes('git diff parent1 -- <path>'), 'absent paths need a git-based recovery hint');
});

test('files-from-commit labels a file the commit added and the repair removed as nothing left to diff', () => {
  const git = fakeGit([
    [/^rev-parse --show-toplevel$/, '/repo\n'],
    [/^rev-parse --verify --end-of-options HEAD\^\{commit\}$/, 'abc1234\n'],
    [/^rev-list --parents -n 1 abc1234$/, 'abc1234 parent1\n'],
    [/^diff --no-renames --name-only -z parent1 abc1234 --$/, 'added-then-removed.js\0'],
  ]);

  const result = scope.collectChanges(
    { kind: 'files-from-commit', value: 'HEAD' },
    { runGit: git.runGit, readFile: () => 'x', cwd: ROOT, lstatSync: lstatOnly([]) }
  );

  assert.deepStrictEqual(result.files, ['added-then-removed.js']);
  assert.ok(result.diff.includes('since removed'));
});

test('files-from-commit treats ENOTDIR (parent directory replaced by a file) as absent', () => {
  const git = fakeGit([
    [/^rev-parse --show-toplevel$/, '/repo\n'],
    [/^rev-parse --verify --end-of-options HEAD\^\{commit\}$/, 'abc1234\n'],
    [/^rev-list --parents -n 1 abc1234$/, 'abc1234 parent1\n'],
    [/^diff --no-renames --name-only -z parent1 abc1234 --$/, 'config\0config/settings.js\0'],
    [/^diff --no-ext-diff --no-textconv parent1 -- config\/settings\.js$/, '-old setting\n'],
  ]);
  const lstatSync = (file) => {
    if (file === R('config')) return REGULAR_FILE();
    throw Object.assign(new Error('ENOTDIR'), { code: 'ENOTDIR' });
  };

  const result = scope.collectChanges(
    { kind: 'files-from-commit', value: 'HEAD' },
    { runGit: git.runGit, readFile: () => 'now a file', cwd: ROOT, lstatSync }
  );

  assert.deepStrictEqual(result.files, ['config', 'config/settings.js']);
  assert.ok(result.diff.includes('now a file'));
  assert.ok(result.diff.includes('-old setting'));
});

test('files-from-commit treats a dangling symlink as present and serializes the link itself', () => {
  const git = fakeGit([
    [/^rev-parse --show-toplevel$/, '/repo\n'],
    [/^rev-parse --verify --end-of-options HEAD\^\{commit\}$/, 'abc1234\n'],
    [/^rev-list --parents -n 1 abc1234$/, 'abc1234 parent1\n'],
    [/^diff --no-renames --name-only -z parent1 abc1234 --$/, 'link.js\0'],
  ]);
  let readCalled = false;

  const result = scope.collectChanges(
    { kind: 'files-from-commit', value: 'HEAD' },
    {
      runGit: git.runGit,
      cwd: ROOT,
      lstatSync: () => ({ isSymbolicLink: () => true, isFile: () => false }),
      readlinkSync: () => 'missing-target.js',
      readFile: () => { readCalled = true; return 'x'; },
    }
  );

  assert.deepStrictEqual(result.files, ['link.js']);
  assert.strictEqual(readCalled, false);
  assert.ok(result.diff.includes('symlink -> missing-target.js'));
  assert.ok(!result.diff.includes('still deleted'));
});

test('files-from-commit describes a submodule (gitlink) directory instead of failing', () => {
  const git = fakeGit([
    [/^rev-parse --show-toplevel$/, '/repo\n'],
    [/^rev-parse --verify --end-of-options HEAD\^\{commit\}$/, 'abc1234\n'],
    [/^rev-list --parents -n 1 abc1234$/, 'abc1234 parent1\n'],
    [/^diff --no-renames --name-only -z parent1 abc1234 --$/, 'vendor/lib\0'],
    [/^diff --no-ext-diff --no-textconv --submodule=short parent1 -- vendor\/lib$/, '-Subproject commit aaa\n+Subproject commit bbb\n'],
  ]);
  const lstatSync = () => ({ isSymbolicLink: () => false, isFile: () => false, isDirectory: () => true });

  const result = scope.collectChanges(
    { kind: 'files-from-commit', value: 'HEAD' },
    { runGit: git.runGit, cwd: ROOT, lstatSync, readFile: () => { throw new Error('must not read a directory'); } }
  );

  assert.deepStrictEqual(result.files, ['vendor/lib']);
  assert.ok(result.diff.includes('directory or submodule'));
  assert.ok(result.diff.includes('Subproject commit bbb'));
  assert.ok(result.diff.includes('parent1'), 'baseline is the reviewed commit parent, not HEAD');
});

test('collectChanges reports an untracked nested repository instead of diffing it', () => {
  const git = fakeGit([
    [/^rev-parse --show-toplevel$/, '/repo\n'],
    [/^ls-files --others --exclude-standard -z$/, 'nested-repo/\0plain.js\0'],
    [/^diff --no-ext-diff --no-textconv --no-index -- \/dev\/null plain\.js$/, '+plain\n'],
  ]);

  const result = scope.collectChanges({ kind: 'uncommitted', value: null }, { runGit: git.runGit });

  assert.deepStrictEqual(result.files, ['nested-repo/', 'plain.js']);
  assert.ok(result.diff.includes('nested repository'));
  assert.ok(result.diff.includes('+plain'));
  assert.ok(!git.calls.some((args) => args.includes('nested-repo/') && args.includes('--no-index')));
});

test('defaultRunGit distinguishes a no-index access failure from a genuine difference', () => {
  const accessError = () => ({ status: 1, stdout: '', stderr: 'error: Could not access nested-repo/' });

  assert.throws(
    () => scope.defaultRunGit(['diff', '--no-index', '--', '/dev/null', 'nested-repo/'], ROOT, {}, accessError),
    /Could not access/
  );
  const realDiff = () => ({ status: 1, stdout: '+x\n', stderr: '' });
  assert.strictEqual(scope.defaultRunGit(['diff', '--no-index', '--', '/dev/null', 'x'], ROOT, {}, realDiff), '+x\n');
});

test('defaultRunGit fails loudly when a file inventory overflows the buffer', () => {
  const overflow = () => ({ error: Object.assign(new Error('x'), { code: 'ENOBUFS' }), stdout: 'partial.js\0', status: null });

  assert.throws(
    () => scope.defaultRunGit(['ls-files', '--others', '-z'], ROOT, {}, overflow),
    /exceeded .* inventory would be incomplete/
  );
});

test('defaultRunGit returns partial output only for diff payloads marked partialOk', () => {
  const overflow = () => ({ error: Object.assign(new Error('x'), { code: 'ENOBUFS' }), stdout: '+partial', status: null });

  const out = scope.defaultRunGit(['diff', 'HEAD', '--'], ROOT, { partialOk: true }, overflow);

  assert.strictEqual(out, '+partial');
});

test('defaultRunGit returns empty output for a failed probe when allowFailure is set', () => {
  const failed = () => ({ status: 128, stdout: '', stderr: 'fatal: bad revision' });

  assert.strictEqual(scope.defaultRunGit(['rev-parse', '-q', '--verify', 'HEAD'], ROOT, { allowFailure: true }, failed), '');
  assert.throws(() => scope.defaultRunGit(['rev-parse', '-q', '--verify', 'HEAD'], ROOT, {}, failed), /bad revision/);
});

console.log(`\n${passed} passed, ${failed} failed`);
process.exit(failed > 0 ? 1 : 0);
