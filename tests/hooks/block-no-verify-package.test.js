/**
 * Tests for the optional project-installed `block-no-verify` package check.
 * Uses a fake node_modules/block-no-verify in a temp project directory.
 */

'use strict';

const assert = require('assert');
const fs = require('fs');
const os = require('os');
const path = require('path');
const { spawnSync } = require('child_process');

const root = path.join(__dirname, '..', '..');
const hookPath = path.join(root, 'scripts', 'hooks', 'block-no-verify.js');
const runner = path.join(root, 'scripts', 'hooks', 'run-with-flags.js');
const cursorDispatcher = path.join(root, '.cursor', 'hooks', 'before-shell-execution.js');

const NO_VERIFY = '--no-' + 'verify';
const ECC_ALLOWED = 'echo hello';
const ECC_BLOCKED = `git commit -m x ${NO_VERIFY}`;

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

function tmpDir() {
  return fs.mkdtempSync(path.join(os.tmpdir(), 'ecc-bnv-pkg-'));
}

function makeProject(stubSource, { version = '1.4.1', declared = true } = {}) {
  const dir = tmpDir();
  fs.writeFileSync(path.join(dir, 'package.json'), JSON.stringify(declared ? { devDependencies: { 'block-no-verify': '^1.4.1' } } : {}));
  if (stubSource !== null) writePackage(path.join(dir, 'node_modules', 'block-no-verify'), stubSource, version);
  return dir;
}

function writePackage(pkgDir, stubSource, version = '1.4.1') {
  fs.mkdirSync(path.join(pkgDir, 'dist', 'cjs'), { recursive: true });
  fs.writeFileSync(path.join(pkgDir, 'package.json'), JSON.stringify({
    name: 'block-no-verify',
    version,
    exports: { '.': { require: { default: './dist/cjs/index.js' } } }
  }));
  fs.writeFileSync(path.join(pkgDir, 'dist', 'cjs', 'index.js'), stubSource);
}

const stub = (marker, body) => `require('fs').appendFileSync(${JSON.stringify(marker)}, 'called\\n');\n${body}`;
const blockingStub = marker => stub(marker, "exports.checkCommand = () => ({ blocked: true, reason: 'stub says no' });");
const allowingStub = marker => stub(marker, 'exports.checkCommand = () => ({ blocked: false });');

function spawnHook(dir, command, env, script, args = []) {
  const result = spawnSync('node', [script, ...args], {
    input: JSON.stringify({ tool_input: { command }, cwd: dir }),
    encoding: 'utf8',
    cwd: dir,
    env: { ...process.env, HOME: tmpDir(), GIT_CONFIG_GLOBAL: path.join(tmpDir(), 'gitconfig'), CLAUDE_PROJECT_DIR: '', NODE_PATH: '', ECC_BLOCK_NO_VERIFY_PACKAGE: 'on', CLAUDE_PLUGIN_ROOT: root, ...env },
    timeout: 15000
  });
  return { code: result.status, stdout: result.stdout || '', stderr: result.stderr || '' };
}

const runDirect = (dir, command, env = {}) => spawnHook(dir, command, env, hookPath);
const runViaRunner = (dir, command, env = {}) =>
  spawnHook(dir, command, { ECC_HOOKS_ENABLED: 'true', ECC_HOOK_PROFILE: 'standard', ...env }, runner, [
    'pre:bash:block-no-verify',
    'scripts/hooks/block-no-verify.js',
    'standard,strict'
  ]);

let passed = 0;
let failed = 0;
function check(name, fn) {
  if (test(name, fn)) passed++; else failed++;
}

console.log('\nblock-no-verify optional package check:');

check('package absent: ECC verdict unchanged', () => {
  const dir = makeProject(null);
  assert.strictEqual(runDirect(dir, ECC_ALLOWED).code, 0);
  assert.strictEqual(runDirect(dir, ECC_BLOCKED).code, 2);
});

check('package blocks: exit 2 with package reason', () => {
  const dir = makeProject(blockingStub(path.join(tmpDir(), 'm')));
  const result = runDirect(dir, ECC_ALLOWED);
  assert.strictEqual(result.code, 2);
  assert.match(result.stderr, /BLOCKED: block-no-verify package/);
  assert.match(result.stderr, /stub says no/);
});

check('package allows: exit 0 and package was consulted', () => {
  const marker = path.join(tmpDir(), 'm');
  const dir = makeProject(allowingStub(marker));
  assert.strictEqual(runDirect(dir, ECC_ALLOWED).code, 0);
  assert.ok(fs.existsSync(marker), 'package should be consulted');
});

