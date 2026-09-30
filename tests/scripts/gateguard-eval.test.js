/**
 * Tests for scripts/dev/gateguard-eval.js argument parsing and SARIF output.
 */

'use strict';

const assert = require('assert');
const fs = require('fs');
const os = require('os');
const path = require('path');
const { pathToFileURL } = require('url');
const { parseArgs, renderSarif, loadCorpus, runCorpus, summarize, measureColdLatency } = require('../../scripts/dev/gateguard-eval');

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

function step(overrides) {
  return {
    scenario: 'sensitive-targets',
    file: '09-sensitive-targets.json',
    step: 'edit-env',
    expect: 'deny',
    decision: 'deny',
    kind: 'deny',
    mustDeny: true,
    redundant: false,
    ...overrides
  };
}

function summary(steps, totals = {}) {
  return {
    totals: { steps: steps.length, denials: 0, mustDenyBypasses: 0, mismatches: 0, explicitAllows: 0, errors: 0, skippedScenarios: 0, ...totals },
    latency: { p50Ms: 1.234, p95Ms: 5.678 },
    perScenario: [],
    steps
  };
}

function report(workingSteps, baselineTotals = { mustDenyBypasses: 8 }) {
  return {
    corpus: { scenarios: 1, steps: workingSteps.length },
    hooks: [
      { label: 'working tree', ref: null, summary: summary(workingSteps) },
      { label: 'upstream/main', ref: 'upstream/main', summary: summary([], baselineTotals) }
    ]
  };
}

function results(log) {
  return log.runs[0].results;
}

console.log('\n=== Testing gateguard-eval ===\n');

test('--sarif takes a file path and keeps the other options', () => {
  const options = parseArgs(['--json', '--sarif', 'out/gate.sarif', '--baseline', 'main']);
  assert.strictEqual(options.format, 'json');
  assert.strictEqual(options.sarif, path.resolve('out/gate.sarif'));
  assert.deepStrictEqual(options.baselines, ['main']);
});

test('--sarif without a value is rejected', () => {
  assert.throws(() => parseArgs(['--sarif']), /unknown or incomplete argument: --sarif/);
});

test('a clean working tree produces a valid SARIF log with no results', () => {
  const log = JSON.parse(renderSarif(report([step({}), step({ step: 'read-only', mustDeny: false, expect: 'allow', decision: 'allow', kind: 'pass' })])));
  assert.strictEqual(log.version, '2.1.0');
  assert.strictEqual(log.runs.length, 1);
  assert.strictEqual(log.runs[0].tool.driver.name, 'gateguard-eval');
  assert.deepStrictEqual(results(log), []);
});

test('every rule declares a default level', () => {
  const rules = JSON.parse(renderSarif(report([]))).runs[0].tool.driver.rules;
  assert.deepStrictEqual(
    rules.map(rule => [rule.id, rule.defaultConfiguration.level]),
    [
      ['gateguard/must-deny-bypass', 'error'],
      ['gateguard/explicit-allow', 'error'],
      ['gateguard/hook-error', 'error'],
      ['gateguard/expectation-mismatch', 'warning']
    ]
  );
});

test('a must-deny step that was allowed is an error on its scenario file', () => {
  const log = JSON.parse(renderSarif(report([step({ decision: 'allow', kind: 'credit' })])));
  assert.strictEqual(results(log).length, 1);
  const [result] = results(log);
  assert.strictEqual(result.ruleId, 'gateguard/must-deny-bypass');
  assert.strictEqual(result.level, 'error');
  assert.strictEqual(result.locations[0].physicalLocation.artifactLocation.uri, 'tests/fixtures/gateguard-scenarios/09-sensitive-targets.json');
  assert.strictEqual(result.locations[0].physicalLocation.artifactLocation.uriBaseId, '%SRCROOT%');
  assert.match(result.message.text, /sensitive-targets \/ edit-env: expected deny, got allow \(credit\)/);
});

test('a finding from another corpus inside the repository links to that corpus', () => {
  const failing = report([step({ decision: 'allow', kind: 'credit', file: 'custom.json' })]);
  failing.corpusDir = path.join(__dirname, '..', 'fixtures', 'other-scenarios');
  const location = results(JSON.parse(renderSarif(failing)))[0].locations[0].physicalLocation.artifactLocation;
  assert.deepStrictEqual(location, { uri: 'tests/fixtures/other-scenarios/custom.json', uriBaseId: '%SRCROOT%' });
});

