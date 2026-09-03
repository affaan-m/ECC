#!/usr/bin/env node
'use strict';

const path = require('path');
const { spawnSync } = require('child_process');

const SELECTION_FLAGS = new Set(['--profile', '--modules', '--with', '--skill', '--skills', '--config']);

function canonicalArgs(argv = process.argv.slice(2)) {
  const args = [];
  for (let index = 0; index < argv.length; index += 1) {
    if (argv[index] === '--target') {
      index += 1;
      continue;
    }
    args.push(argv[index]);
  }
  if (!args.some((argument) => SELECTION_FLAGS.has(argument)) && !args.includes('--help') && !args.includes('-h')) {
    args.unshift('--profile', 'full');
  }
  return ['--target', 'grok', ...args];
}

function main() {
  const result = spawnSync(
    process.execPath,
    [path.join(__dirname, 'install-apply.js'), ...canonicalArgs()],
    { stdio: 'inherit' }
  );
  if (result.error) throw result.error;
  process.exitCode = result.status === null ? 1 : result.status;
}

if (require.main === module) main();

module.exports = {
  canonicalArgs,
  main,
};
