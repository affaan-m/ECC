#!/usr/bin/env node
'use strict';

const path = require('path');
const {
  parseMcpConsentList,
  resolveHomeDir,
  runGrokInstall,
} = require('./lib/grok-harness-adapter');

const IGNORED_VALUE_FLAGS = new Set([
  '--target',
  '--profile',
  '--modules',
  '--with',
  '--without',
  '--config',
  '--locale',
  '--skill',
  '--skills',
]);

function printHelp() {
  console.log(`Usage: node scripts/grok-install.js [--dry-run] [--json] [--trust] [--consent-hooks] [--consent-mcp <name,name>]

ECC trusted Grok install. This is the consent/receipt path.
Grok CLI marketplace add/install/enable is discovery only.

Options:
  --dry-run         Preview the plan without copying files
  --json            Emit JSON
  --trust           Mark the plan trusted (still requires per-capability consent)
  --consent-hooks   Consent to hooks
  --consent-mcp     Comma-separated MCP server names to attach
  --help            Show this help
`);
}

function parseArgs(argv) {
  const parsed = {
    dryRun: false,
    json: false,
    trust: false,
    help: false,
    consent: { hooks: false, mcp: {} },
  };

  for (let index = 2; index < argv.length; index += 1) {
    const arg = argv[index];
    if (arg === '--dry-run') {
      parsed.dryRun = true;
    } else if (arg === '--json') {
      parsed.json = true;
    } else if (arg === '--trust') {
      parsed.trust = true;
    } else if (arg === '--consent-hooks') {
      parsed.consent.hooks = true;
    } else if (arg === '--consent-mcp') {
      parsed.consent.mcp = parseMcpConsentList(argv[index + 1] || '');
      index += 1;
    } else if (IGNORED_VALUE_FLAGS.has(arg)) {
      index += 1;
    } else if (arg === '--help' || arg === '-h') {
      parsed.help = true;
    } else {
      throw new Error(`Unknown argument: ${arg}`);
    }
  }

  return parsed;
}

function printHuman(result) {
  const plan = result.plan;
  console.log(result.dryRun ? 'Grok adapter dry-run plan\n' : 'Grok adapter install\n');
  console.log(`Identity: ${plan.identity}`);
  console.log(`Trust: ${plan.trust}`);
  console.log(`Hooks enabled: ${plan.hooksEnabled}`);
  console.log(`MCP attached: ${plan.mcpAttached.join(', ') || '(none)'}`);
  console.log(`Chrome DevTools: ${plan.attachChromeDevtools}`);
  console.log(`Native MCP opted out: ${result.nativeMcpOptedOut}`);
  console.log(`Native hooks opted out: ${result.nativeHooksOptedOut}`);
  if (result.receipt) {
    console.log(`Receipt: ${result.receipt.id}`);
    console.log(`Install-state: ${result.receipt.installStatePath}`);
    console.log(`Installed root: ${result.receipt.installedRoot}`);
  }
}

function main() {
  let parsed;
  try {
    parsed = parseArgs(process.argv);
  } catch (error) {
    process.stderr.write(`Error: ${error.message}\n`);
    printHelp();
    process.exit(1);
  }

  if (parsed.help) {
    printHelp();
    return;
  }

  const result = runGrokInstall({
    dryRun: parsed.dryRun,
    trust: parsed.trust,
    consent: parsed.consent,
    homeDir: resolveHomeDir(),
    repoRoot: path.join(__dirname, '..'),
  });

  if (parsed.json) {
    console.log(JSON.stringify(result, null, 2));
    return;
  }
  printHuman(result);
}

if (require.main === module) {
  main();
}

module.exports = {
  parseArgs,
  main,
};
