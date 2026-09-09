'use strict';

const assert = require('assert');
const { executeVm, acquireRunLock, acquireVmRunLock } = require('../../scripts/sandbox/backends/vm');
const { LUME_DRIVER } = require('../../scripts/sandbox/backends/lume');
const { LIMA_DRIVER } = require('../../scripts/sandbox/backends/lima');
const { TART_DRIVER } = require('../../scripts/sandbox/backends/tart');

let passed = 0;
let failed = 0;
function test(name, fn) {
  try { fn(); console.log(`  ✓ ${name}`); passed += 1; }
  catch (error) { console.error(`  ✗ ${name}: ${error.stack}`); failed += 1; }
}
const manifest = {
  name: 'admission-test',
  needs: { os: ['macos'], capabilities: ['network:*'], native: true, trust: 'first-party' },
  resources: { cpu: 2, memory: '4GB', timeout: 30 },
  steps: { setup: ['true'], assert: ['true'] }, report: 'exit-only',
};
function receipt(decision = 'allow') {
  return {
    schema_version: 1, decision, code: decision === 'allow' ? 'sufficient-resources' : 'memory-pressure',
    message: decision === 'allow' ? 'Host has sufficient headroom.' : 'VM cannot start: host memory pressure is warning. Close other workloads and retry.',
    checked_at: new Date().toISOString(), platform: 'darwin',
    guest_memory_bytes: 4294967296, total_memory_bytes: 25769803776,
    available_memory_bytes: 12884901888, host_reserve_bytes: 4294967296,
    vm_overhead_bytes: 1073741824, required_memory_bytes: 9663676416,
    available_disk_bytes: 21474836480, required_disk_bytes: 10737418240,
    memory_pressure: decision === 'allow' ? 'normal' : 'warning', probe_duration_ms: 1,
  };
}
function runCase(driver, decisions, extra = {}) {
  const calls = [];
  const admissions = [];
  let deleted = false;
  if (decisions[0] === 'allow') decisions.unshift('allow');
  const outcome = executeVm(manifest, {
    driver, arch: 'arm64', manifestPath: '/fixture/admission.yaml', vmName: 'ecc-admission-test',
    vmStoragePath: () => '/fixture/vms',
    vmCloneBudget: () => 0,
    prepareLumeClone: () => ({ supported: false, message: 'Fixture uses conservative copy budget' }),
    assessHostResources: () => receipt(decisions.shift() || 'allow'),
    run: (binary, argv) => {
      calls.push([binary, ...argv]);
      const intercepted = extra.interceptRun?.(binary, argv);
      if (intercepted) return intercepted;
      if (argv.includes('delete')) deleted = true;
      if (deleted && (argv[0] === 'get' || argv[0] === 'list') && argv[1] === 'ecc-admission-test') return { status: 1, stderr: 'VM not found' };
      if (argv[0] === 'get') return { status: 0, stdout: JSON.stringify(driver.backend === 'tart'
        ? { Running: false, State: 'stopped', OS: 'darwin' } : [{ status: 'stopped', os: 'macOS' }]) };
      if (argv[0] === 'list' && driver.backend === 'lima') return { status: 0, stdout: JSON.stringify([{ status: 'Stopped', arch: 'aarch64', config: { os: 'Linux', arch: 'aarch64', plain: true } }]) };
      return { status: 0, stdout: '[]' };
    },
    sleep: () => {},
    lifecycle: { resourceAdmission: details => admissions.push(details) },
    ...extra,
  });
  return { outcome, calls, admissions };
}

