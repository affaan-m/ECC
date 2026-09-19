/**
 * Tests for Codex shell helpers.
 */

const assert = require('assert');
const fs = require('fs');
const os = require('os');
const path = require('path');
const { spawnSync } = require('child_process');
const TOML = require('@iarna/toml');

const repoRoot = path.join(__dirname, '..', '..');
const installScript = path.join(repoRoot, 'scripts', 'codex', 'install-global-git-hooks.sh');
const prePushHook = path.join(repoRoot, 'scripts', 'codex-git-hooks', 'pre-push');
const pluginCacheCheckScript = path.join(repoRoot, 'scripts', 'codex', 'check-plugin-cache.js');
const mergeCodexConfigScript = path.join(repoRoot, 'scripts', 'codex', 'merge-codex-config.js');
const mergeMcpConfigScript = path.join(repoRoot, 'scripts', 'codex', 'merge-mcp-config.js');
const syncScript = path.join(repoRoot, 'scripts', 'sync-ecc-to-codex.sh');
const packageJson = JSON.parse(fs.readFileSync(path.join(repoRoot, 'package.json'), 'utf8'));
const packageVersion = packageJson.version;
const deterministicPackageEnv = {
  CLAUDE_PACKAGE_MANAGER: 'npm',
  CLAUDE_CODE_PACKAGE_MANAGER: 'npm',
};

function test(name, fn) {
  try {
    fn();
    console.log(`  ✓ ${name}`);
    return true;
  } catch (error) {
    console.log(`  ✗ ${name}`);
    console.log(`    Error: ${error.message}`);
    return false;
  }
}

function createTempDir(prefix) {
  return fs.mkdtempSync(path.join(os.tmpdir(), prefix));
}

function cleanup(dirPath) {
  fs.rmSync(dirPath, { recursive: true, force: true });
}

function resolveBashExecutable(env = process.env) {
  return env.BASH_PATH
    || (process.platform === 'win32' && fs.existsSync('C:\\Program Files\\Git\\bin\\bash.exe')
      ? 'C:\\Program Files\\Git\\bin\\bash.exe'
      : fs.existsSync('/bin/bash')
        ? '/bin/bash'
        : 'bash');
}

function runBash(
  scriptPath,
  { args = [], env = {}, cwd = repoRoot, input = undefined, preservePath = true } = {},
) {
  const effectiveEnv = {
    ...(preservePath ? process.env : {}),
    ...env,
  };
  const bash = resolveBashExecutable(effectiveEnv);
  return spawnSync(bash, [scriptPath, ...args], {
    cwd,
    env: effectiveEnv,
    encoding: 'utf8',
    input,
    stdio: ['pipe', 'pipe', 'pipe'],
  });
}

function toBashPath(filePath) {
  return process.platform === 'win32'
    ? `/${filePath[0].toLowerCase()}${filePath.slice(2).replaceAll('\\', '/')}`
    : filePath;
}

function runNode(scriptPath, args = [], env = {}, cwd = repoRoot) {
  return spawnSync('node', [scriptPath, ...args], {
    cwd,
    env: {
      ...process.env,
      ...env,
    },
    encoding: 'utf8',
    stdio: ['pipe', 'pipe', 'pipe'],
  });
}

function makeHermeticCodexEnv(homeDir, codexDir, extraEnv = {}) {
  const agentsHome = path.join(homeDir, '.agents');
  const hooksDir = path.join(codexDir, 'git-hooks');
  return {
    HOME: homeDir,
    USERPROFILE: homeDir,
    XDG_CONFIG_HOME: path.join(homeDir, '.config'),
    GIT_CONFIG_GLOBAL: path.join(homeDir, '.gitconfig'),
    CODEX_HOME: codexDir,
    AGENTS_HOME: agentsHome,
    ECC_GLOBAL_HOOKS_DIR: hooksDir,
    CLAUDE_PACKAGE_MANAGER: 'npm',
    CLAUDE_CODE_PACKAGE_MANAGER: 'npm',
    LANG: 'C.UTF-8',
    LC_ALL: 'C.UTF-8',
    ...extraEnv,
  };
}

function writeJson(filePath, value) {
  fs.mkdirSync(path.dirname(filePath), { recursive: true });
  fs.writeFileSync(filePath, `${JSON.stringify(value, null, 2)}\n`);
}

function seedPluginCache(codexDir, manifest, files = []) {
  const cacheDir = path.join(codexDir, 'plugins', 'cache', 'ecc', 'ecc', packageVersion);
  writeJson(path.join(cacheDir, '.codex-plugin', 'plugin.json'), manifest);
  fs.writeFileSync(path.join(cacheDir, 'README.md'), '# cached plugin\n');
  for (const [relativePath, content] of files) {
    const target = path.join(cacheDir, relativePath);
    fs.mkdirSync(path.dirname(target), { recursive: true });
    fs.writeFileSync(target, content);
  }
  return cacheDir;
}

const cacheManifestWithLocalRefs = {
  name: 'ecc',
  version: packageVersion,
  skills: './skills/',
  mcpServers: './.mcp.json',
  interface: {
    composerIcon: './assets/ecc-icon.svg',
    logo: './assets/hero.png',
  },
};

let passed = 0;
let failed = 0;

if (
  test('shell test runner honors an explicit BASH_PATH override', () => {
    assert.strictEqual(
      resolveBashExecutable({ BASH_PATH: '/custom/git/bin/bash' }),
      '/custom/git/bin/bash',
    );
  })
)
  passed++;
else failed++;

if (
  test('shell test runner honors a per-invocation BASH_PATH override', () => {
    const tempDir = createTempDir('ecc-missing-bash-');
    try {
      const missingBash = path.join(tempDir, 'bash');
      const result = runBash(prePushHook, { env: { BASH_PATH: missingBash } });
      assert.strictEqual(result.error?.code, 'ENOENT');
    } finally {
      cleanup(tempDir);
    }
  })
)
  passed++;
else failed++;

