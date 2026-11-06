'use strict';

const assert = require('node:assert/strict');
const test = require('node:test');

const evaluator = () => require('../../scripts/ci/evaluate-context-routing');

const row = (set, expected, candidateIds, selectedIds = []) => ({ set, query: `${set} ${candidateIds.join(' ')}`, expected, candidateIds, selectedIds });

function healthyRows() {
  const rows = [];
  for (let index = 0; index < 50; index++) rows.push(row('direct', ['skill:a'], ['skill:a', 'skill:b', 'skill:c']));
  rows.push(row('direct', ['skill:a'], ['skill:b', 'skill:a', 'skill:c']));
  rows.push(row('direct', ['skill:a'], ['skill:b', 'skill:c', 'skill:d']));
  for (let index = 0; index < 25; index++) rows.push(row('paraphrased', ['skill:a'], ['skill:z']));
  return rows;
}

test('healthy rows pass every gate and report per-set rates', () => {
  const result = evaluator().score(healthyRows());
  assert.equal(result.status, 'pass');
  assert.deepEqual(result.breaches, []);
  assert.equal(result.sets.direct.prompts, 52);
  assert.equal(result.sets.direct.top1, 50);
  assert.equal(result.sets.direct.top3, 51);
  assert.equal(result.sets.paraphrased.top3Rate, 0);
});

test('a planted ranking regression fails and names the breached threshold', () => {
  const rows = healthyRows().map((entry, index) => (entry.set === 'direct' && index < 10
    ? { ...entry, candidateIds: ['skill:x', 'skill:y', 'skill:z'] } : entry));
  const result = evaluator().score(rows);
  assert.equal(result.status, 'fail');
  assert.ok(result.breaches.some(breach => breach.metric === 'direct.top3Rate'));
  assert.ok(result.breaches.some(breach => breach.metric === 'direct.top1Rate'));
});

test('one wrong implicit load fails regardless of ranking quality', () => {
  const rows = healthyRows();
  rows[0] = { ...rows[0], selectedIds: ['skill:b'] };
  const result = evaluator().score(rows);
  assert.equal(result.status, 'fail');
  assert.deepEqual(result.breaches.map(breach => breach.metric), ['direct.wrongLoads']);
  assert.equal(result.wrongLoads.length, 1);
  assert.equal(result.sets.direct.admissionPrecision, 0);
});

test('paraphrased ranking is reported, never gated; its wrong loads still fail', () => {
  const rows = healthyRows();
  assert.equal(evaluator().score(rows).status, 'pass');
  const loaded = rows.map(entry => (entry.set === 'paraphrased' ? { ...entry, selectedIds: ['skill:z'] } : entry));
  const result = evaluator().score(loaded);
  assert.deepEqual(result.breaches.map(breach => breach.metric), ['paraphrased.wrongLoads']);
});

test('no implicit loads leaves admission precision undefined instead of perfect', () => {
  assert.equal(evaluator().score(healthyRows()).sets.direct.admissionPrecision, null);
});

/** Direct rows whose expected skill sits at ranks[index]; rows past ranks.length miss it. */
function rankedRows(total, ranks) {
  return Array.from({ length: total }, (_, index) => {
    const candidateIds = ['skill:w', 'skill:x', 'skill:y', 'skill:z'];
    if (index < ranks.length) candidateIds[ranks[index]] = 'skill:a';
    return row('direct', ['skill:a'], candidateIds);
  });
}

test('top-3 counts a hit at the third rank but not the fourth', () => {
  const { direct } = evaluator().score(rankedRows(4, [0, 2, 3])).sets;
  assert.equal(direct.top1, 1);
  assert.equal(direct.top3, 2);
});

test('thresholds compare unrounded ratios and pass exactly at 0.88 and 0.80', () => {
  const { score } = evaluator();
  const atThreshold = score(rankedRows(25, [...Array(20).fill(0), 1, 1]));
  assert.equal(atThreshold.sets.direct.top1Rate, 0.8);
  assert.equal(atThreshold.sets.direct.top3Rate, 0.88);
  assert.deepEqual(atThreshold.breaches, []);
  const roundsUp = score(rankedRows(2500, [...Array(1999).fill(0), ...Array(501).fill(1)]));
  assert.deepEqual(roundsUp.breaches, [{ metric: 'direct.top1Rate', actual: 0.8, required: 0.8 }]);
});

test('thresholds are pinned and an empty corpus fails closed', () => {
  const { THRESHOLDS, score } = evaluator();
  assert.deepEqual({ ...THRESHOLDS }, { 'direct.top3Rate': 0.88, 'direct.top1Rate': 0.8 });
  const result = score([]);
  assert.equal(result.status, 'fail');
  assert.deepEqual(result.breaches.map(breach => [breach.metric, breach.actual]), [['direct.top3Rate', null], ['direct.top1Rate', null]]);
});

test('--baseline prints a per-metric delta against a previous receipt', () => {
  const current = evaluator().score(healthyRows());
  const previous = JSON.parse(JSON.stringify(current));
  previous.sets.direct.top1Rate = 1;
  const lines = evaluator().baselineDelta(current, previous);
  assert.ok(lines.some(line => /direct\.top1Rate/.test(line) && /-0\.038/.test(line)));
  assert.ok(lines.some(line => /direct\.top3Rate/.test(line) && /\+0\.000/.test(line)));
});

