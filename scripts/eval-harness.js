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
 * Exit codes: 0 verified or promoted, 1 failed verification or rejected, 2 usage error.
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
  const index = args.indexOf(name);
  if (index === -1) {
    return undefined;
  }
  return args[index + 1];
}

function print(value) {
  process.stdout.write(JSON.stringify(value, null, 2) + '\n');
}

function readJson(filePath) {
  return JSON.parse(fs.readFileSync(path.resolve(filePath), 'utf8'));
}

function main(argv) {
  const [group, action, ...rest] = argv;
  if (!group) {
    usage();
  }
  if (group === 'example') {
    const result = spawnSync(process.execPath, [path.join(__dirname, '..', 'examples', 'eval-harness', 'run-example.js'), ...(action ? [action] : [])], { stdio: 'inherit' });
    process.exit(result.status === null ? 1 : result.status);
  }
  if (group === 'capsule') {
    const dir = rest[0];
    if (!dir) {
      usage('capsule commands need a capsule directory');
    }
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
      if (!rest[1]) {
        usage('capsule export needs an output directory');
      }
      print(harness.capsule.exportBundle(dir, rest[1]));
      return;
    }
    usage(`unknown capsule action ${action}`);
  }
  if (group === 'gate') {
    if (action !== 'run' || !rest[0]) {
      usage('gate run needs a config path');
    }
    const configPath = path.resolve(rest[0]);
    const config = readJson(configPath);
    const base = path.dirname(configPath);
    const capsuleDir = flag(rest, '--capsule');
    let capsule = null;
    if (capsuleDir) {
      capsule = fs.existsSync(path.join(capsuleDir, harness.capsule.META_FILE))
        ? harness.capsule.Capsule.open(capsuleDir)
        : harness.capsule.Capsule.create(capsuleDir, { harness_version: 'ecc-eval-harness/1', task_family: config.family || 'gate' });
    }
    const result = harness.gate.runGate({
      taskset: path.resolve(base, config.taskset),
      baseline: path.resolve(base, config.baseline),
      candidate: path.resolve(base, config.candidate),
      thresholds: config.thresholds,
      max_effect_class: config.max_effect_class,
      work_dir: flag(rest, '--work-dir'),
      capsule,
    });
    print({ verdict: result.receipt.verdict, reasons: result.receipt.reasons, headline: result.receipt.headline, receipt: path.join(result.work_dir, 'gate-receipt.json') });
    process.exit(result.receipt.verdict === 'PROMOTE' ? 0 : 1);
  }
  if (group === 'receipt') {
    if (action === 'build') {
      const dir = rest[0];
      if (!dir) {
        usage('receipt build needs a capsule directory');
      }
      const gatePath = flag(rest, '--gate');
      const receipt = harness.receipt.buildReceipt(dir, {
        artifact_path: flag(rest, '--artifact'),
        gate_receipt: gatePath ? readJson(gatePath) : undefined,
      });
      const out = flag(rest, '--out');
      if (out) {
        harness.receipt.writeReceipt(receipt, out);
      }
      print(receipt);
      return;
    }
    if (action === 'verify') {
      const [receiptPath, dir] = rest;
      if (!receiptPath || !dir) {
        usage('receipt verify needs a receipt path and a capsule directory');
      }
      const gatePath = flag(rest, '--gate');
      const result = harness.receipt.verifyReceipt(readJson(receiptPath), dir, {
        artifact_path: flag(rest, '--artifact'),
        gate_receipt: gatePath ? readJson(gatePath) : undefined,
      });
      print(result);
      process.exit(result.ok ? 0 : 1);
    }
    usage(`unknown receipt action ${action}`);
  }
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
