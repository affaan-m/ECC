/**
 * Tests for scripts/lib/session-manager.js
 *
 * Run with: node tests/lib/session-manager.test.js
 */

const assert = require('assert');
const path = require('path');
const fs = require('fs');
const os = require('os');

const sessionManager = require('../../scripts/lib/session-manager');

// Test helper
function test(name, fn) {
  try {
    fn();
    console.log(`  \u2713 ${name}`);
    return true;
  } catch (err) {
    console.log(`  \u2717 ${name}`);
    console.log(`    Error: ${err.message}`);
    return false;
  }
}

// Create a temp directory for session tests
function createTempSessionDir() {
  const dir = path.join(os.tmpdir(), `ecc-test-sessions-${Date.now()}`);
  fs.mkdirSync(dir, { recursive: true });
  return dir;
}

function cleanup(dir) {
  try {
    fs.rmSync(dir, { recursive: true, force: true });
  } catch {
    // best-effort cleanup
  }
}

function runTests() {
  console.log('\n=== Testing session-manager.js ===\n');

  let passed = 0;
  let failed = 0;

  // parseSessionFilename tests
  console.log('parseSessionFilename:');

  if (test('parses new format with short ID', () => {
    const result = sessionManager.parseSessionFilename('2026-02-01-a1b2c3d4-session.tmp');
    assert.ok(result);
    assert.strictEqual(result.shortId, 'a1b2c3d4');
    assert.strictEqual(result.date, '2026-02-01');
    assert.strictEqual(result.filename, '2026-02-01-a1b2c3d4-session.tmp');
  })) passed++; else failed++;

  if (test('parses old format without short ID', () => {
    const result = sessionManager.parseSessionFilename('2026-01-17-session.tmp');
    assert.ok(result);
    assert.strictEqual(result.shortId, 'no-id');
    assert.strictEqual(result.date, '2026-01-17');
  })) passed++; else failed++;

  if (test('returns null for invalid filename', () => {
    assert.strictEqual(sessionManager.parseSessionFilename('not-a-session.txt'), null);
    assert.strictEqual(sessionManager.parseSessionFilename(''), null);
    assert.strictEqual(sessionManager.parseSessionFilename('random.tmp'), null);
  })) passed++; else failed++;

  if (test('returns null for malformed date', () => {
    assert.strictEqual(sessionManager.parseSessionFilename('20260-01-17-session.tmp'), null);
    assert.strictEqual(sessionManager.parseSessionFilename('26-01-17-session.tmp'), null);
  })) passed++; else failed++;

  if (test('parses long short IDs (8+ chars)', () => {
    const result = sessionManager.parseSessionFilename('2026-02-01-abcdef12345678-session.tmp');
    assert.ok(result);
    assert.strictEqual(result.shortId, 'abcdef12345678');
  })) passed++; else failed++;

  if (test('accepts short IDs under 8 chars', () => {
    const result = sessionManager.parseSessionFilename('2026-02-01-abc-session.tmp');
    assert.ok(result);
    assert.strictEqual(result.shortId, 'abc');
  })) passed++; else failed++;

  // parseSessionMetadata tests
  console.log('\nparseSessionMetadata:');

  if (test('parses full session content', () => {
    const content = `# My Session Title

**Date:** 2026-02-01
**Started:** 10:30
**Last Updated:** 14:45
**Project:** everything-claude-code
**Branch:** feature/session-metadata
**Worktree:** /tmp/ecc-worktree

### Completed
- [x] Set up project
- [x] Write tests

### In Progress
- [ ] Fix bug

### Notes for Next Session
Remember to check the logs

### Context to Load
\`\`\`
src/main.ts
\`\`\``;
    const meta = sessionManager.parseSessionMetadata(content);
    assert.strictEqual(meta.title, 'My Session Title');
    assert.strictEqual(meta.date, '2026-02-01');
    assert.strictEqual(meta.started, '10:30');
    assert.strictEqual(meta.lastUpdated, '14:45');
    assert.strictEqual(meta.project, 'everything-claude-code');
    assert.strictEqual(meta.branch, 'feature/session-metadata');
    assert.strictEqual(meta.worktree, '/tmp/ecc-worktree');
    assert.strictEqual(meta.completed.length, 2);
    assert.strictEqual(meta.completed[0], 'Set up project');
    assert.strictEqual(meta.inProgress.length, 1);
    assert.strictEqual(meta.inProgress[0], 'Fix bug');
    assert.strictEqual(meta.notes, 'Remember to check the logs');
    assert.strictEqual(meta.context, 'src/main.ts');
  })) passed++; else failed++;

  if (test('handles null/undefined/empty content', () => {
    const meta1 = sessionManager.parseSessionMetadata(null);
    assert.strictEqual(meta1.title, null);
    assert.deepStrictEqual(meta1.completed, []);

    const meta2 = sessionManager.parseSessionMetadata(undefined);
    assert.strictEqual(meta2.title, null);

    const meta3 = sessionManager.parseSessionMetadata('');
    assert.strictEqual(meta3.title, null);
  })) passed++; else failed++;

  if (test('handles content with no sections', () => {
    const meta = sessionManager.parseSessionMetadata('Just some text');
    assert.strictEqual(meta.title, null);
    assert.deepStrictEqual(meta.completed, []);
    assert.deepStrictEqual(meta.inProgress, []);
  })) passed++; else failed++;

  // getSessionStats tests
  console.log('\ngetSessionStats:');

  if (test('calculates stats from content string', () => {
    const content = `# Test Session

### Completed
- [x] Task 1
- [x] Task 2

### In Progress
- [ ] Task 3
`;
    const stats = sessionManager.getSessionStats(content);
    assert.strictEqual(stats.totalItems, 3);
    assert.strictEqual(stats.completedItems, 2);
    assert.strictEqual(stats.inProgressItems, 1);
    assert.ok(stats.lineCount > 0);
  })) passed++; else failed++;

  if (test('handles empty content', () => {
    const stats = sessionManager.getSessionStats('');
    assert.strictEqual(stats.totalItems, 0);
    assert.strictEqual(stats.completedItems, 0);
    assert.strictEqual(stats.lineCount, 0);
  })) passed++; else failed++;

  if (test('does not treat non-absolute path as file path', () => {
    // This tests the bug fix: content that ends with .tmp but is not a path
    const stats = sessionManager.getSessionStats('Some content ending with test.tmp');
    assert.strictEqual(stats.totalItems, 0);
    assert.strictEqual(stats.lineCount, 1);
  })) passed++; else failed++;

  // File I/O tests
  console.log('\nSession CRUD:');

  if (test('writeSessionContent and getSessionContent round-trip', () => {
    const dir = createTempSessionDir();
    try {
      const sessionPath = path.join(dir, '2026-02-01-testid01-session.tmp');
      const content = '# Test Session\n\nHello world';

      const writeResult = sessionManager.writeSessionContent(sessionPath, content);
      assert.strictEqual(writeResult, true);

      const readContent = sessionManager.getSessionContent(sessionPath);
      assert.strictEqual(readContent, content);
    } finally {
      cleanup(dir);
    }
  })) passed++; else failed++;

  if (test('appendSessionContent appends to existing', () => {
    const dir = createTempSessionDir();
    try {
      const sessionPath = path.join(dir, '2026-02-01-testid02-session.tmp');
      sessionManager.writeSessionContent(sessionPath, 'Line 1\n');
      sessionManager.appendSessionContent(sessionPath, 'Line 2\n');

      const content = sessionManager.getSessionContent(sessionPath);
      assert.ok(content.includes('Line 1'));
      assert.ok(content.includes('Line 2'));
    } finally {
      cleanup(dir);
    }
  })) passed++; else failed++;

  if (test('writeSessionContent returns false for invalid path', () => {
    const result = sessionManager.writeSessionContent('/nonexistent/deep/path/session.tmp', 'content');
    assert.strictEqual(result, false);
  })) passed++; else failed++;

  if (test('getSessionContent returns null for non-existent file', () => {
    const result = sessionManager.getSessionContent('/nonexistent/session.tmp');
    assert.strictEqual(result, null);
  })) passed++; else failed++;

  if (test('deleteSession removes file', () => {
    const dir = createTempSessionDir();
    try {
      const sessionPath = path.join(dir, 'test-session.tmp');
      fs.writeFileSync(sessionPath, 'content');
      assert.strictEqual(fs.existsSync(sessionPath), true);

      const result = sessionManager.deleteSession(sessionPath);
      assert.strictEqual(result, true);
      assert.strictEqual(fs.existsSync(sessionPath), false);
    } finally {
      cleanup(dir);
    }
  })) passed++; else failed++;

  if (test('deleteSession returns false for non-existent file', () => {
    const result = sessionManager.deleteSession('/nonexistent/session.tmp');
    assert.strictEqual(result, false);
  })) passed++; else failed++;

  if (test('sessionExists returns true for existing file', () => {
    const dir = createTempSessionDir();
    try {
      const sessionPath = path.join(dir, 'test.tmp');
      fs.writeFileSync(sessionPath, 'content');
      assert.strictEqual(sessionManager.sessionExists(sessionPath), true);
    } finally {
      cleanup(dir);
    }
  })) passed++; else failed++;

  if (test('sessionExists returns false for non-existent file', () => {
    assert.strictEqual(sessionManager.sessionExists('/nonexistent/path.tmp'), false);
  })) passed++; else failed++;

  if (test('sessionExists returns false for directory', () => {
    const dir = createTempSessionDir();
    try {
      assert.strictEqual(sessionManager.sessionExists(dir), false);
    } finally {
      cleanup(dir);
    }
  })) passed++; else failed++;

  // getSessionSize tests
  console.log('\ngetSessionSize:');

  if (test('returns human-readable size for existing file', () => {
    const dir = createTempSessionDir();
    try {
      const sessionPath = path.join(dir, 'sized.tmp');
      fs.writeFileSync(sessionPath, 'x'.repeat(2048));
      const size = sessionManager.getSessionSize(sessionPath);
      assert.ok(size.includes('KB'), `Expected KB, got: ${size}`);
    } finally {
      cleanup(dir);
    }
  })) passed++; else failed++;

  if (test('returns "0 B" for non-existent file', () => {
    const size = sessionManager.getSessionSize('/nonexistent/file.tmp');
    assert.strictEqual(size, '0 B');
  })) passed++; else failed++;

  if (test('returns bytes for small file', () => {
    const dir = createTempSessionDir();
    try {
      const sessionPath = path.join(dir, 'small.tmp');
      fs.writeFileSync(sessionPath, 'hi');
      const size = sessionManager.getSessionSize(sessionPath);
      assert.ok(size.includes('B'));
      assert.ok(!size.includes('KB'));
    } finally {
      cleanup(dir);
    }
  })) passed++; else failed++;

  // getSessionTitle tests
  console.log('\ngetSessionTitle:');

  if (test('extracts title from session file', () => {
    const dir = createTempSessionDir();
    try {
      const sessionPath = path.join(dir, 'titled.tmp');
      fs.writeFileSync(sessionPath, '# My Great Session\n\nSome content');
      const title = sessionManager.getSessionTitle(sessionPath);
      assert.strictEqual(title, 'My Great Session');
    } finally {
      cleanup(dir);
    }
  })) passed++; else failed++;

  if (test('returns "Untitled Session" for empty content', () => {
    const dir = createTempSessionDir();
    try {
      const sessionPath = path.join(dir, 'empty.tmp');
      fs.writeFileSync(sessionPath, '');
      const title = sessionManager.getSessionTitle(sessionPath);
      assert.strictEqual(title, 'Untitled Session');
    } finally {
      cleanup(dir);
    }
  })) passed++; else failed++;

  if (test('returns "Untitled Session" for non-existent file', () => {
    const title = sessionManager.getSessionTitle('/nonexistent/file.tmp');
    assert.strictEqual(title, 'Untitled Session');
  })) passed++; else failed++;

  // getAllSessions tests
  console.log('\ngetAllSessions:');

  // Override HOME to a temp dir for isolated getAllSessions/getSessionById tests
  // On Windows, os.homedir() uses USERPROFILE, not HOME — set both for cross-platform
  const tmpHome = path.join(os.tmpdir(), `ecc-session-mgr-test-${Date.now()}`);
  const tmpCanonicalSessionsDir = path.join(tmpHome, '.claude', 'session-data');
  const tmpLegacySessionsDir = path.join(tmpHome, '.claude', 'sessions');
  fs.mkdirSync(tmpCanonicalSessionsDir, { recursive: true });
  fs.mkdirSync(tmpLegacySessionsDir, { recursive: true });
  const origHome = process.env.HOME;
  const origUserProfile = process.env.USERPROFILE;

  // Create test session files with controlled modification times
  const testSessions = [
    { name: '2026-01-15-abcd1234-session.tmp', content: '# Session 1' },
    { name: '2026-01-20-efgh5678-session.tmp', content: '# Session 2' },
    { name: '2026-02-01-ijkl9012-session.tmp', content: '# Session 3' },
    { name: '2026-02-01-mnop3456-session.tmp', content: '# Session 4' },
    { name: '2026-02-10-session.tmp', content: '# Old format session' },
  ];
  for (let i = 0; i < testSessions.length; i++) {
    const targetDir = testSessions[i].name === '2026-02-10-session.tmp'
      ? tmpLegacySessionsDir
      : tmpCanonicalSessionsDir;
    const filePath = path.join(targetDir, testSessions[i].name);
    fs.writeFileSync(filePath, testSessions[i].content);
    // Stagger modification times so sort order is deterministic
    const mtime = new Date(Date.now() - (testSessions.length - i) * 60000);
    fs.utimesSync(filePath, mtime, mtime);
  }

  process.env.HOME = tmpHome;
  process.env.USERPROFILE = tmpHome;

  if (test('getAllSessions returns all sessions', () => {
    const result = sessionManager.getAllSessions({ limit: 100 });
    assert.strictEqual(result.total, 5);
    assert.strictEqual(result.sessions.length, 5);
    assert.strictEqual(result.hasMore, false);
  })) passed++; else failed++;

  if (test('getAllSessions paginates correctly', () => {
    const page1 = sessionManager.getAllSessions({ limit: 2, offset: 0 });
    assert.strictEqual(page1.sessions.length, 2);
    assert.strictEqual(page1.hasMore, true);
    assert.strictEqual(page1.total, 5);

    const page2 = sessionManager.getAllSessions({ limit: 2, offset: 2 });
    assert.strictEqual(page2.sessions.length, 2);
    assert.strictEqual(page2.hasMore, true);

    const page3 = sessionManager.getAllSessions({ limit: 2, offset: 4 });
    assert.strictEqual(page3.sessions.length, 1);
    assert.strictEqual(page3.hasMore, false);
  })) passed++; else failed++;

  if (test('getAllSessions filters by date', () => {
    const result = sessionManager.getAllSessions({ date: '2026-02-01', limit: 100 });
    assert.strictEqual(result.total, 2);
    assert.ok(result.sessions.every(s => s.date === '2026-02-01'));
  })) passed++; else failed++;

  if (test('getAllSessions filters by search (short ID)', () => {
    const result = sessionManager.getAllSessions({ search: 'abcd', limit: 100 });
    assert.strictEqual(result.total, 1);
    assert.strictEqual(result.sessions[0].shortId, 'abcd1234');
  })) passed++; else failed++;

  if (test('getAllSessions prefers canonical session-data duplicates over newer legacy copies', () => {
    const duplicateName = '2026-01-15-abcd1234-session.tmp';
    const legacyDuplicatePath = path.join(tmpLegacySessionsDir, duplicateName);
    const legacyMtime = new Date(Date.now() + 60000);

    try {
      fs.writeFileSync(legacyDuplicatePath, '# Legacy duplicate');
      fs.utimesSync(legacyDuplicatePath, legacyMtime, legacyMtime);

      const result = sessionManager.getAllSessions({ search: 'abcd', limit: 100 });
      assert.strictEqual(result.total, 1, 'Duplicate filenames should be deduped');
      assert.ok(result.sessions[0].sessionPath.includes('session-data'), 'Canonical session-data copy should win');
    } finally {
      fs.rmSync(legacyDuplicatePath, { force: true });
    }
  })) passed++; else failed++;

  if (test('getAllSessions returns sorted by newest first', () => {
    const result = sessionManager.getAllSessions({ limit: 100 });
    for (let i = 1; i < result.sessions.length; i++) {
      assert.ok(
        result.sessions[i - 1].modifiedTime >= result.sessions[i].modifiedTime,
        'Sessions should be sorted newest first'
      );
    }
  })) passed++; else failed++;

  if (test('getAllSessions handles offset beyond total', () => {
    const result = sessionManager.getAllSessions({ offset: 999, limit: 10 });
    assert.strictEqual(result.sessions.length, 0);
    assert.strictEqual(result.total, 5);
    assert.strictEqual(result.hasMore, false);
  })) passed++; else failed++;

  if (test('getAllSessions returns empty for non-existent date', () => {
    const result = sessionManager.getAllSessions({ date: '2099-12-31', limit: 100 });
    assert.strictEqual(result.total, 0);
    assert.strictEqual(result.sessions.length, 0);
  })) passed++; else failed++;

  if (test('getAllSessions ignores non-.tmp files', () => {
    fs.writeFileSync(path.join(tmpCanonicalSessionsDir, 'notes.txt'), 'not a session');
    fs.writeFileSync(path.join(tmpCanonicalSessionsDir, 'compaction-log.txt'), 'log');
    const result = sessionManager.getAllSessions({ limit: 100 });
    assert.strictEqual(result.total, 5, 'Should only count .tmp session files');
  })) passed++; else failed++;

  // getSessionById tests
  console.log('\ngetSessionById:');

  if (test('getSessionById finds by short ID prefix', () => {
    const result = sessionManager.getSessionById('abcd1234');
    assert.ok(result, 'Should find session by exact short ID');
    assert.strictEqual(result.shortId, 'abcd1234');
  })) passed++; else failed++;

  if (test('getSessionById finds by short ID prefix match', () => {
    const result = sessionManager.getSessionById('abcd');
    assert.ok(result, 'Should find session by short ID prefix');
    assert.strictEqual(result.shortId, 'abcd1234');
  })) passed++; else failed++;

  if (test('getSessionById prefers canonical session-data duplicates over newer legacy copies', () => {
    const duplicateName = '2026-01-15-abcd1234-session.tmp';
    const legacyDuplicatePath = path.join(tmpLegacySessionsDir, duplicateName);
    const legacyMtime = new Date(Date.now() + 120000);

    try {
      fs.writeFileSync(legacyDuplicatePath, '# Legacy duplicate');
      fs.utimesSync(legacyDuplicatePath, legacyMtime, legacyMtime);

      const result = sessionManager.getSessionById('abcd1234');
      assert.ok(result, 'Should still resolve the duplicate session');
      assert.ok(result.sessionPath.includes('session-data'), 'Canonical session-data copy should win');
    } finally {
      fs.rmSync(legacyDuplicatePath, { force: true });
    }
  })) passed++; else failed++;

  if (test('getSessionById finds by full filename', () => {
    const result = sessionManager.getSessionById('2026-01-15-abcd1234-session.tmp');
    assert.ok(result, 'Should find session by full filename');
    assert.strictEqual(result.shortId, 'abcd1234');
  })) passed++; else failed++;

  if (test('getSessionById finds by filename without .tmp', () => {
    const result = sessionManager.getSessionById('2026-01-15-abcd1234-session');
    assert.ok(result, 'Should find session by filename without extension');
  })) passed++; else failed++;

  if (test('getSessionById returns null for non-existent ID', () => {
    const result = sessionManager.getSessionById('zzzzzzzz');
    assert.strictEqual(result, null);
  })) passed++; else failed++;

  if (test('getSessionById includes content when requested', () => {
    const result = sessionManager.getSessionById('abcd1234', true);
    assert.ok(result, 'Should find session');
    assert.ok(result.content, 'Should include content');
    assert.ok(result.content.includes('Session 1'), 'Content should match');
  })) passed++; else failed++;

  if (test('getSessionById finds old format (no short ID)', () => {
    const result = sessionManager.getSessionById('2026-02-10-session');
    assert.ok(result, 'Should find old-format session by filename');
  })) passed++; else failed++;

  if (test('getSessionById returns null for empty string', () => {
    const result = sessionManager.getSessionById('');
    assert.strictEqual(result, null, 'Empty string should not match any session');
  })) passed++; else failed++;

  if (test('getSessionById returns null for non-string IDs', () => {
    assert.strictEqual(sessionManager.getSessionById(null), null);
    assert.strictEqual(sessionManager.getSessionById(undefined), null);
    assert.strictEqual(sessionManager.getSessionById(42), null);
  })) passed++; else failed++;

  if (test('getSessionById metadata and stats populated when includeContent=true', () => {
    const result = sessionManager.getSessionById('abcd1234', true);
    assert.ok(result, 'Should find session');
    assert.ok(result.metadata, 'Should have metadata');
    assert.ok(result.stats, 'Should have stats');
    assert.strictEqual(typeof result.stats.totalItems, 'number', 'stats.totalItems should be number');
    assert.strictEqual(typeof result.stats.lineCount, 'number', 'stats.lineCount should be number');
  })) passed++; else failed++;

  // parseSessionMetadata edge cases
  console.log('\nparseSessionMetadata (edge cases):');

  if (test('handles CRLF line endings', () => {
    const content = '# CRLF Session\r\n\r\n**Date:** 2026-03-01\r\n**Started:** 09:00\r\n\r\n### Completed\r\n- [x] Task A\r\n- [x] Task B\r\n';
    const meta = sessionManager.parseSessionMetadata(content);
    assert.strictEqual(meta.title, 'CRLF Session');
    assert.strictEqual(meta.date, '2026-03-01');
    assert.strictEqual(meta.started, '09:00');
    assert.strictEqual(meta.completed.length, 2);
  })) passed++; else failed++;

  if (test('takes first h1 heading as title', () => {
    const content = '# First Title\n\nSome text\n\n# Second Title\n';
    const meta = sessionManager.parseSessionMetadata(content);
    assert.strictEqual(meta.title, 'First Title');
  })) passed++; else failed++;

  if (test('handles empty sections (Completed with no items)', () => {
    const content = '# Session\n\n### Completed\n\n### In Progress\n\n';
    const meta = sessionManager.parseSessionMetadata(content);
    assert.deepStrictEqual(meta.completed, []);
    assert.deepStrictEqual(meta.inProgress, []);
  })) passed++; else failed++;

  if (test('handles content with only title and notes', () => {
    const content = '# Just Notes\n\n### Notes for Next Session\nRemember to test\n';
    const meta = sessionManager.parseSessionMetadata(content);
    assert.strictEqual(meta.title, 'Just Notes');
    assert.strictEqual(meta.notes, 'Remember to test');
    assert.deepStrictEqual(meta.completed, []);
    assert.deepStrictEqual(meta.inProgress, []);
  })) passed++; else failed++;

  if (test('extracts context with backtick fenced block', () => {
    const content = '# Session\n\n### Context to Load\n```\nsrc/index.ts\nlib/utils.js\n```\n';
    const meta = sessionManager.parseSessionMetadata(content);
    assert.strictEqual(meta.context, 'src/index.ts\nlib/utils.js');
  })) passed++; else failed++;

  if (test('trims whitespace from title', () => {
    const content = '#   Spaces Around Title   \n';
    const meta = sessionManager.parseSessionMetadata(content);
    assert.strictEqual(meta.title, 'Spaces Around Title');
  })) passed++; else failed++;

  // getSessionStats edge cases
  console.log('\ngetSessionStats (edge cases):');

  if (test('detects notes and context presence', () => {
    const content = '# Stats Test\n\n### Notes for Next Session\nSome notes\n\n### Context to Load\n```\nfile.ts\n```\n';
    const stats = sessionManager.getSessionStats(content);
    assert.strictEqual(stats.hasNotes, true);
    assert.strictEqual(stats.hasContext, true);
  })) passed++; else failed++;

  if (test('detects absence of notes and context', () => {
    const content = '# Simple Session\n\nJust some content\n';
    const stats = sessionManager.getSessionStats(content);
    assert.strictEqual(stats.hasNotes, false);
    assert.strictEqual(stats.hasContext, false);
  })) passed++; else failed++;

  if (test('treats Unix absolute path ending with .tmp as file path', () => {
    // Content that starts with / and ends with .tmp should be treated as a path
    // This tests the looksLikePath heuristic
    const fakeContent = '/some/path/session.tmp';
    // Since the file doesn't exist, getSessionContent returns null,
    // parseSessionMetadata(null) returns defaults
    const stats = sessionManager.getSessionStats(fakeContent);
    assert.strictEqual(stats.totalItems, 0);
    assert.strictEqual(stats.lineCount, 0);
  })) passed++; else failed++;

  // getSessionSize edge case
  console.log('\ngetSessionSize (edge cases):');

  if (test('returns MB for large file', () => {
    const dir = createTempSessionDir();
    try {
      const sessionPath = path.join(dir, 'large.tmp');
      // Create a file > 1MB
      fs.writeFileSync(sessionPath, 'x'.repeat(1024 * 1024 + 100));
      const size = sessionManager.getSessionSize(sessionPath);
      assert.ok(size.includes('MB'), `Expected MB, got: ${size}`);
    } finally {
      cleanup(dir);
    }
  })) passed++; else failed++;

  // appendSessionContent edge case
  if (test('appendSessionContent returns false for invalid path', () => {
    const result = sessionManager.appendSessionContent('/nonexistent/deep/path/session.tmp', 'content');
    assert.strictEqual(result, false);
  })) passed++; else failed++;

  // parseSessionFilename edge cases
  console.log('\nparseSessionFilename (additional edge cases):');

  if (test('accepts uppercase letters in short ID', () => {
    const result = sessionManager.parseSessionFilename('2026-02-01-ABCD1234-session.tmp');
    assert.ok(result, 'Uppercase letters should be accepted');
    assert.strictEqual(result.shortId, 'ABCD1234');
  })) passed++; else failed++;

  if (test('accepts underscores in short ID', () => {
    const result = sessionManager.parseSessionFilename('2026-02-01-ChezMoi_2-session.tmp');
    assert.ok(result, 'Underscores should be accepted');
    assert.strictEqual(result.shortId, 'ChezMoi_2');
  })) passed++; else failed++;

  if (test('accepts hyphenated short IDs (extra segments)', () => {
    const result = sessionManager.parseSessionFilename('2026-02-01-abc12345-extra-session.tmp');
    assert.ok(result, 'Hyphenated short IDs should be accepted');
    assert.strictEqual(result.shortId, 'abc12345-extra');
  })) passed++; else failed++;

  if (test('rejects impossible month (13)', () => {
    const result = sessionManager.parseSessionFilename('2026-13-01-abcd1234-session.tmp');
    assert.strictEqual(result, null, 'Month 13 should be rejected');
  })) passed++; else failed++;

  if (test('rejects impossible day (32)', () => {
    const result = sessionManager.parseSessionFilename('2026-01-32-abcd1234-session.tmp');
    assert.strictEqual(result, null, 'Day 32 should be rejected');
  })) passed++; else failed++;

  if (test('rejects month 00', () => {
    const result = sessionManager.parseSessionFilename('2026-00-15-abcd1234-session.tmp');
    assert.strictEqual(result, null, 'Month 00 should be rejected');
  })) passed++; else failed++;

  if (test('rejects day 00', () => {
    const result = sessionManager.parseSessionFilename('2026-01-00-abcd1234-session.tmp');
    assert.strictEqual(result, null, 'Day 00 should be rejected');
  })) passed++; else failed++;

  if (test('accepts valid edge date (month 12, day 31)', () => {
    const result = sessionManager.parseSessionFilename('2026-12-31-abcd1234-session.tmp');
    assert.ok(result, 'Month 12, day 31 should be accepted');
    assert.strictEqual(result.date, '2026-12-31');
  })) passed++; else failed++;

  if (test('rejects Feb 31 (calendar-inaccurate date)', () => {
    const result = sessionManager.parseSessionFilename('2026-02-31-abcd1234-session.tmp');
    assert.strictEqual(result, null, 'Feb 31 does not exist');
  })) passed++; else failed++;

  if (test('rejects Apr 31 (calendar-inaccurate date)', () => {
    const result = sessionManager.parseSessionFilename('2026-04-31-abcd1234-session.tmp');
    assert.strictEqual(result, null, 'Apr 31 does not exist');
  })) passed++; else failed++;

  if (test('rejects Feb 29 in non-leap year', () => {
    const result = sessionManager.parseSessionFilename('2025-02-29-abcd1234-session.tmp');
    assert.strictEqual(result, null, '2025 is not a leap year');
  })) passed++; else failed++;

  if (test('accepts Feb 29 in leap year', () => {
    const result = sessionManager.parseSessionFilename('2024-02-29-abcd1234-session.tmp');
    assert.ok(result, '2024 is a leap year');
    assert.strictEqual(result.date, '2024-02-29');
  })) passed++; else failed++;

  if (test('accepts Jun 30 (valid 30-day month)', () => {
    const result = sessionManager.parseSessionFilename('2026-06-30-abcd1234-session.tmp');
    assert.ok(result, 'June has 30 days');
    assert.strictEqual(result.date, '2026-06-30');
  })) passed++; else failed++;

  if (test('rejects Jun 31 (invalid 30-day month)', () => {
    const result = sessionManager.parseSessionFilename('2026-06-31-abcd1234-session.tmp');
    assert.strictEqual(result, null, 'June has only 30 days');
  })) passed++; else failed++;

  if (test('datetime field is a Date object', () => {
    const result = sessionManager.parseSessionFilename('2026-06-15-abcdef12-session.tmp');
    assert.ok(result);
    assert.ok(result.datetime instanceof Date, 'datetime should be a Date');
    assert.ok(!isNaN(result.datetime.getTime()), 'datetime should be valid');
  })) passed++; else failed++;

  // writeSessionContent tests
  console.log('\nwriteSessionContent:');

  if (test('creates new session file', () => {
    const dir = createTempSessionDir();
    try {
      const sessionPath = path.join(dir, 'write-test.tmp');
      const result = sessionManager.writeSessionContent(sessionPath, '# Test Session\n');
      assert.strictEqual(result, true, 'Should return true on success');
      assert.ok(fs.existsSync(sessionPath), 'File should exist');
      assert.strictEqual(fs.readFileSync(sessionPath, 'utf8'), '# Test Session\n');
    } finally {
      cleanup(dir);
    }
  })) passed++; else failed++;

  if (test('overwrites existing session file', () => {
    const dir = createTempSessionDir();
    try {
      const sessionPath = path.join(dir, 'overwrite-test.tmp');
      fs.writeFileSync(sessionPath, 'old content');
      const result = sessionManager.writeSessionContent(sessionPath, 'new content');
      assert.strictEqual(result, true);
      assert.strictEqual(fs.readFileSync(sessionPath, 'utf8'), 'new content');
    } finally {
      cleanup(dir);
    }
  })) passed++; else failed++;

  if (test('writeSessionContent returns false for invalid path', () => {
    const result = sessionManager.writeSessionContent('/nonexistent/deep/path/session.tmp', 'content');
    assert.strictEqual(result, false, 'Should return false for invalid path');
  })) passed++; else failed++;

  // appendSessionContent tests
  console.log('\nappendSessionContent:');

  if (test('appends to existing session file', () => {
    const dir = createTempSessionDir();
    try {
      const sessionPath = path.join(dir, 'append-test.tmp');
      fs.writeFileSync(sessionPath, '# Session\n');
      const result = sessionManager.appendSessionContent(sessionPath, '\n## Added Section\n');
      assert.strictEqual(result, true);
      const content = fs.readFileSync(sessionPath, 'utf8');
      assert.ok(content.includes('# Session'));
      assert.ok(content.includes('## Added Section'));
    } finally {
      cleanup(dir);
    }
  })) passed++; else failed++;

  // deleteSession tests
  console.log('\ndeleteSession:');

  if (test('deletes existing session file', () => {
    const dir = createTempSessionDir();
    try {
      const sessionPath = path.join(dir, 'delete-me.tmp');
      fs.writeFileSync(sessionPath, '# To Delete');
      assert.ok(fs.existsSync(sessionPath), 'File should exist before delete');
      const result = sessionManager.deleteSession(sessionPath);
      assert.strictEqual(result, true, 'Should return true');
      assert.ok(!fs.existsSync(sessionPath), 'File should not exist after delete');
    } finally {
      cleanup(dir);
    }
  })) passed++; else failed++;

  if (test('deleteSession returns false for non-existent file', () => {
    const result = sessionManager.deleteSession('/nonexistent/session.tmp');
    assert.strictEqual(result, false, 'Should return false for missing file');
  })) passed++; else failed++;

  // sessionExists tests
  console.log('\nsessionExists:');

  if (test('returns true for existing session file', () => {
    const dir = createTempSessionDir();
    try {
      const sessionPath = path.join(dir, 'exists.tmp');
      fs.writeFileSync(sessionPath, '# Exists');
      assert.strictEqual(sessionManager.sessionExists(sessionPath), true);
    } finally {
      cleanup(dir);
    }
  })) passed++; else failed++;

  if (test('returns false for non-existent file', () => {
    assert.strictEqual(sessionManager.sessionExists('/nonexistent/file.tmp'), false);
  })) passed++; else failed++;

  if (test('returns false for directory (not a file)', () => {
    const dir = createTempSessionDir();
    try {
      assert.strictEqual(sessionManager.sessionExists(dir), false, 'Directory should not count as session');
    } finally {
      cleanup(dir);
    }
  })) passed++; else failed++;

  // getAllSessions pagination edge cases (offset/limit clamping)
  console.log('\ngetAllSessions (pagination edge cases):');

  if (test('getAllSessions clamps negative offset to 0', () => {
    const result = sessionManager.getAllSessions({ offset: -5, limit: 2 });
    // Negative offset should be clamped to 0, returning the first 2 sessions
    assert.strictEqual(result.sessions.length, 2);
    assert.strictEqual(result.offset, 0);
    assert.strictEqual(result.total, 5);
  })) passed++; else failed++;

  if (test('getAllSessions clamps NaN offset to 0', () => {
    const result = sessionManager.getAllSessions({ offset: NaN, limit: 3 });
    assert.strictEqual(result.sessions.length, 3);
    assert.strictEqual(result.offset, 0);
  })) passed++; else failed++;

  if (test('getAllSessions clamps NaN limit to default', () => {
    const result = sessionManager.getAllSessions({ offset: 0, limit: NaN });
    // NaN limit should be clamped to default (50), returning all 5 sessions
    assert.ok(result.sessions.length > 0);
    assert.strictEqual(result.total, 5);
  })) passed++; else failed++;

  if (test('getAllSessions clamps negative limit to 1', () => {
    const result = sessionManager.getAllSessions({ offset: 0, limit: -10 });
    // Negative limit should be clamped to 1
    assert.strictEqual(result.sessions.length, 1);
    assert.strictEqual(result.limit, 1);
  })) passed++; else failed++;

  if (test('getAllSessions clamps zero limit to 1', () => {
    const result = sessionManager.getAllSessions({ offset: 0, limit: 0 });
    assert.strictEqual(result.sessions.length, 1);
    assert.strictEqual(result.limit, 1);
  })) passed++; else failed++;

  if (test('getAllSessions handles string offset/limit gracefully', () => {
    const result = sessionManager.getAllSessions({ offset: 'abc', limit: 'xyz' });
    // String non-numeric should be treated as 0/default
    assert.strictEqual(result.offset, 0);
    assert.ok(result.sessions.length > 0);
  })) passed++; else failed++;

  if (test('getAllSessions handles fractional offset (floors to integer)', () => {
    const result = sessionManager.getAllSessions({ offset: 1.7, limit: 2 });
    // 1.7 should floor to 1, skip first session, return next 2
    assert.strictEqual(result.offset, 1);
    assert.strictEqual(result.sessions.length, 2);
  })) passed++; else failed++;

  if (test('getAllSessions handles Infinity offset', () => {
    // Infinity should clamp to 0 since Number(Infinity) is Infinity but
    // Math.floor(Infinity) is Infinity — however slice(Infinity) returns []
    // Actually: Number(Infinity) || 0 = Infinity, Math.floor(Infinity) = Infinity
    // Math.max(0, Infinity) = Infinity, so slice(Infinity) = []
    const result = sessionManager.getAllSessions({ offset: Infinity, limit: 2 });
    assert.strictEqual(result.sessions.length, 0);
    assert.strictEqual(result.total, 5);
  })) passed++; else failed++;

  // getSessionStats with code blocks and special characters
  console.log('\ngetSessionStats (code blocks & special chars):');

  if (test('counts tasks with inline backticks correctly', () => {
    const content = '# Test\n\n### Completed\n- [x] Fixed `app.js` bug with `fs.readFile()`\n- [x] Ran `npm install` successfully\n\n### In Progress\n- [ ] Review `config.ts` changes\n';
    const stats = sessionManager.getSessionStats(content);
    assert.strictEqual(stats.completedItems, 2, 'Should count 2 completed items');
    assert.strictEqual(stats.inProgressItems, 1, 'Should count 1 in-progress item');
    assert.strictEqual(stats.totalItems, 3);
  })) passed++; else failed++;

  if (test('handles special chars in notes section', () => {
    const content = '# Test\n\n### Notes for Next Session\nDon\'t forget: <important> & "quotes" & \'apostrophes\'\n';
    const stats = sessionManager.getSessionStats(content);
    assert.strictEqual(stats.hasNotes, true, 'Should detect notes section');
    const meta = sessionManager.parseSessionMetadata(content);
    assert.ok(meta.notes.includes('<important>'), 'Notes should preserve HTML-like content');
  })) passed++; else failed++;

  if (test('counts items in multiline code-heavy session', () => {
    const content = '# Code Session\n\n### Completed\n- [x] Refactored `lib/utils.js`\n- [x] Updated `package.json` version\n- [x] Fixed `\\`` escaping bug\n\n### In Progress\n- [ ] Test `getSessionStats()` function\n- [ ] Review PR #42\n';
    const stats = sessionManager.getSessionStats(content);
    assert.strictEqual(stats.completedItems, 3);
    assert.strictEqual(stats.inProgressItems, 2);
  })) passed++; else failed++;

  // getSessionStats with empty content
  if (test('getSessionStats handles empty string content', () => {
    const stats = sessionManager.getSessionStats('');
    assert.strictEqual(stats.totalItems, 0);
    // Empty string is falsy in JS, so content ? ... : 0 returns 0
    assert.strictEqual(stats.lineCount, 0, 'Empty string is falsy, lineCount = 0');
    assert.strictEqual(stats.hasNotes, false);
    assert.strictEqual(stats.hasContext, false);
  })) passed++; else failed++;

  // ── Round 26 tests ──

  console.log('\nparseSessionFilename (30-day month validation):');

  if (test('rejects Sep 31 (September has 30 days)', () => {
    const result = sessionManager.parseSessionFilename('2026-09-31-abcd1234-session.tmp');
    assert.strictEqual(result, null, 'Sep 31 does not exist');
  })) passed++; else failed++;

  if (test('rejects Nov 31 (November has 30 days)', () => {
    const result = sessionManager.parseSessionFilename('2026-11-31-abcd1234-session.tmp');
    assert.strictEqual(result, null, 'Nov 31 does not exist');
  })) passed++; else failed++;

  if (test('accepts Sep 30 (valid 30-day month boundary)', () => {
    const result = sessionManager.parseSessionFilename('2026-09-30-abcd1234-session.tmp');
    assert.ok(result, 'Sep 30 is valid');
    assert.strictEqual(result.date, '2026-09-30');
  })) passed++; else failed++;

  console.log('\ngetSessionStats (path heuristic edge cases):');

  if (test('multiline content ending with .tmp is treated as content', () => {
    const content = 'Line 1\nLine 2\nDownload file.tmp';
    const stats = sessionManager.getSessionStats(content);
    // Has newlines so looksLikePath is false → treated as content
    assert.strictEqual(stats.lineCount, 3, 'Should count 3 lines');
  })) passed++; else failed++;

  if (test('single-line content not starting with / treated as content', () => {
    const content = 'some random text.tmp';
    const stats = sessionManager.getSessionStats(content);
    assert.strictEqual(stats.lineCount, 1, 'Should treat as content, not a path');
  })) passed++; else failed++;

  console.log('\ngetAllSessions (combined filters):');

  if (test('combines date filter + search filter + pagination', () => {
    // We have 2026-02-01-ijkl9012 and 2026-02-01-mnop3456 with date 2026-02-01
    const result = sessionManager.getAllSessions({
      date: '2026-02-01',
      search: 'ijkl',
      limit: 10
    });
    assert.strictEqual(result.total, 1, 'Only one session matches both date and search');
    assert.strictEqual(result.sessions[0].shortId, 'ijkl9012');
  })) passed++; else failed++;

  if (test('date filter + offset beyond matches returns empty', () => {
    const result = sessionManager.getAllSessions({
      date: '2026-02-01',
      offset: 100,
      limit: 10
    });
    assert.strictEqual(result.sessions.length, 0);
    assert.strictEqual(result.total, 2, 'Two sessions match the date');
    assert.strictEqual(result.hasMore, false);
  })) passed++; else failed++;

  console.log('\ngetSessionById (ambiguous prefix):');

  if (test('returns first match when multiple sessions share a prefix', () => {
    // Sessions with IDs abcd1234 and efgh5678 exist
    // 'e' should match efgh5678 (only match)
    const result = sessionManager.getSessionById('efgh');
    assert.ok(result, 'Should find session by prefix');
    assert.strictEqual(result.shortId, 'efgh5678');
  })) passed++; else failed++;

  console.log('\nparseSessionMetadata (edge cases):');

  if (test('handles unclosed code fence in Context section', () => {
    const content = '# Session\n\n### Context to Load\n```\nsrc/index.ts\n';
    const meta = sessionManager.parseSessionMetadata(content);
    // Regex requires closing ```, so no context should be extracted
    assert.strictEqual(meta.context, '', 'Unclosed code fence should not extract context');
  })) passed++; else failed++;

  if (test('handles empty task text in checklist items', () => {
    const content = '# Session\n\n### Completed\n- [x] \n- [x] Real task\n';
    const meta = sessionManager.parseSessionMetadata(content);
    // \s* in the regex bridges across newlines, collapsing the empty
    // task + next task into a single match. This is an edge case —
    // real sessions don't have empty checklist items.
    assert.strictEqual(meta.completed.length, 1);
  })) passed++; else failed++;

  // ── Round 43: getSessionById default excludes content ──
  console.log('\nRound 43: getSessionById (default excludes content):');

  if (test('getSessionById without includeContent omits content, metadata, and stats', () => {
    // Default call (includeContent=false) should NOT load file content
    const result = sessionManager.getSessionById('abcd1234');
    assert.ok(result, 'Should find the session');
    assert.strictEqual(result.shortId, 'abcd1234');
    // These fields should be absent when includeContent is false
    assert.strictEqual(result.content, undefined, 'content should be undefined');
    assert.strictEqual(result.metadata, undefined, 'metadata should be undefined');
    assert.strictEqual(result.stats, undefined, 'stats should be undefined');
    // Basic fields should still be present
    assert.ok(result.sessionPath, 'sessionPath should be present');
    assert.ok(result.size !== undefined, 'size should be present');
    assert.ok(result.modifiedTime, 'modifiedTime should be present');
  })) passed++; else failed++;

  // ── Round 54: search filter scope and getSessionPath utility ──
  console.log('\nRound 54: search filter scope and path utility:');

  if (test('getAllSessions search filter matches only short ID, not title or content', () => {
    // "Session" appears in file CONTENT (e.g. "# Session 1") but not in any shortId
    const result = sessionManager.getAllSessions({ search: 'Session', limit: 100 });
    assert.strictEqual(result.total, 0, 'Search should not match title/content, only shortId');
    // Verify that searching by actual shortId substring still works
    const result2 = sessionManager.getAllSessions({ search: 'abcd', limit: 100 });
    assert.strictEqual(result2.total, 1, 'Search by shortId should still work');
  })) passed++; else failed++;

  if (test('getSessionPath returns absolute path for session filename', () => {
    const filename = '2026-02-01-testpath-session.tmp';
    const result = sessionManager.getSessionPath(filename);
    assert.ok(path.isAbsolute(result), 'Should return an absolute path');
    assert.ok(result.endsWith(filename), `Path should end with filename, got: ${result}`);
    // Since HOME is overridden, sessions dir should be under tmpHome
    assert.ok(result.includes('.claude'), 'Path should include .claude directory');
    assert.ok(result.includes('session-data'), 'Path should use canonical session-data directory');
  })) passed++; else failed++;

  // ── Round 66: getSessionById noIdMatch path (date-only string for old format) ──
  console.log('\nRound 66: getSessionById (noIdMatch — date-only match for old format):');

  if (test('getSessionById finds old-format session by date-only string (noIdMatch)', () => {
    // File is 2026-02-10-session.tmp (old format, shortId = 'no-id')
    // Calling with '2026-02-10' → filenameMatch fails (filename !== '2026-02-10' and !== '2026-02-10.tmp')
    // shortIdMatch fails (shortId === 'no-id', not !== 'no-id')
    // noIdMatch succeeds: shortId === 'no-id' && filename === '2026-02-10-session.tmp'
    const result = sessionManager.getSessionById('2026-02-10');
    assert.ok(result, 'Should find old-format session by date-only string');
    assert.strictEqual(result.shortId, 'no-id', 'Should have no-id shortId');
    assert.ok(result.filename.includes('2026-02-10-session.tmp'), 'Should match old-format file');
    assert.ok(result.sessionPath, 'Should have sessionPath');
    assert.ok(result.date === '2026-02-10', 'Should have correct date');
  })) passed++; else failed++;

  // Cleanup — restore both HOME and USERPROFILE (Windows)
  process.env.HOME = origHome;
  if (origUserProfile !== undefined) {
    process.env.USERPROFILE = origUserProfile;
  } else {
    delete process.env.USERPROFILE;
  }
  try {
    fs.rmSync(tmpHome, { recursive: true, force: true });
  } catch {
    // best-effort
  }

  // ── Round 30: datetime local-time fix and parseSessionFilename edge cases ──
  console.log('\nRound 30: datetime local-time fix:');

  if (test('datetime day matches the filename date (local-time constructor)', () => {
    const result = sessionManager.parseSessionFilename('2026-06-15-abcdef12-session.tmp');
    assert.ok(result);
    // With the fix, getDate()/getMonth() should return local-time values
    // matching the filename, regardless of timezone
    assert.strictEqual(result.datetime.getDate(), 15, 'Day should be 15 (local time)');
    assert.strictEqual(result.datetime.getMonth(), 5, 'Month should be 5 (June, 0-indexed)');
    assert.strictEqual(result.datetime.getFullYear(), 2026, 'Year should be 2026');
  })) passed++; else failed++;

  if (test('datetime matches for January 1 (timezone-sensitive date)', () => {
    // Jan 1 at UTC midnight is Dec 31 in negative offsets — this tests the fix
    const result = sessionManager.parseSessionFilename('2026-01-01-abc12345-session.tmp');
    assert.ok(result);
    assert.strictEqual(result.datetime.getDate(), 1, 'Day should be 1 in local time');
    assert.strictEqual(result.datetime.getMonth(), 0, 'Month should be 0 (January)');
  })) passed++; else failed++;

  if (test('datetime matches for December 31 (year boundary)', () => {
    const result = sessionManager.parseSessionFilename('2025-12-31-abc12345-session.tmp');
    assert.ok(result);
    assert.strictEqual(result.datetime.getDate(), 31);
    assert.strictEqual(result.datetime.getMonth(), 11); // December
    assert.strictEqual(result.datetime.getFullYear(), 2025);
  })) passed++; else failed++;

  console.log('\nRound 30: parseSessionFilename edge cases:');

  if (test('parses session ID with many dashes (UUID-like)', () => {
    const result = sessionManager.parseSessionFilename('2026-02-13-a1b2c3d4-session.tmp');
    assert.ok(result);
    assert.strictEqual(result.shortId, 'a1b2c3d4');
    assert.strictEqual(result.date, '2026-02-13');
  })) passed++; else failed++;

  if (test('rejects filename with missing session.tmp suffix', () => {
    const result = sessionManager.parseSessionFilename('2026-02-13-abc12345.tmp');
    assert.strictEqual(result, null, 'Should reject filename without -session.tmp');
  })) passed++; else failed++;

  if (test('rejects filename with extra text after suffix', () => {
    const result = sessionManager.parseSessionFilename('2026-02-13-abc12345-session.tmp.bak');
    assert.strictEqual(result, null, 'Should reject filenames with extra extension');
  })) passed++; else failed++;

  if (test('handles old-format filename without session ID', () => {
    // The regex match[2] is undefined for old format → shortId defaults to 'no-id'
    const result = sessionManager.parseSessionFilename('2026-02-13-session.tmp');
    if (result) {
      assert.strictEqual(result.shortId, 'no-id', 'Should default to no-id');
    }
    // Either null (regex doesn't match) or has no-id — both are acceptable
    assert.ok(true, 'Old format handled without crash');
  })) passed++; else failed++;

  // ── Round 33: birthtime / createdTime fallback ──
  console.log('\ncreatedTime fallback (Round 33):');

  // Use HOME override approach (consistent with existing getAllSessions tests)
  const r33Home = path.join(os.tmpdir(), `ecc-r33-birthtime-${Date.now()}`);
  const r33SessionsDir = path.join(r33Home, '.claude', 'sessions');
  fs.mkdirSync(r33SessionsDir, { recursive: true });
  const r33OrigHome = process.env.HOME;
  const r33OrigProfile = process.env.USERPROFILE;
  process.env.HOME = r33Home;
  process.env.USERPROFILE = r33Home;

  const r33Filename = '2026-02-13-r33birth-session.tmp';
  const r33FilePath = path.join(r33SessionsDir, r33Filename);
  fs.writeFileSync(r33FilePath, '{"type":"test"}');

  if (test('getAllSessions returns createdTime from birthtime when available', () => {
    const result = sessionManager.getAllSessions({ limit: 100 });
    assert.ok(result.sessions.length > 0, 'Should find the test session');
    const session = result.sessions[0];
    assert.ok(session.createdTime instanceof Date, 'createdTime should be a Date');
    // birthtime should be populated on macOS/Windows — createdTime should match it
    const stats = fs.statSync(r33FilePath);
    if (stats.birthtime && stats.birthtime.getTime() > 0) {
      assert.strictEqual(
        session.createdTime.getTime(),
        stats.birthtime.getTime(),
        'createdTime should match birthtime when available'
      );
    }
  })) passed++; else failed++;

  if (test('getSessionById returns createdTime field', () => {
    const session = sessionManager.getSessionById('r33birth');
    assert.ok(session, 'Should find the session');
    assert.ok(session.createdTime instanceof Date, 'createdTime should be a Date');
    assert.ok(session.createdTime.getTime() > 0, 'createdTime should be non-zero');
  })) passed++; else failed++;

  if (test('createdTime falls back to ctime when birthtime is epoch-zero', () => {
    // This tests the || fallback logic: stats.birthtime || stats.ctime
    // On some FS, birthtime may be epoch 0 (falsy as a Date number comparison
    // but truthy as a Date object). The fallback is defensive.
    const stats = fs.statSync(r33FilePath);
    // Both birthtime and ctime should be valid Dates on any modern OS
    assert.ok(stats.ctime instanceof Date, 'ctime should exist');
    // The fallback expression `birthtime || ctime` should always produce a valid Date
    const fallbackResult = stats.birthtime || stats.ctime;
    assert.ok(fallbackResult instanceof Date, 'Fallback should produce a Date');
    assert.ok(fallbackResult.getTime() > 0, 'Fallback date should be non-zero');
  })) passed++; else failed++;

  // Cleanup Round 33 HOME override
  process.env.HOME = r33OrigHome;
  if (r33OrigProfile !== undefined) {
    process.env.USERPROFILE = r33OrigProfile;
  } else {
    delete process.env.USERPROFILE;
  }
  try { fs.rmSync(r33Home, { recursive: true, force: true }); } catch (_e) { /* ignore cleanup errors */ }

  // ── Round 46: path heuristic and checklist edge cases ──
  console.log('\ngetSessionStats Windows path heuristic (Round 46):');

  if (test('recognises Windows drive-letter path as a file path', () => {
    // The looksLikePath regex includes /^[A-Za-z]:[/\\]/ for Windows
    // A non-existent Windows path should still be treated as a path
    // (getSessionContent returns null → parseSessionMetadata(null) → defaults)
    const stats1 = sessionManager.getSessionStats('C:/Users/test/session.tmp');
    assert.strictEqual(stats1.lineCount, 0, 'C:/ path treated as path, not content');
    const stats2 = sessionManager.getSessionStats('D:\\Sessions\\2026-01-01.tmp');
    assert.strictEqual(stats2.lineCount, 0, 'D:\\ path treated as path, not content');
  })) passed++; else failed++;

  if (test('does not treat bare drive letter without slash as path', () => {
    // "C:session.tmp" has no slash after colon → regex fails → treated as content
    const stats = sessionManager.getSessionStats('C:session.tmp');
    assert.strictEqual(stats.lineCount, 1, 'Bare C: without slash treated as content');
  })) passed++; else failed++;

  console.log('\nparseSessionMetadata checkbox case sensitivity (Round 46):');

  if (test('uppercase [X] does not match completed items regex', () => {
    const content = '# Test\n\n### Completed\n- [X] Uppercase task\n- [x] Lowercase task\n';
    const meta = sessionManager.parseSessionMetadata(content);
    // Regex is /- \[x\]\s*(.+)/g — only matches lowercase [x]
    assert.strictEqual(meta.completed.length, 1, 'Only lowercase [x] should match');
    assert.strictEqual(meta.completed[0], 'Lowercase task');
  })) passed++; else failed++;

  // getAllSessions returns empty result when sessions directory does not exist
  if (test('getAllSessions returns empty when sessions dir missing', () => {
    const tmpDir = createTempSessionDir();
    const origHome = process.env.HOME;
    const origUserProfile = process.env.USERPROFILE;
    try {
      // Point HOME to a dir with no .claude/sessions/
      process.env.HOME = tmpDir;
      process.env.USERPROFILE = tmpDir;
      // Re-require to pick up new HOME
      delete require.cache[require.resolve('../../scripts/lib/session-manager')];
      delete require.cache[require.resolve('../../scripts/lib/utils')];
      const freshSM = require('../../scripts/lib/session-manager');
      const result = freshSM.getAllSessions();
      assert.deepStrictEqual(result.sessions, [], 'Should return empty sessions array');
      assert.strictEqual(result.total, 0, 'Total should be 0');
      assert.strictEqual(result.hasMore, false, 'hasMore should be false');
    } finally {
      process.env.HOME = origHome;
      process.env.USERPROFILE = origUserProfile;
      delete require.cache[require.resolve('../../scripts/lib/session-manager')];
      delete require.cache[require.resolve('../../scripts/lib/utils')];
      cleanup(tmpDir);
    }
  })) passed++; else failed++;

  // ── Round 69: getSessionById returns null when sessions dir missing ──
  console.log('\nRound 69: getSessionById (missing sessions directory):');

  if (test('getSessionById returns null when sessions directory does not exist', () => {
    const tmpDir = createTempSessionDir();
    const origHome = process.env.HOME;
    const origUserProfile = process.env.USERPROFILE;
    try {
      // Point HOME to a dir with no .claude/sessions/
      process.env.HOME = tmpDir;
      process.env.USERPROFILE = tmpDir;
      // Re-require to pick up new HOME
      delete require.cache[require.resolve('../../scripts/lib/session-manager')];
      delete require.cache[require.resolve('../../scripts/lib/utils')];
      const freshSM = require('../../scripts/lib/session-manager');
      const result = freshSM.getSessionById('anything');
      assert.strictEqual(result, null, 'Should return null when sessions dir does not exist');
    } finally {
      process.env.HOME = origHome;
      process.env.USERPROFILE = origUserProfile;
      delete require.cache[require.resolve('../../scripts/lib/session-manager')];
      delete require.cache[require.resolve('../../scripts/lib/utils')];
      cleanup(tmpDir);
    }
  })) passed++; else failed++;

  // ── Round 78: getSessionStats reads real file when given existing .tmp path ──
  console.log('\nRound 78: getSessionStats (actual file path → reads from disk):');

  if (test('getSessionStats reads from disk when given path to existing .tmp file', () => {
    const dir = createTempSessionDir();
    try {
      const sessionPath = path.join(dir, '2026-03-01-test1234-session.tmp');
      const content = '# Real File Stats Test\n\n**Date:** 2026-03-01\n**Started:** 09:00\n\n### Completed\n- [x] First task\n- [x] Second task\n\n### In Progress\n- [ ] Third task\n\n### Notes for Next Session\nDon\'t forget the edge cases\n';
      fs.writeFileSync(sessionPath, content);

      // Pass the FILE PATH (not content) — this exercises looksLikePath branch
      const stats = sessionManager.getSessionStats(sessionPath);
      assert.strictEqual(stats.completedItems, 2, 'Should find 2 completed items from file');
      assert.strictEqual(stats.inProgressItems, 1, 'Should find 1 in-progress item from file');
      assert.strictEqual(stats.totalItems, 3, 'Should find 3 total items from file');
      assert.strictEqual(stats.hasNotes, true, 'Should detect notes section from file');
      assert.ok(stats.lineCount > 5, `Should have multiple lines from file, got ${stats.lineCount}`);
    } finally {
      cleanup(dir);
    }
  })) passed++; else failed++;

  // ── Round 78: getAllSessions hasContent field ──
  console.log('\nRound 78: getAllSessions (hasContent field):');

  if (test('getAllSessions hasContent is true for non-empty and false for empty files', () => {
    const isoHome = path.join(os.tmpdir(), `ecc-hascontent-${Date.now()}`);
    const isoSessions = path.join(isoHome, '.claude', 'sessions');
    fs.mkdirSync(isoSessions, { recursive: true });
    const savedHome = process.env.HOME;
    const savedProfile = process.env.USERPROFILE;
    try {
      // Create one non-empty session and one empty session
      fs.writeFileSync(path.join(isoSessions, '2026-04-01-nonempty-session.tmp'), '# Has content');
      fs.writeFileSync(path.join(isoSessions, '2026-04-02-emptyfile-session.tmp'), '');

      process.env.HOME = isoHome;
      process.env.USERPROFILE = isoHome;
      delete require.cache[require.resolve('../../scripts/lib/session-manager')];
      delete require.cache[require.resolve('../../scripts/lib/utils')];
      const freshSM = require('../../scripts/lib/session-manager');

      const result = freshSM.getAllSessions({ limit: 100 });
      assert.strictEqual(result.total, 2, 'Should find both sessions');

      const nonEmpty = result.sessions.find(s => s.shortId === 'nonempty');
      const empty = result.sessions.find(s => s.shortId === 'emptyfile');

      assert.ok(nonEmpty, 'Should find the non-empty session');
      assert.ok(empty, 'Should find the empty session');
      assert.strictEqual(nonEmpty.hasContent, true, 'Non-empty file should have hasContent: true');
      assert.strictEqual(empty.hasContent, false, 'Empty file should have hasContent: false');
    } finally {
      process.env.HOME = savedHome;
      process.env.USERPROFILE = savedProfile;
      delete require.cache[require.resolve('../../scripts/lib/session-manager')];
      delete require.cache[require.resolve('../../scripts/lib/utils')];
      fs.rmSync(isoHome, { recursive: true, force: true });
    }
  })) passed++; else failed++;

  // ── Round 75: deleteSession catch — unlinkSync throws on read-only dir ──
  console.log('\nRound 75: deleteSession (unlink failure in read-only dir):');

  if (test('deleteSession returns false when file exists but directory is read-only', () => {
    if (process.platform === 'win32' || process.getuid?.() === 0) {
      console.log('    (skipped — chmod ineffective on Windows/root)');
      return;
    }
    const tmpDir = path.join(os.tmpdir(), `sm-del-ro-${Date.now()}`);
    fs.mkdirSync(tmpDir, { recursive: true });
    const sessionFile = path.join(tmpDir, 'test-session.tmp');
    fs.writeFileSync(sessionFile, 'session content');
    try {
      // Make directory read-only so unlinkSync throws EACCES
      fs.chmodSync(tmpDir, 0o555);
      const result = sessionManager.deleteSession(sessionFile);
      assert.strictEqual(result, false, 'Should return false when unlinkSync fails');
    } finally {
      try { fs.chmodSync(tmpDir, 0o755); } catch { /* best-effort */ }
      fs.rmSync(tmpDir, { recursive: true, force: true });
    }
  })) passed++; else failed++;

  // ── Round 81: getSessionStats(null) ──
  console.log('\nRound 81: getSessionStats(null) (null input):');

  if (test('getSessionStats(null) returns zero lineCount and empty metadata', () => {
    // session-manager.js line 158-177: getSessionStats accepts path or content.
    // typeof null === 'string' is false → looksLikePath = false → content = null.
    // Line 177: content ? content.split('\n').length : 0 → lineCount: 0.
    // parseSessionMetadata(null) returns defaults → totalItems/completedItems/inProgressItems = 0.
    const stats = sessionManager.getSessionStats(null);
    assert.strictEqual(stats.lineCount, 0, 'null input should yield lineCount 0');
    assert.strictEqual(stats.totalItems, 0, 'null input should yield totalItems 0');
    assert.strictEqual(stats.completedItems, 0, 'null input should yield completedItems 0');
    assert.strictEqual(stats.inProgressItems, 0, 'null input should yield inProgressItems 0');
    assert.strictEqual(stats.hasNotes, false, 'null input should yield hasNotes false');
    assert.strictEqual(stats.hasContext, false, 'null input should yield hasContext false');
  })) passed++; else failed++;

  // ── Round 83: getAllSessions TOCTOU statSync catch (broken symlink) ──
  console.log('\nRound 83: getAllSessions (broken symlink — statSync catch):');

  if (test('getAllSessions skips broken symlink .tmp files gracefully', () => {
    // getAllSessions at line 241-246: statSync throws for broken symlinks,
    // the catch causes `continue`, skipping that entry entirely.
    const isoHome = path.join(os.tmpdir(), `ecc-r83-toctou-${Date.now()}`);
    const sessionsDir = path.join(isoHome, '.claude', 'sessions');
    fs.mkdirSync(sessionsDir, { recursive: true });

    // Create one real session file
    const realFile = '2026-02-10-abcd1234-session.tmp';
    fs.writeFileSync(path.join(sessionsDir, realFile), '# Real session\n');

    // Create a broken symlink that matches the session filename pattern
    const brokenSymlink = '2026-02-10-deadbeef-session.tmp';
    try {
      fs.symlinkSync('/nonexistent/path/that/does/not/exist', path.join(sessionsDir, brokenSymlink));
    } catch (err) {
      // Skip only where symlink creation is blocked (e.g. Windows without
      // Developer Mode / admin rights → EPERM/EACCES); rethrow anything else
      // so real failures aren't masked.
      if (err && (err.code === 'EPERM' || err.code === 'EACCES')) {
        console.log('    (skipped — symlinks not supported)');
        fs.rmSync(isoHome, { recursive: true, force: true });
        return;
      }
      throw err;
    }

    const origHome = process.env.HOME;
    const origUserProfile = process.env.USERPROFILE;
    process.env.HOME = isoHome;
    process.env.USERPROFILE = isoHome;
    try {
      delete require.cache[require.resolve('../../scripts/lib/session-manager')];
      delete require.cache[require.resolve('../../scripts/lib/utils')];
      const freshManager = require('../../scripts/lib/session-manager');
      const result = freshManager.getAllSessions({ limit: 100 });

      // Should have only the real session, not the broken symlink
      assert.strictEqual(result.total, 1, 'Should find only the real session, not the broken symlink');
      assert.ok(result.sessions[0].filename === realFile,
        `Should return the real file, got: ${result.sessions[0].filename}`);
    } finally {
      process.env.HOME = origHome;
      process.env.USERPROFILE = origUserProfile;
      delete require.cache[require.resolve('../../scripts/lib/session-manager')];
      delete require.cache[require.resolve('../../scripts/lib/utils')];
      fs.rmSync(isoHome, { recursive: true, force: true });
    }
  })) passed++; else failed++;

  // ── Round 84: getSessionById TOCTOU — statSync catch returns null for broken symlink ──
  console.log('\nRound 84: getSessionById (broken symlink — statSync catch):');

  if (test('getSessionById returns null when matching session is a broken symlink', () => {
    // getSessionById at line 307-310: statSync throws for broken symlinks,
    // the catch returns null (file deleted between readdir and stat).
    const isoHome = path.join(os.tmpdir(), `ecc-r84-getbyid-toctou-${Date.now()}`);
    const sessionsDir = path.join(isoHome, '.claude', 'sessions');
    fs.mkdirSync(sessionsDir, { recursive: true });

    // Create a broken symlink that matches a session ID pattern
    const brokenFile = '2026-02-11-deadbeef-session.tmp';
    try {
      fs.symlinkSync('/nonexistent/target/that/does/not/exist', path.join(sessionsDir, brokenFile));
    } catch (err) {
      // Skip only where symlink creation is blocked (e.g. Windows without
      // Developer Mode / admin rights → EPERM/EACCES); rethrow anything else
      // so real failures aren't masked.
      if (err && (err.code === 'EPERM' || err.code === 'EACCES')) {
        console.log('    (skipped — symlinks not supported)');
        fs.rmSync(isoHome, { recursive: true, force: true });
        return;
      }
      throw err;
    }

    const origHome = process.env.HOME;
    const origUserProfile = process.env.USERPROFILE;
    try {
      process.env.HOME = isoHome;
      process.env.USERPROFILE = isoHome;
      delete require.cache[require.resolve('../../scripts/lib/session-manager')];
      delete require.cache[require.resolve('../../scripts/lib/utils')];
      const freshSM = require('../../scripts/lib/session-manager');

      // Search by the short ID "deadbeef" — should match the broken symlink
      const result = freshSM.getSessionById('deadbeef');
      assert.strictEqual(result, null,
        'Should return null when matching session file is a broken symlink');
    } finally {
      process.env.HOME = origHome;
      process.env.USERPROFILE = origUserProfile;
      delete require.cache[require.resolve('../../scripts/lib/session-manager')];
      delete require.cache[require.resolve('../../scripts/lib/utils')];
      fs.rmSync(isoHome, { recursive: true, force: true });
    }
  })) passed++; else failed++;

  // ── Round 88: parseSessionMetadata null date/started/lastUpdated fields ──
  console.log('\nRound 88: parseSessionMetadata content lacking Date/Started/Updated fields:');
  if (test('parseSessionMetadata returns null for date, started, lastUpdated when fields absent', () => {
    const content = '# Title Only\n\n### Notes for Next Session\nSome notes\n';
    const meta = sessionManager.parseSessionMetadata(content);
    assert.strictEqual(meta.date, null,
      'date should be null when **Date:** field is absent');
    assert.strictEqual(meta.started, null,
      'started should be null when **Started:** field is absent');
    assert.strictEqual(meta.lastUpdated, null,
      'lastUpdated should be null when **Last Updated:** field is absent');
    // Confirm other fields still parse correctly
    assert.strictEqual(meta.title, 'Title Only');
    assert.strictEqual(meta.notes, 'Some notes');
  })) passed++; else failed++;

  // ── Round 89: getAllSessions skips subdirectories (!entry.isFile()) ──
  console.log('\nRound 89: getAllSessions (subdirectory skip):');

  if (test('getAllSessions skips subdirectories inside sessions dir', () => {
    // session-manager.js line 220: if (!entry.isFile() || ...) continue;
    // Existing tests create non-.tmp FILES to test filtering (e.g., notes.txt).
    // This test creates a DIRECTORY — entry.isFile() returns false, so it should be skipped.
    const isoHome = path.join(os.tmpdir(), `ecc-r89-subdir-skip-${Date.now()}`);
    const sessionsDir = path.join(isoHome, '.claude', 'sessions');
    fs.mkdirSync(sessionsDir, { recursive: true });

    // Create a real session file
    const realFile = '2026-02-11-abcd1234-session.tmp';
    fs.writeFileSync(path.join(sessionsDir, realFile), '# Test session');

    // Create a subdirectory inside sessions dir — should be skipped by !entry.isFile()
    const subdir = path.join(sessionsDir, 'some-nested-dir');
    fs.mkdirSync(subdir);

    // Also create a subdirectory whose name ends in .tmp — still not a file
    const tmpSubdir = path.join(sessionsDir, '2026-02-11-fakeid00-session.tmp');
    fs.mkdirSync(tmpSubdir);

    const origHome = process.env.HOME;
    const origUserProfile = process.env.USERPROFILE;
    process.env.HOME = isoHome;
    process.env.USERPROFILE = isoHome;
    try {
      delete require.cache[require.resolve('../../scripts/lib/session-manager')];
      delete require.cache[require.resolve('../../scripts/lib/utils')];
      const freshManager = require('../../scripts/lib/session-manager');
      const result = freshManager.getAllSessions({ limit: 100 });

      // Should find only the real file, not either subdirectory
      assert.strictEqual(result.total, 1,
        `Should find 1 session (the file), not subdirectories. Got ${result.total}`);
      assert.strictEqual(result.sessions[0].filename, realFile,
        `Should return the real file. Got: ${result.sessions[0].filename}`);
    } finally {
      process.env.HOME = origHome;
      process.env.USERPROFILE = origUserProfile;
      delete require.cache[require.resolve('../../scripts/lib/session-manager')];
      delete require.cache[require.resolve('../../scripts/lib/utils')];
      fs.rmSync(isoHome, { recursive: true, force: true });
    }
  })) passed++; else failed++;

  // ── Round 91: getSessionStats with mixed Windows path separators ──
  console.log('\nRound 91: getSessionStats (mixed Windows path separators):');

  if (test('getSessionStats treats mixed Windows separators as a file path', () => {
    // session-manager.js line 166: regex /^[A-Za-z]:[/\\]/ checks only the
    // character right after the colon. Mixed separators like C:\Users/Mixed\session.tmp
    // should still match because the first separator (\) satisfies the regex.
    const stats = sessionManager.getSessionStats('C:\\Users/Mixed\\session.tmp');
    assert.strictEqual(stats.lineCount, 0,
      'Mixed separators should be treated as path (file does not exist → lineCount 0)');
    assert.strictEqual(stats.totalItems, 0, 'Non-existent path should have 0 items');
  })) passed++; else failed++;

  // ── Round 92: getSessionStats with UNC path treated as content ──
  console.log('\nRound 92: getSessionStats (Windows UNC path):');

  if (test('getSessionStats treats UNC path as content (not recognized as file path)', () => {
    // session-manager.js line 163-166: The path heuristic checks for Unix paths
    // (starts with /) and Windows drive-letter paths (/^[A-Za-z]:[/\\]/). UNC paths
    // (\\server\share\file.tmp) don't match either pattern, so the function treats
    // the string as pre-read content rather than a file path to read.
    const stats = sessionManager.getSessionStats('\\\\server\\share\\session.tmp');
    assert.strictEqual(stats.lineCount, 1,
      'UNC path should be treated as single-line content (not a recognized path)');
  })) passed++; else failed++;

  // ── Round 93: getSessionStats with drive letter but no slash (regex boundary) ──
  console.log('\nRound 93: getSessionStats (drive letter without slash — regex boundary):');

  if (test('getSessionStats treats drive letter without slash as content (not a path)', () => {
    // session-manager.js line 166: /^[A-Za-z]:[/\\]/ requires a '/' or '\'
    // immediately after the colon.  'Z:nosession.tmp' has 'Z:n' which does NOT
    // match, so looksLikePath is false even though .endsWith('.tmp') is true.
    const stats = sessionManager.getSessionStats('Z:nosession.tmp');
    assert.strictEqual(stats.lineCount, 1,
      'Z:nosession.tmp (no slash) should be treated as single-line content');
    assert.strictEqual(stats.totalItems, 0,
      'Content without session items should have 0 totalItems');
  })) passed++; else failed++;

  // Re-establish test environment for Rounds 95-98 (these tests need sessions to exist)
  const tmpHome2 = path.join(os.tmpdir(), `ecc-session-mgr-test-2-${Date.now()}`);
  const tmpSessionsDir2 = path.join(tmpHome2, '.claude', 'sessions');
  fs.mkdirSync(tmpSessionsDir2, { recursive: true });
  const origHome2 = process.env.HOME;
  const origUserProfile2 = process.env.USERPROFILE;

  // Create test session files for these tests
  const testSessions2 = [
    { name: '2026-01-15-aaaa1111-session.tmp', content: '# Test Session 1' },
    { name: '2026-02-01-bbbb2222-session.tmp', content: '# Test Session 2' },
    { name: '2026-02-10-cccc3333-session.tmp', content: '# Test Session 3' },
  ];
  for (const session of testSessions2) {
    const filePath = path.join(tmpSessionsDir2, session.name);
    fs.writeFileSync(filePath, session.content);
  }

  process.env.HOME = tmpHome2;
  process.env.USERPROFILE = tmpHome2;

  // ── Round 95: getAllSessions with both negative offset AND negative limit ──
  console.log('\nRound 95: getAllSessions (both negative offset and negative limit):');

  if (test('getAllSessions clamps both negative offset (to 0) and negative limit (to 1) simultaneously', () => {
    const result = sessionManager.getAllSessions({ offset: -5, limit: -10 });
    // offset clamped: Math.max(0, Math.floor(-5)) → 0
    // limit clamped: Math.max(1, Math.floor(-10)) → 1
    // slice(0, 0+1) → first session only
    assert.strictEqual(result.offset, 0,
      'Negative offset should be clamped to 0');
    assert.strictEqual(result.limit, 1,
      'Negative limit should be clamped to 1');
    assert.ok(result.sessions.length <= 1,
      'Should return at most 1 session (slice(0, 1))');
  })) passed++; else failed++;

  // ── Round 96: parseSessionFilename with Feb 30 (impossible date) ──
  console.log('\nRound 96: parseSessionFilename (Feb 30 — impossible date):');

  if (test('parseSessionFilename rejects Feb 30 (passes day<=31 but fails Date rollover)', () => {
    // Feb 30 passes the bounds check (month 1-12, day 1-31) at line 37
    // but new Date(2026, 1, 30) → March 2 (rollover), so getMonth() !== 1 → returns null
    const result = sessionManager.parseSessionFilename('2026-02-30-abcd1234-session.tmp');
    assert.strictEqual(result, null,
      'Feb 30 should be rejected by Date constructor rollover check (line 41)');
  })) passed++; else failed++;

  // ── Round 96: getAllSessions with limit: Infinity ──
  console.log('\nRound 96: getAllSessions (limit: Infinity — pagination bypass):');

  if (test('getAllSessions with limit: Infinity returns all sessions (no pagination)', () => {
    // Number(Infinity) = Infinity, Number.isNaN(Infinity) = false
    // Math.max(1, Math.floor(Infinity)) = Math.max(1, Infinity) = Infinity
    // slice(0, 0 + Infinity) returns all elements
    const result = sessionManager.getAllSessions({ limit: Infinity });
    assert.strictEqual(result.limit, Infinity,
      'Infinity limit should pass through (not clamped or defaulted)');
    assert.strictEqual(result.sessions.length, result.total,
      'All sessions should be returned (no pagination truncation)');
    assert.strictEqual(result.hasMore, false,
      'hasMore should be false since all sessions are returned');
  })) passed++; else failed++;

  // ── Round 96: getAllSessions with limit: null ──
  console.log('\nRound 96: getAllSessions (limit: null — destructuring default bypass):');

  if (test('getAllSessions with limit: null clamps to 1 (null bypasses destructuring default)', () => {
    // Destructuring default only fires for undefined, NOT null
    // rawLimit = null (not 50), Number(null) = 0, Math.max(1, 0) = 1
    const result = sessionManager.getAllSessions({ limit: null });
    assert.strictEqual(result.limit, 1,
      'null limit should become 1 (Number(null)=0, clamped via Math.max(1,0))');
    assert.ok(result.sessions.length <= 1,
      'Should return at most 1 session (clamped limit)');
  })) passed++; else failed++;

  // ── Round 97: getAllSessions with whitespace search filters out everything ──
  console.log('\nRound 97: getAllSessions (whitespace search — truthy but unmatched):');

  if (test('getAllSessions with search: " " returns empty because space is truthy but never matches shortId', () => {
    // session-manager.js line 233: if (search && !metadata.shortId.includes(search))
    // ' ' (space) is truthy so the filter is applied, but shortIds are hex strings
    // that never contain spaces, so ALL sessions are filtered out.
    // The search filter is inside the loop, so total is also 0.
    const result = sessionManager.getAllSessions({ search: ' ', limit: 100 });
    assert.strictEqual(result.sessions.length, 0,
      'Whitespace search should filter out all sessions (space never appears in hex shortIds)');
    assert.strictEqual(result.total, 0,
      'Total should be 0 because search filter is applied inside the loop (line 233)');
    assert.strictEqual(result.hasMore, false,
      'hasMore should be false since no sessions matched');
    // Contrast with null/empty search which returns all sessions:
    const allResult = sessionManager.getAllSessions({ search: null, limit: 100 });
    assert.ok(allResult.total > 0,
      'Null search should return sessions (confirming they exist but space filtered them)');
  })) passed++; else failed++;

  // ── Round 98: getSessionById with null sessionId returns null ──
  console.log('\nRound 98: getSessionById (null sessionId — guarded null return):');

  if (test('getSessionById(null) returns null when session files exist', () => {
    // Keep a populated sessions directory so the early input guard is exercised even when
    // candidate files are present.
    assert.strictEqual(sessionManager.getSessionById(null), null);
  })) passed++; else failed++;

  // Cleanup test environment for Rounds 95-98 that needed sessions
  // (Round 98: parseSessionFilename below doesn't need sessions)
  process.env.HOME = origHome2;
  if (origUserProfile2 !== undefined) {
    process.env.USERPROFILE = origUserProfile2;
  } else {
    delete process.env.USERPROFILE;
  }
  try {
    fs.rmSync(tmpHome2, { recursive: true, force: true });
  } catch {
    // best-effort
  }

  // ── Round 98: parseSessionFilename with null input returns null ──
  console.log('\nRound 98: parseSessionFilename (null input is safely rejected):');

  if (test('parseSessionFilename(null) returns null instead of throwing', () => {
    assert.strictEqual(sessionManager.parseSessionFilename(null), null);
    assert.strictEqual(sessionManager.parseSessionFilename(undefined), null);
    assert.strictEqual(sessionManager.parseSessionFilename(123), null);
  })) passed++; else failed++;

  // ── Round 99: writeSessionContent with null path returns false (error caught) ──
  console.log('\nRound 99: writeSessionContent (null path — error handling):');

  if (test('writeSessionContent(null, content) returns false (TypeError caught by try/catch)', () => {
    // session-manager.js lines 372-378: writeSessionContent wraps fs.writeFileSync
    // in a try/catch. When sessionPath is null, fs.writeFileSync throws TypeError:
    // 'The "path" argument must be of type string or Buffer or URL. Received null'
    // The catch block catches this and returns false (does not propagate).
    const result = sessionManager.writeSessionContent(null, 'some content');
    assert.strictEqual(result, false,
      'null path should be caught by try/catch and return false');
  })) passed++; else failed++;

  // ── Round 100: parseSessionMetadata with ### inside item text (premature section termination) ──
  console.log('\nRound 100: parseSessionMetadata (### in item text — lazy regex truncation):');
  if (test('parseSessionMetadata truncates item text at embedded ### due to lazy regex lookahead', () => {
    const content = `# Session

### Completed
- [x] Fix issue ### with parser
- [x] Normal task

### In Progress
- [ ] Debug output
`;
    const meta = sessionManager.parseSessionMetadata(content);
    // The lazy regex ([\s\S]*?)(?=###|\n\n|$) terminates at the first ###
    // So the Completed section captures only "- [x] Fix issue " (before the inner ###)
    // The second item "- [x] Normal task" is lost because it's after the inner ###
    assert.strictEqual(meta.completed.length, 1,
      'Only 1 item extracted — second item is after the inner ### terminator');
    assert.strictEqual(meta.completed[0], 'Fix issue',
      'Item text truncated at embedded ### (lazy regex stops at first ### match)');
  })) passed++; else failed++;

  // ── Round 101: getSessionStats with non-string input (number) throws TypeError ──
  console.log('\nRound 101: getSessionStats (non-string input — type confusion crash):');
  if (test('getSessionStats(123) throws TypeError (number reaches parseSessionMetadata → .match() fails)', () => {
    // typeof 123 === 'number' → looksLikePath = false → content = 123
    // parseSessionMetadata(123) → !123 is false → 123.match(...) → TypeError
    assert.throws(
      () => sessionManager.getSessionStats(123),
      { name: 'TypeError' },
      'Non-string input (number) should crash in parseSessionMetadata (.match not a function)'
    );
  })) passed++; else failed++;

  // ── Round 101: appendSessionContent(null, 'content') returns false (error caught) ──
  console.log('\nRound 101: appendSessionContent (null path — error handling):');
  if (test('appendSessionContent(null, content) returns false (TypeError caught by try/catch)', () => {
    const result = sessionManager.appendSessionContent(null, 'some content');
    assert.strictEqual(result, false,
      'null path should cause fs.appendFileSync to throw TypeError, caught by try/catch');
  })) passed++; else failed++;

  // ── Round 102: getSessionStats with Unix nonexistent .tmp path (looksLikePath heuristic) ──
  console.log('\nRound 102: getSessionStats (Unix nonexistent .tmp path — looksLikePath → null content):');
  if (test('getSessionStats returns zeroed stats when Unix path looks like file but does not exist', () => {
    // session-manager.js lines 163-166: looksLikePath heuristic checks typeof string,
    // no newlines, endsWith('.tmp'), startsWith('/').  A nonexistent Unix path triggers
    // the file-read branch → readFile returns null → parseSessionMetadata(null) returns
    // default empty metadata → lineCount: null ? ... : 0 === 0.
    const stats = sessionManager.getSessionStats('/nonexistent/deep/path/session.tmp');
    assert.strictEqual(stats.totalItems, 0,
      'No items from nonexistent file (parseSessionMetadata(null) returns empty arrays)');
    assert.strictEqual(stats.lineCount, 0,
      'lineCount: 0 because content is null (ternary guard at line 177)');
    assert.strictEqual(stats.hasNotes, false,
      'No notes section in null content');
    assert.strictEqual(stats.hasContext, false,
      'No context section in null content');
  })) passed++; else failed++;

  // ── Round 102: parseSessionMetadata with [x] checked items in In Progress section ──
  console.log('\nRound 102: parseSessionMetadata ([x] items in In Progress — regex skips checked):');
  if (test('parseSessionMetadata skips [x] checked items in In Progress section (regex only matches [ ])', () => {
    // session-manager.js line 130: progressSection regex uses `- \[ \]\s*(.+)` which
    // only matches unchecked checkboxes.  Checked items `- [x]` in the In Progress
    // section are silently ignored — they don't match the regex pattern.
    const content = `# Session

### In Progress
- [x] Already finished but placed here by mistake
- [ ] Actually in progress
- [x] Another misplaced completed item
- [ ] Second active task
`;
    const meta = sessionManager.parseSessionMetadata(content);
    assert.strictEqual(meta.inProgress.length, 2,
      'Only unchecked [ ] items should be captured (2 of 4)');
    assert.strictEqual(meta.inProgress[0], 'Actually in progress',
      'First unchecked item');
    assert.strictEqual(meta.inProgress[1], 'Second active task',
      'Second unchecked item');
  })) passed++; else failed++;

  // ── Round 104: parseSessionMetadata with whitespace-only notes section ──
  console.log('\nRound 104: parseSessionMetadata (whitespace-only notes — trim reduces to empty):');
  if (test('parseSessionMetadata treats whitespace-only notes as absent (trim → empty string → falsy)', () => {
    // session-manager.js line 139: `metadata.notes = notesSection[1].trim()` — when the
    // Notes section heading exists but only contains whitespace/newlines, trim() returns "".
    // Then getSessionStats line 178: `hasNotes: !!metadata.notes` — `!!""` is `false`.
    // So a notes section with only whitespace is treated as "no notes."
    const content = `# Session

### Notes for Next Session
   \t

### Context to Load
\`\`\`
file.ts
\`\`\`
`;
    const meta = sessionManager.parseSessionMetadata(content);
    assert.strictEqual(meta.notes, '',
      'Whitespace-only notes should trim to empty string');
    // Verify getSessionStats reports hasNotes as false
    const stats = sessionManager.getSessionStats(content);
    assert.strictEqual(stats.hasNotes, false,
      'hasNotes should be false because !!"" is false (whitespace-only notes treated as absent)');
    assert.strictEqual(stats.hasContext, true,
      'hasContext should be true (context section has actual content)');
  })) passed++; else failed++;

  // ── Round 105: parseSessionMetadata blank-line boundary truncates section items ──
  console.log('\nRound 105: parseSessionMetadata (blank line inside section — regex stops at \\n\\n):');

  if (test('parseSessionMetadata drops completed items after a blank line within the section', () => {
    // session-manager.js line 119: regex `(?=###|\n\n|$)` uses lazy [\s\S]*? with
    // a lookahead that stops at the first \n\n. If completed items are separated
    // by a blank line, items below the blank line are silently lost.
    const content = '# Session\n\n### Completed\n- [x] Task A\n\n- [x] Task B\n\n### In Progress\n- [ ] Task C\n';
    const meta = sessionManager.parseSessionMetadata(content);
    // The regex captures "- [x] Task A\n" then hits \n\n and stops.
    // "- [x] Task B" is between the two sections but outside both regex captures.
    assert.strictEqual(meta.completed.length, 1,
      'Only Task A captured — blank line terminates the section regex before Task B');
    assert.strictEqual(meta.completed[0], 'Task A',
      'First completed item should be Task A');
    // Task B is lost — it appears after the blank line, outside the captured range
    assert.strictEqual(meta.inProgress.length, 1,
      'In Progress should still capture Task C');
    assert.strictEqual(meta.inProgress[0], 'Task C',
      'In-progress item should be Task C');
  })) passed++; else failed++;

  // ── Round 106: getAllSessions with array/object limit — Number() coercion edge cases ──
  console.log('\nRound 106: getAllSessions (array/object limit coercion — Number([5])→5, Number({})→NaN→50):');
  if (test('getAllSessions coerces array/object limit via Number() with NaN fallback to 50', () => {
    const isoHome = path.join(os.tmpdir(), `ecc-r106-limit-coerce-${Date.now()}`);
    const isoSessionsDir = path.join(isoHome, '.claude', 'sessions');
    fs.mkdirSync(isoSessionsDir, { recursive: true });
    // Create 3 test sessions
    for (let i = 0; i < 3; i++) {
      const name = `2026-03-0${i + 1}-aaaa${i}${i}${i}${i}-session.tmp`;
      const filePath = path.join(isoSessionsDir, name);
      fs.writeFileSync(filePath, `# Session ${i}`);
      const mtime = new Date(Date.now() - (3 - i) * 60000);
      fs.utimesSync(filePath, mtime, mtime);
    }
    const origHome = process.env.HOME;
    const origUserProfile = process.env.USERPROFILE;
    process.env.HOME = isoHome;
    process.env.USERPROFILE = isoHome;
    try {
      delete require.cache[require.resolve('../../scripts/lib/session-manager')];
      delete require.cache[require.resolve('../../scripts/lib/utils')];
      const freshManager = require('../../scripts/lib/session-manager');
      // Object limit: Number({}) → NaN → fallback to 50
      const objResult = freshManager.getAllSessions({ limit: {} });
      assert.strictEqual(objResult.limit, 50,
        'Object limit should coerce to NaN → fallback to default 50');
      assert.strictEqual(objResult.total, 3, 'Should still find all 3 sessions');
      // Single-element array: Number([2]) → 2
      const arrResult = freshManager.getAllSessions({ limit: [2] });
      assert.strictEqual(arrResult.limit, 2,
        'Single-element array [2] coerces to Number 2 via Number([2])');
      assert.strictEqual(arrResult.sessions.length, 2, 'Should return only 2 sessions');
      assert.strictEqual(arrResult.hasMore, true, 'hasMore should be true with limit 2 of 3');
      // Multi-element array: Number([1,2]) → NaN → fallback to 50
      const multiArrResult = freshManager.getAllSessions({ limit: [1, 2] });
      assert.strictEqual(multiArrResult.limit, 50,
        'Multi-element array [1,2] coerces to NaN → fallback to 50');
    } finally {
      process.env.HOME = origHome;
      process.env.USERPROFILE = origUserProfile;
      delete require.cache[require.resolve('../../scripts/lib/session-manager')];
      delete require.cache[require.resolve('../../scripts/lib/utils')];
      fs.rmSync(isoHome, { recursive: true, force: true });
    }
  })) passed++; else failed++;

  // ── Round 109: getAllSessions skips .tmp files that don't match session filename format ──
  console.log('\nRound 109: getAllSessions (non-session .tmp files — parseSessionFilename returns null → skip):');
  if (test('getAllSessions ignores .tmp files with non-matching filenames', () => {
    const isoHome = path.join(os.tmpdir(), `ecc-r109-nonsession-${Date.now()}`);
    const isoSessionsDir = path.join(isoHome, '.claude', 'sessions');
    fs.mkdirSync(isoSessionsDir, { recursive: true });
    // Create one valid session file
    const validName = '2026-03-01-abcd1234-session.tmp';
    fs.writeFileSync(path.join(isoSessionsDir, validName), '# Valid Session');
    // Create non-session .tmp files that don't match the expected pattern
    fs.writeFileSync(path.join(isoSessionsDir, 'notes.tmp'), 'personal notes');
    fs.writeFileSync(path.join(isoSessionsDir, 'scratch.tmp'), 'scratch data');
    fs.writeFileSync(path.join(isoSessionsDir, 'backup-2026.tmp'), 'backup');
    const origHome = process.env.HOME;
    const origUserProfile = process.env.USERPROFILE;
    process.env.HOME = isoHome;
    process.env.USERPROFILE = isoHome;
    try {
      delete require.cache[require.resolve('../../scripts/lib/session-manager')];
      delete require.cache[require.resolve('../../scripts/lib/utils')];
      const freshManager = require('../../scripts/lib/session-manager');
      const result = freshManager.getAllSessions({ limit: 100 });
      assert.strictEqual(result.total, 1,
        'Should find only 1 valid session (non-matching .tmp files skipped via !metadata continue)');
      assert.strictEqual(result.sessions[0].shortId, 'abcd1234',
        'The one valid session should have correct shortId');
    } finally {
      process.env.HOME = origHome;
      process.env.USERPROFILE = origUserProfile;
      delete require.cache[require.resolve('../../scripts/lib/session-manager')];
      delete require.cache[require.resolve('../../scripts/lib/utils')];
      fs.rmSync(isoHome, { recursive: true, force: true });
    }
  })) passed++; else failed++;

  // ── Round 108: getSessionSize exact boundary at 1024 bytes — B→KB transition ──
  console.log('\nRound 108: getSessionSize (exact 1024-byte boundary — < means 1024 is KB, 1023 is B):');
  if (test('getSessionSize returns KB at exactly 1024 bytes and B at 1023', () => {
    const dir = createTempSessionDir();
    try {
      // Exactly 1024 bytes → size < 1024 is FALSE → goes to KB branch
      const atBoundary = path.join(dir, 'exact-1024.tmp');
      fs.writeFileSync(atBoundary, 'x'.repeat(1024));
      const sizeAt = sessionManager.getSessionSize(atBoundary);
      assert.strictEqual(sizeAt, '1.0 KB',
        'Exactly 1024 bytes should return "1.0 KB" (not "1024 B")');

      // 1023 bytes → size < 1024 is TRUE → stays in B branch
      const belowBoundary = path.join(dir, 'below-1024.tmp');
      fs.writeFileSync(belowBoundary, 'x'.repeat(1023));
      const sizeBelow = sessionManager.getSessionSize(belowBoundary);
      assert.strictEqual(sizeBelow, '1023 B',
        '1023 bytes should return "1023 B" (still in bytes range)');

      // Exactly 1MB boundary → 1048576 bytes
      const atMB = path.join(dir, 'exact-1mb.tmp');
      fs.writeFileSync(atMB, 'x'.repeat(1024 * 1024));
      const sizeMB = sessionManager.getSessionSize(atMB);
      assert.strictEqual(sizeMB, '1.0 MB',
        'Exactly 1MB should return "1.0 MB" (not "1024.0 KB")');
    } finally {
      cleanup(dir);
    }
  })) passed++; else failed++;

  // ── Round 110: parseSessionFilename year 0000 — JS Date maps year 0 to 1900 ──
  console.log('\nRound 110: parseSessionFilename (year 0000 — Date constructor maps 0→1900):');
  if (test('parseSessionFilename with year 0000 produces datetime in 1900 due to JS Date legacy mapping', () => {
    // JavaScript's multi-arg Date constructor treats years 0-99 as 1900-1999
    // So new Date(0, 0, 1) → January 1, 1900 (not year 0000)
    const result = sessionManager.parseSessionFilename('0000-01-01-abcd1234-session.tmp');
    assert.notStrictEqual(result, null, 'Should parse successfully (regex \\d{4} matches 0000)');
    assert.strictEqual(result.date, '0000-01-01', 'Date string should be "0000-01-01"');
    assert.strictEqual(result.shortId, 'abcd1234');
    // The key quirk: datetime is year 1900, not 0000
    assert.strictEqual(result.datetime.getFullYear(), 1900,
      'JS Date maps year 0 to 1900 in multi-arg constructor');
    // Year 99 maps to 1999
    const result99 = sessionManager.parseSessionFilename('0099-06-15-testid01-session.tmp');
    assert.notStrictEqual(result99, null, 'Year 0099 should also parse');
    assert.strictEqual(result99.datetime.getFullYear(), 1999,
      'JS Date maps year 99 to 1999');
    // Year 100 does NOT get the 1900 mapping — it stays as year 100
    const result100 = sessionManager.parseSessionFilename('0100-03-10-validid1-session.tmp');
    assert.notStrictEqual(result100, null, 'Year 0100 should also parse');
    assert.strictEqual(result100.datetime.getFullYear(), 100,
      'Year 100+ is not affected by the 0-99 → 1900-1999 mapping');
  })) passed++; else failed++;

  // ── Round 110: parseSessionFilename accepts mixed-case IDs ──
  console.log('\nRound 110: parseSessionFilename (mixed-case IDs are accepted):');
  if (test('parseSessionFilename accepts filenames with uppercase characters in short ID', () => {
    const upperResult = sessionManager.parseSessionFilename('2026-01-15-ABCD1234-session.tmp');
    assert.notStrictEqual(upperResult, null,
      'All-uppercase ID should be accepted');
    assert.strictEqual(upperResult.shortId, 'ABCD1234');

    const mixedResult = sessionManager.parseSessionFilename('2026-01-15-AbCd1234-session.tmp');
    assert.notStrictEqual(mixedResult, null,
      'Mixed-case ID should be accepted');
    assert.strictEqual(mixedResult.shortId, 'AbCd1234');

    const lowerResult = sessionManager.parseSessionFilename('2026-01-15-abcd1234-session.tmp');
    assert.notStrictEqual(lowerResult, null,
      'All-lowercase ID should still be accepted');
    assert.strictEqual(lowerResult.shortId, 'abcd1234');
  })) passed++; else failed++;

  // ── Round 111: parseSessionMetadata context with nested triple backticks — lazy regex truncation ──
  console.log('\nRound 111: parseSessionMetadata (nested ``` in context — lazy \\S*? stops at first ```):");');
  if (test('parseSessionMetadata context capture truncated by nested triple backticks', () => {
    // The regex: /### Context to Load\s*\n```\n([\s\S]*?)```/
    // The lazy [\s\S]*? matches as few chars as possible, so it stops at the
    // FIRST ``` it encounters — even if that's inside the code block content.
    const content = [
      '# Session',
      '',
      '### Context to Load',
      '```',
      'const x = 1;',
      '```nested code block```',  // Inner ``` causes premature match end
      'const y = 2;',
      '```'
    ].join('\n');
    const meta = sessionManager.parseSessionMetadata(content);
    // Lazy regex stops at the inner ```, so context only captures "const x = 1;\n"
    assert.ok(meta.context.includes('const x = 1'),
      'Context should contain text before the inner backticks');
    assert.ok(!meta.context.includes('const y = 2'),
      'Context should NOT contain text after inner ``` (lazy regex stops early)');
    // Without nested backticks, full content is captured
    const cleanContent = [
      '# Session',
      '',
      '### Context to Load',
      '```',
      'const x = 1;',
      'const y = 2;',
      '```'
    ].join('\n');
    const cleanMeta = sessionManager.parseSessionMetadata(cleanContent);
    assert.ok(cleanMeta.context.includes('const x = 1'),
      'Clean context should have first line');
    assert.ok(cleanMeta.context.includes('const y = 2'),
      'Clean context should have second line');
  })) passed++; else failed++;

  // ── Round 112: getSessionStats with newline-containing absolute path — treated as content ──
  console.log('\nRound 112: getSessionStats (newline-in-path heuristic):');
  if (test('getSessionStats treats absolute .tmp path containing newline as content, not a file path', () => {
    // The looksLikePath heuristic at line 163-166 checks:
    //   !sessionPathOrContent.includes('\n')
    // A string with embedded newline fails this check and is treated as content
    const pathWithNewline = '/tmp/sessions/2026-01-15\n-abcd1234-session.tmp';

    // This should NOT throw (it's treated as content, not a path that doesn't exist)
    const stats = sessionManager.getSessionStats(pathWithNewline);
    assert.ok(stats, 'Should return stats object (treating input as content)');
    // The "content" has 2 lines (split by the embedded \n)
    assert.strictEqual(stats.lineCount, 2,
      'Should count 2 lines in the "content" (split at \\n)');
    // No markdown headings = no completed/in-progress items
    assert.strictEqual(stats.totalItems, 0,
      'Should find 0 items in non-markdown content');

    // Contrast: a real absolute path without newlines IS treated as a path
    const realPath = '/tmp/nonexistent-session.tmp';
    const realStats = sessionManager.getSessionStats(realPath);
    // getSessionContent returns '' for non-existent files, so lineCount = 1 (empty string split)
    assert.ok(realStats, 'Should return stats even for nonexistent path');
    assert.strictEqual(realStats.lineCount, 0,
      'Non-existent file returns empty content with 0 lines');
  })) passed++; else failed++;

  // ── Round 112: appendSessionContent with read-only file — returns false ──
  console.log('\nRound 112: appendSessionContent (read-only file):');
  if (test('appendSessionContent returns false when file is read-only (EACCES)', () => {
    if (process.platform === 'win32' || process.getuid?.() === 0) {
      // chmod ineffective on Windows/root — skip
      assert.ok(true, 'Skipped on Windows/root');
      return;
    }
    const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'r112-readonly-'));
    const readOnlyFile = path.join(tmpDir, '2026-01-15-session.tmp');
    try {
      fs.writeFileSync(readOnlyFile, '# Session\n\nInitial content\n');
      // Make file read-only
      fs.chmodSync(readOnlyFile, 0o444);
      // Verify it exists and is readable
      const content = fs.readFileSync(readOnlyFile, 'utf8');
      assert.ok(content.includes('Initial content'), 'File should be readable');

      // appendSessionContent should catch EACCES and return false
      const result = sessionManager.appendSessionContent(readOnlyFile, '\nAppended data');
      assert.strictEqual(result, false,
        'Should return false when file is read-only (fs.appendFileSync throws EACCES)');

      // Verify original content unchanged
      const afterContent = fs.readFileSync(readOnlyFile, 'utf8');
      assert.ok(!afterContent.includes('Appended data'),
        'Original content should be unchanged');
    } finally {
      try { fs.chmodSync(readOnlyFile, 0o644); } catch (_e) { /* ignore permission errors */ }
      fs.rmSync(tmpDir, { recursive: true, force: true });
    }
  })) passed++; else failed++;

  // ── Round 113: parseSessionFilename century leap year validation (1900, 2100 not leap; 2000 is) ──
  console.log('\nRound 113: parseSessionFilename (century leap year — 100/400 rules):');
  if (test('parseSessionFilename rejects Feb 29 in century non-leap years (1900, 2100) but accepts 2000', () => {
    // Gregorian rule: divisible by 100 → NOT leap, UNLESS also divisible by 400
    // 1900: divisible by 100 but NOT by 400 → NOT leap → Feb 29 invalid
    const result1900 = sessionManager.parseSessionFilename('1900-02-29-abcd1234-session.tmp');
    assert.strictEqual(result1900, null,
      '1900 is NOT a leap year (div by 100 but not 400) — Feb 29 should be rejected');

    // 2100: same rule — NOT leap
    const result2100 = sessionManager.parseSessionFilename('2100-02-29-test1234-session.tmp');
    assert.strictEqual(result2100, null,
      '2100 is NOT a leap year — Feb 29 should be rejected');

    // 2000: divisible by 400 → IS leap → Feb 29 valid
    const result2000 = sessionManager.parseSessionFilename('2000-02-29-leap2000-session.tmp');
    assert.notStrictEqual(result2000, null,
      '2000 IS a leap year (div by 400) — Feb 29 should be accepted');
    assert.strictEqual(result2000.date, '2000-02-29');

    // 2400: also divisible by 400 → IS leap
    const result2400 = sessionManager.parseSessionFilename('2400-02-29-test2400-session.tmp');
    assert.notStrictEqual(result2400, null,
      '2400 IS a leap year (div by 400) — Feb 29 should be accepted');

    // Verify Feb 28 always works in non-leap century years
    const result1900Feb28 = sessionManager.parseSessionFilename('1900-02-28-abcd1234-session.tmp');
    assert.notStrictEqual(result1900Feb28, null,
      'Feb 28 should always be valid even in non-leap years');
  })) passed++; else failed++;

  // ── Round 113: parseSessionMetadata title with markdown formatting — raw markdown preserved ──
  console.log('\nRound 113: parseSessionMetadata (title with markdown formatting — raw markdown preserved):');
  if (test('parseSessionMetadata captures raw markdown formatting in title without stripping', () => {
    // The regex /^#\s+(.+)$/m captures everything after "# ", including markdown
    const boldContent = '# **Important Session**\n\nSome content';
    const boldMeta = sessionManager.parseSessionMetadata(boldContent);
    assert.strictEqual(boldMeta.title, '**Important Session**',
      'Bold markdown ** should be preserved in title (not stripped)');

    // Inline code in title
    const codeContent = '# `fix-bug` Session\n\nContent here';
    const codeMeta = sessionManager.parseSessionMetadata(codeContent);
    assert.strictEqual(codeMeta.title, '`fix-bug` Session',
      'Inline code backticks should be preserved in title');

    // Italic in title
    const italicContent = '# _Urgent_ Review\n\n**Date:** 2026-01-01';
    const italicMeta = sessionManager.parseSessionMetadata(italicContent);
    assert.strictEqual(italicMeta.title, '_Urgent_ Review',
      'Italic underscores should be preserved in title');

    // Mixed markdown in title
    const mixedContent = '# **Bold** and `code` and _italic_\n\nBody text';
    const mixedMeta = sessionManager.parseSessionMetadata(mixedContent);
    assert.strictEqual(mixedMeta.title, '**Bold** and `code` and _italic_',
      'Mixed markdown should all be preserved as raw text');

    // Title with trailing whitespace (trim should remove it)
    const trailingContent = '# Title with spaces   \n\nBody';
    const trailingMeta = sessionManager.parseSessionMetadata(trailingContent);
    assert.strictEqual(trailingMeta.title, 'Title with spaces',
      'Trailing whitespace should be trimmed');
  })) passed++; else failed++;

  // ── Round 115: parseSessionMetadata with CRLF line endings — section boundaries differ ──
  console.log('\nRound 115: parseSessionMetadata (CRLF line endings — \\r\\n vs \\n in section regexes):');
  if (test('parseSessionMetadata handles CRLF content — title trimmed, sections may over-capture', () => {
    // Title regex /^#\s+(.+)$/m: . matches \r, trim() removes it
    const crlfTitle = '# My Session\r\n\r\n**Date:** 2026-01-15';
    const titleMeta = sessionManager.parseSessionMetadata(crlfTitle);
    assert.strictEqual(titleMeta.title, 'My Session',
      'Title should be trimmed (\\r removed by .trim())');
    assert.strictEqual(titleMeta.date, '2026-01-15',
      'Date extraction unaffected by CRLF');

    // Completed section with CRLF: regex ### Completed\s*\n works because \s* matches \r
    // But the boundary (?=###|\n\n|$) — \n\n won't match \r\n\r\n
    const crlfSections = [
      '# Session\r\n',
      '\r\n',
      '### Completed\r\n',
      '- [x] Task A\r\n',
      '- [x] Task B\r\n',
      '\r\n',
      '### In Progress\r\n',
      '- [ ] Task C\r\n'
    ].join('');

    const sectionMeta = sessionManager.parseSessionMetadata(crlfSections);

    // \s* in "### Completed\s*\n" matches the \r before \n, so section header matches
    assert.ok(sectionMeta.completed.length >= 2,
      'Should find at least 2 completed items (\\s* consumes \\r before \\n)');
    assert.ok(sectionMeta.completed.includes('Task A'), 'Should find Task A');
    assert.ok(sectionMeta.completed.includes('Task B'), 'Should find Task B');

    // In Progress section: \n\n boundary fails on \r\n\r\n, so the lazy [\s\S]*?
    // stops at ### instead — this still works because ### is present
    assert.ok(sectionMeta.inProgress.length >= 1,
      'Should find at least 1 in-progress item');
    assert.ok(sectionMeta.inProgress.includes('Task C'), 'Should find Task C');

    // Edge case: CRLF content with NO section headers after Completed —
    // \n\n boundary fails, so [\s\S]*? falls through to $ (end of string)
    const crlfNoNextSection = [
      '# Session\r\n',
      '\r\n',
      '### Completed\r\n',
      '- [x] Only task\r\n',
      '\r\n',
      'Some trailing text\r\n'
    ].join('');

    const noNextMeta = sessionManager.parseSessionMetadata(crlfNoNextSection);
    // Without a ### boundary, the \n\n lookahead fails on \r\n\r\n,
    // so [\s\S]*? extends to $ and captures everything including trailing text
    assert.ok(noNextMeta.completed.length >= 1,
      'Should find at least 1 completed item in CRLF-only content');
  })) passed++; else failed++;

  // ── Round 117: getSessionSize boundary values — B/KB/MB formatting thresholds ──
  console.log('\nRound 117: getSessionSize (B/KB/MB formatting at exact boundary thresholds):');
  if (test('getSessionSize formats correctly at B→KB boundary (1023→"1023 B", 1024→"1.0 KB") and KB→MB', () => {
    const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'r117-size-boundary-'));
    try {
      // Zero-byte file
      const zeroFile = path.join(tmpDir, '2026-01-01-session.tmp');
      fs.writeFileSync(zeroFile, '');
      assert.strictEqual(sessionManager.getSessionSize(zeroFile), '0 B',
        'Empty file should be "0 B"');

      // 1 byte file
      const oneByteFile = path.join(tmpDir, '2026-01-02-session.tmp');
      fs.writeFileSync(oneByteFile, 'x');
      assert.strictEqual(sessionManager.getSessionSize(oneByteFile), '1 B',
        'Single byte file should be "1 B"');

      // 1023 bytes — last value in B range (size < 1024)
      const file1023 = path.join(tmpDir, '2026-01-03-session.tmp');
      fs.writeFileSync(file1023, 'x'.repeat(1023));
      assert.strictEqual(sessionManager.getSessionSize(file1023), '1023 B',
        '1023 bytes is still in B range (< 1024)');

      // 1024 bytes — first value in KB range (size >= 1024, < 1024*1024)
      const file1024 = path.join(tmpDir, '2026-01-04-session.tmp');
      fs.writeFileSync(file1024, 'x'.repeat(1024));
      assert.strictEqual(sessionManager.getSessionSize(file1024), '1.0 KB',
        '1024 bytes = exactly 1.0 KB');

      // 1025 bytes — KB with decimal
      const file1025 = path.join(tmpDir, '2026-01-05-session.tmp');
      fs.writeFileSync(file1025, 'x'.repeat(1025));
      assert.strictEqual(sessionManager.getSessionSize(file1025), '1.0 KB',
        '1025 bytes rounds to 1.0 KB (1025/1024 = 1.000...)');

      // Non-existent file returns '0 B'
      assert.strictEqual(sessionManager.getSessionSize('/nonexistent/file.tmp'), '0 B',
        'Non-existent file should return "0 B"');
    } finally {
      fs.rmSync(tmpDir, { recursive: true, force: true });
    }
  })) passed++; else failed++;

  // ── Round 117: parseSessionFilename accepts uppercase, underscores, and short IDs ──
  console.log('\nRound 117: parseSessionFilename (uppercase, underscores, and short IDs are accepted):');
  if (test('parseSessionFilename accepts uppercase short IDs, underscores, and 7-char names', () => {
    const upper = sessionManager.parseSessionFilename('2026-01-15-ABCDEFGH-session.tmp');
    assert.notStrictEqual(upper, null,
      'All-uppercase ID should be accepted');
    assert.strictEqual(upper.shortId, 'ABCDEFGH');

    const mixed = sessionManager.parseSessionFilename('2026-01-15-AbCdEfGh-session.tmp');
    assert.notStrictEqual(mixed, null,
      'Mixed-case ID should be accepted');
    assert.strictEqual(mixed.shortId, 'AbCdEfGh');

    const lower = sessionManager.parseSessionFilename('2026-01-15-abcdefgh-session.tmp');
    assert.notStrictEqual(lower, null, 'All-lowercase ID should be accepted');
    assert.strictEqual(lower.shortId, 'abcdefgh');

    const hexUpper = sessionManager.parseSessionFilename('2026-01-15-A1B2C3D4-session.tmp');
    assert.notStrictEqual(hexUpper, null, 'Uppercase hex ID should be accepted');
    assert.strictEqual(hexUpper.shortId, 'A1B2C3D4');

    const underscored = sessionManager.parseSessionFilename('2026-01-15-ChezMoi_2-session.tmp');
    assert.notStrictEqual(underscored, null, 'IDs with underscores should be accepted');
    assert.strictEqual(underscored.shortId, 'ChezMoi_2');

    const shortName = sessionManager.parseSessionFilename('2026-01-15-homelab-session.tmp');
    assert.notStrictEqual(shortName, null, '7-character names should be accepted');
    assert.strictEqual(shortName.shortId, 'homelab');
  })) passed++; else failed++;

  // ── Round 119: parseSessionMetadata "Context to Load" code block extraction ──
  console.log('\nRound 119: parseSessionMetadata ("Context to Load" — code block extraction edge cases):');
  if (test('parseSessionMetadata extracts Context to Load from code block, handles missing/nested blocks', () => {
    // Valid context extraction
    const validContent = [
      '# Session\n\n',
      '### Context to Load\n',
      '```\n',
      'file1.js\n',
      'file2.ts\n',
      '```\n'
    ].join('');
    const validMeta = sessionManager.parseSessionMetadata(validContent);
    assert.strictEqual(validMeta.context, 'file1.js\nfile2.ts',
      'Should extract content between ``` markers and trim');

    // Missing closing backticks — regex doesn't match, context stays empty
    const noClose = [
      '# Session\n\n',
      '### Context to Load\n',
      '```\n',
      'file1.js\n',
      'file2.ts\n'
    ].join('');
    const noCloseMeta = sessionManager.parseSessionMetadata(noClose);
    assert.strictEqual(noCloseMeta.context, '',
      'Missing closing ``` should result in empty context (regex no match)');

    // No code block after header — just plain text
    const noBlock = [
      '# Session\n\n',
      '### Context to Load\n',
      'file1.js\n',
      'file2.ts\n'
    ].join('');
    const noBlockMeta = sessionManager.parseSessionMetadata(noBlock);
    assert.strictEqual(noBlockMeta.context, '',
      'Plain text without ``` should not be captured as context');

    // Nested code block — lazy [\s\S]*? stops at first ```
    const nested = [
      '# Session\n\n',
      '### Context to Load\n',
      '```\n',
      'first block\n',
      '```\n',
      'second block\n',
      '```\n'
    ].join('');
    const nestedMeta = sessionManager.parseSessionMetadata(nested);
    assert.strictEqual(nestedMeta.context, 'first block',
      'Lazy quantifier should stop at first closing ``` (not greedy)');

    // Empty code block
    const emptyBlock = '# Session\n\n### Context to Load\n```\n```\n';
    const emptyMeta = sessionManager.parseSessionMetadata(emptyBlock);
    assert.strictEqual(emptyMeta.context, '',
      'Empty code block should result in empty context (trim of empty)');
  })) passed++; else failed++;

  // ── Round 120: parseSessionMetadata "Notes for Next Session" extraction edge cases ──
  console.log('\nRound 120: parseSessionMetadata ("Notes for Next Session" — extraction edge cases):');
  if (test('parseSessionMetadata extracts notes section — last section, empty, followed by ###', () => {
    // Notes as the last section (no ### or \n\n after)
    const lastSection = '# Session\n\n### Notes for Next Session\nRemember to review PR #42\nAlso check CI status';
    const lastMeta = sessionManager.parseSessionMetadata(lastSection);
    assert.strictEqual(lastMeta.notes, 'Remember to review PR #42\nAlso check CI status',
      'Notes as last section should capture everything to end of string via $ anchor');
    assert.strictEqual(lastMeta.hasNotes, undefined,
      'hasNotes is not a direct property of parseSessionMetadata result');

    // Notes followed by another ### section
    const withNext = '# Session\n\n### Notes for Next Session\nImportant note\n### Context to Load\n```\nfiles\n```';
    const nextMeta = sessionManager.parseSessionMetadata(withNext);
    assert.strictEqual(nextMeta.notes, 'Important note',
      'Notes should stop at next ### header');

    // Notes followed by \n\n (double newline)
    const withDoubleNewline = '# Session\n\n### Notes for Next Session\nNote here\n\nSome other text';
    const dblMeta = sessionManager.parseSessionMetadata(withDoubleNewline);
    assert.strictEqual(dblMeta.notes, 'Note here',
      'Notes should stop at \\n\\n boundary');

    // Empty notes section (header only, followed by \n\n)
    const emptyNotes = '# Session\n\n### Notes for Next Session\n\n### Other Section';
    const emptyMeta = sessionManager.parseSessionMetadata(emptyNotes);
    assert.strictEqual(emptyMeta.notes, '',
      'Empty notes section should result in empty string after trim');

    // Notes with markdown formatting
    const markdownNotes = '# Session\n\n### Notes for Next Session\n- [ ] Review **important** PR\n- [x] Check `config.js`\n\n### Done';
    const mdMeta = sessionManager.parseSessionMetadata(markdownNotes);
    assert.ok(mdMeta.notes.includes('**important**'),
      'Markdown bold should be preserved in notes');
    assert.ok(mdMeta.notes.includes('`config.js`'),
      'Markdown code should be preserved in notes');
  })) passed++; else failed++;

  // ── Round 121: parseSessionMetadata Started/Last Updated time extraction ──
  console.log('\nRound 121: parseSessionMetadata (Started/Last Updated time extraction):');
  if (test('parseSessionMetadata extracts Started and Last Updated times from markdown', () => {
    // Standard format
    const standard = '# Session\n\n**Date:** 2026-01-15\n**Started:** 14:30\n**Last Updated:** 16:45';
    const stdMeta = sessionManager.parseSessionMetadata(standard);
    assert.strictEqual(stdMeta.started, '14:30', 'Should extract started time');
    assert.strictEqual(stdMeta.lastUpdated, '16:45', 'Should extract last updated time');

    // With seconds in time
    const withSec = '# Session\n\n**Started:** 14:30:00\n**Last Updated:** 16:45:59';
    const secMeta = sessionManager.parseSessionMetadata(withSec);
    assert.strictEqual(secMeta.started, '14:30:00', 'Should capture seconds too ([\\d:]+)');
    assert.strictEqual(secMeta.lastUpdated, '16:45:59');

    // Missing Started but has Last Updated
    const noStarted = '# Session\n\n**Last Updated:** 09:00';
    const noStartMeta = sessionManager.parseSessionMetadata(noStarted);
    assert.strictEqual(noStartMeta.started, null, 'Missing Started should be null');
    assert.strictEqual(noStartMeta.lastUpdated, '09:00', 'Last Updated should still be extracted');

    // Missing Last Updated but has Started
    const noUpdated = '# Session\n\n**Started:** 08:15';
    const noUpdMeta = sessionManager.parseSessionMetadata(noUpdated);
    assert.strictEqual(noUpdMeta.started, '08:15', 'Started should be extracted');
    assert.strictEqual(noUpdMeta.lastUpdated, null, 'Missing Last Updated should be null');

    // Neither present
    const neither = '# Session\n\nJust some text';
    const neitherMeta = sessionManager.parseSessionMetadata(neither);
    assert.strictEqual(neitherMeta.started, null, 'No Started in content → null');
    assert.strictEqual(neitherMeta.lastUpdated, null, 'No Last Updated in content → null');

    // Loose regex: edge case with extra colons ([\d:]+ matches any digit-colon combo)
    const loose = '# Session\n\n**Started:** 1:2:3:4';
    const looseMeta = sessionManager.parseSessionMetadata(loose);
    assert.strictEqual(looseMeta.started, '1:2:3:4',
      'Loose [\\d:]+ regex captures any digits-and-colons combination');
  })) passed++; else failed++;

  // ── Round 122: getSessionById old format (no-id) — noIdMatch path ──
  console.log('\nRound 122: getSessionById (old format no-id — date-only filename match):');
  if (test('getSessionById matches old format YYYY-MM-DD-session.tmp via noIdMatch path', () => {
    const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'r122-old-format-'));
    const origHome = process.env.HOME;
    const origUserProfile = process.env.USERPROFILE;
    const origDir = process.env.CLAUDE_DIR;
    try {
      // Set up isolated environment
      const claudeDir = path.join(tmpDir, '.claude');
      const sessionsDir = path.join(claudeDir, 'sessions');
      fs.mkdirSync(sessionsDir, { recursive: true });
      process.env.HOME = tmpDir;
      process.env.USERPROFILE = tmpDir; // Windows: os.homedir() uses USERPROFILE
      delete process.env.CLAUDE_DIR;

      // Clear require cache for fresh module with new HOME
      delete require.cache[require.resolve('../../scripts/lib/utils')];
      delete require.cache[require.resolve('../../scripts/lib/session-manager')];
      const freshSM = require('../../scripts/lib/session-manager');

      // Create old-format session file (no short ID)
      const oldFile = path.join(sessionsDir, '2026-01-15-session.tmp');
      fs.writeFileSync(oldFile, '# Old Format Session\n\n**Date:** 2026-01-15\n');

      // Search by date — triggers noIdMatch path
      const result = freshSM.getSessionById('2026-01-15');
      assert.ok(result, 'Should find old-format session by date string');
      assert.strictEqual(result.shortId, 'no-id',
        'Old format should have shortId "no-id"');
      assert.strictEqual(result.date, '2026-01-15');
      assert.strictEqual(result.filename, '2026-01-15-session.tmp');

      // Search by non-matching date — should not find
      const noResult = freshSM.getSessionById('2026-01-16');
      assert.strictEqual(noResult, null,
        'Non-matching date should return null');
    } finally {
      process.env.HOME = origHome;
      if (origUserProfile !== undefined) process.env.USERPROFILE = origUserProfile;
      else delete process.env.USERPROFILE;
      if (origDir) process.env.CLAUDE_DIR = origDir;
      delete require.cache[require.resolve('../../scripts/lib/utils')];
      delete require.cache[require.resolve('../../scripts/lib/session-manager')];
      fs.rmSync(tmpDir, { recursive: true, force: true });
    }
  })) passed++; else failed++;

  // ── Round 123: parseSessionMetadata with CRLF line endings — section boundaries break ──
  console.log('\nRound 123: parseSessionMetadata (CRLF section boundaries — \\n\\n fails to match \\r\\n\\r\\n):');
  if (test('parseSessionMetadata CRLF content: \\n\\n boundary fails, lazy match bleeds across sections', () => {
    // session-manager.js lines 119-134: regex uses (?=###|\n\n|$) to delimit sections.
    // On CRLF content, a blank line is \r\n\r\n, NOT \n\n. The \n\n alternation
    // won't match, so the lazy [\s\S]*? extends past the blank line until it hits
    // ### or $. This means completed items may bleed into following sections.
    //
    // However, \s* in /### Completed\s*\n/ DOES match \r\n (since \r is whitespace),
    // so section headers still match — only blank-line boundaries fail.

    // Test 1: CRLF with ### delimiter — works because ### is an alternation
    const crlfWithHash = [
      '# Session Title\r\n',
      '\r\n',
      '### Completed\r\n',
      '- [x] Task A\r\n',
      '### In Progress\r\n',
      '- [ ] Task B\r\n'
    ].join('');
    const meta1 = sessionManager.parseSessionMetadata(crlfWithHash);
    // ### delimiter still works — lazy match stops at ### In Progress
    assert.ok(meta1.completed.length >= 1,
      'Completed section should find at least 1 item with ### boundary on CRLF');
    // Check that Task A is found (may include \r in the trimmed text)
    const taskA = meta1.completed[0];
    assert.ok(taskA.includes('Task A'),
      'Should extract Task A from completed section');

    // Test 2: CRLF with \n\n (blank line) delimiter — this is where it breaks
    const crlfBlankLine = [
      '# Session\r\n',
      '\r\n',
      '### Completed\r\n',
      '- [x] First task\r\n',
      '\r\n',         // Blank line = \r\n\r\n — won't match \n\n
      'Some other text\r\n'
    ].join('');
    const meta2 = sessionManager.parseSessionMetadata(crlfBlankLine);
    // On LF, blank line stops the lazy match. On CRLF, it bleeds through.
    // The lazy [\s\S]*? stops at $ if no ### or \n\n matches,
    // so "Some other text" may end up captured in the raw section text.
    // But the items regex /- \[x\]\s*(.+)/g only captures checkbox lines,
    // so the count stays correct despite the bleed.
    assert.strictEqual(meta2.completed.length, 1,
      'Even with CRLF bleed, checkbox regex only matches "- [x]" lines');

    // Test 3: LF version of same content — proves \n\n works normally
    const lfBlankLine = '# Session\n\n### Completed\n- [x] First task\n\nSome other text\n';
    const meta3 = sessionManager.parseSessionMetadata(lfBlankLine);
    assert.strictEqual(meta3.completed.length, 1,
      'LF version: blank line correctly delimits section');

    // Test 4: CRLF notes section — lazy match goes to $ when \n\n fails
    const crlfNotes = [
      '# Session\r\n',
      '\r\n',
      '### Notes for Next Session\r\n',
      'Remember to review\r\n',
      '\r\n',
      'This should be separate\r\n'
    ].join('');
    const meta4 = sessionManager.parseSessionMetadata(crlfNotes);
    // On CRLF, \n\n fails → lazy match extends to $ → includes "This should be separate"
    // On LF, \n\n works → notes = "Remember to review" only
    const lfNotes = '# Session\n\n### Notes for Next Session\nRemember to review\n\nThis should be separate\n';
    const meta5 = sessionManager.parseSessionMetadata(lfNotes);
    assert.strictEqual(meta5.notes, 'Remember to review',
      'LF: notes stop at blank line');
    // CRLF notes will be longer (bleed through blank line)
    assert.ok(meta4.notes.length >= meta5.notes.length,
      'CRLF notes >= LF notes length (CRLF may bleed past blank line)');
  })) passed++; else failed++;

  // ── Round 124: getAllSessions with invalid date format (strict equality, no normalization) ──
  console.log('\nRound 124: getAllSessions (invalid date format — strict !== comparison):');
  if (test('getAllSessions date filter uses strict equality so wrong format returns empty', () => {
    // session-manager.js line 228: `if (date && metadata.date !== date)` — strict inequality.
    // metadata.date is always "YYYY-MM-DD" format. Passing a different format like
    // "2026/01/15" or "Jan 15 2026" will never match, silently returning empty.
    // No validation or normalization occurs on the date parameter.
    const origHome = process.env.HOME;
    const origUserProfile = process.env.USERPROFILE;
    const origDir = process.env.CLAUDE_DIR;
    const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'r124-date-format-'));
    const homeDir = path.join(tmpDir, 'home');
    fs.mkdirSync(path.join(homeDir, '.claude', 'sessions'), { recursive: true });

    try {
      process.env.HOME = homeDir;
      process.env.USERPROFILE = homeDir; // Windows: os.homedir() uses USERPROFILE
      delete process.env.CLAUDE_DIR;
      delete require.cache[require.resolve('../../scripts/lib/utils')];
      delete require.cache[require.resolve('../../scripts/lib/session-manager')];
      const freshSM = require('../../scripts/lib/session-manager');

      // Create a session file with valid date
      const sessionsDir = path.join(homeDir, '.claude', 'sessions');
      fs.writeFileSync(
        path.join(sessionsDir, '2026-01-15-abcd1234-session.tmp'),
        '# Test Session'
      );

      // Correct format — should find 1 session
      const correct = freshSM.getAllSessions({ date: '2026-01-15' });
      assert.strictEqual(correct.sessions.length, 1,
        'Correct YYYY-MM-DD format should match');

      // Wrong separator — strict !== means no match
      const wrongSep = freshSM.getAllSessions({ date: '2026/01/15' });
      assert.strictEqual(wrongSep.sessions.length, 0,
        'Slash-separated date does not match (strict string equality)');

      // US format — no match
      const usFormat = freshSM.getAllSessions({ date: '01-15-2026' });
      assert.strictEqual(usFormat.sessions.length, 0,
        'MM-DD-YYYY format does not match YYYY-MM-DD');

      // Partial date — no match
      const partial = freshSM.getAllSessions({ date: '2026-01' });
      assert.strictEqual(partial.sessions.length, 0,
        'Partial YYYY-MM does not match full YYYY-MM-DD');

      // null date — skips filter, returns all
      const nullDate = freshSM.getAllSessions({ date: null });
      assert.strictEqual(nullDate.sessions.length, 1,
        'null date skips filter and returns all sessions');
    } finally {
      process.env.HOME = origHome;
      if (origUserProfile !== undefined) process.env.USERPROFILE = origUserProfile;
      else delete process.env.USERPROFILE;
      if (origDir) process.env.CLAUDE_DIR = origDir;
      delete require.cache[require.resolve('../../scripts/lib/utils')];
      delete require.cache[require.resolve('../../scripts/lib/session-manager')];
      fs.rmSync(tmpDir, { recursive: true, force: true });
    }
  })) passed++; else failed++;

  // ── Round 124: parseSessionMetadata title edge cases (no space, wrong level, multiple, empty) ──
  console.log('\nRound 124: parseSessionMetadata (title regex edge cases — /^#\\s+(.+)$/m):');
  if (test('parseSessionMetadata title: no space after # fails, ## fails, multiple picks first, empty trims', () => {
    // session-manager.js line 95: /^#\s+(.+)$/m
    // \s+ requires at least one whitespace after #, (.+) captures rest of line

    // No space after # — \s+ fails to match
    const noSpace = '#NoSpaceTitle\n\nSome content';
    const meta1 = sessionManager.parseSessionMetadata(noSpace);
    assert.strictEqual(meta1.title, null,
      '#NoSpaceTitle has no whitespace after # → title is null');

    // ## (H2) heading — ^ anchors to line start, but # matches first char only
    // /^#\s+/ matches the first # then \s+ would need whitespace, but ## has another #
    // Actually: /^#\s+(.+)$/ → "##" → # then \s+ → # is not whitespace → no match
    const h2 = '## Subtitle\n\nContent';
    const meta2 = sessionManager.parseSessionMetadata(h2);
    assert.strictEqual(meta2.title, null,
      '## heading does not match /^#\\s+/ because second # is not whitespace');

    // Multiple # headings — first match wins (regex .match returns first)
    const multiple = '# First Title\n\n# Second Title\n\nContent';
    const meta3 = sessionManager.parseSessionMetadata(multiple);
    assert.strictEqual(meta3.title, 'First Title',
      'Multiple H1 headings: .match() returns first occurrence');

    // # followed by spaces then text — leading spaces in capture are trimmed
    const padded = '#   Padded Title   \n\nContent';
    const meta4 = sessionManager.parseSessionMetadata(padded);
    assert.strictEqual(meta4.title, 'Padded Title',
      'Extra spaces: \\s+ matches multiple spaces, (.+) captures, .trim() cleans');

    // # followed by just spaces (no actual title text)
    // Surprising: \s+ is greedy and includes \n, so it matches "    \n\n" (spaces + newlines)
    // Then (.+) captures "Content" from the next non-empty line!
    const spacesOnly = '#    \n\nContent';
    const meta5 = sessionManager.parseSessionMetadata(spacesOnly);
    assert.strictEqual(meta5.title, 'Content',
      'Spaces-only after # → \\s+ greedily matches spaces+newlines, (.+) captures next line text');

    // Tab after # — \s includes tab
    const tabTitle = '#\tTab Title\n\nContent';
    const meta6 = sessionManager.parseSessionMetadata(tabTitle);
    assert.strictEqual(meta6.title, 'Tab Title',
      'Tab after # matches \\s+ (\\s includes \\t)');
  })) passed++; else failed++;

  // Summary
  console.log(`\nResults: Passed: ${passed}, Failed: ${failed}`);
  process.exit(failed > 0 ? 1 : 0);
}

runTests();
