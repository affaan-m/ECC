/**
 * Tests for session-end.js hook
 *
 * Run with: node tests/hooks/session-end.test.js
 */

const assert = require('assert');
const fs = require('fs');
const os = require('os');
const path = require('path');
const { spawnSync } = require('child_process');
const { getDateString, sanitizeSessionId } = require('../../scripts/lib/utils');

const script = path.join(__dirname, '..', '..', 'scripts', 'hooks', 'session-end.js');
const START = '<!-- ECC:SUMMARY:START -->';
const END = '<!-- ECC:SUMMARY:END -->';

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

function countOccurrences(haystack, needle) {
  let n = 0;
  let i = 0;
  while ((i = haystack.indexOf(needle, i)) !== -1) {
    n += 1;
    i += needle.length;
  }
  return n;
}

function runHook(home, transcript, env = {}) {
  return spawnSync('node', [script], {
    encoding: 'utf8',
    input: transcript ? JSON.stringify({ transcript_path: transcript }) : '',
    env: { ...process.env, HOME: home, USERPROFILE: home, CLAUDE_SESSION_ID: '', ...env },
    timeout: 10000,
  });
}

function sessionFileFor(home, uuid) {
  const shortId = sanitizeSessionId(uuid.slice(-8).toLowerCase());
  return path.join(home, '.claude', 'session-data', `${getDateString()}-${shortId}-session.tmp`);
}

