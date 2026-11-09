#!/usr/bin/env node
'use strict';
const { hook } = require('../lib/copilot-canvas');
const MAX_BYTES = 1024 * 1024;
async function main(event = process.argv[2], input = process.stdin, output = process.stdout, env = process.env) {
  try {
    const chunks = []; let bytes = 0;
    for await (const chunk of input) {
      bytes += Buffer.byteLength(chunk);
      if (bytes > MAX_BYTES) throw new Error('Canvas hook input limit.');
      chunks.push(Buffer.from(chunk));
    }
    const raw = new TextDecoder('utf-8', { fatal: true }).decode(Buffer.concat(chunks));
    const result = hook(event, JSON.parse(raw), env);
    if (result.type === 'progress') {
      output.write(`${JSON.stringify(result)}\n{}\n`);
    } else {
      output.write(`${JSON.stringify(result)}\n`);
    }
  } catch {
    process.stderr.write('ECC Copilot canvas feedback unavailable; work continues.\n');
    output.write('{}\n');
  }
}
if (require.main === module) main();
module.exports = { main };
