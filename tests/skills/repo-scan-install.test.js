/**
 * Regression tests for #2774: repo-scan installation must be reproducible.
 */

'use strict';

const assert = require('assert');
const fs = require('fs');
const path = require('path');

const repoRoot = path.resolve(__dirname, '..', '..');
const skillFiles = [
  path.join('skills', 'repo-scan', 'SKILL.md'),
  path.join('docs', 'zh-CN', 'skills', 'repo-scan', 'SKILL.md'),
  path.join('docs', 'ja-JP', 'skills', 'repo-scan', 'SKILL.md')
];
const pinnedCommit = '2742664ebcad1450c208eda0ae45d3c17fad5dd8';

function installationBlock(relativePath) {
  const source = fs.readFileSync(path.join(repoRoot, relativePath), 'utf8');
  const match = source.match(/```bash\n([\s\S]*?)```/);
  assert.ok(match, `${relativePath} must contain a bash installation block`);
  return match[1];
}

console.log('\nrepo-scan installation docs (#2774):');

const blocks = skillFiles.map(installationBlock);
for (const [index, block] of blocks.entries()) {
  const relativePath = skillFiles[index];
  assert.ok(block.includes(`REPO_SCAN_COMMIT=${pinnedCommit}`), `${relativePath} must pin the full commit SHA`);
  assert.ok(block.includes('git clone --filter=blob:none --no-checkout'), `${relativePath} must clone before checkout`);
  assert.ok(block.includes('checkout --detach "$REPO_SCAN_COMMIT"'), `${relativePath} must detach at the pin`);
  assert.ok(block.includes('git -C "$REPO_SCAN_TMP/source" archive HEAD | tar -xf -'), `${relativePath} must install tracked files from the archive stream`);
  assert.ok(block.includes('${CLAUDE_CONFIG_DIR:-$HOME/.claude}'), `${relativePath} must honor CLAUDE_CONFIG_DIR`);
  assert.ok(!block.includes('cp -r .'), `${relativePath} must not copy .git metadata`);
  assert.ok(!block.includes('git fetch --depth 1 origin 2742664\n'), `${relativePath} must not fetch the short SHA`);
}

for (const block of blocks.slice(1)) {
  assert.strictEqual(block, blocks[0], 'translated installation commands must stay synchronized');
}

console.log(`  PASS ${skillFiles.length} installation blocks use the verified pinned flow`);
