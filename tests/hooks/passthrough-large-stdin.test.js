#!/usr/bin/env node
/**
 * Regression coverage for #2924.
 *
 * Legacy direct hook entrypoints that echo stdin must preserve the complete
 * hook payload. Cutting the input at an arbitrary byte/character boundary
 * produces invalid JSON, while exiting before stdout drains loses everything
 * past the platform pipe buffer.
 */

'use strict';

const assert = require('assert');
const fs = require('fs');
const os = require('os');
const path = require('path');
const { spawnSync } = require('child_process');

const repoRoot = path.join(__dirname, '..', '..');
const workDir = fs.mkdtempSync(path.join(os.tmpdir(), 'ecc-passthrough-'));
const DIRECT_STDIN_LIMIT_BYTES = 16 * 1024 * 1024;

const PASSTHROUGH_HOOKS = [
  'scripts/hooks/check-console-log.js',
  'scripts/hooks/post-edit-typecheck.js',
  'scripts/hooks/post-edit-console-warn.js',
  'scripts/hooks/post-edit-format.js',
  'scripts/hooks/pre-write-doc-warn.js'
];

const PAYLOADS = [
  ['1KB payload', 'x'.repeat(1024)],
  ['200KB payload', 'x'.repeat(200 * 1024)],
  ['2MB payload', 'x'.repeat(2 * 1024 * 1024)],
  ['5MB payload', 'x'.repeat(5 * 1024 * 1024)],
  ['multibyte payload beyond 1MB', '韩'.repeat(600 * 1024)]
];

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

function hookPayload(padding) {
  return JSON.stringify({
    session_id: `passthrough-${process.pid}`,
    hook_event_name: 'PostToolUse',
    tool_name: 'Edit',
    tool_input: { file_path: path.join(workDir, 'fixture.txt') },
    padding
  });
}

function runDirect(script, input) {
  return spawnSync(process.execPath, [path.join(repoRoot, script)], {
    input,
    encoding: 'utf8',
    cwd: workDir,
    timeout: 30000,
    maxBuffer: 32 * 1024 * 1024,
    stdio: ['pipe', 'pipe', 'pipe']
  });
}

console.log('\nPassthrough hook large-stdin tests (#2924):');

let passed = 0;
let failed = 0;

for (const script of PASSTHROUGH_HOOKS) {
  for (const [label, padding] of PAYLOADS) {
    if (
      test(`${path.basename(script)} preserves the complete ${label}`, () => {
        const input = hookPayload(padding);
        const result = runDirect(script, input);

        assert.strictEqual(
          result.status,
          0,
          `${script}: expected exit 0, got ${result.status}: ${result.stderr}`
        );
        assert.ok(
          result.stdout === input,
          `${script}: expected ${Buffer.byteLength(input)} bytes, got ${Buffer.byteLength(result.stdout || '')}`
        );
        assert.deepStrictEqual(JSON.parse(result.stdout), JSON.parse(input));
      })
    ) {
      passed += 1;
    } else {
      failed += 1;
    }
  }
}

const oversizedInputs = [
  ['ASCII', hookPayload('x'.repeat(DIRECT_STDIN_LIMIT_BYTES))],
  ['multibyte', hookPayload('韩'.repeat(6 * 1024 * 1024))]
];
for (const [encoding, overLimitInput] of oversizedInputs) {
  for (const script of PASSTHROUGH_HOOKS) {
    if (
      test(`${path.basename(script)} suppresses ${encoding} input beyond the 16MiB direct-entrypoint limit`, () => {
        assert.ok(Buffer.byteLength(overLimitInput) > DIRECT_STDIN_LIMIT_BYTES);
        const result = runDirect(script, overLimitInput);

        assert.strictEqual(
          result.status,
          0,
          `${script}: expected exit 0, got ${result.status}: ${result.stderr || result.error || ''}`
        );
        assert.ok(result.stdout === '', 'oversized input must not be emitted as truncated JSON');
      })
    ) {
      passed += 1;
    } else {
      failed += 1;
    }
  }
}

if (
  test('post-edit-typecheck.js flushes the nonexistent-TypeScript-file early return', () => {
    const input = JSON.stringify({
      hook_event_name: 'PostToolUse',
      tool_name: 'Edit',
      tool_input: { file_path: path.join(workDir, 'missing.ts') },
      padding: 'x'.repeat(2 * 1024 * 1024)
    });
    const result = runDirect('scripts/hooks/post-edit-typecheck.js', input);

    assert.strictEqual(result.status, 0, result.stderr);
    assert.ok(result.stdout === input, 'early return must wait for the complete stdout payload');
    JSON.parse(result.stdout);
  })
) {
  passed += 1;
} else {
  failed += 1;
}

if (
  test('pre-write-doc-warn.js returns valid structured output for a large warned payload', () => {
    const input = JSON.stringify({
      hook_event_name: 'PreToolUse',
      tool_name: 'Write',
      tool_input: { file_path: 'TODO.md', content: 'x'.repeat(2 * 1024 * 1024) }
    });
    const result = runDirect('scripts/hooks/pre-write-doc-warn.js', input);

    assert.strictEqual(result.status, 0, result.stderr);
    const output = JSON.parse(result.stdout);
    assert.ok(
      output.hookSpecificOutput.additionalContext.includes('TODO.md'),
      'large warned payload should retain the doc warning'
    );
  })
) {
  passed += 1;
} else {
  failed += 1;
}

try {
  fs.rmSync(workDir, { recursive: true, force: true });
} catch {
  /* best-effort cleanup */
}

console.log(`\nResults: Passed: ${passed}, Failed: ${failed}\n`);
process.exit(failed > 0 ? 1 : 0);
