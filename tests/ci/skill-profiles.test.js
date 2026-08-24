/**
 * Guardrails for the skill-profile catalog that backs issue #2694.
 *
 * Run with: node tests/ci/skill-profiles.test.js
 */

const assert = require('assert');
const fs = require('fs');
const path = require('path');

const {
  loadSkillCatalog,
  pluginSkillEntries,
  selectSkills,
} = require('../../scripts/lib/skill-catalog');

const REPO_ROOT = path.join(__dirname, '..', '..');

function test(name, fn) {
  try {
    fn();
    console.log(`  ✓ ${name}`);
    return true;
  } catch (err) {
    console.log(`  ✗ ${name}`);
    console.log(`    Error: ${err.message}`);
    return false;
  }
}

function frontmatterChars(skillId) {
  const text = fs.readFileSync(path.join(REPO_ROOT, 'skills', skillId, 'SKILL.md'), 'utf8');
  const match = text.match(/^---\n([\s\S]*?)\n---/);
  if (!match) return skillId.length;
  const name = (match[1].match(/^name:\s*(.+)$/m) || [])[1] || skillId;
  const description = (match[1].match(/^description:\s*"?([\s\S]*?)"?\s*$/m) || [])[1] || '';
  return String(name).length + String(description).length;
}

function runTests() {
  console.log('\n=== Testing skill profile catalog ===\n');

  let passed = 0;
  let failed = 0;

  const catalog = loadSkillCatalog({ repoRoot: REPO_ROOT });
  const plugin = JSON.parse(
    fs.readFileSync(path.join(REPO_ROOT, '.claude-plugin', 'plugin.json'), 'utf8')
  );

  if (test('loads every curated skill', () => {
    assert.ok(catalog.skills.length >= 280, `expected hundreds of skills, got ${catalog.skills.length}`);
  })) passed++; else failed++;

  if (test('minimal is a strict subset of standard, which is a strict subset of full', () => {
    const minimal = new Set(selectSkills(catalog, { profile: 'minimal' }).enabled.map(skill => skill.id));
    const standard = new Set(selectSkills(catalog, { profile: 'standard' }).enabled.map(skill => skill.id));
    const full = new Set(selectSkills(catalog, { profile: 'full' }).enabled.map(skill => skill.id));
    assert.ok(minimal.size > 0 && minimal.size < standard.size);
    assert.ok(standard.size < full.size);
    assert.ok([...minimal].every(id => standard.has(id)));
    assert.ok([...standard].every(id => full.has(id)));
  })) passed++; else failed++;

  if (test('standard listing stays under the Claude skill-listing budget', () => {
    const selected = selectSkills(catalog, { profile: 'standard' });
    const chars = selected.enabled.reduce((sum, skill) => sum + frontmatterChars(skill.id), 0);
    const tokens = Math.ceil(chars / 4);
    assert.ok(selected.enabled.length <= 120, `standard is too wide: ${selected.enabled.length} skills`);
    assert.ok(tokens < 10000, `standard listing estimate ${tokens} tokens exceeds the 10k budget`);
  })) passed++; else failed++;

  if (test('committed plugin.json lists the standard profile, not the wholesale tree', () => {
    const expected = pluginSkillEntries(
      selectSkills(catalog, { profile: 'standard' }).enabled.map(skill => skill.id),
      'standard'
    );
    assert.deepStrictEqual(plugin.skills, expected);
    assert.ok(!plugin.skills.includes('./skills/'));
    for (const entry of plugin.skills) {
      const skillId = String(entry).replace(/^\.\/skills\//, '').replace(/\/$/, '');
      assert.ok(
        fs.existsSync(path.join(REPO_ROOT, 'skills', skillId, 'SKILL.md')),
        `plugin lists missing skill ${skillId}`
      );
    }
  })) passed++; else failed++;

  if (test('plugin userConfig exposes skill_profile', () => {
    assert.strictEqual(plugin.userConfig.skill_profile.default, 'standard');
  })) passed++; else failed++;

  if (test('every group in the skill-profile manifest exists as an install module', () => {
    const modules = JSON.parse(
      fs.readFileSync(path.join(REPO_ROOT, 'manifests', 'install-modules.json'), 'utf8')
    );
    const moduleIds = new Set(modules.modules.map(module => module.id));
    for (const groupId of Object.keys(catalog.groups)) {
      assert.ok(moduleIds.has(groupId), `unknown skill group ${groupId}`);
    }
  })) passed++; else failed++;

  console.log(`\nResults: Passed: ${passed}, Failed: ${failed}`);
  process.exit(failed > 0 ? 1 : 0);
}

runTests();
