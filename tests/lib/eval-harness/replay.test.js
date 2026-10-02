/**
 * Tests for scripts/lib/eval-harness/replay.js and effect-fence.js
 * Run with: node tests/lib/eval-harness/replay.test.js
 */
'use strict';

const assert = require('assert');
const fs = require('fs');
const path = require('path');
const { spawnSync } = require('child_process');
const replay = require('../../../scripts/lib/eval-harness/replay');
const { test, tempDir, cleanup, finish } = require('./helpers');

console.log('\n=== eval-harness replay ===\n');

const tools = {
  read_inventory: { effect_class: 'SE0', determinism: 'deterministic', impl: (args) => ({ sku: args.sku, count: 7 }) },
  write_note: { effect_class: 'SE1', determinism: 'deterministic', impl: () => ({ ok: true }) },
  publish: { effect_class: 'SE3', determinism: 'nondeterministic', impl: () => ({ ok: true }) },
  charge_card: { effect_class: 'SE4', determinism: 'nondeterministic', impl: () => { throw new Error('never'); } },
};

test('record mode stores content-addressed fixtures with arg and response hashes', () => {
  const dir = tempDir('record');
  try {
    const store = new replay.FixtureStore(dir);
    const recorder = replay.createReplayer(tools, { mode: 'record', store });
    const response = recorder.call('read_inventory', { sku: 'x' });
    assert.strictEqual(response.count, 7);
    assert.ok(store.has('read_inventory', { sku: 'x' }));
    const record = store.get('read_inventory', { sku: 'x' });
    assert.strictEqual(record.tool, 'read_inventory');
    assert.strictEqual(recorder.calls[0].status, 'recorded');
  } finally {
    cleanup(dir);
  }
});

test('replay mode never calls the implementation and fails closed on a missing fixture', () => {
  const dir = tempDir('replay');
  try {
    const store = new replay.FixtureStore(dir);
    let liveCalls = 0;
    const spyTools = { ...tools, read_inventory: { ...tools.read_inventory, impl: () => { liveCalls += 1; return { count: 7 }; } } };
    replay.createReplayer(spyTools, { mode: 'record', store }).call('read_inventory', { sku: 'x' });
    assert.strictEqual(liveCalls, 1);
    const replayer = replay.createReplayer(spyTools, { mode: 'replay', store });
    assert.strictEqual(replayer.call('read_inventory', { sku: 'x' }).count, 7);
    assert.throws(() => replayer.call('read_inventory', { sku: 'missing' }), (error) => error.code === 'tool.fixture_missing');
    assert.strictEqual(liveCalls, 1);
  } finally {
    cleanup(dir);
  }
});

test('a hash-mismatched or corrupt fixture fails closed', () => {
  const dir = tempDir('mismatch');
  try {
    const store = new replay.FixtureStore(dir);
    const record = store.put('read_inventory', { sku: 'x' }, { count: 1 });
    const filePath = store.pathFor(record.key);
    const tampered = JSON.parse(fs.readFileSync(filePath, 'utf8'));
    tampered.response.count = 999;
    fs.writeFileSync(filePath, JSON.stringify(tampered));
    assert.throws(() => store.get('read_inventory', { sku: 'x' }), (error) => error.code === 'tool.fixture_mismatch');
    fs.writeFileSync(filePath, '{not json');
    assert.throws(() => store.get('read_inventory', { sku: 'x' }), (error) => error.code === 'tool.fixture_corrupt');
  } finally {
    cleanup(dir);
  }
});

test('SE3 and above are refused in replay, and anything above maxEffectClass is refused in record', () => {
  const dir = tempDir('effects');
  try {
    const store = new replay.FixtureStore(dir);
    const replayer = replay.createReplayer(tools, { mode: 'replay', store, maxEffectClass: 'SE4' });
    assert.throws(() => replayer.call('publish', {}), (error) => error.code === 'tool.effect_forbidden');
    assert.throws(() => replayer.call('charge_card', {}), (error) => error.code === 'tool.effect_forbidden');
    const recorder = replay.createReplayer(tools, { mode: 'record', store, maxEffectClass: 'SE0' });
    assert.throws(() => recorder.call('write_note', {}), (error) => error.code === 'tool.effect_forbidden');
    assert.throws(() => recorder.call('nope', {}), (error) => error.code === 'tool.unknown');
  } finally {
    cleanup(dir);
  }
});

