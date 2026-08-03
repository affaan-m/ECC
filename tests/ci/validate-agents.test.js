/**
 * Tests for validate-agents.js — agent frontmatter and model validation.
 *
 * Split from the original monolithic tests/ci/validators.test.js.
 * Tests both success paths (against the real project) and error paths
 * (against temporary fixture directories via wrapper scripts).
 *
 * Run with: node tests/ci/validate-agents.test.js
 */

const assert = require('assert');
const path = require('path');
const fs = require('fs');
const {
  test,
  createTestDir,
  cleanupTestDir,
  stripShebang,
  runValidatorWithDir,
  runValidator,
  finish
} = require('./validator-test-utils');

console.log('validate-agents.js:');

test('strips CRLF shebangs before writing temp wrappers', () => {
  const source = '#!/usr/bin/env node\r\nconsole.log("ok");';
  assert.strictEqual(stripShebang(source), 'console.log("ok");');
});

test('passes on real project agents', () => {
  const result = runValidator('validate-agents');
  assert.strictEqual(result.code, 0, `Should pass, got stderr: ${result.stderr}`);
  assert.ok(result.stdout.includes('Validated'), 'Should output validation count');
});

test('fails on agent without frontmatter', () => {
  const testDir = createTestDir();
  fs.writeFileSync(path.join(testDir, 'bad-agent.md'), '# No frontmatter here\nJust content.');

  const result = runValidatorWithDir('validate-agents', 'AGENTS_DIR', testDir);
  assert.strictEqual(result.code, 1, 'Should exit 1 for missing frontmatter');
  assert.ok(result.stderr.includes('Missing frontmatter'), 'Should report missing frontmatter');
  cleanupTestDir(testDir);
});

test('fails on agent missing required model field', () => {
  const testDir = createTestDir();
  fs.writeFileSync(path.join(testDir, 'no-model.md'), '---\ntools: Read, Write\n---\n# Agent');

  const result = runValidatorWithDir('validate-agents', 'AGENTS_DIR', testDir);
  assert.strictEqual(result.code, 1, 'Should exit 1 for missing model');
  assert.ok(result.stderr.includes('model'), 'Should report missing model field');
  cleanupTestDir(testDir);
});

test('fails on agent missing required tools field', () => {
  const testDir = createTestDir();
  fs.writeFileSync(path.join(testDir, 'no-tools.md'), '---\nmodel: sonnet\n---\n# Agent');

  const result = runValidatorWithDir('validate-agents', 'AGENTS_DIR', testDir);
  assert.strictEqual(result.code, 1, 'Should exit 1 for missing tools');
  assert.ok(result.stderr.includes('tools'), 'Should report missing tools field');
  cleanupTestDir(testDir);
});

test('passes on valid agent with all required fields', () => {
  const testDir = createTestDir();
  fs.writeFileSync(path.join(testDir, 'good-agent.md'), '---\nmodel: sonnet\ntools: Read, Write\n---\n# Agent');

  const result = runValidatorWithDir('validate-agents', 'AGENTS_DIR', testDir);
  assert.strictEqual(result.code, 0, 'Should pass for valid agent');
  assert.ok(result.stdout.includes('Validated 1'), 'Should report 1 validated');
  cleanupTestDir(testDir);
});

test('handles frontmatter with BOM and CRLF', () => {
  const testDir = createTestDir();
  const content = '\uFEFF---\r\nmodel: sonnet\r\ntools: Read, Write\r\n---\r\n# Agent';
  fs.writeFileSync(path.join(testDir, 'bom-agent.md'), content);

  const result = runValidatorWithDir('validate-agents', 'AGENTS_DIR', testDir);
  assert.strictEqual(result.code, 0, 'Should handle BOM and CRLF');
  cleanupTestDir(testDir);
});

test('handles frontmatter with colons in values', () => {
  const testDir = createTestDir();
  fs.writeFileSync(path.join(testDir, 'colon-agent.md'), '---\nmodel: sonnet\ntools: Read, Write, Bash\ndescription: Run this: always check: everything\n---\n# Agent');

  const result = runValidatorWithDir('validate-agents', 'AGENTS_DIR', testDir);
  assert.strictEqual(result.code, 0, 'Should handle colons in values');
  cleanupTestDir(testDir);
});

test('skips non-md files', () => {
  const testDir = createTestDir();
  fs.writeFileSync(path.join(testDir, 'readme.txt'), 'Not an agent');
  fs.writeFileSync(path.join(testDir, 'valid.md'), '---\nmodel: sonnet\ntools: Read\n---\n# Agent');

  const result = runValidatorWithDir('validate-agents', 'AGENTS_DIR', testDir);
  assert.strictEqual(result.code, 0, 'Should only validate .md files');
  assert.ok(result.stdout.includes('Validated 1'), 'Should count only .md files');
  cleanupTestDir(testDir);
});

