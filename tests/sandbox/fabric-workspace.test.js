'use strict';

const assert = require('assert');
const fs = require('fs');
const os = require('os');
const path = require('path');
const { execFileSync } = require('child_process');
const {
  cleanupWorkspace,
  prepareWorkspace,
  runCommand,
} = require('../../scripts/sandbox/fabric/workspace');
const {
  buildPatchArtifact,
  copyVerifiedTree,
  digestArtifact,
  verifyCandidateTree,
} = require('../../scripts/sandbox/fabric/patch-artifact');

let passed = 0;
let failed = 0;

function test(name, fn) {
  try {
    fn();
    console.log(`  ✓ ${name}`);
    passed += 1;
  } catch (error) {
    console.log(`  ✗ ${name}`);
    console.log(`    Error: ${error.stack || error.message}`);
    failed += 1;
  }
}

function withTemp(fn) {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'ecc-fabric-workspace-'));
  try {
    return fn(root);
  } finally {
    fs.rmSync(root, { recursive: true, force: true });
  }
}

function git(cwd, ...args) {
  return execFileSync('git', args, {
    cwd,
    encoding: 'utf8',
    env: {
      ...process.env,
      GIT_AUTHOR_NAME: 'ECC Test',
      GIT_AUTHOR_EMAIL: 'ecc-test@example.invalid',
      GIT_COMMITTER_NAME: 'ECC Test',
      GIT_COMMITTER_EMAIL: 'ecc-test@example.invalid',
    },
  }).trim();
}

function createRepository(root) {
  const repository = path.join(root, 'repository');
  fs.mkdirSync(repository);
  git(repository, 'init', '-b', 'main');
  fs.writeFileSync(path.join(repository, 'keep.txt'), 'original\n');
  fs.writeFileSync(path.join(repository, 'delete.txt'), 'remove me\n');
  fs.mkdirSync(path.join(repository, 'nested'));
  fs.writeFileSync(path.join(repository, 'nested', 'stable.txt'), 'stable\n');
  git(repository, 'add', '.');
  git(repository, 'commit', '-m', 'base');
  return repository;
}

function copyTree(source, destination) {
  fs.cpSync(source, destination, {
    recursive: true,
    filter: candidate => path.basename(candidate) !== '.git',
  });
}

function withPatchedFs(method, replacement, fn) {
  const original = fs[method];
  fs[method] = replacement(original);
  try {
    return fn();
  } finally {
    fs[method] = original;
  }
}

console.log('\n=== ECC fabric workspace and patch tests ===\n');

test('returns an immutable in-place receipt and never removes the source', () => withTemp(root => {
  const source = createRepository(root);
  const receipt = prepareWorkspace({
    mode: 'in-place',
    sourcePath: source,
    runDirectory: path.join(root, 'run'),
    ownerToken: 'owner-a',
    trust: 'first-party',
  });

  assert.strictEqual(receipt.mode, 'in-place');
  assert.strictEqual(receipt.path, fs.realpathSync.native(source));
  assert.strictEqual(receipt.owned, false);
  assert.ok(Object.isFrozen(receipt));
  assert.deepStrictEqual(cleanupWorkspace(receipt, { ownerToken: 'owner-a' }), {
    attempted: false,
    pass: true,
    retained: true,
  });
  assert.ok(fs.existsSync(path.join(source, 'keep.txt')));
}));

test('creates and exactly cleans an isolated copy without Git metadata', () => withTemp(root => {
  const source = createRepository(root);
  const runDirectory = path.join(root, 'run');
  const receipt = prepareWorkspace({
    mode: 'isolated-copy',
    sourcePath: source,
    runDirectory,
    ownerToken: 'owner-copy',
    trust: 'untrusted',
  });

  assert.strictEqual(receipt.mode, 'isolated-copy');
  assert.strictEqual(receipt.owned, true);
  assert.ok(receipt.path.startsWith(`${fs.realpathSync.native(runDirectory)}${path.sep}`));
  assert.strictEqual(fs.readFileSync(path.join(receipt.path, 'keep.txt'), 'utf8'), 'original\n');
  assert.strictEqual(fs.existsSync(path.join(receipt.path, '.git')), false);
  assert.match(receipt.input_digest, /^[a-f0-9]{64}$/);

  fs.writeFileSync(path.join(receipt.path, 'keep.txt'), 'candidate\n');
  const cleanup = cleanupWorkspace(receipt, { ownerToken: 'owner-copy' });
  assert.deepStrictEqual(cleanup, { attempted: true, pass: true, retained: false });
  assert.strictEqual(fs.existsSync(receipt.path), false);
  assert.strictEqual(fs.readFileSync(path.join(source, 'keep.txt'), 'utf8'), 'original\n');
}));

