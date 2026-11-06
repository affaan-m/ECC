/**
 * Tests for observe.sh running Python Install Manager's launcher instead of
 * its WindowsApps alias.
 *
 * With the Python Install Manager, python3/python in
 * %LOCALAPPDATA%\Microsoft\WindowsApps are App Execution Aliases. Every start
 * of one makes Windows run an App Installer update check (AppXDeploymentServer
 * event 603), and observe.sh starts Python several times per tool call. The
 * Install Manager's global shortcuts in %LOCALAPPDATA%\Python\bin start the
 * same runtime without that check, so observe.sh runs those when they exist.
 *
 * Stand-in aliases and launchers are shell scripts that log which one ran and
 * the CLV2_PYTHON_CMD observe.sh exported for detect-project.sh. A `disabled`
 * file in the homunculus dir makes observe.sh exit right after its first
 * Python call, so nothing else in the hook runs. One test leaves the hook
 * enabled so it reaches detect-project.sh, whose project-id hash call the
 * stand-ins mark as `detect-project`.
 *
 * Run with: node tests/hooks/clv2-pymanager-launcher.test.js
 */

'use strict';

const assert = require('assert');
const fs = require('fs');
const os = require('os');
const path = require('path');
const { spawnSync } = require('child_process');

const repoRoot = path.resolve(__dirname, '..', '..');
const observeShPath = path.join(repoRoot, 'skills', 'continuous-learning-v2', 'hooks', 'observe.sh');

const probe = spawnSync('bash', ['-c', 'printf "%s" "$OSTYPE"'], { encoding: 'utf8' });
if (probe.status !== 0 || (process.platform === 'win32' && !/^(msys|cygwin)/.test(probe.stdout || ''))) {
  console.log('Skipping CLv2 Python Install Manager launcher tests: no POSIX bash on PATH\n');
  process.exit(0);
}

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

// Converts the Windows paths Node hands over into POSIX paths (the real
// cygpath is needed for that under Git Bash), wraps the few system tools
// observe.sh needs before it exits in one dir, and runs observe.sh with
// only that dir and the test's dirs on PATH, so no real Python is found.
// LOCALAPPDATA is passed through untouched, as Git Bash would.
const DRIVER = `
conv() { case "$OSTYPE" in msys*|cygwin*) cygpath -u "$1" ;; *) printf '%s\\n' "$1" ;; esac; }
tools="$(conv "$T_TOOLS")"
for t in cat dirname basename sed mkdir; do
  printf '#!/bin/sh\\nexec "%s" "$@"\\n' "$(command -v "$t")" > "$tools/$t"
  chmod +x "$tools/$t"
done
new_path=""
IFS='|' read -ra parts <<< "$T_PATH"
for p in "\${parts[@]}"; do new_path="\${new_path:+$new_path:}$(conv "$p")"; done
target="$(conv "$T_TARGET")"
export CLV2_HOMUNCULUS_DIR="$(conv "$T_HOME")"
export T_LOG="$(conv "$T_LOG")"
if [ -n "\${T_PROJECT:-}" ]; then export CLAUDE_PROJECT_DIR="$(conv "$T_PROJECT")"; fi
PATH="$new_path:$tools"
printf '%s' '{"cwd":""}' | "$BASH" "$target" post
`;

function makeTree({ enabled = false } = {}) {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'ecc-clv2-pymanager-'));
  const local = path.join(root, 'Local Data');
  const dirs = {
    root,
    local,
    alias: path.join(local, 'Microsoft', 'WindowsApps'),
    launcher: path.join(local, 'Python', 'bin'),
    regular: path.join(root, 'regular'),
    project: path.join(root, 'project'),
    tools: path.join(root, 'tools'),
    home: path.join(root, 'homunculus'),
    log: path.join(root, 'calls.log')
  };
  for (const dir of [dirs.alias, dirs.launcher, dirs.regular, dirs.project, dirs.tools, dirs.home]) {
    fs.mkdirSync(dir, { recursive: true });
  }
  if (!enabled) fs.writeFileSync(path.join(dirs.home, 'disabled'), '');
  return dirs;
}