function runHermeticPrePush({
  failScript = null,
  includeCorepack = true,
  includePnpm = false,
  audit = false,
  runChecks = true,
} = {}) {
  const tempDir = createTempDir('codex-pre-push-');
  const binDir = path.join(tempDir, 'bin');
  const projectDir = path.join(tempDir, 'project');
  const callsPath = path.join(tempDir, 'calls.txt');
  const bashEnv = path.join(tempDir, 'bash-env');
  fs.mkdirSync(binDir);
  fs.mkdirSync(projectDir);
  const functionStub = (name, corepack) => `${name}() {
${corepack ? 'node -e \'const p=require("./package.json"); process.exit(p.packageManager === "pnpm@11.9.0" ? 0 : 1)\' || return 97' : ':'}
printf '%s\\n' "${corepack ? '' : 'pnpm '}$*" >> "${toBashPath(callsPath)}"
${corepack ? 'shift' : ':'}
shift
test "$1" != "${failScript || '__never__'}"
}`;
  fs.writeFileSync(
    bashEnv,
    `git() { return 0; }
node() { "${toBashPath(process.execPath)}" "$@"; }
${includeCorepack ? functionStub('corepack', true) : ''}
${includePnpm ? functionStub('pnpm', false) : ''}
`,
  );
  fs.writeFileSync(path.join(projectDir, 'pnpm-lock.yaml'), 'lockfileVersion: 9\n');
  const initialized = spawnSync('git', ['init', '--quiet'], { cwd: projectDir });
  assert.strictEqual(initialized.status, 0, initialized.stderr?.toString());
  writeJson(path.join(projectDir, 'package.json'), {
    packageManager: 'pnpm@11.9.0',
    scripts: { lint: 'x', typecheck: 'x', test: 'x', build: 'x' },
  });
  const result = runBash(prePushHook, {
    env: {
      PATH: toBashPath(binDir),
      BASH_ENV: toBashPath(bashEnv),
      ECC_PREPUSH_AUDIT: audit ? '1' : '0',
      ECC_PREPUSH_RUN_CHECKS: runChecks ? '1' : '0',
      ECC_SKIP_GIT_HOOKS: '0',
      ECC_SKIP_PREPUSH: '0',
      MSYS_NO_PATHCONV: '1',
    },
    cwd: projectDir,
    input: Buffer.from('refs/heads/main 1111111111111111111111111111111111111111 refs/heads/main 0000000000000000000000000000000000000000\n'),
    preservePath: false,
  });
  const calls = fs.existsSync(callsPath)
    ? fs.readFileSync(callsPath, 'utf8').trim().split(/\r?\n/)
    : [];
  cleanup(tempDir);
  return { result, calls };
}

if (
  test('pre-push uses Corepack pinned pnpm and runs every required verification script', () => {
    const { result, calls } = runHermeticPrePush({ runChecks: true });
    assert.strictEqual(result.status, 0, JSON.stringify(result, null, 2));
    assert.deepStrictEqual(calls, [
      'pnpm run lint',
      'pnpm run typecheck',
      'pnpm run test',
      'pnpm run build',
    ], JSON.stringify(result, null, 2));
  })
)
  passed++;
else failed++;

if (
  test('pre-push falls back to direct pnpm when Corepack is absent', () => {
    const { result, calls } = runHermeticPrePush({
      includeCorepack: false,
      includePnpm: true,
    });
    assert.strictEqual(result.status, 0, `${result.stdout}\n${result.stderr}`);
    assert.deepStrictEqual(calls, [
      'pnpm run lint',
      'pnpm run typecheck',
      'pnpm run test',
      'pnpm run build',
    ]);
  })
)
  passed++;
else failed++;

if (
  test('pre-push fails closed when pnpm and Corepack cannot resolve', () => {
    const { result } = runHermeticPrePush({ includeCorepack: false });
    assert.notStrictEqual(result.status, 0, `${result.stdout}\n${result.stderr}`);
    assert.match(result.stderr, /pnpm.*(?:resolve|found)/i);
  })
)
  passed++;
else failed++;

if (
  test('pre-push stops immediately when a required verification script fails', () => {
    const { result, calls } = runHermeticPrePush({ runChecks: true, failScript: 'typecheck' });
    assert.notStrictEqual(result.status, 0, `${result.stdout}\n${result.stderr}`);
    assert.deepStrictEqual(calls, ['pnpm run lint', 'pnpm run typecheck']);
    assert.match(result.stderr, /typecheck failed/);
  })
)
  passed++;
else failed++;

if (
  test('pre-push skips verification scripts by default when opt-in is not set', () => {
    const { result, calls } = runHermeticPrePush({ runChecks: false });
    assert.strictEqual(result.status, 0, `${result.stdout}\n${result.stderr}`);
    assert.deepStrictEqual(calls, []);
    assert.match(result.stderr, /ECC_PREPUSH_RUN_CHECKS!=1/);
  })
)
  passed++;
else failed++;

if (
  test('pre-push runs the production audit through Corepack pnpm', () => {
    const { result, calls } = runHermeticPrePush({ runChecks: true, audit: true });
    assert.strictEqual(result.status, 0, `${result.stdout}\n${result.stderr}`);
    assert.deepStrictEqual(calls, [
      'pnpm run lint',
      'pnpm run typecheck',
      'pnpm run test',
      'pnpm run build',
      'pnpm audit --prod',
    ]);
  })
)
  passed++;
else failed++;

if (
  test('pre-push fails closed when the production audit fails', () => {
    const { result, calls } = runHermeticPrePush({ audit: true, failScript: '--prod' });
    assert.notStrictEqual(result.status, 0, `${result.stdout}\n${result.stderr}`);
    assert.deepStrictEqual(calls, [
      'pnpm run lint',
      'pnpm run typecheck',
      'pnpm run test',
      'pnpm run build',
      'pnpm audit --prod',
    ]);
    assert.match(result.stderr, /pnpm audit failed/);
  })
)
  passed++;
else failed++;

function writeExecutable(filePath, body) {
  fs.mkdirSync(path.dirname(filePath), { recursive: true });
  fs.writeFileSync(filePath, body);
  fs.chmodSync(filePath, 0o755);
}

