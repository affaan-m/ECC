/**
 * Tests for the shared continuous-learning-v2 Python resolver
 * (skills/continuous-learning-v2/scripts/lib/python-cmd.sh).
 *
 * On Windows with the Python Install Manager, python3/python under
 * %LOCALAPPDATA%\Microsoft\WindowsApps are working packaged aliases, and every
 * start of one runs an App Installer update check (anthropics/claude-code#98929).
 * The resolver asks such an alias once for sys.executable and runs that
 * interpreter directly, caching the verdict for later hooks. It also skips
 * the legacy App Installer stub (#1511), prefers interpreters 3.9 or newer,
 * and only runs a cached command that looks like a Python interpreter.
 *
 * Stand-in aliases are small shell scripts that print what the probe prints
 * and log each start, so the Windows route runs on any POSIX bash. A fake
 * cygpath maps the reported Windows path into the temp tree.
 *
 * Run with: node tests/hooks/clv2-python-cmd.test.js
 */

'use strict';

const assert = require('assert');
const fs = require('fs');
const os = require('os');
const path = require('path');
const { spawnSync } = require('child_process');

const repoRoot = path.resolve(__dirname, '..', '..');
const skillRoot = path.join(repoRoot, 'skills', 'continuous-learning-v2');
const libPath = path.join(skillRoot, 'scripts', 'lib', 'python-cmd.sh');
const detectProjectPath = path.join(skillRoot, 'scripts', 'detect-project.sh');

const probe = spawnSync('bash', ['-c', 'printf "%s %s.%s" "$OSTYPE" "${BASH_VERSINFO[0]}" "${BASH_VERSINFO[1]}"'], { encoding: 'utf8' });
const [bashOstype = '', bashVersion = '0.0'] = (probe.stdout || '').trim().split(' ');
if (probe.status !== 0 || (process.platform === 'win32' && !/^(msys|cygwin)/.test(bashOstype))) {
  console.log('Skipping CLv2 Python resolver tests: no POSIX bash on PATH\n');
  process.exit(0);
}
const [bashMajor, bashMinor] = bashVersion.split('.').map(Number);
const bashHasClock = bashMajor > 4 || (bashMajor === 4 && bashMinor >= 2);
// The resolver bounds a probe only with GNU timeout, found on the driver's PATH.
const hasGnuTimeout = /GNU coreutils/.test(
  spawnSync('bash', ['-c', 'PATH=/usr/bin:/bin; timeout --version'], { encoding: 'utf8' }).stdout || '');

let passed = 0;
let failed = 0;
let skipped = 0;

function test(name, fn) {
  try {
    const result = fn();
    if (result === 'skip') {
      console.log(`  - ${name} (skipped)`);
      skipped++;
      return;
    }
    console.log(`  ✓ ${name}`);
    passed++;
  } catch (err) {
    console.log(`  ✗ ${name}`);
    console.log(`    Error: ${err.message}`);
    failed++;
  }
}

// Converts the Windows paths Node hands over into POSIX paths before PATH is
// replaced (the real cygpath is needed for that under Git Bash), then sources
// the target and prints the resolved command.
const DRIVER = `
conv() { case "$OSTYPE" in msys*|cygwin*) cygpath -u "$1" ;; *) printf '%s\\n' "$1" ;; esac; }
new_path=""
IFS='|' read -ra parts <<< "$T_PATH"
for p in "\${parts[@]}"; do new_path="\${new_path:+$new_path:}$(conv "$p")"; done
target="$(conv "$T_TARGET")"
export CLV2_HOMUNCULUS_DIR="$(conv "$T_HOME")"
PATH="$new_path:/usr/bin:/bin:/mingw64/bin"
if [ "$T_MODE" = detect ]; then
  cd "$CLV2_HOMUNCULUS_DIR" && . "$target" >/dev/null 2>&1
  printf '%s\\n' "$CLV2_PYTHON_CMD"
else
  . "$target"
  _clv2_resolve_python_cmd
fi
`;