test('isolated copy uses the Git file set and skips ignored dependency symlinks', () => withTemp(root => {
  const source = createRepository(root);
  fs.writeFileSync(path.join(source, '.gitignore'), 'node_modules/\n');
  fs.writeFileSync(path.join(source, 'untracked.txt'), 'include non-ignored work\n');
  const packageStore = path.join(root, 'package-store');
  fs.mkdirSync(packageStore);
  fs.writeFileSync(path.join(packageStore, 'index.js'), 'module.exports = true;\n');
  fs.mkdirSync(path.join(source, 'node_modules'));
  fs.symlinkSync(packageStore, path.join(source, 'node_modules', 'dependency'));
  git(source, 'add', '.gitignore');
  git(source, 'commit', '-m', 'ignore dependencies');

  const receipt = prepareWorkspace({
    mode: 'isolated-copy',
    sourcePath: source,
    runDirectory: path.join(root, 'run'),
    ownerToken: 'owner-dependencies',
    trust: 'untrusted',
  });

  assert.strictEqual(fs.readFileSync(path.join(receipt.path, 'keep.txt'), 'utf8'), 'original\n');
  assert.strictEqual(fs.readFileSync(path.join(receipt.path, 'untracked.txt'), 'utf8'), 'include non-ignored work\n');
  assert.strictEqual(fs.existsSync(path.join(receipt.path, 'node_modules')), false);
  cleanupWorkspace(receipt, { ownerToken: 'owner-dependencies' });
}));

test('isolated copy fails closed on symlinks in the tracked Git file set', () => withTemp(root => {
  const source = createRepository(root);
  fs.symlinkSync('keep.txt', path.join(source, 'tracked-link.txt'));
  git(source, 'add', 'tracked-link.txt');
  git(source, 'commit', '-m', 'track link');

  assert.throws(() => prepareWorkspace({
    mode: 'isolated-copy',
    sourcePath: source,
    runDirectory: path.join(root, 'run'),
    ownerToken: 'owner-tracked-link',
    trust: 'untrusted',
  }), /symbolic link/);
}));

test('isolated copy securely falls back to tree traversal outside Git', () => withTemp(root => {
  const source = path.join(root, 'plain-source');
  fs.mkdirSync(source);
  fs.mkdirSync(path.join(source, 'nested'));
  fs.writeFileSync(path.join(source, 'nested', 'plain.txt'), 'plain source\n');

  const receipt = prepareWorkspace({
    mode: 'isolated-copy',
    sourcePath: source,
    runDirectory: path.join(root, 'run'),
    ownerToken: 'owner-plain',
    trust: 'untrusted',
  });

  assert.strictEqual(
    fs.readFileSync(path.join(receipt.path, 'nested', 'plain.txt'), 'utf8'),
    'plain source\n'
  );
  cleanupWorkspace(receipt, { ownerToken: 'owner-plain' });
}));

test('rejects untrusted worktrees and owner mismatches', () => withTemp(root => {
  const source = createRepository(root);
  const runDirectory = path.join(root, 'run');
  assert.throws(() => prepareWorkspace({
    mode: 'worktree', sourcePath: source, runDirectory, ownerToken: 'owner', trust: 'untrusted',
  }), /first-party/);

  const receipt = prepareWorkspace({
    mode: 'isolated-copy', sourcePath: source, runDirectory, ownerToken: 'owner', trust: 'first-party',
  });
  assert.throws(() => cleanupWorkspace(receipt, { ownerToken: 'wrong' }), /owner/);
  assert.ok(fs.existsSync(receipt.path));
  cleanupWorkspace(receipt, { ownerToken: 'owner' });
}));

test('creates a detached trusted worktree and removes only that worktree', () => withTemp(root => {
  const source = createRepository(root);
  const baseCommit = git(source, 'rev-parse', 'HEAD');
  const receipt = prepareWorkspace({
    mode: 'worktree',
    sourcePath: source,
    runDirectory: path.join(root, 'run'),
    ownerToken: 'owner-worktree',
    trust: 'first-party',
    baseRef: 'HEAD',
  });

  assert.strictEqual(receipt.base_oid, baseCommit);
  assert.strictEqual(git(receipt.path, 'rev-parse', 'HEAD'), baseCommit);
  assert.throws(
    () => git(receipt.path, 'symbolic-ref', '-q', 'HEAD'),
    error => error.status === 1
  );
  fs.writeFileSync(path.join(receipt.path, 'keep.txt'), 'worktree candidate\n');

  const cleanup = cleanupWorkspace(receipt, { ownerToken: 'owner-worktree' });
  assert.strictEqual(cleanup.pass, true);
  assert.strictEqual(fs.existsSync(receipt.path), false);
  assert.strictEqual(fs.readFileSync(path.join(source, 'keep.txt'), 'utf8'), 'original\n');
  assert.strictEqual(git(source, 'rev-parse', 'HEAD'), baseCommit);
}));

