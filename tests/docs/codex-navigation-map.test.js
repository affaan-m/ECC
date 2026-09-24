'use strict';

const assert = require('assert');
const fs = require('fs');
const path = require('path');

const repoRoot = path.resolve(__dirname, '..', '..');
const guidePath = 'docs/CODEX-NAVIGATION-GUIDE.md';

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

function read(relativePath) {
  return fs.readFileSync(path.join(repoRoot, relativePath), 'utf8');
}

console.log('\n=== Testing Codex ECC navigation map docs ===\n');

test('Codex navigation map exists and identifies canonical surfaces', () => {
  const source = read(guidePath);

  for (const required of [
    'AGENTS.md',
    '.codex/AGENTS.md',
    '.codex/config.toml',
    '.codex/agents/',
    '.agents/skills/',
    'docs/COMMAND-AGENT-MAP.md',
    'commands/',
    'skills/',
    'agents/',
    'rules/',
    'hooks/',
    'scripts/',
    'manifests/'
  ]) {
    assert.ok(source.includes(required), `Missing canonical surface ${required}`);
  }
});

test('Codex navigation map documents PR diff packet workflow', () => {
  const source = read(guidePath);

  for (const required of [
    'PR Diff Packet',
    'git diff origin/main...HEAD --stat',
    'git diff origin/main...HEAD --name-only',
    'git log origin/main..HEAD --oneline --reverse',
    '/pr',
    '/review-pr',
    '.github/PULL_REQUEST_TEMPLATE.md',
    'Testing Done',
    'Risk and review lanes'
  ]) {
    assert.ok(source.includes(required), `Missing PR workflow marker ${required}`);
  }
});

test('README and Codex supplement link to the navigation map', () => {
  const readme = read('README.md');
  const codexAgents = read('.codex/AGENTS.md');

  assert.ok(readme.includes(guidePath), 'README.md must link the Codex navigation map');
  assert.ok(codexAgents.includes(guidePath), '.codex/AGENTS.md must link the Codex navigation map');
});

console.log(`\nResults: Passed: ${passed}, Failed: ${failed}`);
process.exit(failed > 0 ? 1 : 0);
