/**
 * Tests for scripts/hooks/quality-gate.js
 *
 * Run with: node tests/hooks/quality-gate.test.js
 */

const assert = require('assert');
const path = require('path');
const os = require('os');
const fs = require('fs');
const { spawnSync } = require('child_process');

const qualityGate = require('../../scripts/hooks/quality-gate');
const hookPath = path.resolve(__dirname, '../../scripts/hooks/quality-gate.js');

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

let passed = 0;
let failed = 0;

console.log('\nQuality Gate Hook Tests');
console.log('========================\n');

// --- run() returns original input for valid JSON ---

console.log('run() pass-through behavior:');

if (test('returns original input for valid JSON with file_path', () => {
  const input = JSON.stringify({ tool_input: { file_path: '/tmp/nonexistent-file.js' } });
  const result = qualityGate.run(input);
  assert.strictEqual(result, input, 'Should return original input unchanged');
})) passed++; else failed++;

if (test('returns original input for valid JSON without file_path', () => {
  const input = JSON.stringify({ tool_input: { command: 'ls' } });
  const result = qualityGate.run(input);
  assert.strictEqual(result, input, 'Should return original input unchanged');
})) passed++; else failed++;

if (test('returns original input for valid JSON with nested structure', () => {
  const input = JSON.stringify({ tool_input: { file_path: '/some/path.ts', content: 'hello' }, other: [1, 2, 3] });
  const result = qualityGate.run(input);
  assert.strictEqual(result, input, 'Should return original input unchanged');
})) passed++; else failed++;

// --- run() returns original input for invalid JSON ---

console.log('\nInvalid JSON handling:');

if (test('returns original input for invalid JSON (no crash)', () => {
  const input = 'this is not json at all {{{';
  const result = qualityGate.run(input);
  assert.strictEqual(result, input, 'Should return original input unchanged');
})) passed++; else failed++;

if (test('returns original input for partial JSON', () => {
  const input = '{"tool_input": {';
  const result = qualityGate.run(input);
  assert.strictEqual(result, input, 'Should return original input unchanged');
})) passed++; else failed++;

if (test('returns original input for JSON with trailing garbage', () => {
  const input = '{"tool_input": {}}extra';
  const result = qualityGate.run(input);
  assert.strictEqual(result, input, 'Should return original input unchanged');
})) passed++; else failed++;

// --- run() returns original input when file does not exist ---

console.log('\nNon-existent file handling:');

if (test('returns original input when file_path points to non-existent file', () => {
  const input = JSON.stringify({ tool_input: { file_path: '/tmp/does-not-exist-12345.js' } });
  const result = qualityGate.run(input);
  assert.strictEqual(result, input, 'Should return original input unchanged');
})) passed++; else failed++;

if (test('returns original input when file_path is a non-existent .py file', () => {
  const input = JSON.stringify({ tool_input: { file_path: '/tmp/does-not-exist-12345.py' } });
  const result = qualityGate.run(input);
  assert.strictEqual(result, input, 'Should return original input unchanged');
})) passed++; else failed++;

if (test('returns original input when file_path is a non-existent .go file', () => {
  const input = JSON.stringify({ tool_input: { file_path: '/tmp/does-not-exist-12345.go' } });
  const result = qualityGate.run(input);
  assert.strictEqual(result, input, 'Should return original input unchanged');
})) passed++; else failed++;

// --- run() returns original input for empty input ---

console.log('\nEmpty input handling:');

if (test('returns original input for empty string', () => {
  const input = '';
  const result = qualityGate.run(input);
  assert.strictEqual(result, input, 'Should return empty string unchanged');
})) passed++; else failed++;

if (test('returns original input for whitespace-only string', () => {
  const input = '   ';
  const result = qualityGate.run(input);
  assert.strictEqual(result, input, 'Should return whitespace string unchanged');
})) passed++; else failed++;

// --- run() handles missing tool_input gracefully ---

console.log('\nMissing tool_input handling:');

if (test('handles missing tool_input gracefully', () => {
  const input = JSON.stringify({ something_else: 'value' });
  const result = qualityGate.run(input);
  assert.strictEqual(result, input, 'Should return original input unchanged');
})) passed++; else failed++;

