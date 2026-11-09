#!/usr/bin/env node
'use strict';
const { notify } = require('../lib/copilot-accessories');

function main(event = process.argv[2]) {
  // Do not read or retain stdin. Only argv chooses the known completion event;
  // payload text cannot become a message, executable or privileged instruction.
  try {
    const result = notify(event);
    if (['failed', 'unavailable', 'timeout'].includes(result.status)) {
      process.stderr.write('ECC Copilot desktop notification unavailable or unsuccessful; work continues.\n');
    }
  } catch {
    process.stderr.write('ECC Copilot desktop notification skipped; work continues.\n');
  }
  process.stdout.write('{}\n');
}
if (require.main === module) main();
module.exports = { main };