// A stand-in interpreter: logs its label and the exported CLV2_PYTHON_CMD,
// plus `detect-project` when detect-project.sh runs it to hash the project id.
function writePython(dir, name, label) {
  fs.writeFileSync(
    path.join(dir, name),
    `#!/bin/sh\necho "${label}|$CLV2_PYTHON_CMD\${_CLV2_HASH_INPUT:+|detect-project}" >> "$T_LOG"\n`,
    { mode: 0o755 }
  );
}

function run(dirs, pathDirs, env = {}, { checkStatus = true } = {}) {
  const baseEnv = { ...process.env };
  for (const key of ['CLV2_PYTHON_CMD', 'CLV2_CONFIG', 'CLV2_NO_PROJECT', 'CLAUDE_PROJECT_DIR', 'ECC_HOOK_PROFILE', 'ECC_SKIP_OBSERVE', 'PYTHON_MANAGER_DEFAULT']) {
    delete baseEnv[key];
  }
  baseEnv.CLAUDE_CODE_ENTRYPOINT = 'cli';
  baseEnv.LOCALAPPDATA = dirs.local;
  const merged = { ...baseEnv, ...env };
  for (const [key, value] of Object.entries(merged)) {
    if (value === undefined) delete merged[key];
  }
  const result = spawnSync('bash', ['-c', DRIVER], {
    encoding: 'utf8',
    env: {
      ...merged,
      T_PATH: pathDirs.join('|'),
      T_TOOLS: dirs.tools,
      T_TARGET: observeShPath,
      T_HOME: dirs.home,
      T_LOG: dirs.log
    }
  });
  if (checkStatus) assert.strictEqual(result.status, 0, `observe.sh failed: ${result.stderr}`);
  return fs.existsSync(dirs.log)
    ? fs.readFileSync(dirs.log, 'utf8').trim().split('\n').filter(Boolean).map(line => line.split('|'))
    : [];
}

function withTree(fn, options) {
  const dirs = makeTree(options);
  try {
    fn(dirs);
  } finally {
    fs.rmSync(dirs.root, { recursive: true, force: true });
  }
}

console.log('\n=== Testing CLv2 Python Install Manager launcher ===\n');

test('runs the Python\\bin launcher instead of the WindowsApps python3 alias', () => withTree(dirs => {
  writePython(dirs.alias, 'python3', 'alias');
  writePython(dirs.launcher, 'python3.exe', 'launcher');
  const calls = run(dirs, [dirs.alias]);
  assert.deepStrictEqual(calls.map(c => c[0]), ['launcher']);
  assert.ok(/\/Local Data\/Python\/bin\/python3\.exe$/.test(calls[0][1]),
    `CLV2_PYTHON_CMD passed to detect-project.sh should be the launcher, got ${calls[0][1]}`);
}));

test('runs the Python\\bin launcher for a WindowsApps python alias when python3 is absent', () => withTree(dirs => {
  writePython(dirs.alias, 'python', 'alias');
  writePython(dirs.launcher, 'python.exe', 'launcher');
  assert.deepStrictEqual(run(dirs, [dirs.alias]).map(c => c[0]), ['launcher']);
}));

// Windows and macOS filesystems ignore case, so a lowercase PATH entry names
// the same WindowsApps directory there. On a case-sensitive filesystem it
// would be another directory, so the case only runs where case is ignored.
test('matches the current user\'s WindowsApps directory spelled in another case', () => withTree(dirs => {
  const lower = path.join(dirs.local, 'microsoft', 'windowsapps');
  if (!fs.existsSync(lower)) {
    console.log('    (skipped: temp filesystem is case-sensitive)');
    return;
  }
  writePython(lower, 'python3', 'alias');
  writePython(dirs.launcher, 'python3.exe', 'launcher');
  assert.deepStrictEqual(run(dirs, [lower]).map(c => c[0]), ['launcher']);
}));

