/**
 * Integration tests for scripts/hooks/skill-router.js (UserPromptSubmit)
 *
 * Run with: node tests/hooks/skill-router.test.js
 */

'use strict';

const assert = require('assert');
const fs = require('fs');
const os = require('os');
const path = require('path');
const { spawnSync } = require('child_process');

// Isolate the catalog cache (inherited by spawned children via process.env)
// so tests never touch the real ~/.claude/cache.
const cacheDir = fs.mkdtempSync(path.join(os.tmpdir(), 'ecc-skill-router-hook-cache-'));
process.env.ECC_SKILL_ROUTER_CACHE_DIR = cacheDir;

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

// Pin the boundary that matters: through run-with-flags.js, a non-matching
// prompt must yield EMPTY stdout — never the raw-input echo fallback, which
// UserPromptSubmit would inject as context.
function spawnViaRunWithFlags(stdin) {
  return spawnSync(
    process.execPath,
    [path.join(repoRoot, 'scripts', 'hooks', 'run-with-flags.js'), 'user-prompt:skill-router', 'scripts/hooks/skill-router.js'],
    {
      input: stdin,
      encoding: 'utf8',
      env: { ...process.env, CLAUDE_PLUGIN_ROOT: repoRoot },
      timeout: 30000,
    }
  );
}

check('via run-with-flags: matching prompt emits router output', () => {
  const result = spawnViaRunWithFlags(JSON.stringify({ prompt: 'apply react patterns when refactoring this component' }));
  assert.strictEqual(result.status, 0, `stderr: ${result.stderr}`);
  assert.ok(result.stdout.startsWith('[SkillRouter]'), `Expected router output, got: ${result.stdout}`);
});

check('via run-with-flags: non-matching prompt never echoes raw input', () => {
  const payload = JSON.stringify({ prompt: 'zzqx wvvk pfff qqrr mmnn ttyy' });
  const result = spawnViaRunWithFlags(payload);
  assert.strictEqual(result.status, 0, `stderr: ${result.stderr}`);
  assert.strictEqual(result.stdout, '', 'Raw stdin must never be echoed for UserPromptSubmit');
});

fs.rmSync(cacheDir, { recursive: true, force: true });

console.log(`\nPassed: ${passed}`);
console.log(`Failed: ${failed}`);
process.exit(failed > 0 ? 1 : 0);
