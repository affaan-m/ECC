#!/usr/bin/env node
'use strict';
const fs = require('fs');
const { run } = require('./lib/copilot-orchestration');
async function main() {
  let bytes = 0; const chunks = [];
  for await (const chunk of process.stdin) { bytes += chunk.length; if (bytes <= 1024 * 1024) chunks.push(chunk); }
  if (bytes > 1024 * 1024) throw new Error('Input limit exceeded.');
  return run(JSON.parse(new TextDecoder('utf-8', { fatal: true }).decode(Buffer.concat(chunks))), fs.realpathSync(process.cwd()));
}
main().then(result => process.stdout.write(JSON.stringify(result) + '\n')).catch(() => {
  process.stdout.write('{"error":"Orchestration failed: invalid request, unavailable backend, insufficient configuration or failed verification."}\n');
  process.exitCode = 1;
});
