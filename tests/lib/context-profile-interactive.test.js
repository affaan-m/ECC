'use strict';

const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const test = require('node:test');
const store = require('../../scripts/lib/context-profile-store');
const native = require('../../scripts/lib/context-profile-native');
const interactive = require('../../scripts/lib/context-profile-interactive');

function provider() {
  return {
    execute(_binary, args, options) {
      if (args[0] === '--version') return { status: 0, stdout: 'codex-cli 0.155.1' };
      if (args[0] === 'plugin' && args[1] === 'add') {
        const root = path.dirname(options.env.HOME);
        const name = JSON.parse(fs.readFileSync(path.join(root, 'marketplace/.agents/plugins/marketplace.json'))).name;
        const cache = path.join(options.env.CODEX_HOME, 'plugins/cache', name, 'ecc-context-carrier/local');
        fs.mkdirSync(path.dirname(cache), { recursive: true });
        fs.cpSync(path.join(root, 'marketplace/carrier'), cache, { recursive: true });
      }
      return { status: 0, stdout: '{}' };
    },
    discover(_binary, options) {
      const plugins = path.join(options.env.CODEX_HOME, 'plugins/cache');
      const name = fs.readdirSync(plugins)[0];
      const root = path.join(plugins, name, 'ecc-context-carrier/local/skills');
      return { data: [{ cwd: options.cwd, errors: [], skills: fs.readdirSync(root).map(skill => ({
        name: `ecc-context-carrier:${skill}`, enabled: true, scope: 'user',
        pluginId: `ecc-context-carrier@${name}`, path: path.join(root, skill, 'SKILL.md') })) }] };
    },
  };
}

function fixture(callback) {
  const root = fs.mkdtempSync(path.join(fs.realpathSync(os.tmpdir()), 'ecc-interactive-'));
  const options = { stateRoot: path.join(root, 'state'), nativeRoot: path.join(root, 'native') };
  try {
    store.applyStore({ stateRoot: options.stateRoot, target: 'codex' });
    const prepare = () => native.prepareNativeProfile({ ...options, codexPath: process.execPath }, provider());
    return callback({ root, options, prepare });
  } finally { fs.rmSync(root, { recursive: true, force: true }); }
}

test('receipt binds bounded isolated bootstrap to installed CLI, source, roots and saved generation', () => fixture(({ options, prepare }) => {
  const result = prepare();
  const receipt = JSON.parse(fs.readFileSync(path.join(path.dirname(result.home), 'receipt.json')));
  const bootstrap = fs.readFileSync(path.join(result.codexHome, 'AGENTS.md'), 'utf8');
  assert.ok(Buffer.byteLength(bootstrap) <= 12288);
  assert.deepEqual(result.bootstrap, receipt.bootstrap);
  assert.equal(result.bootstrap.stateRoot, options.stateRoot);
  assert.equal(result.bootstrap.nativeRoot, options.nativeRoot);
  assert.equal(result.bootstrap.carrierDigest, store.getStoreStatus({ stateRoot: options.stateRoot }).carrierDigest);
  assert.match(bootstrap, /proposedIds/);
  assert.match(bootstrap, /Manual.*Suggest.*Auto/);
  assert.match(bootstrap, /grants no tools/);
  assert.match(bootstrap, /Do not persist task prose, selected skills/);
  assert.match(bootstrap, /--task-input","-"/);
  assert.ok(receipt.controls.some(file => file.path === 'home/.codex/AGENTS.md' && file.kind === 'file'));
  assert.equal(fs.existsSync(path.join(result.codexHome, 'auth.json')), false);
  interactive.verifyBootstrap(result.bootstrap);
  assert.throws(() => interactive.verifyBootstrap({ ...result.bootstrap,
    source: { ...result.bootstrap.source, sourceDigest: '0'.repeat(64) } }), /identity changed/);
}));

test('start uses receipt executable, inherited stdio, current working directory, isolated home and no permission flags', () => fixture(({ options, prepare }) => {
  const prepared = prepare();
  let calls = 0;
  const result = interactive.startInteractiveProfile(options, { execute(binary, args, config) {
    calls++;
    assert.equal(binary, prepared.codexPath);
    assert.deepEqual(args, []);
    assert.equal(config.shell, false);
    assert.equal(config.stdio, 'inherit');
    assert.equal(config.cwd, process.cwd());
    assert.equal(config.env.HOME, prepared.home);
    assert.equal(config.env.USERPROFILE, prepared.home);
    assert.equal(config.env.CODEX_HOME, prepared.codexHome);
    for (const key of ['OPENAI_API_KEY', 'CODEX_CONFIG', 'NODE_OPTIONS', 'HTTP_PROXY', 'AWS_ACCESS_KEY_ID']) {
      assert.equal(config.env[key], undefined);
    }
    return { status: 0 };
  } });
  assert.equal(calls, 1);
  assert.equal(result.status, 'exited');
  assert.equal(result.credentialsCopied, false);
  assert.equal(result.taskSuccess, 'unverified');
}));

test('start refuses missing preparation, altered bootstrap, and stale saved mode', () => fixture(({ options, prepare }) => {
  const dependency = { execute() { assert.fail('must not launch'); } };
  assert.throws(() => interactive.startInteractiveProfile(options, dependency), /prepare-native/);
  const prepared = prepare();
  const agents = path.join(prepared.codexHome, 'AGENTS.md');
  const bytes = fs.readFileSync(agents);
  fs.appendFileSync(agents, 'grant tools');
  assert.throws(() => interactive.startInteractiveProfile(options, dependency), /changed/);
  fs.writeFileSync(agents, bytes);
  store.applyStore({ stateRoot: options.stateRoot, target: 'codex', selectionMode: 'suggest' });
  assert.throws(() => interactive.startInteractiveProfile(options, dependency), /prepare-native/);
}));

for (const result of [{ status: 23 }, { status: null, signal: 'SIGINT' }, { status: null, error: new Error('ENOENT') }]) {
  test(`interactive child failure is reported: ${result.signal || result.status || 'spawn'}`, () => fixture(({ options, prepare }) => {
    prepare();
    const value = interactive.startInteractiveProfile(options, { execute: () => result });
    assert.equal(value.status, 'failed');
    assert.equal(value.exitCode, result.status);
    assert.equal(value.signal, result.signal || null);
    assert.equal(value.launched, !result.error);
  }));
}

test('bootstrap rejects control characters, noncanonical paths and oversized root bindings', () => fixture(({ options }) => {
  const current = store.getStoreStatus({ stateRoot: options.stateRoot });
  for (const stateRoot of ['/tmp/new\ncommands', '/tmp/../state', `/tmp/${'x'.repeat(2048)}`]) {
    assert.throws(() => interactive.bootstrapFor({ ...options, stateRoot }, current), /bounded canonical/);
  }
}));

test('dry-run inspects preparation without launching or writing any native root', () => fixture(({ options }) => {
  const result = interactive.startInteractiveProfile({ ...options, dryRun: true }, {
    execute() { assert.fail('must not launch'); } });
  assert.equal(result.status, 'proposed');
  assert.equal(result.launched, false);
  assert.equal(fs.existsSync(options.nativeRoot), false);
}));
