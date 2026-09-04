#!/usr/bin/env node
'use strict';

const path = require('path');
const { spawnSync } = require('child_process');

const SELECTION_FLAGS = new Set(['--profile', '--modules', '--with', '--skill', '--skills', '--config']);
const VALUE_FLAGS = new Set([
  ...SELECTION_FLAGS,
  '--without',
  '--locale',
  '--consent-mcp',
  '--source-sha',
]);

function canonicalArgs(argv = process.argv.slice(2)) {
  const args = [];
  let hasSelection = false;
  for (let index = 0; index < argv.length; index += 1) {
    const argument = argv[index];
    if (argument === '--target') {
      const value = argv[index + 1];
      if (!value || value.startsWith('-')) {
        throw new Error('Missing value for --target');
      }
      index += 1;
      continue;
    }
    args.push(argument);
    if (SELECTION_FLAGS.has(argument)) hasSelection = true;
    if (VALUE_FLAGS.has(argument)) {
      const value = argv[index + 1];
      if (!value || value.startsWith('-')) {
        throw new Error(`Missing value for ${argument}`);
      }
      args.push(value);
      index += 1;
    } else if (!argument.startsWith('-')) {
      hasSelection = true;
    }
  }
  if (!hasSelection && !args.includes('--help') && !args.includes('-h')) {
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
