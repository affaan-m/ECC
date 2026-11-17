'use strict';

const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const test = require('node:test');
const { spawnSync } = require('node:child_process');
const { withFixture, write } = require('./helpers/context-fixture');

const store = () => require('../../scripts/lib/context-profile-store');

test('managed path decomposition preserves Windows drive and UNC roots', () => {
  const { pathSegments } = require('../../scripts/lib/context-profile-store-fs');
  assert.deepEqual(pathSegments('C:\\Users\\test\\store', path.win32), { root: 'C:\\', parts: ['Users', 'test', 'store'] });
  assert.deepEqual(pathSegments('\\\\server\\share\\store', path.win32), { root: '\\\\server\\share\\', parts: ['store'] });
});
function fixture(run) {
  return withFixture(repoRoot => {
    const parent = fs.mkdtempSync(path.join(fs.realpathSync(os.tmpdir()), 'ecc-store-'));
    try { return run({ repoRoot, stateRoot: path.join(parent, 'managed') }, parent); }
    finally { fs.rmSync(parent, { recursive: true, force: true }); }
  });
}

test('preview is deterministic and does not create a state root', () => fixture(options => {
  const first = store().previewStore(options);
  assert.deepEqual(store().previewStore(options), first);
  assert.equal(first.revision, 0);
  assert.equal(first.activation, 'unobserved');
  assert.equal(fs.existsSync(options.stateRoot), false);
}));

test('Full to Lean to Full rollback keeps exact generations and increments revisions', () => fixture(options => {
  const full = store().applyStore({ ...options, profileId: 'full@1', expectedRevision: 0 });
  assert.equal(full.revision, 1);
  assert.equal(full.selectedIds.length, 5);
  const lean = store().applyStore({ ...options, expectedRevision: 1 });
  assert.equal(lean.selectedIds.length, 3);
  assert.equal(fs.existsSync(path.join(lean.generationRoot, 'skills/feature')), false);
  const restored = store().rollbackStore({ stateRoot: options.stateRoot, expectedRevision: 2 });
  assert.equal(restored.revision, 3);
  assert.equal(restored.generationRoot, full.generationRoot);
  assert.equal(restored.selectedIds.length, 5);
  assert.equal(restored.activation, 'unobserved');
  assert.equal(restored.active, false);
}));

test('same selection is a verified no-op and stale revision or preview digest fails', () => fixture(options => {
  const first = store().applyStore(options);
  assert.equal(store().applyStore(options).revision, first.revision);
  assert.throws(() => store().applyStore({ ...options, expectedRevision: 0 }), /revision/i);
  assert.throws(() => store().applyStore({ ...options, expectedCarrierDigest: '0'.repeat(64) }), /digest/i);
}));

test('source changes after preview fail before any managed write', () => fixture(options => {
  const preview = store().previewStore(options);
  write(options.repoRoot, 'skills/ecc-guide/extra.txt', 'new source');
  assert.throws(() => store().applyStore({ ...options, expectedCarrierDigest: preview.carrierDigest }), /digest/i);
  assert.equal(fs.existsSync(options.stateRoot), false);
}));

test('state survives source removal and bundled bytes are preserved', () => fixture(options => {
  fs.writeFileSync(path.join(options.repoRoot, 'skills/ecc-guide/binary.bin'), Buffer.from([0, 255, 13, 10]));
  const applied = store().applyStore(options);
  assert.deepEqual(fs.readFileSync(path.join(applied.generationRoot, 'skills/ecc-guide/binary.bin')), Buffer.from([0, 255, 13, 10]));
  fs.renameSync(path.join(options.repoRoot, 'skills'), path.join(options.repoRoot, 'skills-away'));
  assert.equal(store().getStoreStatus({ stateRoot: options.stateRoot }).revision, 1);
}));

test('arbitrary existing directories, unsupported targets, and external carriers are refused', () => fixture((options, parent) => {
  fs.mkdirSync(options.stateRoot);
  fs.writeFileSync(path.join(options.stateRoot, 'sentinel'), 'user');
  assert.throws(() => store().applyStore(options), /owned|managed|empty/i);
  assert.equal(fs.readFileSync(path.join(options.stateRoot, 'sentinel'), 'utf8'), 'user');
  assert.throws(() => store().applyStore({ ...options, stateRoot: path.join(parent, 'other'), target: 'gemini' }), /unsupported/i);
  assert.throws(() => store().applyStore({ ...options, carrier: {} }), /unknown/i);
}));

