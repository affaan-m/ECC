'use strict';

const assert = require('assert');
// Private facade: fault injection must not mutate shared fs or require.cache.
const fs = { ...require('fs') };
const vm = require('vm');
const { createRequire } = require('module');
const os = require('os');
const path = require('path');
const STORE = require.resolve('../../scripts/lib/state-store');
const LOCK = require.resolve('../../scripts/lib/state-store/file-lock');
function loadPrivate(filename, overrides = {}, source = fs.readFileSync(filename, 'utf8'), processFacade = process) {
  const module = { exports: {} };
  const nativeRequire = createRequire(filename);
  const localRequire = id => Object.hasOwn(overrides, id) ? overrides[id] : nativeRequire(id);
  vm.compileFunction(source, ['exports', 'require', 'module', '__filename', '__dirname', 'process'],
    { filename })(module.exports, localRequire, module, filename, path.dirname(filename), processFacade);
  return module.exports;
}
const lockModule = loadPrivate(LOCK, { fs });
const { withStateStoreLock, recordCleanupError, getCleanupErrors } = lockModule;
// sql.js is only initialized by the original integration cases, never the pure mode.
const { createStateStore } = loadPrivate(STORE, { fs, './file-lock': lockModule });

function thrownBy(fn) {
  try { return { failed: false, value: fn() }; }
  catch (error) { return { failed: true, error }; }
}

function lockFixture(overrides = {}, platform = 'linux', performance = require('perf_hooks').performance) {
  const calls = [];
  const identity = { dev: 1n, ino: 2n, isFile: () => true, isSymbolicLink: () => false };
  let present = true;
  let closed = false;
  const facade = {
    openSync() { calls.push('open'); return 3; },
    fstatSync() { calls.push('fstat'); return identity; },
    writeFileSync() { calls.push('write'); },
    lstatSync() { calls.push('lstat'); if (!present) throw Object.assign(new Error('missing'), { code: 'ENOENT' }); return identity; },
    unlinkSync() { calls.push('unlink'); present = false; },
    closeSync() { calls.push('close'); closed = true; },
  };
  const state = { calls, identity, get present() { return present; }, set present(value) { present = value; },
    get closed() { return closed; } };
  for (const [name, fn] of Object.entries(overrides)) {
    const original = facade[name];
    facade[name] = (...args) => fn(state, original, ...args);
  }
  const lock = loadPrivate(LOCK, { fs: facade, os: { hostname: () => 'fixture' }, perf_hooks: { performance } }, undefined,
    { platform, pid: 7 });
  return { ...state, calls, getCleanupErrors: lock.getCleanupErrors,
    run: (callback, timeoutMs = 0) => lock.withStateStoreLock('synthetic.db', callback, { timeoutMs }) };
}

