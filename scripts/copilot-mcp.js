#!/usr/bin/env node
'use strict';
const fs = require('fs');
const path = require('path');
const { preview, apply, rollback, doctor, probeConfigured } = require('./lib/copilot-mcp');

function parse(rest) {
  const options = {}; const selections = [];
  for (let i = 0; i < rest.length; i++) {
    const flag = rest[i];
    if (!['--config', '--select', '--probe', '--timeout', '--tools'].includes(flag) || !rest[i + 1]) throw new Error('Expected --config PATH, --select NAME[:ALIAS], --tools LIST, --probe NAME or --timeout MS');
    const value = rest[++i];
    if (flag === '--select') {
      const pieces = value.split(':');
      if (pieces.length > 2) throw new Error('Invalid selection');
      selections.push({ name: pieces[0], alias: pieces[1] || pieces[0], tools: [] });
    } else if (Object.hasOwn(options, flag)) throw new Error('Duplicate option');
    else options[flag] = value;
  }
  return { options, selections: selections.map(item => ({ ...item, tools: (options['--tools'] || '').split(',').filter(Boolean) })) };
}
async function main(argv = process.argv.slice(2)) {
  const [action = 'preview', ...rest] = argv;
  if (!['preview', 'apply', 'rollback', 'doctor'].includes(action)) throw new Error('Action must be preview, apply, rollback or doctor');
  const { options, selections } = parse(rest);
  const configPath = options['--config'];
  if (!configPath || !path.isAbsolute(configPath)) throw new Error('An explicit absolute --config PATH is required; no user/project scope is assumed');
  if (action === 'doctor') {
    if (!options['--probe']) return doctor({ configPath });
    const alias = options['--probe'];
    return { name: alias, native_status: 'native-unverified',
      probe: await probeConfigured({ configPath, alias, timeoutMs: Number(options['--timeout'] || 3000) }) };
  }
  if (options['--probe'] || options['--timeout']) throw new Error('Probe options require doctor');
  if (action === 'rollback') return rollback({ configPath });
  if (!selections.length) throw new Error('Choose at least one --select NAME[:ALIAS]');
  const catalog = JSON.parse(fs.readFileSync(path.join(__dirname, '../mcp-configs/mcp-servers.json'), 'utf8'));
  const plan = preview({ configPath, catalog, selected: selections });
  return action === 'apply' ? apply(plan) : plan;
}
if (require.main === module) {
  main().then(result => console.log(JSON.stringify(result, null, 2))).catch(error => {
    console.error(`[ECC MCP] ${error.message}`); process.exitCode = 1;
  });
}
module.exports = { main };
