'use strict';

const assert = require('assert');
const fs = require('fs');
const os = require('os');
const path = require('path');
const { vmStoragePath, vmCloneBudget, withLumeStorage } = require('../../scripts/sandbox/vm-storage');

let passed = 0;
let failed = 0;
const root = fs.mkdtempSync(path.join(os.tmpdir(), 'ecc-vm-storage-test-'));
const home = path.join(root, 'home');
for (const directory of ['.lume', '.lima', '.tart/vms', 'external vms']) {
  fs.mkdirSync(path.join(home, directory), { recursive: true });
}
const good = stdout => ({ status: 0, stdout, stderr: '' });
const seedResult = good(JSON.stringify({ name: 'seed', locationName: 'source' }));
const options = { home, env: {} };
function test(name, fn) {
  try { fn(); console.log(`  ✓ ${name}`); passed += 1; }
  catch (error) { console.error(`  ✗ ${name}\n    ${error.stack}`); failed += 1; }
}
function denied(fn) {
  assert.throws(fn, error => error.code === 'HOST_STORAGE_UNKNOWN');
}
try {
  test('Lume resolves its effective default destination, independently of seed location', () => {
    const run = (binary, argv, settings) => {
      assert.strictEqual(binary, 'lume');
      assert.deepStrictEqual(argv, ['config', 'get']);
      assert.strictEqual(settings.shell, false);
      assert.strictEqual(settings.timeout, 5000);
      return good(`banner\nDefault VM storage: home (~/.lume)\nCache directory: ~/.lume/cache\n`);
    };
    assert.strictEqual(vmStoragePath('lume', 'seed', seedResult, { ...options, run }),
      fs.realpathSync(path.join(home, '.lume')));
  });
  test('Lume honors effective custom config and a destination containing spaces', () => {
    const destination = path.join(home, 'external vms');
    const env = { XDG_CONFIG_HOME: '/different/config' };
    const run = (_binary, _argv, settings) => {
      assert.strictEqual(settings.env, env);
      return good(`Default VM storage: external (${destination})\n`);
    };
    assert.strictEqual(vmStoragePath('lume', 'seed', seedResult, { ...options, env, run }),
      fs.realpathSync(destination));
  });
  for (const [label, result] of [
    ['failed command', { status: 1, stdout: 'Default VM storage: home (~/.lume)' }],
    ['timeout', { status: null, error: new Error('timeout') }],
    ['missing binary', { error: Object.assign(new Error('absent'), { code: 'ENOENT' }) }],
    ['unknown config', good('Default VM storage: home (not set)')],
    ['relative destination', good('Default VM storage: home (relative/storage)')],
    ['ambiguous output', good('Default VM storage: home (~/.lume)\nDefault VM storage: other (~/.lima)')],
    ['missing output', good('unrecognized output')],
    ['control characters', good('Default VM storage: home (~/.lu\tme)')],
  ]) {
    test(`Lume fails closed for ${label}`, () => denied(() =>
      vmStoragePath('lume', 'seed', seedResult, { ...options, run: () => result })));
  }
  test('Lume command exceptions fail closed', () => denied(() =>
    vmStoragePath('lume', 'seed', seedResult, { ...options, run: () => { throw new Error('failed'); } })));
  for (const [backend, variable, suffix] of [['lima', 'LIMA_HOME', ''], ['tart', 'TART_HOME', 'vms']]) {
    test(`${backend} default destination uses backend home`, () => {
      assert.strictEqual(vmStoragePath(backend, 'seed', seedResult, options),
        fs.realpathSync(path.join(home, `.${backend}`, suffix)));
    });
    test(`${backend} honors absolute storage override`, () => {
      const override = path.join(root, backend);
      fs.mkdirSync(path.join(override, suffix), { recursive: true });
      assert.strictEqual(vmStoragePath(backend, 'seed', seedResult,
        { ...options, env: { [variable]: override } }), fs.realpathSync(path.join(override, suffix)));
    });
    for (const value of ['', 'relative', '~/custom', '/tmp/invalid\npath']) {
      test(`${backend} refuses ambiguous override ${JSON.stringify(value)}`, () => denied(() =>
        vmStoragePath(backend, 'seed', seedResult, { ...options, env: { [variable]: value } })));
    }
  }
  test('missing storage directory fails closed without creating it', () => {
    const missing = path.join(root, 'missing');
    denied(() => vmStoragePath('lima', 'seed', seedResult, { ...options, env: { LIMA_HOME: missing } }));
    assert.strictEqual(fs.existsSync(missing), false);
  });
  test('storage regular file fails closed', () => {
    const file = path.join(root, 'file');
    fs.writeFileSync(file, 'test');
    denied(() => vmStoragePath('lima', 'seed', seedResult, { ...options, env: { LIMA_HOME: file } }));
  });
  test('storage symlink resolves to the actual destination volume', () => {
    const link = path.join(root, 'linked');
    fs.symlinkSync(path.join(home, '.lima'), link);
    assert.strictEqual(vmStoragePath('lima', 'seed', seedResult, { ...options, env: { LIMA_HOME: link } }),
      fs.realpathSync(path.join(home, '.lima')));
  });
  test('unsupported backend fails closed', () => denied(() => vmStoragePath('other', 'seed', seedResult, options)));
  for (const [backend, metadata, expected] of [
    ['lume', { name: 'seed', diskSize: { total: 80 * 1024 ** 3, allocated: 20 * 1024 ** 3 } }, 80 * 1024 ** 3],
    ['lima', { name: 'seed', disk: 64 * 1024 ** 3 }, 64 * 1024 ** 3],
    ['tart', { Disk: 80, DiskFormat: 'raw' }, 81 * 1000 ** 3],
  ]) {
    test(`${backend} budgets logical seed capacity, not allocated or reclaimable blocks`, () => {
      const storage = path.join(home, `.${backend}`, backend === 'tart' ? 'vms' : '');
      fs.mkdirSync(path.join(storage, 'seed'));
      fs.writeFileSync(path.join(storage, 'seed', 'disk.img'), 'data');
      const run = () => good('Default VM storage: home (~/.lume)');
      const result = good(JSON.stringify(backend === 'tart' ? metadata : [metadata]));
      assert.strictEqual(vmCloneBudget(backend, 'seed', result, { ...options, run }), expected);
    });
  }
  test('clone budget includes every seed file using logical size, including sparse files', () => {
    const seedPath = path.join(home, '.lima', 'seed');
    const sparsePath = path.join(seedPath, 'basedisk');
    const descriptor = fs.openSync(sparsePath, 'wx');
    try { fs.ftruncateSync(descriptor, 2 * 1024 ** 3); } finally { fs.closeSync(descriptor); }
    fs.mkdirSync(path.join(seedPath, 'nested'));
    fs.writeFileSync(path.join(seedPath, 'nested', 'auxiliary'), 'metadata');
    const result = good(JSON.stringify([{ name: 'seed', disk: 1024 ** 3 }]));
    assert.strictEqual(vmCloneBudget('lima', 'seed', result, options), 2 * 1024 ** 3 + 12);
  });
  for (const metadata of [{}, { disk: 0 }, { disk: -1 }, { disk: '64GB' }, { disk: 9007199254740992 }]) {
    test('clone budget refuses unknown or malformed seed capacity', () => denied(() =>
      vmCloneBudget('lima', 'seed', good(JSON.stringify(metadata)), options)));
  }
  test('clone budget refuses failed, oversized, multiple, or mismatched seed records', () => {
    for (const result of [
      { status: 1, stdout: '{}' }, good('not json'), good('x'.repeat(65537)),
      good(JSON.stringify([{ name: 'seed', disk: 1 }, { name: 'seed', disk: 1 }])),
      good(JSON.stringify({ name: 'other', disk: 1 })),
    ]) denied(() => vmCloneBudget('lima', 'seed', result, options));
  });
  test('clone budget accepts bounded Lume diagnostic prelude before JSON', () => {
    const result = good('INFO configuration loaded\n' + JSON.stringify([{ name: 'seed', diskSize: { total: 1024 } }]));
    const run = () => good('Default VM storage: home (~/.lume)');
    assert.strictEqual(vmCloneBudget('lume', 'seed', result, { ...options, run }), 1024);
  });
  test('clone budget uses pinned canonical storage without re-reading changed defaults', () => {
    const storagePath = fs.realpathSync(path.join(home, '.lume'));
    const result = good(JSON.stringify({ name: 'seed', diskSize: { total: 1024 } }));
    assert.strictEqual(vmCloneBudget('lume', 'seed', result, {
      ...options, storagePath, run: () => { throw new Error('must not read changed defaults'); },
    }), 1024);
  });
  test('clone budget rejects explicitly invalid or missing pinned storage instead of falling back', () => {
    const result = good(JSON.stringify({ name: 'seed', diskSize: { total: 1024 } }));
    for (const storagePath of ['', null, 'relative', path.join(root, 'gone')]) {
      denied(() => vmCloneBudget('lume', 'seed', result, {
        ...options, storagePath, run: () => { throw new Error('must not fall back'); },
      }));
    }
  });
  test('clone budget rejects seed path traversal and unknown source storage', () => {
    const result = good(JSON.stringify({ disk: 1024 }));
    for (const seed of ['../seed', '.', '..', '/seed', '']) {
      denied(() => vmCloneBudget('lima', seed, result, options));
    }
    denied(() => vmCloneBudget('lima', 'missing', result, options));
  });
  test('clone budget rejects source-tree symlinks rather than undercounting their targets', () => {
    const link = path.join(home, '.lima', 'seed', 'linked');
    fs.symlinkSync(path.join(home, '.tart'), link);
    try {
      denied(() => vmCloneBudget('lima', 'seed', good(JSON.stringify({ disk: 1024 })), options));
    } finally { fs.unlinkSync(link); }
  });
  test('Lume clone binds both source and destination to the checked storage', () => {
    const argv = ['clone', 'seed', 'clone'];
    assert.deepStrictEqual(withLumeStorage(argv, '/volume/vms'),
      [...argv, '--source-storage', '/volume/vms', '--dest-storage', '/volume/vms']);
    assert.deepStrictEqual(argv, ['clone', 'seed', 'clone']);
  });
  for (const command of ['get', 'set', 'run', 'stop', 'delete', 'ssh']) {
    test(`Lume ${command} binds checked storage`, () => {
      assert.deepStrictEqual(withLumeStorage([command, 'guest'], '/volume/vms'),
        [command, 'guest', '--storage', '/volume/vms']);
    });
  }
  test('Lume SSH storage flag precedes remote-command separator without changing guest flags', () => {
    const argv = ['ssh', 'guest', '--timeout', '10', '--', 'cmd', '--storage', 'guest-path'];
    assert.deepStrictEqual(withLumeStorage(argv, '/volume/vms'),
      ['ssh', 'guest', '--timeout', '10', '--storage', '/volume/vms', '--', 'cmd', '--storage', 'guest-path']);
  });
  test('Lume inventory and configuration remain independent of selected storage', () => {
    for (const argv of [['config', 'get'], ['ls', '--format', 'json']]) {
      assert.deepStrictEqual(withLumeStorage(argv, '/volume/vms'), argv);
    }
  });
  test('Lume storage wrapper refuses ambiguous flags, unsupported commands and unsafe paths', () => {
    for (const argv of [[], ['create', 'vm'], ['get', 'vm', '--storage', '/other'],
      ['run', 'vm', '--storage=/other'], ['clone', 'seed', 'vm', '--dest-storage', '/other']]) {
      denied(() => withLumeStorage(argv, '/volume/vms'));
    }
    for (const storage of ['', 'relative', '/bad\npath', '/bad\0path']) {
      denied(() => withLumeStorage(['get', 'vm'], storage));
    }
  });
} finally {
  fs.rmSync(root, { recursive: true, force: true });
}
console.log(`\n${passed} passed, ${failed} failed`);
process.exitCode = failed ? 1 : 0;
