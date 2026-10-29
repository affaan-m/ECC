'use strict';

const assert = require('assert');
const fs = require('fs');
const http = require('http');
const os = require('os');
const path = require('path');
const { startOwnedChild, withCleanup } = require('./helpers/state-store-worker');
const { createStateStore } = require('../../scripts/lib/state-store');

const FIXTURE = path.join(__dirname, 'helpers', 'control-pane-contention-server.js');

function request(url, method = 'GET', body, timeoutMs = 1000, onRequest = () => {}) {
  return new Promise((resolve, reject) => {
    let settled = false;
    let timer;
    let response;
    const finish = (failed, error, value) => {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      if (failed) {
        try { if (response) response.destroy(); } catch (_cleanupError) { /* Primary wins. */ }
        try { req.destroy(); } catch (_cleanupError) { /* Primary wins. */ }
        reject(error);
      }
      else resolve(value);
    };
    const req = http.request(url, { method, agent: false, headers: { 'Content-Type': 'application/json' } }, res => {
      if (settled) { res.destroy(); return; }
      response = res;
      let text = '';
      let bytes = 0;
      res.setEncoding('utf8');
      res.on('data', data => {
        bytes += Buffer.byteLength(data);
        if (bytes > 128 * 1024) finish(true, new Error('HTTP fixture response exceeded 128 KiB'));
        else text += data;
      });
      res.on('error', error => finish(true, error));
      res.on('close', () => { if (!res.complete) finish(true, new Error('HTTP fixture response closed before completion')); });
      res.on('aborted', () => finish(true, new Error('HTTP fixture response aborted')));
      res.on('end', () => {
        try { finish(false, null, { status: res.statusCode, headers: res.headers, body: JSON.parse(text) }); }
        catch (error) { finish(true, error); }
      });
    });
    // A total deadline covers headers and body, even if bytes keep arriving.
    timer = setTimeout(() => finish(true, new Error(`HTTP ${method} timed out after ${timeoutMs}ms`)), timeoutMs);
    req.on('error', error => finish(true, error));
    try { onRequest(req); req.end(body === undefined ? undefined : JSON.stringify(body)); }
    catch (error) { finish(true, error); }
  });
}

async function startServer(dbPath, readOnly = false) {
  const client = startOwnedChild(FIXTURE, [dbPath, readOnly ? 'read-only' : 'editable']);
  let metrics = { active: 0, peak: 0, started: 0, exited: 0, received: 0, disconnected: 0 };
  const observers = new Set();
  client.observe(message => {
    if (message && message.type === 'workers') {
      metrics = message;
      for (const notify of observers) notify();
    }
  });
  let ready;
  try { ready = await client.waitFor(message => message && message.type === 'ready'); }
  catch (error) { return withCleanup(() => { throw error; }, [() => client.stop()]); }
  return {
    url: ready.url,
    get metrics() { return metrics; },
    observe(fn) { observers.add(fn); return () => observers.delete(fn); },
    mutationReceived() { return client.waitFor(message => message && message.type === 'mutation-received', 5000); },
    close: () => client.stop(),
  };
}

function waitForObservation(server, predicate, timeoutMs = 3000) {
  return new Promise((resolve, reject) => {
    let unsubscribe;
    const timer = setTimeout(() => {
      unsubscribe();
      reject(new Error(`Timed out waiting for worker lifecycle: ${JSON.stringify(server.metrics)}`));
    }, timeoutMs);
    function check() {
      if (!predicate()) return;
      clearTimeout(timer);
      unsubscribe();
      resolve();
    }
    unsubscribe = server.observe(check);
    check();
  });
}

async function holdFixtureLock(dbPath) {
  const lockPath = `${dbPath}.ecc-state.lock`;
  const fd = fs.openSync(lockPath, 'wx', 0o600);
  let released = false;
  const release = () => {
    if (released) return;
    released = true;
    return withCleanup(() => fs.unlinkSync(lockPath), [() => fs.closeSync(fd)]);
  };
  try { fs.writeFileSync(fd, JSON.stringify({ pid: process.pid, hostname: os.hostname() })); }
  catch (error) { return withCleanup(() => { throw error; }, [release]); }
  return release;
}

