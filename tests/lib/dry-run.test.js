/**
 * Tests for dry-run mode
 *
 * Run with: node tests/lib/dry-run.test.js
 */

const assert = require('assert');
const path = require('path');
const { spawnSync } = require('child_process');

function test(name, fn) {
  try {
    fn();
    console.log(`  ✓ ${name}`);
    return true;
  } catch (err) {
    console.log(`  ✗ ${name}`);
    console.log(`    Error: ${err.message}`);
    return false;
  }
}

function runTests() {
  console.log('\n=== Testing dry-run mode ===\n');

  let passed = 0;
  let failed = 0;

  console.log('isDryRun():');

  if (test('returns false when ECC_DRY_RUN is unset', () => {
    const env = { ...process.env };
    delete env.ECC_DRY_RUN;
    const result = spawnSync(process.execPath, [
      '-e',
      'const { isDryRun } = require("./scripts/lib/hook-flags"); process.exit(isDryRun() ? 1 : 0)',
    ], { cwd: path.resolve(__dirname, '..', '..'), env });
    assert.strictEqual(result.status, 0);
  })) passed++; else failed++;

  if (test('returns true when ECC_DRY_RUN=1', () => {
    const env = { ...process.env, ECC_DRY_RUN: '1' };
    const result = spawnSync(process.execPath, [
      '-e',
      'const { isDryRun } = require("./scripts/lib/hook-flags"); process.exit(isDryRun() ? 1 : 0)',
    ], { cwd: path.resolve(__dirname, '..', '..'), env });
    assert.strictEqual(result.status, 1);
  })) passed++; else failed++;

  if (test('returns false when ECC_DRY_RUN=0', () => {
    const env = { ...process.env, ECC_DRY_RUN: '0' };
    const result = spawnSync(process.execPath, [
      '-e',
      'const { isDryRun } = require("./scripts/lib/hook-flags"); process.exit(isDryRun() ? 1 : 0)',
    ], { cwd: path.resolve(__dirname, '..', '..'), env });
    assert.strictEqual(result.status, 0);
  })) passed++; else failed++;

  console.log('\nrun-with-flags.js dry-run gating:');

  if (test('skips hook execution and logs preview when ECC_DRY_RUN=1', () => {
    const runWithFlags = path.resolve(__dirname, '..', '..', 'scripts', 'hooks', 'run-with-flags.js');
    const hookScript = 'scripts/hooks/doc-file-warning.js';
    const input = JSON.stringify({ tool: 'Write', tool_input: { file_path: '/tmp/test.md' } });

    const result = spawnSync(process.execPath, [
      runWithFlags,
      'pre:write:doc-file-warning',
      hookScript,
      'standard,strict',
    ], {
      input,
      encoding: 'utf8',
      env: { ...process.env, ECC_DRY_RUN: '1' },
      cwd: path.resolve(__dirname, '..', '..'),
    });

    assert.strictEqual(result.status, 0, `Expected exit 0, got ${result.status}`);
    assert.ok(
      result.stderr.includes('[DryRun]'),
      `Expected stderr to contain [DryRun] tag, got: ${result.stderr}`
    );
    assert.ok(
      result.stderr.includes('pre:write:doc-file-warning'),
      `Expected stderr to contain hook ID, got: ${result.stderr}`
    );
    assert.ok(
      result.stderr.includes('tool=Write'),
      `Expected stderr to contain tool name, got: ${result.stderr}`
    );
    assert.ok(
      result.stderr.includes('target=/tmp/test.md'),
      `Expected stderr to contain target file path, got: ${result.stderr}`
    );
    assert.strictEqual(result.stdout, input, 'Expected stdin to be passed through unchanged');
  })) passed++; else failed++;

  if (test('dry-run preview includes command for bash hooks', () => {
    const runWithFlags = path.resolve(__dirname, '..', '..', 'scripts', 'hooks', 'run-with-flags.js');
    const hookScript = 'scripts/hooks/block-no-verify.js';
    const input = JSON.stringify({ tool: 'Bash', tool_input: { command: 'git commit --no-verify -m "test"' } });

    const result = spawnSync(process.execPath, [
      runWithFlags,
      'pre:bash:block-no-verify',
      hookScript,
      'standard,strict',
    ], {
      input,
      encoding: 'utf8',
      env: { ...process.env, ECC_DRY_RUN: '1' },
      cwd: path.resolve(__dirname, '..', '..'),
    });

    assert.strictEqual(result.status, 0, `Expected exit 0, got ${result.status}`);
    assert.ok(
      result.stderr.includes('tool=Bash'),
      `Expected stderr to contain tool=Bash, got: ${result.stderr}`
    );
    assert.ok(
      result.stderr.includes('command=git commit --no-verify'),
      `Expected stderr to contain command, got: ${result.stderr}`
    );
    assert.strictEqual(result.stdout, input, 'Expected stdin to be passed through unchanged');
  })) passed++; else failed++;

  if (test('dry-run preview handles non-JSON stdin gracefully', () => {
    const runWithFlags = path.resolve(__dirname, '..', '..', 'scripts', 'hooks', 'run-with-flags.js');
    const hookScript = 'scripts/hooks/session-start.js';
    const input = 'not valid json at all';

    const result = spawnSync(process.execPath, [
      runWithFlags,
      'pre:session:start',
      hookScript,
      'standard',
    ], {
      input,
      encoding: 'utf8',
      env: { ...process.env, ECC_DRY_RUN: '1' },
      cwd: path.resolve(__dirname, '..', '..'),
    });

    assert.strictEqual(result.status, 0, `Expected exit 0, got ${result.status}`);
    assert.ok(
      result.stderr.includes('[DryRun]'),
      `Expected stderr to contain [DryRun], got: ${result.stderr}`
    );
    assert.ok(
      !result.stderr.includes('tool='),
      'Expected no tool= when stdin is not JSON'
    );
    assert.strictEqual(result.stdout, input, 'Expected stdin to be passed through unchanged');
  })) passed++; else failed++;

  if (test('dry-run preview handles empty stdin gracefully', () => {
    const runWithFlags = path.resolve(__dirname, '..', '..', 'scripts', 'hooks', 'run-with-flags.js');
    const hookScript = 'scripts/hooks/session-start.js';

    const result = spawnSync(process.execPath, [
      runWithFlags,
      'post:stop:session-end',
      hookScript,
      'standard',
    ], {
      input: '',
      encoding: 'utf8',
      env: { ...process.env, ECC_DRY_RUN: '1' },
      cwd: path.resolve(__dirname, '..', '..'),
    });

    assert.strictEqual(result.status, 0, `Expected exit 0, got ${result.status}`);
    assert.ok(
      result.stderr.includes('[DryRun]'),
      `Expected stderr to contain [DryRun], got: ${result.stderr}`
    );
    assert.ok(
      !result.stderr.includes('target='),
      'Expected no target= when stdin is empty'
    );
  })) passed++; else failed++;

  if (test('executes hook normally when ECC_DRY_RUN is not set', () => {
    const runWithFlags = path.resolve(__dirname, '..', '..', 'scripts', 'hooks', 'run-with-flags.js');
    const hookScript = 'scripts/hooks/doc-file-warning.js';
    const input = JSON.stringify({ tool: 'Write', tool_input: { file_path: '/tmp/test.txt' } });

    const env = { ...process.env };
    delete env.ECC_DRY_RUN;

    const result = spawnSync(process.execPath, [
      runWithFlags,
      'pre:write:doc-file-warning',
      hookScript,
      'standard,strict',
    ], {
      input,
      encoding: 'utf8',
      env,
      cwd: path.resolve(__dirname, '..', '..'),
    });

    assert.strictEqual(result.status, 0);
    assert.ok(
      !result.stderr.includes('[DryRun]'),
      'Expected no [DryRun] tag in normal execution'
    );
  })) passed++; else failed++;

  console.log('\necc.js --dry-run flag parsing:');

  if (test('--dry-run sets ECC_DRY_RUN env var for child commands', () => {
    const eccJs = path.resolve(__dirname, '..', '..', 'scripts', 'ecc.js');
    const result = spawnSync(process.execPath, [eccJs, '--dry-run', '--help'], {
      encoding: 'utf8',
      env: { ...process.env },
    });
    assert.strictEqual(result.status, 0);
    assert.ok(result.stdout.includes('--dry-run'), 'Help text should mention --dry-run');
  })) passed++; else failed++;

  if (test('--dry-run is stripped from args so command routing works', () => {
    const eccJs = path.resolve(__dirname, '..', '..', 'scripts', 'ecc.js');
    const result = spawnSync(process.execPath, [eccJs, '--dry-run', 'doctor'], {
      encoding: 'utf8',
      env: { ...process.env },
    });
    assert.ok(
      !result.stderr.includes('Unknown command: --dry-run'),
      'Global --dry-run must not be treated as an unknown command'
    );
  })) passed++; else failed++;

  if (test('--dry-run works with implicit install routing', () => {
    const eccJs = path.resolve(__dirname, '..', '..', 'scripts', 'ecc.js');
    const result = spawnSync(process.execPath, [eccJs, '--dry-run', '--json', 'typescript'], {
      encoding: 'utf8',
      env: { ...process.env },
    });
    assert.strictEqual(result.status, 0, `Expected exit 0, got ${result.status}: ${result.stderr}`);
    const payload = JSON.parse(result.stdout);
    assert.strictEqual(payload.dryRun, true, 'Expected dryRun=true in JSON output');
    assert.deepStrictEqual(payload.plan.legacyLanguages, ['typescript']);
  })) passed++; else failed++;

  console.log(`\nResults: ${passed} passed, ${failed} failed`);
  process.exit(failed > 0 ? 1 : 0);
}

runTests();
