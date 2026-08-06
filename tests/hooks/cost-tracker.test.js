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


  // --- Subagent transcripts ------------------------------------------------
  // A session that fans out writes each subagent to its own JSONL under
  //   <transcript minus .jsonl>/subagents/agent-*.jsonl
  // and that spend is the parent session's. It was never read, so every
  // fan-out session under-reported. Measured over 116 local fan-out sessions:
  // $1,837 of $13,493 was invisible (13.6%).

  // Writes a main transcript plus a subagents/ directory, and returns the row.
  function priceFanOut({ mainEntries, subagentFiles = {}, extraFiles = {} }) {
    const tmpHome = makeTempDir();
    const transcriptPath = path.join(tmpHome, 'session.jsonl');
    writeTranscript(transcriptPath, mainEntries);

    const subagentDir = path.join(tmpHome, 'session', 'subagents');
    const names = Object.keys(subagentFiles).concat(Object.keys(extraFiles));
    if (names.length > 0) fs.mkdirSync(subagentDir, { recursive: true });
    for (const [name, entries] of Object.entries(subagentFiles)) {
      writeTranscript(path.join(subagentDir, name), entries);
    }
    for (const [name, body] of Object.entries(extraFiles)) {
      fs.writeFileSync(path.join(subagentDir, name), body, 'utf8');
    }

    try {
      const result = runScript(
        { session_id: `fanout-${Date.now()}-${Math.random()}`, transcript_path: transcriptPath },
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

  const assistant = (id, model, usage) => ({ type: 'assistant', message: { id, model, usage } });

  // 20. The defect itself: subagent tokens must reach the row.
  (test('counts subagent transcripts in the session total', () => {
    const { row } = priceFanOut({
      mainEntries: [
        assistant('msg_main', 'claude-sonnet-4-6', { input_tokens: 1000, output_tokens: 100 }),
      ],
      subagentFiles: {
        'agent-aaa.jsonl': [
          assistant('msg_sub_a', 'claude-sonnet-4-6', { input_tokens: 2000, output_tokens: 200 }),
        ],
        'agent-bbb.jsonl': [
          assistant('msg_sub_b', 'claude-sonnet-4-6', { input_tokens: 4000, output_tokens: 400 }),
        ],
      },
    });
    assert.strictEqual(row.subagent_transcripts, 2, 'Expected both subagent files to be folded in');
    assert.strictEqual(row.input_tokens, 7000, 'Expected 1000 main + 2000 + 4000 subagent input tokens');
    assert.strictEqual(row.output_tokens, 700, 'Expected 100 main + 200 + 400 subagent output tokens');
    // Sonnet: 7000/1e6*3 + 700/1e6*15 = 0.021 + 0.0105
    assert.strictEqual(row.estimated_cost_usd, 0.0315, `Expected $0.0315, got ${row.estimated_cost_usd}`);
  }) ? passed++ : failed++);

  // 21. Negative case for the whole feature. Most sessions never fan out, so
  //     the missing directory is the common path: it must be silent, must not
  //     throw, and must leave the numbers exactly as before.
  (test('a session with no subagents directory is unchanged and silent', () => {
    const { row, stderr } = priceFanOut({
      mainEntries: [
        assistant('msg_main', 'claude-sonnet-4-6', { input_tokens: 1000, output_tokens: 100 }),
      ],
    });
    assert.strictEqual(row.subagent_transcripts, 0, 'Expected no subagent transcripts');
    assert.strictEqual(row.input_tokens, 1000, 'Expected the main transcript total, unchanged');
    assert.strictEqual(row.estimated_cost_usd, 0.0045, 'Expected 1000/1e6*3 + 100/1e6*15');
    assert.strictEqual(stderr, '', `Expected no stderr for the ordinary no-subagent case, got: ${JSON.stringify(stderr)}`);
  }) ? passed++ : failed++);

  // 22. Folding must not double-count. Real subagent files share no message.id
  //     with the parent (0 collisions over 116 local sessions), but the dedupe
  //     map is what guarantees it, so pin the guarantee rather than the data.
  (test('dedupes a message.id that appears in both parent and subagent', () => {
    const usage = { input_tokens: 1000, output_tokens: 100 };
    const { row } = priceFanOut({
      mainEntries: [assistant('msg_shared', 'claude-sonnet-4-6', usage)],
      subagentFiles: { 'agent-aaa.jsonl': [assistant('msg_shared', 'claude-sonnet-4-6', usage)] },
    });
    assert.strictEqual(row.subagent_transcripts, 1, 'Expected the subagent file to have been read at all');
    assert.strictEqual(row.input_tokens, 1000, 'A repeated message.id must be counted once, not twice');
    assert.strictEqual(row.output_tokens, 100, 'A repeated message.id must be counted once, not twice');
  }) ? passed++ : failed++);

  // 23. Subagents routinely run a different model than the parent (48 of 116
  //     local fan-out sessions, 41.4%). Pricing the whole session at the
  //     parent's rate would trade the under-count for an over-count, so each
  //     model is priced at its own rate.
  (test('prices each model at its own rate rather than the parent model rate', () => {
    const { row } = priceFanOut({
      mainEntries: [
        assistant('msg_main', 'claude-opus-4-5', { input_tokens: 1000000, output_tokens: 0 }),
      ],
      subagentFiles: {
        'agent-aaa.jsonl': [
          assistant('msg_sub', 'claude-haiku-4-5', { input_tokens: 1000000, output_tokens: 0 }),
        ],
      },
    });
    const opus = row.models.find(m => m.model === 'claude-opus-4-5');
    const haiku = row.models.find(m => m.model === 'claude-haiku-4-5');
    assert.ok(opus && haiku, `Expected a bucket per model, got ${JSON.stringify(row.models)}`);
    assert.strictEqual(opus.input_tokens, 1000000, 'Expected the opus tokens in the opus bucket');
    assert.strictEqual(haiku.input_tokens, 1000000, 'Expected the haiku tokens in the haiku bucket');
    // The haiku million must NOT be billed at the opus input rate.
    assert.ok(
      haiku.estimated_cost_usd < opus.estimated_cost_usd,
      `Haiku tokens billed at opus rates: haiku $${haiku.estimated_cost_usd} vs opus $${opus.estimated_cost_usd}`
    );
    assert.strictEqual(
      row.estimated_cost_usd,
      Math.round((opus.estimated_cost_usd + haiku.estimated_cost_usd) * 1e6) / 1e6,
      'Expected the row total to be the sum of the per-model buckets'
    );
  }) ? passed++ : failed++);

  // 24. The breakdown must reconcile with the headline number, or it is
  //     decoration rather than an audit trail.
  (test('models breakdown sums to estimated_cost_usd and to the token totals', () => {
    const { row } = priceFanOut({
      mainEntries: [
        assistant('msg_main', 'claude-opus-4-5', {
          input_tokens: 1000, output_tokens: 100,
          cache_creation_input_tokens: 50, cache_read_input_tokens: 900,
        }),
      ],
      subagentFiles: {
        'agent-aaa.jsonl': [
          assistant('msg_sub', 'claude-sonnet-4-6', {
            input_tokens: 3000, output_tokens: 300,
            cache_creation_input_tokens: 20, cache_read_input_tokens: 40,
          }),
        ],
      },
    });
    assert.strictEqual(row.models.length, 2, `Expected two model buckets, got ${JSON.stringify(row.models)}`);
    const sum = k => row.models.reduce((n, m) => n + m[k], 0);
    assert.strictEqual(sum('input_tokens'), row.input_tokens, 'input_tokens must reconcile');
    assert.strictEqual(sum('output_tokens'), row.output_tokens, 'output_tokens must reconcile');
    assert.strictEqual(sum('cache_write_tokens'), row.cache_write_tokens, 'cache_write_tokens must reconcile');
    assert.strictEqual(sum('cache_read_tokens'), row.cache_read_tokens, 'cache_read_tokens must reconcile');
    assert.strictEqual(
      Math.round(sum('estimated_cost_usd') * 1e6) / 1e6,
      row.estimated_cost_usd,
      'The per-model costs must sum to the row total'
    );
    // Most expensive bucket first, so the row is deterministic.
    assert.ok(
      row.models[0].estimated_cost_usd >= row.models[1].estimated_cost_usd,
      'Expected the breakdown sorted by cost, most expensive first'
    );
  }) ? passed++ : failed++);

  // 25. Fail-open: a Stop hook must never break the session. An unreadable or
  //     malformed subagent file degrades to skipping that file.
  (test('stays fail-open on a malformed subagent transcript', () => {
    const { row } = priceFanOut({
      mainEntries: [
        assistant('msg_main', 'claude-sonnet-4-6', { input_tokens: 1000, output_tokens: 100 }),
      ],
      subagentFiles: {
        'agent-good.jsonl': [
          assistant('msg_sub', 'claude-sonnet-4-6', { input_tokens: 2000, output_tokens: 200 }),
        ],
      },
      extraFiles: { 'agent-bad.jsonl': '{ this is not json\nneither is this\n' },
    });
    assert.strictEqual(row.input_tokens, 3000, 'Expected the readable files to still be counted');
    assert.strictEqual(row.output_tokens, 300, 'Expected the readable files to still be counted');
  }) ? passed++ : failed++);

  // 26. `.meta.json` sidecars sit in the same directory and carry no usage.
  (test('ignores non-jsonl sidecars in the subagents directory', () => {
    const { row } = priceFanOut({
      mainEntries: [
        assistant('msg_main', 'claude-sonnet-4-6', { input_tokens: 1000, output_tokens: 100 }),
      ],
      subagentFiles: {
        'agent-aaa.jsonl': [
          assistant('msg_sub', 'claude-sonnet-4-6', { input_tokens: 2000, output_tokens: 200 }),
        ],
      },
      extraFiles: { 'agent-aaa.meta.json': JSON.stringify({ agent: 'explorer' }) },
    });
    assert.strictEqual(row.subagent_transcripts, 1, 'Expected only the .jsonl file to count as a transcript');
    assert.strictEqual(row.input_tokens, 3000, 'Expected the sidecar to contribute nothing');
  }) ? passed++ : failed++);

  // --- Fast mode -----------------------------------------------------------
  // Fast mode is a 2x billing tier, and `message.usage.speed` records which
  // tier served the request (present on 123,155 of 151,286 assistant usage
  // blocks across 1,500 local transcripts). The expectations below are pinned
  // as a RATIO to the standard tier rather than as dollars, so they hold
  // whatever the underlying rate table says.

  // 27. A fast-mode turn bills at exactly twice the standard tier.
  (test('bills a fast-mode turn at 2x the standard tier', () => {
    const usage = { input_tokens: 1000000, output_tokens: 1000000 };
    const { row: standard } = priceFanOut({
      mainEntries: [assistant('msg_std', 'claude-opus-5', { ...usage, speed: 'standard' })],
    });
    const { row: fast } = priceFanOut({
      mainEntries: [assistant('msg_fast', 'claude-opus-5', { ...usage, speed: 'fast' })],
    });
    assert.ok(standard.estimated_cost_usd > 0, 'Expected a priceable standard-tier session');
    assert.strictEqual(
      fast.estimated_cost_usd,
      standard.estimated_cost_usd * 2,
      `Expected fast mode at 2x $${standard.estimated_cost_usd}, got $${fast.estimated_cost_usd}`
    );
    assert.strictEqual(fast.models[0].speed, 'fast', 'Expected the row to record the fast tier');
  }) ? passed++ : failed++);

  // 28. Negative case. `speed` is absent on older transcripts and reads as
  //     standard, so those must price exactly as they did before this change.
  (test('prices an absent speed field at standard rates', () => {
    const usage = { input_tokens: 1000000, output_tokens: 1000000 };
    const { row: absent } = priceFanOut({
      mainEntries: [assistant('msg_absent', 'claude-opus-5', usage)],
    });
    const { row: explicit } = priceFanOut({
      mainEntries: [assistant('msg_std', 'claude-opus-5', { ...usage, speed: 'standard' })],
    });
    assert.strictEqual(
      absent.estimated_cost_usd,
      explicit.estimated_cost_usd,
      'A missing speed field must not change the price'
    );
    assert.strictEqual(absent.models[0].speed, 'standard', 'Expected an absent speed recorded as standard');
  }) ? passed++ : failed++);

  // 29. Mixed tiers inside one session are separate buckets, which is the only
  //     way a session that switched speed mid-flight prices correctly.
  (test('splits one model into separate buckets per speed tier', () => {
    const usage = { input_tokens: 1000000, output_tokens: 0 };
    const { row } = priceFanOut({
      mainEntries: [
        assistant('msg_std', 'claude-opus-5', { ...usage, speed: 'standard' }),
        assistant('msg_fast', 'claude-opus-5', { ...usage, speed: 'fast' }),
      ],
    });
    assert.strictEqual(row.models.length, 2, `Expected a bucket per speed tier, got ${JSON.stringify(row.models)}`);
    const std = row.models.find(m => m.speed === 'standard');
    const fast = row.models.find(m => m.speed === 'fast');
    assert.ok(std && fast, 'Expected both a standard and a fast bucket');
    assert.strictEqual(fast.estimated_cost_usd, std.estimated_cost_usd * 2, 'Expected the fast bucket at 2x');
  }) ? passed++ : failed++);

  console.log(`\nResults: Passed: ${passed}, Failed: ${failed}`);
  process.exit(failed > 0 ? 1 : 0);
}

runTests();