function runTests() {
  console.log('\n=== Testing session-end.js ===\n');

  let passed = 0;
  let failed = 0;

  // Regression: a user message containing $-sequences ($&, $$, $`, $') must be
  // written verbatim into the rewritten summary block. The block is fed to
  // String.prototype.replace as the replacement argument, where those sequences
  // are special — without escaping/a function replacer they corrupt the summary
  // (e.g. $& injects the entire matched old block, duplicating the markers).
  (test('preserves $-sequences in user messages when rewriting the summary block', () => {
    // Isolate HOME so getSessionsDir() resolves under a temp dir.
    const home = fs.mkdtempSync(path.join(os.tmpdir(), 'ecc-session-end-'));
    try {
      const sessionsDir = path.join(home, '.claude', 'session-data');
      fs.mkdirSync(sessionsDir, { recursive: true });

      // shortId is derived from the transcript filename UUID (last 8 chars).
      const uuid = 'abcdef12-3456-7890-abcd-ef0123456789';
      const shortId = sanitizeSessionId(uuid.slice(-8).toLowerCase());
      const today = getDateString();
      const sessionFile = path.join(sessionsDir, `${today}-${shortId}-session.tmp`);

      // Pre-seed a session file that already has summary markers, so the
      // idempotent rewrite path runs .replace() with the new summary block.
      fs.writeFileSync(
        sessionFile,
        `# Session: ${today}\n**Date:** ${today}\n---\n${START}\n## Session Summary\n\n### Tasks\n- old task\n${END}\n`
      );

      // Transcript whose user message contains replacement-special $-sequences.
      const userText = 'release $& fallback $$ done';
      const transcript = path.join(home, `${uuid}.jsonl`);
      fs.writeFileSync(
        transcript,
        [
          JSON.stringify({ type: 'user', message: { role: 'user', content: userText } }),
          JSON.stringify({ type: 'tool_use', tool_name: 'Edit', tool_input: { file_path: '/src/release.js' } }),
        ].join('\n') + '\n'
      );

      const res = spawnSync('node', [script], {
        encoding: 'utf8',
        input: JSON.stringify({ transcript_path: transcript }),
        env: { ...process.env, HOME: home, USERPROFILE: home, CLAUDE_SESSION_ID: '' },
        timeout: 10000,
      });
      assert.strictEqual(res.status || 0, 0, `hook exited ${res.status}: ${res.stderr}`);

      const out = fs.readFileSync(sessionFile, 'utf8');
      // User text must survive verbatim (no $&/$$ interpretation).
      assert.ok(out.includes(`- ${userText}`), `expected verbatim user text in:\n${out}`);
      // Exactly one marker pair — a $& bug re-injects the matched block, duplicating markers.
      assert.strictEqual(countOccurrences(out, START), 1, `START marker should appear once:\n${out}`);
      assert.strictEqual(countOccurrences(out, END), 1, `END marker should appear once:\n${out}`);
    } finally {
      fs.rmSync(home, { recursive: true, force: true });
    }
  }) ? passed++ : failed++);

  (test('writes a session for a multi-message transcript', () => {
    const home = fs.mkdtempSync(path.join(os.tmpdir(), 'ecc-session-end-'));
    try {
      const uuid = '11111111-2222-4333-8444-555555555555';
      const transcript = path.join(home, `${uuid}.jsonl`);
      fs.writeFileSync(
        transcript,
        [
          JSON.stringify({ type: 'user', content: 'Investigate the failing hook' }),
          JSON.stringify({ type: 'user', content: 'Add regression coverage' }),
        ].join('\n') + '\n'
      );

      const res = runHook(home, transcript);
      assert.strictEqual(res.status || 0, 0, `hook exited ${res.status}: ${res.stderr}`);

      const sessionFile = sessionFileFor(home, uuid);
      const out = fs.readFileSync(sessionFile, 'utf8');
      assert.ok(out.includes(START), 'Should include the generated summary start marker');
      assert.ok(out.includes(END), 'Should include the generated summary end marker');
      assert.ok(out.includes('**Last Updated:**'), 'Should include session metadata');
      assert.ok(out.includes('Add regression coverage'), 'Should include the latest user task');
    } finally {
      fs.rmSync(home, { recursive: true, force: true });
    }
  }) ? passed++ : failed++);

  (test('writes a session for one user message with tool activity', () => {
    const home = fs.mkdtempSync(path.join(os.tmpdir(), 'ecc-session-end-'));
    try {
      const uuid = 'aaaaaaaa-bbbb-4ccc-8ddd-eeeeeeeeeeee';
      const transcript = path.join(home, `${uuid}.jsonl`);
      fs.writeFileSync(
        transcript,
        [
          JSON.stringify({ type: 'user', content: 'Fix the configuration' }),
          JSON.stringify({ type: 'tool_use', tool_name: 'Edit', tool_input: { file_path: '/src/config.js' } }),
        ].join('\n') + '\n'
      );

      const res = runHook(home, transcript);
      assert.strictEqual(res.status || 0, 0, `hook exited ${res.status}: ${res.stderr}`);
      assert.ok(fs.existsSync(sessionFileFor(home, uuid)), 'Tool activity should make the session eligible');
    } finally {
      fs.rmSync(home, { recursive: true, force: true });
    }
  }) ? passed++ : failed++);

  (test('skips a one-message prompt with no tool activity', () => {
    const home = fs.mkdtempSync(path.join(os.tmpdir(), 'ecc-session-end-'));
    try {
      const uuid = '12345678-1234-4234-8234-123456789abc';
      const transcript = path.join(home, `${uuid}.jsonl`);
      fs.writeFileSync(transcript, JSON.stringify({ type: 'user', content: 'Print the current version' }) + '\n');

      const res = runHook(home, transcript);
      assert.strictEqual(res.status || 0, 0, `hook exited ${res.status}: ${res.stderr}`);
      assert.ok(!fs.existsSync(sessionFileFor(home, uuid)), 'One-shot prompt should not create a session file');
      assert.ok(!fs.existsSync(path.join(home, '.claude', 'session-data')), 'Rejected transcript should not create the sessions directory');
    } finally {
      fs.rmSync(home, { recursive: true, force: true });
    }
  }) ? passed++ : failed++);

  (test('skips a one-message summarizer-style transcript without prompt matching', () => {
    const home = fs.mkdtempSync(path.join(os.tmpdir(), 'ecc-session-end-'));
    try {
      const uuid = 'fedcba98-7654-4321-8765-fedcba987654';
      const transcript = path.join(home, `${uuid}.jsonl`);
      fs.writeFileSync(
        transcript,
        [
          JSON.stringify({ type: 'user', message: { role: 'user', content: 'Summarize the supplied conversation as concise markdown.' } }),
          JSON.stringify({ type: 'assistant', message: { role: 'assistant', content: '## Summary\nThe hook behavior was reviewed.' } }),
        ].join('\n') + '\n'
      );

      const res = runHook(home, transcript);
      assert.strictEqual(res.status || 0, 0, `hook exited ${res.status}: ${res.stderr}`);
      assert.ok(!fs.existsSync(sessionFileFor(home, uuid)), 'Summarizer subprocess should not create a session file');
    } finally {
      fs.rmSync(home, { recursive: true, force: true });
    }
  }) ? passed++ : failed++);

  (test('does not rewrite an existing session for a rejected transcript', () => {
    const home = fs.mkdtempSync(path.join(os.tmpdir(), 'ecc-session-end-'));
    try {
      const uuid = '99999999-8888-4777-8666-555555555555';
      const transcript = path.join(home, `${uuid}.jsonl`);
      const sessionFile = sessionFileFor(home, uuid);
      const original = '# Session: preserved\n**Last Updated:** 09:00\n\n---\n\nUser-authored context\n';
      const originalTime = new Date('2026-01-02T03:04:05.000Z');

      fs.mkdirSync(path.dirname(sessionFile), { recursive: true });
      fs.writeFileSync(sessionFile, original);
      fs.utimesSync(sessionFile, originalTime, originalTime);
      fs.writeFileSync(transcript, JSON.stringify({ type: 'user', content: 'Answer this one question' }) + '\n');

      const res = runHook(home, transcript);
      assert.strictEqual(res.status || 0, 0, `hook exited ${res.status}: ${res.stderr}`);
      assert.strictEqual(fs.readFileSync(sessionFile, 'utf8'), original, 'Rejected transcript should not change existing content');
      assert.strictEqual(fs.statSync(sessionFile).mtimeMs, originalTime.getTime(), 'Rejected transcript should not advance mtime');
    } finally {
      fs.rmSync(home, { recursive: true, force: true });
    }
  }) ? passed++ : failed++);

  (test('keeps fallback behavior when transcript metadata is malformed', () => {
    const home = fs.mkdtempSync(path.join(os.tmpdir(), 'ecc-session-end-'));
    try {
      const res = spawnSync('node', [script], {
        encoding: 'utf8',
        input: '{not-json',
        env: { ...process.env, HOME: home, USERPROFILE: home, CLAUDE_SESSION_ID: 'fallback-session-12345678', CLAUDE_TRANSCRIPT_PATH: '' },
        timeout: 10000,
      });
      assert.strictEqual(res.status || 0, 0, `hook exited ${res.status}: ${res.stderr}`);

      const sessionsDir = path.join(home, '.claude', 'session-data');
      assert.strictEqual(fs.readdirSync(sessionsDir).filter(name => name.endsWith('-session.tmp')).length, 1, 'Fallback should still create the placeholder session');
    } finally {
      fs.rmSync(home, { recursive: true, force: true });
    }
  }) ? passed++ : failed++);

  console.log(`\nResults: Passed: ${passed}, Failed: ${failed}`);
  process.exit(failed > 0 ? 1 : 0);
}

runTests();