// The Python arm of the hook, exercised without a real interpreter: the stubs
// record the argv they were handed, which is what the virtualenv-path regression
// is actually about.
function runHermeticPythonPrePush({
  venvName = null,
  venvExit = 0,
  trackVenv = false,
  trackedVenvBasename = 'python',
  trackedSymlinkVenv = false,
  pytestCmd = null,
  overrideStub = false,
  pathPytestVersionLine = null,
} = {}) {
  const tempDir = createTempDir('codex-pre-push-py-');
  const projectDir = path.join(tempDir, 'project');
  const callsPath = path.join(tempDir, 'calls.txt');
  fs.mkdirSync(projectDir);
  fs.writeFileSync(path.join(projectDir, 'pyproject.toml'), '[project]\nname = "demo"\n');
  const initialized = spawnSync('git', ['init', '--quiet'], { cwd: projectDir });
  assert.strictEqual(initialized.status, 0, initialized.stderr?.toString());

  // Every stub records the argv it was handed. That record is the assertion: it is
  // how a test tells a preserved path from a split one, and a command that was run
  // once from one the hook probed first.
  const record = `printf '%s\\n' "$0|$*" >> "${toBashPath(callsPath)}"`;

  // A tracked venv has to live inside the repository to be trackable at all, and is
  // found by directory-name discovery rather than by VIRTUAL_ENV.
  const venvDir = venvName === null ? null : path.join(trackVenv ? projectDir : tempDir, venvName);
  const venvPython = venvDir === null
    ? null
    : path.join(venvDir, 'bin', trackVenv ? trackedVenvBasename : 'python');
  if (venvPython !== null) {
    writeExecutable(venvPython, `#!/bin/sh\n${record}\ncase " $* " in *" -c "*) exit 0 ;; esac\nexit ${venvExit}\n`);
    if (trackVenv) {
      // Staged, not committed: `git ls-files` reads the index, so this is enough to
      // make the file repository-controlled without needing a committer identity.
      const added = spawnSync('git', ['add', '-f', '--', venvPython], { cwd: projectDir });
      assert.strictEqual(added.status, 0, added.stderr?.toString());
    }
  }

  // The shape that defeats a naive `git ls-files -- .venv/bin/python` check: the
  // repository commits `.venv` as a symlink to its own root plus a tracked
  // `bin/python`, so git is asked about a path it has never indexed.
  if (trackedSymlinkVenv) {
    writeExecutable(path.join(projectDir, 'bin', 'python'), `#!/bin/sh\n${record}\nexit 0\n`);
    fs.symlinkSync('.', path.join(projectDir, '.venv'));
    const added = spawnSync('git', ['add', '-f', '--', 'bin/python', '.venv'], { cwd: projectDir });
    assert.strictEqual(added.status, 0, added.stderr?.toString());
  }

  // Deliberately does NOT special-case --version: an operator's wrapper would not
  // either, and the recorded calls are what prove the hook never probed it.
  const overrideStubPath = overrideStub ? path.join(tempDir, 'bin', 'wrapper') : null;
  if (overrideStubPath !== null) {
    writeExecutable(overrideStubPath, `#!/bin/sh\n${record}\nexit 0\n`);
  }

  const pathBin = pathPytestVersionLine === null ? null : path.join(tempDir, 'pathbin');
  if (pathBin !== null) {
    writeExecutable(
      path.join(pathBin, 'pytest'),
      `#!/bin/sh\nif [ "$1" = "--version" ]; then printf '%s\\n' '${pathPytestVersionLine}'; exit 0; fi\n${record}\nexit 0\n`,
    );
  }

  const override = overrideStubPath === null ? pytestCmd : toBashPath(overrideStubPath);
  // Built from nothing rather than from process.env. The hook reads VIRTUAL_ENV and
  // ECC_PYTEST_CMD from the ambient environment, so a developer running this suite
  // inside an activated virtualenv, or with ECC_PYTEST_CMD exported, would resolve a
  // pytest the fixture never created. Omitted, not blanked: now that a variable set
  // to nothing is itself an override, blanking it here would make every one of these
  // tests take that branch.
  const env = {
    PATH: pathBin === null
      ? process.env.PATH
      : `${toBashPath(pathBin)}${path.delimiter}${process.env.PATH}`,
    HOME: process.env.HOME ?? '',
    ECC_SKIP_GIT_HOOKS: '0',
    ECC_SKIP_PREPUSH: '0',
    MSYS_NO_PATHCONV: '1',
    ...(venvDir === null || trackVenv ? {} : { VIRTUAL_ENV: toBashPath(venvDir) }),
    ...(override === null ? {} : { ECC_PYTEST_CMD: override }),
  };

  const result = runBash(prePushHook, {
    env,
    cwd: projectDir,
    preservePath: false,
    input: Buffer.from('refs/heads/main 1111111111111111111111111111111111111111 refs/heads/main 0000000000000000000000000000000000000000\n'),
  });
  const calls = fs.existsSync(callsPath)
    ? fs.readFileSync(callsPath, 'utf8').trim().split(/\r?\n/).filter(Boolean)
    : [];
  cleanup(tempDir);
  return { result, calls, venvPython, overrideStubPath };
}

if (
  test('pre-push runs pytest from a virtualenv whose path contains spaces', () => {
    const { result, calls, venvPython } = runHermeticPythonPrePush({ venvName: 'my venv' });
    const python = toBashPath(venvPython);
    assert.strictEqual(result.status, 0, `${result.stdout}\n${result.stderr}`);
    assert.deepStrictEqual(calls, [
      `${python}|-I -c import pytest`,
      `${python}|-m pytest -q`,
    ], JSON.stringify({ calls, python, stdout: result.stdout, stderr: result.stderr }, null, 2));
  })
)
  passed++;
else failed++;

if (
  test('pre-push refuses to run a virtualenv python that the repository tracks', () => {
    const { result, calls } = runHermeticPythonPrePush({ venvName: '.venv', trackVenv: true });
    assert.strictEqual(result.status, 0, `${result.stdout}\n${result.stderr}`);
    assert.deepStrictEqual(calls, [], JSON.stringify(calls));
    assert.match(result.stdout, /the repository ships it/);
  })
)
  passed++;
else failed++;

