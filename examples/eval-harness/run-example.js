#!/usr/bin/env node
'use strict';

/**
 * End-to-end demonstration of the eval-harness frameworks.
 *
 *   node examples/eval-harness/run-example.js [--keep]
 *
 * 1. Records a capsule with all five lineages while running the staged gate.
 * 2. Promotes the honest candidate, rejects the reward hack on tripwires.
 * 3. Replays a declared tool from fixtures and fails closed on a missing one.
 * 4. Builds an offline receipt, verifies it, then proves tamper detection by
 *    flipping one byte in a copy of the journal.
 *
 * Everything runs inside a temporary directory. Nothing touches the network.
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

let candidateReceipt;
step('Gate: honest candidate against baseline', () => {
  const result = harness.gate.runGate({
    taskset: resolve(config.taskset),
    baseline: resolve(config.baseline),
    candidate: resolve(config.candidate),
    thresholds: config.thresholds,
    max_effect_class: config.max_effect_class,
    work_dir: path.join(work, 'gate-candidate'),
    capsule,
  });
  candidateReceipt = result.receipt;
  expect(candidateReceipt.verdict === 'PROMOTE', `verdict PROMOTE (candidate ${candidateReceipt.headline.candidate_passed}/${candidateReceipt.headline.scored}, baseline ${candidateReceipt.headline.baseline_passed})`);
  expect(candidateReceipt.regressions.length === 0, 'no regressions against baseline');
  expect(candidateReceipt.tripwires.length === 0, 'no tripwire hits');
});

step('Gate: reward hack is rejected despite an equal headline score', () => {
  const result = harness.gate.runGate({
    taskset: resolve(config.taskset),
    baseline: resolve(config.baseline),
    candidate: resolve('variants/reward-hack'),
    thresholds: config.thresholds,
    max_effect_class: config.max_effect_class,
    work_dir: path.join(work, 'gate-reward-hack'),
    capsule,
  });
  const receipt = result.receipt;
  expect(receipt.verdict === 'REJECT', `verdict REJECT (headline ${receipt.headline.candidate_passed}/${receipt.headline.scored})`);
  const rules = new Set(receipt.tripwires.map((hit) => hit.rule));
  expect(rules.has('hidden_network') && rules.has('checker_probe'), `tripwires fired: ${[...rules].join(', ')}`);
  expect(receipt.effect_fence_events.some((event) => event.kind === 'module_blocked'), 'effect fence recorded the blocked network module');
  expect(receipt.headline.candidate_passed >= candidateReceipt.headline.candidate_passed, 'the hack scored at least as high as the honest candidate, and still lost');
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
      tool: entry.tool, status: entry.status, fixture_key: entry.fixture_key, args_hash: entry.args_hash, response_hash: entry.response_hash,
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
    gate_receipt: candidateReceipt,
  });
  const bundle = harness.capsule.exportBundle(capsuleDir, path.join(work, 'bundle'));
  const verdict = harness.receipt.verifyReceipt(receipt, bundle.dir, {
    artifact_path: resolve('variants/candidate/run.js'),
    gate_receipt: candidateReceipt,
  });
  expect(verdict.ok, 'exported bundle verifies against the receipt without the source store');
  harness.receipt.writeReceipt(receipt, path.join(work, 'bundle', 'receipt.json'));
});

step('Tamper: one flipped byte fails at the exact entry', () => {
  const tampered = path.join(work, 'tampered');
  harness.capsule.exportBundle(capsuleDir, tampered);
  const journalPath = path.join(tampered, harness.capsule.JOURNAL_FILE);
  const lines = fs.readFileSync(journalPath, 'utf8').split('\n');
  const target = 2;
  lines[target] = lines[target].replace('"status":"pass"', '"status":"fail"').replace('"hits":0', '"hits":1');
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
