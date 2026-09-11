#!/usr/bin/env node
'use strict';

/**
 * ECC eval-harness CLI.
 *
 *   node scripts/eval-harness.js capsule verify <dir>
 *   node scripts/eval-harness.js capsule project <dir>
 *   node scripts/eval-harness.js capsule export <dir> <out-dir>
 *   node scripts/eval-harness.js gate run <gate.config.json> [--work-dir <dir>] [--capsule <dir>]
 *   node scripts/eval-harness.js receipt build <capsule-dir> [--artifact <file>] [--gate <gate-receipt.json>] [--out <file>]
 *   node scripts/eval-harness.js receipt verify <receipt.json> <capsule-dir> [--artifact <file>] [--gate <gate-receipt.json>]
 *   node scripts/eval-harness.js example
 *
 * Gate execution is unavailable: gate.isolation_required (exit 1).
 * Exit codes: 0 verified, 1 failed verification or unavailable, 2 usage error.
 */

const fs = require('fs');
const path = require('path');
const { spawnSync } = require('child_process');

const harness = require('./lib/eval-harness');

function usage(message) {
  if (message) {
    process.stderr.write(`eval-harness: ${message}\n`);
  }
  const header = fs.readFileSync(__filename, 'utf8').split('\n').slice(3, 15).map((line) => line.replace(/^ \*\s?/, '')).join('\n');
  process.stderr.write(`${header}\n`);
  process.exit(2);
}

function flag(args, name) {
  const indices = args.flatMap((value, index) => value === name ? [index] : []);
  for (const index of indices) {
    const value = args[index + 1];
    if (!value || value.startsWith('--')) usage(`${name} needs a value`);
  }
  if (indices.length > 1) usage(`${name} may only be supplied once`);
  return indices.length ? args[indices[0] + 1] : undefined;
}

function print(value) {
  process.stdout.write(JSON.stringify(value, null, 2) + '\n');
}

function readJson(filePath) {
  return JSON.parse(fs.readFileSync(path.resolve(filePath), 'utf8'));
}

function runExample(action) {
  const script = path.join(__dirname, '..', 'examples', 'eval-harness', 'run-example.js');
  const result = spawnSync(process.execPath, [script, ...(action ? [action] : [])], { stdio: 'inherit' });
  if (result.error) {
    // OS errors may contain command arguments or private paths. Report only
    // this stable diagnostic, never the child error object or its message.
    process.stderr.write('eval-harness: example.spawn_failed: unable to start example process\n');
    process.exit(1);
  }
  process.exit(result.status === null ? 1 : result.status);
}

function runCapsule(action, rest) {
  const dir = rest[0];
  if (!dir) usage('capsule commands need a capsule directory');
  if (action === 'verify') {
    const result = harness.capsule.verify(dir);
    print(result);
    process.exit(result.ok ? 0 : 1);
  }
  if (action === 'project') {
    print(harness.capsule.writeProjection(dir));
    return;
  }
  if (action === 'export') {
    if (!rest[1]) usage('capsule export needs an output directory');
    print(harness.capsule.exportBundle(dir, rest[1]));
    return;
  }
  usage(`unknown capsule action ${action}`);
}

function runGate(action, rest) {
  if (action !== 'run' || !rest[0]) usage('gate run needs a config path');
  // Refuse before reading a config or creating/opening a capsule.
  harness.gate.requireSupportedIsolation();
}

function receiptOptions(rest) {
  // Validate every value option before any file read or producer write.
  return {
    artifact: flag(rest, '--artifact'),
    gate: flag(rest, '--gate'),
    out: flag(rest, '--out'),
  };
}

function buildReceipt(rest, options) {
  const dir = rest[0];
  if (!dir) usage('receipt build needs a capsule directory');
  const receipt = harness.receipt.buildReceipt(dir, {
    artifact_path: options.artifact,
    gate_receipt: options.gate ? readJson(options.gate) : undefined,
  });
  if (options.out) harness.receipt.writeReceipt(receipt, options.out);
  print(receipt);
}

function verifyReceipt(rest, options) {
  const [receiptPath, dir] = rest;
  if (!receiptPath || !dir) usage('receipt verify needs a receipt path and a capsule directory');
  const result = harness.receipt.verifyReceipt(readJson(receiptPath), dir, {
    artifact_path: options.artifact,
    gate_receipt: options.gate ? readJson(options.gate) : undefined,
  });
  print(result);
  process.exit(result.ok ? 0 : 1);
}

function runReceipt(action, rest) {
  const options = receiptOptions(rest);
  if (action === 'build') return buildReceipt(rest, options);
  if (action === 'verify') return verifyReceipt(rest, options);
  usage(`unknown receipt action ${action}`);
}

function main(argv) {
  const [group, action, ...rest] = argv;
  if (!group) usage();
  if (group === 'example') return runExample(action);
  if (group === 'capsule') return runCapsule(action, rest);
  if (group === 'gate') return runGate(action, rest);
  if (group === 'receipt') return runReceipt(action, rest);
  usage(`unknown command ${group}`);
}

if (require.main === module) {
  try {
    main(process.argv.slice(2));
  } catch (error) {
    process.stderr.write(`eval-harness: ${error.code ? `${error.code}: ` : ''}${error.message}\n`);
    process.exit(1);
  }
}

module.exports = { main };