// A case-folded spelling, because macOS resolves `$venv/bin/python` to a committed
// `Python` while git matches index pathspecs case-sensitively. Skipped where the
// filesystem is case-sensitive and the two names cannot collide.
if (fs.existsSync(__filename.toUpperCase()) || fs.existsSync(__filename.toLowerCase())) {
  if (
    test('pre-push refuses a tracked interpreter committed under a folded case', () => {
      const { result, calls } = runHermeticPythonPrePush({
        venvName: '.venv',
        trackVenv: true,
        trackedVenvBasename: 'Python',
      });
      assert.strictEqual(result.status, 0, `${result.stdout}\n${result.stderr}`);
      assert.deepStrictEqual(calls, [], JSON.stringify(calls));
      assert.match(result.stdout, /the repository ships it/);
    })
  )
    passed++;
  else failed++;
}

if (
  test('pre-push refuses a tracked interpreter reached through a committed symlink', () => {
    const { result, calls } = runHermeticPythonPrePush({ trackedSymlinkVenv: true });
    assert.strictEqual(result.status, 0, `${result.stdout}\n${result.stderr}`);
    assert.deepStrictEqual(calls, [], JSON.stringify(calls));
    assert.match(result.stdout, /the repository ships it/);
  })
)
  passed++;
else failed++;

if (
  test('pre-push blocks the push when the resolved pytest fails', () => {
    const { result } = runHermeticPythonPrePush({ venvName: 'venv-red', venvExit: 1 });
    assert.notStrictEqual(result.status, 0, `${result.stdout}\n${result.stderr}`);
    assert.match(result.stderr, /pytest failed \(exit 1\)/);
    assert.doesNotMatch(result.stdout, /Verification checks passed/);
  })
)
  passed++;
else failed++;

if (
  test('pre-push does not block when pytest collected no tests (exit 5)', () => {
    const { result } = runHermeticPythonPrePush({ venvName: 'venv-empty', venvExit: 5 });
    assert.strictEqual(result.status, 0, `${result.stdout}\n${result.stderr}`);
    assert.match(result.stdout, /collected no tests \(exit 5\)/);
    assert.match(result.stdout, /rootdir, testpaths, and conftest\.py/);
  })
)
  passed++;
else failed++;

if (
  test('pre-push runs an ECC_PYTEST_CMD override exactly once, without probing it', () => {
    const { result, calls, overrideStubPath } = runHermeticPythonPrePush({ overrideStub: true });
    assert.strictEqual(result.status, 0, `${result.stdout}\n${result.stderr}`);
    assert.deepStrictEqual(calls, [`${toBashPath(overrideStubPath)}|-q`], JSON.stringify(calls));
    // The override is not verified to be pytest, so it must at least be loud.
    assert.match(result.stdout, /via ECC_PYTEST_CMD/);
    assert.match(result.stdout, /does\n?.*not check that it is pytest/s);
  })
)
  passed++;
else failed++;

// Both blank forms, because they used to disagree: an unquoted empty value fell
// through to discovery while whitespace failed the push. A venv is present so a
// fall-through would be visible as a pass rather than as an absence.
for (const [label, blank] of [['empty', ''], ['whitespace', '   ']]) {
  if (
    test(`pre-push fails closed when ECC_PYTEST_CMD is set to ${label}`, () => {
      const { result, calls } = runHermeticPythonPrePush({
        venvName: 'venv-blank',
        pytestCmd: blank,
      });
      assert.notStrictEqual(result.status, 0, `${result.stdout}\n${result.stderr}`);
      assert.match(result.stderr, /ECC_PYTEST_CMD is set but names no command/);
      assert.deepStrictEqual(calls, [], JSON.stringify(calls));
    })
  )
    passed++;
  else failed++;
}

if (
  test('pre-push rejects a PATH pytest that does not identify itself as pytest', () => {
    const { result, calls } = runHermeticPythonPrePush({
      pathPytestVersionLine: 'true (GNU coreutils) 9.0',
    });
    assert.strictEqual(result.status, 0, `${result.stdout}\n${result.stderr}`);
    assert.match(result.stdout, /no pytest found/);
    assert.deepStrictEqual(calls, []);
  })
)
  passed++;
else failed++;

if (
  test('pre-push accepts a PATH pytest that reports a pytest version', () => {
    const { result, calls } = runHermeticPythonPrePush({ pathPytestVersionLine: 'pytest 8.0.0' });
    assert.strictEqual(result.status, 0, `${result.stdout}\n${result.stderr}`);
    assert.strictEqual(calls.length, 1, JSON.stringify(calls));
    assert.match(calls[0], /\|-q$/);
  })
)
  passed++;
else failed++;


if (
  test('check-plugin-cache fails when the installed cache is missing manifest-referenced files', () => {
    const homeDir = createTempDir('codex-plugin-cache-home-');
    const codexDir = path.join(homeDir, '.codex');

    try {
      seedPluginCache(codexDir, cacheManifestWithLocalRefs);
      const result = runNode(pluginCacheCheckScript, [], makeHermeticCodexEnv(homeDir, codexDir));

      assert.strictEqual(result.status, 1, `${result.stdout}\n${result.stderr}`);
      assert.match(result.stdout, /Plugin cache:/);
      assert.match(result.stdout, /\[FAIL\] skills missing/);
      assert.match(result.stdout, /\[FAIL\] mcpServers missing/);
      assert.match(result.stdout, /codex plugin list only confirms marketplace registration/);
      assert.match(result.stdout, /sync-ecc-to-codex\.sh/);
    } finally {
      cleanup(homeDir);
    }
  })
)
  passed++;
else failed++;

if (
  test('check-plugin-cache rejects manifest references that escape the cache boundary', () => {
    const homeDir = createTempDir('codex-plugin-cache-manifest-traversal-home-');
    const codexDir = path.join(homeDir, '.codex');

    try {
      seedPluginCache(codexDir, {
        name: 'ecc',
        version: packageVersion,
        skills: '../../../../../etc/passwd',
        mcpServers: '../../.mcp.json',
      });
      const result = runNode(pluginCacheCheckScript, [], makeHermeticCodexEnv(homeDir, codexDir));

      assert.strictEqual(result.status, 1, `${result.stdout}\n${result.stderr}`);
      assert.match(result.stdout, /\[FAIL\] skills escapes cache boundary/);
      assert.match(result.stdout, /\[FAIL\] mcpServers escapes cache boundary/);
      assert.doesNotMatch(result.stdout, /etc\/passwd/);
    } finally {
      cleanup(homeDir);
    }
  })
)
  passed++;
