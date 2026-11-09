#!/usr/bin/env node
'use strict';
const { readTelemetry, summarizeTelemetry, skillHealthRecords } = require('./lib/copilot-telemetry');
function main(args = process.argv.slice(2)) {
  if (args.includes('--help')) {
    process.stdout.write('Usage: node scripts/copilot-telemetry.js [--health]\nRead project telemetry; --health emits canonical known-outcome skill records.\n');
    return;
  }
  if (args.some(arg => arg !== '--health') || args.length > 1) throw new Error('Unknown telemetry option.');
  const rows = readTelemetry(process.cwd());
  process.stdout.write(`${JSON.stringify(args.includes('--health') ? skillHealthRecords(rows) : summarizeTelemetry(rows), null, 2)}\n`);
}
if (require.main === module) {
  try { main(); } catch { process.stderr.write('ECC Copilot telemetry unavailable: invalid or unreadable state.\n'); process.exitCode = 1; }
}
module.exports = { main };
