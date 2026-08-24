/**
 * Tests for scripts/lib/skill-catalog.js
 *
 * Run with: node tests/lib/skill-catalog.test.js
 */

const assert = require('assert');

const {
  extraSkillIdsFromComponentIds,
  filterSkillInstallOperations,
  pluginSkillEntries,
  selectSkills,
  skillIdFromSourcePath,
} = require('../../scripts/lib/skill-catalog');

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

const FIXTURE_CATALOG = {
  defaultProfile: 'standard',
  minimalSkillIds: ['tdd-workflow', 'coding-standards'],
  skills: [
    { id: 'tdd-workflow', group: 'workflow-quality' },
    { id: 'coding-standards', group: 'framework-language' },
    { id: 'security-review', group: 'security' },
    { id: 'tasteforge-video', group: 'media-generation' },
    { id: 'skill-comply', group: null },
  ],
  groups: {
    'workflow-quality': 'standard',
    'framework-language': 'full',
    security: 'standard',
    'media-generation': 'full',
  },
};

function runTests() {
  console.log('\n=== Testing skill-catalog.js ===\n');

  let passed = 0;
  let failed = 0;

  if (test('minimal includes only the explicit core plus groups tagged minimal', () => {
    const selected = selectSkills(FIXTURE_CATALOG, { profile: 'minimal' });
    assert.deepStrictEqual(selected.enabled.map(skill => skill.id).sort(), [
      'coding-standards',
      'tdd-workflow',
    ]);
  })) passed++; else failed++;

  if (test('standard adds groups tagged standard without pulling full-only groups', () => {
    const selected = selectSkills(FIXTURE_CATALOG, { profile: 'standard' });
    assert.deepStrictEqual(selected.enabled.map(skill => skill.id).sort(), [
      'coding-standards',
      'security-review',
      'tdd-workflow',
    ]);
  })) passed++; else failed++;

  if (test('full includes ungrouped skills', () => {
    const selected = selectSkills(FIXTURE_CATALOG, { profile: 'full' });
    assert.deepStrictEqual(selected.enabled.map(skill => skill.id).sort(), [
      'coding-standards',
      'security-review',
      'skill-comply',
      'tasteforge-video',
      'tdd-workflow',
    ]);
  })) passed++; else failed++;

  if (test('enabled groups opt a full-only group into a narrower profile', () => {
    const selected = selectSkills(FIXTURE_CATALOG, {
      profile: 'standard',
      enabledGroups: ['media-generation'],
    });
    assert.ok(selected.enabled.some(skill => skill.id === 'tasteforge-video'));
  })) passed++; else failed++;

  if (test('disabled groups drop an otherwise selected group', () => {
    const selected = selectSkills(FIXTURE_CATALOG, {
      profile: 'standard',
      disabledGroups: ['security'],
    });
    assert.ok(!selected.enabled.some(skill => skill.id === 'security-review'));
    assert.ok(selected.enabled.some(skill => skill.id === 'tdd-workflow'));
  })) passed++; else failed++;

  if (test('disabled skills drop individual ids', () => {
    const selected = selectSkills(FIXTURE_CATALOG, {
      profile: 'standard',
      disabledSkills: ['security-review'],
    });
    assert.ok(!selected.enabled.some(skill => skill.id === 'security-review'));
  })) passed++; else failed++;

  if (test('extra skills are force-included', () => {
    const selected = selectSkills(FIXTURE_CATALOG, {
      profile: 'minimal',
      extraSkills: ['tasteforge-video'],
    });
    assert.ok(selected.enabled.some(skill => skill.id === 'tasteforge-video'));
  })) passed++; else failed++;

  if (test('pluginSkillEntries uses ./skills/ only for full', () => {
    assert.deepStrictEqual(pluginSkillEntries(['tdd-workflow', 'security-review'], 'full'), [
      './skills/',
    ]);
    assert.deepStrictEqual(pluginSkillEntries(['security-review', 'tdd-workflow'], 'standard'), [
      './skills/security-review/',
      './skills/tdd-workflow/',
    ]);
  })) passed++; else failed++;

  if (test('skillIdFromSourcePath extracts the curated skill id', () => {
    assert.strictEqual(skillIdFromSourcePath('skills/tdd-workflow'), 'tdd-workflow');
    assert.strictEqual(skillIdFromSourcePath('skills/tdd-workflow/SKILL.md'), 'tdd-workflow');
    assert.strictEqual(skillIdFromSourcePath('.cursor/hooks.json'), null);
  })) passed++; else failed++;

  if (test('filterSkillInstallOperations drops unselected skill copies', () => {
    const selected = selectSkills(FIXTURE_CATALOG, { profile: 'minimal' });
    const filtered = filterSkillInstallOperations([
      { sourceRelativePath: 'skills/tdd-workflow/SKILL.md' },
      { sourceRelativePath: 'skills/tasteforge-video/SKILL.md' },
      { sourceRelativePath: 'rules/common/coding-style.md' },
    ], selected);
    assert.deepStrictEqual(
      filtered.map(operation => operation.sourceRelativePath),
      ['skills/tdd-workflow/SKILL.md', 'rules/common/coding-style.md']
    );
  })) passed++; else failed++;

  if (test('extraSkillIdsFromComponentIds reads skill: component ids', () => {
    assert.deepStrictEqual(
      extraSkillIdsFromComponentIds(['skill:tdd-workflow', 'lang:typescript', 'skill:security-review']),
      ['tdd-workflow', 'security-review']
    );
  })) passed++; else failed++;

  console.log(`\nResults: Passed: ${passed}, Failed: ${failed}`);
  process.exit(failed > 0 ? 1 : 0);
}

runTests();
