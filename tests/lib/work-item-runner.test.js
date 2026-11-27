'use strict';

const assert = require('assert');
const { EventEmitter } = require('events');
const fs = require('fs');
const path = require('path');
const vm = require('vm');
const { createRequire } = require('module');

const RUNNER = require.resolve('../../scripts/lib/control-pane/work-item-runner');
const nextTurn = () => new Promise(resolve => setImmediate(resolve));

async function withFakeWorkers(callback) {
  const workers = [];
  const requests = [];
  let constructorFailures = 0;
  let constructionAttempts = 0;
  class FakeWorker extends EventEmitter {
    constructor(filename, options) {
      super();
      constructionAttempts += 1;
      if (constructorFailures > 0) {
        constructorFailures -= 1;
        throw new Error('worker construction failed');
      }
      this.filename = filename;
      this.options = options;
      this.exited = false;
      workers.push(this);
    }

    exit(code = 0) {
      assert.strictEqual(this.exited, false, 'a worker can only exit once');
      this.exited = true;
      this.emit('exit', code);
    }

    finish(result = 'done') {
      this.emit('message', { ok: true, result });
      this.exit();
    }
  }

  const module = { exports: {} };
  const nativeRequire = createRequire(RUNNER);
  const localRequire = id => id === 'worker_threads' ? { Worker: FakeWorker } : nativeRequire(id);
  vm.compileFunction(fs.readFileSync(RUNNER, 'utf8'),
    ['exports', 'require', 'module', '__filename', '__dirname'], { filename: RUNNER })(
    module.exports, localRequire, module, RUNNER, path.dirname(RUNNER));
  const { runWorkItemMutation } = module.exports;
  const context = {
    workers,
    get constructionAttempts() { return constructionAttempts; },
    failNextConstructor() { constructorFailures += 1; },
    request(dbPath = 'synthetic-state.db', action = 'claim') {
      const request = { settled: false };
      request.result = new Promise(resolve => {
        const finish = result => {
          request.settled = true;
          clearTimeout(timer);
          resolve(result);
        };
        const timer = setTimeout(() => finish({ ok: false, error: new Error('Synthetic worker request never settled') }), 2000);
        Promise.resolve().then(() => runWorkItemMutation(dbPath, action, { id: 'synthetic-task' }))
          .then(value => finish({ ok: true, value }), error => finish({ ok: false, error }));
      });
      requests.push(request);
      return request;
    }
  };
  try {
    await callback(context);
  } finally {
    // Failed assertions still drain every synthetic worker and rejection.
    await nextTurn();
    for (const worker of workers) {
      if (!worker.exited) worker.finish();
    }
    await Promise.all(requests.map(request => request.result));
  }
}

async function assertBusy(request) {
  await nextTurn();
  assert.strictEqual(request.settled, true, 'over-capacity requests must reject without waiting or queuing');
  const result = await request.result;
  assert.strictEqual(result.ok, false);
  assert.strictEqual(result.error.code, 'STATE_STORE_BUSY');
}

