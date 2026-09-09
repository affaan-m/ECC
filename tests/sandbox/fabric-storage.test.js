'use strict';

const assert = require('assert');
const fs = require('fs');
const os = require('os');
const path = require('path');
const { createBackendOwnershipReceipt } = require('../../scripts/sandbox/fabric-controller');
const { createFabricWorkerLifecycle, cleanupApprovedRouteOwnership } = require('../../scripts/sandbox/ecc-sandbox');

let passed = 0;
let failed = 0;
function test(name, fn) {
  try { fn(); console.log(`  ✓ ${name}`); passed += 1; }
  catch (error) { console.error(`  ✗ ${name}\n${error.stack}`); failed += 1; }
}
function withReceipt(fn) {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'ecc-fabric-storage-test-'));
  try {
    const receipt = createBackendOwnershipReceipt({ backend: 'lume', jobId: 'job_1',
      ownerToken: 'a'.repeat(64), runId: 'run_1234567890abcdef1234567890abcdef', receiptDirectory: root });
    fn(receipt, createFabricWorkerLifecycle(receipt));
  } finally { fs.rmSync(root, { recursive: true, force: true }); }
}
function cleanup(receipt) {
  const calls = [];
  let removed = false;
  const outcome = cleanupApprovedRouteOwnership(receipt, { run: (binary, argv) => {
    calls.push([binary, ...argv]);
    if (argv[0] === 'get') return removed
      ? { status: 1, stderr: 'virtual machine not found' }
      : { status: 0, stdout: JSON.stringify([{ name: receipt.resource_name }]) };
    if (argv[0] === 'delete') removed = true;
    return { status: 0, stdout: '' };
  } });
  return { outcome, calls };
}
test('Fabric seals storage before clone and binds all recovery commands after defaults change', () => withReceipt((receipt, lifecycle) => {
  lifecycle.resourceAdmission({ backend: 'lume', storage_path: '/original/vms' });
  const stored = fs.readFileSync(receipt.process_receipt.path, 'utf8').trim().split('\n').map(JSON.parse);
  assert.strictEqual(stored[0].kind, 'storage');
  assert.strictEqual(stored[0].storage_path, '/original/vms');
  assert.match(stored[0].mac, /^[a-f0-9]{64}$/);
  lifecycle.resourceCreated({ backend: 'lume', resource: { vm: receipt.resource_name, storage_path: '/original/vms' } });
  const { outcome, calls } = cleanup(receipt);
  assert.strictEqual(outcome.verified, true);
  assert.strictEqual(calls.length, 5);
  assert.ok(calls.every(call => call.slice(-2).join('|') === '--storage|/original/vms'));
  assert.strictEqual(fs.readFileSync(receipt.process_receipt.path, 'utf8').trim().split('\n').length, 1);
}));
test('Fabric refuses changed storage during one VM lifecycle', () => withReceipt((receipt, lifecycle) => {
  lifecycle.resourceAdmission({ backend: 'lume', storage_path: '/original/vms' });
  assert.throws(() => lifecycle.resourceCreated({ backend: 'lume', resource: {
    vm: receipt.resource_name, storage_path: '/changed/vms',
  } }), /storage/i);
  assert.strictEqual(cleanup(receipt).outcome.verified, true);
}));
test('Fabric refuses unknown storage in a new authenticated journal without backend actions', () => withReceipt(receipt => {
  const { outcome, calls } = cleanup(receipt);
  assert.strictEqual(outcome.verified, false);
  assert.deepStrictEqual(calls, []);
}));
test('Fabric rejects storage record tampering without backend actions', () => withReceipt((receipt, lifecycle) => {
  lifecycle.resourceAdmission({ backend: 'lume', storage_path: '/original/vms' });
  const text = fs.readFileSync(receipt.process_receipt.path, 'utf8');
  fs.writeFileSync(receipt.process_receipt.path, text.replace('/original/vms', '/changed/vms'));
  const { outcome, calls } = cleanup(receipt);
  assert.strictEqual(outcome.verified, false);
  assert.deepStrictEqual(calls, []);
}));
test('Fabric rejects missing or malformed admission storage before provisioning', () => withReceipt((_receipt, lifecycle) => {
  for (const storage_path of [undefined, '', null, 'relative', '/bad\npath']) {
    assert.throws(() => lifecycle.resourceAdmission({ backend: 'lume', storage_path }), /storage/i);
  }
}));
test('Fabric refuses storage records for another backend or VM identity', () => withReceipt((receipt, lifecycle) => {
  assert.throws(() => lifecycle.resourceAdmission({ backend: 'lima', storage_path: '/original/vms' }), /identity/i);
  assert.throws(() => lifecycle.resourceCreated({ backend: 'lume', resource: { vm: 'other', storage_path: '/original/vms' } }), /identity/i);
  assert.strictEqual(fs.readFileSync(receipt.process_receipt.path, 'utf8'), '');
}));
test('Fabric legacy receipt without process journal retains legacy cleanup behavior', () => {
  const receipt = createBackendOwnershipReceipt({ backend: 'lume', jobId: 'job_1',
    ownerToken: 'a'.repeat(64), runId: 'run_1234567890abcdef1234567890abcdef' });
  const { outcome, calls } = cleanup(receipt);
  assert.strictEqual(outcome.verified, true);
  assert.ok(calls.every(call => !call.includes('--storage')));
});
test('Fabric mock resource-created event without storage cannot claim a real storage receipt', () => withReceipt((receipt, lifecycle) => {
  lifecycle.resourceCreated({ backend: 'lume', resource: { vm: receipt.resource_name } });
  assert.strictEqual(fs.readFileSync(receipt.process_receipt.path, 'utf8'), '');
}));
console.log(`\n${passed} passed, ${failed} failed`);
process.exitCode = failed ? 1 : 0;
