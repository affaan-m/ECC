const assert = require('assert');
const fs = require('fs');
const os = require('os');
const path = require('path');
const { spawnSync } = require('child_process');

const {
  getHomunculusDir,
  getAliasContexts,
  normalizeRemoteUrl,
  resolveProjectContext,
} = require('../../scripts/lib/observer-sessions');

let passed = 0;
let failed = 0;

function test(name, fn) {
  try {
    fn();
    console.log(`  ✓ ${name}`);
    passed += 1;
  } catch (error) {
    console.log(`  ✗ ${name}`);
    console.log(`    ${error.message}`);
    failed += 1;
  }
}

function createTempDir() {
  return fs.mkdtempSync(path.join(os.tmpdir(), 'ecc-observer-sessions-'));
}

function cleanup(dir) {
  try {
    fs.rmSync(dir, { recursive: true, force: true });
  } catch {
    // ignore cleanup errors
  }
}

function withEnv(overrides, fn) {
  const previous = {};
  for (const key of Object.keys(overrides)) {
    previous[key] = process.env[key];
    if (overrides[key] === undefined) {
      delete process.env[key];
    } else {
      process.env[key] = overrides[key];
    }
  }
  try {
    return fn();
  } finally {
    for (const [key, value] of Object.entries(previous)) {
      if (value === undefined) {
        delete process.env[key];
      } else {
        process.env[key] = value;
      }
    }
  }
}

function initRepo(repoDir, remoteUrl) {
  fs.mkdirSync(repoDir, { recursive: true });
  spawnSync('git', ['init'], { cwd: repoDir, stdio: 'ignore' });
  spawnSync('git', ['remote', 'add', 'origin', remoteUrl], { cwd: repoDir, stdio: 'ignore' });
}

console.log('\n=== observer-sessions tests ===\n');

test('getHomunculusDir prefers absolute CLV2_HOMUNCULUS_DIR', () => {
  const root = createTempDir();
  try {
    const override = path.join(root, 'custom-store');
    withEnv({ CLV2_HOMUNCULUS_DIR: override, XDG_DATA_HOME: path.join(root, 'xdg') }, () => {
      assert.strictEqual(getHomunculusDir(), override);
    });
  } finally {
    cleanup(root);
  }
});

test('getHomunculusDir ignores relative overrides and uses XDG_DATA_HOME', () => {
  const root = createTempDir();
  try {
    const xdg = path.join(root, 'xdg');
    withEnv({ CLV2_HOMUNCULUS_DIR: 'relative-store', XDG_DATA_HOME: xdg }, () => {
      assert.strictEqual(getHomunculusDir(), path.join(xdg, 'ecc-homunculus'));
    });
  } finally {
    cleanup(root);
  }
});

test('normalizeRemoteUrl collapses common network remote variants', () => {
  const expected = 'github.com/owner/repo';
  assert.strictEqual(normalizeRemoteUrl('git@github.com:Owner/Repo.git'), expected);
  assert.strictEqual(normalizeRemoteUrl('https://github.com/owner/repo.git'), expected);
  assert.strictEqual(normalizeRemoteUrl('ssh://git@github.com/Owner/Repo.git'), expected);
  assert.strictEqual(normalizeRemoteUrl('https://token@github.com/owner/repo.git'), expected);
});

test('normalizeRemoteUrl preserves local path case', () => {
  assert.strictEqual(normalizeRemoteUrl('/tmp/Repos/MyProject'), '/tmp/Repos/MyProject');
  assert.strictEqual(normalizeRemoteUrl('file:///tmp/Repos/MyProject.git'), '/tmp/Repos/MyProject');
});

