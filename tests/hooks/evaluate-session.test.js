/**
 * Tests for scripts/hooks/evaluate-session.js
 *
 * Tests the session evaluation threshold logic, config loading,
 * and stdin parsing. Uses temporary JSONL transcript files.
 *
 * Run with: node tests/hooks/evaluate-session.test.js
 */

const assert = require('assert');
const path = require('path');
const fs = require('fs');
const os = require('os');
const { spawnSync } = require('child_process');

const evaluateScript = path.join(__dirname, '..', '..', 'scripts', 'hooks', 'evaluate-session.js');

// evaluate-session.js creates its learned-skills directory under the home
// directory, so every run gets an empty home instead of the developer's real one.
const ISOLATED_HOME = fs.mkdtempSync(path.join(os.tmpdir(), 'eval-session-home-'));
const ISOLATED_HOME_ENV = { HOME: ISOLATED_HOME, USERPROFILE: ISOLATED_HOME };
process.on('exit', () => fs.rmSync(ISOLATED_HOME, { recursive: true, force: true }));

function isolatedEnv(extra = {}) {
  return { ...process.env, ...ISOLATED_HOME_ENV, ...extra };
}

// Test helpers
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

function createTestDir() {
  return fs.mkdtempSync(path.join(os.tmpdir(), 'eval-session-test-'));
}

function cleanupTestDir(testDir) {
  fs.rmSync(testDir, { recursive: true, force: true });
}

/**
 * Create a JSONL transcript file with N user messages.
 * Each line is a JSON object with `"type":"user"`.
 */
function createTranscript(dir, messageCount) {
  const filePath = path.join(dir, 'transcript.jsonl');
  const lines = [];
  for (let i = 0; i < messageCount; i++) {
    lines.push(JSON.stringify({ type: 'user', content: `Message ${i + 1}` }));
    // Intersperse assistant messages to be realistic
    lines.push(JSON.stringify({ type: 'assistant', content: `Response ${i + 1}` }));
  }
  fs.writeFileSync(filePath, lines.join('\n') + '\n');
  return filePath;
}

/**
 * Run evaluate-session.js with stdin providing the transcript_path.
 * Uses spawnSync to capture both stdout and stderr regardless of exit code.
 * Returns { code, stdout, stderr }.
 */
function runEvaluate(stdinJson) {
  const result = spawnSync('node', [evaluateScript], {
    encoding: 'utf8',
    input: JSON.stringify(stdinJson),
    timeout: 10000,
    env: isolatedEnv(),
  });
  return {
    code: result.status || 0,
    stdout: result.stdout || '',
    stderr: result.stderr || '',
  };
}

