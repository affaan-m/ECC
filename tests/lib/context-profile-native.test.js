'use strict';

const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const test = require('node:test');
const { withFixture } = require('./helpers/context-fixture');
const store = require('../../scripts/lib/context-profile-store');
const native = () => require('../../scripts/lib/context-profile-native');

function fixture(callback) {
  return withFixture(repoRoot => {
    const parent = fs.mkdtempSync(path.join(fs.realpathSync(os.tmpdir()), 'ecc-native-test-'));
    const options = { stateRoot: path.join(parent, 'managed'), nativeRoot: path.join(parent, 'native'), codexPath: process.execPath };
    try {
      store.applyStore({ repoRoot, stateRoot: options.stateRoot, target: 'codex' });
      return callback(options, repoRoot, parent);
    } finally { fs.rmSync(parent, { recursive: true, force: true }); }
  });
}

function provider(overrides = {}) {
  const calls = [];
  const execute = (command, args, options) => {
    calls.push({ command, args, options });
    assert.equal(options.killSignal, 'SIGKILL');
    assert.equal(options.env.OPENAI_API_KEY, undefined);
    assert.equal(options.env.ANTHROPIC_API_KEY, undefined);
    for (const key of ['NODE_OPTIONS', 'CODEX_CONFIG', 'HTTP_PROXY', 'AWS_ACCESS_KEY_ID']) assert.equal(options.env[key], undefined);
    if (args[0] === '--version') return { status: 0, stdout: overrides.version || 'codex-cli 0.154.0\n' };
    if (overrides.failInstall && args[1] === 'add') return { status: 1, stderr: 'provider-specific detail' };
    if (args[0] === 'plugin' && args[1] === 'add') {
      const base = path.dirname(options.env.HOME);
      const marketplace = JSON.parse(fs.readFileSync(path.join(base, 'marketplace/.agents/plugins/marketplace.json')));
      const cache = path.join(options.env.CODEX_HOME, 'plugins/cache', marketplace.name, 'ecc-context-carrier/local');
      fs.mkdirSync(path.dirname(cache), { recursive: true });
      fs.cpSync(path.join(base, 'marketplace/carrier'), cache, { recursive: true });
    }
    return { status: 0, stdout: '{}' };
  };
  const discover = (_command, options) => {
    const base = path.dirname(options.env.HOME);
    const marketplace = JSON.parse(fs.readFileSync(path.join(base, 'marketplace/.agents/plugins/marketplace.json')));
    const cache = path.join(options.env.CODEX_HOME, 'plugins/cache', marketplace.name, 'ecc-context-carrier/local');
    const skills = fs.readdirSync(path.join(cache, 'skills')).map(name => ({ name: `ecc-context-carrier:${name}`,
      pluginId: `ecc-context-carrier@${marketplace.name}`, enabled: true, scope: 'user',
      path: path.join(cache, 'skills', name, 'SKILL.md') }));
    if (overrides.alter) overrides.alter({ skills, cache });
    return { data: [{ cwd: options.cwd, errors: [], skills }] };
  };
  return { execute, discover, calls, ...overrides };
}

test('native preview is deterministic and never invokes the provider or creates a home', () => fixture(options => {
  const first = native().previewNativeProfile(options);
  assert.deepEqual(first, native().previewNativeProfile(options));
  assert.equal(first.active, false);
  assert.equal(first.status, 'proposed');
  assert.equal(fs.existsSync(options.nativeRoot), false);
}));

test('native prepare verifies exact installed bytes and returns isolated session paths', () => fixture(options => {
  const dependency = provider();
  const result = native().prepareNativeProfile(options, dependency);
  assert.equal(result.status, 'ready');
  assert.equal(result.active, false);
  assert.equal(result.storeRevision, 1);
  assert.equal(result.providerVersion, '0.154.0');
  assert.ok(result.home.startsWith(`${options.nativeRoot}/`));
  assert.ok(result.codexHome.startsWith(`${result.home}/`));
  assert.equal(result.discovery, 'verified');
  assert.equal(result.selectedIds.length, 3);
  assert.equal(dependency.calls.filter(call => call.args[1] === 'add').length, 1);
  assert.equal(native().getNativeProfileStatus(options, dependency).status, 'ready');
}));

