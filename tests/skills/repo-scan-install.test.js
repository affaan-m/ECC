/**
 * Regression tests for #2774: repo-scan installation must be reproducible.
 */

'use strict';

const assert = require('assert');
const fs = require('fs');
const path = require('path');

const repoRoot = path.resolve(__dirname, '..', '..');
const skillFiles = [
  { relativePath: path.join('skills', 'repo-scan', 'SKILL.md'), heading: '## Installation' },
  { relativePath: path.join('docs', 'zh-CN', 'skills', 'repo-scan', 'SKILL.md'), heading: '## 安装' },
  { relativePath: path.join('docs', 'ja-JP', 'skills', 'repo-scan', 'SKILL.md'), heading: '## インストール' }
];
const pinnedCommit = '2742664ebcad1450c208eda0ae45d3c17fad5dd8';

function installationBlock({ relativePath, heading }) {
  const source = fs.readFileSync(path.join(repoRoot, relativePath), 'utf8');
  const headingStart = source.indexOf(`${heading}\n`);
  assert.notStrictEqual(headingStart, -1, `${relativePath} must contain ${heading}`);
  const afterHeading = source.slice(headingStart + heading.length + 1);
  const nextHeading = afterHeading.search(/^## /m);
  const installationSection = nextHeading === -1 ? afterHeading : afterHeading.slice(0, nextHeading);
  const match = installationSection.match(/```bash\n([\s\S]*?)```/);
  assert.ok(match, `${relativePath} must contain a bash installation block`);
  return match[1];
}

console.log('\nrepo-scan installation docs (#2774):');

const blocks = skillFiles.map(installationBlock);
for (const [index, block] of blocks.entries()) {
  const { relativePath } = skillFiles[index];
  assert.ok(block.includes(`REPO_SCAN_COMMIT=${pinnedCommit}`), `${relativePath} must pin the full commit SHA`);
  assert.ok(block.includes('set -euo pipefail'), `${relativePath} must fail closed`);
  assert.ok(block.includes(`trap 'rm -rf "$REPO_SCAN_TMP"' EXIT`), `${relativePath} must clean up its temporary directory`);
  assert.ok(block.includes('git clone --filter=blob:none --no-checkout'), `${relativePath} must clone before checkout`);
  assert.ok(block.includes('checkout --detach "$REPO_SCAN_COMMIT"'), `${relativePath} must detach at the pin`);
  assert.ok(block.includes('archive "$REPO_SCAN_COMMIT"'), `${relativePath} must archive the exact pinned commit`);
  assert.ok(block.includes('tar -xf - -C "$REPO_SCAN_STAGE"'), `${relativePath} must extract into a fresh staging directory`);
  assert.ok(block.includes('# Review "$REPO_SCAN_TMP/source"'), `${relativePath} must instruct source review`);
  assert.ok(block.includes('read -r REPO_SCAN_CONFIRM'), `${relativePath} must require explicit confirmation`);
  assert.ok(block.includes('[ "$REPO_SCAN_CONFIRM" != install ]'), `${relativePath} must default-deny installation`);
  assert.ok(block.indexOf('read -r REPO_SCAN_CONFIRM') < block.indexOf('mv -- "$REPO_SCAN_STAGE" "$REPO_SCAN_INSTALL_DIR"'), `${relativePath} must confirm before replacing the target`);
  assert.ok(!block.includes('rm -rf "$REPO_SCAN_INSTALL_DIR"'), `${relativePath} must preserve the old target until replacement succeeds`);
  assert.ok(block.includes('${CLAUDE_CONFIG_DIR:-$HOME/.claude}'), `${relativePath} must honor CLAUDE_CONFIG_DIR`);
  assert.ok(!block.includes('cp -r .'), `${relativePath} must not copy .git metadata`);
  assert.ok(!block.includes('git fetch --depth 1 origin 2742664\n'), `${relativePath} must not fetch the short SHA`);
}

for (const block of blocks.slice(1)) {
  assert.strictEqual(block, blocks[0], 'translated installation commands must stay synchronized');
}

console.log(`  Passed: ${skillFiles.length}`);
console.log('  Failed: 0');
