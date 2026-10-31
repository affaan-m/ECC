#!/usr/bin/env node
'use strict';
const { normalizeManifest, buildInventory, collectResources, collectTaskFiles, readJson } = require('./lib/coordination-inventory');

function main(argv = process.argv.slice(2)) {
  if (argv.length === 1 && ['--help', '-h'].includes(argv[0])) {
    process.stdout.write('Usage: node scripts/coordination-inventory.js [--manifest file.json] [--coordination directory] [--live] [--now ISO-UTC]\nRead-only JSON inventory. Live probes only OS memory and declared PIDs. No processes are executed from input.\n');
    return;
  }
  const options = {};
  for (let i = 0; i < argv.length; i += 1) {
    const flag = argv[i];
    if (flag === '--live' && !options.live) options.live = true;
    else if (['--manifest', '--coordination', '--now'].includes(flag) && !options[flag.slice(2)] && argv[i+1] && !argv[i+1].startsWith('--')) options[flag.slice(2)] = argv[++i];
    else throw new Error('Invalid inventory arguments. Use --help.');
  }
  let manifest = options.manifest ? readJson(options.manifest) : { version: 1, tasks: [], repositories: [], leases: [] };
  let discovery = null;
  if (options.coordination) {
    discovery = collectTaskFiles(options.coordination);
    // Duplicate IDs are rejected; never silently replace declared ownership.
    manifest = { ...manifest, tasks: [...(manifest.tasks || []), ...discovery.tasks] };
  }
  const normalized = normalizeManifest(manifest);
  const resources = options.live ? collectResources(normalized.tasks) : undefined;
  const report = buildInventory(manifest, { now: options.now, resources });
  if (discovery) report.discovery = { status: discovery.status, unreadable: discovery.unreadable };
  process.stdout.write(`${JSON.stringify(report, null, 2)}\n`);
}
if (require.main === module) {
  try { main(); } catch { process.stderr.write('Inventory failed: invalid arguments or unreadable/invalid input. Use --help.\n'); process.exitCode = 1; }
}
module.exports = { main };
