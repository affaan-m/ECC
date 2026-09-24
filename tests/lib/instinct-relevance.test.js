/**
 * Tests for scripts/lib/instinct-relevance.js
 *
 * Run with: node tests/lib/instinct-relevance.test.js
 */

const assert = require('assert');
const path = require('path');
const fs = require('fs');
const os = require('os');

const {
  DEFAULT_PROJECT_SCOPE_BOOST,
  DEFAULT_STACK_MATCH_BOOST,
  isRelevanceRankingEnabled,
  detectStackKeywords,
  instinctMatchesStack,
  computeRelevanceBoost,
  tokenize,
} = require('../../scripts/lib/instinct-relevance');

function test(name, fn) {
  try {
    fn();
    console.log(`  ✓ ${name}`);
    return true;
  } catch (err) {
    console.log(`  ✗ ${name}`);
    console.log(`    ${err.message}`);
    return false;
  }
}

function createTempDir() {
  return fs.mkdtempSync(path.join(os.tmpdir(), 'ecc-instinct-relevance-'));
}

function cleanupDir(dir) {
  try {
    fs.rmSync(dir, { recursive: true, force: true });
  } catch {
    /* ignore */
  }
}

function writeFile(dir, name, content) {
  fs.writeFileSync(path.join(dir, name), content);
}

