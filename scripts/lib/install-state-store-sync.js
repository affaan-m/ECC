'use strict';

const {
  createStateStore,
  projectInstallState,
  reconcileCurrentInstallState,
} = require('./state-store');

function openFailure(error) {
  const warning = {
    code: 'projection-open-failed',
    message: error.message,
  };
  return {
    status: 'warning',
    warningCount: 1,
    warnings: [warning],
    warning,
  };
}

async function withStateStore(options, operation) {
  const openStore = options.createStore || createStateStore;
  let store;
  try {
    store = await openStore({
      dbPath: options.dbPath,
      homeDir: options.homeDir,
    });
    return await operation(store);
  } catch (error) {
    return openFailure(error);
  } finally {
    if (store) {
      try {
        store.close();
      } catch (_error) {
        // Projection is a derived cache. A close failure must not invalidate
        // the canonical JSON install-state or a completed file operation.
      }
    }
  }
}

async function projectCanonicalInstallState(state, options = {}) {
  return withStateStore(options, store => projectInstallState(store, state));
}

async function reconcileCanonicalInstallStates(options = {}) {
  return withStateStore(options, store => reconcileCurrentInstallState(store, {
    homeDir: options.homeDir,
    projectRoot: options.projectRoot,
    targets: options.targets,
    env: options.env,
    discoverInstalledStates: options.discoverInstalledStates,
  }));
}

module.exports = {
  projectCanonicalInstallState,
  reconcileCanonicalInstallStates,
};