else failed++;

if (
  test('check-plugin-cache passes when cached manifest references resolve inside the cache', () => {
    const homeDir = createTempDir('codex-plugin-cache-ok-home-');
    const codexDir = path.join(homeDir, '.codex');

    try {
      const cacheDir = seedPluginCache(codexDir, cacheManifestWithLocalRefs, [
        ['.mcp.json', '{"mcpServers":{}}\n'],
        ['assets/ecc-icon.svg', '<svg />\n'],
        ['assets/hero.png', 'png\n'],
      ]);
      fs.mkdirSync(path.join(cacheDir, 'skills'), { recursive: true });

      const result = runNode(pluginCacheCheckScript, [], makeHermeticCodexEnv(homeDir, codexDir));

      assert.strictEqual(result.status, 0, `${result.stdout}\n${result.stderr}`);
      assert.match(result.stdout, /\[OK\] skills/);
      assert.match(result.stdout, /\[OK\] mcpServers/);
      assert.match(result.stdout, /All cached manifest references resolve/);
    } finally {
      cleanup(homeDir);
    }
  })
)
  passed++;
else failed++;

if (
  test('check-plugin-cache reports a missing installed cache clearly', () => {
    const homeDir = createTempDir('codex-plugin-cache-missing-home-');
    const codexDir = path.join(homeDir, '.codex');

    try {
      const result = runNode(pluginCacheCheckScript, [], makeHermeticCodexEnv(homeDir, codexDir));

      assert.strictEqual(result.status, 1, `${result.stdout}\n${result.stderr}`);
      assert.match(result.stdout, /Cached plugin manifest missing/);
      assert.match(result.stdout, /codex plugin marketplace add affaan-m\/ECC/);
    } finally {
      cleanup(homeDir);
    }
  })
)
  passed++;
else failed++;

if (
  test('check-plugin-cache rejects traversal in cache path segments', () => {
    const homeDir = createTempDir('codex-plugin-cache-traversal-home-');
    const codexDir = path.join(homeDir, '.codex');

    try {
      const result = runNode(
        pluginCacheCheckScript,
        ['--marketplace', '../outside'],
        makeHermeticCodexEnv(homeDir, codexDir)
      );

      assert.strictEqual(result.status, 1, `${result.stdout}\n${result.stderr}`);
      assert.match(result.stderr, /Invalid --marketplace/);
    } finally {
      cleanup(homeDir);
    }
  })
)
  passed++;
else failed++;

if (
  test('check-plugin-cache names custom missing cache entries in diagnostics', () => {
    const homeDir = createTempDir('codex-plugin-cache-custom-home-');
    const codexDir = path.join(homeDir, '.codex');

    try {
      const result = runNode(
        pluginCacheCheckScript,
        ['--marketplace', 'custom-market', '--plugin', 'custom-plugin', '--version', '1.2.3'],
        makeHermeticCodexEnv(homeDir, codexDir)
      );

      assert.strictEqual(result.status, 1, `${result.stdout}\n${result.stderr}`);
      assert.match(result.stdout, /No installed cache entries found for custom-market\/custom-plugin/);
      assert.match(result.stdout, /Install the requested plugin into the Codex plugin cache/);
    } finally {
      cleanup(homeDir);
    }
  })
)
  passed++;
else failed++;

// Windows NTFS does not allow double-quote characters in file paths,
// so the quoted-path shell-injection test is only meaningful on Unix.
if (os.platform() === 'win32') {
  console.log('  - install-global-git-hooks.sh quoted paths (skipped on Windows)');
} else if (
  test('install-global-git-hooks.sh handles quoted hook paths without shell injection', () => {
    const homeDir = createTempDir('codex-hooks-home-');
    const weirdHooksDir = path.join(homeDir, 'git-hooks "quoted"');

    try {
      const result = runBash(installScript, {
        env: {
          HOME: homeDir,
          ECC_GLOBAL_HOOKS_DIR: weirdHooksDir,
        },
      });

      assert.strictEqual(result.status, 0, result.stderr || result.stdout);
      assert.ok(fs.existsSync(path.join(weirdHooksDir, 'pre-commit')));
      assert.ok(fs.existsSync(path.join(weirdHooksDir, 'pre-push')));
    } finally {
      cleanup(homeDir);
    }
  })
)
  passed++;
else failed++;

if (
  test('merge-codex-config reports usage, missing files, and TOML parse failures', () => {
    const tempDir = createTempDir('codex-merge-errors-');

    try {
      const noArgs = runNode(mergeCodexConfigScript);
      assert.strictEqual(noArgs.status, 1);
      assert.match(noArgs.stderr, /Usage: merge-codex-config\.js/);

      const missingPath = path.join(tempDir, 'missing-config.toml');
      const missing = runNode(mergeCodexConfigScript, [missingPath]);
      assert.strictEqual(missing.status, 1);
      assert.match(missing.stderr, /Config file not found/);

      const invalidPath = path.join(tempDir, 'invalid-config.toml');
      fs.writeFileSync(invalidPath, 'approval_policy = [\n');
      const invalid = runNode(mergeCodexConfigScript, [invalidPath]);
      assert.strictEqual(invalid.status, 1);
      assert.match(invalid.stderr, /Failed to parse TOML/);
    } finally {
      cleanup(tempDir);
    }
  })
)
  passed++;
else failed++;

if (
  test('merge-codex-config dry-run reports additions without mutating the target', () => {
    const tempDir = createTempDir('codex-merge-dry-run-');
    const configPath = path.join(tempDir, 'config.toml');
    const original = '';

    try {
      fs.writeFileSync(configPath, original);
      const result = runNode(mergeCodexConfigScript, [configPath, '--dry-run']);

      assert.strictEqual(result.status, 0, `${result.stdout}\n${result.stderr}`);
      assert.match(result.stdout, /\[add-root\]/);
      assert.match(result.stdout, /\[add-table\] \[features\]/);
      assert.match(result.stdout, /Dry run/);
      assert.strictEqual(fs.readFileSync(configPath, 'utf8'), original);
    } finally {
      cleanup(tempDir);
    }
  })
)
  passed++;