test('exits 0 when directory does not exist', () => {
  const result = runValidatorWithDir('validate-agents', 'AGENTS_DIR', '/nonexistent/dir');
  assert.strictEqual(result.code, 0, 'Should skip when no agents dir');
  assert.ok(result.stdout.includes('skipping'), 'Should say skipping');
});

test('rejects agent with empty model value', () => {
  const testDir = createTestDir();
  fs.writeFileSync(path.join(testDir, 'empty.md'), '---\nmodel:\ntools: Read, Write\n---\n# Empty model');
  const result = runValidatorWithDir('validate-agents', 'AGENTS_DIR', testDir);
  assert.strictEqual(result.code, 1, 'Should reject empty model');
  assert.ok(result.stderr.includes('model'), 'Should mention model field');
  cleanupTestDir(testDir);
});

test('rejects agent with empty tools value', () => {
  const testDir = createTestDir();
  fs.writeFileSync(path.join(testDir, 'empty.md'), '---\nmodel: claude-sonnet-4-5-20250929\ntools:\n---\n# Empty tools');
  const result = runValidatorWithDir('validate-agents', 'AGENTS_DIR', testDir);
  assert.strictEqual(result.code, 1, 'Should reject empty tools');
  assert.ok(result.stderr.includes('tools'), 'Should mention tools field');
  cleanupTestDir(testDir);
});

console.log('\nvalidate-agents.js (whitespace edge cases):');

test('rejects agent with whitespace-only model value', () => {
  const testDir = createTestDir();
  fs.writeFileSync(path.join(testDir, 'ws-model.md'), '---\nmodel:   \t  \ntools: Read, Write\n---\n# Agent');

  const result = runValidatorWithDir('validate-agents', 'AGENTS_DIR', testDir);
  assert.strictEqual(result.code, 1, 'Should reject whitespace-only model');
  assert.ok(result.stderr.includes('model'), 'Should report model field error');
  cleanupTestDir(testDir);
});

test('rejects agent with whitespace-only tools value', () => {
  const testDir = createTestDir();
  fs.writeFileSync(path.join(testDir, 'ws-tools.md'), '---\nmodel: sonnet\ntools:   \t  \n---\n# Agent');

  const result = runValidatorWithDir('validate-agents', 'AGENTS_DIR', testDir);
  assert.strictEqual(result.code, 1, 'Should reject whitespace-only tools');
  assert.ok(result.stderr.includes('tools'), 'Should report tools field error');
  cleanupTestDir(testDir);
});

test('accepts agent with extra unknown frontmatter fields', () => {
  const testDir = createTestDir();
  fs.writeFileSync(path.join(testDir, 'extra.md'), '---\nmodel: sonnet\ntools: Read, Write\ncustom_field: some value\nauthor: test\n---\n# Agent');

  const result = runValidatorWithDir('validate-agents', 'AGENTS_DIR', testDir);
  assert.strictEqual(result.code, 0, 'Should accept extra unknown fields');
  cleanupTestDir(testDir);
});

test('rejects agent with invalid model value', () => {
  const testDir = createTestDir();
  fs.writeFileSync(path.join(testDir, 'bad-model.md'), '---\nmodel: gpt-4\ntools: Read\n---\n# Agent');

  const result = runValidatorWithDir('validate-agents', 'AGENTS_DIR', testDir);
  assert.strictEqual(result.code, 1, 'Should reject invalid model');
  assert.ok(result.stderr.includes('Invalid model'), 'Should report invalid model');
  assert.ok(result.stderr.includes('gpt-4'), 'Should show the invalid value');
  cleanupTestDir(testDir);
});

// --- validate-commands.js additional edge cases ---
console.log('\nvalidate-agents.js (empty directory):');

test('passes on empty agents directory', () => {
  const testDir = createTestDir();
  // No .md files, just an empty dir

  const result = runValidatorWithDir('validate-agents', 'AGENTS_DIR', testDir);
  assert.strictEqual(result.code, 0, 'Should pass on empty directory');
  assert.ok(result.stdout.includes('Validated 0'), 'Should report 0 validated');
  cleanupTestDir(testDir);
});

// --- validate-commands.js: whitespace-only file ---
console.log('\nRound 30: validate-agents (model validation):');

test('rejects agent with unrecognized model value', () => {
  const testDir = createTestDir();
  fs.writeFileSync(path.join(testDir, 'bad-model.md'), '---\nmodel: gpt-4\ntools: Read, Write\n---\n# Bad Model Agent');

  const result = runValidatorWithDir('validate-agents', 'AGENTS_DIR', testDir);
  assert.strictEqual(result.code, 1, 'Should reject unrecognized model');
  assert.ok(result.stderr.includes('gpt-4'), 'Should mention the invalid model');
  cleanupTestDir(testDir);
});