if (test('handles null tool_input gracefully', () => {
  const input = JSON.stringify({ tool_input: null });
  const result = qualityGate.run(input);
  assert.strictEqual(result, input, 'Should return original input unchanged');
})) passed++; else failed++;

if (test('handles tool_input with empty file_path', () => {
  const input = JSON.stringify({ tool_input: { file_path: '' } });
  const result = qualityGate.run(input);
  assert.strictEqual(result, input, 'Should return original input unchanged');
})) passed++; else failed++;

if (test('handles empty JSON object', () => {
  const input = JSON.stringify({});
  const result = qualityGate.run(input);
  assert.strictEqual(result, input, 'Should return original input unchanged');
})) passed++; else failed++;

// --- run() with a real file (but no formatter installed) ---

console.log('\nReal file without formatter:');

if (test('returns original input for existing file with no formatter configured', () => {
  const tmpFile = path.join(os.tmpdir(), `quality-gate-test-${Date.now()}.js`);
  fs.writeFileSync(tmpFile, 'const x = 1;\n');
  try {
    const input = JSON.stringify({ tool_input: { file_path: tmpFile } });
    const result = qualityGate.run(input);
    assert.strictEqual(result, input, 'Should return original input unchanged');
  } finally {
    fs.unlinkSync(tmpFile);
  }
})) passed++; else failed++;

// Exercise real executable shims: .cmd on Windows, executable shell scripts elsewhere.