test('resolveProjectContext gives SSH and HTTPS clones the same project id', () => {
  const root = createTempDir();
  try {
    const storage = path.join(root, 'store');
    const sshRepo = path.join(root, 'ssh-clone');
    const httpsRepo = path.join(root, 'https-clone');
    initRepo(sshRepo, 'git@github.com:Owner/Repo.git');
    initRepo(httpsRepo, 'https://github.com/owner/repo.git');

    withEnv({
      CLV2_HOMUNCULUS_DIR: storage,
      XDG_DATA_HOME: undefined,
      CLAUDE_PROJECT_DIR: undefined,
    }, () => {
      const sshContext = resolveProjectContext(sshRepo);
      const httpsContext = resolveProjectContext(httpsRepo);
      assert.strictEqual(sshContext.projectId, httpsContext.projectId);
      assert.strictEqual(sshContext.projectDir, httpsContext.projectDir);
    });
  } finally {
    cleanup(root);
  }
});

function hashId(input) {
  return require('crypto').createHash('sha256').update(input).digest('hex').slice(0, 12);
}

function writeRegistry(storage, entries) {
  fs.mkdirSync(storage, { recursive: true });
  const registry = {};
  for (const entry of entries) registry[entry.id] = entry;
  fs.writeFileSync(path.join(storage, 'projects.json'), JSON.stringify(registry, null, 2));
}

function captureStderr(fn) {
  const original = process.stderr.write;
  let output = '';
  process.stderr.write = chunk => {
    output += String(chunk);
    return true;
  };
  try {
    return { result: fn(), stderr: output };
  } finally {
    process.stderr.write = original;
  }
}

function resolveIn(storage, repo) {
  return withEnv({
    CLV2_HOMUNCULUS_DIR: storage,
    XDG_DATA_HOME: undefined,
    CLAUDE_PROJECT_DIR: undefined,
  }, () => captureStderr(() => resolveProjectContext(repo)));
}

test('resolveProjectContext follows the remote-hash id when a remote was added after the first session', () => {
  const root = createTempDir();
  try {
    const storage = path.join(root, 'store');
    const repo = path.join(root, 'repo');
    initRepo(repo, 'git@github.com:Owner/Repo.git');
    const repoRoot = fs.realpathSync(repo);
    const pathId = hashId(repoRoot);
    const remoteId = hashId('github.com/owner/repo');
    // Path-hash entry first, as projects.json holds it after `git remote add`.
    writeRegistry(storage, [
      { id: pathId, root: repoRoot, remote: '', last_seen: '2026-10-19T09:00:00Z' },
      { id: remoteId, root: repoRoot, remote: 'git@github.com:Owner/Repo.git', last_seen: '2026-10-18T09:00:00Z' },
    ]);

    const { result, stderr } = resolveIn(storage, repo);
    assert.strictEqual(result.projectId, remoteId);
    assert.strictEqual(result.projectDir, path.join(storage, 'projects', remoteId));
    assert.ok(stderr.includes(pathId) && stderr.includes(remoteId), stderr);
    assert.ok(stderr.includes('Inspect with instinct-cli.py projects'), stderr);
    assert.ok(stderr.includes('do not merge live project storage'), stderr);
    assert.ok(!stderr.includes('projects merge'), stderr);
  } finally {
    cleanup(root);
  }
});

test('resolveProjectContext picks the most recently seen entry when no duplicate matches the computed id', () => {
  const root = createTempDir();
  try {
    const storage = path.join(root, 'store');
    const repo = path.join(root, 'repo');
    initRepo(repo, 'git@github.com:Owner/Repo.git');
    const repoRoot = fs.realpathSync(repo);
    writeRegistry(storage, [
      { id: 'aaaaaaaaaaaa', root: repoRoot, last_seen: '2026-10-01T00:00:00Z' },
      { id: 'bbbbbbbbbbbb', root: repoRoot, last_seen: '2026-10-20T00:00:00Z' },
      { id: 'cccccccccccc', root: repoRoot, last_seen: '2026-10-10T00:00:00Z' },
    ]);

    const { result, stderr } = resolveIn(storage, repo);
    assert.strictEqual(result.projectId, 'bbbbbbbbbbbb');
    assert.ok(stderr.includes('Inspect with instinct-cli.py projects'), stderr);
  } finally {
    cleanup(root);
  }
});

