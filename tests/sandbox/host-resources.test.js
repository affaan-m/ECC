'use strict';

const assert = require('assert');
const { assessHostResources, parseDarwinMemory } = require('../../scripts/sandbox/host-resources');
const GiB = 1024 ** 3;
const time = 1_789_000_000_000;
let passed = 0;
let failed = 0;
function test(name, fn) {
  try { fn(); console.log(`  ✓ ${name}`); passed += 1; }
  catch (error) { console.error(`  ✗ ${name}\n${error.stack}`); failed += 1; }
}
function vmStat({ free = GiB, speculative = GiB, file = 12 * GiB, page = 16384 } = {}) {
  return `Mach Virtual Memory Statistics: (page size of ${page} bytes)\nPages free: ${free / page}.\nPages speculative: ${speculative / page}.\nFile-backed pages: ${file / page}.\nPages purgeable: 100000.\nPages inactive: 100000.\n`;
}
function options(overrides = {}) {
  return {
    platform: 'darwin', storagePath: '/vm-store/seed', now: () => time,
    run: (command, args) => ({ status: 0, stdout: command === '/usr/bin/vm_stat' ? vmStat() : args[1] === 'hw.memsize' ? `${24 * GiB}\n` : '1\n' }),
    statfs: () => ({ bsize: 4096, blocks: 100 * GiB / 4096, bavail: 80 * GiB / 4096 }),
    ...overrides,
  };
}
function assess(memory = '4GB', overrides = {}) {
  return assessHostResources({ resources: { memory } }, options(overrides));
}

