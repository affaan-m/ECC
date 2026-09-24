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
  assert.match(skill, /dry-run.*install.*plugin.*shell/is);
  assert.doesNotMatch(skill, /explicit modes such as.*migrate/i);
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

test('documents the private named-container lifecycle and terminal boundary', () => {
  assert.match(skill, /ECC_TMPFS_SIZE/);
  assert.match(skill, /\/workspace.*mode=0700/is);
  assert.match(skill, /NPM_CONFIG_CACHE.*\/tmp\/npm-cache/is);
  assert.match(skill, /docker compose.*run.*--detach.*--name/is);
  assert.match(skill, /interactive-plan\.js/);
  assert.match(skill, /executable.*argv/is);
  assert.match(skill, /docker exec -it/);
  assert.match(skill, /reconnect/i);
  assert.match(skill, /docker rm.*ecc-plugin-shell/is);
  assert.match(skill, /host credentials.*opt-in/is);
  assert.doesNotMatch(skill, /skills\/docker-patterns\/scripts\/open-interactive\.js/);
});

test('requires the offline smoke to execute the locally packed public bin', () => {
  assert.match(skill, /npm pack.*--ignore-scripts/is);
  assert.match(skill, /package\.json.*bin\.ecc/is);
  assert.match(skill, /locally packed/i);
  assert.match(skill, /network_mode:\s*none/);
  assert.match(skill, /does not\s+rely on.*host `node_modules`/is);
});

console.log(`\nResults: Passed: ${passed}, Failed: ${failed}`);
process.exit(failed > 0 ? 1 : 0);