test('worktree checkout uses an isolated Git environment without ambient secrets', () => withTemp(root => {
  const source = createRepository(root);
  fs.writeFileSync(path.join(source, '.gitattributes'), '*.txt text eol=lf\n');
  git(source, 'add', '.gitattributes');
  git(source, 'commit', '-m', 'add safe attributes');
  const runDirectory = path.join(root, 'run');
  const calls = [];
  const previousSecret = process.env.AMBIENT_SANDBOX_SECRET;
  process.env.AMBIENT_SANDBOX_SECRET = 'must-not-reach-git';
  try {
    const receipt = prepareWorkspace({
      mode: 'worktree',
      sourcePath: source,
      runDirectory,
      ownerToken: 'owner-safe-env',
      trust: 'first-party',
      run: (executable, argv, options) => {
        if (argv.includes('worktree') && argv.includes('add')) calls.push(options.env);
        return runCommand(executable, argv, options);
      },
    });

    assert.strictEqual(calls.length, 1);
    assert.strictEqual(calls[0].AMBIENT_SANDBOX_SECRET, undefined);
    assert.strictEqual(calls[0].GIT_CONFIG_NOSYSTEM, '1');
    assert.strictEqual(calls[0].GIT_CONFIG_GLOBAL, os.devNull);
    assert.ok(calls[0].HOME.startsWith(`${fs.realpathSync.native(runDirectory)}${path.sep}`));
    cleanupWorkspace(receipt, { ownerToken: 'owner-safe-env' });
  } finally {
    if (previousSecret === undefined) delete process.env.AMBIENT_SANDBOX_SECRET;
    else process.env.AMBIENT_SANDBOX_SECRET = previousSecret;
  }
}));

test('worktree creation rejects filter attributes without a configured driver', () => withTemp(root => {
  const source = createRepository(root);
  fs.writeFileSync(path.join(source, '.gitattributes'), '*.txt filter=unconfigured\n');
  git(source, 'add', '.gitattributes');
  git(source, 'commit', '-m', 'add filter attribute');

  assert.throws(() => prepareWorkspace({
    mode: 'worktree',
    sourcePath: source,
    runDirectory: path.join(root, 'run'),
    ownerToken: 'owner-filter-attribute',
    trust: 'first-party',
  }), /checkout filter attributes/i);
}));

test('worktree creation rejects checkout filters before they can read ambient secrets', () => withTemp(root => {
  const source = createRepository(root);
  const marker = path.join(root, 'filter-leaked-secret.txt');
  fs.writeFileSync(path.join(source, '.gitattributes'), '*.txt filter=leak\n');
  git(source, 'add', '.gitattributes');
  git(source, 'commit', '-m', 'add checkout attributes');
  git(
    source,
    'config',
    'filter.leak.smudge',
    'sh -c \'printf %s "$AMBIENT_SANDBOX_SECRET" > "$AMBIENT_SANDBOX_MARKER"; cat\''
  );
  git(
    source,
    'config',
    'filter.leak.process',
    'sh -c \'printf %s "$AMBIENT_SANDBOX_SECRET" > "$AMBIENT_SANDBOX_MARKER"; exit 99\''
  );
  const previousSecret = process.env.AMBIENT_SANDBOX_SECRET;
  const previousMarker = process.env.AMBIENT_SANDBOX_MARKER;
  process.env.AMBIENT_SANDBOX_SECRET = 'high-value-secret';
  process.env.AMBIENT_SANDBOX_MARKER = marker;
  try {
    assert.throws(() => prepareWorkspace({
      mode: 'worktree',
      sourcePath: source,
      runDirectory: path.join(root, 'run'),
      ownerToken: 'owner-filter',
      trust: 'first-party',
    }), /checkout filter/i);
    assert.strictEqual(fs.existsSync(marker), false);
  } finally {
    if (previousSecret === undefined) delete process.env.AMBIENT_SANDBOX_SECRET;
    else process.env.AMBIENT_SANDBOX_SECRET = previousSecret;
    if (previousMarker === undefined) delete process.env.AMBIENT_SANDBOX_MARKER;
    else process.env.AMBIENT_SANDBOX_MARKER = previousMarker;
  }
}));