test('keeps an alias from another user\'s WindowsApps directory', () => withTree(dirs => {
  const other = path.join(dirs.root, 'Other User', 'AppData', 'Local', 'Microsoft', 'WindowsApps');
  fs.mkdirSync(other, { recursive: true });
  writePython(other, 'python3', 'other-alias');
  writePython(dirs.launcher, 'python3.exe', 'launcher');
  assert.deepStrictEqual(run(dirs, [other]).map(c => c[0]), ['other-alias']);
}));

test('detect-project.sh hashes the project id with the launcher', () => withTree(dirs => {
  writePython(dirs.alias, 'python3', 'alias');
  writePython(dirs.launcher, 'python3.exe', 'launcher');
  // The stand-ins print nothing, so the hook stops at a later step; only the
  // calls made up to and inside detect-project.sh matter here.
  const calls = run(dirs, [dirs.alias], { T_PROJECT: dirs.project }, { checkStatus: false });
  const hashCalls = calls.filter(c => c[2] === 'detect-project');
  assert.strictEqual(hashCalls.length, 1, `expected one detect-project hash call, got ${JSON.stringify(calls)}`);
  assert.strictEqual(hashCalls[0][0], 'launcher');
  assert.ok(!calls.some(c => c[0] === 'alias'), `the alias ran: ${JSON.stringify(calls)}`);
}, { enabled: true }));

test('keeps the alias when Python\\bin has no launcher (Microsoft Store Python)', () => withTree(dirs => {
  writePython(dirs.alias, 'python3', 'alias');
  const calls = run(dirs, [dirs.alias]);
  assert.deepStrictEqual(calls, [['alias', 'python3']]);
}));

// With Store Python installed too, either package can own the top-level
// alias (Settings > App execution aliases), so it is not known to be the
// Install Manager's.
test('keeps the alias when Microsoft Store Python also provides it', () => withTree(dirs => {
  writePython(dirs.alias, 'python3', 'alias');
  writePython(dirs.launcher, 'python3.exe', 'launcher');
  const store = path.join(dirs.alias, 'PythonSoftwareFoundation.Python.3.13_qbz5n2kfra8p0');
  fs.mkdirSync(store, { recursive: true });
  fs.writeFileSync(path.join(store, 'python3.exe'), '');
  assert.deepStrictEqual(run(dirs, [dirs.alias]).map(c => c[0]), ['alias']);
}));

// The alias honours PYTHON_MANAGER_DEFAULT; the Python\bin shortcut always
// starts the runtime it was generated for.
test('keeps the alias when PYTHON_MANAGER_DEFAULT chooses the runtime', () => withTree(dirs => {
  writePython(dirs.alias, 'python3', 'alias');
  writePython(dirs.launcher, 'python3.exe', 'launcher');
  assert.deepStrictEqual(run(dirs, [dirs.alias], { PYTHON_MANAGER_DEFAULT: '3.13' }).map(c => c[0]), ['alias']);
}));

test('keeps the alias when LOCALAPPDATA is unset', () => withTree(dirs => {
  writePython(dirs.alias, 'python3', 'alias');
  writePython(dirs.launcher, 'python3.exe', 'launcher');
  assert.deepStrictEqual(run(dirs, [dirs.alias], { LOCALAPPDATA: undefined }).map(c => c[0]), ['alias']);
}));

test('leaves a python3 outside WindowsApps alone', () => withTree(dirs => {
  writePython(dirs.regular, 'python3', 'regular');
  writePython(dirs.alias, 'python3', 'alias');
  writePython(dirs.launcher, 'python3.exe', 'launcher');
  assert.deepStrictEqual(run(dirs, [dirs.regular, dirs.alias]), [['regular', 'python3']]);
}));

test('an explicit CLV2_PYTHON_CMD still wins over the launcher', () => withTree(dirs => {
  writePython(dirs.alias, 'python3', 'alias');
  writePython(dirs.launcher, 'python3.exe', 'launcher');
  assert.deepStrictEqual(run(dirs, [dirs.alias], { CLV2_PYTHON_CMD: 'python3' }), [['alias', 'python3']]);
}));

console.log(`\nResults: Passed: ${passed}, Failed: ${failed}`);
process.exit(failed > 0 ? 1 : 0);
