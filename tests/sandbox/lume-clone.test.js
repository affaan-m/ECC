'use strict';

const assert = require('assert');
const fs = require('fs');
const os = require('os');
const path = require('path');
const { spawnSync } = require('child_process');
const { prepareLumeClone, validateCloneReceipt } = require('../../scripts/sandbox/lume-clone');
let passed = 0;
let failed = 0;
function test(name, fn) {
  try { fn(); console.log(`  ✓ ${name}`); passed += 1; }
  catch (error) { console.error(`  ✗ ${name}\n${error.stack}`); failed += 1; }
}
const root = fs.realpathSync(fs.mkdtempSync(path.join(os.tmpdir(), 'ecc-lume-clone-tests-')));
const seed = path.join(root, 'seed');
fs.mkdirSync(seed, { mode: 0o700 });
const destination = () => path.join(root, `ecc-sandbox-lume-test-${Math.random().toString(16).slice(2)}`);
const stopped = { verifySourceStopped: () => true };
const config = { os: 'macOS', cpuCount: 2, memorySize: 4 * 1024 ** 3, diskSize: 4096, display: '1024x768', macAddress: '02:00:00:00:00:01', machineIdentifier: Buffer.from('fixture-machine').toString('base64'), hardwareModel: Buffer.from('fixture-hardware').toString('base64') };
function seedFiles() {
  fs.writeFileSync(path.join(seed, 'disk.img'), Buffer.alloc(4096, 0x61));
  fs.writeFileSync(path.join(seed, 'nvram.bin'), Buffer.from('paired-fixture-nvram'));
  fs.writeFileSync(path.join(seed, 'config.json'), JSON.stringify(config));
}
seedFiles();
console.log('\n=== Forced CoW Lume clone tests ===\n');
test('unsupported platform preserves full-copy fallback decision without running anything', () => {
  const plan = prepareLumeClone(seed, destination(), { ...stopped, platform: 'linux' });
  assert.strictEqual(plan.supported, false);
  assert.strictEqual(plan.cloneBytes, null);
  assert.ok(Object.isFrozen(plan));
});
test('requires explicit stopped-source verification', () => {
  for (const verifySourceStopped of [undefined, () => false, () => 'true', () => { throw new Error('private'); }]) {
    const plan = prepareLumeClone(seed, destination(), { verifySourceStopped });
    assert.strictEqual(plan.supported, false);
    assert.doesNotMatch(plan.message, /private/);
  }
});
test('rejects invalid paths and existing destinations', () => {
  for (const dest of [seed, 'relative', root, `${root}/bad\0path`, path.join(root, 'unowned-vm')]) {
    assert.strictEqual(prepareLumeClone(seed, dest, stopped).supported, false);
  }
});
test('rejects symlink sources and files', () => {
  const link = path.join(root, 'linked-seed');
  fs.symlinkSync(seed, link);
  assert.strictEqual(prepareLumeClone(link, destination(), stopped).supported, false);
  const entry = path.join(seed, 'unexpected-link');
  fs.symlinkSync(path.join(seed, 'disk.img'), entry);
  assert.strictEqual(prepareLumeClone(seed, destination(), stopped).supported, false);
  fs.unlinkSync(entry);
});
test('rejects live sessions, provisioning, and pending resize markers', () => {
  for (const marker of ['sessions.json', '.provisioning', 'resize.lock.json']) {
    const file = path.join(seed, marker);
    fs.writeFileSync(file, '{}');
    assert.strictEqual(prepareLumeClone(seed, destination(), stopped).supported, false);
    fs.unlinkSync(file);
  }
});
test('rejects directories and oversized auxiliary files', () => {
  const entry = path.join(seed, 'directory');
  fs.mkdirSync(entry);
  assert.strictEqual(prepareLumeClone(seed, destination(), stopped).supported, false);
  fs.rmdirSync(entry);
  const oversized = path.join(seed, 'oversized.log');
  const fd = fs.openSync(oversized, 'w');
  fs.ftruncateSync(fd, 17 * 1024 ** 2);
  fs.closeSync(fd);
  assert.strictEqual(prepareLumeClone(seed, destination(), stopped).supported, false);
  fs.unlinkSync(oversized);
});

