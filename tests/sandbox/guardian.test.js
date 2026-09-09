'use strict';

const assert = require('assert');
const fs = require('fs');
const os = require('os');
const path = require('path');
const { cleanupOwnedResource, guardSession } = require('../../scripts/sandbox/guardian');
const { createRun, writeResource, readResources, readRun, updateState } = require('../../scripts/sandbox/session-store');
const { limaMissingInstance } = require('../../scripts/sandbox/backends/lima');

let passed = 0;
let failed = 0;
function test(name, fn) {
  try { fn(); console.log(`  ✓ ${name}`); passed += 1; }
  catch (error) { console.error(`  ✗ ${name}\n${error.stack}`); failed += 1; }
}
function recovery(resource, backendResult) {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'ecc-guardian-storage-test-'));
  try {
    const created = createRun({ root, manifestPath: '/fixture/sandbox.yaml',
      manifestDigest: 'a'.repeat(64), route: { backend: 'lume', tier: 2, os: 'macos', arch: 'arm64' } });
    writeResource(created.run_id, root, {
      kind: 'lume', name: 'ecc-owned', seed: 'seed', owner_token: created.session.owner_token, ...resource,
    });
    const calls = [];
    const outcome = cleanupOwnedResource(created.run_id, root, {
      run: (binary, argv) => {
        calls.push([binary, ...argv]);
        if (backendResult) return backendResult(argv);
        if (argv[0] === 'get' && calls.some(call => call[1] === 'delete')) {
          return { status: 1, stderr: 'virtual machine not found' };
        }
        return { status: 0, stdout: JSON.stringify([{ name: 'ecc-owned', ipAddress: '192.0.2.1', status: 'stopped' }]) };
      },
      signal: () => { throw new Error('unexpected host signal'); },
    });
    return { outcome, calls, retained: readResources(created.run_id, root) };
  } finally { fs.rmSync(root, { recursive: true, force: true }); }
}

