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

  // 2b. Dedupes usage by message.id (one API response = many JSONL lines)
  (test('counts usage once per message.id across multi-line responses', () => {
    const tmpHome = makeTempDir();
    const transcriptPath = path.join(tmpHome, 'session.jsonl');
    const sharedUsage = {
      input_tokens: 1000,
      output_tokens: 500,
      cache_creation_input_tokens: 200,
      cache_read_input_tokens: 300,
    };
    writeTranscript(transcriptPath, [
      // One API response split into 3 content-block lines, all carrying the
      // same message.id and the same usage — must be counted exactly once.
      { type: 'assistant', message: { id: 'msg_01AAA', model: 'claude-sonnet-4-20250514', usage: sharedUsage } },
      { type: 'assistant', message: { id: 'msg_01AAA', model: 'claude-sonnet-4-20250514', usage: sharedUsage } },
      { type: 'assistant', message: { id: 'msg_01AAA', model: 'claude-sonnet-4-20250514', usage: sharedUsage } },
      // A second, distinct response.
      { type: 'assistant', message: { id: 'msg_01BBB', model: 'claude-sonnet-4-20250514', usage: { input_tokens: 25, output_tokens: 5 } } },
    ]);

    const result = runScript(
      { session_id: 'dedupe-session', transcript_path: transcriptPath },
      withTempHome(tmpHome)
    );
    assert.strictEqual(result.code, 0, `Expected exit code 0, got ${result.code}`);

    const metricsFile = path.join(tmpHome, '.claude', 'metrics', 'costs.jsonl');
    const row = JSON.parse(fs.readFileSync(metricsFile, 'utf8').trim());
    assert.strictEqual(row.input_tokens, 1025, 'Expected msg_01AAA usage counted once, not 3x');
    assert.strictEqual(row.output_tokens, 505, 'Expected msg_01AAA usage counted once, not 3x');
    assert.strictEqual(row.cache_write_tokens, 200, 'Expected cache write counted once per message.id');
    assert.strictEqual(row.cache_read_tokens, 300, 'Expected cache read counted once per message.id');

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

  // --- Rate table ---------------------------------------------------------
  // These run the hook end to end and assert the dollar figure, not merely
  // that one is present. A stale rate constant is invisible to a "cost > 0"
  // assertion, which is how every Opus session came to be reported at 3x.

  function priceSession(model, usage, tag) {
    const tmpHome = makeTempDir();
    const transcriptPath = path.join(tmpHome, 'session.jsonl');
    writeTranscript(transcriptPath, [
      { type: 'assistant', message: { id: 'msg_01RATE', model, usage } },
    ]);
    try {
      const result = runScript(
        { session_id: `${tag}-${Date.now()}`, transcript_path: transcriptPath },
        withTempHome(tmpHome)
      );
      assert.strictEqual(result.code, 0, `Expected exit code 0, got ${result.code}`);
      const metricsFile = path.join(tmpHome, '.claude', 'metrics', 'costs.jsonl');
      const row = JSON.parse(fs.readFileSync(metricsFile, 'utf8').trim());
      return { row, stderr: result.stderr };
    } finally {
      fs.rmSync(tmpHome, { recursive: true, force: true });
    }
  }

  // 1M in + 1M out makes each expected cost read as "input rate plus output
  // rate", with no arithmetic for a reviewer to check by hand.
  const ONE_M_EACH = { input_tokens: 1000000, output_tokens: 1000000 };

  // 10. Opus 4.5 and later bill at $5/$25, not Claude 3 Opus's $15/$75.
  (test('prices current Opus models at $5/$25 per Mtok', () => {
    for (const model of [
      'claude-opus-5',
      'claude-opus-4-8',
      'claude-opus-4-6',
      'claude-opus-4-5-20251101',
      // The `[1m]` context suffix Claude Code appends, and the Vertex form of
      // a current model, must not be dragged into the legacy bucket.
      'claude-opus-4-8[1m]',
      'claude-opus-4-5@20251101',
    ]) {
      const { row } = priceSession(model, ONE_M_EACH, 'opus-current');
      assert.strictEqual(row.rate_bucket, 'opus', `${model} should use the current opus bucket`);
      assert.strictEqual(
        row.estimated_cost_usd, 30,
        `${model}: expected $5 in + $25 out = $30, got ${row.estimated_cost_usd}`
      );
    }
  }) ? passed++ : failed++);

  // 11. The three Opus generations that genuinely billed at $15/$75 keep it.
  //     `claude-opus-4-20250514` is the subtle one: it is Opus 4.0 with no
  //     minor segment, so a plain `opus-4-0` substring test misses it.
  (test('keeps $15/$75 for legacy Opus IDs (3 Opus, 4.0, 4.1)', () => {
    for (const model of [
      'claude-3-opus-20240229',
      'claude-opus-4-0',
      'claude-opus-4-20250514',
      'claude-opus-4-1-20250805',
      // Bedrock and Vertex rewrite the same models. Vertex joins the date with
      // `@`, which is the spelling a `-` only pattern silently mispriced.
      'us.anthropic.claude-3-opus-20240229-v1:0',
      'claude-opus-4@20250514',
      'claude-opus-4-1@20250805',
    ]) {
      const { row } = priceSession(model, ONE_M_EACH, 'opus-legacy');
      assert.strictEqual(row.rate_bucket, 'opus-legacy', `${model} should use the legacy opus bucket`);
      assert.strictEqual(
        row.estimated_cost_usd, 90,
        `${model}: expected $15 in + $75 out = $90, got ${row.estimated_cost_usd}`
      );
    }
  }) ? passed++ : failed++);

  // 12. Haiku 4.5 is $1/$5. The old table carried Haiku 3.5's $0.80/$4.00.
  (test('prices Haiku 4.5 at $1/$5 per Mtok', () => {
    const { row } = priceSession('claude-haiku-4-5-20251001', ONE_M_EACH, 'haiku');
    assert.strictEqual(row.rate_bucket, 'haiku', 'Expected the haiku bucket');
    assert.strictEqual(
      row.estimated_cost_usd, 6,
      `Expected $1 in + $5 out = $6, got ${row.estimated_cost_usd}`
    );
  }) ? passed++ : failed++);

  // 13. Fable and Mythos are $10/$50. They had no bucket at all and fell
  //     through to sonnet, understating them by 3.3x.
  (test('prices Fable and Mythos at $10/$50 per Mtok', () => {
    for (const model of ['claude-fable-5', 'claude-mythos-5']) {
      const { row } = priceSession(model, ONE_M_EACH, 'fable');
      assert.strictEqual(row.rate_bucket, 'fable', `${model} should use the fable bucket`);
      assert.strictEqual(
        row.estimated_cost_usd, 60,
        `${model}: expected $10 in + $50 out = $60, got ${row.estimated_cost_usd}`
      );
    }
  }) ? passed++ : failed++);

  // 14. Cache multipliers ride the corrected input rate. This is the measured
  //     regression: a session summing to 100M cache-read + 500K output on
  //     claude-opus-5 was reported as $187.50 under the old table.
  (test('prices a cache-heavy Opus 5 session at $62.50, not the old $187.50', () => {
    const { row } = priceSession('claude-opus-5', {
      input_tokens: 0,
      output_tokens: 500000,
      cache_creation_input_tokens: 0,
      cache_read_input_tokens: 100000000,
    }, 'opus5-cache');
    // 100M cache-read at $0.50/Mtok (0.1x the $5 input rate) = $50.00,
    // plus 0.5M output at $25/Mtok = $12.50.
    assert.strictEqual(
      row.estimated_cost_usd, 62.5,
      `Expected $62.50, got ${row.estimated_cost_usd}`
    );
  }) ? passed++ : failed++);

  // 15. An unrecognized model still gets a usable number, because this is a
  //     Stop hook and must stay fail-open, but it must not be silent.
  (test('flags an unrecognized model instead of silently using sonnet rates', () => {
    const { row, stderr } = priceSession('claude-quokka-9-20270101', ONE_M_EACH, 'unknown-model');
    assert.strictEqual(row.rate_bucket, 'sonnet-fallback', 'Expected the fallback bucket on the row');
    assert.strictEqual(row.estimated_cost_usd, 18, 'Expected sonnet rates as the fail-open default');
    assert.ok(
      stderr.includes('claude-quokka-9-20270101'),
      `Expected a stderr warning naming the model, got: ${JSON.stringify(stderr)}`
    );
    assert.strictEqual(
      stderr.split('\n').filter(l => l.includes('unrecognized model')).length, 1,
      'Expected a single warning line from this invocation'
    );
  }) ? passed++ : failed++);

  // 16. Negative case for that warning. A transcript whose assistant turns
  //     record no model leaves the `unknown` sentinel, which names nothing the
  //     reader could act on, so the hook stays quiet and lets the row carry it.
  (test('stays quiet when no assistant turn recorded a model', () => {
    const { row, stderr } = priceSession('', { input_tokens: 0, output_tokens: 0 }, 'no-model');
    assert.strictEqual(row.model, 'unknown', 'Expected the unknown-model sentinel');
    assert.strictEqual(row.rate_bucket, 'sonnet-fallback', 'Expected the fallback bucket');
    assert.strictEqual(row.estimated_cost_usd, 0, 'Expected a zero estimate');
    assert.ok(!stderr.includes('unrecognized model'), `Expected no warning, got: ${JSON.stringify(stderr)}`);
  }) ? passed++ : failed++);

  // 16b. Same sentinel, but with real tokens: the row must still be marked as
  //      a guess even though nothing is printed.
  (test('marks an unattributed session as a fallback without warning', () => {
    const { row, stderr } = priceSession('', ONE_M_EACH, 'no-model-priced');
    assert.strictEqual(row.model, 'unknown', 'Expected the unknown-model sentinel');
    assert.strictEqual(row.rate_bucket, 'sonnet-fallback', 'Expected the row to record the guess');
    assert.strictEqual(row.estimated_cost_usd, 18, 'Expected sonnet rates as the fail-open default');
    assert.ok(!stderr.includes('unrecognized model'), 'A nameless model has nothing actionable to warn about');
  }) ? passed++ : failed++);

  // 17. Sonnet keeps its rates and stays distinguishable from the fallback.
  (test('prices Sonnet at $3/$15 and marks it as a real match', () => {
    const { row, stderr } = priceSession('claude-sonnet-4-6-20260115', ONE_M_EACH, 'sonnet');
    assert.strictEqual(row.rate_bucket, 'sonnet', 'Expected a real sonnet match, not the fallback');
    assert.strictEqual(row.estimated_cost_usd, 18, `Expected $3 in + $15 out = $18, got ${row.estimated_cost_usd}`);
    assert.ok(!stderr.includes('unrecognized model'), 'A known model must not warn');
  }) ? passed++ : failed++);

  // 18. Claude 3.5 Haiku really was $0.80/$4.00. Correcting Haiku 4.5 must not
  //     reprice it, which is why there is a legacy Haiku row at all.
  (test('keeps $0.80/$4.00 for Claude 3.5 Haiku', () => {
    for (const model of ['claude-3-5-haiku-20241022', 'claude-3-5-haiku-latest', 'claude-3-5-haiku@20241022']) {
      const { row } = priceSession(model, ONE_M_EACH, 'haiku-legacy');
      assert.strictEqual(row.rate_bucket, 'haiku-legacy', `${model} should use the legacy haiku bucket`);
      assert.strictEqual(
        row.estimated_cost_usd, 4.8,
        `${model}: expected $0.80 in + $4.00 out = $4.80, got ${row.estimated_cost_usd}`
      );
    }
  }) ? passed++ : failed++);

  // 19. The cache columns are hand-typed constants and only Opus is pinned by
  //     the cases above. Every row must stay at 1.25x input for a write and
  //     0.1x input for a read, or cache-heavy sessions drift silently.
  (test('keeps cache write at 1.25x and cache read at 0.1x input in every bucket', () => {
    const inputRateByModel = [
      ['claude-haiku-4-5-20251001', 1.0],
      ['claude-3-5-haiku-20241022', 0.8],
      ['claude-sonnet-5', 3.0],
      ['claude-opus-5', 5.0],
      ['claude-3-opus-20240229', 15.0],
      ['claude-fable-5', 10.0],
    ];
    for (const [model, inputRate] of inputRateByModel) {
      const { row } = priceSession(model, {
        input_tokens: 0,
        output_tokens: 0,
        cache_creation_input_tokens: 1000000,
        cache_read_input_tokens: 1000000,
      }, 'cache-multipliers');
      const expected = Math.round((inputRate * 1.25 + inputRate * 0.1) * 1e6) / 1e6;
      assert.strictEqual(
        row.estimated_cost_usd, expected,
        `${model}: expected 1M cache-write + 1M cache-read = $${expected}, got ${row.estimated_cost_usd}`
      );
    }
  }) ? passed++ : failed++);

  // 20. `<synthetic>` is what Claude Code writes for interrupts and API
  //     errors. It carries an all-zero but fully populated `usage` block, so
  //     it clears the usage guard, and under last-model-wins it would rename
  //     the whole session and drag it into the fallback bucket. Measured over
  //     1,628 local transcripts, 10 end on one, and the final row is the one
  //     /cost-report reads per session.
  (test('ignores the <synthetic> sentinel when attributing the session model', () => {
    const tmpHome = makeTempDir();
    const transcriptPath = path.join(tmpHome, 'session.jsonl');
    writeTranscript(transcriptPath, [
      {
        type: 'assistant',
        message: { id: 'msg_01REAL', model: 'claude-opus-5', usage: { input_tokens: 1000000, output_tokens: 1000000 } },
      },
      {
        type: 'assistant',
        message: {
          id: 'msg_01SYNTH',
          model: '<synthetic>',
          usage: { input_tokens: 0, output_tokens: 0, cache_creation_input_tokens: 0, cache_read_input_tokens: 0 },
        },
      },
    ]);
    try {
      const result = runScript(
        { session_id: `synthetic-${Date.now()}`, transcript_path: transcriptPath },
        withTempHome(tmpHome)
      );
      const metricsFile = path.join(tmpHome, '.claude', 'metrics', 'costs.jsonl');
      const row = JSON.parse(fs.readFileSync(metricsFile, 'utf8').trim());
      assert.strictEqual(row.model, 'claude-opus-5', 'Expected the real model, not the synthetic sentinel');
      assert.strictEqual(row.rate_bucket, 'opus', 'Expected opus rates, not the fallback');
      assert.strictEqual(row.estimated_cost_usd, 30, `Expected $30 at Opus rates, got ${row.estimated_cost_usd}`);
      assert.ok(!result.stderr.includes('unrecognized model'), 'The sentinel must not trigger the warning');
    } finally {
      fs.rmSync(tmpHome, { recursive: true, force: true });
    }
  }) ? passed++ : failed++);

  // 21. When the harness supplied the cost, no rate-table row was consulted,
  //     so `rate_bucket` must say `harness` rather than vouch for a table row
  //     that did not produce the number.
  (test('records rate_bucket as harness when the harness cost wins', () => {
    const tmpHome = makeTempDir();
    const sessionId = `bucket-harness-${Date.now()}`;
    const transcriptPath = path.join(tmpHome, 'session.jsonl');
    writeTranscript(transcriptPath, [
      { type: 'assistant', message: { id: 'msg_01H', model: 'claude-opus-5', usage: { input_tokens: 1000000, output_tokens: 1000000 } } },
    ]);
    const harnessCachePath = path.join(os.tmpdir(), `harness-cost-${sessionId}.json`);
    fs.writeFileSync(
      harnessCachePath,
      JSON.stringify({ ts: Math.floor(Date.now() / 1000), cost_usd: 7.77 }),
      'utf8'
    );
    try {
      runScript({ session_id: sessionId, transcript_path: transcriptPath }, withTempHome(tmpHome));
      const metricsFile = path.join(tmpHome, '.claude', 'metrics', 'costs.jsonl');
      const row = JSON.parse(fs.readFileSync(metricsFile, 'utf8').trim());
      assert.strictEqual(row.estimated_cost_usd, 7.77, 'Expected the harness cost to win');
      assert.strictEqual(row.rate_bucket, 'harness', 'Expected rate_bucket to follow the cost source');
    } finally {
      try { fs.unlinkSync(harnessCachePath); } catch { /* best-effort */ }
      fs.rmSync(tmpHome, { recursive: true, force: true });
    }
  }) ? passed++ : failed++);

  // 22. The mirror of 21: an unrecognized model must not be flagged as a guess
  //     when the recorded cost came from the harness and is authoritative.
  (test('does not flag an unrecognized model when the harness supplied the cost', () => {
    const tmpHome = makeTempDir();
    const sessionId = `harness-unknown-${Date.now()}`;
    const transcriptPath = path.join(tmpHome, 'session.jsonl');
    writeTranscript(transcriptPath, [
      { type: 'assistant', message: { id: 'msg_01U', model: 'claude-quokka-9-20270101', usage: { input_tokens: 1000000, output_tokens: 1000000 } } },
    ]);
    const harnessCachePath = path.join(os.tmpdir(), `harness-cost-${sessionId}.json`);
    fs.writeFileSync(
      harnessCachePath,
      JSON.stringify({ ts: Math.floor(Date.now() / 1000), cost_usd: 7.77 }),
      'utf8'
    );
    try {
      const result = runScript({ session_id: sessionId, transcript_path: transcriptPath }, withTempHome(tmpHome));
      const metricsFile = path.join(tmpHome, '.claude', 'metrics', 'costs.jsonl');
      const row = JSON.parse(fs.readFileSync(metricsFile, 'utf8').trim());
      assert.strictEqual(row.rate_bucket, 'harness', 'Expected the harness bucket, not the fallback');
      assert.ok(
        !result.stderr.includes('unrecognized model'),
        `An authoritative cost must not be called a guess, got: ${JSON.stringify(result.stderr)}`
      );
    } finally {
      try { fs.unlinkSync(harnessCachePath); } catch { /* best-effort */ }
      fs.rmSync(tmpHome, { recursive: true, force: true });
    }
  }) ? passed++ : failed++);

  console.log(`\nResults: Passed: ${passed}, Failed: ${failed}`);
  process.exit(failed > 0 ? 1 : 0);
}

runTests();
