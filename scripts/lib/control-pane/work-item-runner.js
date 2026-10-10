'use strict';

const path = require('path');
const { Worker } = require('worker_threads');

const MAX_ACTIVE_MUTATIONS = 2;
let activeMutations = 0;

/** Bound workers in this loaded runner/isolate; reject excess work without queuing. */
function runWorkItemMutation(dbPath, action, args) {
  return new Promise((resolve, reject) => {
    if (activeMutations >= MAX_ACTIVE_MUTATIONS) {
      reject(Object.assign(new Error('Too many work-item mutations are running. Retry after an operation finishes.'),
        { code: 'STATE_STORE_BUSY' }));
      return;
    }
    activeMutations += 1;
    let worker;
    try {
      worker = new Worker(path.join(__dirname, 'work-item-worker.js'), {
        workerData: { dbPath, action, args }
      });
    } catch (error) {
      activeMutations -= 1;
      reject(error);
      return;
    }
    let response;
    let workerError;
    let failed = false;
    worker.once('message', message => { response = message; });
    worker.once('error', error => { failed = true; workerError = error; });
    worker.once('exit', code => {
      // Keep the slot until the thread is gone, even after a message/error.
      activeMutations -= 1;
      if (failed) { reject(workerError); return; }
      if (code !== 0 || response === undefined) {
        reject(new Error(`Work-item worker exited without a successful result (${code})`));
        return;
      }
      // Worker messages are structured clones from our own helper, but malformed
      // results still must reject instead of throwing outside the Promise executor.
      if (!response || typeof response !== 'object' || Array.isArray(response)
        || typeof response.ok !== 'boolean'
        || (response.ok === false && (!response.error || typeof response.error !== 'object'
          || typeof response.error.message !== 'string'
          || (response.error.code !== undefined && typeof response.error.code !== 'string')))) {
        reject(new Error('Invalid work-item worker response'));
      } else if (response.ok) resolve(response.result);
      else reject(Object.assign(new Error(response.error.message), { code: response.error.code }));
    });
    // Let the worker exit naturally after closing the store. Terminating it on
    // a client disconnect could interrupt a write and abandon its file lock.
  });
}

module.exports = { runWorkItemMutation };
