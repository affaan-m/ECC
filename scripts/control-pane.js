#!/usr/bin/env node
'use strict';

const fs = require('fs');
const path = require('path');

const {
  createControlPaneServer,
  parseArgs,
  usage,
} = require('./lib/control-pane/server');
const { describeMissingDependencyError } = require('./lib/missing-dependency');

// Resolve a path to its canonical form for comparison, following symlinks when
// the target exists and falling back to an absolute path when it does not
// (e.g. a db file that hasn't been created yet).
function canonicalPath(target) {
  if (!target) return null;
  const resolved = path.resolve(target);
  try {
    return fs.realpathSync(resolved);
  } catch {
    return resolved;
  }
}

// MED-4: the Rust store (ecc2.db) and the JS state store (state.db) use
// mutually-invisible locking. If --db and --state-db point at the same file,
// JS's whole-file rewrite can clobber a Rust commit (lost update). Refuse to
// start so the operator picks distinct files instead of silently losing data.
function assertDistinctStores(dbPath, stateDbPath) {
  const canonicalDb = canonicalPath(dbPath);
  const canonicalState = canonicalPath(stateDbPath);
  if (canonicalDb && canonicalState && canonicalDb === canonicalState) {
    throw new Error(
      `Refusing to start: --db and --state-db resolve to the same file (${canonicalDb}). `
        + 'The Rust store (ecc2.db) and the JS state store (state.db) use mutually-invisible '
        + "locking; sharing one file risks a lost update that clobbers a Rust commit. "
        + 'Point --db and --state-db at different files.'
    );
  }
}

// openBrowser is now in scripts/lib/platform-launch.js — keep a thin wrapper
// for backwards compatibility, but surface the structured result.
const { openBrowser: launchOpenBrowser } = require('./lib/platform-launch');
function openBrowser(url) {
  const result = launchOpenBrowser(url);
  if (!result.opened) {
    console.error(`[control-pane] failed to open browser: ${result.reason}`);
  }
}

async function main(argv = process.argv) {
  const args = parseArgs(argv);

  if (args.help) {
    console.log(usage());
    return;
  }

  const app = createControlPaneServer(args);
  assertDistinctStores(app.config.dbPath, app.config.stateDbPath);
  await app.listen();

  console.log(`ECC Control Pane: ${app.url}`);
  console.log(`ECC2 database: ${app.config.dbPath}`);
  console.log(`ECC state database: ${app.config.stateDbPath}`);
  console.log(args.allowActions ? 'Actions: enabled for local allowlist' : 'Actions: read-only');

  if (args.openBrowser) {
    openBrowser(app.url);
  }

  const shutdown = async () => {
    try {
      await app.close();
    } finally {
      process.exit(0);
    }
  };

  process.on('SIGINT', shutdown);
  process.on('SIGTERM', shutdown);
}

if (require.main === module) {
  main().catch(error => {
    console.error(`[control-pane] ${describeMissingDependencyError(error) || error.message}`);
    process.exit(1);
  });
}

module.exports = {
  main,
  openBrowser,
};