test('native Full Lean rollback follows managed authority and preserves unrelated bytes', () => fixture((options, repoRoot) => {
  const dependency = provider();
  store.applyStore({ repoRoot, stateRoot: options.stateRoot, target: 'codex', profileId: 'full@1' });
  const full = native().prepareNativeProfile(options, dependency);
  const sentinel = path.join(full.home, 'unrelated.txt');
  fs.writeFileSync(sentinel, 'user owned');
  store.applyStore({ repoRoot, stateRoot: options.stateRoot, target: 'codex', profileId: 'lean@1' });
  assert.equal(native().getNativeProfileStatus(options, dependency).status, 'stale');
  const lean = native().prepareNativeProfile(options, dependency);
  assert.notEqual(lean.home, full.home);
  assert.throws(() => native().rollbackNativeProfile(options, dependency), /managed|store/i);
  store.rollbackStore({ stateRoot: options.stateRoot });
  const restored = native().rollbackNativeProfile(options, dependency);
  assert.equal(restored.home, full.home);
  assert.equal(restored.storeRevision, 4);
  assert.equal(fs.readFileSync(sentinel, 'utf8'), 'user owned');
}));

test('native idempotency re-verifies the current home without registration writes', () => fixture(options => {
  const dependency = provider();
  const first = native().prepareNativeProfile(options, dependency);
  const calls = dependency.calls.length;
  const repeated = native().prepareNativeProfile(options, dependency);
  assert.equal(repeated.home, first.home);
  assert.equal(repeated.revision, first.revision);
  assert.equal(dependency.calls.slice(calls).some(call => call.args[0] === 'plugin'), false);
}));

test('unowned roots, provider home roots, overlaps and symlinks reject before provider execution', () => fixture((options, _repoRoot, parent) => {
  const dependency = provider();
  fs.mkdirSync(options.nativeRoot);
  const sentinel = path.join(options.nativeRoot, 'sentinel');
  fs.writeFileSync(sentinel, 'user');
  assert.throws(() => native().prepareNativeProfile(options, dependency), /owned/i);
  for (const root of [os.homedir(), path.join(os.homedir(), '.codex'), options.stateRoot, path.dirname(options.stateRoot)]) {
    assert.throws(() => native().prepareNativeProfile({ ...options, nativeRoot: root }, dependency), /root|overlap|dedicated/i);
  }
  const link = path.join(parent, 'link');
  fs.symlinkSync(options.nativeRoot, link, process.platform === 'win32' ? 'junction' : 'dir');
  assert.throws(() => native().prepareNativeProfile({ ...options, nativeRoot: link }, dependency), /link/i);
  assert.equal(fs.readFileSync(sentinel, 'utf8'), 'user');
  assert.equal(dependency.calls.length, 0);
}));

test('unsupported versions fail before provider registration and require explicit recovery', () => fixture(options => {
  const dependency = provider({ version: 'codex-cli 0.153.0' });
  assert.throws(() => native().prepareNativeProfile(options, dependency), /version/i);
  assert.equal(dependency.calls.some(call => call.args[0] === 'plugin'), false);
  assert.equal(native().getNativeProfileStatus(options, dependency).status, 'recovery-required');
  assert.equal(native().recoverNativeProfile(options, dependency).status, 'unconfigured');
}));

for (const corruption of ['missing', 'extra', 'bytes', 'disabled', 'escaped']) {
  test(`native ${corruption} discovery never commits a ready pointer`, () => fixture(options => {
    const dependency = provider({ alter: ({ skills, cache }) => {
      if (corruption === 'missing') skills.pop();
      if (corruption === 'extra') skills.push({ name: 'extra', pluginId: 'other', scope: 'user', enabled: true, path: '/outside' });
      if (corruption === 'bytes') fs.appendFileSync(skills[0].path, 'tamper');
      if (corruption === 'disabled') skills[0].enabled = false;
      if (corruption === 'escaped') skills[0].path = path.join(cache, '../elsewhere/SKILL.md');
    } });
    assert.throws(() => native().prepareNativeProfile(options, dependency), /native|discovery|digest|path|skill/i);
    assert.equal(fs.existsSync(path.join(options.nativeRoot, 'state.json')), false);
  }));
}

