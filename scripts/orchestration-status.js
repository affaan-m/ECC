#!/usr/bin/env node
'use strict';

const fs = require('fs');
const path = require('path');

const { inspectSessionTarget } = require('./lib/session-adapters/registry');

function usage() {
  console.log([
    'Usage:',
    '  node scripts/orchestration-status.js <session-name|plan.json> [--write <output.json>]',
    '',
    'Examples:',
    '  node scripts/orchestration-status.js workflow-visual-proof',
    '  node scripts/orchestration-status.js .claude/plan/workflow-visual-proof.json',
    '  node scripts/orchestration-status.js .claude/plan/workflow-visual-proof.json --write /tmp/snapshot.json'
  ].join('\n'));
}

function parseArgs(argv) {
  const args = argv.slice(2);
  const target = args.find(arg => !arg.startsWith('--'));
  const writeIndex = args.indexOf('--write');
  const writePath = writeIndex >= 0 ? args[writeIndex + 1] : null;

  return { target, writePath };
}

function main() {
  const { target, writePath } = parseArgs(process.argv);

  if (!target) {
    usage();
    process.exit(1);
  }

  const snapshot = inspectSessionTarget(target, {
    cwd: process.cwd(),
    adapterId: 'dmux-tmux'
  });
  const json = JSON.stringify(snapshot, null, 2);

  if (writePath) {
    const absoluteWritePath = path.resolve(writePath);
    fs.mkdirSync(path.dirname(absoluteWritePath), { recursive: true });
    fs.writeFileSync(absoluteWritePath, json + '\n', 'utf8');
  }

  console.log(json);
}

if (require.main === module) {
  try {
    main();
  } catch (error) {
    console.error(`[orchestration-status] ${error.message}`);
    process.exit(1);
  }
}

module.exports = { main };
