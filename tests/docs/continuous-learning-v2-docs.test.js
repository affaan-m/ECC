'use strict';

const assert = require('assert');
const fs = require('fs');
const path = require('path');

const repoRoot = path.resolve(__dirname, '..', '..');

let passed = 0;
let failed = 0;

function test(name, fn) {
  try {
    fn();
    console.log(`  ✓ ${name}`);
    passed++;
  } catch (error) {
    console.log(`  ✗ ${name}`);
    console.log(`    Error: ${error.message}`);
    failed++;
  }
}

const skillDocs = [
  'skills/continuous-learning-v2/SKILL.md',
  'docs/zh-CN/skills/continuous-learning-v2/SKILL.md',
  'docs/tr/skills/continuous-learning-v2/SKILL.md',
  'docs/ko-KR/skills/continuous-learning-v2/SKILL.md',
  'docs/ja-JP/skills/continuous-learning-v2/SKILL.md',
  'docs/zh-TW/skills/continuous-learning-v2/SKILL.md',
];

console.log('\n=== Testing continuous-learning-v2 install docs ===\n');

for (const relativePath of skillDocs) {
  const content = fs.readFileSync(path.join(repoRoot, relativePath), 'utf8');

  test(`${relativePath} does not tell plugin users to register observe.sh through CLAUDE_PLUGIN_ROOT`, () => {
    assert.ok(
      !content.includes('${CLAUDE_PLUGIN_ROOT}/skills/continuous-learning-v2/hooks/observe.sh'),
      'Plugin quick start should not tell users to copy observe.sh into settings.json'
    );
  });
}

const englishSkill = fs.readFileSync(
  path.join(repoRoot, 'skills/continuous-learning-v2/SKILL.md'),
  'utf8'
);

test('English continuous-learning-v2 skill says plugin installs auto-load hooks/hooks.json', () => {
  assert.ok(englishSkill.includes('auto-loads the plugin `hooks/hooks.json`'));
});

test('English continuous-learning-v2 skill tells plugin users to remove duplicated settings.json hooks', () => {
  assert.ok(englishSkill.includes('remove that duplicate `PreToolUse` / `PostToolUse` block'));
});

if (failed > 0) {
  console.log(`\nFailed: ${failed}`);
  process.exit(1);
}

console.log(`\nPassed: ${passed}`);
