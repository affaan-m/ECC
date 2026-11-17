'use strict';

const fs = require('fs');
const os = require('os');
const path = require('path');
const { fork } = require('child_process');

// These utilities belong only to the two process-based regression fixtures.
async function withCleanup(callback, cleanups) {
  let failed = false;
  let primary;
  let value;
  try { value = await callback(); }
  catch (error) { failed = true; primary = error; }
  for (const cleanup of cleanups) {
    try { await cleanup(); }
    catch (error) { if (!failed) { failed = true; primary = error; } }
  }
  if (failed) throw primary;
  return value;
}

function startOwnedChild(script, args = [], dependencies = {}) {
  const forkChild = dependencies.fork || fork;
  const platform = dependencies.platform || process.platform;
  const kill = dependencies.kill || process.kill.bind(process);
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'ecc-state-child-'));
  const home = path.join(root, 'home');
  const tmp = path.join(root, 'tmp');
  let child;
  try {
    fs.mkdirSync(home); fs.mkdirSync(tmp);
    // Absolute fixture paths resolve dependencies from the checkout, even with
    // an isolated cwd. No package-private metadata or NODE_PATH is needed.
    child = forkChild(script, args, {
      execPath: process.execPath, execArgv: [], shell: false, detached: platform !== 'win32',
      cwd: root, stdio: ['ignore', 'pipe', 'pipe', 'ipc'],
      env: { PATH: path.dirname(process.execPath),
        HOME: home, USERPROFILE: home, APPDATA: home, LOCALAPPDATA: home,
        TMPDIR: tmp, TMP: tmp, TEMP: tmp, NODE_USE_ENV_PROXY: '0' },
    });
  } catch (error) {
    try { fs.rmSync(root, { recursive: true, force: true }); } catch (_cleanupError) { /* Primary wins. */ }
    throw error;
  }
  const observers = new Set();
  const waiters = new Set();
  const closeWaiters = new Set();
  let ownedPid = null;
  let closed = false;
  let ipcClosed = false;
  const closedStreams = new Set();
  let reaped = false;
  let exitCode = null;
  let exitSignal = null;
  let failed = false;
  let failure;
  let stderr = '';
  let captured = 0;
  let stopPromise;
  const fail = error => {
    if (!failed) { failed = true; failure = error; }
    for (const waiter of [...waiters]) waiter.reject(error);
  };
  const markClosed = () => {
    closed = true;
    for (const done of [...closeWaiters]) done(true);
  };
  // Some Node versions omit the aggregate close event after a parent-initiated
  // IPC disconnect. Require public confirmation of every owned resource instead.
  const checkClosed = () => {
    if (reaped && ipcClosed && closedStreams.size === 2) markClosed();
  };
  child.once('disconnect', () => { ipcClosed = true; checkClosed(); });
  child.once('spawn', () => { if (Number.isInteger(child.pid) && child.pid > 0) ownedPid = child.pid; });
  child.on('error', fail);
  child.once('exit', (code, signal) => {
    reaped = true; exitCode = code; exitSignal = signal;
    const error = new Error(`Fixture exited (${code}, ${signal || 'no signal'}): ${stderr}`);
    for (const waiter of [...waiters]) waiter.reject(error);
    checkClosed();
  });
  child.once('close', markClosed);
  child.on('message', message => {
    for (const observer of [...observers]) {
      try { observer(message); } catch (error) { fail(error); }
    }
    for (const waiter of [...waiters]) waiter.check(message);
  });
  for (const stream of [child.stdout, child.stderr]) {
    stream.once('close', () => { closedStreams.add(stream); checkClosed(); });
    stream.on('data', data => {
      captured += data.length;
      if (captured > 128 * 1024) { fail(new Error('Fixture output exceeded 128 KiB')); return; }
      if (stream === child.stderr) stderr += data.toString();
    });
    stream.on('error', fail);
  }
  function waitClosed(milliseconds) {
    if (closed) return Promise.resolve(true);
    return new Promise(resolve => {
      let timer;
      const done = value => { clearTimeout(timer); closeWaiters.delete(done); resolve(value); };
      closeWaiters.add(done);
      timer = setTimeout(() => done(false), milliseconds);
    });
  }
  function signalOwned(signal) {
    if (ownedPid === null) return;
    try {
      if (platform === 'win32') { if (!reaped) child.kill(signal); }
      else kill(-ownedPid, signal);
    } catch (error) { if (!error || error.code !== 'ESRCH') throw error; }
  }
  const client = {
    child,
    get diagnostics() { return { closed, reaped, captured, failed }; },
    observe(callback) { observers.add(callback); return () => observers.delete(callback); },
    waitFor(predicate, timeoutMs = 10000) {
      if (failed || reaped) return Promise.reject(failed ? failure : new Error('Fixture already exited'));
      return new Promise((resolve, reject) => {
        let timer;
        const finish = (fn, value) => { clearTimeout(timer); waiters.delete(waiter); fn(value); };
        const waiter = {
          check(message) {
            try { if (predicate(message)) finish(resolve, message); }
            catch (error) { finish(reject, error); }
          },
          reject: error => finish(reject, error),
        };
        waiters.add(waiter);
        timer = setTimeout(() => waiter.reject(new Error(`Fixture response timed out: ${stderr}`)), timeoutMs);
      });
    },
    async completion() {
      if (!await waitClosed(10000)) throw new Error('Fixture completion timed out');
      if (failed) throw failure;
      return { status: exitCode, signal: exitSignal, stderr };
    },
    send(message) {
      try {
        if (!child.connected) throw new Error('Fixture IPC disconnected');
        child.send(message, error => { if (error) fail(error); });
      } catch (error) { fail(error); }
    },
    stop() {
      if (stopPromise) return stopPromise;
      stopPromise = withCleanup(async () => {
        // Disconnect asks the fixture to close normally. If it cannot, escalate
        // only this newly spawned child/group; retain the deadline through close.
        if (child.connected) {
          try { child.disconnect(); } catch (error) { fail(error); }
        }
        if (await waitClosed(300)) {
          if (reaped && (exitCode !== 0 || exitSignal !== null)) {
            throw new Error(`Fixture closed unsuccessfully (${exitCode}, ${exitSignal || 'no signal'}): ${stderr}`);
          }
          return;
        }
        let signalFailed = false;
        let signalError;
        try { signalOwned('SIGTERM'); } catch (error) { signalFailed = true; signalError = error; }
        await new Promise(resolve => setTimeout(resolve, 300));
        try { signalOwned('SIGKILL'); } catch (error) { if (!signalFailed) { signalFailed = true; signalError = error; } }
        if (!await waitClosed(1000)) {
          return withCleanup(() => {
            if (signalFailed) throw signalError;
            throw new Error('Fixture did not close after termination; pipes forcibly closed');
          }, [() => child.stdout.destroy(), () => child.stderr.destroy(), () => waitClosed(100)]);
        }
        if (signalFailed) throw signalError;
      }, [() => {
        for (const waiter of [...waiters]) waiter.reject(new Error('Fixture stopped'));
        observers.clear();
        fs.rmSync(root, { recursive: true, force: true });
      }]).then(() => {
        // A successful close does not erase an earlier IPC/stream/disconnect
        // failure. Report it only after every owned cleanup stage was attempted.
        if (failed) throw failure;
      }, cleanupError => {
        if (failed) throw failure;
        throw cleanupError;
      });
      return stopPromise;
    },
  };
  return client;
}

