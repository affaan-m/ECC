/**
 * Tests for scripts/hooks/insaits-security-wrapper.js.
 */

'use strict';

const assert = require('assert');
const fs = require('fs');
const os = require('os');
const path = require('path');
const { spawnSync } = require('child_process');

const SCRIPT = path.join(__dirname, '..', '..', 'scripts', 'hooks', 'insaits-security-wrapper.js');

function createTempDir() {
  return fs.mkdtempSync(path.join(os.tmpdir(), 'insaits-wrapper-'));
}

function cleanup(dirPath) {
  fs.rmSync(dirPath, { recursive: true, force: true });
}

function shellQuote(value) {
  return `'${String(value).replace(/'/g, "'\\''")}'`;
}

function writeFakePython(binDir) {
  fs.mkdirSync(binDir, { recursive: true });
  const fakePythonJs = path.join(binDir, 'fake-python.js');
  fs.writeFileSync(fakePythonJs, [
    "'use strict';",
    "const fs = require('fs');",
    "const mode = process.env.FAKE_INSAITS_MODE || 'clean';",
    "if (mode === 'clean') {",
    "  fs.readFileSync(0, 'utf8');",
    "  process.exit(0);",
    "}",
    "if (mode === 'echo') {",
    "  process.stdout.write(fs.readFileSync(0, 'utf8'));",
    "  process.exit(0);",
    "}",
    "if (mode === 'block') {",
    "  process.stdout.write('blocked by monitor\\n');",
    "  process.stderr.write('monitor warning\\n');",
    "  process.exit(2);",
    "}",
    "if (mode === 'error') {",
    "  process.stderr.write('spawned but failed\\n');",
    "  process.exit(1);",
    "}",
  ].join('\n'), 'utf8');

  if (process.platform === 'win32') {
    const fakePythonCmd = path.join(binDir, 'python3.cmd');
    fs.writeFileSync(fakePythonCmd, [
      '@echo off',
      `"${process.execPath}" "%~dp0fake-python.js" %*`,
    ].join('\r\n'), 'utf8');
    return;
  }

  const fakePython = path.join(binDir, 'python3');
  fs.writeFileSync(fakePython, [
    '#!/bin/sh',
    `exec ${shellQuote(process.execPath)} ${shellQuote(fakePythonJs)} "$@"`,
  ].join('\n'), 'utf8');
  fs.chmodSync(fakePython, 0o755);
}

function run(options = {}) {
  return spawnSync(process.execPath, [SCRIPT], {
    input: options.input || '',
    encoding: 'utf8',
    env: {
      ...process.env,
      ...(options.env || {}),
    },
    cwd: options.cwd || process.cwd(),
    timeout: 10000,
  });
}

function test(name, fn) {
  try {
    fn();
    console.log(`  PASS ${name}`);
    return true;
  } catch (error) {
    console.log(`  FAIL ${name}`);
    console.log(`    Error: ${error.message}`);
    return false;
  }
}

function runTests() {
  console.log('\n=== Testing insaits-security-wrapper.js ===\n');

  let passed = 0;
  let failed = 0;

  if (test('passes stdin through when InsAIts is disabled', () => {
    const result = run({
      input: '{"tool_name":"Bash"}',
      env: { ECC_ENABLE_INSAITS: '' },
    });

    assert.strictEqual(result.status, 0);
    assert.strictEqual(result.stdout, '{"tool_name":"Bash"}');
    assert.strictEqual(result.stderr, '');
  })) passed++; else failed++;

  if (test('enabled clean monitor exit preserves original stdin', () => {
    const tempDir = createTempDir();
    try {
      writeFakePython(path.join(tempDir, 'bin'));

      const result = run({
        input: '{"tool_name":"Bash","tool_input":{"command":"npm install"}}',
        env: {
          ECC_ENABLE_INSAITS: '1',
          FAKE_INSAITS_MODE: 'clean',
          PATH: path.join(tempDir, 'bin'),
        },
      });

      assert.strictEqual(result.status, 0, result.stderr);
      assert.strictEqual(result.stdout, '{"tool_name":"Bash","tool_input":{"command":"npm install"}}');
    } finally {
      cleanup(tempDir);
    }
  })) passed++; else failed++;

  if (test('enabled monitor stdout replaces raw input and preserves status', () => {
    const tempDir = createTempDir();
    try {
      writeFakePython(path.join(tempDir, 'bin'));

      const result = run({
        input: '{"tool_name":"Bash","tool_input":{"command":"rm -rf /tmp/demo"}}',
        env: {
          ECC_ENABLE_INSAITS: '1',
          FAKE_INSAITS_MODE: 'block',
          PATH: path.join(tempDir, 'bin'),
        },
      });

      assert.strictEqual(result.status, 2);
      assert.strictEqual(result.stdout, 'blocked by monitor\n');
      assert.strictEqual(result.stderr, 'monitor warning\n');
    } finally {
      cleanup(tempDir);
    }
  })) passed++; else failed++;

  if (test('enabled monitor unexpected failure fails open with warning and raw stdin', () => {
    const tempDir = createTempDir();
    try {
      writeFakePython(path.join(tempDir, 'bin'));

      const result = run({
        input: 'raw-input',
        env: {
          ECC_ENABLE_INSAITS: '1',
          FAKE_INSAITS_MODE: 'error',
          PATH: path.join(tempDir, 'bin'),
        },
      });

      assert.strictEqual(result.status, 0);
      assert.strictEqual(result.stdout, 'raw-input');
      assert.ok(result.stderr.includes('Security monitor exited with status 1'));
      assert.ok(result.stderr.includes('spawned but failed'));
    } finally {
      cleanup(tempDir);
    }
  })) passed++; else failed++;

  if (test('missing Python fails open with warning and raw stdin', () => {
    const result = run({
      input: 'raw-input',
      env: {
        ECC_ENABLE_INSAITS: 'true',
        PATH: '',
      },
    });

    assert.strictEqual(result.status, 0);
    assert.strictEqual(result.stdout, 'raw-input');
    assert.ok(
      result.stderr.includes('python3/python not found')
      || result.stderr.includes('Security monitor exited with status')
    );
  })) passed++; else failed++;

  console.log(`\nResults: Passed: ${passed}, Failed: ${failed}`);
  process.exit(failed > 0 ? 1 : 0);
}

runTests();