function withFormatterFixture(formatter, fallback, fn) {
  const root = fs.realpathSync(fs.mkdtempSync(path.join(os.tmpdir(), 'quality-gate project ')));
  try {
    const srcDir = path.join(root, 'source files');
    const binDir = path.join(root, fallback ? 'runner bin' : 'node_modules/.bin');
    fs.mkdirSync(srcDir, { recursive: true });
    fs.mkdirSync(binDir, { recursive: true });
    fs.writeFileSync(path.join(root, 'package.json'), '{}');
    fs.writeFileSync(path.join(root, formatter === 'biome' ? 'biome.json' : '.prettierrc'), '{}');
    const fileName = 'edited %ECC_TEST_LITERAL% !ECC_TEST_LITERAL! & file';
    const filePath = path.join(srcDir, fileName + (formatter === 'biome' ? '.json' : '.js'));
    const original = formatter === 'biome' ? '{"value":1}\n' : 'const value=1;\n';
    fs.writeFileSync(filePath, original);
    const capturePath = path.join(root, 'invocation.json');
    const runnerPath = path.join(root, 'fake formatter.js');
    fs.writeFileSync(runnerPath, [
      "const fs = require('fs');",
      "const path = require('path');",
      'const args = process.argv.slice(2);',
      'fs.writeFileSync(process.env.ECC_TEST_CAPTURE, JSON.stringify({ args, cwd: process.cwd() }));',
      "if (args.includes('--write')) fs.appendFileSync(args.find(arg => path.isAbsolute(arg)), 'formatted\\n');",
      'process.exit(Number(process.env.ECC_TEST_EXIT || 0));'
    ].join('\n'));
    const binName = fallback ? 'npx' : formatter;
    const shimPath = path.join(binDir, binName + (process.platform === 'win32' ? '.cmd' : ''));
    const quoteSh = value => "'" + value.replace(/'/g, "'\\''") + "'";
    const shim = process.platform === 'win32'
      ? `@echo off\r\n"${process.execPath}" "${runnerPath}" %*\r\n`
      : `#!/bin/sh\nexec ${quoteSh(process.execPath)} ${quoteSh(runnerPath)} "$@"\n`;
    fs.writeFileSync(shimPath, shim, { mode: 0o755 });
    const env = Object.fromEntries(Object.entries(process.env).filter(([key]) => key.toUpperCase() !== 'PATH'));
    Object.assign(env, {
      PATH: binDir,
      CLAUDE_PACKAGE_MANAGER: 'npm',
      ECC_QUALITY_GATE_FIX: 'false',
      ECC_QUALITY_GATE_STRICT: 'true',
      ECC_TEST_CAPTURE: capturePath,
      ECC_TEST_LITERAL: 'must-not-expand',
      ECC_TEST_EXIT: '0'
    });
    const input = JSON.stringify({ tool_input: { file_path: filePath } });
    const runHook = (overrides, nodeArguments = []) => spawnSync(process.execPath, [...nodeArguments, hookPath], {
      cwd: srcDir, input, encoding: 'utf8', timeout: 20000,
      env: { ...env, ...overrides }
    });
    fn({ root, filePath, original, capturePath, input, runHook });
  } finally {
    fs.rmSync(root, { recursive: true, force: true });
  }
}

function assertInvocation(fixture, result, expectedArgs) {
  assert.ifError(result.error);
  assert.strictEqual(result.status, 0, result.stderr);
  assert.strictEqual(result.stdout, fixture.input, 'Hook must preserve its input');
  assert.ok(fs.existsSync(fixture.capturePath), 'Formatter shim was not executed');
  assert.deepStrictEqual(JSON.parse(fs.readFileSync(fixture.capturePath, 'utf8')), {
    args: expectedArgs, cwd: fixture.root
  });
}

console.log('\nReal formatter subprocesses:');
for (const formatter of ['prettier', 'biome']) {
  for (const fix of [false, true]) {
    if (test(`runs local ${formatter} in ${fix ? 'fix' : 'check'} mode with literal spaces and shell metacharacters`, () => {
      withFormatterFixture(formatter, false, fixture => {
        const result = fixture.runHook({ ECC_QUALITY_GATE_FIX: String(fix) });
        const args = formatter === 'biome'
          ? ['check', fixture.filePath, ...(fix ? ['--write'] : [])]
          : [fix ? '--write' : '--check', fixture.filePath];
        assertInvocation(fixture, result, args);
        assert.strictEqual(result.stderr, '', 'Successful formatter should not warn');
        assert.strictEqual(fs.readFileSync(fixture.filePath, 'utf8'), fixture.original + (fix ? 'formatted\n' : ''));
      });
    })) passed++; else failed++;
  }
  if (test(`runs ${formatter} through the package runner when no local formatter exists`, () => {
    withFormatterFixture(formatter, true, fixture => {
      const args = formatter === 'biome'
        ? ['@biomejs/biome', 'check', fixture.filePath]
        : ['prettier', '--check', fixture.filePath];
      const result = fixture.runHook();
      assertInvocation(fixture, result, args);
      assert.strictEqual(result.stderr, '');
      assert.strictEqual(fs.readFileSync(fixture.filePath, 'utf8'), fixture.original);
    });
  })) passed++; else failed++;
}

if (test('preserves literal formatter arguments even if invocation options drift to shell:true', () => {
  withFormatterFixture('prettier', false, fixture => {
    const preload = path.join(fixture.root, 'invocation-drift.cjs');
    const helperPath = path.resolve(__dirname, '../../scripts/hooks/pre-bash-commit-quality.js');
    fs.writeFileSync(preload, [
      `const helper = require(${JSON.stringify(helperPath)});`,
      'const original = helper.getLinterInvocation;',
      'helper.getLinterInvocation = (...args) => {',
      '  const invocation = original(...args);',
      '  invocation.options.shell = true;',
      '  return invocation;',
      '};'
    ].join('\n'));
    const result = fixture.runHook({}, ['--require', preload]);
    assertInvocation(fixture, result, ['--check', fixture.filePath]);
    assert.strictEqual(result.stderr, '');
  });
})) passed++; else failed++;

if (test('reports a real formatter failure in strict mode while preserving hook input', () => {
  withFormatterFixture('prettier', false, fixture => {
    const result = fixture.runHook({ ECC_TEST_EXIT: '2' });
    assertInvocation(fixture, result, ['--check', fixture.filePath]);
    assert.ok(result.stderr.includes(`[QualityGate] Prettier check failed for ${fixture.filePath}`));
    assert.strictEqual(fs.readFileSync(fixture.filePath, 'utf8'), fixture.original);
  });
})) passed++; else failed++;

console.log(`\nResults: Passed: ${passed}, Failed: ${failed}`);
process.exit(failed > 0 ? 1 : 0);
