#!/usr/bin/env node
/**
 * Validate agent.yaml exports the legacy command shim surface.
 */

const assert = require('assert');
const fs = require('fs');
const path = require('path');

const REPO_ROOT = path.join(__dirname, '..', '..');
const AGENT_YAML_PATH = path.join(REPO_ROOT, 'agent.yaml');
const COMMANDS_DIR = path.join(REPO_ROOT, 'commands');
const SKILLS_DIR = path.join(REPO_ROOT, 'skills');
const CODEX_SKILLS_DIR = path.join(REPO_ROOT, '.agents', 'skills');
const LEGACY_COMMANDS_DIR = path.join(REPO_ROOT, 'legacy-command-shims', 'commands');

const RETIRED_LEGACY_SHIMS = [
  'agent-sort',
  'claw',
  'context-budget',
  'devfleet',
  'docs',
  'e2e',
  'eval',
  'orchestrate',
  'prompt-optimize',
  'rules-distill',
  'tdd',
  'verify',
];

const CANONICAL_ANTHROPIC_SKILLS = [
  'claude-api',
  'frontend-design',
];

function extractTopLevelList(yamlSource, key) {
  const lines = yamlSource.replace(/^\uFEFF/, '').split(/\r?\n/);
  const results = [];
  let collecting = false;

  for (const line of lines) {
    if (!collecting) {
      if (line.trim() === `${key}:`) {
        collecting = true;
      }
      continue;
    }

    if (/^[A-Za-z0-9_-]+:\s*/.test(line)) {
      break;
    }

    const match = line.match(/^\s*-\s+(.+?)\s*$/);
    if (match) {
      results.push(match[1]);
    }
  }

  return results;
}

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

function run() {
  console.log('\n=== Testing agent.yaml export surface ===\n');

  let passed = 0;
  let failed = 0;

  const yamlSource = fs.readFileSync(AGENT_YAML_PATH, 'utf8');
  const declaredCommands = extractTopLevelList(yamlSource, 'commands').sort();
  const actualCommands = fs.readdirSync(COMMANDS_DIR)
    .filter(file => file.endsWith('.md'))
    .map(file => path.basename(file, '.md'))
    .sort();

  if (test('agent.yaml declares commands export surface', () => {
    assert.ok(declaredCommands.length > 0, 'Expected non-empty commands list in agent.yaml');
  })) passed++; else failed++;

  if (test('agent.yaml commands stay in sync with commands/ directory', () => {
    assert.deepStrictEqual(declaredCommands, actualCommands);
  })) passed++; else failed++;

  if (test('retired legacy slash-entry shims are not in the default commands export', () => {
    const defaultShimCommands = RETIRED_LEGACY_SHIMS
      .filter(command => actualCommands.includes(command));

    assert.deepStrictEqual(defaultShimCommands, []);
  })) passed++; else failed++;

  if (test('retired legacy slash-entry shims remain available from the opt-in archive', () => {
    const archivedCommands = fs.readdirSync(LEGACY_COMMANDS_DIR)
      .filter(file => file.endsWith('.md'))
      .map(file => path.basename(file, '.md'))
      .sort();

    assert.deepStrictEqual(archivedCommands, RETIRED_LEGACY_SHIMS);
  })) passed++; else failed++;

  if (test('canonical Anthropic skills are not re-bundled in active ECC skill surfaces', () => {
    for (const skillName of CANONICAL_ANTHROPIC_SKILLS) {
      assert.ok(
        !fs.existsSync(path.join(SKILLS_DIR, skillName, 'SKILL.md')),
        `${skillName} should be installed from anthropics/skills, not ECC skills/`
      );
      assert.ok(
        !fs.existsSync(path.join(CODEX_SKILLS_DIR, skillName, 'SKILL.md')),
        `${skillName} should be installed from anthropics/skills, not ECC .agents/skills/`
      );
    }
  })) passed++; else failed++;

  console.log(`\nPassed: ${passed}`);
  console.log(`Failed: ${failed}`);

  process.exit(failed > 0 ? 1 : 0);
}

run();
