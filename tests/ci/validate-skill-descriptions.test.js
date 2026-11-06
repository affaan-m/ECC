'use strict';

const assert = require('assert');
const fs = require('fs');
const os = require('os');
const path = require('path');
const { spawnSync } = require('child_process');
const ROOT = path.resolve(__dirname, '../..');
const SCRIPT = path.join(ROOT, 'scripts/ci/validate-skill-descriptions.js');

/**
 * Run the validator against a temporary repo-shaped fixture.
 * @param {object} options - Fixture layout
 * @param {Record<string, string>} options.skills - skill dir -> SKILL.md body
 * @param {object} options.budget - skill-description-budget.json contents
 * @returns {{status: number, stdout: string, stderr: string}}
 */
function runWithFixture({ skills, budget }) {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'ecc-desc-'));
  fs.mkdirSync(path.join(dir, 'scripts', 'ci'), { recursive: true });
  fs.mkdirSync(path.join(dir, 'manifests'), { recursive: true });
  fs.copyFileSync(SCRIPT, path.join(dir, 'scripts', 'ci', 'validate-skill-descriptions.js'));
  fs.writeFileSync(
    path.join(dir, 'manifests', 'skill-description-budget.json'),
    JSON.stringify(budget),
  );
  for (const [name, body] of Object.entries(skills)) {
    fs.mkdirSync(path.join(dir, 'skills', name), { recursive: true });
    fs.writeFileSync(path.join(dir, 'skills', name, 'SKILL.md'), body);
  }
  const result = spawnSync(
    process.execPath,
    [path.join(dir, 'scripts', 'ci', 'validate-skill-descriptions.js')],
    { encoding: 'utf8', timeout: 30_000 },
  );
  fs.rmSync(dir, { recursive: true, force: true });
  return result;
}

const shortSkill = '---\nname: alpha\ndescription: Use when testing alpha.\n---\n\n# Alpha\n';
const longSkill = `---\nname: beta\ndescription: ${'x'.repeat(700)}\n---\n\n# Beta\n`;
const blockSkill = '---\nname: gamma\ndescription: >-\n  Use when a folded block scalar description is long enough\n  to matter for the budget check.\n---\n\n# Gamma\n';

const tests = [
  ['passes when every description fits the stated limits', () => {
    const result = runWithFixture({
      skills: { alpha: shortSkill },
      budget: { maxDescriptionChars: 600, maxListingTokens: 1000, targetListingTokens: 100 },
    });
    assert.strictEqual(result.status, 0, result.stderr);
    assert.match(result.stdout, /Validated 1 skill descriptions/);
  }],

  ['fails when the total listing exceeds the ceiling', () => {
    const result = runWithFixture({
      skills: { alpha: shortSkill, beta: shortSkill },
      budget: { maxDescriptionChars: 600, maxListingTokens: 10, targetListingTokens: 100 },
    });
    assert.strictEqual(result.status, 1);
    assert.match(result.stderr, /ceiling is 10/);
  }],

  ['fails when a single description exceeds maxDescriptionChars', () => {
    const result = runWithFixture({
      skills: { beta: longSkill },
      budget: { maxDescriptionChars: 600, maxListingTokens: 100000, targetListingTokens: 100 },
    });
    assert.strictEqual(result.status, 1);
    assert.match(result.stderr, /beta - description is 700 chars \(max 600\)/);
  }],

  ['reads folded block scalar descriptions instead of skipping them', () => {
    const result = runWithFixture({
      skills: { gamma: blockSkill },
      budget: { maxDescriptionChars: 600, maxListingTokens: 1000, targetListingTokens: 100 },
    });
    assert.strictEqual(result.status, 0, result.stderr);
    assert.match(result.stdout, /Validated 1 skill descriptions/);
  }],

  ['accepts keep-chomp indicators and keeps blank lines inside the block', () => {
    const withBlank = '---\nname: delta\ndescription: |+\n  First paragraph stays.\n\n  Second paragraph stays.\n---\n\n# Delta\n';
    const result = runWithFixture({
      skills: { delta: withBlank },
      budget: { maxDescriptionChars: 600, maxListingTokens: 1000, targetListingTokens: 100 },
    });
    assert.strictEqual(result.status, 0, result.stderr);
    const { readFrontmatter } = require('../../scripts/ci/validate-skill-descriptions');
    const parsed = readFrontmatter(withBlank);
    assert.match(parsed.description, /First paragraph stays\./);
    assert.match(parsed.description, /Second paragraph stays\./);
  }],

  ['reports the gap to the declared profile budget without failing', () => {
    const result = runWithFixture({
      skills: { alpha: shortSkill },
      budget: { maxDescriptionChars: 600, maxListingTokens: 100000, targetListingTokens: 1 },
    });
    assert.strictEqual(result.status, 0, result.stderr);
    assert.match(result.stdout, /% of the 1 token profile budget/);
  }],

  ['fails loudly when the budget manifest is missing', () => {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'ecc-desc-'));
    fs.mkdirSync(path.join(dir, 'scripts', 'ci'), { recursive: true });
    fs.copyFileSync(SCRIPT, path.join(dir, 'scripts', 'ci', 'validate-skill-descriptions.js'));
    const result = spawnSync(
      process.execPath,
      [path.join(dir, 'scripts', 'ci', 'validate-skill-descriptions.js')],
      { encoding: 'utf8', timeout: 30_000 },
    );
    fs.rmSync(dir, { recursive: true, force: true });
    assert.strictEqual(result.status, 1);
    assert.match(result.stderr, /missing manifests\/skill-description-budget\.json/);
  }],

  ['is registered in the test and validators scripts', () => {
    const { scripts } = require('../../package.json');
    assert.strictEqual(
      scripts['descriptions:check'],
      'node scripts/ci/validate-skill-descriptions.js',
    );
    assert.ok(scripts.test.includes('validate-skill-descriptions.js'));
  }],

  ['runs from the existing skill validator so CI enforces it without new wiring', () => {
    const validator = fs.readFileSync(path.join(ROOT, 'scripts/ci/validate-skills.js'), 'utf8');
    assert.match(validator, /require\('\.\/validate-skill-descriptions'\)/);
    assert.match(validator, /const budget = checkDescriptions\(\)/);
  }],
];

let failed = 0;
for (const [name, fn] of tests) {
  try {
    fn();
    console.log(`ok - ${name}`);
  } catch (error) {
    failed += 1;
    console.error(`not ok - ${name}`);
    console.error(`  ${error.message}`);
  }
}

if (failed > 0) {
  console.error(`\n${failed} description budget test(s) failed`);
  process.exit(1);
}
console.log(`\n${tests.length} description budget tests passed`);
