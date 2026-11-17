'use strict';

const assert = require('assert');
const fs = require('fs');
const path = require('path');

const repoRoot = path.resolve(__dirname, '..', '..');
const skillPath = path.join(repoRoot, 'skills', 'context-budget', 'SKILL.md');
const legacyShimPath = path.join(repoRoot, 'legacy-command-shims', 'commands', 'context-budget.md');

const skill = fs.readFileSync(skillPath, 'utf8');
const legacyShim = fs.readFileSync(legacyShimPath, 'utf8');

let passed = 0;
let failed = 0;

function test(name, fn) {
  try {
    fn();
    console.log(`  ✓ ${name}`);
    passed += 1;
  } catch (error) {
    console.log(`  ✗ ${name}`);
    console.log(`    Error: ${error.message}`);
    failed += 1;
  }
}

console.log('\n=== Context budget skill tests ===\n');

test('describes a cross-harness live-context router instead of a Claude-only audit', () => {
  const frontmatter = skill.match(/^---\n([\s\S]*?)\n---/);
  assert.ok(frontmatter, 'SKILL.md frontmatter is missing');
  assert.match(frontmatter[1], /description:.*live context/i);
  assert.match(frontmatter[1], /Codex/i);
  assert.doesNotMatch(frontmatter[1], /Audits Claude Code/i);
});

test('routes Codex live context requests to native status surfaces without tools', () => {
  assert.match(skill, /Codex[\s\S]*`\/status`/i);
  assert.match(skill, /Codex[\s\S]*`\/statusline`/i);
  assert.match(skill, /do not (?:call|use).*tools/i);
  assert.match(skill, /do not (?:scan|read).*files/i);
});

test('routes Claude Code live context requests to its native context command', () => {
  assert.match(skill, /Claude Code[\s\S]*`\/context`/i);
});

test('requires explicit audit intent before inventorying installed components', () => {
  assert.match(skill, /only.*(?:`--audit`|explicit).*audit/is);
  assert.match(skill, /never infer.*audit/is);
  assert.match(skill, /bounded/i);
});

test('keeps estimated static overhead distinct from live provider usage', () => {
  assert.match(skill, /estimate/i);
  assert.match(skill, /not.*live (?:session|context)/i);
  assert.match(skill, /do not claim/i);
});

test('keeps the legacy slash shim on the same safe default', () => {
  assert.match(legacyShim, /native live-context command/i);
  assert.match(legacyShim, /explicit.*`--audit`/i);
  assert.doesNotMatch(legacyShim, /Assume a 200K context window/i);
});

console.log(`\nPassed: ${passed}`);
console.log(`Failed: ${failed}`);
process.exit(failed > 0 ? 1 : 0);