console.log('\n=== VM host admission integration ===\n');
test('legacy Apple lock prevents a new macOS launch and releases the host lock', () => {
  const legacy = acquireRunLock('apple-macos-guests');
  assert.strictEqual(legacy.pass, true);
  try {
    assert.strictEqual(acquireVmRunLock('lume').pass, false);
    const linux = acquireVmRunLock('lima');
    assert.strictEqual(linux.pass, true);
    linux.release();
  } finally { legacy.release(); }
});
test('one host VM lease serializes different backend lifetimes', () => {
  const first = acquireVmRunLock('lima');
  assert.strictEqual(first.pass, true);
  try { assert.strictEqual(acquireVmRunLock('tart').pass, false); }
  finally { first.release(); }
});
for (const driver of [LUME_DRIVER, LIMA_DRIVER, TART_DRIVER]) {
  test(`${driver.backend} refuses before cloning and reports successful no-resource cleanup`, () => {
    const { outcome, calls, admissions } = runCase(driver, ['deny']);
    assert.strictEqual(outcome.exitCode, 2);
    assert.strictEqual(outcome.report.result, 'error');
    assert.deepStrictEqual(outcome.report.steps, []);
    assert.strictEqual(outcome.report.host_admissions[0].decision, 'deny');
    assert.ok(outcome.report.notes.some(note => note.includes('VM cannot start')));
    assert.ok(calls.every(call => !call.includes('clone') && !call.includes('run') && !call.includes('start')));
    assert.strictEqual(outcome.cleanup.attempted, false);
    assert.strictEqual(outcome.cleanup.pass, true);
    assert.strictEqual(admissions.length, 1);
  });
}
test('pressure appearing after clone refuses start and deletes the owned clone', () => {
  const { outcome, calls } = runCase(LUME_DRIVER, ['allow', 'deny']);
  assert.strictEqual(outcome.exitCode, 2);
  assert.ok(calls.some(call => call.includes('clone')));
  assert.ok(calls.some(call => call.includes('delete')));
  assert.ok(calls.every(call => !call.includes('run')));
  assert.strictEqual(outcome.cleanup.pass, true);
  assert.deepStrictEqual(outcome.report.host_admissions.map(r => r.decision), ['allow', 'deny']);
});
test('sufficient resources allows workload with two recorded admission decisions', () => {
  const { outcome, calls } = runCase(LUME_DRIVER, ['allow', 'allow']);
  assert.strictEqual(outcome.exitCode, 0);
  assert.ok(calls.some(call => call.includes('run')));
  assert.strictEqual(outcome.report.host_admissions.length, 2);
  assert.strictEqual(outcome.cleanup.pass, true);
});
test('failure to persist admission evidence prevents provisioning', () => {
  const { outcome, calls } = runCase(LUME_DRIVER, ['allow'], {
    lifecycle: { resourceAdmission() { throw new Error('journal unavailable'); } },
  });
  assert.strictEqual(outcome.exitCode, 2);
  assert.ok(calls.every(call => !call.includes('clone')));
});
test('mocks never claim host admission or run live resource probes', () => {
  const { outcome } = runCase(LUME_DRIVER, [], {
    mock: true, assessHostResources() { throw new Error('mock reached real admission'); },
  });
  assert.strictEqual(outcome.report.execution_mode, 'mock');
  assert.strictEqual(outcome.report.host_admissions, undefined);
});
test('budgets full copy only before clone and pins all Lume lifecycle operations', () => {
  const samples = [];
  const { outcome, calls } = runCase(LUME_DRIVER, [], {
    vmCloneBudget: (_backend, _seed, _result, opts) => { assert.strictEqual(opts.storagePath, '/fixture/vms'); return 80 * 1024 ** 3; },
    assessHostResources: (_manifest, opts) => { samples.push(opts.cloneBytes); return receipt(); },
  });
  assert.strictEqual(outcome.exitCode, 0);
  assert.deepStrictEqual(samples, [0, 80 * 1024 ** 3, 0]);
  assert.ok(calls.find(c => c[1] === 'clone').includes('--source-storage'));
  for (const call of calls.filter(c => ['run', 'set', 'ssh', 'stop', 'delete'].includes(c[1]))) {
    assert.strictEqual(call[call.indexOf('--storage') + 1], '/fixture/vms');
  }
});
test('prepared COW clone replaces CLI copy and carries zero clone budget', () => {
  let cloned = 0;
  const { outcome, calls } = runCase(LUME_DRIVER, [], {
    prepareLumeClone: (_source, _destination, opts) => {
      assert.strictEqual(opts.verifySourceStopped(), true);
      return { supported: true, cloneBytes: 0, message: 'COW available', clone() { cloned += 1; return { ok: true, copy_method: 'clonefile-required' }; } };
    },
    vmCloneBudget() { throw new Error('unnecessary full copy'); },
  });
  assert.strictEqual(outcome.exitCode, 0);
  assert.strictEqual(cloned, 1);
  assert.ok(calls.every(c => !c.includes('clone')));
});
test('COW rejection cannot delete an unowned preexisting destination or fall back to copy', () => {
  const { outcome, calls } = runCase(LUME_DRIVER, [], {
    prepareLumeClone: () => ({ supported: true, cloneBytes: 0, message: 'COW planned', clone() { throw new Error('destination already exists'); } }),
  });
  assert.strictEqual(outcome.exitCode, 2);
  assert.ok(calls.every(c => !['clone', 'run', 'delete', 'stop'].includes(c[1])));
  assert.strictEqual(outcome.cleanup.attempted, false);
});
test('storage changes after cloning refuse boot and cleanup the original pinned path', () => {
  let reads = 0;
  const { outcome, calls } = runCase(LUME_DRIVER, [], {
    vmStoragePath: () => ++reads === 1 ? '/fixture/vms' : '/fixture/changed',
  });
  assert.strictEqual(outcome.exitCode, 2);
  assert.ok(calls.every(c => c[1] !== 'run'));
  const deletion = calls.find(c => c[1] === 'delete');
  assert.strictEqual(deletion[deletion.indexOf('--storage') + 1], '/fixture/vms');
});
test('actual assessor receipts validate in final reports including early failures', () => {
  const { assessHostResources } = require('../../scripts/sandbox/host-resources');
  const { validateReport } = require('../../scripts/sandbox/contracts');
  const GiB = 1024 ** 3;
  for (const failure of [null, 'warning', 'unsupported', 'probe']) {
    const { outcome } = runCase(LUME_DRIVER, [], {
      assessHostResources: (request, opts) => assessHostResources(request, {
        ...opts, platform: failure === 'unsupported' ? 'linux' : 'darwin',
        run: (binary, argv) => ({ status: failure === 'probe' ? 1 : 0, stdout: binary === '/usr/bin/vm_stat'
          ? 'Mach Virtual Memory Statistics: (page size of 16384 bytes)\nPages free: 131072.\nPages speculative: 0.\nFile-backed pages: 655360.\n'
          : argv.includes('hw.memsize') ? String(24 * GiB) : failure === 'warning' ? '2' : '1' }),
        statfs: () => ({ bsize: 4096, blocks: 100 * GiB / 4096, bavail: 50 * GiB / 4096 }),
      }),
    });
    validateReport(outcome.report);
    assert.strictEqual(outcome.exitCode, failure ? 2 : 0);
    assert.strictEqual(outcome.report.host_admissions.length, failure ? 1 : 2);
  }
});
test('delete success without verified absence retains cleanup failure', () => {
  let deleted = false;
  let cleanup;
  const { outcome } = runCase(LUME_DRIVER, [], {
    interceptRun: (_binary, argv) => {
      if (argv[0] === 'delete') deleted = true;
      if (deleted && argv[0] === 'get') return { status: 0, stdout: '[{"status":"stopped","os":"macOS"}]' };
      return null;
    },
    lifecycle: { cleanupCompleted: value => { cleanup = value; } },
  });
  assert.strictEqual(outcome.exitCode, 2);
  assert.strictEqual(outcome.cleanup.pass, false);
  assert.strictEqual(cleanup.pass, false);
});
test('owned partial clone is recorded before failed cleanup', () => {
  let registered = null;
  const { outcome } = runCase(LUME_DRIVER, [], {
    prepareLumeClone: () => ({ supported: true, cloneBytes: 0, message: 'COW ready', clone() {
      throw Object.assign(new Error('partial clone retained'), { receipt: { owned_destination: true, cleanup_pass: false } });
    } }),
    lifecycle: { resourceCreated: event => { registered = event.resource; } },
    interceptRun: (_binary, argv) => argv[0] === 'delete' ? { status: 1, stderr: 'busy' } : null,
  });
  assert.strictEqual(outcome.cleanup.pass, false);
  assert.strictEqual(registered.vm, 'ecc-admission-test');
  assert.strictEqual(registered.storage_path, '/fixture/vms');
});
test('unverified interrupted clone reports cleanup uncertainty without unowned deletion', () => {
  const { outcome, calls } = runCase(LUME_DRIVER, [], {
    prepareLumeClone: () => ({ supported: true, cloneBytes: 0, message: 'COW ready', clone() {
      throw Object.assign(new Error('helper interrupted'), { receipt: { owned_destination: false, cleanup_pass: false } });
    } }),
  });
  assert.strictEqual(outcome.cleanup.pass, false);
  assert.ok(calls.every(c => c[1] !== 'delete'));
});
test('Lima successful empty inventory verifies deletion', () => {
  let deleted = false;
  const { outcome } = runCase(LIMA_DRIVER, [], {
    interceptRun: (_binary, argv) => {
      if (argv.includes('delete')) deleted = true;
      if (deleted && argv[0] === 'list' && argv[1] === 'ecc-admission-test') return { status: 0, stdout: '[]' };
      return null;
    },
  });
  assert.strictEqual(outcome.exitCode, 0);
  assert.strictEqual(outcome.cleanup.pass, true);
});
test('deadline expiry during clone preparation prevents an unnecessary VM boot', () => {
  let now = 0;
  const { outcome, calls } = runCase(LUME_DRIVER, [], {
    clock: () => now,
    prepareLumeClone: () => { now = 31000; return { supported: false, message: 'slow preparation' }; },
  });
  assert.strictEqual(outcome.exitCode, 2);
  assert.ok(calls.every(c => c[1] !== 'run'));
});
test('failed helper ownership cannot emit guest-ready or execute setup', () => {
  let ready = 0;
  const { outcome } = runCase(LUME_DRIVER, [], {
    start: () => ({ status: 0, child: { pid: 70000, isAlive: () => false, isOwned: () => false, addOwnershipMarker: () => false, unref() {} } }),
    lifecycle: { ready: () => { ready += 1; } },
  });
  assert.strictEqual(outcome.exitCode, 2);
  assert.strictEqual(ready, 0);
  assert.deepStrictEqual(outcome.report.steps, []);
});
test('malformed COW plan and result refuse without boot or full copy fallback', () => {
  for (const plan of [
    { supported: 'yes', cloneBytes: 0, clone() { return { ok: true }; } },
    { supported: true, cloneBytes: 1, clone() { return { ok: true }; } },
    { supported: true, cloneBytes: 0, clone() { return { ok: true, copy_method: 'full-copy' }; } },
  ]) {
    const { outcome, calls } = runCase(LUME_DRIVER, [], { prepareLumeClone: () => plan });
    assert.strictEqual(outcome.exitCode, 2);
    assert.ok(calls.every(c => !['run', 'clone'].includes(c[1])));
  }
});
console.log(`\n${passed}/${passed + failed} passed`);
process.exitCode = failed ? 1 : 0;