test('builds a bounded binary patch containing modified, added, and deleted files', () => withTemp(root => {
  const source = createRepository(root);
  const candidate = path.join(root, 'candidate');
  copyTree(source, candidate);
  fs.writeFileSync(path.join(candidate, 'keep.txt'), 'modified\n');
  fs.rmSync(path.join(candidate, 'delete.txt'));
  fs.writeFileSync(path.join(candidate, 'untracked.txt'), 'new file\n');
  fs.writeFileSync(path.join(candidate, 'binary.bin'), Buffer.from([0, 1, 2, 3, 0, 255, 128]));

  const artifact = buildPatchArtifact({
    basePath: source,
    baseRef: 'HEAD',
    candidatePath: candidate,
    runDirectory: path.join(root, 'run'),
    runId: 'run_1234567890abcdef1234567890abcdef',
    jobId: 'worker-a',
  });

  assert.strictEqual(artifact.schema_version, 1);
  assert.match(artifact.artifact_id, /^artifact_[a-f0-9]{24}$/);
  assert.match(digestArtifact(artifact), /^[a-f0-9]{64}$/);
  assert.strictEqual(path.isAbsolute(artifact.patch.relative_path), false);
  assert.deepStrictEqual(
    artifact.files.map(file => [file.path, file.status]),
    [
      ['binary.bin', 'added'],
      ['delete.txt', 'deleted'],
      ['keep.txt', 'modified'],
      ['untracked.txt', 'added'],
    ]
  );
  const patch = fs.readFileSync(path.join(root, 'run', artifact.patch.relative_path), 'utf8');
  assert.match(patch, /GIT binary patch/);

  const applied = path.join(root, 'applied');
  git(root, 'clone', '--no-local', source, applied);
  git(applied, 'apply', '--binary', path.join(root, 'run', artifact.patch.relative_path));
  assert.strictEqual(fs.readFileSync(path.join(applied, 'keep.txt'), 'utf8'), 'modified\n');
  assert.strictEqual(fs.existsSync(path.join(applied, 'delete.txt')), false);
  assert.strictEqual(fs.readFileSync(path.join(applied, 'untracked.txt'), 'utf8'), 'new file\n');
  assert.deepStrictEqual(fs.readFileSync(path.join(applied, 'binary.bin')), Buffer.from([0, 1, 2, 3, 0, 255, 128]));
}));

test('rejects Git metadata, symlinks, and special files in candidate trees', () => withTemp(root => {
  const candidate = path.join(root, 'candidate');
  fs.mkdirSync(candidate);
  fs.writeFileSync(path.join(candidate, 'safe.txt'), 'safe\n');

  fs.mkdirSync(path.join(candidate, '.git'));
  assert.throws(() => verifyCandidateTree(candidate), /\.git/);
  fs.rmSync(path.join(candidate, '.git'), { recursive: true });

  fs.symlinkSync('safe.txt', path.join(candidate, 'link.txt'));
  assert.throws(() => verifyCandidateTree(candidate), /symbolic link/);
  fs.rmSync(path.join(candidate, 'link.txt'));

  if (process.platform !== 'win32') {
    execFileSync('mkfifo', [path.join(candidate, 'pipe')]);
    assert.throws(() => verifyCandidateTree(candidate), /special file/);
  }
}));

test('fails closed when candidate file and aggregate limits are exceeded', () => withTemp(root => {
  const candidate = path.join(root, 'candidate');
  fs.mkdirSync(candidate);
  fs.writeFileSync(path.join(candidate, 'large.txt'), '12345');
  assert.throws(
    () => verifyCandidateTree(candidate, { maxFileBytes: 4, maxTotalBytes: 100, maxFiles: 10 }),
    /file byte limit/
  );
  assert.throws(
    () => verifyCandidateTree(candidate, { maxFileBytes: 10, maxTotalBytes: 4, maxFiles: 10 }),
    /total byte limit/
  );
  assert.throws(
    () => verifyCandidateTree(candidate, { maxFileBytes: 10, maxTotalBytes: 100, maxFiles: 0 }),
    /file count limit/
  );
}));

