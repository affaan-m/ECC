#!/usr/bin/env node

'use strict';

const path = require('path');

const usage = `Usage: node docker/plugin-setup/interactive-plan.js [options] [-- command ...]

Emit the Docker side of the terminal-opener executable-plus-argv contract.

Options:
  --container <name>  Named running container (default: ecc-plugin-shell).
  --workdir <path>    Absolute container working directory (default: /workspace/project).
  --json              Emit compact JSON.
  --help, -h          Show this help.
  -- command ...      Interactive command (default: bash).
`;

function fail(message) {
  const error = new Error(message);
  error.exitCode = 2;
  throw error;
}

function readValue(argv, index, option) {
  const value = argv[index + 1];
  if (!value || value === '--') {
    fail(`Invalid ${option}: expected a value.`);
  }
  return value;
}

function parseArgs(argv) {
  let container = 'ecc-plugin-shell';
  let workdir = '/workspace/project';
  let json = false;
  let command = ['bash'];

  for (let index = 0; index < argv.length; index += 1) {
    const argument = argv[index];
    if (argument === '--') {
      command = argv.slice(index + 1);
      if (command.length === 0) {
        fail('Invalid command: expected at least one argv entry after --.');
      }
      break;
    }
    if (argument === '--container') {
      container = readValue(argv, index, '--container');
      index += 1;
    } else if (argument === '--workdir') {
      workdir = readValue(argv, index, '--workdir');
      index += 1;
    } else if (argument === '--json') {
      json = true;
    } else if (argument === '--help' || argument === '-h') {
      return { help: true };
    } else {
      fail(`Invalid option: ${argument}`);
    }
  }

  if (container.length > 128 || !/^[A-Za-z0-9][A-Za-z0-9_.-]*$/.test(container)) {
    fail('Invalid container name. Use Docker name characters only.');
  }
  const normalizedWorkdir = path.posix.normalize(workdir);
  if (
    !path.posix.isAbsolute(workdir)
    || /[\r\n\0]/.test(workdir)
    || (
      normalizedWorkdir !== '/workspace'
      && !normalizedWorkdir.startsWith('/workspace/')
    )
  ) {
    fail('Invalid workdir. Use an absolute path within /workspace.');
  }
  if (command.some((entry) => entry.length === 0 || /\0/.test(entry))) {
    fail('Invalid command argv entry.');
  }

  return { command, container, help: false, json, workdir };
}

function buildPlan(options) {
  return {
    contractVersion: 1,
    executable: 'docker',
    argv: [
      'exec',
      '-it',
      '-w',
      options.workdir,
      options.container,
      ...options.command,
    ],
  };
}

function main() {
  try {
    const options = parseArgs(process.argv.slice(2));
    if (options.help) {
      process.stdout.write(usage);
      return;
    }
    const spacing = options.json ? 0 : 2;
    process.stdout.write(`${JSON.stringify(buildPlan(options), null, spacing)}\n`);
  } catch (error) {
    process.stderr.write(`Error: ${error.message}\n`);
    process.exitCode = error.exitCode || 1;
  }
}

if (require.main === module) {
  main();
}

module.exports = { buildPlan, parseArgs };