async function burstScenario(server, dbPath) {
  const bytesBefore = fs.readFileSync(dbPath);
  const releaseLock = await holdFixtureLock(dbPath);
  const results = [];
  const requests = [];
  let resolveRejected;
  const sixRejected = new Promise(resolve => { resolveRejected = resolve; });
  return withCleanup(async () => {
    for (let index = 0; index < 8; index += 1) {
      requests.push(request(`${server.url}/api/work-items/burst-${index}/claim`, 'POST', { owner: `owner-${index}` }, 12000)
        .then(result => {
          results.push({ index, ...result });
          if (results.filter(item => item.status === 503).length >= 6) resolveRejected();
          return result;
        }, error => ({ transportError: error })));
    }
    await waitForObservation(server, () => server.metrics.received >= 8);
    await waitForObservation(server, () => server.metrics.started >= 2);
    // Response completion is also observed; no sleep guesses how long Worker
    // construction or request body parsing needs on the current machine.
    let timer;
    try {
      await Promise.race([
        sixRejected,
        new Promise((_, reject) => { timer = setTimeout(() => reject(new Error(`Excess requests did not promptly return 503; peak workers=${server.metrics.peak}`)), 1500); })
      ]);
    } finally {
      clearTimeout(timer);
    }
    assert.strictEqual(server.metrics.started, 2, 'Overflow must not start additional workers');
    assert.strictEqual(server.metrics.peak, 2);
    assert.strictEqual(results.length, 6, 'Only the six rejected requests complete while lock is held');
    for (const result of results) {
      assert.strictEqual(result.status, 503);
      assert.strictEqual(result.body.code, 'STATE_STORE_BUSY');
      assert.ok(Number(result.headers['retry-after']) > 0);
    }
    assert.strictEqual((await request(`${server.url}/api/health`)).status, 200);
    const snapshot = await request(`${server.url}/api/snapshot`, 'GET', undefined, 3000);
    assert.strictEqual(snapshot.status, 200);
    assert.deepStrictEqual(fs.readFileSync(dbPath), bytesBefore);
    const rejected = results.map(result => result.index);
    await releaseLock();
    await Promise.all(requests);
    await waitForObservation(server, () => server.metrics.active === 0);
    assert.strictEqual(results.filter(result => result.status === 200).length, 2);
    assert.strictEqual(server.metrics.started, 2, 'Rejected requests must never execute later');
    const store = await createStateStore({ dbPath });
    await withCleanup(() => {
      for (const index of rejected) assert.strictEqual(store.getWorkItemById(`burst-${index}`).owner, null);
    }, [() => store.close()]);
    const retry = await request(`${server.url}/api/work-items/burst-${rejected[0]}/claim`, 'POST', { owner: 'retry-owner' }, 5000);
    assert.strictEqual(retry.status, 200);
    assert.strictEqual(retry.body.item.owner, 'retry-owner');
  }, [releaseLock, () => Promise.all(requests)]);
}

async function withServer(readOnly, fn) {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'ecc-http-contention-'));
  const dbPath = path.join(dir, 'state.db');
  let server;
  return withCleanup(async () => {
    const store = await createStateStore({ dbPath });
    await withCleanup(() => {
      store.upsertWorkItem({ id: 'task', title: 'Synthetic board task', source: 'manual', status: 'open' });
      for (let index = 0; index < 8; index += 1) {
        store.upsertWorkItem({ id: `burst-${index}`, title: `Burst task ${index}`, source: 'manual', status: 'open' });
      }
    }, [() => store.close()]);
    server = await startServer(dbPath, readOnly);
    return await fn(server, dbPath);
  }, [() => { if (server) return server.close(); },
    () => fs.rmSync(dir, { recursive: true, force: true })]);
}

async function disconnectScenario(server, dbPath) {
  const releaseLock = await holdFixtureLock(dbPath);
  let disconnectedRequest;
  const abandoned = request(`${server.url}/api/work-items/burst-0/claim`, 'POST', { owner: 'abandoned-client' }, 12000,
    req => { disconnectedRequest = req; }).catch(error => ({ error }));
  const accepted = request(`${server.url}/api/work-items/burst-1/claim`, 'POST', { owner: 'connected-client' }, 12000)
    .catch(error => ({ error }));
  await withCleanup(async () => {
    await waitForObservation(server, () => server.metrics.active === 2);
    disconnectedRequest.destroy(new Error('Intentional client disconnect'));
    await waitForObservation(server, () => server.metrics.disconnected === 1);
    const excess = await request(`${server.url}/api/work-items/burst-2/claim`, 'POST', { owner: 'excess-client' });
    assert.strictEqual(excess.status, 503, 'Disconnect must not release a slot while its worker is still alive');
    assert.strictEqual(server.metrics.started, 2);
    assert.strictEqual(server.metrics.active, 2);
  }, [releaseLock, () => abandoned, () => accepted]);
  await waitForObservation(server, () => server.metrics.active === 0);
  const retry = await request(`${server.url}/api/work-items/burst-2/claim`, 'POST', { owner: 'retry-client' }, 5000);
  assert.strictEqual(retry.status, 200, 'Actual worker exits must restore capacity');
}