async function withOwnedChildren(count, start, callback) {
  const children = [];
  return withCleanup(async () => {
    for (let index = 0; index < count; index += 1) children.push(await start(index));
    return callback(children);
  }, [() => withCleanup(() => {}, children.map(child => () => child.stop()))]);
}

module.exports = { startOwnedChild, withOwnedChildren, withCleanup };

function runWorker() {
  const { createStateStore } = require('../../../scripts/lib/state-store');
  process.exitCode = 1;
  let store;
  process.on('message', async ({ id, action, dbPath, worker, count = 1 }) => {
    try {
      if (action === 'open') {
        store = await createStateStore({ dbPath });
      } else if (action === 'write') {
        for (let index = 0; index < count; index += 1) {
          store.upsertWorkItem({
            id: `${worker}-${index}`, source: 'manual', title: `Task ${worker}-${index}`, status: 'open'
          });
        }
      } else if (action === 'increment') {
        for (let index = 0; index < count; index += 1) {
          store._database.transaction(() => {
            const item = store.getWorkItemById('counter');
            // Widen real transaction overlap without assuming which worker wins.
            Atomics.wait(new Int32Array(new SharedArrayBuffer(4)), 0, 0, 15);
            store.upsertWorkItem({ ...item, metadata: { value: item.metadata.value + 1 } });
          })();
        }
      } else if (action === 'close') {
        store.close();
        store = null;
      } else {
        throw new Error(`Unknown fixture action: ${action}`);
      }
      if (process.connected) process.send({ id, ok: true });
    } catch (error) {
      if (process.connected) process.send({ id, ok: false, error: error && error.stack ? String(error.stack).slice(0, 4096) : String(error).slice(0, 4096) });
    }
  });
  process.on('disconnect', () => {
    try { if (store) store.close(); process.exitCode = 0; }
    catch (error) { console.error(error); process.exitCode = 1; }
  });
  process.send({ ready: true });
}

if (require.main === module) runWorker();
