/**
 * Tests for scripts/hooks/pre-bash-commit-quality.js
 *
 * Run with: node tests/hooks/pre-bash-commit-quality.test.js
 */

const assert = require('assert');
const fs = require('fs');
const os = require('os');
const path = require('path');
const { spawnSync } = require('child_process');

const hook = require('../../scripts/hooks/pre-bash-commit-quality');

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

function inTempRepo(fn) {
  const prevCwd = process.cwd();
  const repoDir = fs.mkdtempSync(path.join(os.tmpdir(), 'pre-bash-commit-quality-'));

  try {
    spawnSync('git', ['init'], { cwd: repoDir, stdio: 'pipe', encoding: 'utf8' });
    spawnSync('git', ['config', 'user.name', 'ECC Test'], { cwd: repoDir, stdio: 'pipe', encoding: 'utf8' });
    spawnSync('git', ['config', 'user.email', 'ecc@example.com'], { cwd: repoDir, stdio: 'pipe', encoding: 'utf8' });
    process.chdir(repoDir);
    return fn(repoDir);
  } finally {
    process.chdir(prevCwd);
    fs.rmSync(repoDir, { recursive: true, force: true });
  }
}

function captureConsoleError(fn) {
  const previousError = console.error;
  const lines = [];
  console.error = (...args) => {
    lines.push(args.join(' '));
  };

  try {
    const result = fn();
    return { result, stderr: lines.join('\n') };
  } finally {
    console.error = previousError;
  }
}

function writeAndStage(repoDir, relativePath, content) {
  const filePath = path.join(repoDir, relativePath);
  fs.mkdirSync(path.dirname(filePath), { recursive: true });
  fs.writeFileSync(filePath, content, 'utf8');
  spawnSync('git', ['add', relativePath], { cwd: repoDir, stdio: 'pipe', encoding: 'utf8' });
}

function executableName(name) {
  return process.platform === 'win32' ? `${name}.cmd` : name;
}

function writeFakeExecutable(filePath, output, exitCode) {
  const source = process.platform === 'win32'
    ? `@echo off\r\necho ${output}\r\nexit /b ${exitCode}\r\n`
    : `#!/bin/sh\necho "${output}"\nexit ${exitCode}\n`;

  fs.writeFileSync(filePath, source, 'utf8');
  fs.chmodSync(filePath, 0o755);
}

function pathEnvKey() {
  return Object.keys(process.env).find(key => key.toLowerCase() === 'path') || 'PATH';
}

function withEnv(overrides, fn) {
  const previous = {};
  for (const key of Object.keys(overrides)) {
    previous[key] = process.env[key];
    process.env[key] = overrides[key];
  }

  try {
    return fn();
  } finally {
    for (const key of Object.keys(overrides)) {
      if (typeof previous[key] === 'string') {
        process.env[key] = previous[key];
      } else {
        delete process.env[key];
      }
    }
  }
}

let passed = 0;
let failed = 0;

console.log('\nPre-Bash Commit Quality Hook Tests');
console.log('==================================\n');

if (test('evaluate blocks commits when staged snapshot contains debugger', () => {
  inTempRepo(repoDir => {
    const filePath = path.join(repoDir, 'index.js');
    fs.writeFileSync(filePath, 'function main() {\n  debugger;\n}\n', 'utf8');
    spawnSync('git', ['add', 'index.js'], { cwd: repoDir, stdio: 'pipe', encoding: 'utf8' });

    const input = JSON.stringify({ tool_input: { command: 'git commit -m "fix: test debugger hook"' } });
    const result = hook.evaluate(input);

    assert.strictEqual(result.output, input, 'should preserve stdin payload');
    assert.strictEqual(result.exitCode, 2, 'should block commit when staged snapshot has debugger');
  });
})) passed++; else failed++;

if (test('evaluate inspects staged snapshot instead of newer working tree content', () => {
  inTempRepo(repoDir => {
    const filePath = path.join(repoDir, 'index.js');
    fs.writeFileSync(filePath, 'function main() {\n  return 1;\n}\n', 'utf8');
    spawnSync('git', ['add', 'index.js'], { cwd: repoDir, stdio: 'pipe', encoding: 'utf8' });

    // Working tree diverges after staging; hook should still inspect staged content.
    fs.writeFileSync(filePath, 'function main() {\n  debugger;\n  return 1;\n}\n', 'utf8');

    const input = JSON.stringify({ tool_input: { command: 'git commit -m "fix: staged snapshot only"' } });
    const result = hook.evaluate(input);

    assert.strictEqual(result.output, input, 'should preserve stdin payload');
    assert.strictEqual(result.exitCode, 0, 'should ignore unstaged debugger in working tree');
  });
})) passed++; else failed++;

