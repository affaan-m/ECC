'use strict';

const assert = require('assert');
const fs = require('fs');
const path = require('path');

const repoRoot = path.resolve(__dirname, '..', '..');
const canonicalPath = path.join(repoRoot, 'skills', 'mcp-dependency-review', 'SKILL.md');
const codexPath = path.join(repoRoot, '.agents', 'skills', 'mcp-dependency-review', 'SKILL.md');
const cursorPath = path.join(repoRoot, '.cursor', 'skills', 'mcp-dependency-review', 'SKILL.md');

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

function body(markdown) {
  return markdown.replace(/^---\r?\n[\s\S]*?\r?\n---\r?\n/, '').trim();
}

const canonical = fs.readFileSync(canonicalPath, 'utf8');
const codex = fs.readFileSync(codexPath, 'utf8');
const cursor = fs.readFileSync(cursorPath, 'utf8');

console.log('\n=== MCP dependency review skill tests ===\n');
test('has a focused activation surface for MCP config review', () => {
  const frontmatter = canonical.match(/^---\n([\s\S]*?)\n---/);
  assert.ok(frontmatter, 'SKILL.md frontmatter is missing');
  assert.match(frontmatter[1], /name:\s*mcp-dependency-review/);
  assert.match(frontmatter[1], /description:.*statically review MCP configuration/i);
  assert.match(canonical, /## When to Activate/);
  assert.match(canonical, /\.mcp\.json/);
});

test('keeps a zero-execution and bounded-scope security boundary', () => {
  assert.match(canonical, /Do not execute discovered MCP server commands/i);
  assert.match(canonical, /Do not inspect home-directory or machine-wide MCP configuration unless the user explicitly requests/i);
  assert.match(canonical, /do not:\s*[\s\S]*run a `command` or `args` value/i);
  assert.match(canonical, /never execute the discovered command/i);
  assert.match(canonical, /No MCP servers were executed during this review/i);
});

test('classifies mutable selectors without treating them as compromise evidence', () => {
  assert.match(canonical, /`package@1\.2\.3`\s*\| SAFE/);
  assert.match(canonical, /`package`\s*\| HIGH/);
  assert.match(canonical, /`package@latest`\s*\| HIGH/);
  assert.match(canonical, /`package@\^1\.2\.0`\s*\| MEDIUM/);
  assert.match(canonical, /local path \/ script \/ unknown binary\s*\| REVIEW/);
  assert.match(canonical, /not breach claims/i);
  assert.match(canonical, /describe dependency mutability alone as proof of a vulnerability, compromise, or malicious package/i);
});
test('does not recommend substituting an arbitrary current latest version', () => {
  assert.match(canonical, /Do \*\*not\*\* invent a pin by substituting today's latest registry version/i);
  assert.match(canonical, /pin a version the team has reviewed/i);
  assert.match(canonical, /registry-history lookup is a separate network operation/i);
});

test('keeps the external reference optional rather than making it a dependency', () => {
  assert.match(canonical, /external project is optional/i);
  assert.match(canonical, /does not require it to perform the static review/i);
});

test('keeps the same review workflow across ECC, Codex, and Cursor surfaces', () => {
  assert.strictEqual(body(codex), body(canonical));
  assert.strictEqual(body(cursor), body(canonical));
  assert.match(codex, /license:\s*MIT/);
  assert.match(cursor, /origin:\s*ECC/);
});

console.log(`\nResults: Passed: ${passed}, Failed: ${failed}`);
process.exit(failed > 0 ? 1 : 0);