function makeTree() {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'ecc-clv2-python-'));
  const dirs = {
    root,
    alias: path.join(root, 'Local Data', 'Microsoft', 'WindowsApps'),
    regular: path.join(root, 'regular'),
    regular2: path.join(root, 'regular2'),
    fakebin: path.join(root, 'fakebin'),
    real: path.join(root, 'real dir'),
    home: path.join(root, 'homunculus')
  };
  for (const dir of Object.values(dirs)) fs.mkdirSync(dir, { recursive: true });
  fs.writeFileSync(path.join(dirs.real, 'python.exe'), '#!/bin/sh\nexit 0\n', { mode: 0o755 });
  writeScript(dirs.fakebin, 'cygpath',
    'echo "$*" >> "${0%/*}/calls.log"\n' +
    'case "$2" in *"Py Real"*) cd "${0%/*}/.." && printf \'%s/real dir/python.exe\\n\' "$PWD" ;; *) exit 1 ;; esac');
  return dirs;
}

function writeScript(dir, name, body) {
  fs.writeFileSync(path.join(dir, name), `#!/bin/sh\n${body}\n`, { mode: 0o755 });
}

// A stand-in interpreter: logs each start, then prints the probe's two lines
// with CRLF endings like a Windows python.exe.
function writePython(dir, name, verdict, executable) {
  writeScript(dir, name,
    `echo "${name}" >> "\${0%/*}/calls.log"\n` +
    `printf '%s\\r\\n%s\\r\\n' '${verdict}' '${executable}'`);
}

function calls(dir) {
  const log = path.join(dir, 'calls.log');
  return fs.existsSync(log) ? fs.readFileSync(log, 'utf8').trim().split('\n').filter(Boolean) : [];
}

let lastStderr = '';

function resolve(tree, pathDirs, extraEnv = {}, mode = 'lib') {
  const env = { ...process.env, T_PATH: pathDirs.join('|'), T_HOME: tree.home, T_MODE: mode,
    T_TARGET: mode === 'detect' ? detectProjectPath : libPath, ...extraEnv };
  delete env.CLV2_PYTHON_CMD;
  if (extraEnv.CLV2_PYTHON_CMD) env.CLV2_PYTHON_CMD = extraEnv.CLV2_PYTHON_CMD;
  delete env.CLAUDE_PROJECT_DIR;
  // Generous: a resolution starts about a dozen short processes, and process
  // creation on a loaded Windows host can take seconds each.
  const result = spawnSync('bash', ['-c', DRIVER], { env, encoding: 'utf8', timeout: 120000 });
  assert.strictEqual(result.status, 0, `resolver exited ${result.status}: ${result.stderr}`);
  lastStderr = result.stderr;
  return result.stdout.trim().split('\n').pop();
}

// Replaces the cached command (line 6 of the entry).
function setCachedCommand(tree, cmd) {
  const lines = fs.readFileSync(cachePath(tree), 'utf8').split('\n');
  lines[5] = cmd;
  fs.writeFileSync(cachePath(tree), lines.join('\n'));
}

function cachePath(tree) {
  return path.join(tree.home, '.python-cmd');
}

function withTree(fn) {
  const tree = makeTree();
  try {
    return fn(tree);
  } finally {
    fs.rmSync(tree.root, { recursive: true, force: true });
  }
}

function withAliasTree(fn) {
  return withTree(tree => {
    writePython(tree.alias, 'python3', 'clv2-ok', 'C:\\Py Real\\python.exe');
    writePython(tree.alias, 'python', 'clv2-ok', 'C:\\Py Real\\python.exe');
    return fn(tree);
  });
}

console.log('\n=== CLv2 Python resolver (python-cmd.sh) ===\n');