test('tools must declare effect_class and determinism', () => {
  const dir = tempDir('declare');
  try {
    const store = new replay.FixtureStore(dir);
    assert.throws(() => replay.createReplayer({ bad: { impl: () => 1 } }, { mode: 'replay', store }), /effect_class/);
    assert.throws(() => replay.createReplayer({ bad: { effect_class: 'SE0', impl: () => 1 } }, { mode: 'replay', store }), /determinism/);
  } finally {
    cleanup(dir);
  }
});

test('retired effect preload refuses before any supplied code runs', () => {
  const dir = tempDir('fence');
  try {
    const canary = path.join(dir, 'executed');
    const result = spawnSync(process.execPath, ['--require', replay.EFFECT_FENCE_PRELOAD, '-e',
      `require('fs').writeFileSync(${JSON.stringify(canary)}, 'executed');`], {
      cwd: dir, encoding: 'utf8', timeout: 2000,
      env: { ECC_EFFECT_FENCE_ROOT: dir },
    });
    assert.notStrictEqual(result.status, 0);
    assert.match(result.stderr, /gate.isolation_required/);
    assert.ok(!fs.existsSync(canary));
  } finally {
    cleanup(dir);
  }
});


test('own-key arguments cannot alias another replay fixture or fall back to a legacy key', () => {
  const dir = tempDir('own-key');
  try {
    const store = new replay.FixtureStore(dir);
    const args = JSON.parse('{"__proto__":{"marker":"fixture"}}');
    const legacy = store.put('read_inventory', {}, { count: 7 });
    const before = fs.readFileSync(store.pathFor(legacy.key));
    assert.notStrictEqual(store.key('read_inventory', args), legacy.key);
    let calls = 0;
    const replayer = replay.createReplayer({ read_inventory: { effect_class: 'SE0', determinism: 'deterministic', impl() { calls += 1; throw new Error('must not call'); } } }, { mode: 'replay', store });
    assert.throws(() => replayer.call('read_inventory', args), error => error.code === 'tool.fixture_missing');
    assert.strictEqual(calls, 0);
    assert.deepStrictEqual(fs.readFileSync(store.pathFor(legacy.key)), before);
    assert.deepStrictEqual(fs.readdirSync(dir), [legacy.key + '.json']);
    store.put('read_inventory', args, { count: 9 });
    assert.strictEqual(replayer.call('read_inventory', args).count, 9);
    assert.strictEqual(replayer.call('read_inventory', {}).count, 7);
    assert.strictEqual(calls, 0);
  } finally { cleanup(dir); }
});

test('nested own-key response survives persistence and tampering fails closed', () => {
  const dir = tempDir('own-response');
  try {
    const store = new replay.FixtureStore(dir);
    const response = JSON.parse('{"items":[{"__proto__":{"count":7}}]}');
    const record = store.put('read_inventory', {}, response);
    assert.deepStrictEqual(store.get('read_inventory', {}).response, response);
    const file = store.pathFor(record.key);
    const tampered = JSON.parse(fs.readFileSync(file, 'utf8'));
    tampered.response.items[0].__proto__.count = 9;
    fs.writeFileSync(file, JSON.stringify(tampered));
    const before = fs.readFileSync(file);
    assert.throws(() => store.get('read_inventory', {}), error => error.code === 'tool.fixture_mismatch');
    assert.deepStrictEqual(fs.readFileSync(file), before);
  } finally { cleanup(dir); }
});

test('ordinary fixture bytes and key remain identical to the pinned base', () => {
  const dir = tempDir('base-fixture');
  try {
    const store = new replay.FixtureStore(dir);
    const record = store.put('read_inventory', { sku: 'x' }, { count: 7 });
    assert.strictEqual(record.key, "38531922cfce2687a257eebffffa3fa9ef03b132f862fff9e371cab0bf2391ef");
    assert.strictEqual(fs.readFileSync(store.pathFor(record.key), 'utf8'), "{\"args_hash\":\"90765859d73de6e117260f0b4cefcb88f09d8e79e71ca576868a28d662f98851\",\"key\":\"38531922cfce2687a257eebffffa3fa9ef03b132f862fff9e371cab0bf2391ef\",\"response\":{\"count\":7},\"response_hash\":\"b0beaf5a3dbe82ae841ac88bdc3b1174d7e4dec57454b6539e556e58eaadc600\",\"tool\":\"read_inventory\"}\n");
  } finally { cleanup(dir); }
});

finish('replay');
