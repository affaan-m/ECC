'use strict';

const assert = require('assert');
const fs = require('fs');
const path = require('path');

const repoRoot = path.resolve(__dirname, '..', '..');
const skillPath = path.join(repoRoot, 'skills', 'docker-patterns', 'SKILL.md');

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

const skill = fs.readFileSync(skillPath, 'utf8');

console.log('\n=== Docker patterns skill tests ===\n');

test('triggers for hardened installer and cross-platform harness work', () => {
  const frontmatter = skill.match(/^---\n([\s\S]*?)\n---/);
  assert.ok(frontmatter, 'SKILL.md frontmatter is missing');
  assert.match(frontmatter[1], /description:.*installer/i);
  assert.match(frontmatter[1], /description:.*macOS.*Windows/i);
});

test('documents the ECC plugin setup harness and safe operating modes', () => {
  assert.match(skill, /docker\/plugin-setup\/compose\.yaml/);
  assert.match(skill, /\breal-cli\b/);
  assert.match(skill, /\breal-cli-ubuntu\b/);
  assert.match(skill, /\bfixture-tests\b/);
  assert.match(skill, /dry-run.*install.*migrate.*plugin.*shell/is);
});

test('requires hardened ephemeral installer execution', () => {
  for (const pattern of [
    /read[_ -]only/i,
    /tmpfs/i,
    /no-new-privileges/i,
    /cap_drop/i,
    /pids_limit/i,
    /non-root/i,
    /digest/i,
    /credential/i,
  ]) {
    assert.match(skill, pattern);
  }
});

test('states the honest macOS and Windows validation boundary', () => {
  assert.match(skill, /macOS cannot run as a Docker container/i);
  assert.match(skill, /Windows containers require a Windows Docker engine/i);
  assert.match(skill, /native.*ubuntu.*macOS.*Windows.*CI/is);
  assert.doesNotMatch(skill, /macOS container image|simulate Windows/i);
});

test('provides a repeatable build, run, inspect, and cleanup sequence', () => {
  assert.match(skill, /docker compose.*build.*real-cli.*real-cli-ubuntu/is);
  assert.match(skill, /docker compose.*run.*real-cli.*dry-run/is);
  assert.match(skill, /docker image inspect/is);
  assert.match(skill, /down --remove-orphans/);
});

console.log(`\nResults: Passed: ${passed}, Failed: ${failed}`);
process.exit(failed > 0 ? 1 : 0);
