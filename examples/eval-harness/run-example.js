#!/usr/bin/env node
'use strict';

/**
 * End-to-end demonstration of the eval-harness frameworks.
 *
 *   node examples/eval-harness/run-example.js [--keep]
 *
 * Demonstrates execution refusal, static inspection, fixture replay and
 * capsule receipt verification. No candidate code is executed or promoted.
 * Temporary files and locally declared fixture functions are used offline.
 */

const fs = require('fs');
const os = require('os');
const path = require('path');

const harness = require('../../scripts/lib/eval-harness');

const here = __dirname;
const keep = process.argv.includes('--keep');
const work = fs.mkdtempSync(path.join(os.tmpdir(), 'ecc-eval-harness-example-'));
const failures = [];

function step(title, fn) {
  process.stdout.write(`\n== ${title}\n`);
  try {
    fn();
  } catch (error) {
    failures.push(`${title}: ${error.message}`);
    process.stdout.write(`   FAILED: ${error.message}\n`);
  }
}

function expect(condition, message) {
  if (!condition) {
    throw new Error(message);
  }
  process.stdout.write(`   ok  ${message}\n`);
}

const config = JSON.parse(fs.readFileSync(path.join(here, 'gate.config.json'), 'utf8'));
const resolve = (relative) => path.join(here, relative);

const capsuleDir = path.join(work, 'capsule');
const capsule = harness.capsule.Capsule.create(capsuleDir, {
  harness_version: 'ecc-example/1',
  task_family: 'slugify',
});

step('Gate: execution unavailable without a verified OS backend', () => {
  const gateWork = path.join(work, 'gate-candidate');
  let code;
  try {
    harness.gate.runGate({
      taskset: resolve(config.taskset), baseline: resolve(config.baseline),
      candidate: resolve(config.candidate), work_dir: gateWork, capsule,
    });
  } catch (error) { code = error.code; }
  expect(code === 'gate.isolation_required', 'gate refuses before executing any variant');
  expect(!fs.existsSync(gateWork), 'no gate work directory or promotion receipt was created');
  capsule.append('plan', 'inspection.start', { task_family: 'slugify' });
  capsule.append('attempt', 'gate.unavailable', { status: 'blocked', reason: code });
  capsule.append('environment', 'isolation.unavailable', { status: 'unavailable' });
});

step('Static inspection: digests and syntactic warnings', () => {
  const candidate = harness.gate.loadVariant(resolve(config.candidate));
  expect(/^[0-9a-f]{64}$/.test(candidate.digest), 'candidate source has a content digest');
  const hack = harness.gate.loadVariant(resolve('variants/reward-hack'));
  const hits = harness.gate.scanTripwires(hack);
  const rules = new Set(hits.map(hit => hit.rule));
  expect(rules.has('hidden_network') && rules.has('checker_probe'), `static warnings: ${[...rules].join(', ')}`);
  capsule.append('strategy', 'inspection.tripwires', { variant: hack.name, hits: hits.length });
});

step('Replay: declared tools, fixtures, fail-closed on missing', () => {
  const store = new harness.replay.FixtureStore(path.join(work, 'fixtures'));
  const tools = {
    read_inventory: { effect_class: 'SE0', determinism: 'deterministic', impl: (args) => ({ sku: args.sku, count: 42 }) },
    place_order: { effect_class: 'SE4', determinism: 'nondeterministic', impl: () => { throw new Error('must never run'); } },
  };
  const recorder = harness.replay.createReplayer(tools, { mode: 'record', store, maxEffectClass: 'SE2' });
  recorder.call('read_inventory', { sku: 'gpu-8x' });
  const replayer = harness.replay.createReplayer(tools, {
    mode: 'replay',
    store,
    maxEffectClass: 'SE2',
    onCall: (entry) => capsule.append('interaction', 'tool.call', {
      tool: entry.tool,
      status: entry.status,
      ...(entry.fixture_key !== undefined ? { fixture_key: entry.fixture_key } : {}),
      ...(entry.args_hash !== undefined ? { args_hash: entry.args_hash } : {}),
      ...(entry.response_hash !== undefined ? { response_hash: entry.response_hash } : {}),
    }),
  });
  const replayed = replayer.call('read_inventory', { sku: 'gpu-8x' });
  expect(replayed.count === 42, 'replayed response matches the recorded fixture');
  let code = null;
  try { replayer.call('read_inventory', { sku: 'never-recorded' }); } catch (error) { code = error.code; }
  expect(code === 'tool.fixture_missing', 'missing fixture fails closed with tool.fixture_missing');
  code = null;
  try { replayer.call('place_order', { sku: 'gpu-8x' }); } catch (error) { code = error.code; }
  expect(code === 'tool.effect_forbidden', 'SE4 tool is refused with tool.effect_forbidden');
});

let receipt;
step('Receipt: build, verify, export bundle', () => {
  const projection = harness.capsule.writeProjection(capsuleDir);
  expect(projection.entry_count > 0, `capsule holds ${projection.entry_count} entries across ${Object.values(projection.by_lineage).filter(Boolean).length} lineages`);
  expect(Object.values(projection.by_lineage).every((count) => count > 0), 'all five lineages are present');
  receipt = harness.receipt.buildReceipt(capsuleDir, {
    artifact_path: resolve('variants/candidate/run.js'),
  });
  const bundle = harness.capsule.exportBundle(capsuleDir, path.join(work, 'bundle'));
  const verdict = harness.receipt.verifyReceipt(receipt, bundle.dir, {
    artifact_path: resolve('variants/candidate/run.js'),
  });
  expect(verdict.ok, 'exported bundle verifies against the receipt without the source store');
  harness.receipt.writeReceipt(receipt, path.join(work, 'bundle', 'receipt.json'));
});

step('Tamper: one changed value fails at the exact entry', () => {
  const tampered = path.join(work, 'tampered');
  harness.capsule.exportBundle(capsuleDir, tampered);
  const journalPath = path.join(tampered, harness.capsule.JOURNAL_FILE);
  const lines = fs.readFileSync(journalPath, 'utf8').split('\n');
  const target = lines.findIndex(line => line.includes('"kind":"gate.unavailable"'));
  expect(target >= 0, 'refusal entry is present');
  lines[target] = lines[target].replace('"status":"blocked"', '"status":"altered"');
  fs.writeFileSync(journalPath, lines.join('\n'), 'utf8');
  const verify = harness.capsule.verify(tampered);
  expect(!verify.ok && verify.failed_at === target, `verify fails closed at entry ${verify.failed_at} (${verify.code})`);
  const receiptCheck = harness.receipt.verifyReceipt(receipt, tampered);
  expect(!receiptCheck.ok && receiptCheck.check === 'journal_integrity', `receipt verification names the failing check: ${receiptCheck.check}`);
});

process.stdout.write(`\nwork dir: ${work}${keep ? ' (kept)' : ' (removed)'}\n`);
if (!keep) {
  fs.rmSync(work, { recursive: true, force: true });
}
if (failures.length > 0) {
  process.stdout.write(`\n${failures.length} step(s) failed\n`);
  process.exit(1);
}
process.stdout.write('\nall steps passed\n');