console.log('\n=== Host resource admission tests ===\n');
test('allows normal pressure with measured RAM, overhead, host reserve, and storage headroom', () => {
  const receipt = assess();
  assert.strictEqual(receipt.decision, 'allow');
  assert.strictEqual(receipt.code, 'host_resources_available');
  assert.strictEqual(receipt.guest_memory_bytes, 4 * GiB);
  assert.strictEqual(receipt.host_reserve_bytes, 4 * GiB);
  assert.strictEqual(receipt.vm_overhead_bytes, GiB);
  assert.strictEqual(receipt.required_memory_bytes, 9 * GiB);
  assert.strictEqual(receipt.required_disk_bytes, 10 * GiB);
  assert.strictEqual(receipt.available_memory_bytes, 13 * GiB);
  assert.strictEqual(receipt.memory_pressure, 'normal');
  assert.strictEqual(receipt.schema_version, 1);
  assert.strictEqual(receipt.checked_at, new Date(time).toISOString());
  assert.ok(Object.isFrozen(receipt));
  assert.deepStrictEqual(JSON.parse(JSON.stringify(receipt)), receipt);
});
test('uses only absolute read-only commands with bounded output and timeout, and actual seed storage', () => {
  const calls = [];
  const defaults = options();
  const receipt = assess('4GB', {
    run(command, args, opts) { calls.push([command, args]); assert.strictEqual(opts.shell, false); assert.strictEqual(opts.timeout, 2000); assert.ok(opts.maxBuffer <= 65536); return defaults.run(command, args); },
    statfs(storagePath) { assert.strictEqual(storagePath, '/vm-store/seed'); return defaults.statfs(); },
  });
  assert.strictEqual(receipt.decision, 'allow');
  assert.deepStrictEqual(calls, [['/usr/sbin/sysctl', ['-n', 'kern.memorystatus_vm_pressure_level']], ['/usr/sbin/sysctl', ['-n', 'hw.memsize']], ['/usr/bin/vm_stat', []], ['/usr/sbin/sysctl', ['-n', 'kern.memorystatus_vm_pressure_level']]]);
});
for (const [level, pressure] of [['2', 'warning'], ['4', 'critical']]) {
  test(`denies ${pressure} pressure even with ample RAM`, () => {
    const defaults = options();
    const receipt = assess('4GB', { run: (command, args) => args[1] === 'kern.memorystatus_vm_pressure_level' ? { status: 0, stdout: level } : defaults.run(command, args) });
    assert.strictEqual(receipt.decision, 'deny');
    assert.strictEqual(receipt.code, 'host_memory_pressure');
    assert.strictEqual(receipt.memory_pressure, pressure);
    assert.match(receipt.message, /VM launch refused/);
  });
}
test('denies pressure that rises while other probes run', () => {
  let reads = 0;
  const defaults = options();
  const receipt = assess('4GB', { run: (command, args) => args[1] === 'kern.memorystatus_vm_pressure_level' ? { status: 0, stdout: ++reads === 1 ? '1' : '2' } : defaults.run(command, args) });
  assert.strictEqual(receipt.code, 'host_memory_pressure');
});
for (const value of ['0', '3', '5', '1garbage', '', '1\n2']) {
  test(`fails closed on unknown or malformed pressure ${JSON.stringify(value)}`, () => {
    const receipt = assess('4GB', { run: () => ({ status: 0, stdout: value }) });
    assert.strictEqual(receipt.decision, 'deny');
    assert.strictEqual(receipt.code, 'host_resource_probe_failed');
  });
}
test('refuses RAM request including reserve and overhead, with actionable numbers', () => {
  const receipt = assess('12GB');
  assert.strictEqual(receipt.code, 'host_insufficient_memory');
  assert.strictEqual(receipt.required_memory_bytes, Math.ceil(12 * GiB * 1.2) + 4 * GiB);
  assert.match(receipt.message, /GiB.*GiB/);
});
test('scales reserve on larger hosts and accepts MB consistently with VM configuration', () => {
  const defaults = options();
  const receipt = assess('4096MB', { run: (command, args) => args[1] === 'hw.memsize' ? { status: 0, stdout: `${64 * GiB}` } : defaults.run(command, args) });
  assert.strictEqual(receipt.guest_memory_bytes, 4 * GiB);
  assert.strictEqual(receipt.host_reserve_bytes, Math.ceil(64 * GiB * 0.1));
});
test('denies storage shortage using available blocks rather than privileged free blocks', () => {
  const receipt = assess('4GB', { statfs: () => ({ bsize: 4096, blocks: 100 * GiB / 4096, bfree: 80 * GiB / 4096, bavail: 2 * GiB / 4096 }) });
  assert.strictEqual(receipt.code, 'host_insufficient_disk');
  assert.strictEqual(receipt.available_disk_bytes, 2 * GiB);
});
test('uses guest plus 4 GiB for larger disk minimum', () => {
  const receipt = assess('8GB');
  assert.strictEqual(receipt.required_disk_bytes, 12 * GiB);
});
test('does not double count speculative, inactive, purgeable, or compressed memory', () => {
  assert.strictEqual(parseDarwinMemory(vmStat(), 24 * GiB).available_memory_bytes, 13 * GiB);
  assert.strictEqual(parseDarwinMemory(vmStat({ speculative: 2 * GiB, file: GiB }), 24 * GiB).available_memory_bytes, 3 * GiB);
});
test('caps file-backed reclaim credit at half host RAM', () => {
  assert.strictEqual(parseDarwinMemory(vmStat({ file: 20 * GiB }), 24 * GiB).available_memory_bytes, 14 * GiB);
});
for (const input of ['', 'nonsense', vmStat().replace('16384', '3'), vmStat().replace('Pages free:', 'Missing:'), `${vmStat()}Pages free: 1.\n`, vmStat().replace('65536.', '-1.'), vmStat().replace('65536.', '9007199254740992.'), vmStat().replace('65536.', '65536oops.')]) {
  test('rejects missing, duplicate, malformed, or overflowing vm_stat values', () => {
    const defaults = options();
    assert.strictEqual(assess('4GB', { run: (command, args) => command === '/usr/bin/vm_stat' ? { status: 0, stdout: input } : defaults.run(command, args) }).decision, 'deny');
  });
}
for (const value of [null, {}, { bsize: 0, blocks: 1, bavail: 1 }, { bsize: 4096, blocks: 1, bavail: 2 }, { bsize: 4096, blocks: 1, bavail: -1 }, { bsize: 4096, blocks: Infinity, bavail: Infinity }]) {
  test('fails closed on malformed disk statistics', () => assert.strictEqual(assess('4GB', { statfs: () => value }).code, 'host_resource_probe_failed'));
}
for (const value of ['0GB', '4gb', '4 GB', '1.5GB', '9007199254740992GB', '', null, undefined]) {
  test(`refuses invalid guest RAM ${String(value)}`, () => {
    const receipt = assessHostResources({ resources: { memory: value } }, options());
    assert.strictEqual(receipt.code, 'host_resource_request_invalid');
  });
}
for (const response of [{ status: 1, stdout: '1' }, { status: null, stdout: '1', error: new Error('timeout') }, { status: 0, stdout: '1', signal: 'SIGTERM' }, { status: 0, stdout: '1'.repeat(65537) }]) {
  test('refuses failed, timed out, signaled, or excessive probes', () => assert.strictEqual(assess('4GB', { run: () => response }).code, 'host_resource_probe_failed'));
}
test('returns denial when probes throw without leaking probe stderr or private paths', () => {
  const receipt = assess('4GB', { run: () => { throw new Error('private path secret'); } });
  assert.strictEqual(receipt.code, 'host_resource_probe_failed');
  assert.doesNotMatch(receipt.message, /secret|private/);
});
test('denies missing or relative storage location instead of checking the wrong volume', () => {
  for (const storagePath of [undefined, '', 'relative', '/bad\0path']) {
    assert.strictEqual(assess('4GB', { storagePath }).code, 'host_resource_request_invalid');
  }
});
test('refuses unsupported platforms explicitly without executing probes', () => {
  for (const platform of ['linux', 'win32']) {
    const receipt = assess('4GB', { platform, run: () => { throw new Error('must not run'); } });
    assert.strictEqual(receipt.code, 'host_resource_platform_unsupported');
  }
});
for (const end of [time + 10001, time - 1, NaN]) {
  test('denies stale probes and invalid or reversed clock readings', () => {
    let reads = 0;
    assert.strictEqual(assess('4GB', { now: () => ++reads === 1 ? time : end }).code, 'host_resource_probe_stale');
  });
}
test('ignores unknown configuration rather than allowing reserve or pressure overrides', () => {
  assert.strictEqual(assess('12GB', { hostReserveBytes: 0, ignorePressure: true, allow: true }).code, 'host_insufficient_memory');
});
test('rejects statistics inconsistent with physical RAM', () => {
  for (const input of [vmStat({ free: 25 * GiB }), vmStat({ free: 20 * GiB, speculative: 5 * GiB }), vmStat({ file: 25 * GiB })]) {
    assert.throws(() => parseDarwinMemory(input, 24 * GiB), /physical memory/);
  }
});
test('rejects malformed physical RAM and disk probe exceptions', () => {
  const defaults = options();
  for (const value of ['0', '-1', 'NaN', '9007199254740992', '25769803776 bytes']) {
    const result = assess('4GB', { run: (command, args) => args[1] === 'hw.memsize' ? { status: 0, stdout: value } : defaults.run(command, args) });
    assert.strictEqual(result.code, 'host_resource_probe_failed');
  }
  assert.strictEqual(assess('4GB', { statfs: () => { throw new Error('ENOENT'); } }).code, 'host_resource_probe_failed');
});
test('allows the exact memory and disk headroom boundary', () => {
  const defaults = options();
  const result = assess('4GB', {
    run: (command, args) => command === '/usr/bin/vm_stat' ? { status: 0, stdout: vmStat({ free: GiB, speculative: 0, file: 8 * GiB }) } : defaults.run(command, args),
    statfs: () => ({ bsize: 4096, blocks: 100 * GiB / 4096, bavail: 10 * GiB / 4096 }),
  });
  assert.strictEqual(result.decision, 'allow');
});
test('returns the same complete receipt shape on early failure with null unknown metrics', () => {
  const success = assess();
  const failure = assess('0GB');
  assert.deepStrictEqual(Object.keys(failure).sort(), Object.keys(success).sort());
  assert.strictEqual(failure.available_memory_bytes, null);
  assert.strictEqual(failure.memory_pressure, 'unknown');
  assert.ok(Object.isFrozen(failure));
});
test('rejects impossible disjoint available page sum instead of clamping to physical RAM', () => {
  assert.throws(() => parseDarwinMemory(vmStat({ free: 20 * GiB, speculative: GiB, file: 8 * GiB }), 24 * GiB), /physical memory/);
});
test('budgets conservative clone bytes in addition to minimum disk headroom', () => {
  const result = assess('4GB', { cloneBytes: 20 * GiB });
  assert.strictEqual(result.decision, 'allow');
  assert.strictEqual(result.clone_bytes, 20 * GiB);
  assert.strictEqual(result.required_disk_bytes, 30 * GiB);
  assert.strictEqual(result.disk_deficit_bytes, 0);
  assert.match(result.message, /budgeted headroom/);
});
test('refuses a clone that consumes minimum disk headroom with explicit deficit', () => {
  const result = assess('4GB', { cloneBytes: 75 * GiB });
  assert.strictEqual(result.code, 'host_insufficient_disk');
  assert.strictEqual(result.required_disk_bytes, 85 * GiB);
  assert.strictEqual(result.disk_deficit_bytes, 5 * GiB);
  assert.match(result.message, /5\.00 GiB deficit/);
  assert.match(result.message, /clone/);
});
test('does not charge clone twice in the subsequent pre-start admission', () => {
  const afterClone = assess('4GB', { cloneBytes: 0, statfs: () => ({ bsize: 4096, blocks: 100 * GiB / 4096, bavail: 10 * GiB / 4096 }) });
  assert.strictEqual(afterClone.decision, 'allow');
  assert.strictEqual(afterClone.clone_bytes, 0);
  assert.strictEqual(afterClone.required_disk_bytes, 10 * GiB);
});
for (const cloneBytes of [-1, NaN, Infinity, 0.5, '100', null, Number.MAX_SAFE_INTEGER]) {
  test(`refuses malformed or overflowing clone budget ${String(cloneBytes)}`, () => {
    const result = assess('4GB', { cloneBytes });
    assert.strictEqual(result.code, 'host_resource_request_invalid');
    assert.strictEqual(result.clone_bytes, null);
  });
}
console.log(`\n${passed} passed, ${failed} failed`);
if (failed > 0) process.exitCode = 1;
