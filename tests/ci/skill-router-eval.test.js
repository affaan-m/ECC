'use strict';

const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const test = require('node:test');
const { withFixture } = require('../lib/helpers/context-fixture');
const { canonicalId, evaluatePrompts, loadFixture, ratio } = require('../../scripts/ci/skill-router-eval');

const repoRoot = path.resolve(__dirname, '../..');
const fixtures = path.join(repoRoot, 'tests', 'fixtures', 'skill-router');

// Regression floors, set below the baseline measured with the resolver's
// suggestion evidence bar (lean@1, docs/SKILL-ROUTER.md "Evidence"):
//   prompts.json              prompt hit rate 0.885, precision@3 0.553, 51/52 prompts routed
//   prompts-adversarial.json  prompt hit rate 0.080, precision@3 0.182,  7/25 prompts routed
// Both fixtures were written by the router's author, so they are regression
// evidence, not an independent benchmark. The floors catch a ranking
// regression; they are not targets, and the adversarial file must not be
// tuned against (see its notes). maxRoutedShare holds the adversarial slice
// mostly silent: an unmatched vocabulary should produce no suggestion rather
// than three confident wrong ones.
const FLOORS = {
  'prompts.json': { promptHitRate: 0.85, precisionAt3: 0.5, maxRoutedShare: 1 },
  'prompts-adversarial.json': { promptHitRate: 0.04, precisionAt3: 0.12, maxRoutedShare: 0.4 },
};

test('precision@3 counts suggestions, not prompts', () => {
  const prompts = [
    { prompt: 'one relevant of three', expected: ['skill:a'] },
    { prompt: 'nothing relevant', expected: ['skill:z'] },
    { prompt: 'silent', expected: ['skill:a'] },
  ];
  const returned = { 'one relevant of three': ['skill:a', 'skill:b', 'skill:c'], 'nothing relevant': ['skill:b'], silent: [] };
  const result = evaluatePrompts(prompts, { suggest: prompt => returned[prompt] });
  assert.equal(result.suggestionsReturned, 4);
  assert.equal(result.relevantSuggestions, 1);
  assert.equal(result.routedPrompts, 2);
  assert.equal(result.promptHitRate, ratio(1, 3));
  assert.equal(result.routedPromptHitRate, ratio(1, 2));
  assert.equal(result.precisionAt3, ratio(1, 4));
  assert.deepEqual(result.misses.map(miss => miss.prompt), ['nothing relevant', 'silent']);
});

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
    assert.ok(result.routedPrompts / result.prompts <= floor.maxRoutedShare,
      `${name}: ${result.routedPrompts}/${result.prompts} prompts got suggestions, above ${floor.maxRoutedShare}`);
  });
}
