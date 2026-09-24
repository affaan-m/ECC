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
        JSON.stringify({ type: 'user', message: { role: 'user', content: userText } }) + '\n'
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

  console.log(`\nResults: Passed: ${passed}, Failed: ${failed}`);
  process.exit(failed > 0 ? 1 : 0);
}

runTests();