if (test('passes through non-commit amend malformed JSON and run wrapper paths', () => {
  const readInput = JSON.stringify({ tool_input: { command: 'git status --short' } });
  assert.deepStrictEqual(hook.evaluate(readInput), { output: readInput, exitCode: 0 });

  const amendInput = JSON.stringify({ tool_input: { command: 'git commit --amend -m "fix: update"' } });
  assert.deepStrictEqual(hook.evaluate(amendInput), { output: amendInput, exitCode: 0 });

  const malformed = 'not json {{{';
  const malformedResult = captureConsoleError(() => hook.run(malformed));
  assert.deepStrictEqual(malformedResult.result, { stdout: malformed, exitCode: 0 });
  assert.ok(malformedResult.stderr.includes('[Hook] Error:'), 'should log JSON parse errors without blocking');
})) passed++; else failed++;

if (test('allows git commit when no files are staged', () => {
  inTempRepo(() => {
    const input = JSON.stringify({ tool_input: { command: 'git commit -m "fix: no staged files"' } });
    const { result, stderr } = captureConsoleError(() => hook.evaluate(input));

    assert.strictEqual(result.output, input);
    assert.strictEqual(result.exitCode, 0);
    assert.ok(stderr.includes('No staged files found'), `expected no-staged warning, got: ${stderr}`);
  });
})) passed++; else failed++;

if (test('allows warning-only issues while reporting console TODO and message warnings', () => {
  inTempRepo(repoDir => {
    writeAndStage(repoDir, 'index.js', [
      'console.log("debug only");',
      '// TODO: clean this up',
      '// TODO: tracked in issue #123',
      '// console.log("commented out");',
      '* console.log("doc comment");',
      'const ok = true;',
      ''
    ].join('\n'));

    const input = JSON.stringify({
      tool_input: {
        command: 'git commit -m "fix: Uppercase subject."'
      }
    });
    const { result, stderr } = captureConsoleError(() => hook.evaluate(input));

    assert.strictEqual(result.output, input);
    assert.strictEqual(result.exitCode, 0, 'warning-only issues should not block');
    assert.ok(stderr.includes('WARNING Line 1'), `expected console warning, got: ${stderr}`);
    assert.ok(stderr.includes('INFO Line 2'), `expected TODO info warning, got: ${stderr}`);
    assert.ok(stderr.includes('Subject should start with lowercase'), `expected capitalization warning, got: ${stderr}`);
    assert.ok(stderr.includes('should not end with a period'), `expected punctuation warning, got: ${stderr}`);
    assert.ok(stderr.includes('Warnings found'), `expected warning summary, got: ${stderr}`);
  });
})) passed++; else failed++;

if (test('reports invalid and long commit messages without blocking when files are clean', () => {
  inTempRepo(repoDir => {
    writeAndStage(repoDir, 'index.js', 'const clean = true;\n');

    const longMessage = `Bad message ${'x'.repeat(80)}`;
    const input = JSON.stringify({
      tool_input: {
        command: `git commit --message="${longMessage}"`
      }
    });
    const { result, stderr } = captureConsoleError(() => hook.evaluate(input));

    assert.strictEqual(result.output, input);
    assert.strictEqual(result.exitCode, 0);
    assert.ok(stderr.includes('does not follow conventional commit format'), `expected format warning, got: ${stderr}`);
    assert.ok(stderr.includes('Commit message too long'), `expected length warning, got: ${stderr}`);
  });
})) passed++; else failed++;