function runTests() {
  let passed = 0;
  let failed = 0;

  console.log('\nInstinct relevance ranking tests\n');

  // --- tokenize ---------------------------------------------------------
  if (test('tokenize splits on non-alphanumerics and lowercases', () => {
    assert.deepStrictEqual(tokenize('Terraform-AWS_infra'), ['terraform', 'aws', 'infra']);
    assert.deepStrictEqual(tokenize('when editing hooks'), ['when', 'editing', 'hooks']);
    assert.deepStrictEqual(tokenize(''), []);
    assert.deepStrictEqual(tokenize(undefined), []);
  })) passed++; else failed++;

  // --- detectStackKeywords ---------------------------------------------
  if (test('detectStackKeywords returns empty set for an empty directory', () => {
    const dir = createTempDir();
    try {
      const kw = detectStackKeywords(dir);
      assert.ok(kw instanceof Set, 'should return a Set');
      assert.strictEqual(kw.size, 0);
    } finally {
      cleanupDir(dir);
    }
  })) passed++; else failed++;

  if (test('detectStackKeywords picks up a Rust project (Cargo.toml)', () => {
    const dir = createTempDir();
    try {
      writeFile(dir, 'Cargo.toml', '[package]\nname = "x"\n');
      const kw = detectStackKeywords(dir);
      assert.ok(kw.has('rust'), `expected rust in ${[...kw].join(',')}`);
    } finally {
      cleanupDir(dir);
    }
  })) passed++; else failed++;

  if (test('detectStackKeywords picks up a Go project (go.mod)', () => {
    const dir = createTempDir();
    try {
      writeFile(dir, 'go.mod', 'module example.com/x\n\ngo 1.21\n');
      const kw = detectStackKeywords(dir);
      assert.ok(kw.has('golang'), `expected golang in ${[...kw].join(',')}`);
    } finally {
      cleanupDir(dir);
    }
  })) passed++; else failed++;

  if (test('detectStackKeywords adds terraform for *.tf / *.tfvars files', () => {
    const dir = createTempDir();
    try {
      writeFile(dir, 'main.tf', 'resource "null_resource" "x" {}\n');
      const kw = detectStackKeywords(dir);
      assert.ok(kw.has('terraform'), `expected terraform in ${[...kw].join(',')}`);
    } finally {
      cleanupDir(dir);
    }
  })) passed++; else failed++;

  if (test('detectStackKeywords adds dbt for dbt_project.yml', () => {
    const dir = createTempDir();
    try {
      writeFile(dir, 'dbt_project.yml', "name: 'demo'\n");
      const kw = detectStackKeywords(dir);
      assert.ok(kw.has('dbt'), `expected dbt in ${[...kw].join(',')}`);
    } finally {
      cleanupDir(dir);
    }
  })) passed++; else failed++;

  if (test('detectStackKeywords accepts a precomputed projectInfo', () => {
    const kw = detectStackKeywords('/nonexistent', {
      languages: ['python'],
      frameworks: ['django'],
    });
    assert.ok(kw.has('python') && kw.has('django'));
  })) passed++; else failed++;

  // --- instinctMatchesStack --------------------------------------------
  if (test('instinctMatchesStack matches on domain token', () => {
    const kw = new Set(['terraform']);
    assert.strictEqual(instinctMatchesStack({ domain: 'terraform' }, kw), true);
    assert.strictEqual(instinctMatchesStack({ domain: 'terraform-aws' }, kw), true);
  })) passed++; else failed++;

  if (test('instinctMatchesStack matches on trigger token', () => {
    const kw = new Set(['python']);
    assert.strictEqual(
      instinctMatchesStack({ trigger: 'when writing python tests' }, kw),
      true
    );
  })) passed++; else failed++;

  if (test('instinctMatchesStack avoids substring false positives (go != good)', () => {
    const kw = new Set(['go']);
    assert.strictEqual(instinctMatchesStack({ domain: 'good practices' }, kw), false);
  })) passed++; else failed++;

  if (test('instinctMatchesStack is false with empty keyword set or fields', () => {
    assert.strictEqual(instinctMatchesStack({ domain: 'terraform' }, new Set()), false);
    assert.strictEqual(instinctMatchesStack({}, new Set(['terraform'])), false);
    assert.strictEqual(instinctMatchesStack(null, new Set(['terraform'])), false);
  })) passed++; else failed++;

  // --- computeRelevanceBoost -------------------------------------------
  if (test('computeRelevanceBoost gives project boost only for project scope', () => {
    const kw = new Set();
    assert.strictEqual(
      computeRelevanceBoost({ _scopeLabel: 'project' }, kw),
      DEFAULT_PROJECT_SCOPE_BOOST
    );
    assert.strictEqual(computeRelevanceBoost({ _scopeLabel: 'global' }, kw), 0);
  })) passed++; else failed++;

  if (test('computeRelevanceBoost gives stack boost only on a stack match', () => {
    const kw = new Set(['rust']);
    assert.strictEqual(
      computeRelevanceBoost({ _scopeLabel: 'global', domain: 'rust' }, kw),
      DEFAULT_STACK_MATCH_BOOST
    );
    assert.strictEqual(
      computeRelevanceBoost({ _scopeLabel: 'global', domain: 'python' }, kw),
      0
    );
  })) passed++; else failed++;

  if (test('computeRelevanceBoost stacks project + stack boosts', () => {
    const kw = new Set(['rust']);
    const boost = computeRelevanceBoost({ _scopeLabel: 'project', domain: 'rust' }, kw);
    assert.strictEqual(boost, DEFAULT_PROJECT_SCOPE_BOOST + DEFAULT_STACK_MATCH_BOOST);
  })) passed++; else failed++;

  if (test('computeRelevanceBoost honours custom boost overrides', () => {
    const kw = new Set(['rust']);
    const boost = computeRelevanceBoost(
      { _scopeLabel: 'project', domain: 'rust' },
      kw,
      { projectBoost: 1, stackBoost: 2 }
    );
    assert.strictEqual(boost, 3);
  })) passed++; else failed++;

  if (test('a project 0.7 instinct outranks an unrelated global 0.9 with boosts', () => {
    // Confirms the boost magnitudes satisfy the issue's motivating example.
    const kw = new Set();
    const projectScore = 0.7 + computeRelevanceBoost({ _scopeLabel: 'project' }, kw);
    const globalScore = 0.9 + computeRelevanceBoost({ _scopeLabel: 'global' }, kw);
    assert.ok(projectScore > globalScore, `${projectScore} !> ${globalScore}`);
  })) passed++; else failed++;

  if (test('a stack-matching 0.75 instinct outranks an unrelated 0.9 with boosts', () => {
    const kw = new Set(['terraform']);
    const matchScore = 0.75 + computeRelevanceBoost({ _scopeLabel: 'global', domain: 'terraform' }, kw);
    const otherScore = 0.9 + computeRelevanceBoost({ _scopeLabel: 'global', domain: 'python' }, kw);
    assert.ok(matchScore > otherScore, `${matchScore} !> ${otherScore}`);
  })) passed++; else failed++;

  // --- isRelevanceRankingEnabled ---------------------------------------
  if (test('isRelevanceRankingEnabled defaults on and honours the opt-out toggle', () => {
    const original = process.env.ECC_INSTINCT_RELEVANCE_RANKING;
    try {
      delete process.env.ECC_INSTINCT_RELEVANCE_RANKING;
      assert.strictEqual(isRelevanceRankingEnabled(), true, 'unset should be on');
      for (const off of ['off', 'OFF', 'false', '0', 'no']) {
        process.env.ECC_INSTINCT_RELEVANCE_RANKING = off;
        assert.strictEqual(isRelevanceRankingEnabled(), false, `${off} should be off`);
      }
      for (const on of ['on', '1', 'true', 'yes', 'anything']) {
        process.env.ECC_INSTINCT_RELEVANCE_RANKING = on;
        assert.strictEqual(isRelevanceRankingEnabled(), true, `${on} should be on`);
      }
    } finally {
      if (original === undefined) delete process.env.ECC_INSTINCT_RELEVANCE_RANKING;
      else process.env.ECC_INSTINCT_RELEVANCE_RANKING = original;
    }
  })) passed++; else failed++;

  console.log(`\n=== Results: ${passed} passed, ${failed} failed ===\n`);
  process.exit(failed > 0 ? 1 : 0);
}

runTests();
