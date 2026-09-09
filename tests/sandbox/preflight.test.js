'use strict';

const assert = require('assert');
const { resourcePreflight } = require('../../scripts/sandbox/resource-preflight');
const resolved = {
  manifest: { resources: { memory: '8GB' } }, manifestPath: '/test/demo.yaml',
  decision: { result: 'routable', routes: [{ backend: 'lume', tier: 2, arch: 'arm64', os: 'macos' }] },
};
let probes = 0;
const deps = {
  vmStoragePath: () => '/test/storage',
  vmCloneBudget: () => 0,
  prepareLumeClone: () => ({ supported: false, message: 'fixture' }),
  run: () => ({ status: 0, stdout: '[{"status":"stopped","os":"macOS"}]' }),
  assessHostResources: () => { probes += 1; return { decision: 'deny', code: 'host_insufficient_memory', message: 'Not enough host memory.' }; },
};
const denial = resourcePreflight(resolved, deps);
assert.strictEqual(denial.result, 'error');
assert.strictEqual(denial.creates_run, false);
assert.strictEqual(denial.checks[0].admission.code, 'host_insufficient_memory');
assert.strictEqual(probes, 1);
const allowed = resourcePreflight(resolved, { ...deps, assessHostResources: () => ({ decision: 'allow' }) });
assert.strictEqual(allowed.result, 'ready');
assert.strictEqual(allowed.creates_run, false);
assert.match(allowed.note, /recheck/i);
const failed = resourcePreflight(resolved, { ...deps, vmStoragePath: () => { throw new Error('storage unavailable'); } });
assert.strictEqual(failed.result, 'error');
assert.match(failed.checks[0].message, /storage unavailable/);
const unsupported = resourcePreflight({ ...resolved, decision: { result: 'routable', routes: [{ backend: 'podman' }] } }, deps);
assert.strictEqual(unsupported.result, 'error');
assert.match(unsupported.checks[0].message, /VM/);
assert.strictEqual(probes, 1);
const unavailable = resourcePreflight({ ...resolved, decision: { result: 'error', routes: [{ result: 'error', reason: 'No VM runtime', fix: 'Prepare a host' }] } }, deps);
assert.strictEqual(unavailable.result, 'error');
assert.match(unavailable.checks[0].message, /No VM runtime/);
console.log('Resource preview: 5 scenarios passed');
