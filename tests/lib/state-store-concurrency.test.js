'use strict';

const assert = require('assert');
const fs = require('fs');
const os = require('os');
const path = require('path');
const { EventEmitter } = require('events');
const { startOwnedChild, withOwnedChildren, withCleanup } = require('./helpers/state-store-worker');
const { createStateStore } = require('../../scripts/lib/state-store');

const WORKER = path.join(__dirname, 'helpers', 'state-store-worker.js');
const WORK_ITEMS = path.join(__dirname, '..', '..', 'scripts', 'work-items.js');

async function startWorker() {
  const client = startOwnedChild(WORKER);
  try {
    await client.waitFor(message => message && message.ready === true);
  } catch (error) {
    return withCleanup(() => { throw error; }, [() => client.stop()]);
  }
  let nextId = 0;
  return {
    async request(action, options = {}) {
      const id = ++nextId;
      const response = client.waitFor(message => message && message.id === id);
      client.send({ id, action, ...options });
      const message = await response;
      if (!message.ok) throw new Error(message.error);
    },
    stop: () => client.stop(),
  };
}

async function withDatabase(fn) {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'ecc-store-concurrency-'));
  const dbPath = path.join(dir, 'state.db');
  return withCleanup(() => fn(dbPath), [() => fs.rmSync(dir, { recursive: true, force: true })]);
}

async function readItems(dbPath) {
  const store = await createStateStore({ dbPath });
  return withCleanup(() => store.listWorkItems({ limit: 1000 }).items, [() => store.close()]);
}

async function withWorkers(count, fn) {
  return withOwnedChildren(count, startWorker, fn);
}

