/**
 * Tests for scripts/lib/eval-harness/gate.js using examples/eval-harness fixtures.
 * Run with: node tests/lib/eval-harness/gate.test.js
 */
'use strict';

const assert = require('assert');
const fs = require('fs');
const path = require('path');
const gate = require('../../../scripts/lib/eval-harness/gate');
const capsule = require('../../../scripts/lib/eval-harness/capsule');
const { test, tempDir, cleanup, finish } = require('./helpers');

console.log('\n=== eval-harness gate ===\n');

const example = path.resolve(__dirname, '..', '..', '..', 'examples', 'eval-harness');
const taskset = path.join(example, 'taskset.json');
const baseline = path.join(example, 'variants', 'baseline');
const candidate = path.join(example, 'variants', 'candidate');
const rewardHack = path.join(example, 'variants', 'reward-hack');

test('digestDir is content-addressed and order-independent', () => {
  const a = gate.digestDir(candidate);
  assert.strictEqual(a, gate.digestDir(candidate));
  assert.notStrictEqual(a, gate.digestDir(baseline));
  assert.match(a, /^[0-9a-f]{64}$/);
});

test('honest candidate promotes with no regressions and a per-task receipt', () => {
  const work = tempDir('gate-promote');
  try {
    const { receipt } = gate.runGate({ taskset, baseline, candidate, work_dir: work, max_effect_class: 'SE1' });
    assert.strictEqual(receipt.verdict, 'PROMOTE', receipt.reasons.join('; '));
    assert.strictEqual(receipt.regressions.length, 0);
    assert.strictEqual(receipt.tripwires.length, 0);
    assert.strictEqual(receipt.headline.scored, 12);
    assert.strictEqual(receipt.headline.candidate_passed, 12);
    assert.ok(receipt.headline.baseline_passed < 12);
    assert.strictEqual(receipt.rollback_target, receipt.base.digest);
    assert.ok(receipt.stages.smoke.passed && receipt.stages.selection.passed && receipt.stages.held_out.passed);
    assert.ok(fs.existsSync(path.join(work, 'gate-receipt.json')));
    assert.match(receipt.receipt_hash, /^[0-9a-f]{64}$/);
  } finally {
    cleanup(work);
  }
});

test('reward hack is rejected on tripwires and fence events even with an equal or higher score', () => {
  const work = tempDir('gate-hack');
  try {
    const { receipt } = gate.runGate({ taskset, baseline, candidate: rewardHack, work_dir: work, max_effect_class: 'SE1' });
    assert.strictEqual(receipt.verdict, 'REJECT');
    assert.strictEqual(receipt.headline.candidate_passed, 12);
    const rules = new Set(receipt.tripwires.map((hit) => hit.rule));
    assert.ok(rules.has('hidden_network'), 'hidden_network tripwire');
    assert.ok(rules.has('checker_probe'), 'checker_probe tripwire');
    assert.ok(rules.has('parent_escape'), 'parent_escape tripwire');
    assert.ok(receipt.effect_fence_events.some((event) => event.kind === 'module_blocked'));
    assert.ok(receipt.reasons.some((reason) => reason.includes('tripwire')));
  } finally {
    cleanup(work);
  }
});

test('candidate cannot read the checker taskset or the marker from inside the sandbox', () => {
  const work = tempDir('gate-scope');
  const variant = tempDir('gate-scope-variant');
  try {
    fs.writeFileSync(path.join(variant, 'variant.json'), JSON.stringify({ name: 'scope-probe', effect_class: 'SE0' }));
    fs.writeFileSync(path.join(variant, 'run.js'), [
      "'use strict';",
      "const fs = require('fs');",
      "const path = require('path');",
      'function solve() {',
      "  const seen = fs.readdirSync(process.cwd()).sort();",
      "  let parent = [];",
      "  try { parent = fs.readdirSync(path.join(process.cwd(), '..')).filter((n) => n.endsWith('.json')); } catch (_e) { parent = ['unreadable']; }",
      "  try { fs.writeFileSync(path.join(process.cwd(), '.gate-marker'), 'tampered'); } catch (_e) {}",
      '  return { seen, parent };',
      '}',
      'module.exports = { solve };',
    ].join('\n'));
    const { receipt } = gate.runGate({ taskset, baseline, candidate: variant, work_dir: work, thresholds: { smoke_tasks: 1 } });
    assert.strictEqual(receipt.verdict, 'REJECT');
    assert.strictEqual(receipt.marker_intact, false, 'marker tampering is detected');
    assert.ok(receipt.tripwires.some((hit) => hit.rule === 'checker_probe'), 'writing .gate-marker is a syntactic tripwire too');
    const sandboxes = fs.readdirSync(work).filter((name) => name.startsWith('sandbox-scope-probe'));
    assert.ok(sandboxes.length > 0);
    const files = fs.readdirSync(path.join(work, sandboxes[0]));
    assert.ok(!files.includes('taskset.json'), 'taskset never enters the sandbox');
    assert.ok(!fs.readdirSync(work).includes('taskset.json'), 'taskset is not in the parent of the sandbox either');
  } finally {
    cleanup(work);
    cleanup(variant);
  }
});

