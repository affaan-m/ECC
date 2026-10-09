'use strict';

const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const test = require('node:test');
const { withFixture } = require('../lib/helpers/context-fixture');
const { canonicalId, evaluatePrompts, loadFixture, ratio } = require('../../scripts/ci/skill-router-eval');

const repoRoot = path.resolve(__dirname, '../..');
const fixtures = path.join(repoRoot, 'tests', 'fixtures', 'skill-router');

// Regression floors, set below the baseline measured when the router moved
// onto the canonical resolver (lean@1, docs/SKILL-ROUTER.md "Evidence"):
//   prompts.json              prompt hit rate 0.923, precision@3 0.372
//   prompts-adversarial.json  prompt hit rate 0.160, precision@3 0.067
// Both fixtures were written by the router's author, so they are regression
// evidence, not an independent benchmark. The floors catch a ranking
// regression; they are not targets, and the adversarial file must not be
// tuned against (see its notes).
const FLOORS = {
  'prompts.json': { promptHitRate: 0.85, precisionAt3: 0.3 },
  'prompts-adversarial.json': { promptHitRate: 0.12, precisionAt3: 0.04 },
};

test('precision@3 counts suggestions, not prompts', () => withFixture(root => {
  // The prompt names three fixture skills, so three suggestions come back
  // and exactly one of them is the expected skill.
  const result = evaluatePrompts([{ prompt: 'feature shared configure work', expected: ['skill:feature'] }], { root });
  assert.equal(result.suggestionsReturned, 3);
  assert.equal(result.relevantSuggestions, 1);
  assert.equal(result.promptHitRate, 1);
  assert.equal(result.routedPromptHitRate, 1);
  assert.equal(result.precisionAt3, ratio(1, 3));
}));

test('fixture IDs must exist in the canonical registry', () => withFixture(root => {
  const file = path.join(root, 'bad-fixture.json');
  fs.writeFileSync(file, JSON.stringify({ prompts: [{ prompt: 'help with it', expected: ['not-a-skill'] }] }));
  assert.throws(() => loadFixture(file, root), /unknown skill IDs: skill:not-a-skill/);
  assert.equal(canonicalId('feature'), 'skill:feature');
  assert.equal(canonicalId('skill:feature'), 'skill:feature');
}));

for (const [name, floor] of Object.entries(FLOORS)) {
  test(`${name} stays above its regression floor`, () => {
    const { prompts } = loadFixture(path.join(fixtures, name));
    const result = evaluatePrompts(prompts);
    assert.equal(result.prompts, prompts.length);
    assert.ok(result.suggestionsReturned <= prompts.length * 3);
    assert.ok(result.promptHitRate >= floor.promptHitRate,
      `${name}: prompt hit rate ${result.promptHitRate} fell below ${floor.promptHitRate}`);
    assert.ok(result.precisionAt3 >= floor.precisionAt3,
      `${name}: precision@3 ${result.precisionAt3} fell below ${floor.precisionAt3}`);
  });
}