test('the CLI emits JSON, applies a baseline and exits by gate status without re-running the corpus', () => {
  const output = [];
  const io = { log: text => output.push(text), error: text => output.push(text), readFile: () => JSON.stringify(evaluator().score(healthyRows())) };
  const passing = { evaluate: () => evaluator().score(healthyRows()) };
  assert.equal(evaluator().main(['--json'], { ...passing, ...io }), 0);
  assert.equal(JSON.parse(output.at(-1)).status, 'pass');
  output.length = 0;
  assert.equal(evaluator().main(['--baseline', 'previous.json'], { ...passing, ...io }), 0);
  assert.ok(output.some(line => /direct\.top1Rate/.test(line)));
  const failing = { evaluate: () => evaluator().score(healthyRows().map(entry => ({ ...entry, selectedIds: ['skill:q'] }))) };
  assert.equal(evaluator().main([], { ...failing, ...io }), 1);
  assert.equal(evaluator().main(['--write'], { ...passing, ...io }), 1);
  assert.equal(evaluator().main(['--baseline'], { ...passing, ...io }), 1);
});

test('the CLI reads the baseline before the corpus run and keeps --json stdout parseable', () => {
  const stdout = [];
  const stderr = [];
  let runs = 0;
  const io = { log: text => stdout.push(text), error: text => stderr.push(text),
    evaluate: () => { runs += 1; return evaluator().score(healthyRows()); } };
  const receipt = JSON.stringify(evaluator().score(healthyRows()));
  assert.equal(evaluator().main(['--json', '--baseline', 'previous.json'], { ...io, readFile: () => receipt }), 0);
  assert.equal(JSON.parse(stdout.join('\n')).status, 'pass');
  assert.ok(stderr.some(line => /direct\.top1Rate/.test(line)));
  runs = 0;
  assert.equal(evaluator().main(['--baseline', 'missing.json'], { ...io, readFile: () => { throw new Error('ENOENT'); } }), 1);
  assert.equal(evaluator().main(['--baseline', 'bad.json'], { ...io, readFile: () => '{bad' }), 1);
  assert.equal(evaluator().main(['--baseline', 'null.json'], { ...io, readFile: () => 'null' }), 1);
  assert.equal(runs, 0);
  assert.equal(evaluator().main([], { ...io, evaluate: () => { throw new Error('boom'); } }), 1);
  assert.ok(stderr.includes('Routing quality evaluation failed: boom'));
});

test('a baseline that is not a routing-quality receipt fails before the corpus run', () => {
  let runs = 0;
  const io = { log: () => {}, error: () => {}, evaluate: () => { runs += 1; return evaluator().score(healthyRows()); } };
  for (const text of ['{}', '[]', '{"schemaVersion":"other.v1","sets":{"direct":{},"paraphrased":{}}}', '{"schemaVersion":"ecc.routing-quality.v1"}']) {
    assert.equal(evaluator().main(['--baseline', 'previous.json'], { ...io, readFile: () => text }), 1, text);
  }
  assert.equal(runs, 0);
  const nullRates = JSON.stringify(evaluator().score([]));
  assert.equal(evaluator().main(['--baseline', 'previous.json'], { ...io, readFile: () => nullRates }), 0);
});

test('an incomplete corpus fails before any prompt is resolved', () => {
  const fs = require('node:fs');
  const os = require('node:os');
  const path = require('node:path');
  const directory = fs.mkdtempSync(path.join(os.tmpdir(), 'ecc-routing-corpus-'));
  const prompt = { query: 'review this pull request', expected: ['skill:a'] };
  try {
    for (const corpus of [{}, { paraphrased: [prompt] }, { direct: [], paraphrased: [] }, { direct: [prompt], paraphrased: [] },
      { direct: [{ query: 'x' }], paraphrased: [prompt] }, { direct: [{ query: 42, expected: ['skill:a'] }], paraphrased: [prompt] },
      { direct: [{ query: 'x', expected: [] }], paraphrased: [prompt] }]) {
      const corpusPath = path.join(directory, 'corpus.json');
      fs.writeFileSync(corpusPath, JSON.stringify(corpus));
      const errors = [];
      assert.equal(evaluator().main([], { log: () => {}, error: text => errors.push(text), evaluate: () => evaluator().evaluate({ corpusPath }) }), 1, JSON.stringify(corpus));
      assert.match(errors.join('\n'), /routing corpus/);
    }
  } finally {
    fs.rmSync(directory, { recursive: true, force: true, maxRetries: 3 });
  }
});

test('the gate has an npm entry point but stays out of the default test chain', () => {
  const { scripts } = require('../../package.json');
  assert.equal(scripts['routing:check'], 'node scripts/ci/evaluate-context-routing.js');
  assert.ok(!scripts.test.includes('evaluate-context-routing'));
  assert.ok(!scripts.test.includes('routing:check'));
});