test('requires exact pinned Lume version and normal pressure before compiling', () => {
  for (const version of ['0.5.0', '0.5.2', 'lume 0.5.1', '0.5.1 extra', '', '0.5.1']) {
    const plan = prepareLumeClone(seed, destination(), {
      ...stopped, platform: 'darwin', lumeExecutable: process.execPath,
      run: (_executable, args) => ({ status: 0, stdout: args[0] === '--version' ? version : '2' }),
    });
    assert.strictEqual(plan.supported, false);
    assert.strictEqual(plan.reason, 'lume_compatibility_unverified');
    assert.throws(() => plan.clone(), error => error.receipt.owned_destination === false);
  }
});
test('rejects inconsistent success ownership evidence instead of inventing ownership', () => {
  for (const fields of [
    { ok: true, owned_destination: false, cleanup_pass: null },
    { ok: true, owned_destination: true, cleanup_pass: true },
    { ok: true, owned_destination: true, cleanup_pass: false },
    { ok: true },
  ]) {
    assert.throws(() => validateCloneReceipt({ status: 0, stdout: JSON.stringify({ copy_method: 'clonefile-required', ...fields }) }), error => error.receipt.code === 'lume_cow_unverified' && error.receipt.owned_destination === false);
  }
  assert.throws(() => validateCloneReceipt({ status: null, signal: 'SIGKILL', stdout: '' }), error => error.receipt.cleanup_pass === false && error.receipt.owned_destination === false);
});
if (process.argv.includes('--host') || process.argv.includes('--require-host')) {
  test('real APFS tiny fixture proves per-file clone, independent writes, and fresh identities', () => {
    const dest = destination();
    const plan = prepareLumeClone(seed, dest, stopped);
    assert.strictEqual(plan.supported, true, plan.message);
    assert.strictEqual(plan.cloneBytes, 0);
    const result = plan.clone();
    assert.strictEqual(result.ok, true, result.message);
    assert.strictEqual(result.copy_method, 'clonefile-required');
    const clonedConfig = JSON.parse(fs.readFileSync(path.join(dest, 'config.json')));
    assert.notStrictEqual(clonedConfig.macAddress, config.macAddress);
    assert.notStrictEqual(clonedConfig.machineIdentifier, config.machineIdentifier);
    assert.strictEqual(clonedConfig.hardwareModel, config.hardwareModel);
    assert.strictEqual(clonedConfig.memorySize, config.memorySize);
    assert.deepStrictEqual(fs.readFileSync(path.join(dest, 'nvram.bin')), fs.readFileSync(path.join(seed, 'nvram.bin')));
    fs.writeFileSync(path.join(dest, 'disk.img'), 'clone changed');
    assert.strictEqual(fs.readFileSync(path.join(seed, 'disk.img')).length, 4096);
    fs.writeFileSync(path.join(seed, 'nvram.bin'), 'source changed');
    assert.strictEqual(fs.readFileSync(path.join(dest, 'nvram.bin')).toString(), 'paired-fixture-nvram');
    seedFiles();
  });
  test('accepts exploration and fabric namespaces with independent native clones', () => {
    for (const namespace of ['explore', 'fabric']) {
      const dest = path.join(root, `ecc-${namespace}-lume-test`);
      const plan = prepareLumeClone(seed, dest, stopped);
      assert.strictEqual(plan.supported, true, plan.message);
      assert.strictEqual(plan.clone().ok, true);
      assert.throws(() => plan.clone(), error => error.receipt.code === 'lume_cow_consumed');
    }
  });
  test('native helper refuses source and destination Lume guard contention', () => {
    for (const kind of ['source', 'destination']) {
      const dest = destination();
      const guard = kind === 'source' ? path.join(root, '.seed.resize.guard') : path.join(root, `.${path.basename(dest)}.resize.guard`);
      const code = `const {prepareLumeClone}=require(process.argv[1]); const p=prepareLumeClone(process.argv[2],process.argv[3],{verifySourceStopped:()=>true}); if(!p.supported) throw Error(p.message); try {p.clone();process.exit(2)} catch(e){console.log(JSON.stringify(e.receipt))}`;
      const script = 'import fcntl,subprocess,sys\nf=open(sys.argv[1],"a+")\nfcntl.flock(f,fcntl.LOCK_EX|fcntl.LOCK_NB)\nr=subprocess.run(sys.argv[2:])\nsys.exit(r.returncode)';
      const result = spawnSync('/usr/bin/python3', ['-c', script, guard, process.execPath, '-e', code, path.resolve(__dirname, '../../scripts/sandbox/lume-clone.js'), seed, dest], { encoding: 'utf8', timeout: 15000 });
      assert.strictEqual(result.status, 0, result.stderr);
      const receipt = JSON.parse(result.stdout);
      assert.strictEqual(receipt.ok, false);
      assert.strictEqual(receipt.owned_destination, false);
      assert.strictEqual(receipt.cleanup_pass, true);
      assert.strictEqual(fs.existsSync(dest), false);
    }
  });
  test('real helper cleans only its destination when invalid config fails after file clones', () => {
    const dest = destination();
    const plan = prepareLumeClone(seed, dest, stopped);
    assert.strictEqual(plan.supported, true, plan.message);
    fs.writeFileSync(path.join(seed, 'config.json'), '{broken');
    assert.throws(() => plan.clone(), error => error.receipt.ok === false && error.receipt.owned_destination === true && error.receipt.cleanup_pass === true);
    assert.strictEqual(fs.existsSync(dest), false);
    assert.strictEqual(fs.existsSync(seed), true);
    seedFiles();
  });
  test('rechecks stopped source before consuming a prepared operation', () => {
    let isStopped = true;
    const dest = destination();
    const plan = prepareLumeClone(seed, dest, { verifySourceStopped: () => isStopped });
    assert.strictEqual(plan.supported, true, plan.message);
    isStopped = false;
    assert.throws(() => plan.clone(), error => error.receipt.ok === false && error.receipt.owned_destination === false);
    assert.strictEqual(fs.existsSync(dest), false);
  });
  test('refuses a replaced source directory after preparation', () => {
    const dest = destination();
    const plan = prepareLumeClone(seed, dest, stopped);
    assert.strictEqual(plan.supported, true, plan.message);
    const old = path.join(root, 'old-seed');
    fs.renameSync(seed, old);
    fs.mkdirSync(seed);
    seedFiles();
    assert.throws(() => plan.clone(), error => error.receipt.owned_destination === false);
    assert.strictEqual(fs.existsSync(dest), false);
    fs.rmSync(seed, { recursive: true });
    fs.renameSync(old, seed);
  });
  test('refuses replaced or newly existing destination without deleting it', () => {
    const dest = destination();
    const plan = prepareLumeClone(seed, dest, stopped);
    assert.strictEqual(plan.supported, true, plan.message);
    fs.mkdirSync(dest);
    fs.writeFileSync(path.join(dest, 'keep'), 'unrelated');
    assert.throws(() => plan.clone(), error => error.receipt.ok === false && error.receipt.owned_destination === false);
    assert.strictEqual(fs.readFileSync(path.join(dest, 'keep'), 'utf8'), 'unrelated');
  });
} else {
  console.log('  Host CoW verification requires --host or --require-host; no compiler or VM operations run.');
}
fs.rmSync(root, { recursive: true, force: true });
console.log(`\n${passed} passed, ${failed} failed`);
if (failed > 0) process.exitCode = 1;