test('resolveProjectContext prefers the observer id when its folder holds instincts but projects.json lacks it', () => {
  const root = createTempDir();
  try {
    const storage = path.join(root, 'store');
    const repo = path.join(root, 'repo');
    initRepo(repo, 'git@github.com:Owner/Repo.git');
    const repoRoot = fs.realpathSync(repo);
    const remoteId = hashId('github.com/owner/repo');
    fs.mkdirSync(path.join(storage, 'projects', remoteId, 'instincts'), { recursive: true });
    writeRegistry(storage, [
      { id: 'aaaaaaaaaaaa', root: repoRoot, last_seen: '2026-10-01T00:00:00Z' },
      { id: 'bbbbbbbbbbbb', root: repoRoot, last_seen: '2026-10-20T00:00:00Z' },
    ]);

    const { result } = resolveIn(storage, repo);
    assert.strictEqual(result.projectId, remoteId);
    assert.deepStrictEqual(result.aliasProjectIds, ['aaaaaaaaaaaa', 'bbbbbbbbbbbb']);
  } finally {
    cleanup(root);
  }
});

test('resolveProjectContext moves off a sole legacy entry once the observer has written under the computed id', () => {
  const root = createTempDir();
  try {
    const storage = path.join(root, 'store');
    const repo = path.join(root, 'repo');
    initRepo(repo, 'git@github.com:Owner/Repo.git');
    const repoRoot = fs.realpathSync(repo);
    const pathId = hashId(repoRoot);
    const remoteId = hashId('github.com/owner/repo');
    // The observer made projects/<remote id>/instincts but has not registered it yet.
    fs.mkdirSync(path.join(storage, 'projects', remoteId, 'instincts'), { recursive: true });
    writeRegistry(storage, [{ id: pathId, root: repoRoot, last_seen: '2026-10-20T00:00:00Z' }]);

    const { result, stderr } = resolveIn(storage, repo);
    assert.strictEqual(result.projectId, remoteId);
    assert.deepStrictEqual(result.aliasProjectIds, [pathId]);
    assert.ok(stderr.includes('Inspect with instinct-cli.py projects'), stderr);
    assert.ok(!stderr.includes('projects merge'), stderr);
  } finally {
    cleanup(root);
  }
});

test('resolveProjectContext keeps a sole registry entry when the computed id folder has no observer data', () => {
  const root = createTempDir();
  try {
    const storage = path.join(root, 'store');
    const repo = path.join(root, 'repo');
    initRepo(repo, 'git@github.com:Owner/Repo.git');
    const repoRoot = fs.realpathSync(repo);
    fs.mkdirSync(path.join(storage, 'projects', hashId('github.com/owner/repo')), { recursive: true });
    writeRegistry(storage, [{ id: 'eeeeeeeeeeee', root: repoRoot, last_seen: '2026-10-20T00:00:00Z' }]);

    const { result, stderr } = resolveIn(storage, repo);
    assert.strictEqual(result.projectId, 'eeeeeeeeeeee');
    assert.strictEqual(stderr, '');
  } finally {
    cleanup(root);
  }
});

test('resolveProjectContext keeps a single registry entry even when its id differs from the computed one', () => {
  const root = createTempDir();
  try {
    const storage = path.join(root, 'store');
    const repo = path.join(root, 'repo');
    initRepo(repo, 'git@github.com:Owner/Repo.git');
    const repoRoot = fs.realpathSync(repo);
    // e.g. a worktree registered under its main checkout's path-hash id
    writeRegistry(storage, [{ id: 'dddddddddddd', root: repoRoot, last_seen: '2026-10-20T00:00:00Z' }]);

    const { result, stderr } = resolveIn(storage, repo);
    assert.strictEqual(result.projectId, 'dddddddddddd');
    assert.strictEqual(stderr, '');
  } finally {
    cleanup(root);
  }
});