else failed++;

if (
  test('merge-codex-config preserves user root choices while adding missing baseline tables', () => {
    const tempDir = createTempDir('codex-merge-add-only-');
    const configPath = path.join(tempDir, 'config.toml');

    try {
      fs.writeFileSync(configPath, 'approval_policy = "never"\n');
      const result = runNode(mergeCodexConfigScript, [configPath]);

      assert.strictEqual(result.status, 0, `${result.stdout}\n${result.stderr}`);
      assert.match(result.stdout, /Done\. Baseline Codex settings merged\./);

      const merged = fs.readFileSync(configPath, 'utf8');
      const parsed = TOML.parse(merged);
      assert.strictEqual(parsed.approval_policy, 'never');
      assert.strictEqual(parsed.sandbox_mode, 'workspace-write');
      assert.strictEqual(parsed.web_search, 'live');
      assert.strictEqual(parsed.features.multi_agent, true);
      assert.strictEqual(parsed.profiles.strict.approval_policy, 'on-request');
      assert.strictEqual(parsed.profiles.yolo.approval_policy, 'never');
      assert.strictEqual(parsed.agents.max_threads, 6);
      assert.strictEqual(parsed.agents.explorer.config_file, 'agents/explorer.toml');
    } finally {
      cleanup(tempDir);
    }
  })
)
  passed++;
else failed++;

if (
  test('merge-codex-config no-ops when the Codex baseline is already present', () => {
    const tempDir = createTempDir('codex-merge-noop-');
    const configPath = path.join(tempDir, 'config.toml');
    const original = fs.readFileSync(path.join(repoRoot, '.codex', 'config.toml'), 'utf8');

    try {
      fs.writeFileSync(configPath, original);
      const result = runNode(mergeCodexConfigScript, [configPath]);

      assert.strictEqual(result.status, 0, `${result.stdout}\n${result.stderr}`);
      assert.match(result.stdout, /All baseline Codex settings already present/);
      assert.strictEqual(fs.readFileSync(configPath, 'utf8'), original);
    } finally {
      cleanup(tempDir);
    }
  })
)
  passed++;
else failed++;

if (
  test('merge-codex-config warns when inline tables cannot be safely extended', () => {
    const tempDir = createTempDir('codex-merge-inline-warn-');
    const configPath = path.join(tempDir, 'config.toml');
    const original = 'agents = { explorer = { description = "custom explorer" } }\n';

    try {
      fs.writeFileSync(configPath, original);
      const result = runNode(mergeCodexConfigScript, [configPath, '--dry-run']);

      assert.strictEqual(result.status, 0, `${result.stdout}\n${result.stderr}`);
      assert.match(result.stderr, /WARNING: Skipping missing keys/);
      assert.strictEqual(fs.readFileSync(configPath, 'utf8'), original);
    } finally {
      cleanup(tempDir);
    }
  })
)
  passed++;
else failed++;

if (
  test('merge-mcp-config reports usage, missing files, and TOML parse failures', () => {
    const tempDir = createTempDir('mcp-merge-errors-');

    try {
      const noArgs = runNode(mergeMcpConfigScript, [], deterministicPackageEnv);
      assert.strictEqual(noArgs.status, 1);
      assert.match(noArgs.stderr, /Usage: merge-mcp-config\.js/);

      const missingPath = path.join(tempDir, 'missing-config.toml');
      const missing = runNode(mergeMcpConfigScript, [missingPath], deterministicPackageEnv);
      assert.strictEqual(missing.status, 1);
      assert.match(missing.stderr, /Config file not found/);

      const invalidPath = path.join(tempDir, 'invalid-config.toml');
      fs.writeFileSync(invalidPath, '[mcp_servers.github\n');
      const invalid = runNode(mergeMcpConfigScript, [invalidPath], deterministicPackageEnv);
      assert.strictEqual(invalid.status, 1);
      assert.match(invalid.stderr, /Failed to parse/);
    } finally {
      cleanup(tempDir);
    }
  })
)
  passed++;
else failed++;

if (
  test('merge-mcp-config dry-run appends the current default set without mutating target', () => {
    const tempDir = createTempDir('mcp-merge-dry-run-');
    const configPath = path.join(tempDir, 'config.toml');
    const original = '';

    try {
      fs.writeFileSync(configPath, original);
      const result = runNode(mergeMcpConfigScript, [configPath, '--dry-run'], deterministicPackageEnv);

      assert.strictEqual(result.status, 0, `${result.stdout}\n${result.stderr}`);
      assert.match(result.stdout, /Package manager: npm \(exec: npx\)/);
      assert.match(result.stdout, /\[add\] mcp_servers\.chrome-devtools/);
      assert.match(result.stdout, /\[mcp_servers\.chrome-devtools\]/);
      assert.match(result.stdout, /Dry run/);
      // Retired defaults (June 2026 connector policy) must not be emitted.
      assert.doesNotMatch(result.stdout, /mcp_servers\.(supabase|playwright|context7|exa|github|memory|sequential-thinking)\b/);
      assert.doesNotMatch(result.stdout, /url = /);
      assert.strictEqual(fs.readFileSync(configPath, 'utf8'), original);
    } finally {
      cleanup(tempDir);
    }
  })
)
  passed++;
else failed++;

