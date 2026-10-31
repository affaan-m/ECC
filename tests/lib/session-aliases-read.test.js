'use strict';

const assert = require('assert');
const fs = require('fs');
const os = require('os');
const path = require('path');
const vm = require('vm');

// Use a module-local Windows atomic helper while retaining real filesystem and
// lease operations. This exercises the actual alias transaction entry points.
const helperPath = require.resolve('../../scripts/lib/atomic-write');
const record = { exports: {} };
vm.runInNewContext(fs.readFileSync(helperPath, 'utf8'), {
  module: record, exports: record.exports, require,
  process: { platform: 'win32', pid: process.pid },
  performance, Atomics, SharedArrayBuffer, Int32Array,
}, { filename: helperPath });
require.cache[helperPath] = { id: helperPath, filename: helperPath, loaded: true, exports: record.exports };
const aliases = require('../../scripts/lib/session-aliases');
let passed = 0;
let failed = 0;

function test(name, run) {
  const root = fs.realpathSync(fs.mkdtempSync(path.join(os.tmpdir(), 'ecc-alias-reader-')));
  const keys = ['HOME', 'USERPROFILE', 'ECC_AGENT_DATA_HOME'];
  const saved = Object.fromEntries(keys.map(key => [key, process.env[key]]));
  Object.assign(process.env, { HOME: root, USERPROFILE: root, ECC_AGENT_DATA_HOME: path.join(root, '.claude') });
  try { run(); passed++; console.log(`PASS ${name}`); }
  catch (error) { failed++; console.error(`FAIL ${name}: ${error.stack}`); }
  finally {
    for (const [key, value] of Object.entries(saved)) {
      if (value === undefined) delete process.env[key]; else process.env[key] = value;
    }
    fs.rmSync(root, { recursive: true, force: true });
  }
}

for (const code of ['EPERM', 'EACCES', 'EBUSY']) {
  test(`alias transaction preserves existing entries after a transient ${code} read`, () => {
    aliases.setAlias('preserved', '/original');
    const file = aliases.getAliasesPath();
    const originalRead = fs.readFileSync;
    let attempts = 0;
    fs.readFileSync = function (input) {
      if (input === file && ++attempts === 1) throw Object.assign(new Error('temporary sharing'), { code });
      return originalRead.apply(this, arguments);
    };
    try { assert.strictEqual(aliases.setAlias('added', '/new').success, true); }
    finally { fs.readFileSync = originalRead; }
    assert.strictEqual(aliases.loadAliases().aliases.preserved.sessionPath, '/original');
    assert.strictEqual(aliases.loadAliases().aliases.added.sessionPath, '/new');
    assert.strictEqual(attempts, 2);
    assert.deepStrictEqual(fs.readdirSync(path.dirname(file)), ['session-aliases.json']);
  });

  test(`alias transaction fails closed on a permanent ${code} read and releases its lock`, () => {
    aliases.setAlias('preserved', '/original');
    const file = aliases.getAliasesPath();
    const originalRead = fs.readFileSync;
    const before = originalRead(file, 'utf8');
    const expected = Object.assign(new Error('permanent sharing failure'), { code });
    let attempts = 0;
    fs.readFileSync = function (input) {
      if (input === file) { attempts++; throw expected; }
      return originalRead.apply(this, arguments);
    };
    try { assert.throws(() => aliases.setAlias('added', '/new'), error => error === expected); }
    finally { fs.readFileSync = originalRead; }
    assert.ok(attempts >= 1 && attempts <= 21);
    assert.strictEqual(originalRead(file, 'utf8'), before);
    assert.deepStrictEqual(fs.readdirSync(path.dirname(file)), ['session-aliases.json']);
    assert.strictEqual(aliases.setAlias('after-failure', '/next').success, true);
    assert.strictEqual(aliases.loadAliases().aliases.preserved.sessionPath, '/original');
  });
}

console.log(`Results: Passed: ${passed}, Failed: ${failed}`);
process.exitCode = failed ? 1 : 0;