test('resolveProjectContext uses the main checkout id for a remote-free linked worktree with duplicate entries', () => {
  const root = createTempDir();
  try {
    const storage = path.join(root, 'store');
    const main = path.join(root, 'main');
    const worktree = path.join(root, 'linked');
    fs.mkdirSync(main, { recursive: true });
    const git = args => spawnSync('git', ['-c', 'user.name=t', '-c', 'user.email=t@example.com', ...args], { cwd: main, stdio: 'ignore' });
    git(['init']);
    git(['commit', '--allow-empty', '-m', 'init']);
    git(['worktree', 'add', worktree]);
    const worktreeRoot = fs.realpathSync(worktree);
    const legacyId = hashId(worktreeRoot);
    // detect-project.sh hashes Git's worktree-list spelling, which uses forward
    // slashes on Windows rather than the native fs.realpathSync spelling.
    const listing = spawnSync('git', ['worktree', 'list', '--porcelain'], {
      cwd: main, encoding: 'utf8'
    });
    assert.strictEqual(listing.status, 0, listing.stderr);
    const gitMainRoot = listing.stdout.split(/\r?\n/).find(line => line.startsWith('worktree ')).slice(9);
    const mainId = hashId(gitMainRoot);
    // detect-project.sh hashes the main checkout for a remote-free worktree.
    writeRegistry(storage, [
      { id: legacyId, root: worktreeRoot, last_seen: '2026-10-20T00:00:00Z' },
      { id: mainId, root: worktreeRoot, last_seen: '2026-10-19T00:00:00Z' },
    ]);

    const { result } = resolveIn(storage, worktree);
    assert.strictEqual(result.projectId, mainId);
    assert.deepStrictEqual(result.aliasProjectIds, [legacyId]);
  } finally {
    cleanup(root);
  }
});

test('resolveProjectContext ignores unsafe registry ids before making alias paths', () => {
  const root = createTempDir();
  try {
    const storage = path.join(root, 'store');
    const repo = path.join(root, 'repo');
    initRepo(repo, 'https://github.com/owner/repo.git');
    const repoRoot = fs.realpathSync(repo);
    const remoteId = hashId('github.com/owner/repo');
    writeRegistry(storage, [
      { id: '../outside', root: repoRoot, last_seen: '2026-10-25T00:00:00Z' },
      { id: remoteId, root: repoRoot, last_seen: '2026-10-24T00:00:00Z' },
    ]);

    const { result, stderr } = resolveIn(storage, repo);
    assert.strictEqual(result.projectId, remoteId);
    assert.deepStrictEqual(result.aliasProjectIds, []);
    assert.deepStrictEqual(getAliasContexts({ ...result, aliasProjectIds: ['../outside'] }), []);
    assert.strictEqual(stderr, '');
    assert.ok(!fs.existsSync(path.join(storage, 'outside')));
  } finally {
    cleanup(root);
  }
});

test('resolveProjectContext counts repeated registry ids as one alias', () => {
  const root = createTempDir();
  try {
    const storage = path.join(root, 'store');
    const repo = path.join(root, 'repo');
    initRepo(repo, 'https://github.com/owner/repo.git');
    const repoRoot = fs.realpathSync(repo);
    const remoteId = hashId('github.com/owner/repo');
    fs.mkdirSync(storage, { recursive: true });
    fs.writeFileSync(path.join(storage, 'projects.json'), JSON.stringify({
      first: { id: 'older-project', root: repoRoot },
      second: { id: 'older-project', root: repoRoot },
      [remoteId]: { id: remoteId, root: repoRoot },
    }));

    const { result } = resolveIn(storage, repo);
    assert.deepStrictEqual(result.aliasProjectIds, ['older-project']);
    assert.strictEqual(getAliasContexts(result).length, 1);
  } finally {
    cleanup(root);
  }
});

test('resolveProjectContext matches registry roots through directory aliases', () => {
  const root = createTempDir();
  try {
    const storage = path.join(root, 'store');
    const repo = path.join(root, 'repo');
    const alias = path.join(root, 'repo-alias');
    initRepo(repo, 'https://github.com/owner/repo.git');
    fs.symlinkSync(repo, alias, process.platform === 'win32' ? 'junction' : 'dir');
    writeRegistry(storage, [{ id: 'registered-project', root: fs.realpathSync(repo) }]);
    const result = withEnv({ CLV2_HOMUNCULUS_DIR: storage, CLAUDE_PROJECT_DIR: alias },
      () => resolveProjectContext(alias));
    assert.strictEqual(result.projectId, 'registered-project');
    assert.deepStrictEqual(result.aliasProjectIds, []);
  } finally {
    cleanup(root);
  }
});