check('package throws on load: ECC verdict unchanged', () => {
  const dir = makeProject("throw new Error('load boom');");
  const allowed = runDirect(dir, ECC_ALLOWED);
  assert.strictEqual(allowed.code, 0);
  assert.strictEqual(allowed.stderr, '');
  assert.strictEqual(runDirect(dir, ECC_BLOCKED).code, 2);
});

check('package throws on call: ECC verdict unchanged', () => {
  const dir = makeProject("exports.checkCommand = () => { throw new Error('call boom'); };");
  const result = runDirect(dir, ECC_ALLOWED);
  assert.strictEqual(result.code, 0);
  assert.strictEqual(result.stderr, '');
});

check('unexpected package result: allow', () => {
  const bodies = [
    'exports.checkCommand = () => undefined;',
    "exports.checkCommand = () => ({ blocked: 'yes' });",
    'exports.checkCommand = 5;',
    'module.exports = null;'
  ];
  for (const body of bodies) {
    assert.strictEqual(runDirect(makeProject(body), ECC_ALLOWED).code, 0, body);
  }
});

check('ECC already blocks: package never consulted', () => {
  const marker = path.join(tmpDir(), 'm');
  const dir = makeProject(allowingStub(marker));
  const result = runDirect(dir, ECC_BLOCKED);
  assert.strictEqual(result.code, 2);
  assert.ok(!fs.existsSync(marker), 'package must not be consulted');
  assert.doesNotMatch(result.stderr, /block-no-verify package/);
});

check('default off: package present, env unset, never loaded', () => {
  for (const value of [undefined, '', 'off', '0', 'false', 'disabled', 'nonsense']) {
    const marker = path.join(tmpDir(), 'm');
    const dir = makeProject(blockingStub(marker));
    const env = value === undefined ? { ECC_BLOCK_NO_VERIFY_PACKAGE: '' } : { ECC_BLOCK_NO_VERIFY_PACKAGE: value };
    assert.strictEqual(runDirect(dir, ECC_ALLOWED, env).code, 0, String(value));
    assert.ok(!fs.existsSync(marker), `package must not load for ${value}`);
  }
});

check('opt-in values on/1/true/enabled all enable it', () => {
  for (const value of ['on', '1', 'true', 'enabled', 'ON']) {
    const dir = makeProject(blockingStub(path.join(tmpDir(), 'm')));
    assert.strictEqual(runDirect(dir, ECC_ALLOWED, { ECC_BLOCK_NO_VERIFY_PACKAGE: value }).code, 2, value);
  }
});

check('opt-in but undeclared in package.json: not loaded', () => {
  const marker = path.join(tmpDir(), 'm');
  const dir = makeProject(blockingStub(marker), { declared: false });
  assert.strictEqual(runDirect(dir, ECC_ALLOWED).code, 0);
  assert.ok(!fs.existsSync(marker));
});

check('missing or invalid project package.json: not loaded', () => {
  const marker = path.join(tmpDir(), 'm');
  const dir = makeProject(blockingStub(marker));
  fs.writeFileSync(path.join(dir, 'package.json'), '{not json');
  assert.strictEqual(runDirect(dir, ECC_ALLOWED).code, 0);
  fs.unlinkSync(path.join(dir, 'package.json'));
  assert.strictEqual(runDirect(dir, ECC_ALLOWED).code, 0);
  assert.ok(!fs.existsSync(marker));
});

check('ancestor node_modules copy: not loaded', () => {
  const marker = path.join(tmpDir(), 'm');
  const parent = makeProject(blockingStub(marker));
  const child = path.join(parent, 'packages', 'app');
  fs.mkdirSync(child, { recursive: true });
  fs.writeFileSync(path.join(child, 'package.json'), JSON.stringify({ devDependencies: { 'block-no-verify': '^1.4.1' } }));
  assert.strictEqual(runDirect(child, ECC_ALLOWED).code, 0);
  assert.ok(!fs.existsSync(marker));
});

check('NODE_PATH copy: not loaded', () => {
  const marker = path.join(tmpDir(), 'm');
  const lib = tmpDir();
  writePackage(path.join(lib, 'block-no-verify'), blockingStub(marker));
  const dir = makeProject(null);
  assert.strictEqual(runDirect(dir, ECC_ALLOWED, { NODE_PATH: lib }).code, 0);
  assert.ok(!fs.existsSync(marker));
});

