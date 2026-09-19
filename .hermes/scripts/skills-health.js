#!/usr/bin/env node
'use strict';

const { collectSkillHealth, formatHealthReport } = require('./lib/skill-evolution/health');
const { renderDashboard } = require('./lib/skill-evolution/dashboard');

function showHelp() {
  console.log(`
Usage: node scripts/skills-health.js [options]

Options:
  --json                  Emit machine-readable JSON
  --skills-root <path>    Override curated skills root
  --learned-root <path>   Override learned skills root
  --imported-root <path>  Override imported skills root
  --home <path>           Override home directory for learned/imported skill roots
  --runs-file <path>      Override skill run JSONL path
  --now <timestamp>       Override current time for deterministic reports
  --dashboard             Show rich health dashboard with charts
  --panel <name>          Show only a specific panel (success-rate, failures, amendments, versions)
  --warn-threshold <n>    Decline sensitivity threshold (default: 0.1)
  --help                  Show this help text
`);
}

function requireValue(argv, index, argName) {
  const value = argv[index + 1];
  if (!value || value.startsWith('--')) {
    throw new Error(`Missing value for ${argName}`);
  }

  return value;
}

function parseArgs(argv) {
  const options = {};

  for (let index = 0; index < argv.length; index += 1) {
    const arg = argv[index];

    if (arg === '--json') {
      options.json = true;
      continue;
    }

    if (arg === '--help' || arg === '-h') {
      options.help = true;
      continue;
    }

    if (arg === '--skills-root') {
      options.skillsRoot = requireValue(argv, index, '--skills-root');
      index += 1;
      continue;
    }

    if (arg === '--learned-root') {
      options.learnedRoot = requireValue(argv, index, '--learned-root');
      index += 1;
      continue;
    }

    if (arg === '--imported-root') {
      options.importedRoot = requireValue(argv, index, '--imported-root');
      index += 1;
      continue;
    }

    if (arg === '--home') {
      options.homeDir = requireValue(argv, index, '--home');
      index += 1;
      continue;
    }

    if (arg === '--runs-file') {
      options.runsFilePath = requireValue(argv, index, '--runs-file');
      index += 1;
      continue;
    }

    if (arg === '--now') {
      options.now = requireValue(argv, index, '--now');
      index += 1;
      continue;
    }

    if (arg === '--warn-threshold') {
      options.warnThreshold = Number(requireValue(argv, index, '--warn-threshold'));
      index += 1;
      continue;
    }

    if (arg === '--dashboard') {
      options.dashboard = true;
      continue;
    }

    if (arg === '--panel') {
      options.panel = requireValue(argv, index, '--panel');
      index += 1;
      continue;
    }

    throw new Error(`Unknown argument: ${arg}`);
  }

  return options;
}

function main() {
  try {
    const options = parseArgs(process.argv.slice(2));

    if (options.help) {
      showHelp();
      process.exit(0);
    }

    if (options.dashboard || options.panel) {
      const result = renderDashboard(options);
      process.stdout.write(options.json ? `${JSON.stringify(result.data, null, 2)}\n` : result.text);
    } else {
      const report = collectSkillHealth(options);
      process.stdout.write(formatHealthReport(report, { json: options.json }));
    }
  } catch (error) {
    process.stderr.write(`Error: ${error.message}\n`);
    process.exit(1);
  }
}

main();