if (
  test('merge-mcp-config no-ops after all recommended servers are present', () => {
    const tempDir = createTempDir('mcp-merge-noop-');
    const configPath = path.join(tempDir, 'config.toml');

    try {
      fs.writeFileSync(configPath, '');
      const first = runNode(mergeMcpConfigScript, [configPath], deterministicPackageEnv);
      assert.strictEqual(first.status, 0, `${first.stdout}\n${first.stderr}`);

      const merged = fs.readFileSync(configPath, 'utf8');
      const parsed = TOML.parse(merged);
      assert.strictEqual(parsed.mcp_servers['chrome-devtools'].command, 'npx');
      assert.deepStrictEqual(parsed.mcp_servers['chrome-devtools'].args, ['chrome-devtools-mcp@latest']);
      assert.strictEqual(parsed.mcp_servers['chrome-devtools'].startup_timeout_sec, 30);
      // No retired server may be (re-)emitted — exa's url form broke Codex (#2224).
      assert.strictEqual(parsed.mcp_servers.exa, undefined);
      assert.strictEqual(parsed.mcp_servers.github, undefined);
      assert.strictEqual(parsed.mcp_servers.supabase, undefined);

      const second = runNode(mergeMcpConfigScript, [configPath], deterministicPackageEnv);
      assert.strictEqual(second.status, 0, `${second.stdout}\n${second.stderr}`);
      assert.match(second.stdout, /\[ok\] mcp_servers\.chrome-devtools/);
      assert.match(second.stdout, /All ECC MCP servers already present/);
      assert.strictEqual(fs.readFileSync(configPath, 'utf8'), merged);
    } finally {
      cleanup(tempDir);
    }
  })
)
  passed++;
else failed++;

if (
  test('merge-mcp-config repairs the invalid exa url entry from earlier ECC versions (#2224)', () => {
    const tempDir = createTempDir('mcp-merge-exa-repair-');
    const configPath = path.join(tempDir, 'config.toml');
    const original = [
      '[mcp_servers.github]',
      'command = "npx"',
      'args = ["-y", "@modelcontextprotocol/server-github"]',
      '',
      '[mcp_servers.exa]',
      'url = "https://mcp.exa.ai/mcp"',
      '',
    ].join('\n');

    try {
      fs.writeFileSync(configPath, original);
      const result = runNode(mergeMcpConfigScript, [configPath], deterministicPackageEnv);

      assert.strictEqual(result.status, 0, `${result.stdout}\n${result.stderr}`);
      assert.match(result.stdout, /\[repair\] mcp_servers\.exa/);

      const updated = fs.readFileSync(configPath, 'utf8');
      const parsed = TOML.parse(updated);
      assert.strictEqual(parsed.mcp_servers.exa, undefined, 'invalid exa url entry must be removed');
      assert.doesNotMatch(updated, /url = "https:\/\/mcp\.exa\.ai\/mcp"/);
      // User-managed servers are untouched; current default is added.
      assert.strictEqual(parsed.mcp_servers.github.command, 'npx');
      assert.strictEqual(parsed.mcp_servers['chrome-devtools'].command, 'npx');

      // Re-running must not re-introduce the invalid entry.
      const second = runNode(mergeMcpConfigScript, [configPath], deterministicPackageEnv);
      assert.strictEqual(second.status, 0, `${second.stdout}\n${second.stderr}`);
      assert.doesNotMatch(fs.readFileSync(configPath, 'utf8'), /mcp_servers\.exa/);
    } finally {
      cleanup(tempDir);
    }
  })
)
  passed++;
else failed++;

if (
  test('merge-mcp-config leaves a user-managed stdio exa entry untouched', () => {
    const tempDir = createTempDir('mcp-merge-exa-stdio-');
    const configPath = path.join(tempDir, 'config.toml');
    const original = [
      '[mcp_servers.exa]',
      'command = "npx"',
      'args = ["-y", "mcp-remote", "https://mcp.exa.ai/mcp"]',
      'startup_timeout_sec = 30',
      '',
    ].join('\n');

    try {
      fs.writeFileSync(configPath, original);
      const result = runNode(mergeMcpConfigScript, [configPath], deterministicPackageEnv);

      assert.strictEqual(result.status, 0, `${result.stdout}\n${result.stderr}`);
      assert.doesNotMatch(result.stdout, /\[repair\]/);

      const parsed = TOML.parse(fs.readFileSync(configPath, 'utf8'));
      assert.strictEqual(parsed.mcp_servers.exa.command, 'npx');
      assert.deepStrictEqual(parsed.mcp_servers.exa.args, ['-y', 'mcp-remote', 'https://mcp.exa.ai/mcp']);
    } finally {
      cleanup(tempDir);
    }
  })
)
  passed++;
else failed++;

if (
  test('merge-mcp-config update dry-run refreshes managed sections and leaves user servers alone', () => {
    const tempDir = createTempDir('mcp-merge-update-dry-run-');
    const configPath = path.join(tempDir, 'config.toml');
    const original = [
      '[mcp_servers.chrome-devtools]',
      'command = "custom"',
      'args = ["old"]',
      '',
      '[mcp_servers.context7]',
      'command = "npx"',
      'args = ["-y", "@upstash/context7-mcp@latest"]',
      '',
    ].join('\n');

    try {
      fs.writeFileSync(configPath, original);
      const result = runNode(mergeMcpConfigScript, [configPath, '--update-mcp', '--dry-run'], deterministicPackageEnv);

      assert.strictEqual(result.status, 0, `${result.stdout}\n${result.stderr}`);
      assert.match(result.stdout, /\[remove\] mcp_servers\.chrome-devtools/);
      assert.match(result.stdout, /\[mcp_servers\.chrome-devtools\]/);
      // Retired servers are no longer ECC-managed: never removed or re-added.
      assert.doesNotMatch(result.stdout, /\[remove\] mcp_servers\.context7/);
      assert.strictEqual(fs.readFileSync(configPath, 'utf8'), original);
    } finally {
      cleanup(tempDir);
    }
  })
)
  passed++;
else failed++;

