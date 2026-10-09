/**
 * Tests for scripts/qwen-adapt-agents.js
 */

const assert = require('assert');
const fs = require('fs');
const os = require('os');
const path = require('path');
const { execFileSync } = require('child_process');

const SCRIPT = path.join(__dirname, '..', '..', 'scripts', 'qwen-adapt-agents.js');

function run(args = [], options = {}) {
  try {
    const stdout = execFileSync('node', [SCRIPT, ...args], {
      encoding: 'utf8',
      stdio: ['pipe', 'pipe', 'pipe'],
      cwd: options.cwd,
      timeout: 10000,
    });
    return { code: 0, stdout, stderr: '' };
  } catch (error) {
    return {
      code: error.status || 1,
      stdout: error.stdout || '',
      stderr: error.stderr || '',
    };
  }
}

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

function createTempDir() {
  return fs.mkdtempSync(path.join(os.tmpdir(), 'ecc-qwen-adapt-'));
}

function cleanupTempDir(dirPath) {
  fs.rmSync(dirPath, { recursive: true, force: true });
}

function writeAgent(dirPath, name, body) {
  fs.mkdirSync(dirPath, { recursive: true });
  fs.writeFileSync(path.join(dirPath, name), body);
}

function readAgent(dirPath, name) {
  return fs.readFileSync(path.join(dirPath, name), 'utf8');
}