for (const corruption of ['modified', 'extra', 'symlink', 'hardlink']) {
  test(`managed ${corruption} files block status, apply, and rollback`, context => fixture((options, parent) => {
    store().applyStore({ ...options, profileId: 'full@1' });
    const active = store().applyStore(options);
    const leaf = path.join(active.generationRoot, 'skills/ecc-guide/SKILL.md');
    if (corruption === 'modified') fs.appendFileSync(leaf, '\nuser edit');
    if (corruption === 'extra') fs.writeFileSync(path.join(active.generationRoot, 'extra'), 'user');
    if (corruption === 'symlink') {
      fs.unlinkSync(leaf);
      try { fs.symlinkSync(path.join(parent, 'outside'), leaf); }
      catch (error) {
        if (process.platform === 'win32' && ['EPERM', 'EACCES'].includes(error.code)) {
          context.skip('Windows file symlink privilege unavailable; mocked rejection remains mandatory'); return;
        }
        throw error;
      }
    }
    if (corruption === 'hardlink') fs.linkSync(leaf, path.join(parent, 'linked'));
    for (const run of [() => store().getStoreStatus(options), () => store().applyStore(options),
      () => store().rollbackStore({ stateRoot: options.stateRoot })]) assert.throws(run);
  }));
}

test('symlink state roots and ancestors fail without touching their targets', () => fixture((options, parent) => {
  const actual = path.join(parent, 'actual'); fs.mkdirSync(actual);
  fs.symlinkSync(actual, options.stateRoot, process.platform === 'win32' ? 'junction' : 'dir');
  assert.throws(() => store().applyStore(options), /symbolic|symlink/i);
  assert.throws(() => store().applyStore({ ...options, stateRoot: path.join(options.stateRoot, 'child') }), /symbolic|symlink/i);
  assert.deepEqual(fs.readdirSync(actual), []);
}));

test('file symlink rejection is mandatory even without native symlink privileges', context => fixture(options => {
  const status = store().applyStore(options);
  const leaf = path.join(status.generationRoot, 'skills/ecc-guide/SKILL.md');
  const original = fs.lstatSync;
  context.mock.method(fs, 'lstatSync', (filename, ...args) => {
    const stat = original(filename, ...args);
    return filename === leaf ? new Proxy(stat, { get(target, key) {
      return key === 'isSymbolicLink' ? () => true : Reflect.get(target, key);
    } }) : stat;
  });
  try { assert.throws(() => store().getStoreStatus({ stateRoot: options.stateRoot }), /symbolic/i); }
  finally { context.mock.restoreAll(); }
}));

test('live lock blocks concurrent writers without changing current selection', () => fixture(options => {
  const first = store().applyStore(options);
  let checked = false;
  store().applyStore({ ...options, profileId: 'full@1', onCheckpoint(name) {
    if (name === 'prepared') {
      assert.throws(() => store().applyStore(options), /lock|transaction|recovery/i);
      checked = true;
    }
  } });
  assert.equal(checked, true);
  assert.equal(first.revision, 1);
}));

for (const point of ['prepared', 'file-written', 'generation-published', 'receipt-published', 'state-published']) {
  test(`interruption at ${point} is recoverable and recovery is idempotent`, () => fixture(options => {
    const first = store().applyStore(options);
    assert.throws(() => store().applyStore({ ...options, profileId: 'full@1', onCheckpoint(name) {
      if (name === point) throw new Error('simulated interruption');
    } }), /simulated interruption/);
    assert.equal(store().getStoreStatus({ stateRoot: options.stateRoot }).recoveryRequired, true);
    const recovered = store().recoverStore({ stateRoot: options.stateRoot });
    assert.equal(recovered.recoveryRequired, false);
    assert.ok([first.revision, first.revision + 1].includes(recovered.revision));
    assert.deepEqual(store().recoverStore({ stateRoot: options.stateRoot }), recovered);
    assert.equal(store().applyStore({ ...options, profileId: 'full@1' }).selectedIds.length, 5);
  }));
}

