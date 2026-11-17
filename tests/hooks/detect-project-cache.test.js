/**
 * Tests for the per-directory project detection cache in detect-project.sh.
 *
 * detect-project.sh is sourced by observe.sh before and after every tool call.
 * Full detection launches git, python, sed and mkdir many times, which is cheap
 * on Linux/macOS but costs seconds per call under Git Bash on Windows. The
 * cache serves a repeat call from one small file, and these tests pin when it
 * may and may not be trusted:
 *
 *   - a repeat call is a hit, returns the same project, and launches no git
 *   - a changed remote (.git/config newer than the entry) forces re-detection
 *   - an entry from another day forces re-detection
 *   - a missing project directory forces re-detection
 *   - an id that detection could not have produced is rejected
 *   - CLV2_PROJECT_CACHE=0 turns the cache off
 *   - a fallthrough "global" result is not cached
 *
 * Run with: node tests/hooks/detect-project-cache.test.js
 */

// Skip on Windows — these tests invoke bash scripts directly
if (process.platform === 'win32') {
  console.log('Skipping bash-dependent detection cache tests on Windows\n');
  process.exit(0);
}

const assert = require('assert');
const path = require('path');
const fs = require('fs');
const os = require('os');
const { execFileSync, spawnSync } = require('child_process');

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

function createTempDir() {
  return fs.mkdtempSync(path.join(os.tmpdir(), 'ecc-detect-cache-test-'));
}

function cleanupDir(dir) {
  try {
    fs.rmSync(dir, { recursive: true, force: true });
  } catch {
    // ignore cleanup errors
  }
}

const repoRoot = path.resolve(__dirname, '..', '..');
const skillRoot = path.join(repoRoot, 'skills', 'continuous-learning-v2');
const detectProjectPath = path.join(skillRoot, 'scripts', 'detect-project.sh');
const observePath = path.join(skillRoot, 'hooks', 'observe.sh');

// The cache needs printf '%(...)T' (bash >= 4.2). On older shells such as the
// macOS system bash it is skipped by design, so there is nothing to test.
function bashSupportsCache() {
  const r = spawnSync('bash', ['-c', 'printf "%s.%s" "${BASH_VERSINFO[0]}" "${BASH_VERSINFO[1]}"'], {
    encoding: 'utf8'
  });
  if (r.error || r.status !== 0) return false;
  const [major, minor] = r.stdout.trim().split('.').map(Number);
  return major > 4 || (major === 4 && minor >= 2);
}

function git(cwd, ...args) {
  execFileSync('git', args, { cwd, stdio: 'ignore' });
}

function makeRepo(parent, name, remote) {
  const repo = path.join(parent, name);
  fs.mkdirSync(repo, { recursive: true });
  git(repo, 'init', '-q');
  if (remote) git(repo, 'remote', 'add', 'origin', remote);
  // An entry is trusted only while it is strictly newer than .git/config.
  // Backdate the config so that holds even where mtimes (or the shell's -nt)
  // only resolve whole seconds.
  const past = new Date(Date.now() - 10000);
  fs.utimesSync(path.join(repo, '.git', 'config'), past, past);
  return repo;
}

function baseEnv(homeDir, extra = {}) {
  const env = { ...process.env, HOME: homeDir, USERPROFILE: homeDir };
  delete env.CLAUDE_PROJECT_DIR;
  delete env.CLV2_NO_PROJECT;
  delete env.CLV2_HOMUNCULUS_DIR;
  delete env.XDG_DATA_HOME;
  delete env.CLV2_PROJECT_CACHE;
  return { ...env, ...extra };
}

// Source detect-project.sh from `cwd` and return what it resolved.
function detect(cwd, homeDir, extraEnv = {}) {
  const script = [
    'source "$DETECT_PROJECT"',
    'printf "%s\\n" "$PROJECT_ID" "$PROJECT_NAME" "$PROJECT_ROOT" "$PROJECT_DIR" "$_CLV2_PROJECT_CACHE_HIT"'
  ].join('\n');
  const r = spawnSync('bash', ['-c', script], {
    cwd,
    encoding: 'utf8',
    timeout: 60000,
    env: baseEnv(homeDir, { DETECT_PROJECT: detectProjectPath, ...extraEnv })
  });
  assert.strictEqual(r.status, 0, `detect-project.sh should source cleanly, stderr: ${r.stderr}`);
  const [id, name, root, dir, hit] = r.stdout.split('\n');
  return { id, name, root, dir, hit };
}

function homunculusDir(homeDir) {
  return path.join(homeDir, '.local', 'share', 'ecc-homunculus');
}

