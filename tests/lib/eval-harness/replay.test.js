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

test('an interrupted recording preserves the prior replayable fixture', () => {
  const dir = tempDir('interrupted-record');
  const write = fs.writeFileSync;
  try {
    const store = new replay.FixtureStore(dir);
    const existing = store.put('read_inventory', { sku: 'x' }, { count: 1 });
    const before = fs.readFileSync(store.pathFor(existing.key));
    fs.writeFileSync = (destination, data) => {
      // Atomic publication writes through an already-owned descriptor.
      assert.strictEqual(typeof destination, 'number');
      fs.writeSync(destination, data.slice(0, 10), undefined, 'utf8');
      throw Object.assign(new Error('disk full'), { code: 'ENOSPC' });
    };
    try {
      assert.throws(() => store.put('read_inventory', { sku: 'x' }, { count: 2 }), { code: 'ENOSPC' });
    } finally {
      fs.writeFileSync = write;
    }
    assert.deepStrictEqual(fs.readFileSync(store.pathFor(existing.key)), before);
    assert.deepStrictEqual(store.get('read_inventory', { sku: 'x' }).response, { count: 1 });
    assert.deepStrictEqual(fs.readdirSync(dir), [existing.key + '.json']);
  } finally {
    cleanup(dir);
  }
});