test('accepts all valid model values (haiku, sonnet, opus)', () => {
  const testDir = createTestDir();
  fs.writeFileSync(path.join(testDir, 'haiku.md'), '---\nmodel: haiku\ntools: Read\n---\n# Haiku Agent');
  fs.writeFileSync(path.join(testDir, 'sonnet.md'), '---\nmodel: sonnet\ntools: Read, Write\n---\n# Sonnet Agent');
  fs.writeFileSync(path.join(testDir, 'opus.md'), '---\nmodel: opus\ntools: Read, Write, Bash\n---\n# Opus Agent');

  const result = runValidatorWithDir('validate-agents', 'AGENTS_DIR', testDir);
  assert.strictEqual(result.code, 0, 'All valid models should pass');
  assert.ok(result.stdout.includes('3'), 'Should validate 3 agent files');
  cleanupTestDir(testDir);
});

test('rejects agent with duplicate top-level frontmatter keys', () => {
  const testDir = createTestDir();
  fs.writeFileSync(path.join(testDir, 'dup-model.md'), '---\nname: dup\nmodel: sonnet\ntools: Read, Write\ndescription: test\nmodel: opus\n---\n# Agent');

  const result = runValidatorWithDir('validate-agents', 'AGENTS_DIR', testDir);
  assert.strictEqual(result.code, 1, 'Should reject duplicate top-level YAML keys');
  assert.ok(result.stderr.includes('Duplicate frontmatter keys'), 'Should report duplicate keys');
  assert.ok(result.stderr.includes('model'), 'Should name the duplicated key');
  cleanupTestDir(testDir);
});

test('allows duplicate-looking nested frontmatter keys', () => {
  const testDir = createTestDir();
  fs.writeFileSync(path.join(testDir, 'nested.md'), '---\nmodel: sonnet\ntools: Read\nmetadata:\n  model: display-only\n---\n# Agent');

  const result = runValidatorWithDir('validate-agents', 'AGENTS_DIR', testDir);
  assert.strictEqual(result.code, 0, 'Indented nested keys should not count as top-level duplicates');
  cleanupTestDir(testDir);
});

// ── Round 32: empty frontmatter & edge cases ──
console.log('\nRound 32: validate-agents (empty frontmatter):');

test('rejects agent with empty frontmatter block (no key-value pairs)', () => {
  const testDir = createTestDir();
  // Blank line between --- markers creates a valid but empty frontmatter block
  fs.writeFileSync(path.join(testDir, 'empty-fm.md'), '---\n\n---\n# Agent with empty frontmatter');

  const result = runValidatorWithDir('validate-agents', 'AGENTS_DIR', testDir);
  assert.strictEqual(result.code, 1, 'Should reject empty frontmatter');
  assert.ok(result.stderr.includes('model'), 'Should report missing model');
  assert.ok(result.stderr.includes('tools'), 'Should report missing tools');
  cleanupTestDir(testDir);
});

test('rejects agent with no content between --- markers (Missing frontmatter)', () => {
  const testDir = createTestDir();
  // ---\n--- with no blank line → regex doesn't match → "Missing frontmatter"
  fs.writeFileSync(path.join(testDir, 'no-fm.md'), '---\n---\n# Agent');

  const result = runValidatorWithDir('validate-agents', 'AGENTS_DIR', testDir);
  assert.strictEqual(result.code, 1, 'Should reject missing frontmatter');
  assert.ok(result.stderr.includes('Missing frontmatter'), 'Should report missing frontmatter');
  cleanupTestDir(testDir);
});

test('rejects agent with partial frontmatter (only model, no tools)', () => {
  const testDir = createTestDir();
  fs.writeFileSync(path.join(testDir, 'partial.md'), '---\nmodel: haiku\n---\n# Partial agent');

  const result = runValidatorWithDir('validate-agents', 'AGENTS_DIR', testDir);
  assert.strictEqual(result.code, 1, 'Should reject partial frontmatter');
  assert.ok(result.stderr.includes('tools'), 'Should report missing tools');
  assert.ok(!result.stderr.includes('model'), 'Should NOT report model (it is present)');
  cleanupTestDir(testDir);
});

test('handles multiple agents where only one is invalid', () => {
  const testDir = createTestDir();
  fs.writeFileSync(path.join(testDir, 'good.md'), '---\nmodel: sonnet\ntools: Read\n---\n# Good');
  fs.writeFileSync(path.join(testDir, 'bad.md'), '---\nmodel: invalid-model\ntools: Read\n---\n# Bad');

  const result = runValidatorWithDir('validate-agents', 'AGENTS_DIR', testDir);
  assert.strictEqual(result.code, 1, 'Should fail when any agent is invalid');
  assert.ok(result.stderr.includes('bad.md'), 'Should identify the bad file');
  cleanupTestDir(testDir);
});

