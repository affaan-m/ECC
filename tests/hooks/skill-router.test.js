/**
 * Integration tests for scripts/hooks/skill-router.js (UserPromptSubmit)
 *
 * Run with: node tests/hooks/skill-router.test.js
 */

'use strict';

const assert = require('assert');
const path = require('path');
const { spawnSync } = require('child_process');

const { run } = require('../../scripts/hooks/skill-router');

const repoRoot = path.resolve(__dirname, '../..');
const hookPath = path.join(repoRoot, 'scripts', 'hooks', 'skill-router.js');

let passed = 0;
let failed = 0;

function check(name, fn) {
  try {
    fn();
    console.log(`  ✓ ${name}`);
    passed++;
  } catch (error) {
    console.log(`  ✗ ${name}`);
    console.log(`    ${error.message}`);
    failed++;
  }
}

function spawnHook(stdin) {
  return spawnSync(process.execPath, [hookPath], {
    input: stdin,
    encoding: 'utf8',
    env: { ...process.env, CLAUDE_PLUGIN_ROOT: repoRoot },
    timeout: 30000,
  });
}

console.log('=== Testing skill-router hook ===');

check('run() suggests skills for a matching prompt', () => {
  const result = run(JSON.stringify({ prompt: 'apply react patterns when refactoring this component' }), { pluginRoot: repoRoot });
  assert.strictEqual(result.exitCode, 0);
  assert.ok(result.stdout.startsWith('[SkillRouter]'), `Expected router output, got: ${result.stdout}`);
  assert.ok(result.stdout.includes('(installed)'), 'Full plugin matches are installed');
});

check('run() stays silent for slash commands', () => {
  const result = run(JSON.stringify({ prompt: '/compact please summarize everything' }), { pluginRoot: repoRoot });
  assert.deepStrictEqual(result, { exitCode: 0, stdout: '' });
});

check('run() stays silent for short prompts', () => {
  const result = run(JSON.stringify({ prompt: 'fix this' }), { pluginRoot: repoRoot });
  assert.deepStrictEqual(result, { exitCode: 0, stdout: '' });
});

check('run() stays silent for unroutable prompts', () => {
  const result = run(JSON.stringify({ prompt: 'zzqx wvvk pfff qqrr mmnn ttyy' }), { pluginRoot: repoRoot });
  assert.deepStrictEqual(result, { exitCode: 0, stdout: '' });
});

check('run() exits cleanly on malformed JSON without echoing input', () => {
  const result = run('{not json', { pluginRoot: repoRoot });
  assert.deepStrictEqual(result, { exitCode: 0, stdout: '' });
});

check('spawned hook emits router output on stdout', () => {
  const result = spawnHook(JSON.stringify({ prompt: 'apply react patterns when refactoring this component' }));
  assert.strictEqual(result.status, 0, `stderr: ${result.stderr}`);
  assert.ok(result.stdout.startsWith('[SkillRouter]'), `Expected router output, got: ${result.stdout}`);
});

check('spawned hook emits nothing for a slash command', () => {
  const result = spawnHook(JSON.stringify({ prompt: '/plan something big' }));
  assert.strictEqual(result.status, 0);
  assert.strictEqual(result.stdout, '');
});

console.log(`\nPassed: ${passed}`);
console.log(`Failed: ${failed}`);
process.exit(failed > 0 ? 1 : 0);
