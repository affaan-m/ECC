'use strict';

const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const vm = require('node:vm');
const { createRequire } = require('node:module');
const { spawnSync } = require('node:child_process');
const { test } = require('node:test');
const resolverPath = path.resolve(__dirname, '../../scripts/lib/resolve-formatter.js');
const { resolveFormatterBin, clearCaches } = require(resolverPath);

function fixture(t) {
  const outer = fs.realpathSync(fs.mkdtempSync(path.join(os.tmpdir(), 'ecc-hoisted-format-')));
  const root = path.join(outer, 'repo');
  const workspace = path.join(root, 'packages', 'web');
  fs.mkdirSync(workspace, { recursive: true });
  fs.mkdirSync(path.join(root, '.git'));
  fs.writeFileSync(path.join(root, 'package.json'), JSON.stringify({ workspaces: ['packages/*'] }));
  fs.writeFileSync(path.join(workspace, 'package.json'), JSON.stringify({ name: 'web' }));
  clearCaches();
  t.after(() => { clearCaches(); fs.rmSync(outer, { recursive: true, force: true }); });
  const install = (directory, formatter) => {
    const binary = path.join(directory, 'node_modules', '.bin', formatter + (process.platform === 'win32' ? '.cmd' : ''));
    fs.mkdirSync(path.dirname(binary), { recursive: true });
    fs.writeFileSync(binary, 'fixture');
    return binary;
  };
  return { outer, root, workspace, install };
}

function loadResolver(overrides) {
  const mod = { exports: {} };
  const nativeRequire = createRequire(resolverPath);
  vm.runInNewContext(fs.readFileSync(resolverPath, 'utf8'), {
    module: mod, process,
    require: id => overrides[id] || nativeRequire(id),
    ...overrides.globals
  }, { filename: resolverPath });
  return mod.exports;
}

for (const formatter of ['prettier', 'biome']) {
  test(`${formatter}: finds an installation hoisted above a separately configured package`, t => {
    const f = fixture(t);
    const binary = f.install(f.root, formatter);
    assert.deepEqual(resolveFormatterBin(f.workspace, formatter), { bin: binary, prefix: [] });
  });
}

test('the closest ancestor installation wins over a more distant one', t => {
  const f = fixture(t);
  f.install(f.root, 'prettier');
  const closest = f.install(path.dirname(f.workspace), 'prettier');
  assert.equal(resolveFormatterBin(f.workspace, 'prettier').bin, closest);
});

test('a package-local installation still wins over a hoisted one', t => {
  const f = fixture(t);
  f.install(f.root, 'prettier');
  const local = f.install(f.workspace, 'prettier');
  assert.equal(resolveFormatterBin(f.workspace, 'prettier').bin, local);
});

for (const worktree of [false, true]) {
  test(`does not borrow a binary beyond a ${worktree ? 'worktree file' : 'repository directory'} boundary`, t => {
    const f = fixture(t);
    f.install(f.outer, 'prettier');
    if (worktree) {
      fs.rmdirSync(path.join(f.root, '.git'));
      fs.writeFileSync(path.join(f.root, '.git'), 'gitdir: ../other-worktree');
    }
    const resolver = loadResolver({ './package-manager': { getPackageManager: () => ({ config: { execCmd: 'yarn dlx' } }) } });
    const result = resolver.resolveFormatterBin(f.workspace, 'prettier');
    assert.equal(result.bin, process.platform === 'win32' ? 'yarn.cmd' : 'yarn');
    assert.deepEqual(Array.from(result.prefix), ['dlx', 'prettier']);
  });
}

test('does not search the home directory when a checkout has no .git marker', t => {
  const f = fixture(t);
  fs.rmdirSync(path.join(f.root, '.git'));
  f.install(f.outer, 'prettier');
  const resolver = loadResolver({
    os: { homedir: () => f.outer },
    './package-manager': { getPackageManager: () => ({ config: { execCmd: 'pnpm dlx' } }) }
  });
  const result = resolver.resolveFormatterBin(f.workspace, 'prettier');
  assert.equal(result.bin, process.platform === 'win32' ? 'pnpm.cmd' : 'pnpm');
  assert.deepEqual(Array.from(result.prefix), ['dlx', 'prettier']);
});

test('caches the selected hoisted installation like a local installation', t => {
  const f = fixture(t);
  const binary = f.install(f.root, 'prettier');
  assert.equal(resolveFormatterBin(f.workspace, 'prettier').bin, binary);
  fs.unlinkSync(binary);
  assert.equal(resolveFormatterBin(f.workspace, 'prettier').bin, binary);
});