if (
  test('merge-mcp-config removes disabled servers without appending replacements', () => {
    const tempDir = createTempDir('mcp-merge-disabled-');
    const configPath = path.join(tempDir, 'config.toml');
    const original = [
      '[mcp_servers.chrome-devtools]',
      'command = "npx"',
      'args = ["chrome-devtools-mcp@latest"]',
      '',
    ].join('\n');

    try {
      fs.writeFileSync(configPath, original);
      const result = runNode(mergeMcpConfigScript, [configPath], {
        ...deterministicPackageEnv,
        ECC_DISABLED_MCPS: 'chrome-devtools',
      });

      assert.strictEqual(result.status, 0, `${result.stdout}\n${result.stderr}`);
      assert.match(result.stdout, /Disabled via ECC_DISABLED_MCPS/);
      assert.match(result.stdout, /\[skip\] mcp_servers\.chrome-devtools \(disabled\)/);
      assert.match(result.stdout, /\[update\] mcp_servers\.chrome-devtools \(disabled\)/);
      assert.match(result.stdout, /Done\. Removed 1 server section\(s\)\./);

      const updated = fs.readFileSync(configPath, 'utf8');
      assert.doesNotMatch(updated, /chrome-devtools/);
    } finally {
      cleanup(tempDir);
    }
  })
)
  passed++;
else failed++;

if (
  test('sync installs the missing Codex baseline and accepts the legacy context7 MCP section', () => {
    const homeDir = createTempDir('codex-sync-home-');
    const codexDir = path.join(homeDir, '.codex');
    const configPath = path.join(codexDir, 'config.toml');
    const agentsPath = path.join(codexDir, 'AGENTS.md');
    const config = [
      'persistent_instructions = ""',
      '',
      '[agents]',
      'explorer = { description = "Read-only codebase explorer for gathering evidence before changes are proposed." }',
      '',
      '[mcp_servers.context7]',
      'command = "npx"',
      'args = ["-y", "@upstash/context7-mcp"]',
      '',
      '[mcp_servers.github]',
      'command = "npx"',
      'args = ["-y", "@modelcontextprotocol/server-github"]',
      '',
      '[mcp_servers.memory]',
      'command = "npx"',
      'args = ["-y", "@modelcontextprotocol/server-memory"]',
      '',
      '[mcp_servers.sequential-thinking]',
      'command = "npx"',
      'args = ["-y", "@modelcontextprotocol/server-sequential-thinking"]',
      '',
    ].join('\n');

    try {
      fs.mkdirSync(codexDir, { recursive: true });
      fs.writeFileSync(configPath, config);

      const syncResult = runBash(syncScript, {
        args: ['--update-mcp'],
        env: makeHermeticCodexEnv(homeDir, codexDir),
      });
      assert.strictEqual(syncResult.status, 0, `${syncResult.stdout}\n${syncResult.stderr}`);

      const syncedAgents = fs.readFileSync(agentsPath, 'utf8');
      assert.match(syncedAgents, /^# Everything Claude Code \(ECC\) — Agent Instructions/m);
      assert.match(syncedAgents, /^# Codex Supplement \(From ECC \.codex\/AGENTS\.md\)/m);

      const syncedConfig = fs.readFileSync(configPath, 'utf8');
      const parsedConfig = TOML.parse(syncedConfig);
      assert.strictEqual(parsedConfig.approval_policy, 'on-request');
      assert.strictEqual(parsedConfig.sandbox_mode, 'workspace-write');
      assert.strictEqual(parsedConfig.web_search, 'live');
      assert.ok(!Object.prototype.hasOwnProperty.call(parsedConfig, 'multi_agent'));
      assert.ok(parsedConfig.features);
      assert.strictEqual(parsedConfig.features.multi_agent, true);
      assert.ok(parsedConfig.profiles);
      assert.strictEqual(parsedConfig.profiles.strict.approval_policy, 'on-request');
      assert.strictEqual(parsedConfig.profiles.yolo.approval_policy, 'never');
      assert.ok(parsedConfig.agents);
      assert.strictEqual(parsedConfig.agents.max_threads, 6);
      assert.strictEqual(parsedConfig.agents.max_depth, 1);
      assert.strictEqual(parsedConfig.agents.explorer.config_file, 'agents/explorer.toml');
      assert.strictEqual(parsedConfig.agents.reviewer.config_file, 'agents/reviewer.toml');
      assert.strictEqual(parsedConfig.agents.docs_researcher.config_file, 'agents/docs-researcher.toml');
      // Current default connector is added; retired servers are not emitted,
      // and pre-existing user-managed entries are preserved untouched.
      assert.ok(parsedConfig.mcp_servers['chrome-devtools']);
      assert.strictEqual(parsedConfig.mcp_servers.exa, undefined);
      assert.ok(parsedConfig.mcp_servers.github);
      assert.ok(parsedConfig.mcp_servers.memory);
      assert.ok(parsedConfig.mcp_servers['sequential-thinking']);
      assert.ok(parsedConfig.mcp_servers.context7);

      for (const roleFile of ['explorer.toml', 'reviewer.toml', 'docs-researcher.toml']) {
        assert.ok(fs.existsSync(path.join(codexDir, 'agents', roleFile)));
      }
    } finally {
      cleanup(homeDir);
    }
  })
)
  passed++;
else failed++;

if (
  test('sync adds parent-table keys when the target only declares an implicit parent table', () => {
    const homeDir = createTempDir('codex-sync-implicit-parent-home-');
    const codexDir = path.join(homeDir, '.codex');
    const configPath = path.join(codexDir, 'config.toml');
    const config = [
      'persistent_instructions = ""',
      '',
      '[agents.explorer]',
      'description = "Read-only codebase explorer for gathering evidence before changes are proposed."',
      '',
    ].join('\n');

    try {
      fs.mkdirSync(codexDir, { recursive: true });
      fs.writeFileSync(configPath, config);

      const syncResult = runBash(syncScript, {
        env: makeHermeticCodexEnv(homeDir, codexDir),
      });
      assert.strictEqual(syncResult.status, 0, `${syncResult.stdout}\n${syncResult.stderr}`);

      const parsedConfig = TOML.parse(fs.readFileSync(configPath, 'utf8'));
      assert.strictEqual(parsedConfig.agents.max_threads, 6);
      assert.strictEqual(parsedConfig.agents.max_depth, 1);
      assert.strictEqual(parsedConfig.agents.explorer.config_file, 'agents/explorer.toml');
    } finally {
      cleanup(homeDir);
    }
  })
)
  passed++;
else failed++;

console.log(`\nPassed: ${passed}`);
console.log(`Failed: ${failed}`);
process.exit(failed > 0 ? 1 : 0);
