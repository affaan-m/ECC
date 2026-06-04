#!/usr/bin/env node
'use strict';

const { spawn } = require('child_process');

const {
  createControlPaneServer,
  parseArgs,
  usage,
} = require('./lib/control-pane/server');

function openBrowser(url) {
  if (process.platform !== 'darwin') return;
  const child = spawn('open', [url], {
    stdio: 'ignore',
    detached: true,
  });
  child.on('error', error => {
    console.error(`[control-pane] failed to open browser: ${error.message}`);
  });
  child.unref();
}

async function main(argv = process.argv) {
  const args = parseArgs(argv);

  if (args.help) {
    console.log(usage());
    return;
  }

  const app = createControlPaneServer(args);
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
    console.error(`[control-pane] ${error.message}`);
    process.exit(1);
  });
}

module.exports = {
  main,
  openBrowser,
};
