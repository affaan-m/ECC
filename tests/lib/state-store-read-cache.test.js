'use strict';

const assert = require('assert');
const fs = require('fs');
const os = require('os');
const path = require('path');
const vm = require('vm');
const { createRequire } = require('module');
const initSqlJs = require('sql.js');
const { createStateStore: createWriter } = require('../../scripts/lib/state-store');

const STORE = require.resolve('../../scripts/lib/state-store');
const LOCK = require.resolve('../../scripts/lib/state-store/file-lock');

function loadPrivate(filename, overrides, processFacade = process) {
  const module = { exports: {} };
  const nativeRequire = createRequire(filename);
  const localRequire = id => Object.hasOwn(overrides, id) ? overrides[id] : nativeRequire(id);
  vm.compileFunction(fs.readFileSync(filename, 'utf8'),
    ['exports', 'require', 'module', '__filename', '__dirname', 'process'], { filename })(
    module.exports, localRequire, module, filename, path.dirname(filename), processFacade);
  return module.exports;
}

async function createFixture(dbPath, { platform = process.platform } = {}) {
  const processFacade = Object.create(process);
  Object.defineProperty(processFacade, 'platform', { value: platform });
  const metrics = { reads: 0, databases: 0, exports: 0, publishes: 0 };
  const descriptors = new Map();
  let publishFailure;
  let transformStats = stats => stats;
  let lockBlocked = false;
  let lockAttempts = 0;
  const facade = {
    ...fs,
    openSync(file, ...args) {
      if (file === `${dbPath}.ecc-state.lock`) {
        lockAttempts += 1;
        if (lockBlocked) throw Object.assign(new Error('held by another writer'), { code: 'EEXIST' });
      }
      const descriptor = fs.openSync(file, ...args);
      descriptors.set(descriptor, file);
      return descriptor;
    },
    lstatSync(file, options) {
      const stats = fs.lstatSync(file, options);
      return file === dbPath ? transformStats(stats, 'path', options) : stats;
    },
    fstatSync(descriptor, options) {
      const stats = fs.fstatSync(descriptor, options);
      return descriptors.get(descriptor) === dbPath ? transformStats(stats, 'descriptor', options) : stats;
    },
    readFileSync(file, ...args) {
      if ((typeof file === 'number' ? descriptors.get(file) : file) === dbPath) metrics.reads += 1;
      return fs.readFileSync(file, ...args);
    },
    closeSync(descriptor) {
      try { return fs.closeSync(descriptor); }
      finally { descriptors.delete(descriptor); }
    },
    renameSync(from, to) {
      if (to === dbPath) {
        if (publishFailure) throw publishFailure;
        metrics.publishes += 1;
      }
      return fs.renameSync(from, to);
    },
  };
  const SQL = await initSqlJs();
  class ObservedDatabase extends SQL.Database {
    constructor(...args) { super(...args); metrics.databases += 1; }
    export() { metrics.exports += 1; return super.export(); }
  }
  const lock = loadPrivate(LOCK, { fs: facade }, processFacade);
  const lockFacade = {
    ...lock,
    withStateStoreLock(file, callback) {
      return lock.withStateStoreLock(file, callback, { timeoutMs: lockBlocked ? 0 : 5000 });
    },
  };
  const { createStateStore } = loadPrivate(STORE, {
    fs: facade,
    './file-lock': lockFacade,
    'sql.js': async () => ({ ...SQL, Database: ObservedDatabase }),
  }, processFacade);
  return {
    createStateStore,
    metrics,
    reset() { for (const key of Object.keys(metrics)) metrics[key] = 0; },
    failPublication(error) { publishFailure = error; },
    setStatTransform(transform) { transformStats = transform; },
    blockLock(blocked) { lockBlocked = blocked; },
    get lockAttempts() { return lockAttempts; },
  };
}

function item(id, title = id) {
  return { id, title, source: 'manual', status: 'open', metadata: { nested: { value: 'saved' } } };
}

function readBoard(store) {
  return {
    item: store.getWorkItemById('task'),
    list: store.listWorkItems(),
    status: store.getStatus(),
  };
}

function assertNoSnapshotWork(fixture) {
  assert.deepStrictEqual(fixture.metrics, { reads: 0, databases: 0, exports: 0, publishes: 0 });
}

