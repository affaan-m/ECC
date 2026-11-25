/**
 * Tests for dry-run mode
 *
 * Run with: node tests/lib/dry-run.test.js
 */

const assert = require('assert');
const fs = require('fs');
const os = require('os');
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
    assert.strictEqual(result.stdout, '', 'Dry-run hooks must not echo stdin');
  })) passed++; else failed++;

  if (test('flushes a large dry-run preview when oversized stdout is suppressed', () => {
    const runWithFlags = path.resolve(__dirname, '..', '..', 'scripts', 'hooks', 'run-with-flags.js');
    const hookScript = 'scripts/hooks/block-no-verify.js';
    const command = 'x'.repeat(900 * 1024);
    const document = JSON.stringify({ tool: 'Bash', tool_input: { command } });
    const input = document.padEnd(1024 * 1024 + 1024, ' ');

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
      maxBuffer: 4 * 1024 * 1024,
    });

    assert.strictEqual(result.status, 0, `Expected exit 0, got ${result.status}`);
    assert.strictEqual(result.stdout, '', 'Oversized dry-run input must keep stdout suppressed');
    assert.ok(
      result.stderr.endsWith(`command=${command}\n`),
      `Expected the complete dry-run preview on stderr, got ${result.stderr.length} characters`
    );
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
    assert.strictEqual(result.stdout, '', 'Dry-run hooks must not echo stdin');
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
    assert.strictEqual(result.stdout, '', 'Dry-run hooks must not echo stdin');
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
    const homeDir = fs.mkdtempSync(path.join(os.tmpdir(), 'ecc-dry-run-home-'));
    try {
      const result = spawnSync(process.execPath, [eccJs, '--dry-run', '--json', 'typescript'], {
        encoding: 'utf8',
        env: {
          ...process.env,
          CLAUDE_CONFIG_DIR: path.join(homeDir, '.claude'),
          HOME: homeDir,
          USERPROFILE: homeDir,
        },
        maxBuffer: 10 * 1024 * 1024,
      });
      assert.strictEqual(result.status, 0, `Expected exit 0, got ${result.status}: ${result.stderr}`);
      const payload = JSON.parse(result.stdout);
      assert.strictEqual(payload.dryRun, true, 'Expected dryRun=true in JSON output');
      assert.deepStrictEqual(payload.plan.legacyLanguages, ['typescript']);
    } finally {
      fs.rmSync(homeDir, { force: true, recursive: true });
    }
  })) passed++; else failed++;

  console.log('\nresolveDryRun() shared helper:');

  if (test('returns false with no flag and no env', () => {
    const { resolveDryRun } = require('../../scripts/lib/dry-run');
    assert.strictEqual(resolveDryRun(false, {}), false);
  })) passed++; else failed++;

  if (test('returns true when the flag is true', () => {
    const { resolveDryRun } = require('../../scripts/lib/dry-run');
    assert.strictEqual(resolveDryRun(true, {}), true);
  })) passed++; else failed++;

  if (test('returns true when ECC_DRY_RUN=1 even if the flag is false', () => {
    const { resolveDryRun } = require('../../scripts/lib/dry-run');
    assert.strictEqual(resolveDryRun(false, { ECC_DRY_RUN: '1' }), true);
  })) passed++; else failed++;

  if (test('returns false when ECC_DRY_RUN=0 and the flag is false', () => {
    const { resolveDryRun } = require('../../scripts/lib/dry-run');
    assert.strictEqual(resolveDryRun(false, { ECC_DRY_RUN: '0' }), false);
  })) passed++; else failed++;

  if (test('throws when ECC_DRY_RUN is set to an unrecognized value', () => {
    const { resolveDryRun } = require('../../scripts/lib/dry-run');
    assert.throws(
      () => resolveDryRun(false, { ECC_DRY_RUN: 'yes' }),
      /ECC_DRY_RUN must be "1" or "0" when set/
    );
  })) passed++; else failed++;

  console.log('\nsubcommand parseArgs() honoring the global --dry-run prefix (#2952 follow-up):');

  if (test('setup.js parseArgs() honors ECC_DRY_RUN=1 even without a literal --dry-run flag', () => {
    const previous = process.env.ECC_DRY_RUN;
    process.env.ECC_DRY_RUN = '1';
    try {
      delete require.cache[require.resolve('../../scripts/setup.js')];
      const { parseArgs } = require('../../scripts/setup.js');
      const options = parseArgs(['--mode', 'claude-plugin', '--scope', 'user', '--yes']);
      assert.strictEqual(options.dryRun, true);
    } finally {
      if (previous === undefined) delete process.env.ECC_DRY_RUN;
      else process.env.ECC_DRY_RUN = previous;
    }
  })) passed++; else failed++;

  if (test('auto-update.js parseArgs() honors ECC_DRY_RUN=1 even without a literal --dry-run flag', () => {
    const previous = process.env.ECC_DRY_RUN;
    process.env.ECC_DRY_RUN = '1';
    try {
      delete require.cache[require.resolve('../../scripts/auto-update.js')];
      const { parseArgs } = require('../../scripts/auto-update.js');
      const options = parseArgs(['node', 'auto-update.js']);
      assert.strictEqual(options.dryRun, true);
    } finally {
      if (previous === undefined) delete process.env.ECC_DRY_RUN;
      else process.env.ECC_DRY_RUN = previous;
    }
  })) passed++; else failed++;

  if (test('install-guided.js parseArgs() honors ECC_DRY_RUN=1 even without a literal --dry-run flag', () => {
    const previous = process.env.ECC_DRY_RUN;
    process.env.ECC_DRY_RUN = '1';
    try {
      delete require.cache[require.resolve('../../scripts/install-guided.js')];
      const { parseArgs } = require('../../scripts/install-guided.js');
      const options = parseArgs([]);
      assert.strictEqual(options.dryRun, true);
    } finally {
      if (previous === undefined) delete process.env.ECC_DRY_RUN;
      else process.env.ECC_DRY_RUN = previous;
    }
  })) passed++; else failed++;

  if (test('ecc --dry-run setup ... previews instead of writing Claude settings', () => {
    const eccJs = path.resolve(__dirname, '..', '..', 'scripts', 'ecc.js');
    const homeDir = fs.mkdtempSync(path.join(os.tmpdir(), 'ecc-dry-run-setup-'));
    const claudeDir = path.join(homeDir, '.claude');
    fs.mkdirSync(claudeDir, { recursive: true });
    const settingsPath = path.join(claudeDir, 'settings.json');
    fs.writeFileSync(settingsPath, '{}');
    try {
      const result = spawnSync(process.execPath, [
        eccJs, '--dry-run', 'setup',
        '--mode', 'claude-plugin', '--scope', 'user', '--hooks', 'standard', '--yes',
      ], {
        encoding: 'utf8',
        env: { ...process.env, CLAUDE_CONFIG_DIR: claudeDir, HOME: homeDir, USERPROFILE: homeDir },
      });
      assert.strictEqual(result.status, 0, `Expected exit 0, got ${result.status}: ${result.stderr}`);
      assert.ok(
        result.stdout.includes('would-install') || result.stdout.includes('would-update'),
        `Expected preview language in output, got: ${result.stdout}`
      );
      assert.strictEqual(
        fs.readFileSync(settingsPath, 'utf8'),
        '{}',
        'Global --dry-run before setup must not write to Claude settings'
      );
    } finally {
      fs.rmSync(homeDir, { force: true, recursive: true });
    }
  })) passed++; else failed++;

  if (test('ecc --dry-run repair ... skips the install-state reconciliation write path', () => {
    const eccJs = path.resolve(__dirname, '..', '..', 'scripts', 'ecc.js');
    const homeDir = fs.mkdtempSync(path.join(os.tmpdir(), 'ecc-dry-run-repair-'));
    try {
      const result = spawnSync(process.execPath, [eccJs, '--dry-run', 'repair', '--json'], {
        encoding: 'utf8',
        env: { ...process.env, HOME: homeDir, USERPROFILE: homeDir },
      });
      assert.strictEqual(result.status, 0, `Expected exit 0, got ${result.status}: ${result.stderr}`);
      const payload = JSON.parse(result.stdout);
      assert.strictEqual(
        payload.installStateProjection,
        undefined,
        'Global --dry-run before repair must skip the (non-dry-run-only) reconciliation step'
      );
    } finally {
      fs.rmSync(homeDir, { force: true, recursive: true });
    }
  })) passed++; else failed++;

  console.log(`\nResults: ${passed} passed, ${failed} failed`);
  console.log(`Passed: ${passed}`);
  console.log(`Failed: ${failed}`);
  process.exit(failed > 0 ? 1 : 0);
}

runTests();
