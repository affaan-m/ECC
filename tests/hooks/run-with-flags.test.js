#!/usr/bin/env node
'use strict';

const assert = require('assert');
const path = require('path');
const { spawnSync } = require('child_process');

const repoRoot = path.join(__dirname, '..', '..');
const wrapper = path.join(repoRoot, 'scripts', 'hooks', 'run-with-flags.js');

function test(name, fn) {
  try {
    fn();
    console.log(`  ✓ ${name}`);
    return true;
  } catch (error) {
    console.log(`  ✗ ${name}`);
    console.log(`    Error: ${error.message}`);
    return false;
  }
}

function runWrapper(input, overrides = {}) {
  const result = spawnSync(process.execPath, [wrapper, overrides.hookId || 'pre:write:doc-file-warning', overrides.script || 'scripts/hooks/doc-file-warning.js', 'standard,strict'], {
    cwd: repoRoot,
    encoding: 'utf8',
    input,
    env: {
      ...process.env,
      CLAUDE_PLUGIN_ROOT: repoRoot,
      ECC_HOOK_PROFILE: 'standard',
      ECC_ENABLE_INSAITS: '',
      ECC_DRY_RUN: '0',
      ECC_HOOKS_ENABLED: '1',
      ECC_DISABLED_HOOKS: overrides.disabled ? overrides.hookId : ''
    },
    timeout: 10000
  });

  return {
    code: result.status,
    stdout: result.stdout || '',
    stderr: result.stderr || ''
  };
}

function runTests() {
  console.log('\n=== Testing run-with-flags.js ===\n');
  let passed = 0;
  let failed = 0;

  test('suppresses ApplyPatch pass-through from an enabled no-op hook', () => {
    const patch = '*** Begin Patch\n*** Update File: /tmp/example.md\n*** End Patch\n';
    const result = runWrapper(patch);
    assert.strictEqual(result.code, 0);
    assert.strictEqual(result.stdout, '');
  })
    ? passed++
    : failed++;

  test('suppresses ApplyPatch pass-through when the hook is disabled', () => {
    const patch = '*** Begin Patch\n*** Update File: /tmp/example.md\n*** End Patch\n';
    const hookId = 'pre:write:doc-file-warning';
    const result = runWrapper(patch, { hookId, disabled: true });
    assert.strictEqual(result.code, 0);
    assert.strictEqual(result.stdout, '');
  })
    ? passed++
    : failed++;

  test('passes a structured ApplyPatch target to blocking hooks', () => {
    const protectedPath = path.join(repoRoot, 'eslint.config.js');
    const patch = ['*** Begin Patch', `*** Update File: ${protectedPath}`, '@@', '-old', '+new', '*** End Patch', ''].join('\n');
    const result = runWrapper(patch, {
      hookId: 'pre:config-protection',
      script: 'scripts/hooks/config-protection.js'
    });
    assert.strictEqual(result.code, 2);
    assert.strictEqual(result.stdout, '');
    assert.match(result.stderr, /BLOCKED: Modifying eslint\.config\.js/);
  })
    ? passed++
    : failed++;

  test('preserves marker-shaped text without one valid file operation', () => {
    const input = '*** Begin Patch\nnot a file operation\n*** End Patch\n';
    const result = runWrapper(input);
    assert.strictEqual(result.code, 0);
    assert.strictEqual(result.stdout, input);
  })
    ? passed++
    : failed++;

  test('preserves malformed envelopes with nested patch markers', () => {
    const input = ['*** Begin Patch', '*** Update File: /tmp/example.md', '*** Begin Patch', '@@', '-old', '+new', '*** End Patch', ''].join('\n');
    const result = runWrapper(input);
    assert.strictEqual(result.code, 0);
    assert.strictEqual(result.stdout, input);
  })
    ? passed++
    : failed++;

  test('recognizes a complete CRLF ApplyPatch envelope', () => {
    const input = ['*** Begin Patch', '*** Update File: C:\\tmp\\example.md', '@@', '-old', '+new', '*** End Patch', ''].join('\r\n');
    const result = runWrapper(input);
    assert.strictEqual(result.code, 0);
    assert.strictEqual(result.stdout, '');
  })
    ? passed++
    : failed++;

  test('preserves JSON hook input for existing Claude Code integrations', () => {
    const input = JSON.stringify({
      tool_name: 'Write',
      tool_input: { file_path: 'README.md' }
    });
    const result = runWrapper(input);
    assert.strictEqual(result.code, 0);
    assert.strictEqual(result.stdout, input);
  })
    ? passed++
    : failed++;

  test('preserves unrelated malformed input for existing hooks', () => {
    const input = '{"tool_name":"Write"';
    const result = runWrapper(input);
    assert.strictEqual(result.code, 0);
    assert.strictEqual(result.stdout, input);
  })
    ? passed++
    : failed++;

  test('preserves genuine JSON hook decisions', () => {
    const input = JSON.stringify({
      tool_name: 'Write',
      tool_input: { file_path: 'TODO.md' }
    });
    const result = runWrapper(input);
    const output = JSON.parse(result.stdout);
    assert.strictEqual(result.code, 0);
    assert.match(output.hookSpecificOutput.additionalContext, /Ad-hoc documentation filename detected/);
  })
    ? passed++
    : failed++;

  console.log(`\nResults: Passed: ${passed}, Failed: ${failed}`);
  process.exit(failed > 0 ? 1 : 0);
}

runTests();