async function run() {
  let passed = 0;
  let failed = 0;
  async function test(name, callback) {
    try {
      await withFakeWorkers(callback);
      console.log(`  PASS ${name}`);
      passed += 1;
    } catch (error) {
      console.log(`  FAIL ${name}\n    ${error && error.stack ? error.stack : String(error)}`);
      failed += 1;
    }
  }

  await test('burst requests share a process-wide two-worker limit without queuing', async context => {
    const requests = Array.from({ length: 20 }, (_, index) => context.request(`state-${index}.db`, index % 2 ? 'move' : 'claim'));
    await nextTurn();
    assert.strictEqual(context.constructionAttempts, 2, 'capacity must be checked before constructing another worker');
    assert.strictEqual(context.workers.length, 2);
    await Promise.all(requests.slice(2).map(assertBusy));
    context.workers[0].finish('first');
    context.workers[1].finish('second');
    assert.deepStrictEqual(await Promise.all(requests.slice(0, 2).map(request => request.result)), [
      { ok: true, value: 'first' }, { ok: true, value: 'second' }
    ]);
    await nextTurn();
    assert.strictEqual(context.constructionAttempts, 2, 'rejected work must not start later');
    const replacement = context.request();
    await nextTurn();
    context.workers[2].finish('replacement');
    assert.deepStrictEqual(await replacement.result, { ok: true, value: 'replacement' });
  });

  await test('a result message cannot settle the request or release capacity before exit', async context => {
    const first = context.request();
    context.request();
    await nextTurn();
    context.workers[0].emit('message', { ok: true, result: 'acknowledged' });
    await nextTurn();
    assert.strictEqual(first.settled, false, 'a worker that has not exited still owns its slot');
    await assertBusy(context.request());
    assert.strictEqual(context.constructionAttempts, 2);
    context.workers[0].exit();
    assert.deepStrictEqual(await first.result, { ok: true, value: 'acknowledged' });
    const replacement = context.request();
    await nextTurn();
    assert.strictEqual(context.workers.length, 3);
    context.workers[2].finish();
    assert.strictEqual((await replacement.result).ok, true);
  });

  await test('worker errors retain capacity until exit and preserve the original failure', async context => {
    const first = context.request();
    context.request();
    await nextTurn();
    const failure = new Error('worker execution failed');
    context.workers[0].emit('error', failure);
    await nextTurn();
    assert.strictEqual(first.settled, false);
    await assertBusy(context.request());
    assert.strictEqual(context.constructionAttempts, 2);
    context.workers[0].exit(1);
    const result = await first.result;
    assert.strictEqual(result.ok, false);
    assert.strictEqual(result.error, failure);
    const replacement = context.request();
    await nextTurn();
    context.workers[2].finish();
    assert.strictEqual((await replacement.result).ok, true);
  });

  await test('reported mutation failures reject after exit and then release capacity', async context => {
    const first = context.request();
    context.request();
    await nextTurn();
    context.workers[0].emit('message', { ok: false, error: { message: 'database is busy', code: 'STATE_STORE_BUSY' } });
    await nextTurn();
    assert.strictEqual(first.settled, false);
    await assertBusy(context.request());
    context.workers[0].exit();
    const result = await first.result;
    assert.strictEqual(result.ok, false);
    assert.strictEqual(result.error.message, 'database is busy');
    assert.strictEqual(result.error.code, 'STATE_STORE_BUSY');
    const replacement = context.request();
    await nextTurn();
    context.workers[2].finish();
    assert.strictEqual((await replacement.result).ok, true);
  });

  await test('constructor failures release capacity immediately', async context => {
    context.failNextConstructor();
    const failed = await context.request().result;
    assert.strictEqual(failed.ok, false);
    assert.match(failed.error.message, /worker construction failed/);
    const first = context.request();
    const second = context.request();
    await nextTurn();
    assert.strictEqual(context.workers.length, 2);
    assert.strictEqual(context.constructionAttempts, 3);
    await assertBusy(context.request());
    assert.strictEqual(context.constructionAttempts, 3);
    context.workers.forEach(worker => worker.finish());
    assert.ok((await first.result).ok && (await second.result).ok);
  });

  await test('exiting without a message rejects and releases capacity', async context => {
    const first = context.request();
    context.request();
    await nextTurn();
    context.workers[0].exit(0);
    const result = await first.result;
    assert.strictEqual(result.ok, false);
    assert.match(result.error.message, /exit.*without.*result/i);
    const replacement = context.request();
    await nextTurn();
    assert.strictEqual(context.workers.length, 3);
    await assertBusy(context.request());
    context.workers[2].finish();
    assert.strictEqual((await replacement.result).ok, true);
  });

  await test('a nonzero exit cannot turn a premature success message into success', async context => {
    const request = context.request();
    await nextTurn();
    context.workers[0].emit('message', { ok: true, result: 'premature' });
    context.workers[0].exit(1);
    const result = await request.result;
    assert.strictEqual(result.ok, false);
    assert.match(result.error.message, /exit/i);
  });


  for (const response of [true, 'bad', {}, { ok: 1, result: 'wrong' }, { ok: false },
    { ok: false, error: null }, { ok: false, error: { message: 7 } },
    { ok: false, error: { message: 'bad', code: {} } }]) {
    await test(`malformed worker response rejects after exit (${JSON.stringify(response)})`, async context => {
      const request = context.request();
      await nextTurn();
      context.workers[0].emit('message', response);
      await nextTurn();
      assert.strictEqual(request.settled, false);
      assert.doesNotThrow(() => context.workers[0].exit());
      const result = await request.result;
      assert.strictEqual(result.ok, false);
      assert.match(result.error.message, /invalid.*response/i);
    });
  }
  await test('disconnect and a never-exiting worker keep their slots occupied', async context => {
    const first = context.request();
    const second = context.request();
    await nextTurn();
    context.workers[0].emit('disconnect');
    context.workers[1].emit('message', { ok: true, result: 'not exited' });
    await assertBusy(context.request());
    assert.strictEqual(first.settled, false);
    assert.strictEqual(second.settled, false);
    assert.strictEqual(context.constructionAttempts, 2);
    // Fake workers are explicitly drained by the harness, never terminated by production.
  });

  console.log(`\nResults: Passed: ${passed}, Failed: ${failed}`);
  process.exitCode = failed ? 1 : 0;
}

process.exitCode = 1;
run().catch(error => { console.error(error); process.exitCode = 1; });
