/**
 * Tests for the Claude-safe hook registry and ECC-private metadata.
 */

'use strict';

const assert = require('assert');
const fs = require('fs');
const path = require('path');

const repoRoot = path.join(__dirname, '..', '..');
const {
  attachHookMetadata,
  hookMetadata,
  loadHookRegistry,
  stripHookMetadata,
} = require('../../scripts/lib/hook-registry');

function test(name, fn) {
  try {
    fn();
    console.log('  PASS ' + name);
    return true;
  } catch (error) {
    console.log('  FAIL ' + name);
    console.log('    Error: ' + (error.stack || error.message));
    return false;
  }
}

console.log('\n=== Testing hook registry metadata ===\n');

let passed = 0;
let failed = 0;

if (test('keeps Claude hooks.json free of ECC-private matcher keys', () => {
  const config = JSON.parse(fs.readFileSync(path.join(repoRoot, 'hooks', 'hooks.json'), 'utf8'));
  assert.deepStrictEqual(Object.keys(config).sort(), ['description', 'hooks']);
  for (const entries of Object.values(config.hooks)) {
    for (const entry of entries) {
      assert.deepStrictEqual(Object.keys(entry).sort(), ['hooks', 'matcher']);
    }
  }
})) passed++; else failed++;

if (test('attaches stable ids and descriptions from official status messages', () => {
  const config = loadHookRegistry(repoRoot);
  const entries = Object.values(config.hooks).flat();
  assert.ok(entries.length > 0);
  assert.ok(entries.every(entry => typeof entry.id === 'string' && entry.id));
  assert.ok(entries.every(entry => typeof entry.description === 'string' && entry.description));
  assert.strictEqual(new Set(entries.map(entry => entry.id)).size, entries.length);
})) passed++; else failed++;

if (test('reads identities from official handler statusMessage fields', () => {
  const entry = {
    hooks: [{ type: 'command', command: 'node hook.js', statusMessage: '[ECC:stop:test] Running test hook' }],
  };
  assert.deepStrictEqual(hookMetadata(entry), { id: 'stop:test', description: 'Running test hook' });
})) passed++; else failed++;

if (test('skips malformed handlers while recovering a later status identity', () => {
  const entry = {
    hooks: [
      null,
      { type: 'command', command: 'node hook.js', statusMessage: '[ECC:stop:test] Running test hook' },
    ],
  };
  assert.deepStrictEqual(hookMetadata(entry), { id: 'stop:test', description: 'Running test hook' });
})) passed++; else failed++;

if (test('rejects missing and duplicate status identities', () => {
  const missing = { hooks: { Stop: [{ matcher: '.*', hooks: [{ type: 'command', command: 'ok' }] }] } };
  assert.throws(
    () => attachHookMetadata(missing),
    /statusMessage/
  );
  const duplicate = { hooks: {
    PreToolUse: [{ matcher: 'Write', hooks: [{ type: 'command', command: 'one', statusMessage: '[ECC:shared] One' }] }],
    PostToolUse: [{ matcher: 'Write', hooks: [{ type: 'command', command: 'two', statusMessage: '[ECC:shared] Two' }] }],
  } };
  assert.throws(
    () => attachHookMetadata(duplicate),
    /Duplicate ECC hook id/
  );
})) passed++; else failed++;

if (test('strips ECC metadata without mutating managed entries', () => {
  const managed = {
    Stop: [{
      id: 'stop:test',
      description: 'Test hook',
      matcher: '.*',
      hooks: [{
        type: 'command',
        command: 'node stop.js',
        statusMessage: '[ECC:stop:test] Test hook',
      }],
    }],
  };
  const stripped = stripHookMetadata(managed);
  assert.deepStrictEqual(stripped, {
    Stop: [{
      matcher: '.*',
      hooks: [{
        type: 'command',
        command: 'node stop.js',
        statusMessage: '[ECC:stop:test] Test hook',
      }],
    }],
  });
  assert.strictEqual(managed.Stop[0].id, 'stop:test');
})) passed++; else failed++;

console.log('\nPassed: ' + passed);
console.log('Failed: ' + failed);
process.exit(failed > 0 ? 1 : 0);