async function runSynthetic(test) {
  await test('Windows pending-delete EPERM retries until exclusive creation succeeds', () => {
    const denied = Object.assign(new Error('pending deletion'), { code: 'EPERM' });
    let attempts = 0;
    let callbacks = 0;
    const fixture = lockFixture({ openSync(state, open, file, flags, mode) {
      assert.strictEqual(file, 'synthetic.db.ecc-state.lock');
      assert.strictEqual(flags, 'wx');
      assert.strictEqual(mode, 0o600);
      attempts += 1;
      if (attempts === 1) { state.calls.push('open'); throw denied; }
      return open();
    } }, 'win32');
    assert.strictEqual(fixture.run(() => { callbacks += 1; return 'done'; }, 1000), 'done');
    assert.strictEqual(attempts, 2);
    assert.strictEqual(callbacks, 1);
    assert.deepStrictEqual(fixture.calls, ['open', 'open', 'fstat', 'write', 'lstat', 'unlink', 'close']);
  });
  for (const codes of [['EPERM', 'EPERM'], ['EEXIST', 'EPERM'], ['EPERM', 'EEXIST']]) {
    await test(`Windows lock timeout preserves the final error classification (${codes.join(' -> ')})`, () => {
      const errors = codes.map(code => Object.assign(new Error(`open failed: ${code}`), { code }));
      let attempts = 0;
      const clock = { now: () => attempts * 10 };
      const fixture = lockFixture({ openSync(state) {
        state.calls.push('open');
        throw errors[attempts++];
      } }, 'win32', clock);
      const result = thrownBy(() => fixture.run(() => assert.fail('callback must not run'), 20));
      assert.ok(result.failed);
      if (codes[1] === 'EPERM') {
        assert.strictEqual(result.error, errors[1]);
        assert.doesNotMatch(result.error.message, /remove|leftover lock/i);
      } else {
        assert.strictEqual(result.error.code, 'STATE_STORE_BUSY');
        assert.match(result.error.message, /synthetic\.db\.ecc-state\.lock/);
      }
      assert.strictEqual(attempts, 2);
      assert.deepStrictEqual(fixture.calls, ['open', 'open']);
    });
  }
  for (const [platform, code] of [['linux', 'EPERM'], ['darwin', 'EPERM'], ['win32', 'EACCES'], ['win32', 'EIO']]) {
    await test(`unrelated lock-open errors propagate immediately (${platform}, ${code})`, () => {
      const denied = Object.assign(new Error('open denied'), { code });
      const fixture = lockFixture({ openSync(state) { state.calls.push('open'); throw denied; } }, platform);
      const result = thrownBy(() => fixture.run(() => assert.fail('callback must not run'), 1000));
      assert.ok(result.failed);
      assert.strictEqual(result.error, denied);
      assert.deepStrictEqual(fixture.calls, ['open']);
    });
  }
  await test('owned lock unlinks before its only close', () => {
    const fixture = lockFixture();
    assert.strictEqual(fixture.run(() => 'done'), 'done');
    assert.deepStrictEqual(fixture.calls, ['open', 'fstat', 'write', 'lstat', 'unlink', 'close']);
  });
  await test('a replacement created during close is never unlinked', () => {
    let replacement = false;
    const fixture = lockFixture({
      closeSync(state, close) { close(); replacement = true; state.present = true; },
      unlinkSync(state, unlink) { assert.ok(!replacement, 'must not unlink after releasing the descriptor'); unlink(); },
    });
    fixture.run(() => {});
    assert.ok(replacement);
    assert.strictEqual(fixture.calls.filter(call => call === 'close').length, 1);
  });
  for (const platform of ['linux', 'darwin', 'win32']) {
    for (const replacement of [
      { ino: 3n }, { dev: 9n }, { isFile: () => false }, { isSymbolicLink: () => true },
      ...(platform === 'win32' ? [{ dev: 0n, isFile: () => false }, { dev: 0n, isSymbolicLink: () => true }] : []),
    ]) {
      await test(`observed lock replacement is preserved (${platform}, ${Object.keys(replacement).join('+')})`, () => {
        const fixture = lockFixture({ lstatSync(state) { state.calls.push('lstat'); return { ...state.identity, ...replacement }; } }, platform);
        const result = thrownBy(() => fixture.run(() => {}));
        assert.ok(result.failed);
        assert.match(result.error.message, /lock.*(changed|lost)/i);
        assert.ok(!fixture.calls.includes('unlink'));
        assert.strictEqual(fixture.calls.filter(call => call === 'close').length, 1);
      });
    }
  }
  const highInode = 9007199254740992n;
  const identityCases = [
    { name: 'matching high inode and devices', platform: 'win32', ownedDev: 9n, pathDev: 9n, allowed: true },
    { name: 'missing path device', platform: 'win32', ownedDev: 9n, pathDev: 0n, allowed: true },
    { name: 'missing descriptor device', platform: 'win32', ownedDev: 0n, pathDev: 9n, allowed: true },
    { name: 'both devices unavailable', platform: 'win32', ownedDev: 0n, pathDev: 0n, allowed: true },
    ...['linux', 'darwin'].flatMap(platform => [
      { name: 'missing path device', platform, ownedDev: 9n, pathDev: 0n, allowed: false },
      { name: 'missing descriptor device', platform, ownedDev: 0n, pathDev: 9n, allowed: false },
    ]),
    ...[[9n, 9n], [9n, 0n], [0n, 9n], [0n, 0n]].map(([ownedDev, pathDev]) => ({
      name: `distinct high inodes with devices ${ownedDev}/${pathDev}`,
      platform: 'win32', ownedDev, pathDev, pathInode: highInode + 1n, allowed: false,
    })),
  ];
  for (const identityCase of identityCases) {
    await test(`lock identity handles ${identityCase.name} (${identityCase.platform})`, () => {
      const fixture = lockFixture({
        fstatSync(state, stat, descriptor, options) {
          assert.strictEqual(options.bigint, true);
          return { ...stat(), dev: identityCase.ownedDev, ino: highInode };
        },
        lstatSync(state, stat, lockPath, options) {
          assert.strictEqual(options.bigint, true);
          return { ...stat(), dev: identityCase.pathDev, ino: identityCase.pathInode ?? highInode };
        },
      }, identityCase.platform);
      const result = thrownBy(() => fixture.run(() => 'done'));
      if (identityCase.allowed) {
        assert.strictEqual(result.failed, false, result.error && result.error.message);
        assert.strictEqual(result.value, 'done');
        assert.deepStrictEqual(fixture.calls, ['open', 'fstat', 'write', 'lstat', 'unlink', 'close']);
      } else {
        assert.strictEqual(result.failed, true);
        assert.strictEqual(result.error.code, 'STATE_STORE_LOCK_LOST');
        assert.deepStrictEqual(fixture.calls, ['open', 'fstat', 'write', 'lstat', 'close']);
      }
    });
  }
  for (const afterClose of ['missing', 'permission', 'replacement']) {
    await test(`initial EPERM performs only a post-close read probe (${afterClose})`, () => {
      const denied = Object.assign(new Error('denied'), { code: 'EPERM' });
      const fixture = lockFixture({ lstatSync(state) {
        state.calls.push('lstat');
        if (!state.closed || afterClose === 'permission') throw denied;
        if (afterClose === 'missing') throw Object.assign(new Error('gone'), { code: 'ENOENT' });
        return { ...state.identity, ino: 10n };
      } }, 'win32');
      const result = thrownBy(() => fixture.run(() => {}));
      assert.ok(result.failed);
      if (afterClose === 'missing') assert.strictEqual(result.error.code, 'STATE_STORE_LOCK_LOST');
      else assert.strictEqual(result.error, denied);
      assert.deepStrictEqual(fixture.calls.slice(3), ['lstat', 'close', 'lstat']);
    });
  }
  await test('close failure stops the pending-delete probe and preserves initial EPERM', () => {
    const denied = Object.assign(new Error('denied'), { code: 'EPERM' });
    const cleanup = new Error('close failed');
    const fixture = lockFixture({
      lstatSync(state) { state.calls.push('lstat'); throw denied; },
      closeSync(state) { state.calls.push('close'); throw cleanup; },
    });
    const result = thrownBy(() => fixture.run(() => {}));
    assert.ok(result.failed);
    assert.strictEqual(result.error, denied);
    assert.strictEqual(fixture.getCleanupErrors(result.error).closeError, cleanup);
    assert.deepStrictEqual(fixture.calls.slice(3), ['lstat', 'close']);
  });
  await test('initial missing lock is loss after descriptor closure', () => {
    const fixture = lockFixture({ lstatSync(state) { state.calls.push('lstat'); throw Object.assign(new Error('gone'), { code: 'ENOENT' }); } });
    const result = thrownBy(() => fixture.run(() => {}));
    assert.ok(result.failed);
    assert.strictEqual(result.error.code, 'STATE_STORE_LOCK_LOST');
    assert.deepStrictEqual(fixture.calls.slice(3), ['lstat', 'close']);
  });
  await test('unlink EPERM is not mistaken for an initial pending-delete lookup', () => {
    const denied = Object.assign(new Error('unlink denied'), { code: 'EPERM' });
    const fixture = lockFixture({ unlinkSync(state) { state.calls.push('unlink'); throw denied; } });
    const result = thrownBy(() => fixture.run(() => {}));
    assert.ok(result.failed);
    assert.strictEqual(result.error, denied);
    assert.deepStrictEqual(fixture.calls.slice(3), ['lstat', 'unlink', 'close']);
  });
  const revoked = Proxy.revocable({}, {});
  revoked.revoke();
  const primaries = [null, undefined, false, 0, '', 'primitive', Object.freeze(new Error('frozen')),
    Object.defineProperty(new Error('setter'), 'releaseError', { set() { throw new Error('setter must not mask'); } }),
    revoked.proxy];
  for (const [index, primary] of primaries.entries()) {
    for (const stage of ['callback', 'metadata', 'identity']) {
      await test(`arbitrary primary survives lock cleanup (${index}, ${stage})`, () => {
        const cleanup = new Error('cleanup failed');
        const overrides = stage === 'callback'
          ? { unlinkSync() { throw cleanup; } }
          : stage === 'metadata'
            ? { writeFileSync() { throw primary; }, unlinkSync() { throw cleanup; } }
            : { fstatSync() { throw primary; }, closeSync() { throw cleanup; } };
        const fixture = lockFixture(overrides);
        const result = thrownBy(() => fixture.run(() => { if (stage === 'callback') throw primary; assert.fail('callback must not run'); }));
        assert.ok(result.failed);
        assert.strictEqual(result.error, primary);
        const diagnostics = fixture.getCleanupErrors(primary);
        if (primary !== null && typeof primary === 'object') assert.strictEqual(diagnostics.releaseError, cleanup);
        else assert.deepStrictEqual(diagnostics, {});
        assert.ok(Object.isFrozen(diagnostics));
      });
    }
    for (const stage of ['migration', 'rollback']) {
      await test(`arbitrary primary survives state-store ${stage} cleanup (${index})`, async () => {
        const secondary = new Error('cleanup failed');
        let closes = 0;
        const fakeSQL = { Database: class {
          run(sql) { if (sql === 'ROLLBACK') throw secondary; }
          close() { closes++; throw secondary; }
        } };
        const cleanupLock = loadPrivate(LOCK);
        const api = loadPrivate(STORE, {
          'sql.js': async () => fakeSQL,
          './file-lock': cleanupLock,
          './migrations': { applyMigrations() { if (stage === 'migration') throw primary; return []; } },
          './queries': { createQueryApi: () => ({}) },
        });
        let failed = false;
        let caught;
        try {
          const store = await api.createStateStore({ dbPath: ':memory:' });
          store._database.transaction(() => { throw primary; })();
        } catch (error) { failed = true; caught = error; }
        assert.ok(failed);
        assert.strictEqual(caught, primary);
        assert.strictEqual(closes, 1);
        const diagnostics = cleanupLock.getCleanupErrors(primary);
        if (primary !== null && typeof primary === 'object') {
          assert.strictEqual(diagnostics.closeError, secondary);
          if (stage === 'rollback') assert.strictEqual(diagnostics.rollbackError, secondary);
        } else assert.deepStrictEqual(diagnostics, {});
        assert.ok(Object.isFrozen(diagnostics));
      });
    }
  }
  await test('cleanup diagnostics preserve caller descriptors without invoking accessors', () => {
    let accesses = 0;
    const primary = Object.defineProperty(new Error('operation failed'), 'releaseError', {
      configurable: true,
      enumerable: true,
      get() { accesses++; throw new Error('getter must not run'); },
      set() { accesses++; throw new Error('setter must not run'); },
    });
    const before = Object.getOwnPropertyDescriptors(primary);
    const cleanup = new Error('unlink failed');
    const fixture = lockFixture({ unlinkSync() { throw cleanup; } });
    const result = thrownBy(() => fixture.run(() => { throw primary; }));
    assert.ok(result.failed);
    assert.strictEqual(result.error, primary);
    assert.deepStrictEqual(Object.getOwnPropertyDescriptors(primary), before);
    assert.strictEqual(accesses, 0);
    assert.strictEqual(fixture.getCleanupErrors(primary).releaseError, cleanup);
  });
  await test('successive cleanup diagnostics are immutable snapshots isolated by primary', () => {
    const primary = Object.freeze(new Error('primary'));
    const other = () => {};
    const closeError = new Error('close failed');
    const rollbackError = new Error('rollback failed');
    const untouched = getCleanupErrors(primary);
    assert.deepStrictEqual(untouched, {});
    recordCleanupError(primary, 'closeError', closeError);
    const first = getCleanupErrors(primary);
    recordCleanupError(primary, 'rollbackError', rollbackError);
    const second = getCleanupErrors(primary);
    assert.notStrictEqual(first, second);
    assert.deepStrictEqual(untouched, {});
    assert.deepStrictEqual(first, { closeError });
    assert.deepStrictEqual(second, { closeError, rollbackError });
    assert.ok(!Object.isFrozen(closeError));
    assert.ok(!Object.isFrozen(rollbackError));
    assert.ok([untouched, first, second].every(Object.isFrozen));
    assert.throws(() => { first.closeError = rollbackError; }, TypeError);
    recordCleanupError(primary, 'closeError', rollbackError);
    const third = getCleanupErrors(primary);
    assert.notStrictEqual(third, second);
    assert.deepStrictEqual(second, { closeError, rollbackError });
    assert.deepStrictEqual(third, { closeError: rollbackError, rollbackError });
    assert.ok(Object.isFrozen(third));
    assert.deepStrictEqual(getCleanupErrors(other), {});
    recordCleanupError(other, 'releaseError', rollbackError);
    assert.deepStrictEqual(getCleanupErrors(other), { releaseError: rollbackError });
    assert.strictEqual(getCleanupErrors(primary), third);
    assert.deepStrictEqual(Object.keys(primary), []);
  });
  for (const stage of ['initialize', 'previous-close']) {
    for (const [index, primary] of [null, undefined, Object.freeze(new Error('reload primary'))].entries()) {
      await test(`reload closes its unadopted handle and preserves ${stage} failure (${index})`, () => {
        const handles = [];
        const SQL = { Database: class {
          constructor() { this.id = handles.length; this.closes = 0; handles.push(this); }
          run() { if (stage === 'initialize') throw primary; }
          close() {
            this.closes++;
            if (stage === 'previous-close' && this.id === 0) throw primary;
            throw new Error('unadopted cleanup');
          }
        } };
        // Export only the existing private wrapper in this isolated exact-source module.
        const source = `${fs.readFileSync(STORE, 'utf8')}\nmodule.exports.testWrap = wrapSqlJsDatabase;`;
        const api = loadPrivate(STORE, {
          fs: { lstatSync() { throw Object.assign(new Error('absent'), { code: 'ENOENT' }); } },
          './file-lock': { ...lockModule, withStateStoreLock: (_path, callback) => callback() },
        }, source);
        const db = api.testWrap(SQL, 'synthetic.db');
        if (stage === 'previous-close') db.withSnapshot(() => {});
        const result = thrownBy(() => db.withSnapshot(() => assert.fail('must not adopt failed handle')));
        assert.ok(result.failed);
        assert.strictEqual(result.error, primary);
        assert.strictEqual(handles.at(-1).closes, 1);
        if (stage === 'previous-close') {
          assert.strictEqual(handles[0].closes, 1);
          assert.throws(() => db.withSnapshot(() => {}), /closed/);
        }
        db.close();
        assert.ok(handles.every(handle => handle.closes === 1));
      });
    }
  }
  await test('reload adopts a ready replacement and closes each owned handle once', () => {
    const calls = [];
    let next = 0;
    const SQL = { Database: class {
      constructor() { this.id = next++; }
      run() { calls.push(`ready:${this.id}`); }
      close() { calls.push(`close:${this.id}`); }
    } };
    const source = `${fs.readFileSync(STORE, 'utf8')}\nmodule.exports.testWrap = wrapSqlJsDatabase;`;
    const api = loadPrivate(STORE, {
      fs: { lstatSync() { throw Object.assign(new Error('absent'), { code: 'ENOENT' }); } },
      './file-lock': { ...lockModule, withStateStoreLock: (_path, callback) => callback() },
    }, source);
    const db = api.testWrap(SQL, 'synthetic.db');
    db.withSnapshot(() => {});
    db.withSnapshot(() => {});
    db.close(); db.close();
    assert.deepStrictEqual(calls, ['ready:0', 'ready:1', 'close:0', 'close:1']);
  });
  for (const [index, primary] of [null, undefined, false, 0, '', 'primitive',
    Object.freeze(new Error('frozen worker')), { get message() { throw new Error('getter'); } }].entries()) {
    await test(`worker reports bounded arbitrary mutation failure after close (${index})`, async () => {
      const filename = require.resolve('../../scripts/lib/control-pane/work-item-worker');
      const source = fs.readFileSync(filename, 'utf8');
      assert.strictEqual(source.split('mutate().then(').length, 2);
      const captured = source.replace('mutate().then(', 'module.exports = mutate().then(');
      const messages = [];
      let closes = 0;
      await loadPrivate(filename, {
        worker_threads: { workerData: { dbPath: ':memory:', action: 'claim', args: {} },
          parentPort: { postMessage(message) { messages.push(message); } } },
        '../state-store': { createStateStore: async () => ({
          _database: { transaction: fn => fn }, close() { closes++; throw new Error('close failed'); },
        }) },
        './work-item-mutations': { claimWorkItem() { throw primary; } },
      }, captured);
      assert.strictEqual(closes, 1);
      assert.strictEqual(messages.length, 1);
      assert.strictEqual(messages[0].ok, false);
      assert.strictEqual(typeof messages[0].error.message, 'string');
      assert.ok(messages[0].error.message.length <= 1024);
      if (index < 6) assert.strictEqual(messages[0].error.message, String(primary));
      if (index === 6) assert.strictEqual(messages[0].error.message, primary.message);
    });
  }
  await test('worker rejects close-only failure after successful mutation', async () => {
    const filename = require.resolve('../../scripts/lib/control-pane/work-item-worker');
    const source = fs.readFileSync(filename, 'utf8').replace('mutate().then(', 'module.exports = mutate().then(');
    const messages = [];
    await loadPrivate(filename, {
      worker_threads: { workerData: { dbPath: ':memory:', action: 'claim', args: {} },
        parentPort: { postMessage(message) { messages.push(message); } } },
      '../state-store': { createStateStore: async () => ({
        _database: { transaction: fn => fn }, close() { throw new Error('close-only'); },
      }) },
      './work-item-mutations': { claimWorkItem() { return 'committed'; } },
    }, source);
    assert.deepStrictEqual(messages, [{ ok: false, error: { message: 'close-only', code: undefined } }]);
  });
  await test('cleanup-only lock failure still rejects a successful operation', () => {
    const cleanup = new Error('close failed');
    const fixture = lockFixture({ closeSync() { throw cleanup; } });
    const result = thrownBy(() => fixture.run(() => 'committed'));
    assert.ok(result.failed);
    assert.strictEqual(result.error, cleanup);
  });
}