test('alias resolves to the interpreter behind it', () => withAliasTree(tree => {
  const cmd = resolve(tree, [tree.alias, tree.fakebin]);
  assert.ok(cmd.endsWith('/real dir/python.exe'), `expected real interpreter, got ${cmd}`);
  assert.deepStrictEqual(calls(tree.alias), ['python3'], 'alias should be started exactly once');
  assert.strictEqual(calls(tree.fakebin).length, 1, 'cygpath should convert the Windows path once');
}));

test('later hooks reuse the cached interpreter without starting the alias', () => withAliasTree(tree => {
  const first = resolve(tree, [tree.alias, tree.fakebin]);
  const second = resolve(tree, [tree.alias, tree.fakebin]);
  assert.strictEqual(second, first);
  assert.strictEqual(calls(tree.alias).length, 1, 'second resolution must not start the alias');
  assert.strictEqual(calls(tree.fakebin).length, 1, 'second resolution must not run cygpath');
}));

test('a changed PATH re-probes', () => withAliasTree(tree => {
  resolve(tree, [tree.alias, tree.fakebin]);
  resolve(tree, [tree.alias, tree.fakebin, tree.regular2]);
  assert.strictEqual(calls(tree.alias).length, 2);
}));

test('an expired cache entry re-probes', () => withAliasTree(tree => {
  if (!bashHasClock) return 'skip';
  resolve(tree, [tree.alias, tree.fakebin]);
  const lines = fs.readFileSync(cachePath(tree), 'utf8').split('\n');
  lines[1] = String(Number(lines[1]) - 2 * 86400);
  fs.writeFileSync(cachePath(tree), lines.join('\n'));
  resolve(tree, [tree.alias, tree.fakebin]);
  assert.strictEqual(calls(tree.alias).length, 2);
}));

test('a torn cache entry re-probes', () => withAliasTree(tree => {
  resolve(tree, [tree.alias, tree.fakebin]);
  const lines = fs.readFileSync(cachePath(tree), 'utf8').split('\n');
  fs.writeFileSync(cachePath(tree), lines.slice(0, 4).join('\n'));
  const cmd = resolve(tree, [tree.alias, tree.fakebin]);
  assert.ok(cmd.endsWith('/real dir/python.exe'));
  assert.strictEqual(calls(tree.alias).length, 2);
}));

test('a removed interpreter falls back to the alias name', () => withAliasTree(tree => {
  resolve(tree, [tree.alias, tree.fakebin]);
  fs.rmSync(path.join(tree.real, 'python.exe'));
  assert.strictEqual(resolve(tree, [tree.alias, tree.fakebin]), 'python3');
  assert.strictEqual(calls(tree.alias).length, 2);
}));

test('Store Python (interpreter inside WindowsApps) keeps the alias', () => withTree(tree => {
  const storeExe = 'C:\\Program Files\\WindowsApps\\PythonSoftwareFoundation.Python.3.12_x64\\python3.12.exe';
  writePython(tree.alias, 'python3', 'clv2-ok', storeExe);
  assert.strictEqual(resolve(tree, [tree.alias, tree.fakebin]), 'python3');
  assert.strictEqual(calls(tree.fakebin).length, 0, 'cygpath should not run for a WindowsApps interpreter');
}));

test('legacy App Installer stub is skipped (#1511) without being started', () => withTree(tree => {
  // The stub answers the probe like a working 3.9+ Python, so only the stub
  // check keeps it from being chosen. Its starts are logged next to the link
  // and next to the target, whichever $0 names.
  writePython(tree.root, 'AppInstallerPythonRedirector.exe', 'clv2-ok', '/usr/bin/python3');
  try {
    fs.symlinkSync(path.join(tree.root, 'AppInstallerPythonRedirector.exe'), path.join(tree.alias, 'python3'));
  } catch {
    return 'skip';
  }
  writePython(tree.regular, 'python', 'clv2-ok', '/usr/bin/python');
  assert.strictEqual(resolve(tree, [tree.alias, tree.regular, tree.fakebin]), 'python');
  assert.deepStrictEqual([...calls(tree.alias), ...calls(tree.root)], [], 'the stub must never be started');
}));

