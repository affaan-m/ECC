'use strict';

const { parentPort, workerData } = require('worker_threads');
const { createStateStore } = require('../state-store');
const { attachCleanupError } = require('../state-store/file-lock');
const { claimWorkItem, moveWorkItem } = require('./work-item-mutations');

/** Complete one board mutation away from the HTTP event loop, then close. */
async function mutate() {
  const { dbPath, action, args } = workerData;
  const mutation = action === 'claim' ? claimWorkItem : action === 'move' ? moveWorkItem : null;
  if (!mutation) throw new Error('Unknown work-item mutation');
  const store = await createStateStore({ dbPath });
  let result;
  let failed = false;
  let primary;
  try { result = store._database.transaction(() => mutation(store, args))(); }
  catch (error) { failed = true; primary = error; }
  try { store.close(); }
  catch (error) {
    if (failed) attachCleanupError(primary, 'closeError', error);
    else { failed = true; primary = error; }
  }
  if (failed) throw primary;
  return result;
}

function serializeError(error) {
  let message = 'Work-item mutation failed';
  let code;
  try {
    if (error && typeof error.message === 'string') message = error.message.slice(0, 1024);
    else if (error === null || typeof error !== 'object') message = String(error).slice(0, 1024);
  } catch (_error) { /* A throwing conversion must not prevent the failure response. */ }
  try {
    if (error && typeof error.code === 'string') code = error.code.slice(0, 128);
  } catch (_error) { /* Optional diagnostic. */ }
  return { message, code };
}

mutate().then(
  result => parentPort.postMessage({ ok: true, result }),
  error => parentPort.postMessage({ ok: false, error: serializeError(error) })
);
