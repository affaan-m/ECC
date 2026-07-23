#!/usr/bin/env node
'use strict';

const { collectMcpInventory } = require('./lib/mcp-inventory/collect');

function parseArgs(argv = process.argv) {
  const args = argv.slice(2);
  const options = { json: false, fragmentedOnly: false, help: false };

  for (const arg of args) {
    if (arg === '--json') {
      options.json = true;
    } else if (arg === '--fragmented' || arg === '--fragmented-only') {
      options.fragmentedOnly = true;
    } else if (arg === '--help' || arg === '-h') {
      options.help = true;
    }
  }

  return options;
}

function usage() {
  return [
    'Usage: mcp-inventory [options]',
    '',
    'Read MCP server configs across every installed harness (Claude Code,',
    'Codex, OpenCode), normalize them to ecc.mcp.v1, and report which servers',
    'are configured in more than one harness. Secrets are never printed; only',
    'env key names are shown.',
    '',
    'Options:',
    '  --json              Print the full ecc.mcp.v1 inventory as JSON',
    '  --fragmented        Only show servers configured in 2+ harnesses',
    '  -h, --help          Show this help'
  ].join('\n');
}

function formatHumanReport(inventory, options = {}) {
  const lines = [];
  const { aggregates, servers, fragmentation } = inventory;

  lines.push('MCP Inventory (ecc.mcp.v1)');
  lines.push(
    `  ${aggregates.serverCount} servers across ${aggregates.harnessCount} harnesses, `
    + `${aggregates.duplicateServerCount} configured in 2+ harnesses `
    + `(${aggregates.inconsistentServerCount} inconsistent), `
    + `${aggregates.serversWithSecrets} carry secrets`
  );
  lines.push('');

  if (fragmentation.length > 0) {
    lines.push('Fragmented servers (configure-once candidates):');
    for (const item of fragmentation) {
      const flag = item.consistent ? 'consistent' : 'DRIFT';
      lines.push(`  ${item.name}  x${item.harnessCount}  [${item.harnesses.join(', ')}]  ${flag}`);
    }
    lines.push('');
  } else {
    lines.push('No servers are configured in more than one harness.');
    lines.push('');
  }

  if (!options.fragmentedOnly) {
    lines.push('All servers:');
    for (const server of servers) {
      const transport = server.transport === 'stdio'
        ? `stdio:${[server.command, ...server.args].filter(Boolean).join(' ')}`
        : `${server.transport}:${server.url || ''}`;
      const secretFlag = server.hasSecrets ? ' (secrets)' : '';
      const disabledFlag = server.enabled ? '' : ' (disabled)';
      lines.push(`  ${server.name}  ->  ${transport}${secretFlag}${disabledFlag}`);
    }
  }

  return lines.join('\n');
}

function main(argv = process.argv) {
  const options = parseArgs(argv);

  if (options.help) {
    console.log(usage());
    return;
  }

  const inventory = collectMcpInventory();

  if (options.json) {
    console.log(JSON.stringify(inventory, null, 2));
    return;
  }

  console.log(formatHumanReport(inventory, options));
}

if (require.main === module) {
  main();
}

module.exports = {
  parseArgs,
  usage,
  formatHumanReport,
  main
};