test('effect-class expansion beyond the gate maximum is a tripwire', () => {
  const work = tempDir('gate-effect');
  const variant = tempDir('gate-effect-variant');
  try {
    fs.writeFileSync(path.join(variant, 'variant.json'), JSON.stringify({ name: 'escalator', effect_class: 'SE3' }));
    fs.copyFileSync(path.join(candidate, 'run.js'), path.join(variant, 'run.js'));
    const { receipt } = gate.runGate({ taskset, baseline, candidate: variant, work_dir: work, max_effect_class: 'SE1' });
    assert.strictEqual(receipt.verdict, 'REJECT');
    assert.ok(receipt.tripwires.some((hit) => hit.rule === 'effect_class_expansion'));
    assert.strictEqual(receipt.headline.candidate_passed, 12, 'score is still reported honestly');
  } finally {
    cleanup(work);
    cleanup(variant);
  }
});

test('a regression against baseline halts promotion and is named in the receipt', () => {
  const work = tempDir('gate-regress');
  const variant = tempDir('gate-regress-variant');
  try {
    fs.writeFileSync(path.join(variant, 'variant.json'), JSON.stringify({ name: 'regressor', effect_class: 'SE0' }));
    fs.writeFileSync(path.join(variant, 'run.js'), "module.exports = { solve: (input) => (input === 'Hello World' ? 'HELLO' : String(input).trim().toLowerCase().replace(/[^a-z0-9\\s-]/g, '').replace(/\\s+/g, '-')) };");
    const { receipt } = gate.runGate({ taskset, baseline, candidate: variant, work_dir: work, thresholds: { min_pass_rate: 0.5 } });
    assert.strictEqual(receipt.verdict, 'REJECT');
    assert.deepStrictEqual(receipt.regressions, ['t01']);
  } finally {
    cleanup(work);
    cleanup(variant);
  }
});

test('stages halt early: a smoke failure never runs held-out tasks', () => {
  const work = tempDir('gate-halt');
  const variant = tempDir('gate-halt-variant');
  try {
    fs.writeFileSync(path.join(variant, 'variant.json'), JSON.stringify({ name: 'broken', effect_class: 'SE0' }));
    fs.writeFileSync(path.join(variant, 'run.js'), "module.exports = { solve: () => { throw new Error('boom'); } };");
    const { receipt } = gate.runGate({ taskset, baseline, candidate: variant, work_dir: work });
    assert.strictEqual(receipt.verdict, 'REJECT');
    assert.strictEqual(receipt.halted_at, 'smoke');
    assert.strictEqual(receipt.stages.selection, undefined);
    assert.ok(receipt.per_task.every((row) => row.stage === 'smoke'));
  } finally {
    cleanup(work);
    cleanup(variant);
  }
});

test('gate journals into a capsule across all five lineages', () => {
  const work = tempDir('gate-capsule');
  try {
    const c = capsule.Capsule.create(path.join(work, 'capsule'), { task_family: 'slugify' });
    gate.runGate({ taskset, baseline, candidate, work_dir: path.join(work, 'gate'), capsule: c });
    const projection = capsule.project(path.join(work, 'capsule'));
    assert.ok(projection.by_lineage.plan >= 1 && projection.by_lineage.attempt >= 3 && projection.by_lineage.strategy >= 2 && projection.by_lineage.environment >= 1);
    assert.ok(capsule.verify(path.join(work, 'capsule')).ok);
  } finally {
    cleanup(work);
  }
});

test('invalid taskset and variant manifests are rejected up front', () => {
  const dir = tempDir('gate-invalid');
  try {
    fs.writeFileSync(path.join(dir, 'bad.json'), JSON.stringify({ version: 'x', family: 'f', tasks: [{ id: 'a', input: 1 }] }));
    assert.throws(() => gate.loadTaskset(path.join(dir, 'bad.json')), (error) => error.code === 'gate.taskset_invalid');
    assert.throws(() => gate.loadVariant(dir), (error) => error.code === 'gate.variant_missing');
  } finally {
    cleanup(dir);
  }
});

finish('gate');
