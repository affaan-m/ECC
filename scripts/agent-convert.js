#!/usr/bin/env node
'use strict';

/**
 * ECC Agent IR — converter CLI.
 *
 * Converts ECC's canonical agents from one harness format to another. v1
 * supports a single direction: `claude -> pi`. Future emitters (cursor,
 * opencode, gemini, codex, zed) plug into the same IR.
 *
 * Usage:
 *   node scripts/agent-convert.js --check
 *   node scripts/agent-convert.js --from claude --to pi [--json]
 *   node scripts/agent-convert.js --from claude --to pi --out <dir> [--dry-run]
 *
 * When `--json` is set, stdout carries only the machine-readable summary;
 * progress lines (wrote / would-write) go to stderr so automation can parse
 * stdout as JSON.
 */

const fs = require('fs');
const path = require('path');
const { parseAllAgents } = require('./lib/agent-ir');
const { emitAllPiAgents } = require('./lib/agent-emit-pi');

const SUPPORTED = { claude: ['pi'] };

function requireValue(argv, index, flag) {
  const value = argv[index + 1];
  if (value === undefined || value === '') {
    throw new Error(`missing value for ${flag}`);
  }
  return value;
}

function parseArgs(argv) {
  const args = { from: 'claude', to: 'pi', json: false, dryRun: false, check: false, out: null };
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i];
    if (a === '--from') {
      args.from = requireValue(argv, i, '--from');
      i++;
    } else if (a === '--to') {
      args.to = requireValue(argv, i, '--to');
      i++;
    } else if (a === '--json') {
      args.json = true;
    } else if (a === '--dry-run') {
      args.dryRun = true;
    } else if (a === '--check') {
      args.check = true;
    } else if (a === '--out') {
      args.out = requireValue(argv, i, '--out');
      i++;
    } else if (a === '--help' || a === '-h') {
      args.help = true;
    } else {
      throw new Error(`unknown argument: ${a}`);
    }
  }
  return args;
}

function showHelp() {
  console.log(`ECC Agent IR converter (v1)

Usage:
  node scripts/agent-convert.js --check
      Parse and validate every agent under agents/ against the IR schema.

  node scripts/agent-convert.js --from claude --to pi [--json]
      Emit all agents as Pi subagent definitions and print a summary.

  node scripts/agent-convert.js --from claude --to pi --out <dir> [--dry-run]
      Write emitted Pi agent files (<dir>/<id>.md). --dry-run prints only.

Options:
  --from <claude>   Source harness (v1: claude only)
  --to <pi>         Target harness (v1: pi only)
  --json            Machine-readable summary on stdout
  --out <dir>       Write emitted files to a directory
  --dry-run         With --out, report writes without writing
  --check           Validate parsing only (no emit)
`);
}

function main() {
  let args;
  try {
    args = parseArgs(process.argv.slice(2));
  } catch (err) {
    console.error(`error: ${err.message}`);
    process.exit(2);
  }
  if (args.help) {
    showHelp();
    process.exit(0);
  }

  if (!SUPPORTED[args.from] || !SUPPORTED[args.from].includes(args.to)) {
    console.error(`error: unsupported conversion ${args.from} -> ${args.to}`);
    console.error(`supported: ${Object.entries(SUPPORTED).map(([f, ts]) => `${f} -> ${ts.join(',')}`).join('; ')}`);
    process.exit(2);
  }

  const irs = parseAllAgents();

  if (args.check) {
    console.log(`OK: ${irs.length} agents parsed and validated against ecc.agent-ir.v1`);
    process.exit(0);
  }

  const { results, warnings } = emitAllPiAgents(irs);

  // Progress lines must never corrupt machine-readable stdout.
  const progress = msg => {
    if (args.json) process.stderr.write(`${msg}\n`);
    else console.log(msg);
  };

  if (args.out) {
    const dir = path.resolve(args.out);
    if (!args.dryRun) fs.mkdirSync(dir, { recursive: true });
    for (const r of results) {
      const target = path.join(dir, `${r.id}.md`);
      if (args.dryRun) {
        progress(`[dry-run] would write ${target}`);
      } else {
        fs.writeFileSync(target, r.markdown);
        progress(`wrote ${target}`);
      }
    }
  }

  const summary = {
    schema: 'ecc.agent-ir.v1',
    from: args.from,
    to: args.to,
    converted: results.length,
    warnings: warnings.length,
    warningsDetail: warnings,
  };

  if (args.json) {
    console.log(JSON.stringify(summary, null, 2));
  } else {
    console.log(`converted ${results.length} agents (${args.from} -> ${args.to})`);
    if (warnings.length) {
      console.log(`\n${warnings.length} warning(s):`);
      for (const w of warnings) console.log(`  - ${w}`);
    }
  }
}

main();
