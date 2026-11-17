/**
 * Scenario corpus for scripts/hooks/gateguard-fact-force.js, run against the working tree.
 */

'use strict';

const assert = require('assert');
const path = require('path');
const { loadCorpus, runCorpus, summarize } = require('../../scripts/dev/gateguard-eval');

const hookFile = path.join(__dirname, '..', '..', 'scripts', 'hooks', 'gateguard-fact-force.js');

let passed = 0;
let failed = 0;

function test(name, fn) {
  try {
    fn();
    console.log(`  ✓ ${name}`);
    passed++;
  } catch (error) {
    console.log(`  ✗ ${name}`);
    console.log(`    Error: ${error.message}`);
    failed++;
  }
}

async function main() {
  console.log('\n=== Testing gateguard scenario corpus ===\n');

  const scenarios = loadCorpus();
  const runs = await runCorpus(hookFile, scenarios);
  const summary = summarize(runs);
  const stepCount = scenarios.reduce((sum, scenario) => sum + scenario.steps.length, 0);

  test('the corpus holds at least twelve scenarios and eighty steps', () => {
    assert.ok(scenarios.length >= 12, `${scenarios.length} scenarios`);
    assert.ok(stepCount >= 80, `${stepCount} steps`);
  });

  for (const run of runs) {
    if (run.skipped) {
      console.log(`  - ${run.scenario.name} skipped (${run.skipped})`);
      continue;
    }
    test(`${run.scenario.name}: every step gets its expected decision`, () => {
      const wrong = run.results
        .map((result, index) => ({ result, step: run.scenario.steps[index] }))
        .filter(({ result, step }) => result.decision !== step.expect)
        .map(({ result, step }) => `${step.id} expected ${step.expect}, got ${result.decision} (${result.kind})`);
      assert.deepStrictEqual(wrong, []);
    });
  }

  test('no must-deny step is allowed', () => {
    const bypasses = summary.steps.filter(step => step.mustDeny && step.decision !== 'deny').map(step => `${step.scenario}/${step.step}`);
    assert.deepStrictEqual(bypasses, []);
  });

  test('no step emits an explicit allow decision or throws', () => {
    assert.strictEqual(summary.totals.explicitAllows, 0);
    assert.strictEqual(summary.totals.errors, 0);
  });

  test('every question in a code denial maps to a known question id', () => {
    assert.strictEqual(summary.totals.unmappedQuestions, 0);
  });

  test('only scenarios that need symlinks or hard links may be skipped', () => {
    const skipped = runs.filter(run => run.skipped && !run.scenario.symlinks && !run.scenario.hardlinks).map(run => run.scenario.name);
    assert.deepStrictEqual(skipped, []);
  });

  console.log(`\nPassed: ${passed}`);
  console.log(`Failed: ${failed}`);
  process.exitCode = failed > 0 ? 1 : 0;
}

main().catch(error => {
  console.log(`  ✗ scenario corpus run failed: ${error.message}`);
  console.log('\nPassed: 0');
  console.log('Failed: 1');
  process.exitCode = 1;
});
