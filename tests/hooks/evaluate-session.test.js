/**
 * Tests for scripts/node/hooks/evaluate-session.js
 *
 * Tests the session evaluation threshold logic, config loading,
 * and transcript parsing. Uses temporary JSONL transcript files.
 *
 * Adapted for local codebase where:
 * - Script path is scripts/node/hooks/evaluate-session.js
 * - Transcript path is passed via CLAUDE_TRANSCRIPT_PATH env var (not stdin)
 * - Config catch block is silent (no "Failed to parse config" message)
 *
 * Run with: node tests/hooks/evaluate-session.test.js
 */

const assert = require('assert');
const path = require('path');
const fs = require('fs');
const os = require('os');
const { spawnSync } = require('child_process');

const evaluateScript = path.join(__dirname, '..', '..', 'scripts', 'node', 'hooks', 'evaluate-session.js');

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
 * Each line is a JSON object with "type":"user".
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
 * Run evaluate-session.js with CLAUDE_TRANSCRIPT_PATH env var.
 * Returns { code, stdout, stderr }.
 */
function runEvaluate(transcriptPath, extraEnv = {}) {
  const env = { ...process.env, ...extraEnv };
  if (transcriptPath) {
    env.CLAUDE_TRANSCRIPT_PATH = transcriptPath;
  } else {
    delete env.CLAUDE_TRANSCRIPT_PATH;
  }
  const result = spawnSync('node', [evaluateScript], {
    encoding: 'utf8',
    input: '',
    timeout: 10000,
    env,
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
    const result = runEvaluate(transcript);
    assert.strictEqual(result.code, 0, 'Should exit 0');
    assert.ok(
      result.stderr.includes('too short') || result.stderr.includes('9 messages'),
      'Should indicate session too short'
    );
    cleanupTestDir(testDir);
  })) passed++; else failed++;

  if (test('evaluates session with exactly 10 user messages (at threshold)', () => {
    const testDir = createTestDir();
    const transcript = createTranscript(testDir, 10);
    const result = runEvaluate(transcript);
    assert.strictEqual(result.code, 0, 'Should exit 0');
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
    const result = runEvaluate(transcript);
    assert.strictEqual(result.code, 0);
    assert.ok(!result.stderr.includes('too short'), 'Should NOT say too short');
    assert.ok(result.stderr.includes('evaluate'), 'Should trigger evaluation');
    cleanupTestDir(testDir);
  })) passed++; else failed++;

  // Edge cases
  console.log('\nEdge cases:');

  if (test('exits 0 with missing CLAUDE_TRANSCRIPT_PATH', () => {
    const result = runEvaluate(null);
    assert.strictEqual(result.code, 0, 'Should exit 0 gracefully');
  })) passed++; else failed++;

  if (test('exits 0 with non-existent transcript file', () => {
    const result = runEvaluate('/nonexistent/path/transcript.jsonl');
    assert.strictEqual(result.code, 0, 'Should exit 0 gracefully');
  })) passed++; else failed++;

  if (test('skips empty transcript file (0 user messages)', () => {
    const testDir = createTestDir();
    const filePath = path.join(testDir, 'empty.jsonl');
    fs.writeFileSync(filePath, '');
    const result = runEvaluate(filePath);
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
    // 5 user messages + 50 assistant messages - should still be "too short"
    const lines = [];
    for (let i = 0; i < 5; i++) {
      lines.push(JSON.stringify({ type: 'user', content: `msg ${i}` }));
    }
    for (let i = 0; i < 50; i++) {
      lines.push(JSON.stringify({ type: 'assistant', content: `resp ${i}` }));
    }
    fs.writeFileSync(filePath, lines.join('\n') + '\n');

    const result = runEvaluate(filePath);
    assert.strictEqual(result.code, 0);
    assert.ok(
      result.stderr.includes('too short') || result.stderr.includes('5 messages'),
      'Should count only user messages'
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

    const result = runEvaluate(filePath);
    assert.strictEqual(result.code, 0);
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

    const result = runEvaluate(filePath);
    assert.strictEqual(result.code, 0);
    // countInFile uses regex matching - counts all lines matching /"type":"user"/
    // 12 user messages >= 10 threshold -> should evaluate
    assert.ok(
      result.stderr.includes('evaluate') && result.stderr.includes('12 messages'),
      'Should evaluate session with 12 valid user messages'
    );
    cleanupTestDir(testDir);
  })) passed++; else failed++;

  // Config file parsing
  console.log('\nConfig file parsing:');

  if (test('uses default min_session_length when no config exists', () => {
    const testDir = createTestDir();
    // Create 4 user messages (below default threshold of 10)
    const transcript = createTranscript(testDir, 4);
    const result = runEvaluate(transcript);
    assert.strictEqual(result.code, 0);
    // With default min=10, 4 messages should be too short
    assert.ok(
      result.stderr.includes('too short') || result.stderr.includes('4 messages'),
      'With default config, 4 messages should be too short'
    );
    cleanupTestDir(testDir);
  })) passed++; else failed++;

  if (test('falls back to defaults when config file contains invalid JSON', () => {
    // The evaluate-session.js script reads config from:
    //   path.join(__dirname, '..', '..', 'skills', 'continuous-learning', 'config.json')
    //   where __dirname = scripts/node/hooks/
    //   -> scripts/skills/continuous-learning/config.json
    const configPath = path.join(__dirname, '..', '..', 'scripts', 'node', 'hooks',
      '..', '..', 'skills', 'continuous-learning', 'config.json');
    const configDir = path.dirname(configPath);
    let originalContent = null;
    let dirCreated = false;

    try {
      try {
        originalContent = fs.readFileSync(configPath, 'utf8');
      } catch {
        // Config file may not exist - create directory if needed
        if (!fs.existsSync(configDir)) {
          fs.mkdirSync(configDir, { recursive: true });
          dirCreated = true;
        }
      }

      // Write corrupt JSON
      fs.writeFileSync(configPath, 'NOT VALID JSON {{{ corrupt data !!!', 'utf8');

      // Create a transcript with 12 user messages (above default threshold of 10)
      const testDir = createTestDir();
      const transcript = createTranscript(testDir, 12);
      const result = runEvaluate(transcript);

      assert.strictEqual(result.code, 0, 'Should exit 0 despite corrupt config');
      // With corrupt config, defaults apply: min_session_length = 10
      // 12 >= 10 -> should evaluate (not "too short")
      assert.ok(!result.stderr.includes('too short'),
        `Should NOT say too short - corrupt config falls back to default min=10. Got: ${result.stderr}`);
      assert.ok(
        result.stderr.includes('12 messages') || result.stderr.includes('evaluate'),
        `Should evaluate with 12 messages using default threshold. Got: ${result.stderr}`
      );

      cleanupTestDir(testDir);
    } finally {
      // Restore original config file
      if (originalContent !== null) {
        fs.writeFileSync(configPath, originalContent, 'utf8');
      } else {
        try { fs.unlinkSync(configPath); } catch { /* best-effort */ }
        if (dirCreated) {
          try { fs.rmSync(configDir, { recursive: true, force: true }); } catch { /* best-effort */ }
        }
      }
    }
  })) passed++; else failed++;

  if (test('uses learned_skills_path from config with ~ expansion', () => {
    const configPath = path.join(__dirname, '..', '..', 'scripts', 'node', 'hooks',
      '..', '..', 'skills', 'continuous-learning', 'config.json');
    const configDir = path.dirname(configPath);
    let originalContent = null;
    let dirCreated = false;

    try {
      try {
        originalContent = fs.readFileSync(configPath, 'utf8');
      } catch {
        if (!fs.existsSync(configDir)) {
          fs.mkdirSync(configDir, { recursive: true });
          dirCreated = true;
        }
      }

      // Write config with a custom learned_skills_path using ~ prefix
      fs.writeFileSync(configPath, JSON.stringify({
        min_session_length: 10,
        learned_skills_path: '~/custom-learned-skills-dir'
      }));

      // Create a transcript with 12 user messages (above threshold)
      const testDir = createTestDir();
      const transcript = createTranscript(testDir, 12);
      const result = runEvaluate(transcript);

      assert.strictEqual(result.code, 0, 'Should exit 0');
      // The script logs "Save learned skills to: <path>" where <path> should
      // be the expanded home directory, NOT the literal "~"
      assert.ok(!result.stderr.includes('~/custom-learned-skills-dir'),
        'Should NOT contain literal ~ in output (should be expanded)');
      assert.ok(result.stderr.includes('custom-learned-skills-dir'),
        `Should reference the custom learned skills dir. Got: ${result.stderr}`);
      assert.ok(result.stderr.includes(os.homedir()),
        `Should contain expanded home directory. Got: ${result.stderr}`);

      cleanupTestDir(testDir);
    } finally {
      if (originalContent !== null) {
        fs.writeFileSync(configPath, originalContent, 'utf8');
      } else {
        try { fs.unlinkSync(configPath); } catch { /* best-effort */ }
        if (dirCreated) {
          try { fs.rmSync(configDir, { recursive: true, force: true }); } catch { /* best-effort */ }
        }
      }
    }
  })) passed++; else failed++;

  // Summary
  console.log(`\n=== Test Results ===`);
  console.log(`Passed: ${passed}, Failed: ${failed}`);
  process.exit(failed > 0 ? 1 : 0);
}

runTests();