test('guardian recovers exact Lume guest through its persisted storage after defaults change', () => {
  const { outcome, calls, retained } = recovery({ storage_path: '/volume/original vms', guest_marker: { guestAddress: '192.0.2.1' } });
  assert.strictEqual(outcome.cleaned, true);
  assert.deepStrictEqual(calls, [
    ['lume', 'get', 'ecc-owned', '--format', 'json', '--storage', '/volume/original vms'],
    ['lume', 'stop', 'ecc-owned', '--storage', '/volume/original vms'],
    ['lume', 'get', 'ecc-owned', '--format', 'json', '--storage', '/volume/original vms'],
    ['lume', 'delete', 'ecc-owned', '--force', '--storage', '/volume/original vms'],
    ['lume', 'get', 'ecc-owned', '--format', 'json', '--storage', '/volume/original vms'],
  ]);
  assert.deepStrictEqual(retained, []);
});
test('guardian supports legacy Lume receipts without a storage field', () => {
  const { outcome, calls } = recovery({});
  assert.strictEqual(outcome.cleaned, true);
  assert.deepStrictEqual(calls[0], ['lume', 'get', 'ecc-owned', '--format', 'json']);
  assert.ok(calls.every(call => !call.includes('--storage')));
});
for (const storage_path of ['', null, 'relative', '/bad\npath', '/bad\0path']) {
  test(`guardian refuses malformed explicit storage ${JSON.stringify(storage_path)} without backend actions`, () => {
    const { outcome, calls, retained } = recovery({ storage_path });
    assert.strictEqual(outcome.cleaned, false);
    assert.match(outcome.error, /storage/i);
    assert.deepStrictEqual(calls, []);
    assert.strictEqual(retained.length, 1);
  });
}
test('guardian retains bound-storage receipt when VM name differs', () => {
  const { outcome, calls, retained } = recovery({ storage_path: '/volume/vms' },
    () => ({ status: 0, stdout: JSON.stringify([{ name: 'someone-else' }]) }));
  assert.strictEqual(outcome.cleaned, false);
  assert.strictEqual(calls.length, 1);
  assert.strictEqual(retained.length, 1);
});
test('guardian retains bound-storage receipt when guest address differs', () => {
  const { outcome, calls, retained } = recovery({ storage_path: '/volume/vms', guest_marker: { guestAddress: '192.0.2.2' } });
  assert.strictEqual(outcome.cleaned, false);
  assert.strictEqual(calls.length, 1);
  assert.strictEqual(retained.length, 1);
});
test('guardian missing VM check stays bound to recorded storage', () => {
  const { outcome, calls, retained } = recovery({ storage_path: '/volume/vms' },
    () => ({ status: 1, stderr: 'no virtual machine found' }));
  assert.strictEqual(outcome.cleaned, true);
  assert.deepStrictEqual(calls, [['lume', 'get', 'ecc-owned', '--format', 'json', '--storage', '/volume/vms']]);
  assert.deepStrictEqual(retained, []);
});
test('guardian retains VM when stopped state remains running after stop', () => {
  const { outcome, calls, retained } = recovery({ storage_path: '/volume/vms' },
    () => ({ status: 0, stdout: JSON.stringify([{ name: 'ecc-owned', status: 'running' }]) }));
  assert.strictEqual(outcome.cleaned, false);
  assert.ok(calls.every(call => call[1] !== 'delete'));
  assert.strictEqual(retained.length, 1);
});
test('guardian retains VM when successful deletion lacks verified absence', () => {
  const { outcome, calls, retained } = recovery({ storage_path: '/volume/vms' },
    () => ({ status: 0, stdout: JSON.stringify([{ name: 'ecc-owned', status: 'stopped' }]) }));
  assert.strictEqual(outcome.cleaned, false);
  assert.ok(calls.some(call => call[1] === 'delete'));
  assert.strictEqual(retained.length, 1);
});
test('guardian accepts failed stop only when the exact guest is already verified stopped', () => {
  let deleted = false;
  const { outcome } = recovery({ storage_path: '/volume/vms' }, argv => {
    if (argv[0] === 'stop') return { status: 1, stderr: 'already stopped' };
    if (argv[0] === 'delete') deleted = true;
    if (argv[0] === 'get' && deleted) return { status: 1, stderr: 'virtual machine not found' };
    return { status: 0, stdout: JSON.stringify([{ name: 'ecc-owned', status: 'stopped' }]) };
  });
  assert.strictEqual(outcome.cleaned, true);
});
test('guardian refuses timed-out missing diagnostics and ambiguous stopped identities', () => {
  const responses = [
    { status: 1, stderr: 'virtual machine not found', error: new Error('timeout') },
    { status: 1, stderr: 'virtual machine not found', signal: 'SIGTERM' },
    { status: 0, stdout: JSON.stringify([{ name: 'ecc-owned', status: 'running' }, { name: 'other', status: 'stopped' }]) },
  ];
  for (const response of responses) {
    const { outcome, calls, retained } = recovery({ storage_path: '/volume/vms' }, () => response);
    assert.strictEqual(outcome.cleaned, false);
    assert.ok(calls.every(call => call[1] !== 'delete'));
    assert.strictEqual(retained.length, 1);
  }
});
test('guardian recognizes an already absent Lima instance from successful empty inventory', () => {
  const { outcome, calls, retained } = recovery({ kind: 'lima', name: 'ecc-lima-owned' },
    () => ({ status: 0, stdout: '[]' }));
  assert.strictEqual(outcome.cleaned, true);
  assert.strictEqual(calls.length, 1);
  assert.strictEqual(calls[0][0], 'limactl');
  assert.deepStrictEqual(retained, []);
});
test('Lima absence parser refuses ambiguous, malformed and interrupted inventories', () => {
  for (const response of [
    null, {}, { status: 0, stdout: 'null' }, { status: 0, stdout: '{}' },
    { status: 0, stdout: '[{}]' }, { status: 0, stdout: 'invalid' },
    { status: 0, stdout: '[]', error: new Error('timeout') },
    { status: 0, stdout: '[]', signal: 'SIGTERM' },
    { status: 1, stderr: 'no instance found', error: new Error('ENOENT') },
  ]) assert.strictEqual(limaMissingInstance(response), false);
  assert.strictEqual(limaMissingInstance({ status: 0, stdout: '[]' }), true);
  assert.strictEqual(limaMissingInstance({ status: 1, stderr: 'instance does not exist' }), true);
});

function withGuardedSession(fn) {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'ecc-guarded-session-test-'));
  try {
    const created = createRun({ root, manifestPath: '/fixture/sandbox.yaml', manifestDigest: 'b'.repeat(64),
      route: { backend: 'lume', tier: 2, os: 'macos', arch: 'arm64' } });
    const runId = created.run_id;
    updateState(runId, root, { status: 'executing', supervisor_pid: 71000 });
    writeResource(runId, root, { kind: 'lume', name: 'ecc-orphan', seed: 'seed',
      storage_path: '/original/vms', owner_token: created.session.owner_token });
    fn({ root, runId, created });
  } finally { fs.rmSync(root, { recursive: true, force: true }); }
}

