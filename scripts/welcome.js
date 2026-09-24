#!/usr/bin/env node
'use strict';

const {
  ECC_VERSION_PATTERN,
  renderTerminalWelcome,
} = require('./lib/terminal-welcome');

const VALID_ACTIONS = new Set([
  'installed',
  'updated',
  'configured',
  'migrated',
  'resumed',
  'already-migrated',
]);

function parseArgs(argv) {
  let action = 'installed';
  let version;

  for (let index = 0; index < argv.length; index += 1) {
    const argument = argv[index];
    if (argument === '--action') {
      const value = argv[index + 1];
      if (!value || value.startsWith('--')) {
        throw new Error('Missing value for --action');
      }
      action = value;
      index += 1;
    } else if (argument === '--version') {
      const value = argv[index + 1];
      if (!value || value.startsWith('--')) {
        throw new Error('Missing value for --version');
      }
      version = value;
      index += 1;
    } else {
      throw new Error('Unknown argument');
    }
  }

  if (!VALID_ACTIONS.has(action)) {
    throw new Error('Invalid --action value');
  }
  if (version !== undefined && !ECC_VERSION_PATTERN.test(version)) {
    throw new Error('Invalid --version value');
  }
  return { action, version };
}

function main(argv = process.argv.slice(2)) {
  try {
    const { action, version } = parseArgs(argv);
    const color = process.env.NO_COLOR === undefined
      && process.env.TERM !== 'dumb'
      && Boolean(process.stdout.isTTY);
    process.stdout.write(renderTerminalWelcome({ action, color, version }));
  } catch (error) {
    process.stderr.write(`Error: ${error.message}\n`);
    process.exitCode = 1;
  }
}

if (require.main === module) {
  main();
}

module.exports = { main, parseArgs };
