/**
 * Direct coverage for scripts/ci/generate-command-registry.js.
 */

'use strict';

const assert = require('assert');
const fs = require('fs');
const os = require('os');
const path = require('path');

const {
  checkRegistry,
  formatRegistry,
  generateRegistry,
  parseArgs,
  run,
  writeRegistry,
} = require('../../scripts/ci/generate-command-registry');

function createTestDir() {
  return fs.mkdtempSync(path.join(os.tmpdir(), 'ecc-command-registry-'));
}

function cleanupTestDir(testDir) {
  fs.rmSync(testDir, { recursive: true, force: true });
}

function writeFixture(root) {
  fs.mkdirSync(path.join(root, 'commands'), { recursive: true });
  fs.mkdirSync(path.join(root, 'agents'), { recursive: true });
  fs.mkdirSync(path.join(root, 'skills', 'tdd-workflow'), { recursive: true });
  fs.mkdirSync(path.join(root, 'skills', 'security-review'), { recursive: true });

  fs.writeFileSync(path.join(root, 'agents', 'code-reviewer.md'), '---\nmodel: sonnet\ntools: Read\n---\n');
  fs.writeFileSync(path.join(root, 'agents', 'test-writer.md'), '---\nmodel: sonnet\ntools: Read\n---\n');
  fs.writeFileSync(path.join(root, 'skills', 'tdd-workflow', 'SKILL.md'), '# TDD workflow\n');
  fs.writeFileSync(path.join(root, 'skills', 'security-review', 'SKILL.md'), '# Security review\n');

  fs.writeFileSync(path.join(root, 'commands', 'review.md'), `---
description: Review changes
---
# Review

Use @code-reviewer and skill: security-review.
`);

  fs.writeFileSync(path.join(root, 'commands', 'tdd.md'), `---
description: "Write tests first"
---
# TDD

Call subagent_type: test-writer and skills/tdd-workflow/SKILL.md.
`);
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
  console.log('\n=== Testing command registry generation ===\n');

  let passed = 0;
  let failed = 0;

  if (test('generates deterministic command metadata and usage statistics', () => {
    const testDir = createTestDir();
    try {
      writeFixture(testDir);

      const registry = generateRegistry({ root: testDir });

      assert.strictEqual(registry.schemaVersion, 1);
      assert.strictEqual(registry.totalCommands, 2);
      assert.deepStrictEqual(
        registry.commands.map(command => command.command),
        ['review', 'tdd']
      );
      assert.deepStrictEqual(registry.commands[0].allAgents, ['code-reviewer']);
      assert.deepStrictEqual(registry.commands[0].skills, ['security-review']);
      assert.deepStrictEqual(registry.commands[1].allAgents, ['test-writer']);
      assert.deepStrictEqual(registry.commands[1].skills, ['tdd-workflow']);
      assert.deepStrictEqual(registry.statistics.byType, { review: 1, testing: 1 });
      assert.deepStrictEqual(registry.statistics.topAgents[0], { agent: 'code-reviewer', count: 1 });
    } finally {
      cleanupTestDir(testDir);
    }
  })) passed++; else failed++;

  if (test('write and check modes use stable JSON without timestamps', () => {
    const testDir = createTestDir();
    try {
      writeFixture(testDir);
      const outputPath = path.join(testDir, 'docs', 'COMMAND-REGISTRY.json');
      const registry = generateRegistry({ root: testDir });

      writeRegistry(registry, outputPath);
      const firstWrite = fs.readFileSync(outputPath, 'utf8');
      writeRegistry(registry, outputPath);
      const secondWrite = fs.readFileSync(outputPath, 'utf8');

      assert.strictEqual(firstWrite, secondWrite);
      assert.ok(!firstWrite.includes('generated'));
      assert.doesNotThrow(() => checkRegistry(registry, outputPath));
    } finally {
      cleanupTestDir(testDir);
    }
  })) passed++; else failed++;

  if (test('check mode fails when the registry file is stale', () => {
    const testDir = createTestDir();
    try {
      writeFixture(testDir);
      const outputPath = path.join(testDir, 'docs', 'COMMAND-REGISTRY.json');
      const registry = generateRegistry({ root: testDir });

      fs.mkdirSync(path.dirname(outputPath), { recursive: true });
      fs.writeFileSync(outputPath, `${formatRegistry(registry).trimEnd()}\n \n`);

      assert.throws(
        () => checkRegistry(registry, outputPath),
        /out of date/
      );
    } finally {
      cleanupTestDir(testDir);
    }
  })) passed++; else failed++;

  if (test('CLI reports unknown arguments and supports check output', () => {
    const testDir = createTestDir();
    try {
      writeFixture(testDir);
      const outputPath = path.join(testDir, 'docs', 'COMMAND-REGISTRY.json');
      const registry = generateRegistry({ root: testDir });
      writeRegistry(registry, outputPath);

      let stdout = '';
      let stderr = '';
      const streams = {
        stdout: { write: chunk => { stdout += chunk; } },
        stderr: { write: chunk => { stderr += chunk; } },
      };

      assert.deepStrictEqual(parseArgs(['--json', '--write']), {
        json: true,
        write: true,
        check: false,
      });
      assert.strictEqual(run(['--check'], { root: testDir, outputPath, ...streams }), 0);
      assert.ok(stdout.includes('up to date'));
      assert.strictEqual(stderr, '');

      stdout = '';
      stderr = '';
      assert.strictEqual(run(['--bogus'], { root: testDir, outputPath, ...streams }), 1);
      assert.strictEqual(stdout, '');
      assert.ok(stderr.includes('Unknown argument'));
    } finally {
      cleanupTestDir(testDir);
    }
  })) passed++; else failed++;

  console.log(`\nResults: Passed: ${passed}, Failed: ${failed}`);
  process.exit(failed > 0 ? 1 : 0);
}

runTests();