test('resolveProjectContext ignores missing registry roots without adopting their ids', () => {
  const root = createTempDir();
  try {
    const storage = path.join(root, 'store');
    const repo = path.join(root, 'repo');
    initRepo(repo, 'https://github.com/owner/repo.git');
    writeRegistry(storage, [{ id: 'missing-project', root: path.join(root, 'missing') }]);
    const { result } = resolveIn(storage, repo);
    assert.strictEqual(result.projectId, hashId('github.com/owner/repo'));
    assert.deepStrictEqual(result.aliasProjectIds, []);
  } finally {
    cleanup(root);
  }
});

test('resolveProjectContext compares native long paths when legacy realpath retains a short spelling', () => {
  const root = createTempDir();
  const originalRealpath = fs.realpathSync;
  const nativeRealpath = originalRealpath.native || originalRealpath;
  try {
    const storage = path.join(root, 'store');
    const repo = path.join(root, 'repo');
    initRepo(repo, 'https://github.com/owner/repo.git');
    const physicalRoot = nativeRealpath(repo);
    const shortRoot = path.resolve(root, 'SHORT~1');
    writeRegistry(storage, [{ id: 'registered-project', root: shortRoot }]);
    // Node's JS walker preserves non-symlink 8.3 segments on Windows; the
    // native OS resolver expands them. Model those distinct results on every OS.
    const legacyRealpath = (value, ...args) => path.resolve(value) === shortRoot
      ? shortRoot : originalRealpath(value, ...args);
    let nativeAliasCalls = 0;
    legacyRealpath.native = (value, ...args) => {
      if (path.resolve(value) === shortRoot) {
        nativeAliasCalls += 1;
        return physicalRoot;
      }
      return nativeRealpath(value, ...args);
    };
    fs.realpathSync = legacyRealpath;
    const { result } = resolveIn(storage, repo);
    assert.strictEqual(result.projectId, 'registered-project');
    assert.deepStrictEqual(result.aliasProjectIds, []);
    assert.ok(nativeAliasCalls > 0, 'root comparison must use the native canonical spelling');
  } finally {
    fs.realpathSync = originalRealpath;
    cleanup(root);
  }
});

test('resolveProjectContext retains root comparison when the native realpath API is unavailable', () => {
  const root = createTempDir();
  const originalRealpath = fs.realpathSync;
  try {
    const storage = path.join(root, 'store');
    const repo = path.join(root, 'repo');
    initRepo(repo, 'https://github.com/owner/repo.git');
    // Use one Git spelling for both inputs. Legacy realpath need not expand
    // 8.3 aliases; this case verifies API fallback, not native alias support.
    const gitRoot = spawnSync('git', ['-C', repo, 'rev-parse', '--show-toplevel'], {
      encoding: 'utf8',
    });
    assert.strictEqual(gitRoot.status, 0, gitRoot.stderr);
    writeRegistry(storage, [{ id: 'registered-project', root: gitRoot.stdout.trim() }]);
    let fallbackCalls = 0;
    fs.realpathSync = (...args) => {
      fallbackCalls += 1;
      return originalRealpath(...args);
    };
    assert.strictEqual(fs.realpathSync.native, undefined);
    const { result } = resolveIn(storage, repo);
    assert.strictEqual(result.projectId, 'registered-project');
    assert.ok(fallbackCalls >= 2, 'both project and registry roots must use the fallback');
  } finally {
    fs.realpathSync = originalRealpath;
    cleanup(root);
  }
});

console.log(`\nPassed: ${passed}`);
console.log(`Failed: ${failed}`);
process.exit(failed > 0 ? 1 : 0);