async function run() {
  let passed = 0;
  let failed = 0;
  async function test(name, callback, options) {
    // Resolve host aliases before a fixture simulates another platform.
    const directory = fs.realpathSync(fs.mkdtempSync(path.join(os.tmpdir(), 'ecc-state-read-cache-')));
    try {
      const dbPath = path.join(directory, 'state.db');
      await callback(dbPath, await createFixture(dbPath, options));
      console.log(`  PASS ${name}`);
      passed += 1;
    } catch (error) {
      console.log(`  FAIL ${name}\n    ${error && error.stack ? error.stack : String(error)}`);
      failed += 1;
    } finally { fs.rmSync(directory, { recursive: true, force: true }); }
  }

  await test('unchanged public reads reuse the database without reading, constructing or exporting', async (dbPath, fixture) => {
    const store = await fixture.createStateStore({ dbPath });
    try {
      store.upsertWorkItem(item('task'));
      readBoard(store);
      fixture.reset();
      for (let index = 0; index < 3; index += 1) {
        const result = readBoard(store);
        assert.strictEqual(result.item.title, 'task');
        assert.strictEqual(result.list.totalCount, 1);
        assert.strictEqual(result.status.workItems.items.length, 1);
      }
      assertNoSnapshotWork(fixture);
    } finally { store.close(); }
  });

  await test('atomic replacement by another handle refreshes once and then reuses the new snapshot', async (dbPath, fixture) => {
    const reader = await fixture.createStateStore({ dbPath });
    const writer = await createWriter({ dbPath });
    try {
      writer.upsertWorkItem(item('task', 'before'));
      readBoard(reader);
      writer.upsertWorkItem(item('task', 'after'));
      writer.upsertWorkItem(item('second'));
      fixture.reset();
      const result = readBoard(reader);
      assert.strictEqual(result.item.title, 'after');
      assert.strictEqual(result.list.totalCount, 2);
      assert.strictEqual(result.status.workItems.items.length, 2);
      assert.deepStrictEqual(fixture.metrics, { reads: 1, databases: 1, exports: 0, publishes: 0 });
      fixture.reset();
      readBoard(reader);
      assertNoSnapshotWork(fixture);
    } finally { reader.close(); writer.close(); }
  });

  await test('cached reads return fresh objects and respect each call\'s limits', async (dbPath, fixture) => {
    const store = await fixture.createStateStore({ dbPath });
    try {
      store.upsertWorkItem(item('task'));
      store.upsertWorkItem(item('second'));
      const first = readBoard(store);
      first.item.title = 'caller mutation';
      first.item.metadata.nested.value = 'caller mutation';
      first.list.items.length = 0;
      first.status.workItems.items[0].metadata.nested.value = 'caller mutation';
      fixture.reset();
      const next = readBoard(store);
      assert.notStrictEqual(next.item, first.item);
      assert.notStrictEqual(next.item.metadata, first.item.metadata);
      assert.notStrictEqual(next.list, first.list);
      assert.notStrictEqual(next.status, first.status);
      assert.strictEqual(next.item.title, 'task');
      assert.strictEqual(next.item.metadata.nested.value, 'saved');
      assert.strictEqual(next.list.items.length, 2);
      assert.ok(next.status.workItems.items.every(row => row.metadata.nested.value === 'saved'));
      assert.strictEqual(store.listWorkItems({ limit: 1 }).items.length, 1);
      assert.strictEqual(store.getStatus({ workItemLimit: 1 }).workItems.items.length, 1);
      assertNoSnapshotWork(fixture);
    } finally { store.close(); }
  });

  for (const method of ['get', 'all']) {
    await test(`generic ${method} RETURNING and PRAGMA writes persist and invalidate public reads`, async (dbPath, fixture) => {
      const store = await fixture.createStateStore({ dbPath });
      try {
        store.upsertWorkItem(item('task'));
        for (const transactional of [false, true]) {
          readBoard(store);
          const title = transactional ? 'transactional' : 'standalone';
          const version = transactional ? 202 : 101;
          const mutate = () => {
            const result = store._database.prepare(`UPDATE work_items SET title = '${title}' WHERE id = 'task' RETURNING id, title`)[method]();
            assert.deepStrictEqual(result, method === 'get' ? { id: 'task', title } : [{ id: 'task', title }]);
            assert.deepStrictEqual(store._database.prepare(`PRAGMA user_version = ${version}`)[method](), method === 'get' ? null : []);
          };
          if (transactional) store._database.transaction(mutate)();
          else mutate();
          const result = readBoard(store);
          assert.strictEqual(result.item.title, title);
          assert.strictEqual(result.list.items[0].title, title);
          assert.strictEqual(result.status.workItems.items[0].title, title);
          const reopened = await createWriter({ dbPath });
          try {
            assert.strictEqual(reopened.getWorkItemById('task').title, title);
            assert.strictEqual(reopened._database.prepare('PRAGMA user_version').get().user_version, version);
          } finally { reopened.close(); }
          readBoard(store);
          fixture.reset();
          readBoard(store);
          assertNoSnapshotWork(fixture);
        }
      } finally { store.close(); }
    });
  }

  for (const method of ['get', 'all']) {
    await test(`a limit getter can reenter generic ${method} RETURNING and invalidate the outer read cache`, async (dbPath, fixture) => {
      const store = await fixture.createStateStore({ dbPath });
      try {
        store.upsertWorkItem(item('task', 'before'));
        readBoard(store);
        let calls = 0;
        const result = store.listWorkItems({
          get limit() {
            calls += 1;
            const changed = store._database.prepare("UPDATE work_items SET title = 'getter write' WHERE id = 'task' RETURNING id, title")[method]();
            assert.deepStrictEqual(changed, method === 'get'
              ? { id: 'task', title: 'getter write' } : [{ id: 'task', title: 'getter write' }]);
            return 1;
          },
        });
        assert.strictEqual(calls, 1);
        assert.strictEqual(result.items[0].title, 'getter write');
        fixture.reset();
        assert.strictEqual(readBoard(store).item.title, 'getter write');
        assert.deepStrictEqual(fixture.metrics, { reads: 1, databases: 1, exports: 0, publishes: 0 });
        fixture.reset();
        readBoard(store);
        assertNoSnapshotWork(fixture);
        const reopened = await createWriter({ dbPath });
        try { assert.strictEqual(reopened.getWorkItemById('task').title, 'getter write'); }
        finally { reopened.close(); }
      } finally { store.close(); }
    });
  }

  await test('public reads inside a write transaction see its writes without publishing early', async (dbPath, fixture) => {
    const store = await fixture.createStateStore({ dbPath });
    try {
      store.upsertWorkItem(item('task', 'before'));
      readBoard(store);
      const before = fs.readFileSync(dbPath);
      store._database.transaction(() => {
        assert.strictEqual(readBoard(store).item.title, 'before');
        store.upsertWorkItem(item('task', 'committed'));
        assert.strictEqual(readBoard(store).item.title, 'committed');
        assert.deepStrictEqual(fs.readFileSync(dbPath), before);
      })();
      assert.strictEqual(readBoard(store).item.title, 'committed');
      fixture.reset();
      readBoard(store);
      assertNoSnapshotWork(fixture);
    } finally { store.close(); }
  });

  await test('rollback discards changes observed through public reads inside a transaction', async (dbPath, fixture) => {
    const store = await fixture.createStateStore({ dbPath });
    try {
      store.upsertWorkItem(item('task', 'before'));
      readBoard(store);
      const before = fs.readFileSync(dbPath);
      const failure = new Error('rollback cached reads');
      assert.throws(() => store._database.transaction(() => {
        store.upsertWorkItem(item('task', 'discarded'));
        assert.strictEqual(readBoard(store).item.title, 'discarded');
        throw failure;
      })(), error => error === failure);
      assert.deepStrictEqual(fs.readFileSync(dbPath), before);
      assert.strictEqual(readBoard(store).item.title, 'before');
      fixture.reset();
      readBoard(store);
      assertNoSnapshotWork(fixture);
    } finally { store.close(); }
  });

  await test('failed publication cannot contaminate cached reads or overwrite a later writer', async (dbPath, fixture) => {
    const store = await fixture.createStateStore({ dbPath });
    const writer = await createWriter({ dbPath });
    try {
      store.upsertWorkItem(item('task', 'before'));
      readBoard(store);
      const before = fs.readFileSync(dbPath);
      const failure = new Error('publication failed');
      fixture.failPublication(failure);
      try { assert.throws(() => store.upsertWorkItem(item('task', 'discarded')), error => error === failure); }
      finally { fixture.failPublication(undefined); }
      assert.deepStrictEqual(fs.readFileSync(dbPath), before);
      assert.strictEqual(readBoard(store).item.title, 'before');
      writer.upsertWorkItem(item('task', 'other writer'));
      assert.strictEqual(readBoard(store).item.title, 'other writer');
      store.upsertWorkItem(item('second'));
      assert.strictEqual(readBoard(store).item.title, 'other writer');
      fixture.reset();
      readBoard(store);
      assertNoSnapshotWork(fixture);
    } finally { store.close(); writer.close(); }
  });

  await test('closing a cached file-backed handle does not publish and prevents later reads', async (dbPath, fixture) => {
    const store = await fixture.createStateStore({ dbPath });
    try {
      store.upsertWorkItem(item('task'));
      readBoard(store);
      fixture.reset();
      store.close();
      store.close();
      for (const read of [() => store.getWorkItemById('task'), () => store.listWorkItems(), () => store.getStatus()]) {
        assert.throws(read, /closed/);
      }
      assertNoSnapshotWork(fixture);
    } finally { store.close(); }
  });

  await test('in-memory reads retain writes and rollback without snapshot IO', async (_dbPath, fixture) => {
    const store = await fixture.createStateStore({ dbPath: ':memory:' });
    try {
      store.upsertWorkItem(item('task', 'before'));
      readBoard(store);
      fixture.reset();
      readBoard(store);
      store.upsertWorkItem(item('task', 'after'));
      assert.strictEqual(readBoard(store).item.title, 'after');
      assert.throws(() => store._database.transaction(() => {
        store.upsertWorkItem(item('task', 'discarded'));
        throw new Error('rollback memory');
      })(), /rollback memory/);
      assert.strictEqual(readBoard(store).item.title, 'after');
      assertNoSnapshotWork(fixture);
    } finally { store.close(); }
  });

  await test('a warm cache still acquires the writer lock and reports contention', async (dbPath, fixture) => {
    const store = await fixture.createStateStore({ dbPath });
    try {
      store.upsertWorkItem(item('task'));
      readBoard(store);
      fixture.reset();
      const attempts = fixture.lockAttempts;
      fixture.blockLock(true);
      try { assert.throws(() => store.getWorkItemById('task'), error => error.code === 'STATE_STORE_BUSY'); }
      finally { fixture.blockLock(false); }
      assert.strictEqual(fixture.lockAttempts, attempts + 1);
      assertNoSnapshotWork(fixture);
      assert.strictEqual(readBoard(store).item.title, 'task');
      assert.deepStrictEqual(fixture.metrics, { reads: 1, databases: 1, exports: 0, publishes: 0 });
    } finally { store.close(); }
  });

  for (const kind of ['symlink', 'directory']) {
    await test(`a warm cache rejects a database path replaced by a ${kind}`, async (dbPath, fixture) => {
      const store = await fixture.createStateStore({ dbPath });
      try {
        store.upsertWorkItem(item('task'));
        readBoard(store);
        // Simulate the path metadata so Windows does not require symlink privileges.
        fixture.setStatTransform(stats => Object.assign(Object.create(stats), {
          isSymbolicLink: () => kind === 'symlink',
          isFile: () => false,
          isDirectory: () => kind === 'directory',
        }));
        fixture.reset();
        assert.throws(() => store.getWorkItemById('task'), kind === 'symlink' ? /symlink/ : /not a regular file/);
        assertNoSnapshotWork(fixture);
        fixture.setStatTransform(stats => stats);
        assert.strictEqual(readBoard(store).item.title, 'task');
        assert.deepStrictEqual(fixture.metrics, { reads: 1, databases: 1, exports: 0, publishes: 0 });
      } finally { store.close(); }
    });
  }

  await test('a throwing read callback invalidates the previous cached snapshot', async (dbPath, fixture) => {
    const store = await fixture.createStateStore({ dbPath });
    try {
      store.upsertWorkItem(item('task'));
      readBoard(store);
      const failure = new Error('invalid read options');
      fixture.reset();
      assert.throws(() => store.listWorkItems({ get limit() { throw failure; } }), error => error === failure);
      assertNoSnapshotWork(fixture);
      assert.strictEqual(readBoard(store).item.title, 'task');
      assert.deepStrictEqual(fixture.metrics, { reads: 1, databases: 1, exports: 0, publishes: 0 });
      fixture.reset();
      readBoard(store);
      assertNoSnapshotWork(fixture);
    } finally { store.close(); }
  });

  await test('read-only transactions do not export but cannot seed the next read cache', async (dbPath, fixture) => {
    const store = await fixture.createStateStore({ dbPath });
    try {
      store.upsertWorkItem(item('task'));
      readBoard(store);
      fixture.reset();
      store._database.transaction(() => assert.strictEqual(readBoard(store).item.title, 'task'))();
      assertNoSnapshotWork(fixture);
      assert.strictEqual(readBoard(store).item.title, 'task');
      assert.deepStrictEqual(fixture.metrics, { reads: 1, databases: 1, exports: 0, publishes: 0 });
      fixture.reset();
      readBoard(store);
      assertNoSnapshotWork(fixture);
    } finally { store.close(); }
  });

  for (const method of ['exec', 'run', 'get', 'all']) {
    await test(`a caught partial ${method} failure inside read options publishes changes and invalidates cache`, async (dbPath, fixture) => {
      const store = await fixture.createStateStore({ dbPath });
      try {
        store.upsertWorkItem(item('task', 'before'));
        readBoard(store);
        const targetId = method === 'exec' ? 'task' : 'partial';
        let sqlFailure;
        fixture.reset();
        const result = store.listWorkItems({
          get limit() {
            try {
              if (method === 'exec') {
                store._database.exec("UPDATE work_items SET title = 'partial write' WHERE id = 'task'; INVALID SQL;");
              } else {
                // OR FAIL preserves the first row when the duplicate primary key fails.
                store._database.prepare(`
                  INSERT OR FAIL INTO work_items (id, source, title, status, metadata, created_at, updated_at)
                  VALUES ('partial', 'manual', 'partial write', 'open', '{}', '2026-01-01', '2026-01-01'),
                    ('partial', 'manual', 'duplicate', 'open', '{}', '2026-01-01', '2026-01-01')
                `)[method]();
              }
            } catch (error) { sqlFailure = error; }
            return 20;
          },
        });
        assert.ok(sqlFailure, 'SQL must fail after a partial write');
        assert.match(sqlFailure.message, method === 'exec' ? /syntax error/ : /UNIQUE constraint failed/);
        assert.strictEqual(result.items.find(row => row.id === targetId).title, 'partial write');
        assert.deepStrictEqual(fixture.metrics, { reads: 0, databases: 0, exports: 1, publishes: 1 });
        fixture.reset();
        assert.strictEqual(readBoard(store).list.items.find(row => row.id === targetId).title, 'partial write');
        assert.deepStrictEqual(fixture.metrics, { reads: 1, databases: 1, exports: 0, publishes: 0 });
        fixture.reset();
        readBoard(store);
        assertNoSnapshotWork(fixture);
        const reopened = await createWriter({ dbPath });
        try { assert.strictEqual(reopened.getWorkItemById(targetId).title, 'partial write'); }
        finally { reopened.close(); }
      } finally { store.close(); }
    });
  }

  for (const missingDevice of ['path', 'descriptor']) {
    await test(`Windows cached reads accept an unavailable ${missingDevice} device`, async (dbPath, fixture) => {
      fixture.setStatTransform((stats, source, options) => !options || !options.bigint ? stats
        : Object.assign(Object.create(stats), { dev: source === missingDevice ? 0n : 42n }));
      const store = await fixture.createStateStore({ dbPath });
      try {
        store.upsertWorkItem(item('task'));
        readBoard(store);
        fixture.reset();
        assert.strictEqual(readBoard(store).item.title, 'task');
        assertNoSnapshotWork(fixture);
      } finally { store.close(); }
    }, { platform: 'win32' });
  }

  await test('adjacent high bigint inodes invalidate cache even if Number would round them together', async (dbPath, fixture) => {
    let inode = 9007199254740992n;
    fixture.setStatTransform((stats, _source, options) => !options || !options.bigint ? stats
      : Object.assign(Object.create(stats), { dev: 42n, ino: inode }));
    const store = await fixture.createStateStore({ dbPath });
    try {
      store.upsertWorkItem(item('task'));
      readBoard(store);
      fixture.reset();
      inode += 1n;
      assert.strictEqual(readBoard(store).item.title, 'task');
      assert.deepStrictEqual(fixture.metrics, { reads: 1, databases: 1, exports: 0, publishes: 0 });
      fixture.reset();
      readBoard(store);
      assertNoSnapshotWork(fixture);
    } finally { store.close(); }
  });

  console.log(`\nResults: Passed: ${passed}, Failed: ${failed}`);
  process.exitCode = failed ? 1 : 0;
}

process.exitCode = 1;
run().catch(error => { console.error(error); process.exitCode = 1; });
