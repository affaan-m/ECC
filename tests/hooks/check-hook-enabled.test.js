/**
 * Tests for scripts/hooks/check-hook-enabled.js
 *
 * Tests the CLI wrapper around isHookEnabled.
 *
 * Run with: node tests/hooks/check-hook-enabled.test.js
 */

const assert = require('assert');
const path = require('path');
const { spawnSync } = require('child_process');

const script = path.join(__dirname, '..', '..', 'scripts', 'hooks', 'check-hook-enabled.js');

function test(name, fn) {
  try {
    fn();
    console.log(`  \u2713 ${name}`);
    return true;
  } catch (err) {
    console.log(`  \u2717 ${name}`);
    console.log(`    Error: ${err.message}`);
    return false;
  }
}

function runScript(args = [], envOverrides = {}) {
  const env = { ...process.env, ...envOverrides };
  // Remove potentially interfering env vars unless explicitly set
  if (!envOverrides.ECC_HOOK_PROFILE) delete env.ECC_HOOK_PROFILE;
  if (!envOverrides.ECC_DISABLED_HOOKS) delete env.ECC_DISABLED_HOOKS;

  const result = spawnSync('node', [script, ...args], {
    encoding: 'utf8',
    timeout: 10000,
    env,
  });
  return {
    code: result.status || 0,
    stdout: result.stdout || '',
    stderr: result.stderr || '',
  };
}

function runTests() {
  console.log('\n=== Testing check-hook-enabled.js ===\n');

  let passed = 0;
  let failed = 0;

  console.log('No arguments:');

  if (test('returns yes when no hookId provided', () => {
    const result = runScript([]);
    assert.strictEqual(result.stdout, 'yes');
  })) passed++; else failed++;

  console.log('\nDefault profile (standard):');

  if (test('returns yes for hook with default profiles', () => {
    const result = runScript(['my-hook']);
    assert.strictEqual(result.stdout, 'yes');
  })) passed++; else failed++;

  if (test('returns yes for hook with standard,strict profiles', () => {
    const result = runScript(['my-hook', 'standard,strict']);
    assert.strictEqual(result.stdout, 'yes');
  })) passed++; else failed++;

  if (test('returns no for hook with only strict profile', () => {
    const result = runScript(['my-hook', 'strict']);
    assert.strictEqual(result.stdout, 'no');
  })) passed++; else failed++;

  if (test('returns no for hook with only minimal profile', () => {
    const result = runScript(['my-hook', 'minimal']);
    assert.strictEqual(result.stdout, 'no');
  })) passed++; else failed++;

  console.log('\nDisabled hooks:');

  if (test('returns no when hook is disabled via env', () => {
    const result = runScript(['my-hook'], { ECC_DISABLED_HOOKS: 'my-hook' });
    assert.strictEqual(result.stdout, 'no');
  })) passed++; else failed++;

  if (test('returns yes when different hook is disabled', () => {
    const result = runScript(['my-hook'], { ECC_DISABLED_HOOKS: 'other-hook' });
    assert.strictEqual(result.stdout, 'yes');
  })) passed++; else failed++;

  console.log('\nProfile overrides:');

  if (test('returns yes for strict profile with strict-only hook', () => {
    const result = runScript(['my-hook', 'strict'], { ECC_HOOK_PROFILE: 'strict' });
    assert.strictEqual(result.stdout, 'yes');
  })) passed++; else failed++;

  if (test('returns yes for minimal profile with minimal-only hook', () => {
    const result = runScript(['my-hook', 'minimal'], { ECC_HOOK_PROFILE: 'minimal' });
    assert.strictEqual(result.stdout, 'yes');
  })) passed++; else failed++;

  console.log(`\nResults: Passed: ${passed}, Failed: ${failed}`);
  process.exit(failed > 0 ? 1 : 0);
}

runTests();