function cacheEntries(homeDir) {
  const dir = path.join(homunculusDir(homeDir), '.project-cache');
  if (!fs.existsSync(dir)) return [];
  return fs.readdirSync(dir).map((f) => path.join(dir, f));
}

function rewriteCacheLine(file, index, value) {
  const lines = fs.readFileSync(file, 'utf8').split('\n');
  lines[index] = value;
  fs.writeFileSync(file, lines.join('\n'));
}

// Put a `git` wrapper first on PATH that records each call, then runs real git.
function gitSpy(dir) {
  const real = execFileSync('bash', ['-c', 'command -v git'], { encoding: 'utf8' }).trim();
  const binDir = path.join(dir, 'spy-bin');
  const log = path.join(dir, 'git-calls.log');
  fs.mkdirSync(binDir, { recursive: true });
  fs.writeFileSync(
    path.join(binDir, 'git'),
    ['#!/usr/bin/env bash', `printf '%s\\n' "$*" >> "$GIT_SPY_LOG"`, `exec "${real}" "$@"`, ''].join('\n'),
    { mode: 0o755 }
  );
  return {
    env: { PATH: `${binDir}${path.delimiter}${process.env.PATH}`, GIT_SPY_LOG: log },
    calls: () => (fs.existsSync(log) ? fs.readFileSync(log, 'utf8').split('\n').filter(Boolean).length : 0)
  };
}

console.log('\n=== detect-project.sh detection cache ===\n');

if (!bashSupportsCache()) {
  console.log('Skipping: bash < 4.2 does not use the detection cache\n');
  process.exit(0);
}

test('a repeat call is served from the cache with identical results', () => {
  const tmp = createTempDir();
  try {
    const home = path.join(tmp, 'home');
    fs.mkdirSync(home);
    const repo = makeRepo(tmp, 'alpha', 'https://github.com/example/alpha.git');

    const first = detect(repo, home);
    const second = detect(repo, home);

    assert.strictEqual(first.hit, '0', 'first call must run full detection');
    assert.strictEqual(second.hit, '1', 'second call must be a cache hit');
    assert.match(first.id, /^[0-9a-f]{12}$/, 'project id should be a 12-char hex hash');
    assert.deepStrictEqual(
      { id: second.id, name: second.name, root: second.root, dir: second.dir },
      { id: first.id, name: first.name, root: first.root, dir: first.dir },
      'a cache hit must return exactly what detection returned'
    );
    assert.strictEqual(cacheEntries(home).length, 1, 'one cache entry should exist');
  } finally {
    cleanupDir(tmp);
  }
});

test('a cache hit launches no git process', () => {
  const tmp = createTempDir();
  try {
    const home = path.join(tmp, 'home');
    fs.mkdirSync(home);
    const repo = makeRepo(tmp, 'beta', 'https://github.com/example/beta.git');
    const spy = gitSpy(tmp);

    detect(repo, home, spy.env);
    const afterMiss = spy.calls();
    assert.ok(afterMiss > 0, 'full detection should call git');

    const second = detect(repo, home, spy.env);
    assert.strictEqual(second.hit, '1');
    assert.strictEqual(spy.calls(), afterMiss, 'a cache hit must not call git');
  } finally {
    cleanupDir(tmp);
  }
});

test('a changed remote invalidates the entry and yields the new project id', () => {
  const tmp = createTempDir();
  try {
    const home = path.join(tmp, 'home');
    fs.mkdirSync(home);
    const repo = makeRepo(tmp, 'gamma', 'https://github.com/example/gamma.git');

    const first = detect(repo, home);
    git(repo, 'remote', 'set-url', 'origin', 'https://github.com/example/gamma-renamed.git');
    // Make the config unambiguously newer than the entry, whatever the
    // filesystem's timestamp granularity.
    const future = new Date(Date.now() + 5000);
    fs.utimesSync(path.join(repo, '.git', 'config'), future, future);

    const second = detect(repo, home);
    assert.strictEqual(second.hit, '0', 'a newer .git/config must force re-detection');
    assert.notStrictEqual(second.id, first.id, 'the project id must follow the new remote');
  } finally {
    cleanupDir(tmp);
  }
});