async function run() {
  let passed = 0;
  let failed = 0;
  async function test(name, fn) {
    try {
      await withDatabase(fn);
      console.log(`  PASS ${name}`);
      passed += 1;
    } catch (error) {
      console.log(`  FAIL ${name}\n    ${error && error.message ? error.message : String(error)}`);
      failed += 1;
    }
  }

  console.log('\n=== Testing state-store concurrency ===\n');

  await test('owned fixtures wait for exit, both pipes, and IPC when aggregate close is absent', async () => {
    const events = ['exit', 'stdout', 'stderr', 'disconnect'];
    for (const last of events) {
      const child = new EventEmitter();
      child.stdout = new EventEmitter();
      child.stderr = new EventEmitter();
      child.stdout.destroy = () => child.stdout.emit('close');
      child.stderr.destroy = () => child.stderr.emit('close');
      child.connected = true;
      child.pid = 12345;
      child.disconnect = () => { child.connected = false; };
      const signals = [];
      const client = startOwnedChild(WORKER, [], {
        fork: () => child, platform: 'linux', kill: (...args) => signals.push(args)
      });
      child.emit('spawn');
      const stopping = client.stop();
      const emit = event => {
        if (event === 'exit') child.emit('exit', 0, null);
        else if (event === 'disconnect') child.emit('disconnect');
        else child[event].emit('close');
      };
      for (const event of events.filter(event => event !== last)) emit(event);
      assert.strictEqual(client.diagnostics.closed, false, `Must wait for ${last}`);
      emit(last);
      await stopping;
      assert.strictEqual(client.diagnostics.closed, true);
      assert.deepStrictEqual(signals, [], 'Fully closed fixtures need no forced termination');
    }
  });

  await test('closing an old reader preserves a task saved by the real CLI', async dbPath => {
    const reader = await createStateStore({ dbPath });
    await withCleanup(async () => {
      assert.strictEqual(reader.listWorkItems().items.length, 0);
      const cli = startOwnedChild(WORK_ITEMS, ['upsert', 'cli-task',
        '--title', 'Task saved while dashboard is open', '--db', dbPath, '--json']);
      const result = await withCleanup(() => cli.completion(), [() => cli.stop()]);
      assert.strictEqual(result.status, 0, result.stderr);
      assert.ok(reader.getWorkItemById('cli-task'), 'A warm reader must observe the other process\'s commit');
      assert.strictEqual(reader.listWorkItems().totalCount, 1);
    }, [() => reader.close()]);
    assert.ok((await readItems(dbPath)).some(item => item.id === 'cli-task'),
      'Closing the older reader must not remove the CLI task');
  });

  await test('long-lived handles preserve each other\'s writes and return current data', async dbPath => {
    const first = await createStateStore({ dbPath });
    let second;
    await withCleanup(async () => {
      second = await createStateStore({ dbPath });
      first.upsertWorkItem({ id: 'a', source: 'manual', title: 'First task', status: 'open' });
      second.upsertWorkItem({ id: 'b', source: 'manual', title: 'Second task', status: 'open' });
      first.upsertWorkItem({ id: 'c', source: 'manual', title: 'Third task', status: 'open' });
      assert.deepStrictEqual(second.listWorkItems().items.map(item => item.id).sort(), ['a', 'b', 'c']);
    }, [() => first.close(), () => { if (second) second.close(); }]);
    assert.deepStrictEqual((await readItems(dbPath)).map(item => item.id).sort(), ['a', 'b', 'c']);
  });

  await test('independent processes retain every task after all handles open before writing', async dbPath => {
    const initial = await createStateStore({ dbPath });
    initial.close();
    await withWorkers(3, async workers => {
      // IPC acknowledgements form a barrier: every handle exists before any write.
      await Promise.all(workers.map(worker => worker.request('open', { dbPath })));
      await Promise.all(workers.map((worker, index) => worker.request('write', { worker: `worker-${index}`, count: 4 })));
      await Promise.all(workers.map(worker => worker.request('close')));
    });
    const actual = (await readItems(dbPath)).map(item => item.id).sort();
    const expected = Array.from({ length: 3 }, (_, worker) =>
      Array.from({ length: 4 }, (_, item) => `worker-${worker}-${item}`)).flat().sort();
    assert.deepStrictEqual(actual, expected, 'Every acknowledged task must survive all worker exits');
  });

  await test('read-modify-write transactions from concurrent processes retain every increment', async dbPath => {
    const initial = await createStateStore({ dbPath });
    await withCleanup(() => {
      initial.upsertWorkItem({ id: 'counter', source: 'manual', title: 'Completed jobs', status: 'open', metadata: { value: 0 } });
    }, [() => initial.close()]);
    await withWorkers(3, async workers => {
      await Promise.all(workers.map(worker => worker.request('open', { dbPath })));
      await Promise.all(workers.map(worker => worker.request('increment', { count: 4 })));
      await Promise.all(workers.map(worker => worker.request('close')));
    });
    const counter = (await readItems(dbPath)).find(item => item.id === 'counter');
    assert.strictEqual(counter.metadata.value, 12, 'No committed increment may be lost');
  });

  await test('concurrent first opens complete migrations and accept all writers', async dbPath => {
    assert.strictEqual(fs.existsSync(dbPath), false);
    await withWorkers(3, async workers => {
      await Promise.all(workers.map(worker => worker.request('open', { dbPath })));
      await Promise.all(workers.map((worker, index) => worker.request('write', { worker: `fresh-${index}` })));
      await Promise.all(workers.map(worker => worker.request('close')));
    });
    const store = await createStateStore({ dbPath });
    await withCleanup(() => {
      const migrations = store.getAppliedMigrations();
      assert.ok(migrations.length > 0);
      assert.strictEqual(new Set(migrations.map(migration => migration.version)).size, migrations.length);
      assert.deepStrictEqual(store.listWorkItems().items.map(item => item.id).sort(), ['fresh-0-0', 'fresh-1-0', 'fresh-2-0']);
    }, [() => store.close()]);
  });

  console.log(`\nResults: Passed: ${passed}, Failed: ${failed}`);
  process.exitCode = failed > 0 ? 1 : 0;
}

process.exitCode = 1;
run().catch(error => {
  console.error(error);
  process.exitCode = 1;
});
