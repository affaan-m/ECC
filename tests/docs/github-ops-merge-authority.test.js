'use strict';

const assert = require('assert');
const fs = require('fs');
const path = require('path');

const repoRoot = path.resolve(__dirname, '..', '..');
const policyDocs = [
  {
    path: 'skills/github-ops/SKILL.md',
    approval: 'user approval',
    prohibition: 'never auto-merge',
  },
  {
    path: 'docs/ja-JP/skills/github-ops/SKILL.md',
    approval: 'user approval',
    prohibition: 'never auto-merge',
  },
  {
    path: 'docs/zh-CN/skills/github-ops/SKILL.md',
    approval: '用户批准',
    prohibition: '切勿自动合并',
  },
];

console.log('\n=== Testing GitHub operations merge authority ===\n');

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

for (const policy of policyDocs) {
  test(policy.path, () => {
    const content = fs.readFileSync(path.join(repoRoot, policy.path), 'utf8');

    assert.ok(content.includes(policy.approval), `${policy.path} must require user approval`);
    assert.ok(content.includes(policy.prohibition), `${policy.path} must prohibit auto-merge`);
    assert.ok(
      !content.includes('Review and auto-merge safe dependency bumps'),
      `${policy.path} must not authorize auto-merging dependency bumps`
    );
    assert.ok(
      !content.includes('审查并自动合并安全的依赖项更新'),
      `${policy.path} must not authorize auto-merging dependency bumps`
    );
  });
}

console.log(`\nResults: Passed: ${passed}, Failed: ${failed}`);
process.exit(failed > 0 ? 1 : 0);
