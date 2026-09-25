'use strict';

const assert = require('assert');

const {
  inspectManagedHookGroups,
  mergeManagedHookGroups,
  uninstallManagedHookGroups,
} = require('../../scripts/lib/install/antigravity-hooks');

const desired = {
  'ecc-security-guard': {
    PreToolUse: [{ matcher: 'run_command', hooks: [{ type: 'command', command: 'node guard.js' }] }],
  },
};

let passed = 0;
let failed = 0;

function test(name, fn) {
  try {
    fn();
    console.log(`  ✓ ${name}`);
    passed++;
  } catch (error) {
    console.log(`  ✗ ${name}`);
    console.log(`    Error: ${error.message}`);
    failed++;
  }
}

console.log('\n=== Antigravity managed hook group tests ===\n');

test('adds ECC groups while preserving user hook groups', () => {
  const current = { 'user-linter': { PostToolUse: [] } };
  const result = mergeManagedHookGroups(current, desired);
  assert.deepStrictEqual(result.config['user-linter'], current['user-linter']);
  assert.deepStrictEqual(result.config['ecc-security-guard'], desired['ecc-security-guard']);
});

test('refuses to overwrite a user-owned group with the ECC name', () => {
  assert.throws(
    () => mergeManagedHookGroups({ 'ecc-security-guard': { enabled: false } }, desired),
    /Refusing to overwrite Antigravity hook group/
  );
});

test('refuses to claim an identical user-owned group', () => {
  assert.throws(
    () => mergeManagedHookGroups(desired, desired),
    /Refusing to overwrite Antigravity hook group/
  );
});

test('rejects groups without a supported hook event', () => {
  assert.throws(
    () => mergeManagedHookGroups({}, { 'ecc-security-guard': { enabled: true } }),
    /expected at least one hook event/
  );
});

test('rejects malformed managed hook entries', () => {
  assert.throws(
    () => mergeManagedHookGroups({}, {
      'ecc-security-guard': {
        PreToolUse: [{ matcher: ' ', hooks: [{ type: 'command', command: 'node guard.js' }] }],
      },
    }),
    /matcher must be a non-empty string/
  );
  assert.throws(
    () => mergeManagedHookGroups({}, {
      'ecc-security-guard': {
        PreToolUse: [{ matcher: 'run_command', hooks: [{ command: 'node guard.js' }] }],
      },
    }),
    /unsupported hook type/
  );
  assert.throws(
    () => mergeManagedHookGroups({}, {
      'ecc-security-guard': {
        PreToolUse: [{
          matcher: 'run_command',
          hooks: [{ type: 'command', command: 'node guard.js', async: true }],
        }],
      },
    }),
    /unsupported property/
  );
});

test('updates an unchanged previously managed group', () => {
  const previous = {
    'ecc-security-guard': {
      PreToolUse: [{ matcher: 'run_command', hooks: [{ type: 'command', command: 'node old-guard.js' }] }],
    },
  };
  const result = mergeManagedHookGroups(previous, desired, { previousManagedHookGroups: previous });
  assert.deepStrictEqual(result.config, desired);
});

test('removes retired unchanged groups and rejects drifted retired groups', () => {
  const previous = {
    ...desired,
    'ecc-retired-guard': {
      Stop: [{ type: 'command', command: 'node retired.js' }],
    },
  };
  const result = mergeManagedHookGroups(previous, desired, { previousManagedHookGroups: previous });
  assert.deepStrictEqual(result.config, desired);

  assert.throws(
    () => mergeManagedHookGroups({
      ...previous,
      'ecc-retired-guard': {
        Stop: [{ type: 'command', command: 'node user-modified.js' }],
      },
    }, desired, { previousManagedHookGroups: previous }),
    /retired Antigravity hook group.*drifted/
  );
});

test('reports missing and drifted managed groups', () => {
  assert.strictEqual(inspectManagedHookGroups({}, desired).status, 'missing');
  assert.strictEqual(
    inspectManagedHookGroups({ 'ecc-security-guard': { enabled: false } }, desired).status,
    'drifted'
  );
});

test('repair restores a drifted managed group and preserves user hooks', () => {
  const current = {
    'ecc-security-guard': { enabled: false },
    'user-linter': { PostToolUse: [] },
  };
  const result = mergeManagedHookGroups(current, desired, {
    previousManagedHookGroups: desired,
    repair: true,
  });
  assert.deepStrictEqual(result.config['ecc-security-guard'], desired['ecc-security-guard']);
  assert.deepStrictEqual(result.config['user-linter'], current['user-linter']);
});

test('repair never overwrites a newly introduced user-owned group', () => {
  assert.throws(
    () => mergeManagedHookGroups({
      'ecc-security-guard': { enabled: false },
    }, desired, { repair: true }),
    /not an unchanged ECC-managed group/
  );
});

test('uninstall removes an unchanged ECC group and preserves user hooks', () => {
  const current = { ...desired, 'user-linter': { PostToolUse: [] } };
  const result = uninstallManagedHookGroups(current, desired);
  assert.deepStrictEqual(result.config, { 'user-linter': { PostToolUse: [] } });
  assert.deepStrictEqual(result.removed, ['ecc-security-guard']);
  assert.deepStrictEqual(result.retained, []);
});

test('uninstall retains a user-modified ECC group', () => {
  const current = { 'ecc-security-guard': { enabled: false } };
  const result = uninstallManagedHookGroups(current, desired);
  assert.deepStrictEqual(result.config, current);
  assert.deepStrictEqual(result.removed, []);
  assert.deepStrictEqual(result.retained, ['ecc-security-guard']);
});

console.log(`\nPassed: ${passed}`);
console.log(`Failed: ${failed}`);
process.exit(failed > 0 ? 1 : 0);
