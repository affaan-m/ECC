#!/usr/bin/env node
/**
 * Tests for the Codex adapter scripts under targets/codex/.
 */
const assert = require('assert');
const path = require('path');
const fs = require('fs');
const { spawnSync } = require('child_process');

const repoRoot = path.join(__dirname, '..', '..');
const buildAgents = path.join(repoRoot, 'targets', 'codex', 'build-agents-md.sh');

let passed = 0;
let failed = 0;
function test(name, fn) {
  try {
    fn();
    console.log(`  PASS  ${name}`);
    passed += 1;
  } catch (err) {
    console.error(`  FAIL  ${name}: ${err.message}`);
    failed += 1;
  }
}

test('build-agents-md emits global body plus rules index', () => {
  const res = spawnSync('bash', [buildAgents, '~/.codex/instructions', 'common', 'python'], {
    encoding: 'utf8'
  });
  assert.strictEqual(res.status, 0, res.stderr);
  const globalMd = fs.readFileSync(
    path.join(repoRoot, 'content', 'instructions', 'global.md'), 'utf8');
  const firstLine = globalMd.split('\n').find((l) => l.trim().length > 0);
  assert.ok(res.stdout.includes(firstLine), 'global.md body must be included');
  assert.ok(res.stdout.includes('## Rules Index'), 'index heading missing');
  assert.ok(res.stdout.includes('~/.codex/instructions/coding-style.md'),
    'common rule entry missing');
  assert.ok(res.stdout.includes('~/.codex/instructions/python-coding-style.md'),
    'python rule entry missing');
  assert.ok(!res.stdout.includes('instructions/node-coding-style.md'),
    'unselected language must not appear');
});

console.log(`\n${passed} passed, ${failed} failed`);
process.exit(failed > 0 ? 1 : 0);
