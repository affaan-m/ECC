'use strict';

const assert = require('assert');
const fs = require('fs');
const path = require('path');

const repoRoot = path.resolve(__dirname, '..', '..');
const guidePath = 'docs/GROK-NAVIGATION-GUIDE.md';

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

function read(relativePath) {
  return fs.readFileSync(path.join(repoRoot, relativePath), 'utf8');
}

console.log('\n=== Testing Grok ECC navigation map docs ===\n');

test('Grok navigation map exists and identifies canonical surfaces', () => {
  const source = read(guidePath);

  for (const required of [
    'AGENTS.md',
    '.grok/AGENTS.md',
    '~/.grok/config.toml',
    '.grok/agents/',
    '.agents/skills/',
    'docs/COMMAND-AGENT-MAP.md',
    'commands/',
    'skills/',
    'agents/',
    'rules/',
    'hooks/',
    'scripts/',
    'manifests/',
    'Upgrade gate',
    'check-grok-fixture.js'
  ]) {
    assert.ok(source.includes(required), `Missing canonical surface ${required}`);
  }
});

test('Grok navigation map documents PR diff packet workflow', () => {
  const source = read(guidePath);

  for (const required of [
    'PR Diff Packet',
    'git diff origin/main...HEAD --stat',
    'git diff origin/main...HEAD --name-only',
    'git log origin/main..HEAD --oneline --reverse',
    '/pr',
    '/review-pr',
    '/ecc-code-review',
    '.github/PULL_REQUEST_TEMPLATE.md',
    'Testing Done',
    'Risk and review lanes'
  ]) {
    assert.ok(source.includes(required), `Missing PR workflow marker ${required}`);
  }
});

test('Grok supplement links to the navigation map', () => {
  const grokAgents = read('.grok/AGENTS.md');
  assert.ok(grokAgents.includes(guidePath), '.grok/AGENTS.md must link the Grok navigation map');
});

console.log(`\nResults: Passed: ${passed}, Failed: ${failed}`);
process.exit(failed > 0 ? 1 : 0);
