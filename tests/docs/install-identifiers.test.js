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

const publicInstallDocs = [
  'README.md',
  'README.zh-CN.md',
  'docs/pt-BR/README.md',
  'docs/zh-CN/README.md',
  'docs/ja-JP/skills/configure-ecc/SKILL.md',
  'docs/zh-CN/skills/configure-ecc/SKILL.md',
];

console.log('\n=== Testing public install identifiers ===\n');

for (const relativePath of publicInstallDocs) {
  const content = fs.readFileSync(path.join(repoRoot, relativePath), 'utf8');

  test(`${relativePath} does not use the overlong legacy marketplace plugin identifier`, () => {
    assert.ok(!content.includes('everything-claude-code@everything-claude-code'));
  });

  test(`${relativePath} documents the short marketplace plugin identifier`, () => {
    assert.ok(content.includes('ecc@ecc'));
  });
}

const pluginAndManualInstallDocs = [
  'README.md',
  'README.zh-CN.md',
  'docs/zh-CN/README.md',
];

const publicCommandNamespaceDocs = [
  'README.md',
  'README.zh-CN.md',
  'docs/pt-BR/README.md',
  'docs/tr/README.md',
  'docs/ko-KR/README.md',
  'docs/ja-JP/README.md',
  'docs/zh-CN/README.md',
  'docs/zh-TW/README.md',
];

const manualClaudeSkillInstallDocs = [
  'README.md',
  'docs/de-DE/README.md',
  'docs/ru/README.md',
];

for (const relativePath of pluginAndManualInstallDocs) {
  const content = fs.readFileSync(path.join(repoRoot, relativePath), 'utf8');

  test(`${relativePath} warns not to run the full installer after plugin install`, () => {
    assert.ok(
      content.includes('--profile full'),
      'Expected docs to mention the full installer explicitly'
    );
    assert.ok(
      content.includes('/plugin install'),
      'Expected docs to mention plugin install explicitly'
    );
    assert.ok(
      content.includes('不要再运行')
      || content.includes('do not run'),
      'Expected docs to warn that plugin install and full install are not sequential'
    );
  });
}

for (const relativePath of publicCommandNamespaceDocs) {
  const content = fs.readFileSync(path.join(repoRoot, relativePath), 'utf8');

  test(`${relativePath} uses the canonical plugin command namespace`, () => {
    assert.ok(
      !content.includes('/everything-claude-code:'),
      'Expected docs not to advertise the overlong legacy plugin command namespace'
    );
    assert.ok(
      content.includes('/ecc:plan'),
      'Expected docs to show the short plugin command namespace'
    );
  });
}

for (const relativePath of manualClaudeSkillInstallDocs) {
  const content = fs.readFileSync(path.join(repoRoot, relativePath), 'utf8');

  test(`${relativePath} keeps manual Claude skill installs top-level`, () => {
    assert.ok(
      !/^\s*#?\s*(mkdir\s+-p|md\s+.*|cp\s+.*|copy\s+.*|cpi\s+.*|New-Item\s+.*|Copy-Item\s+.*)\s+.*(~|\$HOME)[\\/]\.claude[\\/]skills[\\/]ecc([\\/]|\b)/mi.test(content),
      'Claude Code does not discover skills installed by commands targeting ~/.claude/skills/ecc'
    );
    assert.ok(
      content.includes('~/.claude/skills/'),
      'Expected manual install docs to copy skills into direct ~/.claude/skills children'
    );
  });
}

if (failed > 0) {
  console.log(`\nFailed: ${failed}`);
  process.exit(1);
}

console.log(`\nPassed: ${passed}`);