test('guardian waits for confirmed supervisor death before recovering its exact owned VM', () => withGuardedSession(({ root, runId }) => {
  const alive = [true, false, true, false, false];
  const calls = [];
  let removed = false;
  const outcome = guardSession(runId, root, {
    pidIsAlive: pid => { assert.strictEqual(pid, 71000); return alive.shift() ?? false; },
    sleep: () => assert.strictEqual(calls.length, 0, 'cleanup must wait until supervisor death is confirmed'),
    run: (binary, argv) => {
      assert.strictEqual(alive.length, 0);
      assert.strictEqual(binary, 'lume');
      assert.deepStrictEqual(argv.slice(-2), ['--storage', '/original/vms']);
      calls.push(argv);
      if (argv[0] === 'delete') removed = true;
      if (argv[0] === 'get' && removed) return { status: 1, stderr: 'virtual machine not found' };
      return { status: 0, stdout: JSON.stringify([{ name: 'ecc-orphan', status: 'stopped' }]) };
    },
  });
  assert.strictEqual(outcome.guarded, true);
  assert.strictEqual(outcome.cleaned, true);
  assert.ok(calls.some(argv => argv[0] === 'delete'));
  assert.deepStrictEqual(readResources(runId, root), []);
  const { state } = readRun(runId, root);
  assert.strictEqual(state.status, 'recovered');
  assert.strictEqual(state.cleanup_recovered, true);
  assert.strictEqual(state.cleanup_error, null);
}));

test('guardian retries a temporary backend outage and preserves a completed run after verified cleanup', () => withGuardedSession(({ root, runId }) => {
  updateState(runId, root, { status: 'completed' });
  let unavailable = true;
  let removed = false;
  let retried = false;
  const outcome = guardSession(runId, root, {
    pidIsAlive: () => false,
    sleep: () => {
      const { state } = readRun(runId, root);
      if (state.cleanup_error) {
        assert.strictEqual(state.cleanup_recovered, false);
        assert.strictEqual(readResources(runId, root).length, 1);
        unavailable = false;
        retried = true;
      }
    },
    run: (_binary, argv) => {
      if (unavailable) return { status: 1, stderr: 'backend temporarily unavailable' };
      if (argv[0] === 'delete') removed = true;
      if (argv[0] === 'get' && removed) return { status: 1, stderr: 'virtual machine not found' };
      return { status: 0, stdout: JSON.stringify([{ name: 'ecc-orphan', status: 'stopped' }]) };
    },
  });
  assert.strictEqual(retried, true);
  assert.strictEqual(outcome.cleaned, true);
  assert.deepStrictEqual(readResources(runId, root), []);
  const { state } = readRun(runId, root);
  assert.strictEqual(state.status, 'completed');
  assert.strictEqual(state.cleanup_recovered, true);
  assert.strictEqual(state.error, null);
  assert.strictEqual(state.cleanup_error, null);
}));

test('guardian bounds failed recovery attempts and retains a running VM receipt with actionable error', () => withGuardedSession(({ root, runId, created }) => {
  const calls = [];
  const outcome = guardSession(runId, root, {
    pidIsAlive: () => false,
    sleep: () => {},
    run: (_binary, argv) => {
      calls.push(argv);
      assert.ok(calls.length <= 12, 'recovery must stop after bounded retries');
      return { status: 0, stdout: JSON.stringify([{ name: 'ecc-orphan', status: 'running' }]) };
    },
  });
  assert.strictEqual(outcome.cleaned, false);
  assert.ok(calls.filter(argv => argv[0] === 'stop').length > 1);
  assert.ok(calls.every(argv => argv[0] !== 'delete'));
  const resources = readResources(runId, root);
  assert.strictEqual(resources.length, 1);
  assert.strictEqual(resources[0].owner_token, created.session.owner_token);
  assert.strictEqual(resources[0].storage_path, '/original/vms');
  const { state } = readRun(runId, root);
  assert.strictEqual(state.status, 'error');
  assert.strictEqual(state.cleanup_recovered, false);
  assert.match(state.cleanup_error, /stopped state.*verified/i);
  assert.strictEqual(state.error, state.cleanup_error);
}));
console.log(`\n${passed} passed, ${failed} failed`);
process.exitCode = failed ? 1 : 0;
