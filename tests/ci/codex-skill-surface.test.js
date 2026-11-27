#!/usr/bin/env node
/**
 * Validate the Codex-facing .agents/skills surface.
 */

const assert = require('assert');
const fs = require('fs');
const path = require('path');

const REPO_ROOT = path.join(__dirname, '..', '..');
const CODEX_SKILLS_DIR = path.join(REPO_ROOT, '.agents', 'skills');
const ALLOWED_FRONTMATTER_KEYS = new Set([
  'allowed-tools',
  'description',
  'license',
  'metadata',
  'name',
]);

function test(name, fn) {
  try {
    fn();
    console.log(`  ✓ ${name}`);
    return true;
  } catch (error) {
    console.log(`  ✗ ${name}`);
    console.log(`    Error: ${error.message}`);
    return false;
  }
}

function listSkillDirs() {
  return fs.readdirSync(CODEX_SKILLS_DIR, { withFileTypes: true })
    .filter(entry => entry.isDirectory())
    .map(entry => entry.name)
    .sort();
}

function parseFrontmatter(skillName) {
  const skillPath = path.join(CODEX_SKILLS_DIR, skillName, 'SKILL.md');
  const content = fs.readFileSync(skillPath, 'utf8');
  const match = content.match(/^---\r?\n([\s\S]*?)\r?\n---/);
  assert.ok(match, `${skillName}/SKILL.md is missing frontmatter`);

  const frontmatter = {};
  for (const line of match[1].split(/\r?\n/)) {
    const topLevelKey = line.match(/^([A-Za-z0-9_-]+):/);
    if (topLevelKey) {
      frontmatter[topLevelKey[1]] = line.slice(topLevelKey[1].length + 1).trim();
    }
  }
  return frontmatter;
}

function parseQuotedYamlValue(source, key) {
  const match = source.match(new RegExp(`^\\s{2}${key}:\\s*(.+?)\\s*$`, 'm'));
  if (!match) return '';

  const raw = match[1].trim();
  if (
    (raw.startsWith('"') && raw.endsWith('"')) ||
    (raw.startsWith("'") && raw.endsWith("'"))
  ) {
    return raw.slice(1, -1);
  }
  return raw;
}

function run() {
  console.log('\n=== Testing Codex skill surface ===\n');

  let passed = 0;
  let failed = 0;
  const skillDirs = listSkillDirs();

  if (test('Codex skill directory is populated', () => {
    assert.ok(skillDirs.length > 0, 'Expected at least one .agents/skills entry');
  })) passed++; else failed++;

  if (test('Codex skill surface includes the MLE workflow', () => {
    assert.ok(skillDirs.includes('mle-workflow'), 'Expected .agents/skills/mle-workflow');
  })) passed++; else failed++;

  if (test('SKILL.md frontmatter matches Codex validator expectations', () => {
    for (const skillDir of skillDirs) {
      const frontmatter = parseFrontmatter(skillDir);
      const keys = Object.keys(frontmatter).sort();
      const unexpected = keys.filter(key => !ALLOWED_FRONTMATTER_KEYS.has(key));
      assert.deepStrictEqual(unexpected, [], `${skillDir}/SKILL.md has unsupported keys`);
      assert.strictEqual(frontmatter.name, skillDir, `${skillDir}/SKILL.md name must match folder`);
      assert.ok(frontmatter.description, `${skillDir}/SKILL.md needs a description`);
    }
  })) passed++; else failed++;

  if (test('agents/openai.yaml exists and names the skill in default_prompt', () => {
    for (const skillDir of skillDirs) {
      const metadataPath = path.join(CODEX_SKILLS_DIR, skillDir, 'agents', 'openai.yaml');
      assert.ok(fs.existsSync(metadataPath), `${skillDir} is missing agents/openai.yaml`);

      const metadata = fs.readFileSync(metadataPath, 'utf8');
      const displayName = parseQuotedYamlValue(metadata, 'display_name');
      const shortDescription = parseQuotedYamlValue(metadata, 'short_description');
      const defaultPrompt = parseQuotedYamlValue(metadata, 'default_prompt');

      assert.ok(displayName, `${skillDir}/agents/openai.yaml needs display_name`);
      assert.ok(shortDescription, `${skillDir}/agents/openai.yaml needs short_description`);
      assert.ok(defaultPrompt, `${skillDir}/agents/openai.yaml needs default_prompt`);
      assert.ok(
        shortDescription.length >= 25 && shortDescription.length <= 64,
        `${skillDir}/agents/openai.yaml short_description must be 25-64 characters`
      );
      assert.ok(
        defaultPrompt.includes(`$${skillDir}`),
        `${skillDir}/agents/openai.yaml default_prompt must mention $${skillDir}`
      );
    }
  })) passed++; else failed++;

  console.log(`\nPassed: ${passed}`);
  console.log(`Failed: ${failed}`);

  process.exit(failed > 0 ? 1 : 0);
}

run();
