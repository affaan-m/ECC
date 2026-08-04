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
    console.log(`  \u2713 ${name}`);
    passed++;
  } catch (error) {
    console.log(`  \u2717 ${name}`);
    console.log(`    Error: ${error.message}`);
    failed++;
  }
}

function read(relativePath) {
  return fs.readFileSync(path.join(repoRoot, relativePath), 'utf8');
}

console.log('\n=== Testing MCP management docs ===\n');

test('token optimization guide separates Claude MCP disables from ECC config filters', () => {
  const source = read('docs/token-optimization.md');

  assert.ok(
    source.includes('Use `/mcp` to disable Claude Code MCP servers'),
    'Token guide should direct Claude Code users to /mcp for runtime MCP disables'
  );
  assert.ok(
    source.includes('Claude Code persists those runtime disables in `~/.claude.json`'),
    'Token guide should name ~/.claude.json as the observed runtime disable store'
  );
  assert.ok(
    source.includes('`ECC_DISABLED_MCPS` only affects ECC-generated MCP config output'),
    'Token guide should scope ECC_DISABLED_MCPS to config generation'
  );
  assert.ok(
    !source.includes('Use `disabledMcpServers` in project config to disable servers per-project'),
    'Token guide should not tell users that project settings disable Claude runtime MCP servers'
  );
});

test('README MCP guidance avoids settings.json disable instructions', () => {
  const source = read('README.md');

  assert.ok(
    source.includes('Use `/mcp` for Claude Code runtime disables; Claude Code persists those choices in `~/.claude.json`.'),
    'README should route runtime MCP disables through /mcp and ~/.claude.json'
  );
  assert.ok(
    source.includes('`ECC_DISABLED_MCPS` is an ECC install/sync filter, not a live Claude Code toggle.'),
    'README should explain ECC_DISABLED_MCPS scope'
  );
  assert.ok(
    !source.includes('// In your project\'s .claude/settings.json\n{\n  "disabledMcpServers"'),
    'README should not show disabledMcpServers under .claude/settings.json'
  );
  assert.ok(
    !source.includes('Use `disabledMcpServers` in project config to disable unused ones'),
    'README quick reference should not repeat stale project-config guidance'
  );
});

if (failed > 0) {
  console.log(`\nFailed: ${failed}`);
  process.exit(1);
}

console.log(`\nPassed: ${passed}`);
