'use strict';

const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { spawnSync } = require('node:child_process');
const { test } = require('node:test');
const { createSkillObservation, appendSkillObservation, getSkillObservationsPath } = require('../../scripts/lib/skill-improvement/observations');
const { buildSkillHealthReport } = require('../../scripts/lib/skill-improvement/health');

function isolatedReport(script) {
  const result = spawnSync(process.execPath, ['-e', `
    const assert = require('node:assert/strict');
    const { createSkillObservation } = require(process.argv[1]);
    const { buildSkillHealthReport } = require(process.argv[2]);
    ${script}
  `, require.resolve('../../scripts/lib/skill-improvement/observations'),
  require.resolve('../../scripts/lib/skill-improvement/health')], {
    encoding: 'utf8', timeout: 5000, windowsHide: true,
  });
  assert.ifError(result.error);
  assert.equal(result.status, 0, result.stderr);
}

test('every inherited object name is counted as an ordinary canonical observation variant', () => {
  isolatedReport(`
    const names = Object.getOwnPropertyNames(Object.prototype);
    const records = names.flatMap(variant => [true, false, true].map(success =>
      createSkillObservation({ task: 'Compare implementations', skill: { id: 'review' }, variant, success })));
    const report = buildSkillHealthReport(records);
    const variants = report.skills[0].variants;
    assert.equal(Object.getPrototypeOf(variants), Object.prototype);
    assert.equal(Object.keys(variants).length, names.length);
    for (const name of names) {
      assert.ok(Object.hasOwn(variants, name), name);
      assert.deepEqual(variants[name], { runs: 3, successes: 2, failures: 1 });
    }
    const restored = JSON.parse(JSON.stringify(report)).skills[0].variants;
    assert.deepEqual(restored, variants);
  `);
});

test('reporting does not write counters into shared prototypes or built-in functions', () => {
  isolatedReport(`
    const targets = [Object.prototype, Object, Object.prototype.toString, Object.prototype.valueOf];
    const before = targets.map(value => Object.getOwnPropertyDescriptors(value));
    const records = ['__proto__', 'constructor', 'toString', 'valueOf'].map(variant =>
      createSkillObservation({ task: 'Review variants', skill: { id: 'review' }, variant, success: false }));
    buildSkillHealthReport(records);
    for (let i = 0; i < targets.length; i++) assert.deepEqual(Object.getOwnPropertyDescriptors(targets[i]), before[i]);
    assert.equal(Object.hasOwn({}, 'runs'), false);
  `);
});

test('the canonical writer and public health CLI preserve custom variant counts and source bytes', () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'ecc-variant-health-'));
  try {
    const names = ['baseline', '__proto__', 'constructor', 'toString', 'release-候选'];
    for (const variant of names) {
      for (const success of [true, false]) {
        appendSkillObservation(createSkillObservation({
          task: 'Compare implementations', skill: { id: 'review' }, variant, success,
        }), { projectRoot: root });
      }
    }
    appendSkillObservation(createSkillObservation({
      task: 'Other skill', skill: { id: 'other' }, variant: 'constructor', success: true,
    }), { projectRoot: root });
    const sourcePath = getSkillObservationsPath({ projectRoot: root });
    const original = fs.readFileSync(sourcePath);
    const result = spawnSync(process.execPath, [
      require.resolve('../../scripts/session-inspect'), 'skills:health', '--skill', 'review', '--observations', sourcePath,
    ], { cwd: root, encoding: 'utf8', timeout: 5000, windowsHide: true });
    assert.ifError(result.error);
    assert.equal(result.status, 0, result.stderr);
    const report = JSON.parse(result.stdout);
    assert.equal(report.totalObservations, 10);
    assert.equal(report.skillCount, 1);
    assert.deepEqual(report.skills[0].variants, Object.fromEntries(names.map(name =>
      [name, { runs: 2, successes: 1, failures: 1 }])));
    assert.deepEqual(fs.readFileSync(sourcePath), original);
  } finally { fs.rmSync(root, { recursive: true, force: true }); }
});

test('ordinary variants, baseline defaults and input records retain their existing behavior', () => {
  const variants = [undefined, '', 'baseline', 'amended', 'release-候选', '7', 'amended'];
  const records = variants.map((variant, index) => createSkillObservation({
    task: 'Evaluate ordinary variants', skill: { id: 'review' }, variant, success: index % 2 === 0,
  }));
  const original = JSON.stringify(records);
  const report = buildSkillHealthReport(records);
  assert.deepEqual(report.skills[0].variants, {
    baseline: { runs: 3, successes: 2, failures: 1 },
    amended: { runs: 2, successes: 1, failures: 1 },
    'release-候选': { runs: 1, successes: 1, failures: 0 },
    7: { runs: 1, successes: 0, failures: 1 },
  });
  assert.equal(Object.getPrototypeOf(report.skills[0].variants), Object.prototype);
  assert.equal(JSON.stringify(records), original);
  assert.deepEqual(buildSkillHealthReport([]).skills, []);
});