function runTests() {
  console.log('\n=== Testing qwen-adapt-agents.js ===\n');

  let passed = 0;
  let failed = 0;

  if (test('shows help with an explicit help flag', () => {
    const result = run(['--help']);
    assert.strictEqual(result.code, 0, result.stderr);
    assert.ok(result.stdout.includes('Adapt ECC agent frontmatter for Qwen Code'));
    assert.ok(result.stdout.includes('Usage:'));
  })) passed++; else failed++;

  if (test('maps Claude Code tool names to Qwen Code ids and drops WebSearch', () => {
    const tempDir = createTempDir();
    const agentsDir = path.join(tempDir, '.qwen', 'agents');

    try {
      writeAgent(
        agentsDir,
        'gan-planner.md',
        [
          '---',
          'name: gan-planner',
          'description: Planner agent',
          'tools: [Read, Write, Edit, Bash, Grep, Glob, WebSearch, WebFetch]',
          'model: opus',
          '---',
          '',
          'Body'
        ].join('\n')
      );

      const result = run([agentsDir]);
      assert.strictEqual(result.code, 0, result.stderr);
      assert.ok(result.stdout.includes('Updated 1 agent file(s)'));

      const updated = readAgent(agentsDir, 'gan-planner.md');
      // Edit maps to `edit`, not Gemini's `replace`.
      assert.ok(updated.includes('tools: read_file, write_file, edit, run_shell_command, grep_search, glob, web_fetch'));
      // Qwen Code has no web search tool, so the entry is dropped rather than
      // left advertising a capability the agent cannot use.
      assert.ok(!updated.includes('WebSearch'));
      assert.ok(!updated.includes('web_search'));
    } finally {
      cleanupTempDir(tempDir);
    }
  })) passed++; else failed++;

  if (test('preserves the mcp__server__tool shape', () => {
    const tempDir = createTempDir();
    const agentsDir = path.join(tempDir, '.qwen', 'agents');

    try {
      writeAgent(
        agentsDir,
        'docs-lookup.md',
        [
          '---',
          'name: docs-lookup',
          'description: Documentation lookup agent',
          'tools: Read, Grep, mcp__context7__resolve-library-id, mcp__context7__query-docs',
          'model: sonnet',
          '---',
          '',
          'Body'
        ].join('\n')
      );

      const result = run([agentsDir]);
      assert.strictEqual(result.code, 0, result.stderr);

      const updated = readAgent(agentsDir, 'docs-lookup.md');
      // Unlike Gemini, which lowercases these to mcp_context7_resolve_library_id,
      // Qwen Code keeps the double-underscore form.
      assert.ok(updated.includes('tools: read_file, grep_search, mcp__context7__resolve-library-id, mcp__context7__query-docs'));
    } finally {
      cleanupTempDir(tempDir);
    }
  })) passed++; else failed++;

  if (test('deduplicates MultiEdit and Edit onto a single edit entry', () => {
    const tempDir = createTempDir();
    const agentsDir = path.join(tempDir, '.qwen', 'agents');

    try {
      writeAgent(
        agentsDir,
        'code-simplifier.md',
        [
          '---',
          'name: code-simplifier',
          'description: Refactoring agent',
          'tools: Read, Edit, MultiEdit, Write',
          '---',
          '',
          'Body'
        ].join('\n')
      );

      const result = run([agentsDir]);
      assert.strictEqual(result.code, 0, result.stderr);

      const updated = readAgent(agentsDir, 'code-simplifier.md');
      assert.ok(updated.includes('tools: read_file, edit, write_file'));
      assert.strictEqual(updated.split('edit').length - 1, 1);
    } finally {
      cleanupTempDir(tempDir);
    }
  })) passed++; else failed++;

  if (test('remaps an out-of-palette color instead of dropping it', () => {
    const tempDir = createTempDir();
    const agentsDir = path.join(tempDir, '.qwen', 'agents');

    try {
      writeAgent(
        agentsDir,
        'harness-optimizer.md',
        [
          '---',
          'name: harness-optimizer',
          'description: Harness tuning agent',
          'tools: Read, Grep',
          'color: teal',
          '---',
          '',
          'Body'
        ].join('\n')
      );

      const result = run([agentsDir]);
      assert.strictEqual(result.code, 0, result.stderr);

      // Qwen Code supports color:, but only red/blue/green/yellow/purple/orange/
      // pink/cyan/auto. An unlisted value is dropped at load time with a
      // warning, so teal is remapped to its nearest valid equivalent.
      const updated = readAgent(agentsDir, 'harness-optimizer.md');
      assert.ok(updated.includes('color: cyan'));
      assert.ok(!updated.includes('color: teal'));
    } finally {
      cleanupTempDir(tempDir);
    }
  })) passed++; else failed++;

  if (test('leaves an already-compatible agent untouched', () => {
    const tempDir = createTempDir();
    const agentsDir = path.join(tempDir, '.qwen', 'agents');

    try {
      writeAgent(
        agentsDir,
        'security-reviewer.md',
        [
          '---',
          'name: security-reviewer',
          'description: Security agent',
          'tools: read_file, grep_search',
          'color: red',
          '---',
          '',
          'Body'
        ].join('\n')
      );

      const before = readAgent(agentsDir, 'security-reviewer.md');
      const result = run([agentsDir]);
      assert.strictEqual(result.code, 0, result.stderr);
      assert.ok(result.stdout.includes('Updated 0 agent file(s)'));
      assert.ok(result.stdout.includes('1 already compatible'));
      // A color inside the palette and Qwen-native tool ids need no rewrite.
      assert.strictEqual(readAgent(agentsDir, 'security-reviewer.md'), before);
    } finally {
      cleanupTempDir(tempDir);
    }
  })) passed++; else failed++;

  if (test('leaves the agent body untouched', () => {
    const tempDir = createTempDir();
    const agentsDir = path.join(tempDir, '.qwen', 'agents');
    const body = ['', 'Read the codebase, then Write a summary.', 'Use Bash only when needed.'].join('\n');

    try {
      writeAgent(
        agentsDir,
        'code-explorer.md',
        ['---', 'name: code-explorer', 'tools: Read, Bash', '---', body].join('\n')
      );

      const result = run([agentsDir]);
      assert.strictEqual(result.code, 0, result.stderr);

      const updated = readAgent(agentsDir, 'code-explorer.md');
      // Prose that names Claude tools must survive: only frontmatter is in scope.
      assert.ok(updated.endsWith(body));
    } finally {
      cleanupTempDir(tempDir);
    }
  })) passed++; else failed++;

  if (test('is idempotent on a second run', () => {
    const tempDir = createTempDir();
    const agentsDir = path.join(tempDir, '.qwen', 'agents');

    try {
      writeAgent(
        agentsDir,
        'architect.md',
        ['---', 'name: architect', 'tools: Read, Grep, Glob', 'color: teal', '---', '', 'Body'].join('\n')
      );

      const first = run([agentsDir]);
      assert.strictEqual(first.code, 0, first.stderr);
      assert.ok(first.stdout.includes('Updated 1 agent file(s)'));
      const afterFirst = readAgent(agentsDir, 'architect.md');

      const second = run([agentsDir]);
      assert.strictEqual(second.code, 0, second.stderr);
      assert.ok(second.stdout.includes('Updated 0 agent file(s)'));
      assert.ok(second.stdout.includes('1 already compatible'));
      assert.strictEqual(readAgent(agentsDir, 'architect.md'), afterFirst);
    } finally {
      cleanupTempDir(tempDir);
    }
  })) passed++; else failed++;

  if (test('defaults to the cwd .qwen/agents directory', () => {
    const tempDir = createTempDir();
    const agentsDir = path.join(tempDir, '.qwen', 'agents');

    try {
      writeAgent(
        agentsDir,
        'planner.md',
        ['---', 'name: planner', 'tools: ["Read", "Grep", "Glob"]', '---', '', 'Body'].join('\n')
      );

      const result = run([], { cwd: tempDir });
      assert.strictEqual(result.code, 0, result.stderr);
      assert.ok(readAgent(agentsDir, 'planner.md').includes('tools: read_file, grep_search, glob'));
    } finally {
      cleanupTempDir(tempDir);
    }
  })) passed++; else failed++;

  if (test('fails with a clear error when the agents directory is missing', () => {
    const tempDir = createTempDir();

    try {
      const result = run([path.join(tempDir, 'nope')]);
      assert.strictEqual(result.code, 1);
      assert.ok(result.stderr.includes('Agents directory not found'));
    } finally {
      cleanupTempDir(tempDir);
    }
  })) passed++; else failed++;

  console.log(`\nResults: Passed: ${passed}, Failed: ${failed}`);
  process.exit(failed > 0 ? 1 : 0);
}

runTests();
