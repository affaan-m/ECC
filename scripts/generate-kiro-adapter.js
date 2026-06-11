#!/usr/bin/env node
'use strict';

/**
 * Regenerate the committed `.kiro/` Kiro adapter tree from canonical ECC
 * sources (agents/, skills/, rules/, mcp-configs/).
 *
 * Usage:
 *   node scripts/generate-kiro-adapter.js            # regenerate in place
 *   node scripts/generate-kiro-adapter.js --check    # fail if regen would change files
 */

const path = require('path');
const { execSync } = require('child_process');
const { generateKiroAdapter } = require('./lib/kiro/generate');

function main() {
  const args = process.argv.slice(2);
  const check = args.includes('--check');
  const repoRoot = path.resolve(__dirname, '..');

  const summary = generateKiroAdapter({ repoRoot });

  console.log('Kiro adapter generated from canonical sources:');
  console.log(`  Agents:    ${summary.agents}`);
  console.log(`  Skills:    ${summary.skills}`);
  console.log(`  Steering:  ${summary.steering}`);
  console.log(`  MCP (example servers): ${summary.mcpServers}`);
  console.log(`  Hooks (validated): ${summary.hooks.count}`);

  if (summary.hooks.errors.length > 0) {
    console.error('\nHook validation errors:');
    for (const err of summary.hooks.errors) console.error(`  - ${err}`);
    process.exit(1);
  }

  if (check) {
    try {
      const status = execSync('git status --porcelain .kiro', {
        cwd: repoRoot,
        encoding: 'utf8',
      }).trim();
      if (status) {
        console.error('\n--check failed: .kiro/ is out of sync with canonical sources.');
        console.error('Run `node scripts/generate-kiro-adapter.js` and commit the result.');
        console.error(status);
        process.exit(1);
      }
      console.log('\n--check passed: .kiro/ is in sync with canonical sources.');
    } catch (err) {
      console.error(`--check could not run git status: ${err.message}`);
      process.exit(1);
    }
  }
}

main();