test('store drift after readback blocks publication and recovery preserves previous home', () => fixture((options, repoRoot) => {
  const dependency = provider();
  const before = native().prepareNativeProfile(options, dependency);
  store.applyStore({ repoRoot, stateRoot: options.stateRoot, target: 'codex', profileId: 'full@1' });
  const drifting = provider({ onCheckpoint: point => {
    if (point === 'verified') store.rollbackStore({ stateRoot: options.stateRoot });
  } });
  assert.throws(() => native().prepareNativeProfile(options, drifting), /store.*changed|binding/i);
  const result = native().recoverNativeProfile(options, dependency);
  assert.equal(result.status, 'stale');
  assert.equal(result.home, before.home);
}));

for (const checkpoint of ['prepared', 'registered', 'verified', 'state-published']) {
  test(`native recovery preserves the selected generation after ${checkpoint} interruption`, () => fixture(options => {
    const interrupted = provider({ onCheckpoint: point => { if (point === checkpoint) throw new Error('interrupted'); } });
    assert.throws(() => native().prepareNativeProfile(options, interrupted), /interrupted/);
    const recovered = native().recoverNativeProfile(options, provider());
    assert.equal(recovered.status, checkpoint === 'state-published' ? 'ready' : 'unconfigured');
    assert.equal(fs.existsSync(path.join(options.nativeRoot, 'pending.json')), false);
  }));
}

test('stale native revision and carrier preview fail before provider calls', () => fixture(options => {
  const dependency = provider();
  assert.throws(() => native().prepareNativeProfile({ ...options, expectedRevision: 4 }, dependency), /revision/i);
  assert.throws(() => native().prepareNativeProfile({ ...options, expectedCarrierDigest: '0'.repeat(64) }, dependency), /digest/i);
  assert.equal(dependency.calls.length, 0);
  assert.equal(fs.existsSync(options.nativeRoot), false);
}));

test('native state revision is bound to an immutable transition receipt', () => fixture(options => {
  const dependency = provider(); native().prepareNativeProfile(options, dependency);
  const file = path.join(options.nativeRoot, 'state.json');
  const state = JSON.parse(fs.readFileSync(file));
  fs.writeFileSync(file, JSON.stringify({ ...state, storeRevision: 9 }));
  assert.throws(() => native().getNativeProfileStatus(options), /receipt/i);
}));

test('native control drift after verification cannot replace the previous pointer', () => fixture((options, repoRoot) => {
  const original = native().prepareNativeProfile(options, provider());
  store.applyStore({ repoRoot, stateRoot: options.stateRoot, target: 'codex', profileId: 'full@1' });
  const dependency = provider({ onCheckpoint: point => {
    if (point === 'verified') {
      const pending = JSON.parse(fs.readFileSync(path.join(options.nativeRoot, 'pending.json')));
      fs.writeFileSync(path.join(options.nativeRoot, 'generations', pending.generationId, 'home/.codex/config.toml'), 'changed');
    }
  } });
  assert.throws(() => native().prepareNativeProfile(options, dependency), /changed/);
  assert.equal(JSON.parse(fs.readFileSync(path.join(options.nativeRoot, 'state.json'))).revision, original.revision);
  assert.equal(fs.existsSync(path.join(options.nativeRoot, 'pending.json')), true);
}));

test('managed descriptor drift rejects before native registration', () => fixture(options => {
  const dependency = provider({ onCheckpoint: point => {
    if (point === 'prepared') {
      const current = store.getStoreStatus({ stateRoot: options.stateRoot });
      const file = path.join(path.dirname(current.generationRoot), 'carrier.json');
      const carrier = JSON.parse(fs.readFileSync(file));
      carrier.files[0].destinationPath = '../outside';
      fs.writeFileSync(file, JSON.stringify(carrier));
    }
  } });
  assert.throws(() => native().prepareNativeProfile(options, dependency), /carrier|schema|descriptor/i);
  assert.equal(dependency.calls.length, 0);
}));