if (test('blocks commits with staged secret patterns across checkable files', () => {
  inTempRepo(repoDir => {
    writeAndStage(repoDir, 'index.js', [
      "const openai = 'sk-abcdefghijklmnopqrstuvwxyz';",
      "const anthropic = 'sk-ant-api03-AbCdEf-GhIjKlMnOpQrStUvWx_Yz012345';",
      "const token = 'ghp_abcdefghijklmnopqrstuvwxyzABCDEFGHIJ';",
      ''
    ].join('\n'));
    writeAndStage(repoDir, 'app.py', [
      'aws = "AKIAABCDEFGHIJKLMNOP"',
      'api_key = "secret-value"',
      ''
    ].join('\n'));

    const input = JSON.stringify({ tool_input: { command: 'git commit -m "fix: block secrets"' } });
    const { result, stderr } = captureConsoleError(() => hook.evaluate(input));

    assert.strictEqual(result.output, input);
    assert.strictEqual(result.exitCode, 2);
    assert.ok(stderr.includes('Potential OpenAI API key'), `expected OpenAI secret warning, got: ${stderr}`);
    assert.ok(stderr.includes('Potential Anthropic API key'), `expected Anthropic key warning, got: ${stderr}`);
    assert.ok(stderr.includes('Potential GitHub PAT'), `expected GitHub PAT warning, got: ${stderr}`);
    assert.ok(stderr.includes('Potential AWS Access Key'), `expected AWS key warning, got: ${stderr}`);
    assert.ok(stderr.includes('Potential API key'), `expected generic API key warning, got: ${stderr}`);
  });
})) passed++; else failed++;

if (test('reports eslint pylint and golint failures from staged files', () => {
  inTempRepo(repoDir => {
    writeAndStage(repoDir, 'index.js', 'const lint = true;\n');
    writeAndStage(repoDir, 'app.py', 'print("lint")\n');
    writeAndStage(repoDir, 'main.go', 'package main\n');

    const eslintPath = path.join(repoDir, 'node_modules', '.bin', executableName('eslint'));
    fs.mkdirSync(path.dirname(eslintPath), { recursive: true });
    writeFakeExecutable(eslintPath, 'eslint failed', 1);

    const binDir = path.join(repoDir, 'fake-bin');
    fs.mkdirSync(binDir, { recursive: true });
    const pylintPath = path.join(binDir, executableName('pylint'));
    const golintPath = path.join(binDir, executableName('golint'));
    writeFakeExecutable(pylintPath, 'pylint failed', 1);
    writeFakeExecutable(golintPath, 'main.go:1: lint failed', 0);

    const pathKey = pathEnvKey();
    withEnv({ [pathKey]: `${binDir}${path.delimiter}${process.env[pathKey] || process.env.PATH || ''}` }, () => {
      const input = JSON.stringify({ tool_input: { command: 'git commit -m "fix: lint failures"' } });
      const { result, stderr } = captureConsoleError(() => hook.evaluate(input));

      assert.strictEqual(result.output, input);
      assert.strictEqual(result.exitCode, 2);
      assert.ok(stderr.includes('ESLint Issues'), `expected ESLint output, got: ${stderr}`);
      assert.ok(stderr.includes('eslint failed'), `expected ESLint failure text, got: ${stderr}`);
      assert.ok(stderr.includes('Pylint Issues'), `expected Pylint output, got: ${stderr}`);
      assert.ok(stderr.includes('pylint failed'), `expected Pylint failure text, got: ${stderr}`);
      assert.ok(stderr.includes('golint Issues'), `expected golint output, got: ${stderr}`);
      assert.ok(stderr.includes('main.go:1: lint failed'), `expected golint failure text, got: ${stderr}`);
    });
  });
})) passed++; else failed++;

if (test('stdin entry point truncates oversized input and preserves pass-through output', () => {
  const oversized = JSON.stringify({
    tool_input: {
      command: 'git status',
      filler: 'x'.repeat(1024 * 1024 + 1024)
    }
  });
  const result = spawnSync(process.execPath, [path.join(__dirname, '..', '..', 'scripts', 'hooks', 'pre-bash-commit-quality.js')], {
    input: oversized,
    encoding: 'utf8',
    stdio: ['pipe', 'pipe', 'pipe'],
    timeout: 10000,
    maxBuffer: 2 * 1024 * 1024
  });

  assert.strictEqual(result.status, 0);
  assert.ok(result.stdout.length > 0, 'expected truncated payload to pass through');
  assert.ok(result.stdout.length <= 1024 * 1024, 'expected stdout to stay within hook input limit');
  assert.strictEqual(result.stdout, oversized.slice(0, result.stdout.length));
  assert.ok(result.stderr.includes('[Hook] Error:'), 'truncated JSON should be logged and allowed');
})) passed++; else failed++;

console.log(`\nResults: Passed: ${passed}, Failed: ${failed}`);
process.exit(failed > 0 ? 1 : 0);