test('isolated copy rejects a regular-file inode swap between inspection and open', () => withTemp(root => {
  const source = createRepository(root);
  const target = fs.realpathSync.native(path.join(source, 'keep.txt'));
  let swapped = false;
  assert.throws(() => withPatchedFs('openSync', original => function patchedOpen(filePath, flags, ...rest) {
    if (!swapped && path.resolve(filePath) === target && (flags & fs.constants.O_WRONLY) === 0) {
      swapped = true;
      fs.renameSync(target, `${target}.original`);
      fs.writeFileSync(target, 'attacker replacement\n');
    }
    return original.call(fs, filePath, flags, ...rest);
  }, () => prepareWorkspace({
    mode: 'isolated-copy',
    sourcePath: source,
    runDirectory: path.join(root, 'run'),
    ownerToken: 'owner-race',
    trust: 'untrusted',
  })), /identity changed/);
  assert.strictEqual(swapped, true);
}));

test('isolated copy uses no-follow opens when a file becomes a symlink', () => withTemp(root => {
  const source = createRepository(root);
  const target = fs.realpathSync.native(path.join(source, 'keep.txt'));
  const outside = path.join(root, 'outside-secret.txt');
  fs.writeFileSync(outside, 'must not copy\n');
  let swapped = false;
  assert.throws(() => withPatchedFs('openSync', original => function patchedOpen(filePath, flags, ...rest) {
    if (!swapped && path.resolve(filePath) === target && (flags & fs.constants.O_WRONLY) === 0) {
      swapped = true;
      fs.renameSync(target, `${target}.original`);
      fs.symlinkSync(outside, target);
    }
    return original.call(fs, filePath, flags, ...rest);
  }, () => prepareWorkspace({
    mode: 'isolated-copy',
    sourcePath: source,
    runDirectory: path.join(root, 'run'),
    ownerToken: 'owner-link-race',
    trust: 'untrusted',
  })), /symbolic link|ELOOP|too many levels/i);
  assert.strictEqual(swapped, true);
}));

test('candidate verification rejects content mutation during bounded fd reads', () => withTemp(root => {
  const candidate = path.join(root, 'candidate');
  fs.mkdirSync(candidate);
  const target = path.join(candidate, 'large.txt');
  fs.writeFileSync(target, Buffer.alloc(128 * 1024, 65));
  let changed = false;
  assert.throws(() => withPatchedFs('readSync', original => function patchedRead(fd, ...args) {
    const bytes = original.call(fs, fd, ...args);
    if (!changed && bytes > 0) {
      changed = true;
      fs.appendFileSync(target, 'changed-during-read');
    }
    return bytes;
  }, () => verifyCandidateTree(candidate)), /changed during|identity changed/);
  assert.strictEqual(changed, true);
}));

test('candidate copy revalidates recorded inode identity before copying', () => withTemp(root => {
  const candidate = path.join(root, 'candidate');
  fs.mkdirSync(candidate);
  const target = path.join(candidate, 'safe.txt');
  fs.writeFileSync(target, 'verified\n');
  const verification = verifyCandidateTree(candidate);
  fs.renameSync(target, `${target}.original`);
  fs.writeFileSync(target, 'replacement\n');
  const destination = path.join(root, 'destination');
  fs.mkdirSync(destination);
  assert.throws(() => copyVerifiedTree(verification, destination), /identity changed/);
  assert.strictEqual(fs.existsSync(path.join(destination, 'safe.txt')), false);
}));

test('no-follow leaf opens still reject a swapped symlink parent directory', () => withTemp(root => {
  const source = createRepository(root);
  const sourceNested = fs.realpathSync.native(path.join(source, 'nested'));
  const sourceFile = path.join(sourceNested, 'stable.txt');
  const outside = path.join(root, 'outside');
  fs.mkdirSync(outside);
  fs.linkSync(sourceFile, path.join(outside, 'stable.txt'));
  let swapped = false;

  assert.throws(() => withPatchedFs('openSync', original => function patchedOpen(filePath, flags, ...rest) {
    if (!swapped && path.resolve(filePath) === sourceFile && (flags & fs.constants.O_WRONLY) === 0) {
      swapped = true;
      fs.renameSync(sourceNested, `${sourceNested}.original`);
      fs.symlinkSync(outside, sourceNested);
    }
    return original.call(fs, filePath, flags, ...rest);
  }, () => prepareWorkspace({
    mode: 'isolated-copy',
    sourcePath: source,
    runDirectory: path.join(root, 'run'),
    ownerToken: 'owner-parent-race',
    trust: 'untrusted',
  })), /directory identity changed|symbolic link/i);
  assert.strictEqual(swapped, true);
}));

console.log(`\nPassed: ${passed}`);
console.log(`Failed: ${failed}`);
process.exit(failed > 0 ? 1 : 0);