console.log('\nRound 42: validate-agents (case sensitivity):');

test('rejects uppercase model value (case-sensitive check)', () => {
  const testDir = createTestDir();
  fs.writeFileSync(path.join(testDir, 'upper.md'), '---\nmodel: Haiku\ntools: Read\n---\n# Uppercase model');

  const result = runValidatorWithDir('validate-agents', 'AGENTS_DIR', testDir);
  assert.strictEqual(result.code, 1, 'Should reject capitalized model');
  assert.ok(result.stderr.includes('Invalid model'), 'Should report invalid model');
  assert.ok(result.stderr.includes('Haiku'), 'Should show the rejected value');
  cleanupTestDir(testDir);
});

test('handles space before colon in frontmatter key', () => {
  const testDir = createTestDir();
  // "model : sonnet" — space before colon. extractFrontmatter uses indexOf(':') + trim()
  fs.writeFileSync(path.join(testDir, 'space.md'), '---\nmodel : sonnet\ntools : Read, Write\n---\n# Agent with space-colon');

  const result = runValidatorWithDir('validate-agents', 'AGENTS_DIR', testDir);
  assert.strictEqual(result.code, 0, 'Should accept space before colon (trim handles it)');
  cleanupTestDir(testDir);
});

console.log('\nRound 47: validate-agents (frontmatter lines without colon):');

test('silently ignores frontmatter line without colon', () => {
  const testDir = createTestDir();
  // Line "just some text" has no colon — should be skipped, not cause crash
  fs.writeFileSync(path.join(testDir, 'mixed.md'), '---\nmodel: sonnet\njust some text without colon\ntools: Read\n---\n# Agent');

  const result = runValidatorWithDir('validate-agents', 'AGENTS_DIR', testDir);
  assert.strictEqual(result.code, 0, 'Should ignore lines without colon in frontmatter');
  cleanupTestDir(testDir);
});

// ── Round 52: command inline backtick refs, workflow whitespace, code-only rules ──
console.log('\nRound 58: validate-agents.js (unreadable agent file — readFileSync catch):');

test('reports error when agent .md file is unreadable (chmod 000)', () => {
  // Skip on Windows or when running as root (permissions won't work)
  if (process.platform === 'win32' || (process.getuid && process.getuid() === 0)) {
    console.log('    (skipped — not supported on this platform)');
    return;
  }
  const testDir = createTestDir();
  const agentFile = path.join(testDir, 'locked.md');
  fs.writeFileSync(agentFile, '---\nmodel: sonnet\ntools: Read\n---\n# Agent');
  fs.chmodSync(agentFile, 0o000);

  try {
    const result = runValidatorWithDir('validate-agents', 'AGENTS_DIR', testDir);
    assert.strictEqual(result.code, 1, 'Should exit 1 on read error');
    assert.ok(result.stderr.includes('locked.md'), 'Should mention the unreadable file');
  } finally {
    fs.chmodSync(agentFile, 0o644);
    cleanupTestDir(testDir);
  }
});

console.log('\nRound 58: validate-agents.js (frontmatter line with colon at position 0):');

test('rejects agent when required field key has colon at position 0 (no key name)', () => {
  const testDir = createTestDir();
  fs.writeFileSync(path.join(testDir, 'bad-colon.md'), '---\n:sonnet\ntools: Read\n---\n# Agent with leading colon');

  const result = runValidatorWithDir('validate-agents', 'AGENTS_DIR', testDir);
  assert.strictEqual(result.code, 1, 'Should fail — model field is missing (colon at idx 0 skipped)');
  assert.ok(result.stderr.includes('model'), 'Should report missing model field');
  cleanupTestDir(testDir);
});

console.log('\nRound 83: validate-agents (whitespace-only frontmatter field value):');

test('rejects agent with whitespace-only model field (trim guard)', () => {
  const testDir = createTestDir();
  // model has only whitespace — extractFrontmatter produces { model: '   ', tools: 'Read' }
  // The condition: typeof frontmatter[field] === 'string' && !frontmatter[field].trim()
  // evaluates to true for model → "Missing required field: model"
  fs.writeFileSync(path.join(testDir, 'ws.md'), '---\nmodel:   \ntools: Read\n---\n# Whitespace model');

  const result = runValidatorWithDir('validate-agents', 'AGENTS_DIR', testDir);
  assert.strictEqual(result.code, 1, 'Should reject whitespace-only model');
  assert.ok(result.stderr.includes('model'), 'Should report missing model field');
  assert.ok(!result.stderr.includes('tools'), 'tools field is valid and should NOT be flagged');
  cleanupTestDir(testDir);
});

finish();
