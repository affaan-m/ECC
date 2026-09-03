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

test('effect fence blocks network modules, fetch, and writes outside the root, and logs each attempt', () => {
  const dir = tempDir('fence');
  try {
    const root = path.join(dir, 'root');
    fs.mkdirSync(root);
    const log = path.join(dir, 'fence.ndjson');
    const script = [
      "const fs = require('fs');",
      "const codes = [];",
      "try { require('https'); } catch (e) { codes.push(e.code); }",
      "try { require('node:net'); } catch (e) { codes.push(e.code); }",
      "try { require('child_process'); } catch (e) { codes.push(e.code); }",
      "try { fs.writeFileSync(require('path').join(process.cwd(), 'inside.txt'), 'ok'); codes.push('inside-ok'); } catch (e) { codes.push('inside-' + e.code); }",
      `try { fs.writeFileSync(${JSON.stringify(path.join(dir, 'outside.txt'))}, 'no'); } catch (e) { codes.push(e.code); }`,
      "Promise.resolve(typeof fetch === 'function' ? fetch('https://example.invalid/').catch((e) => e.code) : 'nofetch').then((c) => { codes.push(c); console.log(JSON.stringify(codes)); });",
    ].join('\n');
    const result = spawnSync(process.execPath, ['--require', replay.EFFECT_FENCE_PRELOAD, '-e', script], {
      cwd: root,
      encoding: 'utf8',
      env: { PATH: process.env.PATH, ECC_EFFECT_FENCE_LOG: log, ECC_EFFECT_FENCE_ROOT: root },
    });
    assert.strictEqual(result.status, 0, result.stderr);
    const codes = JSON.parse(result.stdout.trim());
    assert.deepStrictEqual(codes.slice(0, 5), ['effect.fenced', 'effect.fenced', 'effect.fenced', 'inside-ok', 'effect.fenced']);
    assert.ok(codes[5] === 'effect.fenced' || codes[5] === 'nofetch');
    assert.ok(!fs.existsSync(path.join(dir, 'outside.txt')));
    const events = fs.readFileSync(log, 'utf8').trim().split('\n').map((line) => JSON.parse(line));
    const kinds = events.map((event) => event.kind);
    assert.ok(kinds.includes('module_blocked'));
    assert.ok(kinds.includes('write_outside_root'));
  } finally {
    cleanup(dir);
  }
});

finish('replay');