test('Windows paths select the ancestor .cmd shim', () => {
  const binary = 'C:\\repo\\node_modules\\.bin\\biome.cmd';
  const resolver = loadResolver({
    path: path.win32,
    os: { homedir: () => 'C:\\Users\\Alice' },
    fs: { existsSync: file => [binary, 'C:\\repo\\.git'].includes(file) },
    './package-manager': { getPackageManager: () => ({ config: { execCmd: 'npx' } }) },
    globals: { process: { platform: 'win32' } }
  });
  assert.equal(resolver.resolveFormatterBin('C:\\repo\\packages\\web', 'biome').bin, binary);
});

test('Windows home boundary comparisons ignore path casing', () => {
  const resolver = loadResolver({
    path: path.win32,
    os: { homedir: () => 'C:\\Users\\Alice' },
    fs: { existsSync: file => file.toLowerCase() === 'c:\\users\\alice\\node_modules\\.bin\\biome.cmd' },
    './package-manager': { getPackageManager: () => ({ config: { execCmd: 'npx' } }) },
    globals: { process: { platform: 'win32' } }
  });
  assert.equal(resolver.resolveFormatterBin('c:\\USERS\\ALICE\\project', 'biome').bin, 'npx.cmd');
});

function runHook(t, formatter, hook) {
  const f = fixture(t);
  const binary = f.install(f.root, formatter);
  fs.writeFileSync(path.join(f.workspace, formatter === 'biome' ? 'biome.json' : '.prettierrc'), '{}');
  const file = path.join(f.workspace, hook === 'quality-gate' ? 'value.json' : 'value.js');
  fs.writeFileSync(file, hook === 'quality-gate' ? '{"value":1}\n' : 'const value=1;\n');
  const capture = path.join(f.outer, 'invocation.json');
  const executable = path.join(f.outer, 'formatter.cjs');
  fs.writeFileSync(executable, [
    "const fs = require('node:fs');",
    "const path = require('node:path');",
    'const args = process.argv.slice(2);',
    'fs.writeFileSync(process.env.ECC_HOISTED_CAPTURE, JSON.stringify({ args, cwd: process.cwd() }));',
    "for (const file of args.filter(arg => path.isAbsolute(arg))) fs.appendFileSync(file, 'formatted\\n');"
  ].join('\n'));
  const quote = value => "'" + value.replace(/'/g, "'\\''") + "'";
  fs.writeFileSync(binary, process.platform === 'win32'
    ? `@echo off\r\n"${process.execPath}" "${executable}" %*\r\n`
    : `#!/bin/sh\nexec ${quote(process.execPath)} ${quote(executable)} "$@"\n`, { mode: 0o755 });
  fs.chmodSync(binary, 0o755);
  const emptyPath = path.join(f.outer, 'empty-bin');
  fs.mkdirSync(emptyPath);
  const session = `hoisted-${process.pid}-${path.basename(f.outer)}`;
  if (hook === 'stop-format-typecheck') {
    const accumulator = path.join(os.tmpdir(), `ecc-edited-${session}.txt`);
    fs.writeFileSync(accumulator, file + '\n', { flag: 'wx', mode: 0o600 });
    t.after(() => fs.rmSync(accumulator, { force: true }));
  }
  const input = JSON.stringify({ session_id: session, tool_input: { file_path: file } });
  const env = Object.fromEntries(Object.entries(process.env).filter(([key]) => key.toUpperCase() !== 'PATH'));
  const result = spawnSync(process.execPath, [path.resolve(__dirname, `../../scripts/hooks/${hook}.js`)], {
    cwd: f.workspace, input, encoding: 'utf8', timeout: 15000,
    env: { ...env, PATH: emptyPath, CLAUDE_PACKAGE_MANAGER: 'npm', ECC_HOISTED_CAPTURE: capture, ECC_QUALITY_GATE_FIX: 'true' }
  });
  assert.ifError(result.error);
  assert.equal(result.status, 0, result.stderr);
  assert.equal(result.stdout, input);
  assert.ok(fs.existsSync(capture), 'The installed formatter must run without a package-manager executable');
  const args = formatter === 'biome'
    ? (hook === 'quality-gate' ? ['check', file, '--write'] : ['check', '--write', file])
    : ['--write', file];
  assert.deepEqual(JSON.parse(fs.readFileSync(capture, 'utf8')), { args, cwd: f.workspace });
  assert.ok(fs.readFileSync(file, 'utf8').endsWith('formatted\n'));
}

for (const formatter of ['prettier', 'biome']) {
  for (const hook of ['post-edit-format', 'stop-format-typecheck', 'quality-gate']) {
    test(`${hook} runs the hoisted ${formatter} in the package configuration directory`, t => runHook(t, formatter, hook));
  }
}
