/**
 * Tests for scripts/gemini-adapt-agents.js
 */

const assert = require('assert');
const fs = require('fs');
const os = require('os');
const path = require('path');
const { execFileSync } = require('child_process');

const SCRIPT = path.join(__dirname, '..', '..', 'scripts', 'gemini-adapt-agents.js');

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
  return fs.mkdtempSync(path.join(os.tmpdir(), 'ecc-gemini-adapt-'));
}

function cleanupTempDir(dirPath) {
  fs.rmSync(dirPath, { recursive: true, force: true });
}

function writeAgent(dirPath, name, body) {
  fs.mkdirSync(dirPath, { recursive: true });
  fs.writeFileSync(path.join(dirPath, name), body);
}

function runTests() {
  console.log('\n=== Testing gemini-adapt-agents.js ===\n');

  let passed = 0;
  let failed = 0;

  if (test('shows help with an explicit help flag', () => {
    const result = run(['--help']);
    assert.strictEqual(result.code, 0, result.stderr);
    assert.ok(result.stdout.includes('Adapt ECC agent frontmatter for Gemini CLI'));
    assert.ok(result.stdout.includes('Usage:'));
  })) passed++; else failed++;

  if (test('adapts Claude Code tool names and strips unsupported color metadata', () => {
    const tempDir = createTempDir();
    const agentsDir = path.join(tempDir, '.gemini', 'agents');

    try {
      writeAgent(
        agentsDir,
        'gan-planner.md',
        [
          '---',
          'name: gan-planner',
          'description: Planner agent',
          'tools: [Read, Write, Edit, Bash, Grep, Glob, WebSearch, WebFetch, mcp__context7__resolve-library-id]',
          'model: opus',
          'color: purple',
          '---',
          '',
          'Body'
        ].join('\n')
      );

      const result = run([agentsDir]);
      assert.strictEqual(result.code, 0, result.stderr);
      assert.ok(result.stdout.includes('Updated 1 agent file(s)'));

      const updated = fs.readFileSync(path.join(agentsDir, 'gan-planner.md'), 'utf8');
      assert.ok(updated.includes('tools: ["read_file", "write_file", "replace", "run_shell_command", "grep_search", "glob", "google_web_search", "web_fetch", "mcp_context7_resolve_library_id"]'));
      assert.ok(!updated.includes('color: purple'));
    } finally {
      cleanupTempDir(tempDir);
    }
  })) passed++; else failed++;

  if (test('adapts comma-separated scalar Claude Code tools', () => {
    const tempDir = createTempDir();
    const agentsDir = path.join(tempDir, '.gemini', 'agents');

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

      const updated = fs.readFileSync(path.join(agentsDir, 'docs-lookup.md'), 'utf8');
      assert.ok(updated.includes('tools: ["read_file", "grep_search", "mcp_context7_resolve_library_id", "mcp_context7_query_docs"]'));
    } finally {
      cleanupTempDir(tempDir);
    }
  })) passed++; else failed++;

  if (test('defaults to the cwd .gemini/agents directory', () => {
    const tempDir = createTempDir();
    const agentsDir = path.join(tempDir, '.gemini', 'agents');

    try {
      writeAgent(
        agentsDir,
        'architect.md',
        [
          '---',
          'name: architect',
          'description: Architect agent',
          'tools: ["Read", "Grep", "Glob"]',
          'model: opus',
          '---',
          '',
          'Body'
        ].join('\n')
      );

      const result = run([], { cwd: tempDir });
      assert.strictEqual(result.code, 0, result.stderr);

      const updated = fs.readFileSync(path.join(agentsDir, 'architect.md'), 'utf8');
      assert.ok(updated.includes('tools: ["read_file", "grep_search", "glob"]'));
    } finally {
      cleanupTempDir(tempDir);
    }
  })) passed++; else failed++;

  if (test('deduplicates MultiEdit/Edit and ReadFile/NotebookRead/Read', () => {
    const tempDir = createTempDir();
    const agentsDir = path.join(tempDir, '.gemini', 'agents');

    try {
      writeAgent(
        agentsDir,
        'code-simplifier.md',
        [
          '---',
          'name: code-simplifier',
          'description: Refactoring agent',
          'tools: Read, ReadFile, NotebookRead, Edit, MultiEdit, Write',
          '---',
          '',
          'Body'
        ].join('\n')
      );

      const result = run([agentsDir]);
      assert.strictEqual(result.code, 0, result.stderr);

      const updated = fs.readFileSync(path.join(agentsDir, 'code-simplifier.md'), 'utf8');
      assert.ok(updated.includes('tools: ["read_file", "replace", "write_file"]'));
    } finally {
      cleanupTempDir(tempDir);
    }
  })) passed++; else failed++;

  if (test('adapts a CRLF agent on Windows and preserves its line endings', () => {
    const tempDir = createTempDir();
    const agentsDir = path.join(tempDir, '.gemini', 'agents');

    try {
      writeAgent(
        agentsDir,
        'windows.md',
        ['---', 'name: windows', 'tools: Read, Bash', 'color: purple', '---', '', 'Body line'].join('\r\n')
      );

      const result = run([agentsDir]);
      assert.strictEqual(result.code, 0, result.stderr);
      assert.ok(result.stdout.includes('Updated 1 agent file(s)'), result.stdout);

      const updated = fs.readFileSync(path.join(agentsDir, 'windows.md'), 'utf8');
      assert.ok(updated.includes('tools: ["read_file", "run_shell_command"]'));
      assert.ok(!updated.includes('color: purple'));
      assert.ok(updated.includes('\r\n'), 'CRLF endings were lost');
      assert.ok(!/[^\r]\n/.test(updated), 'found a bare LF in a CRLF file');
    } finally {
      cleanupTempDir(tempDir);
    }
  })) passed++; else failed++;

  if (test('rejects an unknown flag without modifying any file', () => {
    const tempDir = createTempDir();
    const agentsDir = path.join(tempDir, '.gemini', 'agents');

    try {
      writeAgent(
        agentsDir,
        'architect.md',
        ['---', 'name: architect', 'tools: Read, Bash', '---', '', 'Body'].join('\n')
      );
      const before = fs.readFileSync(path.join(agentsDir, 'architect.md'), 'utf8');

      const result = run(['--dry-run', agentsDir]);
      assert.strictEqual(result.code, 1);
      assert.ok(result.stderr.includes('Unknown option: --dry-run'), result.stderr);
      assert.strictEqual(fs.readFileSync(path.join(agentsDir, 'architect.md'), 'utf8'), before);
    } finally {
      cleanupTempDir(tempDir);
    }
  })) passed++; else failed++;

  if (test('adapts multi-line YAML block list tools and is idempotent on rerun', () => {
    const tempDir = createTempDir();
    const agentsDir = path.join(tempDir, '.gemini', 'agents');

    try {
      writeAgent(
        agentsDir,
        'block-tools.md',
        [
          '---',
          'name: block-tools',
          'description: Block list tools',
          'tools:',
          '  - Read',
          '  # comment inside list',
          '  - Grep',
          'model: sonnet',
          '---',
          '',
          'Body'
        ].join('\n')
      );

      const first = run([agentsDir]);
      assert.strictEqual(first.code, 0, first.stderr);
      assert.ok(first.stdout.includes('Updated 1 agent file(s)'));

      const afterFirst = fs.readFileSync(path.join(agentsDir, 'block-tools.md'), 'utf8');
      assert.ok(afterFirst.includes('tools: ["read_file", "grep_search"]'));
      assert.ok(!afterFirst.includes('- Read'));

      const second = run([agentsDir]);
      assert.strictEqual(second.code, 0, second.stderr);
      assert.ok(second.stdout.includes('Updated 0 agent file(s)'));
      assert.ok(second.stdout.includes('1 already compatible'));
      assert.strictEqual(fs.readFileSync(path.join(agentsDir, 'block-tools.md'), 'utf8'), afterFirst);
    } finally {
      cleanupTempDir(tempDir);
    }
  })) passed++; else failed++;

  if (test('strips unquoted inline YAML comments on block-list items while preserving quoted # literals', () => {
    const tempDir = createTempDir();
    const agentsDir = path.join(tempDir, '.gemini', 'agents');

    try {
      writeAgent(
        agentsDir,
        'inline-comments.md',
        [
          '---',
          'name: inline-comments',
          'description: Inline comment handling',
          'tools: # allowed tools',
          '  - Read # inspect files',
          '  - "Read # explanation" # trailing comment',
          '  - \'Grep # literal\' # another comment',
          '---',
          '',
          'Body'
        ].join('\n')
      );

      const result = run([agentsDir]);
      assert.strictEqual(result.code, 0, result.stderr);

      const updated = fs.readFileSync(path.join(agentsDir, 'inline-comments.md'), 'utf8');
      assert.ok(
        updated.includes('tools: ["read_file", "Read # explanation", "Grep # literal"]'),
        updated
      );
    } finally {
      cleanupTempDir(tempDir);
    }
  })) passed++; else failed++;

  if (test('preserves mixed line endings in the body verbatim when adapting frontmatter', () => {
    const tempDir = createTempDir();
    const agentsDir = path.join(tempDir, '.gemini', 'agents');
    const mixedBody = '\nFirst LF line\nPasted CRLF line\r\nFinal LF line\n';

    try {
      writeAgent(
        agentsDir,
        'mixed-endings.md',
        `---\nname: mixed-endings\ntools: Read, Bash\ncolor: purple\n---\n${mixedBody}`
      );

      const result = run([agentsDir]);
      assert.strictEqual(result.code, 0, result.stderr);

      const updated = fs.readFileSync(path.join(agentsDir, 'mixed-endings.md'), 'utf8');
      assert.strictEqual(
        updated,
        `---\nname: mixed-endings\ntools: ["read_file", "run_shell_command"]\n---\n${mixedBody}`
      );
    } finally {
      cleanupTempDir(tempDir);
    }
  })) passed++; else failed++;

  console.log(`\nResults: Passed: ${passed}, Failed: ${failed}`);
  process.exit(failed > 0 ? 1 : 0);
}

runTests();
