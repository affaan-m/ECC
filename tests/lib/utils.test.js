/**
 * Tests for scripts/lib/utils.js
 *
 * Run with: node tests/lib/utils.test.js
 */

const assert = require('assert');
const path = require('path');
const fs = require('fs');

// Import the module
const utils = require('../../scripts/node/lib/utils');

// Test helper
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

// Test suite
function runTests() {
  console.log('\n=== Testing utils.js ===\n');

  let passed = 0;
  let failed = 0;

  // Platform detection tests
  console.log('Platform Detection:');

  if (test('isWindows/isMacOS/isLinux are booleans', () => {
    assert.strictEqual(typeof utils.isWindows, 'boolean');
    assert.strictEqual(typeof utils.isMacOS, 'boolean');
    assert.strictEqual(typeof utils.isLinux, 'boolean');
  })) passed++; else failed++;

  if (test('exactly one platform should be true', () => {
    const platforms = [utils.isWindows, utils.isMacOS, utils.isLinux];
    const trueCount = platforms.filter(p => p).length;
    // Note: Could be 0 on other platforms like FreeBSD
    assert.ok(trueCount <= 1, 'More than one platform is true');
  })) passed++; else failed++;

  // Directory functions tests
  console.log('\nDirectory Functions:');

  if (test('getHomeDir returns valid path', () => {
    const home = utils.getHomeDir();
    assert.strictEqual(typeof home, 'string');
    assert.ok(home.length > 0, 'Home dir should not be empty');
    assert.ok(fs.existsSync(home), 'Home dir should exist');
  })) passed++; else failed++;

  if (test('getClaudeDir returns path under home', () => {
    const claudeDir = utils.getClaudeDir();
    const homeDir = utils.getHomeDir();
    assert.ok(claudeDir.startsWith(homeDir), 'Claude dir should be under home');
    assert.ok(claudeDir.includes('.claude'), 'Should contain .claude');
  })) passed++; else failed++;

  if (test('getSessionsDir returns path under Claude dir', () => {
    const sessionsDir = utils.getSessionsDir();
    const claudeDir = utils.getClaudeDir();
    assert.ok(sessionsDir.startsWith(claudeDir), 'Sessions should be under Claude dir');
    assert.ok(sessionsDir.includes('sessions'), 'Should contain sessions');
  })) passed++; else failed++;

  if (test('getTempDir returns valid temp directory', () => {
    const tempDir = utils.getTempDir();
    assert.strictEqual(typeof tempDir, 'string');
    assert.ok(tempDir.length > 0, 'Temp dir should not be empty');
  })) passed++; else failed++;

  if (test('ensureDir creates directory', () => {
    const testDir = path.join(utils.getTempDir(), `utils-test-${Date.now()}`);
    try {
      utils.ensureDir(testDir);
      assert.ok(fs.existsSync(testDir), 'Directory should be created');
    } finally {
      fs.rmSync(testDir, { recursive: true, force: true });
    }
  })) passed++; else failed++;

  // Date/Time functions tests
  console.log('\nDate/Time Functions:');

  if (test('getDateString returns YYYY-MM-DD format', () => {
    const date = utils.getDateString();
    assert.ok(/^\d{4}-\d{2}-\d{2}$/.test(date), `Expected YYYY-MM-DD, got ${date}`);
  })) passed++; else failed++;

  if (test('getTimeString returns HH:MM format', () => {
    const time = utils.getTimeString();
    assert.ok(/^\d{2}:\d{2}$/.test(time), `Expected HH:MM, got ${time}`);
  })) passed++; else failed++;

  if (test('getDateTimeString returns full datetime format', () => {
    const dt = utils.getDateTimeString();
    assert.ok(/^\d{4}-\d{2}-\d{2} \d{2}:\d{2}:\d{2}$/.test(dt), `Expected YYYY-MM-DD HH:MM:SS, got ${dt}`);
  })) passed++; else failed++;

  // Project name tests
  console.log('\nProject Name Functions:');

  if (test('getGitRepoName returns string or null', () => {
    const repoName = utils.getGitRepoName();
    assert.ok(repoName === null || typeof repoName === 'string');
  })) passed++; else failed++;

  if (test('getProjectName returns non-empty string', () => {
    const name = utils.getProjectName();
    assert.ok(name && name.length > 0);
  })) passed++; else failed++;

  // Session ID tests
  console.log('\nSession ID Functions:');

  if (test('getSessionIdShort falls back to project name', () => {
    const original = process.env.CLAUDE_SESSION_ID;
    delete process.env.CLAUDE_SESSION_ID;
    try {
      const shortId = utils.getSessionIdShort();
      assert.strictEqual(shortId, utils.getProjectName());
    } finally {
      if (original) process.env.CLAUDE_SESSION_ID = original;
    }
  })) passed++; else failed++;

  if (test('getSessionIdShort returns last 8 characters', () => {
    const original = process.env.CLAUDE_SESSION_ID;
    process.env.CLAUDE_SESSION_ID = 'test-session-abc12345';
    try {
      assert.strictEqual(utils.getSessionIdShort(), 'abc12345');
    } finally {
      if (original) process.env.CLAUDE_SESSION_ID = original;
      else delete process.env.CLAUDE_SESSION_ID;
    }
  })) passed++; else failed++;

  if (test('getSessionIdShort handles short session IDs', () => {
    const original = process.env.CLAUDE_SESSION_ID;
    process.env.CLAUDE_SESSION_ID = 'short';
    try {
      assert.strictEqual(utils.getSessionIdShort(), 'short');
    } finally {
      if (original) process.env.CLAUDE_SESSION_ID = original;
      else delete process.env.CLAUDE_SESSION_ID;
    }
  })) passed++; else failed++;

  // File operations tests
  console.log('\nFile Operations:');

  if (test('readFile returns null for non-existent file', () => {
    const content = utils.readFile('/non/existent/file/path.txt');
    assert.strictEqual(content, null);
  })) passed++; else failed++;

  if (test('writeFile and readFile work together', () => {
    const testFile = path.join(utils.getTempDir(), `utils-test-${Date.now()}.txt`);
    const testContent = 'Hello, World!';
    try {
      utils.writeFile(testFile, testContent);
      const read = utils.readFile(testFile);
      assert.strictEqual(read, testContent);
    } finally {
      fs.unlinkSync(testFile);
    }
  })) passed++; else failed++;

  if (test('appendFile adds content to file', () => {
    const testFile = path.join(utils.getTempDir(), `utils-test-${Date.now()}.txt`);
    try {
      utils.writeFile(testFile, 'Line 1\n');
      utils.appendFile(testFile, 'Line 2\n');
      const content = utils.readFile(testFile);
      assert.strictEqual(content, 'Line 1\nLine 2\n');
    } finally {
      fs.unlinkSync(testFile);
    }
  })) passed++; else failed++;

  if (test('replaceInFile replaces text', () => {
    const testFile = path.join(utils.getTempDir(), `utils-test-${Date.now()}.txt`);
    try {
      utils.writeFile(testFile, 'Hello, World!');
      utils.replaceInFile(testFile, /World/, 'Universe');
      const content = utils.readFile(testFile);
      assert.strictEqual(content, 'Hello, Universe!');
    } finally {
      fs.unlinkSync(testFile);
    }
  })) passed++; else failed++;

  if (test('countInFile counts occurrences', () => {
    const testFile = path.join(utils.getTempDir(), `utils-test-${Date.now()}.txt`);
    try {
      utils.writeFile(testFile, 'foo bar foo baz foo');
      const count = utils.countInFile(testFile, /foo/g);
      assert.strictEqual(count, 3);
    } finally {
      fs.unlinkSync(testFile);
    }
  })) passed++; else failed++;

  if (test('grepFile finds matching lines', () => {
    const testFile = path.join(utils.getTempDir(), `utils-test-${Date.now()}.txt`);
    try {
      utils.writeFile(testFile, 'line 1 foo\nline 2 bar\nline 3 foo');
      const matches = utils.grepFile(testFile, /foo/);
      assert.strictEqual(matches.length, 2);
      assert.strictEqual(matches[0].lineNumber, 1);
      assert.strictEqual(matches[1].lineNumber, 3);
    } finally {
      fs.unlinkSync(testFile);
    }
  })) passed++; else failed++;

  // findFiles tests
  console.log('\nfindFiles:');

  if (test('findFiles returns empty for non-existent directory', () => {
    const results = utils.findFiles('/non/existent/dir', '*.txt');
    assert.strictEqual(results.length, 0);
  })) passed++; else failed++;

  if (test('findFiles finds matching files', () => {
    const testDir = path.join(utils.getTempDir(), `utils-test-${Date.now()}`);
    try {
      fs.mkdirSync(testDir);
      fs.writeFileSync(path.join(testDir, 'test1.txt'), 'content');
      fs.writeFileSync(path.join(testDir, 'test2.txt'), 'content');
      fs.writeFileSync(path.join(testDir, 'test.md'), 'content');

      const txtFiles = utils.findFiles(testDir, '*.txt');
      assert.strictEqual(txtFiles.length, 2);

      const mdFiles = utils.findFiles(testDir, '*.md');
      assert.strictEqual(mdFiles.length, 1);
    } finally {
      fs.rmSync(testDir, { recursive: true });
    }
  })) passed++; else failed++;

  // System functions tests
  console.log('\nSystem Functions:');

  if (test('commandExists finds node', () => {
    const exists = utils.commandExists('node');
    assert.strictEqual(exists, true);
  })) passed++; else failed++;

  if (test('commandExists returns false for fake command', () => {
    const exists = utils.commandExists('nonexistent_command_12345');
    assert.strictEqual(exists, false);
  })) passed++; else failed++;

  if (test('runCommand executes simple command', () => {
    const result = utils.runCommand('node --version');
    assert.strictEqual(result.success, true);
    assert.ok(result.output.startsWith('v'), 'Should start with v');
  })) passed++; else failed++;

  if (test('runCommand handles failed command', () => {
    const result = utils.runCommand('node --invalid-flag-12345');
    assert.strictEqual(result.success, false);
  })) passed++; else failed++;

  // Summary
  console.log('\n=== Test Results ===');
  console.log(`Passed: ${passed}`);
  console.log(`Failed: ${failed}`);
  console.log(`Total:  ${passed + failed}\n`);

  process.exit(failed > 0 ? 1 : 0);
}

runTests();
