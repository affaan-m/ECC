#!/usr/bin/env node
'use strict';

const { runPreBash } = require('./bash-hook-dispatcher');

let raw = '';
const MAX_STDIN = 1024 * 1024;

process.stdin.setEncoding('utf8');
process.stdin.on('data', chunk => {
  if (raw.length < MAX_STDIN) {
    const remaining = MAX_STDIN - raw.length;
    raw += chunk.substring(0, remaining);
  }
});

process.stdin.on('end', () => {
  const result = runPreBash(raw);
  if (result.stderr) {
    process.stderr.write(result.stderr);
  }
  process.stdout.write(result.output);
  process.exitCode = result.exitCode;
});