test('an entry written on another day is not trusted', () => {
  const tmp = createTempDir();
  try {
    const home = path.join(tmp, 'home');
    fs.mkdirSync(home);
    const repo = makeRepo(tmp, 'delta', 'https://github.com/example/delta.git');

    const first = detect(repo, home);
    const [entry] = cacheEntries(home);
    rewriteCacheLine(entry, 1, '19990101');

    const second = detect(repo, home);
    assert.strictEqual(second.hit, '0', 'a stale day stamp must force re-detection');
    assert.strictEqual(second.id, first.id);
    assert.notStrictEqual(
      fs.readFileSync(entry, 'utf8').split('\n')[1],
      '19990101',
      're-detection should refresh the entry'
    );
  } finally {
    cleanupDir(tmp);
  }
});

test('a missing project directory forces re-detection and is recreated', () => {
  const tmp = createTempDir();
  try {
    const home = path.join(tmp, 'home');
    fs.mkdirSync(home);
    const repo = makeRepo(tmp, 'epsilon', 'https://github.com/example/epsilon.git');

    const first = detect(repo, home);
    fs.rmSync(first.dir, { recursive: true, force: true });

    const second = detect(repo, home);
    assert.strictEqual(second.hit, '0', 'a deleted project dir must force re-detection');
    assert.ok(fs.existsSync(path.join(second.dir, 'instincts', 'personal')), 'project structure should be recreated');
  } finally {
    cleanupDir(tmp);
  }
});

test('an id detection could not have produced is rejected', () => {
  const tmp = createTempDir();
  try {
    const home = path.join(tmp, 'home');
    fs.mkdirSync(home);
    const repo = makeRepo(tmp, 'zeta', 'https://github.com/example/zeta.git');

    const first = detect(repo, home);
    const [entry] = cacheEntries(home);
    fs.mkdirSync(path.join(tmp, 'escaped'));

    for (const bad of ['../../../../escaped', 'ABCDEF012345', 'abc', `${first.id}/..`]) {
      rewriteCacheLine(entry, 3, bad);
      const again = detect(repo, home);
      assert.strictEqual(again.hit, '0', `tampered id ${JSON.stringify(bad)} must not be a hit`);
      assert.strictEqual(again.id, first.id, 'detection should restore the real id');
      assert.ok(
        again.dir.endsWith(`/projects/${first.id}`),
        `PROJECT_DIR must stay under the projects directory, got ${again.dir}`
      );
    }
  } finally {
    cleanupDir(tmp);
  }
});

test('CLV2_PROJECT_CACHE=0 disables the cache', () => {
  const tmp = createTempDir();
  try {
    const home = path.join(tmp, 'home');
    fs.mkdirSync(home);
    const repo = makeRepo(tmp, 'eta', 'https://github.com/example/eta.git');

    const first = detect(repo, home, { CLV2_PROJECT_CACHE: '0' });
    const second = detect(repo, home, { CLV2_PROJECT_CACHE: '0' });

    assert.strictEqual(first.hit, '0');
    assert.strictEqual(second.hit, '0', 'with the cache off every call must detect');
    assert.strictEqual(second.id, first.id);
    assert.strictEqual(cacheEntries(home).length, 0, 'no cache entry should be written');
  } finally {
    cleanupDir(tmp);
  }
});

test('a fallthrough "global" result is not cached, so a later git init is seen', () => {
  const tmp = createTempDir();
  try {
    const home = path.join(tmp, 'home');
    fs.mkdirSync(home);
    const dir = path.join(tmp, 'plain');
    fs.mkdirSync(dir);

    const before = detect(dir, home);
    assert.strictEqual(before.id, 'global');
    assert.strictEqual(cacheEntries(home).length, 0, 'global-by-fallthrough must not be cached');

    git(dir, 'init', '-q');
    const after = detect(dir, home);
    assert.notStrictEqual(after.id, 'global', 'the new repository must be detected on the next call');
  } finally {
    cleanupDir(tmp);
  }
});

test('an explicit CLV2_NO_PROJECT=1 result is cached under its own key', () => {
  const tmp = createTempDir();
  try {
    const home = path.join(tmp, 'home');
    fs.mkdirSync(home);
    const repo = makeRepo(tmp, 'theta', 'https://github.com/example/theta.git');

    const first = detect(repo, home, { CLV2_NO_PROJECT: '1' });
    const second = detect(repo, home, { CLV2_NO_PROJECT: '1' });
    assert.strictEqual(first.id, 'global');
    assert.strictEqual(second.hit, '1');
    assert.strictEqual(second.id, 'global');

    // The same directory without the flag is a different key and a real project.
    const project = detect(repo, home);
    assert.strictEqual(project.hit, '0');
    assert.match(project.id, /^[0-9a-f]{12}$/);
  } finally {
    cleanupDir(tmp);
  }
});

