/**
 * Tests for cost-tracker.js hook
 *
 * Run with: node tests/hooks/cost-tracker.test.js
 */

const assert = require('assert');
const path = require('path');
const fs = require('fs');
const os = require('os');
const { spawnSync } = require('child_process');

const script = path.join(__dirname, '..', '..', 'scripts', 'hooks', 'cost-tracker.js');

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

function makeTempDir() {
  return fs.mkdtempSync(path.join(os.tmpdir(), 'cost-tracker-test-'));
}

function withTempHome(homeDir) {
  return {
    HOME: homeDir,
    USERPROFILE: homeDir,
  };
}

function writeTranscript(filePath, entries) {
  fs.writeFileSync(
    filePath,
    entries.map(entry => JSON.stringify(entry)).join('\n') + '\n',
    'utf8'
  );
}

function runScript(input, envOverrides = {}) {
  const inputStr = typeof input === 'string' ? input : JSON.stringify(input);
  const result = spawnSync('node', [script], {
    encoding: 'utf8',
    input: inputStr,
    timeout: 10000,
    env: { ...process.env, ...envOverrides },
  });
  return { code: result.status || 0, stdout: result.stdout || '', stderr: result.stderr || '' };
}

function runTests() {
  console.log('\n=== Testing cost-tracker.js ===\n');

  let passed = 0;
  let failed = 0;

  // 1. Passes through input on stdout
  (test('passes through input on stdout', () => {
    const input = {
      model: 'claude-sonnet-4-20250514',
      usage: { input_tokens: 100, output_tokens: 50 },
    };
    const inputStr = JSON.stringify(input);
    const result = runScript(input);
    assert.strictEqual(result.code, 0, `Expected exit code 0, got ${result.code}`);
    assert.strictEqual(result.stdout, inputStr, 'Expected stdout to match original input');
  }) ? passed++ : failed++);

  // 2. Creates metrics file when given transcript usage data
  (test('creates metrics file when given transcript usage data', () => {
    const tmpHome = makeTempDir();
    const transcriptPath = path.join(tmpHome, 'session.jsonl');
    writeTranscript(transcriptPath, [
      { type: 'user', message: { content: 'ignored' } },
      {
        type: 'assistant',
        message: {
          model: 'claude-sonnet-4-20250514',
          usage: {
            input_tokens: 1000,
            output_tokens: 500,
            cache_creation_input_tokens: 200,
            cache_read_input_tokens: 300,
          },
        },
      },
      { notJsonShape: true },
      {
        type: 'assistant',
        message: {
          model: 'claude-opus-4-20250514',
          usage: {
            input_tokens: 25,
            output_tokens: 5,
          },
        },
      },
    ]);

    const input = {
      session_id: 'session-from-hook',
      transcript_path: transcriptPath,
    };
    const result = runScript(input, withTempHome(tmpHome));
    assert.strictEqual(result.code, 0, `Expected exit code 0, got ${result.code}`);

    const metricsFile = path.join(tmpHome, '.claude', 'metrics', 'costs.jsonl');
    assert.ok(fs.existsSync(metricsFile), `Expected metrics file to exist at ${metricsFile}`);

    const content = fs.readFileSync(metricsFile, 'utf8').trim();
    const row = JSON.parse(content);
    assert.strictEqual(row.session_id, 'session-from-hook', 'Expected input session ID to be recorded');
    assert.strictEqual(row.transcript_path, transcriptPath, 'Expected transcript_path to be recorded');
    assert.strictEqual(row.model, 'claude-opus-4-20250514', 'Expected last assistant model to be recorded');
    assert.strictEqual(row.input_tokens, 1025, 'Expected input_tokens to be summed from transcript');
    assert.strictEqual(row.output_tokens, 505, 'Expected output_tokens to be summed from transcript');
    assert.strictEqual(row.cache_write_tokens, 200, 'Expected cache write tokens to be summed from transcript');
    assert.strictEqual(row.cache_read_tokens, 300, 'Expected cache read tokens to be summed from transcript');
    assert.ok(row.timestamp, 'Expected timestamp to be present');
    assert.ok(typeof row.estimated_cost_usd === 'number', 'Expected estimated_cost_usd to be a number');
    assert.ok(row.estimated_cost_usd > 0, 'Expected estimated_cost_usd to be positive');

    fs.rmSync(tmpHome, { recursive: true, force: true });
  }) ? passed++ : failed++);

  // 3. Handles empty input gracefully
  (test('handles empty input gracefully', () => {
    const tmpHome = makeTempDir();
    const result = runScript('', withTempHome(tmpHome));
    assert.strictEqual(result.code, 0, `Expected exit code 0, got ${result.code}`);
    // stdout should be empty since input was empty
    assert.strictEqual(result.stdout, '', 'Expected empty stdout for empty input');

    fs.rmSync(tmpHome, { recursive: true, force: true });
  }) ? passed++ : failed++);

  // 4. Handles invalid JSON gracefully
  (test('handles invalid JSON gracefully', () => {
    const tmpHome = makeTempDir();
    const invalidInput = 'not valid json {{{';
    const result = runScript(invalidInput, withTempHome(tmpHome));
    assert.strictEqual(result.code, 0, `Expected exit code 0, got ${result.code}`);
    // Should still pass through the raw input on stdout
    assert.strictEqual(result.stdout, invalidInput, 'Expected stdout to contain original invalid input');

    fs.rmSync(tmpHome, { recursive: true, force: true });
  }) ? passed++ : failed++);

  // 5. Handles missing usage fields gracefully
  (test('handles missing usage fields gracefully', () => {
    const tmpHome = makeTempDir();
    const input = { model: 'claude-sonnet-4-20250514' };
    const inputStr = JSON.stringify(input);
    const result = runScript(input, withTempHome(tmpHome));
    assert.strictEqual(result.code, 0, `Expected exit code 0, got ${result.code}`);
    assert.strictEqual(result.stdout, inputStr, 'Expected stdout to match original input');

    const metricsFile = path.join(tmpHome, '.claude', 'metrics', 'costs.jsonl');
    assert.ok(fs.existsSync(metricsFile), 'Expected metrics file to exist even with missing usage');

    const row = JSON.parse(fs.readFileSync(metricsFile, 'utf8').trim());
    assert.strictEqual(row.input_tokens, 0, 'Expected input_tokens to be 0 when missing');
    assert.strictEqual(row.output_tokens, 0, 'Expected output_tokens to be 0 when missing');
    assert.strictEqual(row.estimated_cost_usd, 0, 'Expected estimated_cost_usd to be 0 when no tokens');

    fs.rmSync(tmpHome, { recursive: true, force: true });
  }) ? passed++ : failed++);

  // 6. Prefers ECC_SESSION_ID for ECC2 session correlation
  (test('prefers ECC_SESSION_ID over CLAUDE_SESSION_ID when both are present', () => {
    const tmpHome = makeTempDir();
    const input = {
      model: 'claude-sonnet-4-20250514',
      usage: { input_tokens: 120, output_tokens: 30 },
    };
    const result = runScript(input, {
      ...withTempHome(tmpHome),
      ECC_SESSION_ID: 'ecc-session-1234',
      CLAUDE_SESSION_ID: 'claude-session-9999',
    });
    assert.strictEqual(result.code, 0, `Expected exit code 0, got ${result.code}`);

    const metricsFile = path.join(tmpHome, '.claude', 'metrics', 'costs.jsonl');
    const row = JSON.parse(fs.readFileSync(metricsFile, 'utf8').trim());
    assert.strictEqual(row.session_id, 'ecc-session-1234', 'Expected ECC_SESSION_ID to win');

    fs.rmSync(tmpHome, { recursive: true, force: true });
  }) ? passed++ : failed++);

  // 7. Uses sanitized hook input session_id when environment session IDs are absent
  (test('uses input session_id for session correlation when env vars are absent', () => {
    const tmpHome = makeTempDir();
    const input = {
      session_id: 'hook-session-abc',
      model: 'claude-sonnet-4-20250514',
      usage: { input_tokens: 120, output_tokens: 30 },
    };
    const result = runScript(input, {
      ...withTempHome(tmpHome),
      ECC_SESSION_ID: '',
      CLAUDE_SESSION_ID: '',
    });
    assert.strictEqual(result.code, 0, `Expected exit code 0, got ${result.code}`);

    const metricsFile = path.join(tmpHome, '.claude', 'metrics', 'costs.jsonl');
    const row = JSON.parse(fs.readFileSync(metricsFile, 'utf8').trim());
    assert.strictEqual(row.session_id, 'hook-session-abc', 'Expected input session_id to be recorded');

    fs.rmSync(tmpHome, { recursive: true, force: true });
  }) ? passed++ : failed++);

  // 8. Prefers harness-cost cache value over transcript-sum when fresh
  (test('prefers fresh harness-cost cache over transcript estimate', () => {
    const tmpHome = makeTempDir();
    const sessionId = 'harness-fresh-' + Date.now();
    const transcriptPath = path.join(tmpHome, 'session.jsonl');
    writeTranscript(transcriptPath, [
      {
        type: 'assistant',
        message: {
          model: 'claude-opus-4-20250514',
          usage: {
            input_tokens: 10000,
            output_tokens: 5000,
            cache_creation_input_tokens: 200000,
            cache_read_input_tokens: 1000000,
          },
        },
      },
    ]);
    const harnessCachePath = path.join(os.tmpdir(), `harness-cost-${sessionId}.json`);
    const nowEpoch = Math.floor(Date.now() / 1000);
    fs.writeFileSync(
      harnessCachePath,
      JSON.stringify({ ts: nowEpoch, cost_usd: 1.23 }),
      'utf8'
    );

    try {
      const result = runScript(
        { session_id: sessionId, transcript_path: transcriptPath },
        withTempHome(tmpHome)
      );
      assert.strictEqual(result.code, 0, `Expected exit code 0, got ${result.code}`);

      const metricsFile = path.join(tmpHome, '.claude', 'metrics', 'costs.jsonl');
      const row = JSON.parse(fs.readFileSync(metricsFile, 'utf8').trim());
      assert.strictEqual(row.estimated_cost_usd, 1.23, 'Expected harness cost to win');
      // Token totals still reflect the transcript scan
      assert.strictEqual(row.input_tokens, 10000, 'Token totals should still come from transcript');
      assert.strictEqual(row.output_tokens, 5000, 'Token totals should still come from transcript');
    } finally {
      try { fs.unlinkSync(harnessCachePath); } catch { /* best-effort */ }
      fs.rmSync(tmpHome, { recursive: true, force: true });
    }
  }) ? passed++ : failed++);

  // 9. Ignores stale harness-cost cache and falls back to transcript estimate
  (test('ignores stale harness-cost cache (>300s) and uses transcript estimate', () => {
    const tmpHome = makeTempDir();
    const sessionId = 'harness-stale-' + Date.now();
    const transcriptPath = path.join(tmpHome, 'session.jsonl');
    writeTranscript(transcriptPath, [
      {
        type: 'assistant',
        message: {
          model: 'claude-sonnet-4-20250514',
          usage: { input_tokens: 1000, output_tokens: 500 },
        },
      },
    ]);
    const harnessCachePath = path.join(os.tmpdir(), `harness-cost-${sessionId}.json`);
    const staleEpoch = Math.floor(Date.now() / 1000) - 3600;
    fs.writeFileSync(
      harnessCachePath,
      JSON.stringify({ ts: staleEpoch, cost_usd: 999.99 }),
      'utf8'
    );

    try {
      const result = runScript(
        { session_id: sessionId, transcript_path: transcriptPath },
        withTempHome(tmpHome)
      );
      assert.strictEqual(result.code, 0, `Expected exit code 0, got ${result.code}`);

      const metricsFile = path.join(tmpHome, '.claude', 'metrics', 'costs.jsonl');
      const row = JSON.parse(fs.readFileSync(metricsFile, 'utf8').trim());
      assert.notStrictEqual(row.estimated_cost_usd, 999.99, 'Stale cache must not win');
      assert.ok(row.estimated_cost_usd > 0, 'Expected fallback transcript estimate to be positive');
      // Sonnet rates: 1000/1e6*3 + 500/1e6*15 ≈ $0.011 — well below the 999.99 stale value
      assert.ok(row.estimated_cost_usd < 1, 'Expected small transcript estimate, not the stale 999.99');
    } finally {
      try { fs.unlinkSync(harnessCachePath); } catch { /* best-effort */ }
      fs.rmSync(tmpHome, { recursive: true, force: true });
    }
  }) ? passed++ : failed++);

  console.log(`\nResults: Passed: ${passed}, Failed: ${failed}`);
  process.exit(failed > 0 ? 1 : 0);
}

runTests();