test('regular install outside WindowsApps is used by name, unchanged', () => withTree(tree => {
  writePython(tree.regular, 'python3', 'clv2-ok', '/usr/bin/python3');
  writePython(tree.regular, 'python', 'clv2-ok', '/usr/bin/python');
  assert.strictEqual(resolve(tree, [tree.regular, tree.fakebin]), 'python3');
  assert.strictEqual(calls(tree.fakebin).length, 0, 'cygpath should not run off the alias route');
}));

test('interpreter below the minimum version is skipped for the next one', () => withTree(tree => {
  writePython(tree.regular, 'python3', 'clv2-old', '/usr/bin/python3');
  writePython(tree.regular, 'python', 'clv2-ok', '/usr/bin/python');
  assert.strictEqual(resolve(tree, [tree.regular, tree.fakebin]), 'python');
}));

test('garbled probe output is skipped for the next interpreter', () => withTree(tree => {
  writeScript(tree.regular, 'python3', 'echo Python');
  writePython(tree.regular, 'python', 'clv2-ok', '/usr/bin/python');
  assert.strictEqual(resolve(tree, [tree.regular, tree.fakebin]), 'python');
}));

test('a probe that fails after its verdict line is still accepted', () => withTree(tree => {
  // e.g. writing a non-ANSI sys.executable raised after the verdict was printed
  writeScript(tree.regular, 'python3', 'echo python3 >> "${0%/*}/calls.log"\nprintf \'clv2-ok\\r\\n\'\nexit 1');
  writePython(tree.regular, 'python', 'clv2-ok', '/usr/bin/python');
  assert.strictEqual(resolve(tree, [tree.regular, tree.fakebin]), 'python3');
}));

test('with only pre-3.9 interpreters the first that runs is used, with a notice', () => withTree(tree => {
  writePython(tree.regular, 'python3', 'clv2-old', '/usr/bin/python3');
  writePython(tree.regular, 'python', 'clv2-old', '/usr/bin/python');
  assert.strictEqual(resolve(tree, [tree.regular, tree.fakebin]), 'python3');
  assert.match(lastStderr, /instinct-cli\.py needs Python 3\.9 or newer/);
  assert.strictEqual(resolve(tree, [tree.regular, tree.fakebin]), 'python3');
  assert.deepStrictEqual(calls(tree.regular), ['python3', 'python'], 'the fallback verdict should be cached');
  assert.strictEqual(lastStderr, '', 'the notice should not repeat on a cache hit');
}));

test('a cached command that is not a Python interpreter is rejected', () => withAliasTree(tree => {
  const real = resolve(tree, [tree.alias, tree.fakebin]);
  const planted = real.replace(/python\.exe$/, 'payload.sh');
  fs.writeFileSync(path.join(tree.real, 'payload.sh'), '#!/bin/sh\nexit 0\n', { mode: 0o755 });
  for (const cmd of [planted, 'sh', 'python3 -c pass']) {
    setCachedCommand(tree, cmd);
    assert.strictEqual(resolve(tree, [tree.alias, tree.fakebin]), real, `cached ${cmd} must not be used`);
  }
  assert.strictEqual(calls(tree.alias).length, 4, 'each rejected entry should re-probe');
}));

test('CLV2_PYTHON_CMD is trusted as-is without a probe', () => withAliasTree(tree => {
  assert.strictEqual(resolve(tree, [tree.alias, tree.fakebin], { CLV2_PYTHON_CMD: 'python' }), 'python');
  assert.strictEqual(calls(tree.alias).length, 0);
}));