test('a finding from a corpus outside the repository links to its absolute file', () => {
  const failing = report([step({ decision: 'allow', kind: 'credit', file: 'custom.json' })]);
  failing.corpusDir = path.join(os.tmpdir(), 'gateguard-corpus');
  const location = results(JSON.parse(renderSarif(failing)))[0].locations[0].physicalLocation.artifactLocation;
  assert.deepStrictEqual(location, { uri: pathToFileURL(path.join(os.tmpdir(), 'gateguard-corpus', 'custom.json')).href });
});

test('an explicit allow and a hook error are reported as errors', () => {
  const log = JSON.parse(
    renderSarif(
      report([
        step({ step: 'a', mustDeny: false, expect: 'allow', decision: 'allow', kind: 'pass', explicitAllow: true }),
        step({ step: 'b', mustDeny: false, error: 'boom' })
      ])
    )
  );
  assert.deepStrictEqual(results(log).map(result => [result.ruleId, result.level]), [
    ['gateguard/explicit-allow', 'error'],
    ['gateguard/hook-error', 'error']
  ]);
});

test('a wrong decision that is not a bypass is a warning', () => {
  const log = JSON.parse(renderSarif(report([step({ mustDeny: false, expect: 'allow', decision: 'deny', kind: 'deny' })])));
  assert.deepStrictEqual(results(log).map(result => [result.ruleId, result.level]), [['gateguard/expectation-mismatch', 'warning']]);
});

test('a bypass is not reported a second time as a mismatch', () => {
  const log = JSON.parse(renderSarif(report([step({ decision: 'allow', kind: 'pass' })])));
  assert.deepStrictEqual(results(log).map(result => result.ruleId), ['gateguard/must-deny-bypass']);
});

test('baseline totals are recorded without their failures becoming results', () => {
  const log = JSON.parse(renderSarif(report([step({})])));
  const hooks = log.runs[0].properties.hooks;
  assert.deepStrictEqual(hooks.map(hook => [hook.label, hook.totals.mustDenyBypasses]), [
    ['working tree', 0],
    ['upstream/main', 8]
  ]);
  assert.deepStrictEqual(results(log), []);
});

test('output leaves out timing so reruns are byte-identical', () => {
  const text = renderSarif(report([step({ latencyMs: 3.21 })]));
  assert.ok(!/latency|p50|p95|Time/i.test(text), 'timing leaked into SARIF');
  const slower = report([step({ latencyMs: 9.87 })]);
  slower.hooks[0].summary.latency = { p50Ms: 9, p95Ms: 99 };
  assert.strictEqual(renderSarif(slower), text);
});

test('--no-cold turns off the fresh-process pass', () => {
  assert.strictEqual(parseArgs([]).cold, true);
  assert.strictEqual(parseArgs(['--no-cold']).cold, false);
});

async function coldTests() {
  const corpusDir = fs.mkdtempSync(path.join(os.tmpdir(), 'gateguard-eval-corpus-'));
  try {
    fs.copyFileSync(
      path.join(__dirname, '..', 'fixtures', 'gateguard-scenarios', '11-first-shell-commands.json'),
      path.join(corpusDir, 'shell.json')
    );
    const scenarios = loadCorpus(corpusDir);
    const hookFile = path.join(__dirname, '..', '..', 'scripts', 'hooks', 'gateguard-fact-force.js');
    const warm = summarize(await runCorpus(hookFile, scenarios));
    const cold = measureColdLatency(hookFile, scenarios);
    test('the fresh-process pass times every step', () => {
      assert.strictEqual(cold.length, scenarios[0].steps.length);
      assert.ok(cold.every(step => Number.isFinite(step.latencyMs) && step.latencyMs > 0));
    });
    test('fresh processes decide every step as the worker does', () => {
      assert.deepStrictEqual(cold.map(step => step.decision), warm.steps.map(step => step.decision));
    });
  } finally {
    fs.rmSync(corpusDir, { recursive: true, force: true });
  }
}

coldTests().then(finish, error => {
  console.log(`  ✗ fresh-process pass failed: ${error.message}`);
  failed++;
  finish();
});

function finish() {
  console.log(`\nPassed: ${passed}`);
  console.log(`Failed: ${failed}`);
  process.exitCode = failed > 0 ? 1 : 0;
}