test('changed interrupted generation fails recovery and preserves user bytes', () => fixture(options => {
  assert.throws(() => store().applyStore({ ...options, onCheckpoint(name, detail) {
    if (name === 'file-written') {
      fs.appendFileSync(detail.path, 'user edit');
      throw new Error('interrupted');
    }
  } }));
  assert.throws(() => store().recoverStore({ stateRoot: options.stateRoot }), /changed|digest|integrity/i);
}));

test('receipt-bound selectors and mode survive status and rollback', () => fixture(options => {
  store().applyStore({ ...options, include: ['skill:feature'], exclude: ['skill:shared'], selectionMode: 'auto' });
  let status = store().getStoreStatus({ stateRoot: options.stateRoot });
  assert.deepEqual(status.include, ['skill:feature']);
  assert.deepEqual(status.exclude, ['skill:shared']);
  assert.equal(status.selectionMode, 'auto');
  store().applyStore({ ...options, profileId: 'full@1', selectionMode: 'manual' });
  status = store().rollbackStore({ stateRoot: options.stateRoot });
  assert.deepEqual(status.include, ['skill:feature']);
  assert.deepEqual(status.exclude, ['skill:shared']);
  assert.equal(status.selectionMode, 'auto');
}));

test('an explicit pin is persisted even when Full already selects that skill', () => fixture(options => {
  store().applyStore({ ...options, profileId: 'full@1' });
  const status = store().applyStore({ ...options, profileId: 'full@1', include: ['skill:feature'] });
  assert.equal(status.revision, 2);
  assert.deepEqual(status.include, ['skill:feature']);
}));

test('source drift during copying retains an abortable transaction', () => fixture(options => {
  let changed = false;
  assert.throws(() => store().applyStore({ ...options, onCheckpoint(name) {
    if (name === 'file-written' && !changed) {
      changed = true;
      write(options.repoRoot, 'skills/feature/new-resource', 'changed registry');
    }
  } }), /source.*changed/i);
  assert.equal(store().recoverStore({ stateRoot: options.stateRoot }).revision, 0);
}));

test('receipt or state tampering is refused before configuration changes', () => fixture(options => {
  const status = store().applyStore(options);
  const receipt = path.join(options.stateRoot, 'receipts', `${status.receiptDigest}.json`);
  fs.appendFileSync(receipt, 'corruption');
  assert.throws(() => store().applyStore({ ...options, profileId: 'full@1' }));
  assert.throws(() => store().recoverStore({ stateRoot: options.stateRoot }));
}));

for (const point of ['prepared', 'file-written', 'generation-published', 'receipt-published', 'state-published']) {
  test(`process death at ${point} leaves a dead lock that recovery reclaims`, () => fixture(options => {
    store().applyStore(options);
    const script = `const store = require(${JSON.stringify(require.resolve('../../scripts/lib/context-profile-store'))});
      store.applyStore({ ...JSON.parse(process.argv[1]), profileId: 'full@1', onCheckpoint(name) {
        if (name === process.argv[2]) process.exit(77);
      } });`;
    const child = spawnSync(process.execPath, ['-e', script, JSON.stringify(options), point], { encoding: 'utf8' });
    assert.equal(child.status, 77, child.stderr);
    assert.equal(fs.existsSync(path.join(options.stateRoot, '.lock')), true);
    assert.throws(() => store().applyStore(options), /lock|recovery/i);
    const recovered = store().recoverStore({ stateRoot: options.stateRoot });
    assert.equal(recovered.recoveryRequired, false);
    assert.equal(fs.existsSync(path.join(options.stateRoot, '.lock')), false);
  }));
}

for (const hostname of [os.hostname(), 'another-host.invalid']) {
  test(`recovery preserves a ${hostname === os.hostname() ? 'live' : 'foreign-host'} lock`, () => fixture(options => {
    store().applyStore(options);
    const lock = { hostname, pid: process.pid, nonce: 'held' };
    const lockPath = path.join(options.stateRoot, '.lock');
    fs.writeFileSync(lockPath, JSON.stringify(lock));
    assert.throws(() => store().recoverStore({ stateRoot: options.stateRoot }), /lock/i);
    assert.deepEqual(JSON.parse(fs.readFileSync(lockPath, 'utf8')), lock);
  }));
}