test('missing homunculus dir resolves without writing a cache', () => withAliasTree(tree => {
  fs.rmSync(tree.home, { recursive: true, force: true });
  const cmd = resolve(tree, [tree.alias, tree.fakebin]);
  assert.ok(cmd.endsWith('/real dir/python.exe'));
  assert.ok(!fs.existsSync(cachePath(tree)));
}));

test('the cache is written through mktemp, and not at all when mktemp fails', () => withAliasTree(tree => {
  // A predictable temp name could be planted as a symlink in a shared
  // homunculus dir; mktemp creates the file exclusively under a random name.
  writeScript(tree.fakebin, 'mktemp', 'echo "mktemp $*" >> "${0%/*}/calls.log"\nexit 1');
  const cmd = resolve(tree, [tree.alias, tree.fakebin]);
  assert.ok(cmd.endsWith('/real dir/python.exe'));
  assert.ok(calls(tree.fakebin).some(c => /^mktemp .*\/\.python-cmd\.XXXXXX$/.test(c)),
    `mktemp not used: ${calls(tree.fakebin).join(', ')}`);
  assert.deepStrictEqual(fs.readdirSync(tree.home), [], 'nothing may be written when mktemp fails');
}));

test('a hanging interpreter is abandoned within the hook budget', () => withTree(tree => {
  if (!hasGnuTimeout) return 'skip';
  // observe-runner.js gives the whole hook 9 s, so a stalled python3 must
  // leave time to probe python and cache that verdict.
  writeScript(tree.regular, 'python3', 'echo python3 >> "${0%/*}/calls.log"\nexec sleep 30');
  writePython(tree.regular2, 'python', 'clv2-ok', '/usr/bin/python');
  const started = Date.now();
  assert.strictEqual(resolve(tree, [tree.regular, tree.regular2]), 'python');
  const secs = (Date.now() - started) / 1000;
  assert.ok(secs < 9, `resolution took ${secs.toFixed(1)} s`);
  assert.deepStrictEqual(calls(tree.regular), ['python3']);
  assert.ok(fs.existsSync(cachePath(tree)), 'the python verdict must be cached');
}));

test('an interpreter that ignores TERM is killed within the hook budget', () => withTree(tree => {
  if (!hasGnuTimeout) return 'skip';
  // The ignored TERM survives exec, so only timeout's kill-after ends sleep.
  writeScript(tree.regular, 'python3', "trap '' TERM\nexec sleep 30");
  writePython(tree.regular2, 'python', 'clv2-ok', '/usr/bin/python');
  const started = Date.now();
  assert.strictEqual(resolve(tree, [tree.regular, tree.regular2]), 'python');
  const secs = (Date.now() - started) / 1000;
  assert.ok(secs < 9, `resolution took ${secs.toFixed(1)} s`);
}));

test('a cache path planted as a symlink to a directory is not written through', () => withAliasTree(tree => {
  // mv onto a symlink to a directory would move the cache file into it.
  const target = path.join(tree.root, 'elsewhere');
  fs.mkdirSync(target);
  try {
    fs.symlinkSync(target, cachePath(tree), 'dir');
  } catch {
    return 'skip';
  }
  const cmd = resolve(tree, [tree.alias, tree.fakebin]);
  assert.ok(cmd.endsWith('/real dir/python.exe'));
  assert.deepStrictEqual(fs.readdirSync(target), [], 'nothing may land in the symlink target');
  assert.deepStrictEqual(fs.readdirSync(tree.home), ['.python-cmd'], 'no temp file may be left behind');
}));

test('detect-project.sh resolves through the shared resolver', () => withAliasTree(tree => {
  const cmd = resolve(tree, [tree.alias, tree.fakebin], {}, 'detect');
  assert.ok(cmd.endsWith('/real dir/python.exe'), `expected real interpreter, got ${cmd}`);
}));

console.log(`\nPassed: ${passed}`);
console.log(`Failed: ${failed}`);
console.log(`Skipped: ${skipped}`);
process.exit(failed > 0 ? 1 : 0);
