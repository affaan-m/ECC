/**
 * Tests for scripts/lib/skill-flags.js
 *
 * Run with: node tests/lib/skill-flags.test.js
 */

const assert = require('assert');
const fs = require('fs');
const os = require('os');
const path = require('path');

const {
  VALID_SKILL_PROFILES,
  getDisabledSkillGroups,
  getDisabledSkillIds,
  getEnabledSkillGroups,
  getSkillProfile,
  hasExplicitSkillProfile,
  parseSkillGroups,
  readManagedSkillConfig,
} = require('../../scripts/lib/skill-flags');

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

function withEnv(vars, fn) {
  const saved = {};
  for (const key of Object.keys(vars)) {
    saved[key] = process.env[key];
    if (vars[key] === undefined) {
      delete process.env[key];
    } else {
      process.env[key] = vars[key];
    }
  }
  try {
    fn();
  } finally {
    for (const key of Object.keys(saved)) {
      if (saved[key] === undefined) {
        delete process.env[key];
      } else {
        process.env[key] = saved[key];
      }
    }
  }
}

function runTests() {
  console.log('\n=== Testing skill-flags.js ===\n');

  let passed = 0;
  let failed = 0;

  console.log('VALID_SKILL_PROFILES:');

  if (test('contains minimal, standard, and full', () => {
    assert.ok(VALID_SKILL_PROFILES.has('minimal'));
    assert.ok(VALID_SKILL_PROFILES.has('standard'));
    assert.ok(VALID_SKILL_PROFILES.has('full'));
    assert.ok(!VALID_SKILL_PROFILES.has('strict'));
  })) passed++; else failed++;

  console.log('\ngetSkillProfile:');

  if (test('defaults to standard', () => {
    withEnv({
      ECC_SKILL_PROFILE: undefined,
      CLAUDE_PLUGIN_OPTION_SKILL_PROFILE: undefined,
    }, () => {
      assert.strictEqual(getSkillProfile({}), 'standard');
    });
  })) passed++; else failed++;

  if (test('reads ECC_SKILL_PROFILE', () => {
    assert.strictEqual(getSkillProfile({ ECC_SKILL_PROFILE: 'minimal' }), 'minimal');
    assert.strictEqual(getSkillProfile({ ECC_SKILL_PROFILE: 'FULL' }), 'full');
    assert.strictEqual(getSkillProfile({ ECC_SKILL_PROFILE: '  standard  ' }), 'standard');
  })) passed++; else failed++;

  if (test('falls back to standard for invalid values', () => {
    assert.strictEqual(getSkillProfile({ ECC_SKILL_PROFILE: 'strict' }), 'standard');
    assert.strictEqual(getSkillProfile({ ECC_SKILL_PROFILE: '' }), 'standard');
  })) passed++; else failed++;

  if (test('uses Claude plugin option when ECC var is absent', () => {
    assert.strictEqual(getSkillProfile({
      CLAUDE_PLUGIN_OPTION_SKILL_PROFILE: 'minimal',
    }), 'minimal');
  })) passed++; else failed++;

  if (test('ECC var wins over Claude plugin option', () => {
    assert.strictEqual(getSkillProfile({
      ECC_SKILL_PROFILE: 'full',
      CLAUDE_PLUGIN_OPTION_SKILL_PROFILE: 'minimal',
    }), 'full');
  })) passed++; else failed++;

  if (test('reads managed setup.json skills.profile as last fallback', () => {
    const tempRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'skill-flags-'));
    try {
      const setupPath = path.join(tempRoot, 'ecc', 'setup.json');
      fs.mkdirSync(path.dirname(setupPath), { recursive: true });
      fs.writeFileSync(setupPath, JSON.stringify({ skills: { profile: 'minimal' } }));
      assert.strictEqual(getSkillProfile({
        CLAUDE_PLUGIN_ROOT: tempRoot,
      }), 'minimal');
    } finally {
      fs.rmSync(tempRoot, { recursive: true, force: true });
    }
  })) passed++; else failed++;

  console.log('\nhasExplicitSkillProfile:');

  if (test('is false when nothing selected a profile', () => {
    assert.strictEqual(hasExplicitSkillProfile({}), false);
  })) passed++; else failed++;

  if (test('is true when ECC_SKILL_PROFILE is set', () => {
    assert.strictEqual(hasExplicitSkillProfile({ ECC_SKILL_PROFILE: 'minimal' }), true);
  })) passed++; else failed++;

  if (test('is true when the Claude plugin option is set', () => {
    assert.strictEqual(hasExplicitSkillProfile({
      CLAUDE_PLUGIN_OPTION_SKILL_PROFILE: 'full',
    }), true);
  })) passed++; else failed++;

  console.log('\ngroup and skill lists:');

  if (test('parses enabled and disabled skill groups', () => {
    const env = {
      ECC_ENABLED_SKILL_GROUPS: 'framework-language, security',
      ECC_DISABLED_SKILL_GROUPS: 'media-generation,,Business-Content',
    };
    assert.deepStrictEqual([...getEnabledSkillGroups(env)].sort(), [
      'framework-language',
      'security',
    ]);
    assert.deepStrictEqual([...getDisabledSkillGroups(env)].sort(), [
      'business-content',
      'media-generation',
    ]);
  })) passed++; else failed++;

  if (test('parses disabled skill ids', () => {
    const disabled = getDisabledSkillIds({
      ECC_DISABLED_SKILLS: 'tasteforge-video, fal-ai-media',
    });
    assert.ok(disabled.has('tasteforge-video'));
    assert.ok(disabled.has('fal-ai-media'));
  })) passed++; else failed++;

  if (test('parseSkillGroups ignores blanks', () => {
    assert.deepStrictEqual(parseSkillGroups(' a, ,B '), ['a', 'b']);
    assert.deepStrictEqual(parseSkillGroups(undefined), []);
  })) passed++; else failed++;

  if (test('readManagedSkillConfig returns empty object when missing', () => {
    assert.deepStrictEqual(readManagedSkillConfig({}), {});
  })) passed++; else failed++;

  console.log(`\nResults: Passed: ${passed}, Failed: ${failed}`);
  process.exit(failed > 0 ? 1 : 0);
}

runTests();