test('a linked worktree is never cached (its config lives outside the worktree)', () => {
  const tmp = createTempDir();
  try {
    const home = path.join(tmp, 'home');
    fs.mkdirSync(home);
    const repo = makeRepo(tmp, 'kappa');
    git(repo, '-c', 'user.email=test@example.com', '-c', 'user.name=Test', 'commit', '-q', '--allow-empty', '-m', 'init');
    const worktree = path.join(tmp, 'kappa-wt');
    git(repo, 'worktree', 'add', '-q', worktree);

    const first = detect(worktree, home);
    const second = detect(worktree, home);
    assert.match(first.id, /^[0-9a-f]{12}$/);
    assert.strictEqual(second.hit, '0', 'a worktree has no watchable .git/config, so it must not be cached');
    assert.strictEqual(second.id, first.id);

    // Adding a remote in the main repository changes the id; the worktree
    // must follow on the very next call.
    git(repo, 'remote', 'add', 'origin', 'https://github.com/example/kappa.git');
    const third = detect(worktree, home);
    assert.notStrictEqual(third.id, first.id, 'the worktree must pick up the new remote immediately');
  } finally {
    cleanupDir(tmp);
  }
});

test('a non-git CLAUDE_PROJECT_DIR root is never cached', () => {
  const tmp = createTempDir();
  try {
    const home = path.join(tmp, 'home');
    fs.mkdirSync(home);
    const dir = path.join(tmp, 'plain-project');
    fs.mkdirSync(dir);

    const first = detect(dir, home, { CLAUDE_PROJECT_DIR: dir });
    const second = detect(dir, home, { CLAUDE_PROJECT_DIR: dir });
    assert.match(first.id, /^[0-9a-f]{12}$/, 'an explicit non-git root is a path-hash project');
    assert.strictEqual(second.hit, '0', 'a root without .git/config must not be cached');
    assert.strictEqual(cacheEntries(home).length, 0);
  } finally {
    cleanupDir(tmp);
  }
});

test('an entry whose project root no longer exists is rejected', () => {
  const tmp = createTempDir();
  try {
    const home = path.join(tmp, 'home');
    fs.mkdirSync(home);
    const repo = makeRepo(tmp, 'lambda', 'https://github.com/example/lambda.git');

    detect(repo, home);
    const [entry] = cacheEntries(home);
    rewriteCacheLine(entry, 5, path.join(tmp, 'does-not-exist'));

    const second = detect(repo, home);
    assert.strictEqual(second.hit, '0', 'a root that is not a directory must force re-detection');
  } finally {
    cleanupDir(tmp);
  }
});

test('observe.sh records the same project on a cache hit as on a miss', () => {
  const tmp = createTempDir();
  try {
    const home = path.join(tmp, 'home');
    fs.mkdirSync(home);
    const repo = makeRepo(tmp, 'iota', 'https://github.com/example/iota.git');
    const payload = JSON.stringify({
      session_id: 'cache-test',
      cwd: repo,
      tool_name: 'Read',
      tool_input: { file_path: 'README.md' }
    });

    for (let i = 0; i < 2; i += 1) {
      const r = spawnSync('bash', [observePath, 'pre'], {
        cwd: repo,
        input: payload,
        encoding: 'utf8',
        timeout: 60000,
        env: baseEnv(home, { CLAUDE_CODE_ENTRYPOINT: 'cli', ECC_HOOK_PROFILE: 'standard', ECC_SKIP_OBSERVE: '0' })
      });
      assert.strictEqual(r.status, 0, `observe.sh should exit 0, stderr: ${r.stderr}`);
    }

    assert.strictEqual(cacheEntries(home).length, 1, 'observe.sh should leave one cache entry');
    const projectsDir = path.join(homunculusDir(home), 'projects');
    const [projectId] = fs.readdirSync(projectsDir);
    const records = fs
      .readFileSync(path.join(projectsDir, projectId, 'observations.jsonl'), 'utf8')
      .split('\n')
      .filter(Boolean)
      .map((line) => JSON.parse(line));

    assert.strictEqual(records.length, 2, 'both calls should record an observation');
    assert.strictEqual(records[0].project_id, projectId);
    assert.deepStrictEqual(
      { id: records[1].project_id, name: records[1].project_name, event: records[1].event },
      { id: records[0].project_id, name: records[0].project_name, event: 'tool_start' }
    );
  } finally {
    cleanupDir(tmp);
  }
});

console.log(`\nPassed: ${passed}`);
console.log(`Failed: ${failed}`);
process.exit(failed > 0 ? 1 : 0);
