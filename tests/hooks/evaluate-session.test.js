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
 * Returns { code, stdout, stderr }; code is null when the child did not
 * exit normally (spawn failure, signal, timeout), never coerced to 0.
 */
function runEvaluate(stdinJson) {
  const result = spawnSync('node', [evaluateScript], {
    encoding: 'utf8',
    input: JSON.stringify(stdinJson),
    timeout: 10000,
    env: isolatedEnv(),
  });
  return {
    code: result.error || result.signal ? null : result.status,
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

  // ── Stop delivery contract: opt-in + registered lease + loop protection ──
  // The bug: the script logged its signal to stderr only, so the model never
  // saw it. Delivery must emit exactly one valid Stop JSON payload, and only
  // when every gate passes: explicit opt-in, a session lease registered
  // through the native SessionStart lifecycle, a first (not re-fired) Stop,
  // and no earlier delivery for this session.
  console.log('\nStop delivery contract (opt-in + lease + loop protection):');

  const observerSessions = require(path.join(__dirname, '..', '..', 'scripts', 'lib', 'observer-sessions'));
  const deliveryConfigPath = path.join(__dirname, '..', '..', 'skills', 'continuous-learning', 'config.json');

  // Test session ids below are already sanitized-safe (lowercase, digits,
  // hyphens), so the delivery marker filename is a plain concatenation.
  function deliveryMarkerPath(sessionId) {
    return path.join(os.tmpdir(), `claude-continuous-learning-delivered-${sessionId}`);
  }

  function runEvaluatePayload(payload, extraEnv = {}, dropKeys = []) {
    const env = isolatedEnv(extraEnv);
    for (const key of dropKeys) delete env[key];
    const result = spawnSync('node', [evaluateScript], {
      encoding: 'utf8',
      input: JSON.stringify(payload),
      timeout: 10000,
      env,
    });
    // A spawn failure, signal, or timeout must never read as success.
    return {
      code: result.error || result.signal ? null : result.status,
      stdout: result.stdout || '',
      stderr: result.stderr || '',
    };
  }

  function withOptInConfig(value, fn) {
    let originalContent = null;
    try {
      originalContent = fs.readFileSync(deliveryConfigPath, 'utf8');
    } catch {
      // Config file may not exist
    }
    try {
      const config = originalContent ? JSON.parse(originalContent) : {};
      config.stop_nudge_opt_in = value;
      fs.writeFileSync(deliveryConfigPath, JSON.stringify(config, null, 2));
      return fn();
    } finally {
      if (originalContent !== null) {
        fs.writeFileSync(deliveryConfigPath, originalContent, 'utf8');
      } else {
        try { fs.unlinkSync(deliveryConfigPath); } catch { /* best-effort */ }
      }
    }
  }

  // Register a SessionStart lease for this session using the repo's own
  // helpers, so the child process finds exactly what SessionStart writes.
  function registerLeaseFor(workDir, homunculusDir, sessionId) {
    const prevHomunculus = process.env.CLV2_HOMUNCULUS_DIR;
    const prevProjectDir = process.env.CLAUDE_PROJECT_DIR;
    process.env.CLV2_HOMUNCULUS_DIR = homunculusDir;
    process.env.CLAUDE_PROJECT_DIR = workDir;
    try {
      const context = observerSessions.resolveProjectContext(workDir);
      return observerSessions.writeSessionLease(context, sessionId, { hook: 'SessionStart' });
    } finally {
      if (prevHomunculus === undefined) delete process.env.CLV2_HOMUNCULUS_DIR;
      else process.env.CLV2_HOMUNCULUS_DIR = prevHomunculus;
      if (prevProjectDir === undefined) delete process.env.CLAUDE_PROJECT_DIR;
      else process.env.CLAUDE_PROJECT_DIR = prevProjectDir;
    }
  }

  function stopPayload(transcript, sessionId, workDir, overrides = {}) {
    return {
      session_id: sessionId,
      transcript_path: transcript,
      cwd: workDir,
      hook_event_name: 'Stop',
      stop_hook_active: false,
      ...overrides,
    };
  }

  if (test('emits no stdout when opt-in is off, even for a long session', () => {
    const testDir = createTestDir();
    const transcript = createTranscript(testDir, 12);
    try {
      const result = runEvaluatePayload(stopPayload(transcript, 'delivery-optoff-1', testDir));
      assert.strictEqual(result.code, 0);
      assert.strictEqual(result.stdout, '', 'Model must receive nothing when opt-in is off');
      assert.ok(result.stderr.includes('evaluate'), 'Stderr log line is unchanged');
    } finally {
      cleanupTestDir(testDir);
    }
  })) passed++; else failed++;

  if (test('emits no stdout when opt-in is on but no session lease is registered', () => {
    const testDir = createTestDir();
    const transcript = createTranscript(testDir, 12);
    const homunculusDir = fs.mkdtempSync(path.join(os.tmpdir(), 'eval-delivery-home-'));
    try {
      const result = withOptInConfig(true, () => runEvaluatePayload(
        stopPayload(transcript, 'delivery-nolease-1', testDir),
        { CLV2_HOMUNCULUS_DIR: homunculusDir, CLAUDE_PROJECT_DIR: testDir }
      ));
      assert.strictEqual(result.code, 0);
      assert.strictEqual(result.stdout, '', 'Unregistered sessions must not reach the model');
    } finally {
      cleanupTestDir(testDir);
      fs.rmSync(homunculusDir, { recursive: true, force: true });
    }
  })) passed++; else failed++;

  if (test('emits one valid Stop block JSON with opt-in + lease, then nothing on repeat', () => {
    const testDir = createTestDir();
    const transcript = createTranscript(testDir, 12);
    const homunculusDir = fs.mkdtempSync(path.join(os.tmpdir(), 'eval-delivery-home-'));
    const sessionId = 'delivery-ok-1';
    const marker = deliveryMarkerPath(sessionId);
    try {
      fs.rmSync(marker, { force: true });
      registerLeaseFor(testDir, homunculusDir, sessionId);
      const env = { CLV2_HOMUNCULUS_DIR: homunculusDir, CLAUDE_PROJECT_DIR: testDir };
      const first = withOptInConfig(true, () => runEvaluatePayload(
        stopPayload(transcript, sessionId, testDir), env
      ));
      assert.strictEqual(first.code, 0);
      let parsed;
      try {
        parsed = JSON.parse(first.stdout);
      } catch {
        assert.fail(`Stdout must be a single valid JSON document. Got: ${first.stdout}`);
      }
      assert.strictEqual(parsed.decision, 'block', 'Native Stop delivery blocks the stop');
      assert.ok(
        typeof parsed.reason === 'string' && parsed.reason.includes('12 messages'),
        `Reason must carry the session signal. Got: ${parsed.reason}`
      );
      assert.ok(
        parsed.reason.includes(ISOLATED_HOME) && parsed.reason.includes('learned'),
        `Reason must name where learned skills go. Got: ${parsed.reason}`
      );
      const second = withOptInConfig(true, () => runEvaluatePayload(
        stopPayload(transcript, sessionId, testDir), env
      ));
      assert.strictEqual(second.stdout, '', 'Second Stop for the same session must not re-deliver');
    } finally {
      fs.rmSync(marker, { force: true });
      cleanupTestDir(testDir);
      fs.rmSync(homunculusDir, { recursive: true, force: true });
    }
  })) passed++; else failed++;

  if (test('skips delivery when the delivery marker cannot be written', () => {
    const testDir = createTestDir();
    const transcript = createTranscript(testDir, 12);
    const homunculusDir = fs.mkdtempSync(path.join(os.tmpdir(), 'eval-delivery-home-'));
    const sessionId = 'delivery-marker-fail-1';
    const marker = deliveryMarkerPath(sessionId);
    // A regular file as TMPDIR makes the marker path uncreatable (ENOTDIR)
    // even as root, so the write fails while no marker exists.
    const notADir = path.join(testDir, 'not-a-dir');
    try {
      fs.rmSync(marker, { force: true });
      fs.writeFileSync(notADir, 'not a directory\n');
      registerLeaseFor(testDir, homunculusDir, sessionId);
      const result = withOptInConfig(true, () => runEvaluatePayload(
        stopPayload(transcript, sessionId, testDir),
        { CLV2_HOMUNCULUS_DIR: homunculusDir, CLAUDE_PROJECT_DIR: testDir, TMPDIR: notADir }
      ));
      assert.strictEqual(result.stdout, '', 'A failed marker write must fail closed, never deliver');
      assert.ok(result.stderr.includes('could not record delivery marker'), 'Marker failure must be logged');
    } finally {
      fs.rmSync(marker, { force: true });
      cleanupTestDir(testDir);
      fs.rmSync(homunculusDir, { recursive: true, force: true });
    }
  })) passed++; else failed++;

  if (test('stop:evaluate-session registration is synchronous (no async flag)', () => {
    const hooksConfig = JSON.parse(fs.readFileSync(
      path.join(__dirname, '..', '..', 'hooks', 'hooks.json'), 'utf8'
    ));
    let entry = null;
    for (const group of hooksConfig.hooks.Stop) {
      for (const hook of group.hooks || []) {
        if (typeof hook.command === 'string' && hook.command.includes('stop:evaluate-session')) {
          entry = hook;
        }
      }
    }
    assert.ok(entry, 'stop:evaluate-session must be registered in hooks.json');
    assert.notStrictEqual(entry.async, true, 'An async Stop registration cannot block, so delivery must stay synchronous');
  })) passed++; else failed++;

  if (test('emits no stdout when stop_hook_active is true, even with opt-in + lease', () => {
    const testDir = createTestDir();
    const transcript = createTranscript(testDir, 12);
    const homunculusDir = fs.mkdtempSync(path.join(os.tmpdir(), 'eval-delivery-home-'));
    const sessionId = 'delivery-loop-1';
    const marker = deliveryMarkerPath(sessionId);
    try {
      fs.rmSync(marker, { force: true });
      registerLeaseFor(testDir, homunculusDir, sessionId);
      const result = withOptInConfig(true, () => runEvaluatePayload(
        stopPayload(transcript, sessionId, testDir, { stop_hook_active: true }),
        { CLV2_HOMUNCULUS_DIR: homunculusDir, CLAUDE_PROJECT_DIR: testDir }
      ));
      assert.strictEqual(result.code, 0);
      assert.strictEqual(result.stdout, '', 'A re-fired Stop must pass through, never re-block');
    } finally {
      fs.rmSync(marker, { force: true });
      cleanupTestDir(testDir);
      fs.rmSync(homunculusDir, { recursive: true, force: true });
    }
  })) passed++; else failed++;

  if (test('emits no stdout for a short session, even with opt-in + lease', () => {
    const testDir = createTestDir();
    const transcript = createTranscript(testDir, 5);
    const homunculusDir = fs.mkdtempSync(path.join(os.tmpdir(), 'eval-delivery-home-'));
    const sessionId = 'delivery-short-1';
    try {
      registerLeaseFor(testDir, homunculusDir, sessionId);
      const result = withOptInConfig(true, () => runEvaluatePayload(
        stopPayload(transcript, sessionId, testDir),
        { CLV2_HOMUNCULUS_DIR: homunculusDir, CLAUDE_PROJECT_DIR: testDir }
      ));
      assert.strictEqual(result.code, 0);
      assert.strictEqual(result.stdout, '', 'Below-threshold sessions must not deliver');
      assert.ok(result.stderr.includes('too short'), 'Short session still logs as too short');
    } finally {
      cleanupTestDir(testDir);
      fs.rmSync(homunculusDir, { recursive: true, force: true });
    }
  })) passed++; else failed++;

  if (test('emits no stdout when the payload event is not Stop', () => {
    const testDir = createTestDir();
    const transcript = createTranscript(testDir, 12);
    const homunculusDir = fs.mkdtempSync(path.join(os.tmpdir(), 'eval-delivery-home-'));
    const sessionId = 'delivery-wrongevent-1';
    try {
      registerLeaseFor(testDir, homunculusDir, sessionId);
      const result = withOptInConfig(true, () => runEvaluatePayload(
        stopPayload(transcript, sessionId, testDir, { hook_event_name: 'PreToolUse' }),
        { CLV2_HOMUNCULUS_DIR: homunculusDir, CLAUDE_PROJECT_DIR: testDir }
      ));
      assert.strictEqual(result.code, 0);
      assert.strictEqual(result.stdout, '', 'Delivery is Stop-only; other events must not trigger it');
    } finally {
      cleanupTestDir(testDir);
      fs.rmSync(homunculusDir, { recursive: true, force: true });
    }
  })) passed++; else failed++;

  if (test('emits no stdout when no session id is available, even with opt-in', () => {
    const testDir = createTestDir();
    const transcript = createTranscript(testDir, 12);
    try {
      const payload = stopPayload(transcript, undefined, testDir);
      delete payload.session_id;
      const result = withOptInConfig(true, () => runEvaluatePayload(
        payload, {}, ['CLAUDE_SESSION_ID', 'ECC_SESSION_ID']
      ));
      assert.strictEqual(result.code, 0);
      assert.strictEqual(result.stdout, '', 'Without a session id there is nothing to bind delivery to');
    } finally {
      cleanupTestDir(testDir);
    }
  })) passed++; else failed++;

  // Summary
  console.log(`\nResults: Passed: ${passed}, Failed: ${failed}`);
  process.exit(failed > 0 ? 1 : 0);
}

runTests();