test('executable digest tampering rejects readiness without provider execution', () => fixture((options, _repoRoot, parent) => {
  const executable = path.join(parent, 'native-codex');
  fs.writeFileSync(executable, Buffer.from([0x7f, 0x45, 0x4c, 0x46, 1, 2, 3, 4]), { mode: 0o700 });
  const input = { ...options, codexPath: executable };
  native().prepareNativeProfile(input, provider());
  fs.appendFileSync(executable, 'changed');
  assert.throws(() => native().getNativeProfileStatus(input), /executable.*changed/);
}));

test('config drift and added user skills reject static native readiness', () => fixture(options => {
  const prepared = native().prepareNativeProfile(options, provider());
  const extra = path.join(prepared.codexHome, 'skills/extra');
  fs.mkdirSync(extra, { recursive: true });
  fs.writeFileSync(path.join(extra, 'SKILL.md'), 'extra');
  assert.throws(() => native().getNativeProfileStatus(options), /changed/);
}));

test('live lock is preserved and cannot be recovered by another native operation', () => fixture(options => {
  native().prepareNativeProfile(options, provider());
  const file = path.join(options.nativeRoot, '.lock');
  const bytes = JSON.stringify({ pid: process.pid, hostname: os.hostname(), nonce: 'live' });
  fs.writeFileSync(file, bytes);
  assert.equal(native().getNativeProfileStatus(options).ready, false);
  assert.throws(() => native().recoverNativeProfile(options), /live process/);
  assert.equal(fs.readFileSync(file, 'utf8'), bytes);
}));

test('native executable FIFO is rejected without opening a blocking descriptor', context => fixture((options, _repoRoot, parent) => {
  if (process.platform === 'win32') { context.skip('Named pipe creation is platform-specific'); return; }
  const pipe = path.join(parent, 'codex-pipe');
  const created = require('node:child_process').spawnSync('mkfifo', [pipe]);
  assert.equal(created.status, 0);
  assert.throws(() => native().prepareNativeProfile({ ...options, codexPath: pipe }, provider()), /regular file/);
  assert.equal(fs.existsSync(options.nativeRoot), false);
}));

test('pinned npm shim resolves and hashes its native platform binary', () => fixture((_options, _repoRoot, parent) => {
  const shim = path.join(parent, 'node_modules/@openai/codex/bin/codex.js');
  fs.mkdirSync(path.dirname(shim), { recursive: true });
  fs.writeFileSync(shim, '#!/usr/bin/env node\n');
  const targets = { 'linux/arm64': 'aarch64-unknown-linux-musl', 'linux/x64': 'x86_64-unknown-linux-musl',
    'darwin/arm64': 'aarch64-apple-darwin', 'darwin/x64': 'x86_64-apple-darwin',
    'win32/arm64': 'aarch64-pc-windows-msvc', 'win32/x64': 'x86_64-pc-windows-msvc' };
  const packageRoot = path.join(parent, 'node_modules/@openai', `codex-${process.platform}-${process.arch}`);
  const binary = path.join(packageRoot, 'vendor', targets[`${process.platform}/${process.arch}`], 'bin', process.platform === 'win32' ? 'codex.exe' : 'codex');
  fs.mkdirSync(path.dirname(binary), { recursive: true });
  fs.writeFileSync(path.join(packageRoot, 'package.json'), JSON.stringify({ name: '@openai/codex', version: '0.154.0' }));
  fs.writeFileSync(binary, Buffer.from([0x7f, 0x45, 0x4c, 0x46, 1, 2, 3, 4]), { mode: 0o700 });
  const resolved = require('../../scripts/lib/context-profile-native-executable').resolveExecutable(shim);
  assert.equal(resolved.path, binary);
  assert.equal(resolved.bytes, 8);
  assert.match(resolved.digest, /^[a-f0-9]{64}$/);
}));

for (const change of ['changed', 'removed']) {
  test(`explicit preparation refreshes a ${change} executable and preserves the old generation`, () => fixture((options, _repoRoot, parent) => {
    const binary = path.join(parent, 'old-codex');
    fs.writeFileSync(binary, Buffer.from('7f454c4601020304', 'hex'), { mode: 0o700 });
    const first = native().prepareNativeProfile({ ...options, codexPath: binary }, provider());
    const oldReceipt = fs.readFileSync(path.join(path.dirname(first.home), 'receipt.json'));
    if (change === 'changed') fs.appendFileSync(binary, 'new build');
    else fs.unlinkSync(binary);
    assert.throws(() => native().getNativeProfileStatus(options));
    const refreshed = native().prepareNativeProfile({ ...options, expectedRevision: first.revision }, provider());
    assert.equal(refreshed.ready, true);
    assert.equal(refreshed.revision, first.revision + 1);
    assert.notEqual(refreshed.home, first.home);
    assert.deepEqual(fs.readFileSync(path.join(path.dirname(first.home), 'receipt.json')), oldReceipt);
  }));
}

