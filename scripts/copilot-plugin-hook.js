#!/usr/bin/env node
'use strict';
const path = require('path');
const { runPluginHook, MAX_BYTES } = require('./lib/copilot-plugin-runtime');
let raw = ''; let bytes = 0;
process.stdin.setEncoding('utf8');
process.stdin.on('data', chunk => { bytes += Buffer.byteLength(chunk); if (bytes <= MAX_BYTES) raw += chunk; });
process.stdin.on('end', () => {
  const [entry, ...args] = process.argv.slice(2);
  const result = runPluginHook({ pluginRoot: path.resolve(__dirname, '..'), entry, args,
    raw: bytes > MAX_BYTES ? '' : raw });
  if (result.diagnostic) process.stderr.write(result.diagnostic + '\n');
  process.stdout.write(JSON.stringify(result.output) + '\n');
  process.exitCode = result.exitCode;
});
process.stdin.on('error', () => { process.exitCode = 1; });