test('Date arguments key distinct fixtures and replay the recorded JSON response', () => {
  const dir = tempDir('replay-date');
  try {
    const store = new replay.FixtureStore(dir);
    let liveCalls = 0;
    const dated = { prices: { effect_class: 'SE0', determinism: 'deterministic', impl: (args) => {
      liveCalls += 1;
      return { since: args.since, close: args.since.getUTCFullYear() === 2024 ? 100 : 999 };
    } } };
    const live = replay.createReplayer(dated, { mode: 'record', store }).call('prices', { since: new Date('2024-01-01T00:00:00.000Z') });
    const replayer = replay.createReplayer(dated, { mode: 'replay', store });
    assert.throws(() => replayer.call('prices', { since: new Date('2025-06-01T00:00:00.000Z') }), (error) => error.code === 'tool.fixture_missing');
    assert.throws(() => replayer.call('prices', { since: {} }), (error) => error.code === 'tool.fixture_missing');
    const replayed = replayer.call('prices', { since: new Date('2024-01-01T00:00:00.000Z') });
    assert.deepStrictEqual(replayed, JSON.parse(JSON.stringify(live)));
    assert.strictEqual(replayed.since, '2024-01-01T00:00:00.000Z');
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

for (const [label, change, code] of [
  ['changed key', record => ({ ...record, key: '0'.repeat(64) }), 'tool.fixture_mismatch'],
  ['missing key', ({ key: _key, ...record }) => record, 'tool.fixture_corrupt'],
  ['null record', () => null, 'tool.fixture_corrupt'],
  ['array record', () => [], 'tool.fixture_corrupt'],
  ['missing response', ({ response: _response, ...record }) => record, 'tool.fixture_corrupt'],
  ['invalid response hash', record => ({ ...record, response_hash: 123 }), 'tool.fixture_corrupt'],
]) {
  test(`replay rejects ${label} before returning a response or emitting success`, () => {
    const dir = tempDir('fixture-validation');
    try {
      const store = new replay.FixtureStore(dir);
      const args = { sku: 'x' };
      const record = store.put('read_inventory', args, { count: 7 });
      const file = store.pathFor(record.key);
      fs.writeFileSync(file, JSON.stringify(change(record)));
      const before = fs.readFileSync(file);
      let liveCalls = 0;
      const trace = [];
      const replayer = replay.createReplayer({ read_inventory: {
        ...tools.read_inventory,
        impl() { liveCalls += 1; throw new Error('must not call'); },
      } }, { store, onCall: entry => trace.push(entry) });

      assert.throws(() => replayer.call('read_inventory', args), error =>
        error instanceof replay.ReplayError && error.code === code);
      assert.strictEqual(liveCalls, 0);
      assert.deepStrictEqual(replayer.calls, []);
      assert.deepStrictEqual(trace, []);
      assert.deepStrictEqual(fs.readFileSync(file), before);
    } finally { cleanup(dir); }
  });
}

test('valid JSON scalar and array responses still replay with the verified fixture key', () => {
  const dir = tempDir('fixture-responses');
  try {
    const store = new replay.FixtureStore(dir);
    const replayer = replay.createReplayer(tools, { store });
    for (const response of [null, false, 0, '', [1, { count: 7 }]]) {
      const record = store.put('read_inventory', {}, response);
      assert.deepStrictEqual(replayer.call('read_inventory'), response);
      assert.strictEqual(replayer.calls.at(-1).fixture_key, record.key);
    }
  } finally { cleanup(dir); }
});

test('record snapshots a key-sensitive response once and replays only its stored JSON', () => {
  const dir = tempDir('response-json-snapshot');
  try {
    const store = new replay.FixtureStore(dir);
    const seen = [];
    const response = { toJSON(key) { seen.push(key); return { holder: key, generation: seen.length }; } };
    let liveCalls = 0;
    const declared = { custom: { effect_class: 'SE0', determinism: 'deterministic', impl() {
      liveCalls += 1;
      return response;
    } } };
    const recorder = replay.createReplayer(declared, { mode: 'record', store });
    assert.strictEqual(recorder.call('custom', {}), response, 'Live callers retain their original return value');
    assert.deepStrictEqual(seen, ['']);
    const replayer = replay.createReplayer(declared, { store });
    assert.deepStrictEqual(replayer.call('custom', {}), { holder: '', generation: 1 });
    assert.strictEqual(liveCalls, 1);
    assert.deepStrictEqual(seen, [''], 'Reading the fixture cannot rerun the response serializer');
    const file = store.pathFor(recorder.calls[0].fixture_key);
    const record = JSON.parse(fs.readFileSync(file, 'utf8'));
    record.response.holder = 'response';
    fs.writeFileSync(file, JSON.stringify(record));
    const refused = replay.createReplayer(declared, { store });
    assert.throws(() => refused.call('custom', {}), error => error.code === 'tool.fixture_mismatch');
    assert.deepStrictEqual(refused.calls, []);
    assert.strictEqual(liveCalls, 1);
  } finally { cleanup(dir); }
});

test('key-sensitive request serializers use the same root snapshot for recording and replay', () => {
  const dir = tempDir('request-json-snapshot');
  try {
    const store = new replay.FixtureStore(dir);
    const recordedKeys = [];
    const args = { toJSON(key) { recordedKeys.push(key); return { holder: key, sku: 'x' }; } };
    let liveCalls = 0;
    const declared = { custom: { effect_class: 'SE0', determinism: 'deterministic', impl(input) {
      assert.strictEqual(input, args, 'Live implementations retain the original arguments');
      liveCalls += 1;
      return { count: 7 };
    } } };
    const recorder = replay.createReplayer(declared, { mode: 'record', store });
    recorder.call('custom', args);
    assert.deepStrictEqual(recordedKeys, ['']);
    const replayedKeys = [];
    const request = { toJSON(key) { replayedKeys.push(key); return { holder: key, sku: 'x' }; } };
    const replayer = replay.createReplayer(declared, { store });
    assert.deepStrictEqual(replayer.call('custom', request), { count: 7 });
    assert.deepStrictEqual(replayedKeys, ['']);
    assert.strictEqual(replayer.calls[0].fixture_key, recorder.calls[0].fixture_key);
    assert.strictEqual(liveCalls, 1);
  } finally { cleanup(dir); }
});

test('direct fixture methods serialize request identity once at the JSON root', () => {
  const dir = tempDir('direct-request-json');
  try {
    const store = new replay.FixtureStore(dir);
    const seen = [];
    const request = { toJSON(key) { seen.push(key); return { holder: key }; } };
    const expectedKey = store.key('custom', { holder: '' });
    assert.strictEqual(store.key('custom', request), expectedKey);
    const record = store.put('custom', request, { count: 7 });
    assert.strictEqual(record.key, expectedKey);
    assert.strictEqual(store.has('custom', request), true);
    assert.deepStrictEqual(store.get('custom', request).response, { count: 7 });
    assert.deepStrictEqual(seen, ['', '', '', '']);
  } finally { cleanup(dir); }
});

test('failed response serialization preserves the existing fixture and emits no success', () => {
  const dir = tempDir('failed-response-json');
  try {
    const store = new replay.FixtureStore(dir);
    const original = store.put('custom', {}, { count: 7 });
    const file = store.pathFor(original.key);
    const before = fs.readFileSync(file);
    const cycle = {}; cycle.self = cycle;
    const failure = new Error('response serializer failed');
    for (const response of [undefined, () => 1, Symbol('response'), 1n, cycle,
      { toJSON() { return undefined; } }, { toJSON() { throw failure; } }]) {
      const recorder = replay.createReplayer({ custom: {
        effect_class: 'SE0', determinism: 'deterministic', impl() { return response; },
      } }, { mode: 'record', store });
      assert.throws(() => recorder.call('custom', {}));
      assert.deepStrictEqual(recorder.calls, []);
      assert.deepStrictEqual(fs.readFileSync(file), before);
      assert.deepStrictEqual(fs.readdirSync(dir), [original.key + '.json']);
    }
    assert.deepStrictEqual(store.get('custom', {}).response, { count: 7 });
  } finally { cleanup(dir); }
});

test('failed request serialization refuses before invoking a live tool', () => {
  const dir = tempDir('failed-request-json');
  try {
    const store = new replay.FixtureStore(dir);
    let liveCalls = 0;
    const recorder = replay.createReplayer({ custom: {
      effect_class: 'SE0', determinism: 'deterministic', impl() { liveCalls += 1; },
    } }, { mode: 'record', store });
    const cycle = {}; cycle.self = cycle;
    for (const args of [() => 1, Symbol('request'), 1n, cycle,
      { toJSON() { return undefined; } }, { toJSON() { throw new Error('request serializer failed'); } }]) {
      assert.throws(() => recorder.call('custom', args));
    }
    assert.strictEqual(liveCalls, 0);
    assert.deepStrictEqual(recorder.calls, []);
    assert.deepStrictEqual(fs.readdirSync(dir), []);
  } finally { cleanup(dir); }
});

finish('replay');