const item = id => ({ id, source: 'manual', title: id, status: 'open' });

async function run() {
  let passed = 0;
  let failed = 0;
  async function test(name, callback) {
    const directory = fs.mkdtempSync(path.join(os.tmpdir(), 'ecc-state-persistence-'));
    try {
      await callback(path.join(directory, 'state.db'));
      console.log(`  PASS ${name}`);
      passed += 1;
    } catch (error) {
      console.log(`  FAIL ${name}\n    ${error && error.stack ? error.stack : String(error)}`);
      failed += 1;
    } finally {
      fs.rmSync(directory, { recursive: true, force: true });
    }
  }

  await runSynthetic(test);
  if (process.argv.includes('--synthetic-only')) {
    console.log(`\nResults: Passed: ${passed}, Failed: ${failed}`);
    process.exitCode = failed ? 1 : 0;
    return;
  }

  await test('queries, migration inspection and closing never rewrite an existing database', async dbPath => {
    const initial = await createStateStore({ dbPath });
    initial.upsertWorkItem(item('saved'));
    initial.close();
    const before = fs.readFileSync(dbPath);
    const rename = fs.renameSync;
    let writes = 0;
    fs.renameSync = (from, to) => {
      if (to === dbPath) writes += 1;
      return rename(from, to);
    };
    try {
      const reader = await createStateStore({ dbPath });
      try {
        assert.ok(reader.getWorkItemById('saved'));
        reader.listWorkItems();
        reader.getStatus();
        assert.strictEqual(reader.getAppliedMigrations().length, 2);
        for (const method of ['get', 'all']) {
          const read = () => reader._database.prepare('SELECT id FROM work_items')[method]();
          assert.deepStrictEqual(read(), method === 'get' ? { id: 'saved' } : [{ id: 'saved' }]);
          reader._database.transaction(read)();
        }
      } finally { reader.close(); }
    } finally { fs.renameSync = rename; }
    assert.strictEqual(writes, 0);
    assert.deepStrictEqual(fs.readFileSync(dbPath), before);
  });

  const returningMutations = [
    {
      action: 'INSERT',
      sql: "INSERT INTO returning_probe VALUES (3, 'new'), (4, 'new') RETURNING id, value",
      returned: [{ id: 3, value: 'new' }, { id: 4, value: 'new' }],
      saved: [{ id: 1, value: 'original' }, { id: 2, value: 'original' }, { id: 3, value: 'new' }, { id: 4, value: 'new' }],
    },
    {
      action: 'UPDATE',
      sql: "UPDATE returning_probe SET value = 'updated' RETURNING id, value",
      returned: [{ id: 1, value: 'updated' }, { id: 2, value: 'updated' }],
      saved: [{ id: 1, value: 'updated' }, { id: 2, value: 'updated' }],
    },
    {
      action: 'DELETE',
      sql: 'DELETE FROM returning_probe RETURNING id, value',
      returned: [{ id: 1, value: 'original' }, { id: 2, value: 'original' }],
      saved: [],
    },
  ];
  for (const method of ['get', 'all']) {
    for (const transactional of [false, true]) {
      for (const mutation of returningMutations) {
        await test(`prepared ${method} persists ${mutation.action} RETURNING (${transactional ? 'query-only transaction' : 'standalone'})`, async dbPath => {
          const store = await createStateStore({ dbPath });
          try {
            store._database.exec("CREATE TABLE returning_probe (id INTEGER PRIMARY KEY, value TEXT NOT NULL); INSERT INTO returning_probe VALUES (1, 'original'), (2, 'original');");
            const before = fs.readFileSync(dbPath);
            const mutate = () => {
              const result = store._database.prepare(mutation.sql)[method]();
              if (method === 'get') assert.ok(mutation.returned.some(row => row.id === result.id && row.value === result.value));
              else assert.deepStrictEqual(result.sort((a, b) => a.id - b.id), mutation.returned);
              if (transactional) assert.deepStrictEqual(fs.readFileSync(dbPath), before, 'RETURNING must not publish before COMMIT');
            };
            if (transactional) store._database.transaction(mutate)();
            else mutate();
            assert.deepStrictEqual(store._database.prepare('SELECT id, value FROM returning_probe ORDER BY id').all(), mutation.saved,
              'the next snapshot must retain the mutation');
          } finally { store.close(); }
          const reopened = await createStateStore({ dbPath });
          try {
            assert.deepStrictEqual(reopened._database.prepare('SELECT id, value FROM returning_probe ORDER BY id').all(), mutation.saved);
          } finally { reopened.close(); }
        });
      }

      await test(`prepared ${method} persists no-row PRAGMA writes (${transactional ? 'query-only transaction' : 'standalone'})`, async dbPath => {
        const store = await createStateStore({ dbPath });
        try {
          const before = fs.readFileSync(dbPath);
          const mutate = () => {
            for (const pragma of ['user_version = 3252', 'application_id(2468)']) {
              const result = store._database.prepare(`PRAGMA ${pragma}`)[method]();
              assert.deepStrictEqual(result, method === 'get' ? null : []);
            }
            if (transactional) assert.deepStrictEqual(fs.readFileSync(dbPath), before, 'prepared PRAGMAs must not publish before COMMIT');
          };
          if (transactional) store._database.transaction(mutate)();
          else mutate();
          assert.strictEqual(store._database.prepare('PRAGMA user_version').get().user_version, 3252);
          assert.strictEqual(store._database.prepare('PRAGMA application_id').get().application_id, 2468);
        } finally { store.close(); }
        const reopened = await createStateStore({ dbPath });
        try {
          assert.strictEqual(reopened._database.prepare('PRAGMA user_version').get().user_version, 3252);
          assert.strictEqual(reopened._database.prepare('PRAGMA application_id').get().application_id, 2468);
        } finally { reopened.close(); }
      });
    }

    await test(`prepared ${method} RETURNING and PRAGMA writes roll back without changing disk`, async dbPath => {
      const store = await createStateStore({ dbPath });
      try {
        store._database.exec("CREATE TABLE returning_probe (id INTEGER PRIMARY KEY, value TEXT NOT NULL); INSERT INTO returning_probe VALUES (1, 'original'), (2, 'original');");
        const before = fs.readFileSync(dbPath);
        const failure = new Error('abort prepared writes');
        assert.throws(() => store._database.transaction(() => {
          for (const mutation of returningMutations) store._database.prepare(mutation.sql)[method]();
          store._database.prepare('PRAGMA user_version = 3252')[method]();
          assert.deepStrictEqual(fs.readFileSync(dbPath), before);
          throw failure;
        })(), error => error === failure);
        assert.deepStrictEqual(fs.readFileSync(dbPath), before);
        assert.deepStrictEqual(store._database.prepare('SELECT id, value FROM returning_probe ORDER BY id').all(),
          [{ id: 1, value: 'original' }, { id: 2, value: 'original' }]);
        assert.strictEqual(store._database.prepare('PRAGMA user_version').get().user_version, 0);
      } finally { store.close(); }
    });
  }

  await test('persistent PRAGMA changes survive snapshot reload and reopening', async dbPath => {
    const store = await createStateStore({ dbPath });
    try {
      assert.strictEqual(store._database.pragma('user_version = 3252'), undefined);
      assert.strictEqual(store._database.prepare('PRAGMA user_version').get().user_version, 3252);
      store._database.pragma('application_id(2468)');
    } finally { store.close(); }
    const reopened = await createStateStore({ dbPath });
    try {
      assert.strictEqual(reopened._database.prepare('PRAGMA user_version').get().user_version, 3252);
      assert.strictEqual(reopened._database.prepare('PRAGMA application_id').get().application_id, 2468);
    } finally { reopened.close(); }
  });

  await test('read-only and connection-local PRAGMAs never rewrite database bytes', async dbPath => {
    const store = await createStateStore({ dbPath });
    const before = fs.readFileSync(dbPath);
    const rename = fs.renameSync;
    let writes = 0;
    fs.renameSync = (from, to) => {
      if (to === dbPath) writes += 1;
      return rename(from, to);
    };
    try {
      store._database.pragma('user_version');
      store._database.pragma('table_info(work_items)');
      store._database.pragma('integrity_check');
      for (const method of ['get', 'all']) {
        const read = () => {
          for (const pragma of ['user_version', 'table_info(work_items)', 'integrity_check']) {
            store._database.prepare(`PRAGMA ${pragma}`)[method]();
          }
        };
        read();
        store._database.transaction(read)();
        store._database.withSnapshot(() => {
          store._database.prepare('PRAGMA cache_size = 512')[method]();
          assert.strictEqual(store._database.prepare('PRAGMA cache_size').get().cache_size, 512);
        });
      }
      store._database.transaction(() => {
        store._database.pragma('user_version');
        store._database.pragma('table_info(work_items)');
      })();
      store._database.withSnapshot(() => {
        store._database.pragma('cache_size = 256');
        assert.strictEqual(store._database.prepare('PRAGMA cache_size').get().cache_size, 256);
      });
      assert.strictEqual(writes, 0);
      assert.deepStrictEqual(fs.readFileSync(dbPath), before);
    } finally {
      fs.renameSync = rename;
      store.close();
    }
  });

  await test('PRAGMA persistence waits for commit and never commits a rolled-back transaction', async dbPath => {
    const store = await createStateStore({ dbPath });
    try {
      store._database.transaction(() => {
        store.upsertWorkItem(item('committed-pragma'));
        store._database.pragma('table_info(work_items)');
        store._database.pragma('user_version = 3252');
      })();
      store._database.transaction(() => store._database.pragma('application_id(2468)'))();
      assert.strictEqual(store._database.prepare('PRAGMA application_id').get().application_id, 2468);
      const before = fs.readFileSync(dbPath);
      assert.throws(() => store._database.transaction(() => {
        store.upsertWorkItem(item('rolled-back-pragma'));
        store._database.pragma('user_version = 9999');
        throw new Error('abort PRAGMA transaction');
      })(), /abort PRAGMA transaction/);
      assert.deepStrictEqual(fs.readFileSync(dbPath), before);
      assert.strictEqual(store._database.prepare('PRAGMA user_version').get().user_version, 3252);
      assert.deepStrictEqual(store.listWorkItems().items.map(row => row.id), ['committed-pragma']);
    } finally { store.close(); }
  });

  await test('failed persistence is discarded, releases the lock and cannot overwrite a later writer', async dbPath => {
    const first = await createStateStore({ dbPath });
    const second = await createStateStore({ dbPath });
    const before = fs.readFileSync(dbPath);
    const rename = fs.renameSync;
    const failure = new Error('simulated disk failure');
    try {
      fs.renameSync = (from, to) => {
        if (to === dbPath) throw failure;
        return rename(from, to);
      };
      try {
        assert.throws(() => first.upsertWorkItem(item('failed')), error => error === failure);
      } finally { fs.renameSync = rename; }
      assert.deepStrictEqual(fs.readFileSync(dbPath), before);
      assert.strictEqual(fs.existsSync(`${dbPath}.ecc-state.lock`), false);
      second.upsertWorkItem(item('other-process'));
      first.upsertWorkItem(item('retry'));
      assert.deepStrictEqual(first.listWorkItems().items.map(row => row.id).sort(), ['other-process', 'retry']);
    } finally {
      first.close();
      second.close();
    }
  });

  await test('transaction exceptions roll back, preserve the error and release the writer lock', async dbPath => {
    const store = await createStateStore({ dbPath });
    const before = fs.readFileSync(dbPath);
    const failure = new Error('cancel this transaction');
    try {
      assert.throws(() => store._database.transaction(() => {
        store.upsertWorkItem(item('rolled-back'));
        throw failure;
      })(), error => error === failure);
      assert.deepStrictEqual(fs.readFileSync(dbPath), before);
      assert.strictEqual(fs.existsSync(`${dbPath}.ecc-state.lock`), false);
      store.upsertWorkItem(item('next'));
      assert.deepStrictEqual(store.listWorkItems().items.map(row => row.id), ['next']);
    } finally { store.close(); }
  });

  await test('reloading a snapshot preserves foreign-key enforcement', async dbPath => {
    const store = await createStateStore({ dbPath });
    try {
      store._database.exec('CREATE TABLE parent (id INTEGER PRIMARY KEY); CREATE TABLE child (parent_id INTEGER REFERENCES parent(id));');
      assert.throws(() => store._database.exec('INSERT INTO child VALUES (42)'), /FOREIGN KEY constraint failed/);
      store._database.exec('INSERT INTO parent VALUES (42)');
      store._database.exec('INSERT INTO child VALUES (42)');
      assert.strictEqual(store._database.prepare('SELECT COUNT(*) AS count FROM child').get().count, 1);
    } finally { store.close(); }
  });

  await test('in-memory transactions roll back and closed handles cannot reopen silently', async () => {
    const store = await createStateStore({ dbPath: ':memory:' });
    store.upsertWorkItem(item('keep'));
    assert.throws(() => store._database.transaction(() => {
      store.upsertWorkItem(item('discard'));
      throw new Error('abort');
    })(), /abort/);
    assert.deepStrictEqual(store.listWorkItems().items.map(row => row.id), ['keep']);
    store.close();
    store.close();
    assert.throws(() => store.listWorkItems(), /closed/);
  });

  await test('failed rollback keeps the primary error and invalidates an uncertain in-memory handle', async () => {
    const store = await createStateStore({ dbPath: ':memory:' });
    const failure = new Error('application error after explicit rollback');
    assert.throws(() => store._database.transaction(() => {
      store._database.exec('ROLLBACK');
      throw failure;
    })(), error => error === failure && getCleanupErrors(error).rollbackError instanceof Error);
    assert.throws(() => store.listWorkItems(), /closed/);
    store.close();
  });

  await test('live and abandoned locks time out without stealing ownership or touching the database', async dbPath => {
    const lock = `${dbPath}.ecc-state.lock`;
    fs.writeFileSync(dbPath, 'untouched');
    for (const metadata of [{ pid: process.pid }, { pid: 999999999 }, null]) {
      const bytes = JSON.stringify(metadata);
      fs.writeFileSync(lock, bytes);
      fs.utimesSync(lock, new Date(0), new Date(0));
      assert.throws(() => withStateStoreLock(dbPath, () => assert.fail('lock was stolen'), { timeoutMs: 20 }),
        error => error.code === 'STATE_STORE_BUSY' && error.message.includes(lock));
      assert.strictEqual(fs.readFileSync(lock, 'utf8'), bytes);
      assert.strictEqual(fs.readFileSync(dbPath, 'utf8'), 'untouched');
      fs.unlinkSync(lock);
    }
  });

  await test('failed lock metadata writes release the owned file', async dbPath => {
    const write = fs.writeFileSync;
    const failure = new Error('metadata write failure');
    fs.writeFileSync = () => { throw failure; };
    try {
      assert.throws(() => withStateStoreLock(dbPath, () => assert.fail('callback should not run')), error => error === failure);
    } finally { fs.writeFileSync = write; }
    assert.strictEqual(fs.existsSync(`${dbPath}.ecc-state.lock`), false);
    assert.strictEqual(withStateStoreLock(dbPath, () => 'retry'), 'retry');
  });

  await test('callback failure remains primary even when lock cleanup also fails', async dbPath => {
    const unlink = fs.unlinkSync;
    const primary = new Error('operation failed');
    const cleanup = new Error('cleanup failed');
    const lock = `${dbPath}.ecc-state.lock`;
    fs.unlinkSync = file => {
      if (file === lock) throw cleanup;
      return unlink(file);
    };
    try {
      assert.throws(() => withStateStoreLock(dbPath, () => { throw primary; }),
        error => error === primary && getCleanupErrors(error).releaseError === cleanup);
    } finally {
      fs.unlinkSync = unlink;
      unlink(lock);
    }
    let caught = false;
    try { withStateStoreLock(dbPath, () => { throw null; }); }
    catch (error) { caught = true; assert.strictEqual(error, null); }
    assert.ok(caught, 'even falsy thrown values must propagate');
  });

  console.log(`\nResults: Passed: ${passed}, Failed: ${failed}`);
  process.exitCode = failed ? 1 : 0;
}

process.exitCode = 1;
run().catch(error => { console.error(error); process.exitCode = 1; });