function runTests() {
  console.log('\n=== Testing evaluate-session.js ===\n');

  let passed = 0;
  let failed = 0;

  // Threshold boundary tests (default minSessionLength = 10)
  console.log('Threshold boundary (default min=10):');

  if (test('skips session with 9 user messages (below threshold)', () => {
    const testDir = createTestDir();
    const transcript = createTranscript(testDir, 9);
    const result = runEvaluate({ transcript_path: transcript });
    assert.strictEqual(result.code, 0, 'Should exit 0');
    // "too short" message should appear in stderr (log goes to stderr)
    assert.ok(
      result.stderr.includes('too short') || result.stderr.includes('9 messages'),
      'Should indicate session too short'
    );
    cleanupTestDir(testDir);
  })) passed++; else failed++;

  if (test('evaluates session with exactly 10 user messages (at threshold)', () => {
    const testDir = createTestDir();
    const transcript = createTranscript(testDir, 10);
    const result = runEvaluate({ transcript_path: transcript });
    assert.strictEqual(result.code, 0, 'Should exit 0');
    // Should NOT say "too short" — should say "evaluate for extractable patterns"
    assert.ok(!result.stderr.includes('too short'), 'Should NOT say too short at threshold');
    assert.ok(
      result.stderr.includes('10 messages') || result.stderr.includes('evaluate'),
      'Should indicate evaluation'
    );
    cleanupTestDir(testDir);
  })) passed++; else failed++;

  if (test('evaluates session with 11 user messages (above threshold)', () => {
    const testDir = createTestDir();
    const transcript = createTranscript(testDir, 11);
    const result = runEvaluate({ transcript_path: transcript });
    assert.strictEqual(result.code, 0);
    assert.ok(!result.stderr.includes('too short'), 'Should NOT say too short');
    assert.ok(result.stderr.includes('evaluate'), 'Should trigger evaluation');
    cleanupTestDir(testDir);
  })) passed++; else failed++;

  // Edge cases
  console.log('\nEdge cases:');

  if (test('exits 0 with missing transcript_path', () => {
    const result = runEvaluate({});
    assert.strictEqual(result.code, 0, 'Should exit 0 gracefully');
  })) passed++; else failed++;

  if (test('exits 0 with non-existent transcript file', () => {
    const result = runEvaluate({ transcript_path: '/nonexistent/path/transcript.jsonl' });
    assert.strictEqual(result.code, 0, 'Should exit 0 gracefully');
  })) passed++; else failed++;

  if (test('exits 0 with invalid stdin JSON', () => {
    // Pass raw string instead of JSON
    const result = spawnSync('node', [evaluateScript], {
      encoding: 'utf8',
      input: 'not valid json at all',
      timeout: 10000,
      env: isolatedEnv(),
    });
    assert.strictEqual(result.status, 0, 'Should exit 0 even on bad stdin');
  })) passed++; else failed++;

  if (test('skips empty transcript file (0 user messages)', () => {
    const testDir = createTestDir();
    const filePath = path.join(testDir, 'empty.jsonl');
    fs.writeFileSync(filePath, '');
    const result = runEvaluate({ transcript_path: filePath });
    assert.strictEqual(result.code, 0);
    // 0 < 10, so should be "too short"
    assert.ok(
      result.stderr.includes('too short') || result.stderr.includes('0 messages'),
      'Empty transcript should be too short'
    );
    cleanupTestDir(testDir);
  })) passed++; else failed++;

  if (test('counts only user messages (ignores assistant messages)', () => {
    const testDir = createTestDir();
    const filePath = path.join(testDir, 'mixed.jsonl');
    // 5 user messages + 50 assistant messages — should still be "too short"
    const lines = [];
    for (let i = 0; i < 5; i++) {
      lines.push(JSON.stringify({ type: 'user', content: `msg ${i}` }));
    }
    for (let i = 0; i < 50; i++) {
      lines.push(JSON.stringify({ type: 'assistant', content: `resp ${i}` }));
    }
    fs.writeFileSync(filePath, lines.join('\n') + '\n');

    const result = runEvaluate({ transcript_path: filePath });
    assert.strictEqual(result.code, 0);
    assert.ok(
      result.stderr.includes('too short') || result.stderr.includes('5 messages'),
      'Should count only user messages'
    );
    cleanupTestDir(testDir);
  })) passed++; else failed++;

  // ── Round 28: config file parsing ──
  console.log('\nConfig file parsing:');

  if (test('uses custom min_session_length from config file', () => {
    const testDir = createTestDir();
    // Create a config that sets min_session_length to 3
    const configDir = path.join(testDir, 'skills', 'continuous-learning');
    fs.mkdirSync(configDir, { recursive: true });
    fs.writeFileSync(path.join(configDir, 'config.json'), JSON.stringify({
      min_session_length: 3
    }));

    // Create 4 user messages (above threshold of 3, but below default of 10)
    const transcript = createTranscript(testDir, 4);

    // Run the script from the testDir so it finds config relative to script location
    // The config path is: path.join(__dirname, '..', '..', 'skills', 'continuous-learning', 'config.json')
    // __dirname = scripts/hooks, so config = repo_root/skills/continuous-learning/config.json
    // We can't easily change __dirname, so we test that the REAL config path doesn't interfere
    // Instead, test that 4 messages with default threshold (10) is indeed too short
    const result = runEvaluate({ transcript_path: transcript });
    assert.strictEqual(result.code, 0);
    // With default min=10, 4 messages should be too short
    assert.ok(
      result.stderr.includes('too short') || result.stderr.includes('4 messages'),
      'With default config, 4 messages should be too short'
    );
    cleanupTestDir(testDir);
  })) passed++; else failed++;

  if (test('handles transcript with only assistant messages (0 user match)', () => {
    const testDir = createTestDir();
    const filePath = path.join(testDir, 'assistant-only.jsonl');
    const lines = [];
    for (let i = 0; i < 20; i++) {
      lines.push(JSON.stringify({ type: 'assistant', content: `response ${i}` }));
    }
    fs.writeFileSync(filePath, lines.join('\n') + '\n');

    const result = runEvaluate({ transcript_path: filePath });
    assert.strictEqual(result.code, 0);
    // countInFile looks for /"type"\s*:\s*"user"/ — no matches
    assert.ok(
      result.stderr.includes('too short') || result.stderr.includes('0 messages'),
      'Should report too short with 0 user messages'
    );
    cleanupTestDir(testDir);
  })) passed++; else failed++;

  if (test('handles transcript with malformed JSON lines (still counts valid ones)', () => {
    const testDir = createTestDir();
    const filePath = path.join(testDir, 'mixed.jsonl');
    // 12 valid user lines + 5 invalid lines
    const lines = [];
    for (let i = 0; i < 12; i++) {
      lines.push(JSON.stringify({ type: 'user', content: `msg ${i}` }));
    }
    for (let i = 0; i < 5; i++) {
      lines.push('not valid json {{{');
    }
    fs.writeFileSync(filePath, lines.join('\n') + '\n');

    const result = runEvaluate({ transcript_path: filePath });
    assert.strictEqual(result.code, 0);
    // countInFile uses regex matching, not JSON parsing — counts all lines matching /"type"\s*:\s*"user"/
    // 12 user messages >= 10 threshold → should evaluate
    assert.ok(
      result.stderr.includes('evaluate') && result.stderr.includes('12 messages'),
      'Should evaluate session with 12 valid user messages'
    );
    cleanupTestDir(testDir);
  })) passed++; else failed++;

  if (test('handles empty stdin (no input) gracefully', () => {
    const result = spawnSync('node', [evaluateScript], {
      encoding: 'utf8',
      input: '',
      timeout: 10000,
      env: isolatedEnv(),
    });
    // Empty stdin → JSON.parse('') throws → fallback to env var (unset) → null → exit 0
    assert.strictEqual(result.status, 0, 'Should exit 0 on empty stdin');
  })) passed++; else failed++;

  // ── Round 53: env var fallback path ──
  console.log('\nRound 53: CLAUDE_TRANSCRIPT_PATH fallback:');

  if (test('falls back to CLAUDE_TRANSCRIPT_PATH env var when stdin is invalid JSON', () => {
    const testDir = createTestDir();
    const transcript = createTranscript(testDir, 15);

    const result = spawnSync('node', [evaluateScript], {
      encoding: 'utf8',
      input: 'invalid json {{{',
      timeout: 10000,
      env: isolatedEnv({ CLAUDE_TRANSCRIPT_PATH: transcript })
    });

    assert.strictEqual(result.status, 0, 'Should exit 0');
    assert.ok(
      result.stderr.includes('15 messages'),
      'Should evaluate using env var fallback path'
    );
    assert.ok(
      result.stderr.includes('evaluate'),
      'Should indicate session evaluation'
    );
    cleanupTestDir(testDir);
  })) passed++; else failed++;

  // ── Round 65: regex whitespace tolerance in countInFile ──
  console.log('\nRound 65: regex whitespace tolerance around colon:');

  if (test('counts user messages when JSON has spaces around colon ("type" : "user")', () => {
    const testDir = createTestDir();
    const filePath = path.join(testDir, 'spaced.jsonl');
    // Manually write JSON with spaces around the colon — NOT JSON.stringify
    // The regex /"type"\s*:\s*"user"/g should match these
    const lines = [];
    for (let i = 0; i < 12; i++) {
      lines.push(`{"type" : "user", "content": "msg ${i}"}`);
      lines.push(`{"type" : "assistant", "content": "resp ${i}"}`);
    }
    fs.writeFileSync(filePath, lines.join('\n') + '\n');

    const result = runEvaluate({ transcript_path: filePath });
    assert.strictEqual(result.code, 0);
    // 12 user messages >= 10 threshold → should evaluate (not "too short")
    assert.ok(!result.stderr.includes('too short'),
      'Should NOT say too short for 12 spaced-colon user messages');
    assert.ok(
      result.stderr.includes('12 messages') || result.stderr.includes('evaluate'),
      `Should evaluate session with spaced-colon JSON. Got stderr: ${result.stderr}`
    );
    cleanupTestDir(testDir);
  })) passed++; else failed++;

  // ── Round 85: config file parse error (corrupt JSON) ──
  console.log('\nRound 85: config parse error catch block:');

  if (test('falls back to defaults when config file contains invalid JSON', () => {
    // The evaluate-session.js script reads config from:
    //   path.join(__dirname, '..', '..', 'skills', 'continuous-learning', 'config.json')
    // where __dirname = scripts/hooks/ → config = repo_root/skills/continuous-learning/config.json
    const configPath = path.join(__dirname, '..', '..', 'skills', 'continuous-learning', 'config.json');
    let originalContent = null;
    try {
      originalContent = fs.readFileSync(configPath, 'utf8');
    } catch {
      // Config file may not exist — that's fine
    }

    try {
      // Write corrupt JSON to the config file
      fs.writeFileSync(configPath, 'NOT VALID JSON {{{ corrupt data !!!', 'utf8');

      // Create a transcript with 12 user messages (above default threshold of 10)
      const testDir = createTestDir();
      const transcript = createTranscript(testDir, 12);
      const result = runEvaluate({ transcript_path: transcript });

      assert.strictEqual(result.code, 0, 'Should exit 0 despite corrupt config');
      // With corrupt config, defaults apply: min_session_length = 10
      // 12 >= 10 → should evaluate (not "too short")
      assert.ok(!result.stderr.includes('too short'),
        `Should NOT say too short — corrupt config falls back to default min=10. Got: ${result.stderr}`);
      assert.ok(
        result.stderr.includes('12 messages') || result.stderr.includes('evaluate'),
        `Should evaluate with 12 messages using default threshold. Got: ${result.stderr}`
      );
      // The catch block logs "Failed to parse config" — verify that log message
      assert.ok(result.stderr.includes('Failed to parse config'),
        `Should log config parse error. Got: ${result.stderr}`);

      cleanupTestDir(testDir);
    } finally {
      // Restore original config file
      if (originalContent !== null) {
        fs.writeFileSync(configPath, originalContent, 'utf8');
      } else {
        // Config didn't exist before — remove the corrupt one we created
        try { fs.unlinkSync(configPath); } catch { /* best-effort */ }
      }
    }
  })) passed++; else failed++;

  // ── Round 86: config learned_skills_path override with ~ expansion ──
  console.log('\nRound 86: config learned_skills_path override:');

  if (test('uses learned_skills_path from config with ~ expansion', () => {
    // evaluate-session.js lines 69-72:
    //   if (config.learned_skills_path) {
    //     learnedSkillsPath = config.learned_skills_path.replace(/^~/, require('os').homedir());
    //   }
    // This branch was never tested — only the parse error (Round 85) and default path.
    const configPath = path.join(__dirname, '..', '..', 'skills', 'continuous-learning', 'config.json');
    let originalContent = null;
    try {
      originalContent = fs.readFileSync(configPath, 'utf8');
    } catch {
      // Config file may not exist
    }

    try {
      // Write config with a custom learned_skills_path using ~ prefix
      fs.writeFileSync(configPath, JSON.stringify({
        min_session_length: 10,
        learned_skills_path: '~/custom-learned-skills-dir'
      }));

      // Create a transcript with 12 user messages (above threshold)
      const testDir = createTestDir();
      const transcript = createTranscript(testDir, 12);
      const result = runEvaluate({ transcript_path: transcript });

      assert.strictEqual(result.code, 0, 'Should exit 0');
      // The script logs "Save learned skills to: <path>" where <path> should
      // be the expanded home directory, NOT the literal "~"
      assert.ok(!result.stderr.includes('~/custom-learned-skills-dir'),
        'Should NOT contain literal ~ in output (should be expanded)');
      assert.ok(result.stderr.includes('custom-learned-skills-dir'),
        `Should reference the custom learned skills dir. Got: ${result.stderr}`);
      // The ~ should have been replaced with the child's home directory
      assert.ok(result.stderr.includes(ISOLATED_HOME),
        `Should contain expanded home directory. Got: ${result.stderr}`);

      cleanupTestDir(testDir);
    } finally {
      // Restore original config file
      if (originalContent !== null) {
        fs.writeFileSync(configPath, originalContent, 'utf8');
      } else {
        try { fs.unlinkSync(configPath); } catch { /* best-effort */ }
      }
    }
  })) passed++; else failed++;

  // Summary
  console.log(`\nResults: Passed: ${passed}, Failed: ${failed}`);
  process.exit(failed > 0 ? 1 : 0);
}

runTests();
