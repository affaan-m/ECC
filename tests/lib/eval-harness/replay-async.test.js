'use strict';

const assert = require('assert');
const fs = require('fs');
const replay = require('../../../scripts/lib/eval-harness/replay');
const { asyncTest, tempDir, cleanup, finish } = require('./helpers');

async function main() {
  console.log('\n=== eval-harness async replay ===\n');

  await asyncTest('record waits for an async tool before persisting its resolved response', async () => {
    const dir = tempDir('async-record');
    try {
      const store = new replay.FixtureStore(dir);
      const args = { sku: 'x' };
      const response = { sku: 'x', count: 7 };
      const trace = [];
      let complete;
      let liveCalls = 0;
      const tools = { read_inventory: {
        effect_class: 'SE0', determinism: 'deterministic',
        impl() { liveCalls += 1; return new Promise(resolve => { complete = resolve; }); }
      } };
      const recorder = replay.createReplayer(tools, { mode: 'record', store, onCall: entry => trace.push(entry) });
      const pending = recorder.call('read_inventory', args);

      assert.strictEqual(store.has('read_inventory', args), false, 'Pending response is not a fixture');
      assert.deepStrictEqual(recorder.calls, [], 'Pending response is not a successful call');
      assert.deepStrictEqual(trace, []);
      complete(response);

      assert.deepStrictEqual(await pending, response);
      assert.deepStrictEqual(store.get('read_inventory', args).response, response);
      assert.strictEqual(recorder.calls.length, 1);
      assert.strictEqual(recorder.calls[0].status, 'recorded');
      assert.deepStrictEqual(trace, recorder.calls);

      const replayer = replay.createReplayer(tools, { mode: 'replay', store });
      assert.deepStrictEqual(replayer.call('read_inventory', args), response);
      assert.strictEqual(liveCalls, 1, 'Replay must not call the live async implementation');
    } finally { cleanup(dir); }
  });

  await asyncTest('async rejection preserves the error without creating a successful fixture or trace', async () => {
    const dir = tempDir('async-rejection');
    try {
      const store = new replay.FixtureStore(dir);
      const failure = new Error('inventory request failed');
      const trace = [];
      const tools = { read_inventory: {
        effect_class: 'SE0', determinism: 'nondeterministic',
        async impl() { throw failure; }
      } };
      const recorder = replay.createReplayer(tools, { mode: 'record', store, onCall: entry => trace.push(entry) });
      await assert.rejects(recorder.call('read_inventory', {}), error => error === failure);
      assert.deepStrictEqual(fs.readdirSync(dir), []);
      assert.deepStrictEqual(recorder.calls, []);
      assert.deepStrictEqual(trace, []);
      const replayer = replay.createReplayer(tools, { mode: 'replay', store });
      assert.throws(() => replayer.call('read_inventory', {}), error => error.code === 'tool.fixture_missing');
    } finally { cleanup(dir); }
  });

  await asyncTest('a failed async refresh leaves an existing fixture unchanged', async () => {
    const dir = tempDir('async-refresh');
    try {
      const store = new replay.FixtureStore(dir);
      const args = { sku: 'x' };
      store.put('read_inventory', args, { count: 7 });
      const before = fs.readFileSync(store.pathFor(store.key('read_inventory', args)));
      const tools = { read_inventory: {
        effect_class: 'SE0', determinism: 'nondeterministic',
        async impl() { throw new Error('offline'); }
      } };
      const recorder = replay.createReplayer(tools, { mode: 'record', store });
      await assert.rejects(recorder.call('read_inventory', args), /offline/);
      assert.deepStrictEqual(fs.readFileSync(store.pathFor(store.key('read_inventory', args))), before);
      assert.deepStrictEqual(recorder.calls, []);
    } finally { cleanup(dir); }
  });

  await asyncTest('record assimilates thenable tool results before hashing', async () => {
    const dir = tempDir('thenable');
    try {
      const store = new replay.FixtureStore(dir);
      const response = { count: 7 };
      const tools = { read_inventory: {
        effect_class: 'SE0', determinism: 'deterministic',
        impl() { return { then(resolve) { resolve(response); } }; }
      } };
      const recorder = replay.createReplayer(tools, { mode: 'record', store });
      assert.deepStrictEqual(await recorder.call('read_inventory', {}), response);
      assert.deepStrictEqual(store.get('read_inventory', {}).response, response);
      assert.strictEqual(recorder.calls[0].status, 'recorded');
    } finally { cleanup(dir); }
  });

  for (const mutateInImplementation of [false, true]) {
    await asyncTest(`records invocation arguments despite ${mutateInImplementation ? 'implementation' : 'caller'} mutation`, async () => {
      const dir = tempDir('async-arguments');
      try {
        const store = new replay.FixtureStore(dir);
        const args = { query: { sku: 'x' } };
        const original = { query: { sku: 'x' } };
        const response = { sku: 'x', count: 7 };
        let complete;
        const tools = { read_inventory: {
          effect_class: 'SE0', determinism: 'deterministic',
          impl(input) {
            if (mutateInImplementation) input.query.sku = 'changed';
            return new Promise(resolve => { complete = resolve; });
          }
        } };
        const recorder = replay.createReplayer(tools, { mode: 'record', store });
        const pending = recorder.call('read_inventory', args);
        if (!mutateInImplementation) args.query.sku = 'changed';
        complete(response);
        assert.deepStrictEqual(await pending, response);
        assert.deepStrictEqual(store.get('read_inventory', original).response, response);
        assert.strictEqual(store.has('read_inventory', args), false, 'Mutation must not redirect fixture identity');
        assert.strictEqual(recorder.calls[0].fixture_key, store.key('read_inventory', original));
        const replayer = replay.createReplayer(tools, { mode: 'replay', store });
        assert.deepStrictEqual(replayer.call('read_inventory', original), response);
        assert.throws(() => replayer.call('read_inventory', args), error => error.code === 'tool.fixture_missing');
      } finally { cleanup(dir); }
    });
  }

  await asyncTest('synchronous implementations retain an immediate return and invocation arguments', () => {
    const dir = tempDir('sync-arguments');
    try {
      const store = new replay.FixtureStore(dir);
      const args = { query: { sku: 'x' } };
      const response = { sku: 'x', count: 7 };
      const tools = { read_inventory: {
        effect_class: 'SE0', determinism: 'deterministic',
        impl(input) { input.query.sku = 'changed'; return response; }
      } };
      const recorder = replay.createReplayer(tools, { mode: 'record', store });
      assert.strictEqual(recorder.call('read_inventory', args), response);
      assert.deepStrictEqual(store.get('read_inventory', { query: { sku: 'x' } }).response, response);
      assert.strictEqual(store.has('read_inventory', args), false);
    } finally { cleanup(dir); }
  });

  await asyncTest('effect checks still refuse an async implementation before calling it', () => {
    const dir = tempDir('async-effects');
    try {
      const store = new replay.FixtureStore(dir);
      let liveCalls = 0;
      const tools = { charge_card: {
        effect_class: 'SE4', determinism: 'nondeterministic',
        async impl() { liveCalls += 1; return { charged: true }; }
      } };
      const recorder = replay.createReplayer(tools, { mode: 'record', store, maxEffectClass: 'SE2' });
      assert.throws(() => recorder.call('charge_card', {}), error => error.code === 'tool.effect_forbidden');
      const replayer = replay.createReplayer(tools, { mode: 'replay', store, maxEffectClass: 'SE4' });
      assert.throws(() => replayer.call('charge_card', {}), error => error.code === 'tool.effect_forbidden');
      assert.strictEqual(liveCalls, 0);
      assert.deepStrictEqual(fs.readdirSync(dir), []);
    } finally { cleanup(dir); }
  });

  finish('replay async');
}

main().catch(error => {
  console.error(error);
  process.exit(1);
});