async function contentionScenario() {
  return withServer(false, async (server, dbPath) => {
    const bytesBefore = fs.readFileSync(dbPath);
    const releaseLock = await holdFixtureLock(dbPath);
    let outcome;
    let mutation;
    await withCleanup(async () => {
      const received = server.mutationReceived();
      let settled = false;
      mutation = request(`${server.url}/api/work-items/task/claim`, 'POST', { owner: 'alice' }, 12000)
        .then(result => { settled = true; return result; }, error => { settled = true; return { transportError: error }; });
      await received;
      let healthError = null;
      let healthChecks = 0;
      let snapshotChecks = 0;
      // Probe continuously after actual HTTP receipt, including asynchronous
      // database initialization. No timing guess about when lock wait begins.
      while (!settled) {
        try {
          const health = await request(`${server.url}/api/health`);
          assert.strictEqual(health.status, 200);
          healthChecks += 1;
          const snapshot = await request(`${server.url}/api/snapshot`, 'GET', undefined, 3000);
          assert.strictEqual(snapshot.status, 200);
          assert.ok(snapshot.body.workItems.items.some(item => item.id === 'task'));
          snapshotChecks += 1;
        } catch (error) {
          healthError = error.message;
          break;
        }
      }
      const result = await mutation;
      if (result.transportError) throw result.transportError;
      outcome = { result, healthError, healthChecks, snapshotChecks };
    }, [releaseLock, () => mutation]);
    assert.deepStrictEqual(fs.readFileSync(dbPath), bytesBefore, 'Timed-out mutation must not change database bytes');
    const store = await createStateStore({ dbPath });
    await withCleanup(() => {
      const item = store.getWorkItemById('task');
      assert.strictEqual(item.status, 'open');
      assert.strictEqual(item.owner, null);
    }, [() => store.close()]);
    return outcome;
  });
}

async function run() {
  let passed = 0;
  let failed = 0;
  async function test(name, fn) {
    try {
      await fn();
      console.log(`  PASS ${name}`);
      passed += 1;
    } catch (error) {
      console.log(`  FAIL ${name}\n    ${error && error.message ? error.message : String(error)}`);
      failed += 1;
    }
  }
  console.log('\n=== Testing control-pane mutation contention ===\n');
  const contention = await contentionScenario();
  await test('health and snapshots remain responsive while a board mutation waits for another database writer', () => {
    assert.strictEqual(contention.healthError, null, contention.healthError || undefined);
    assert.ok(contention.healthChecks > 0);
    assert.ok(contention.snapshotChecks > 0);
  });
  await test('lock timeout is retryable HTTP 503 with Retry-After', () => {
    assert.strictEqual(contention.result.status, 503);
    assert.ok(Number(contention.result.headers['retry-after']) > 0, 'Retry-After must give a positive delay');
    assert.strictEqual(contention.result.body.ok, false);
    assert.strictEqual(contention.result.body.code, 'STATE_STORE_BUSY');
  });
  await test('claim and move still save their changes, while invalid edits return 400', () => withServer(false, async (server, dbPath) => {
    const claim = await request(`${server.url}/api/work-items/task/claim`, 'POST', { owner: 'alice', as: 'human' }, 5000);
    assert.strictEqual(claim.status, 200);
    assert.strictEqual(claim.body.item.owner, 'alice');
    assert.strictEqual(claim.body.item.status, 'running');
    const move = await request(`${server.url}/api/work-items/task/move`, 'POST', { lane: 'blocked' }, 5000);
    assert.strictEqual(move.status, 200);
    assert.strictEqual(move.body.item.status, 'blocked');
    const invalid = await request(`${server.url}/api/work-items/task/move`, 'POST', { lane: 'imaginary' }, 5000);
    assert.strictEqual(invalid.status, 400);
    assert.strictEqual(invalid.body.ok, false);
    const store = await createStateStore({ dbPath });
    await withCleanup(() => {
      const item = store.getWorkItemById('task');
      assert.strictEqual(item.owner, 'alice');
      assert.strictEqual(item.status, 'blocked');
      assert.strictEqual(item.metadata.assigneeKind, 'human');
    }, [() => store.close()]);
  }));
  await test('read-only mode rejects board edits before database work', () => withServer(true, async server => {
    for (const action of ['claim', 'move']) {
      const result = await request(`${server.url}/api/work-items/task/${action}`, 'POST', { owner: 'alice', lane: 'done' });
      assert.strictEqual(result.status, 403);
    }
  }));
  await test('an eight-request burst caps live workers at two and rejects excess work without queuing', () => withServer(false, burstScenario));
  await test('a disconnected HTTP client retains its worker slot until actual exit', () => withServer(false, disconnectScenario));
  console.log(`\nResults: Passed: ${passed}, Failed: ${failed}`);
  process.exitCode = failed ? 1 : 0;
}
process.exitCode = 1;
run().catch(error => { console.error(error); process.exitCode = 1; });