test('failed executable refresh preserves pointer and can recover even when old binary is gone', () => fixture((options, _repoRoot, parent) => {
  const binary = path.join(parent, 'old-codex');
  fs.writeFileSync(binary, Buffer.from('7f454c4601020304', 'hex'), { mode: 0o700 });
  native().prepareNativeProfile({ ...options, codexPath: binary }, provider());
  const pointer = fs.readFileSync(path.join(options.nativeRoot, 'state.json'));
  fs.unlinkSync(binary);
  assert.throws(() => native().prepareNativeProfile(options, provider({ failInstall: true })), /command failed/);
  assert.deepEqual(fs.readFileSync(path.join(options.nativeRoot, 'state.json')), pointer);
  const recovered = native().recoverNativeProfile(options);
  assert.equal(recovered.ready, false);
  assert.equal(recovered.status, 'refresh-required');
  assert.throws(() => native().getNativeProfileStatus(options));
  assert.equal(native().prepareNativeProfile(options, provider()).ready, true);
}));

test('refresh never excuses modified old managed files', () => fixture((options, _repoRoot, parent) => {
  const binary = path.join(parent, 'old-codex');
  fs.writeFileSync(binary, Buffer.from('7f454c4601020304', 'hex'), { mode: 0o700 });
  const first = native().prepareNativeProfile({ ...options, codexPath: binary }, provider());
  fs.unlinkSync(binary);
  fs.writeFileSync(path.join(first.codexHome, 'AGENTS.md'), 'tampered');
  const dependency = provider();
  assert.throws(() => native().prepareNativeProfile(options, dependency), /changed/);
  assert.equal(dependency.calls.length, 0);
}));

for (const version of ['0.154.0', '0.155.1']) {
  test(`native preparation pins discovered supported version ${version}`, () => fixture(options => {
    const result = native().prepareNativeProfile(options, provider({ version: `codex-cli ${version}` }));
    assert.equal(result.providerVersion, version);
    assert.equal(native().getNativeProfileStatus(options).providerVersion, version);
  }));
}
for (const version of ['0.155.0', '0.155.10', '0.155.1-dev', '0.156.0', '0.155.1 extra']) {
  test(`native version gate rejects ${version} before plugin registration`, () => fixture(options => {
    const dependency = provider({ version: `codex-cli ${version}` });
    assert.throws(() => native().prepareNativeProfile(options, dependency), /version/);
    assert.equal(dependency.calls.some(call => call.args[0] === 'plugin'), false);
  }));
}

test('same-path replacement is refreshed and version drift during discovery blocks publication', () => fixture((options, _repoRoot, parent) => {
  const binary = path.join(parent, 'codex');
  fs.writeFileSync(binary, Buffer.from('7f454c4601020304', 'hex'), { mode: 0o700 });
  const input = { ...options, codexPath: binary };
  const first = native().prepareNativeProfile(input, provider());
  fs.appendFileSync(binary, 'replacement');
  const second = native().prepareNativeProfile(input, provider({ version: 'codex-cli 0.155.1' }));
  assert.notEqual(second.home, first.home);
  assert.equal(second.providerVersion, '0.155.1');
  fs.appendFileSync(binary, 'another replacement');
  const dependency = provider();
  const execute = dependency.execute;
  let calls = 0;
  dependency.execute = (command, args, config) => args[0] === '--version' && ++calls > 1
    ? { status: 0, stdout: 'codex-cli 0.155.1' } : execute(command, args, config);
  assert.throws(() => native().prepareNativeProfile(input, dependency), /version changed/);
  assert.equal(JSON.parse(fs.readFileSync(path.join(input.nativeRoot, 'state.json'))).revision, second.revision);
}));