check('symlinked package dir escaping node_modules: not loaded', () => {
  const marker = path.join(tmpDir(), 'm');
  const outside = path.join(tmpDir(), 'elsewhere');
  writePackage(outside, blockingStub(marker));
  const dir = makeProject(null);
  fs.mkdirSync(path.join(dir, 'node_modules'));
  fs.symlinkSync(outside, path.join(dir, 'node_modules', 'block-no-verify'));
  assert.strictEqual(runDirect(dir, ECC_ALLOWED).code, 0);
  assert.ok(!fs.existsSync(marker));
});

check('entry symlink escaping the package dir: not loaded', () => {
  const marker = path.join(tmpDir(), 'm');
  const outsideFile = path.join(tmpDir(), 'evil.js');
  fs.writeFileSync(outsideFile, blockingStub(marker));
  const dir = makeProject(allowingStub(path.join(tmpDir(), 'unused')));
  const entry = path.join(dir, 'node_modules', 'block-no-verify', 'dist', 'cjs', 'index.js');
  fs.unlinkSync(entry);
  fs.symlinkSync(outsideFile, entry);
  assert.strictEqual(runDirect(dir, ECC_ALLOWED).code, 0);
  assert.ok(!fs.existsSync(marker));
});

check('old or wrong package: not loaded', () => {
  for (const version of ['1.3.9', '1.4.0', '0.9.0', 'garbage']) {
    const marker = path.join(tmpDir(), 'm');
    const dir = makeProject(blockingStub(marker), { version });
    assert.strictEqual(runDirect(dir, ECC_ALLOWED).code, 0, version);
    assert.ok(!fs.existsSync(marker), version);
  }
  const marker = path.join(tmpDir(), 'm');
  const dir = makeProject(blockingStub(marker));
  const manifestPath = path.join(dir, 'node_modules', 'block-no-verify', 'package.json');
  fs.writeFileSync(manifestPath, JSON.stringify({ name: 'other', version: '2.0.0', exports: { '.': { require: './dist/cjs/index.js' } } }));
  assert.strictEqual(runDirect(dir, ECC_ALLOWED).code, 0);
  assert.ok(!fs.existsSync(marker));
});

check('newer versions and string require export are accepted', () => {
  const dir = makeProject(blockingStub(path.join(tmpDir(), 'm')), { version: '2.0.0-beta.1' });
  assert.strictEqual(runDirect(dir, ECC_ALLOWED).code, 2);
  const flat = makeProject(blockingStub(path.join(tmpDir(), 'm')));
  fs.writeFileSync(path.join(flat, 'node_modules', 'block-no-verify', 'package.json'), JSON.stringify({ name: 'block-no-verify', version: '1.10.0', exports: { '.': { require: './dist/cjs/index.js' } } }));
  assert.strictEqual(runDirect(flat, ECC_ALLOWED).code, 2);
});

check('CLAUDE_PROJECT_DIR is preferred over payload cwd', () => {
  const dir = makeProject(blockingStub(path.join(tmpDir(), 'm')));
  const other = makeProject(null);
  const result = spawnHook(other, ECC_ALLOWED, { CLAUDE_PROJECT_DIR: dir }, hookPath);
  assert.strictEqual(result.code, 2);
});

check('run-with-flags path consults the package', () => {
  const dir = makeProject(blockingStub(path.join(tmpDir(), 'm')));
  const result = runViaRunner(dir, ECC_ALLOWED, { ECC_DISABLED_HOOKS: '' });
  assert.strictEqual(result.code, 2, result.stderr);
  assert.match(result.stderr, /stub says no/);
});

check('ECC_DISABLED_HOOKS: nothing runs', () => {
  const marker = path.join(tmpDir(), 'm');
  const dir = makeProject(blockingStub(marker));
  const result = runViaRunner(dir, ECC_ALLOWED, { ECC_DISABLED_HOOKS: 'pre:bash:block-no-verify' });
  assert.strictEqual(result.code, 0, result.stderr);
  assert.ok(!fs.existsSync(marker), 'package must not be consulted');
});

check('Cursor dispatcher inherits the package check', () => {
  const dir = makeProject(blockingStub(path.join(tmpDir(), 'm')));
  const result = spawnHook(dir, ECC_ALLOWED, {
    ECC_HOOKS_ENABLED: 'true',
    ECC_HOOK_PROFILE: 'standard',
    ECC_DISABLED_HOOKS: 'pre:bash:dev-server-block'
  }, cursorDispatcher);
  assert.strictEqual(result.code, 2, result.stderr + result.stdout);
  assert.match(result.stderr + result.stdout, /stub says no/);
});

console.log('─'.repeat(50));
console.log(`Passed: ${passed}  Failed: ${failed}`);
process.exit(failed > 0 ? 1 : 0);
