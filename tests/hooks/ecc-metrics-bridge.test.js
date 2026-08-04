/**
 * Tests for scripts/hooks/ecc-metrics-bridge.js
 *
 * Run with: node tests/hooks/ecc-metrics-bridge.test.js
 */

const assert = require('assert');
const { spawnSync } = require('child_process');
const fs = require('fs');
const os = require('os');
const path = require('path');

const { run, hashToolCall, extractFilePaths, readSessionCost } = require('../../scripts/hooks/ecc-metrics-bridge');

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

function makeTempHome() {
  return fs.mkdtempSync(path.join(os.tmpdir(), 'ecc-metrics-bridge-test-'));
}

function runTests() {
  console.log('\n=== Testing ecc-metrics-bridge.js ===\n');

  let passed = 0;
  let failed = 0;

  // hashToolCall tests
  console.log('hashToolCall:');

  if (
    test('returns 8-char hex string', () => {
      const hash = hashToolCall('Bash', { command: 'ls' });
      assert.strictEqual(hash.length, 8);
      assert.ok(/^[0-9a-f]{8}$/.test(hash), `Expected hex, got: ${hash}`);
    })
  )
    passed++;
  else failed++;

  if (
    test('different Bash commands produce different hashes', () => {
      const h1 = hashToolCall('Bash', { command: 'ls' });
      const h2 = hashToolCall('Bash', { command: 'pwd' });
      assert.notStrictEqual(h1, h2);
    })
  )
    passed++;
  else failed++;

  if (
    test('different Edit file_paths produce different hashes', () => {
      const h1 = hashToolCall('Edit', { file_path: 'a.js' });
      const h2 = hashToolCall('Edit', { file_path: 'b.js' });
      assert.notStrictEqual(h1, h2);
    })
  )
    passed++;
  else failed++;

  if (
    test('same inputs produce same hash (deterministic)', () => {
      const h1 = hashToolCall('Write', { file_path: 'x.txt' });
      const h2 = hashToolCall('Write', { file_path: 'x.txt' });
      assert.strictEqual(h1, h2);
    })
  )
    passed++;
  else failed++;

  if (
    test('different edits to the SAME file produce different hashes (no false loop)', () => {
      const h1 = hashToolCall('Edit', { file_path: 'a.kt', old_string: 'foo', new_string: 'bar' });
      const h2 = hashToolCall('Edit', { file_path: 'a.kt', old_string: 'baz', new_string: 'qux' });
      assert.notStrictEqual(h1, h2);
    })
  )
    passed++;
  else failed++;

  if (
    test('identical Edit (same file + same change) still hashes the same', () => {
      const args = { file_path: 'a.kt', old_string: 'foo', new_string: 'bar' };
      assert.strictEqual(hashToolCall('Edit', args), hashToolCall('Edit', { ...args }));
    })
  )
    passed++;
  else failed++;

  if (
    test('large edits diverging only after 2048 chars still hash differently', () => {
      // Shared prefix longer than the old HASH_INPUT_LIMIT (2048) truncation
      // point; the payloads differ only afterwards. Hashing the full payload
      // (digest truncated, not input) must keep them distinct.
      const prefix = 'x'.repeat(4000);
      const h1 = hashToolCall('Write', { file_path: 'big.txt', content: prefix + 'AAA' });
      const h2 = hashToolCall('Write', { file_path: 'big.txt', content: prefix + 'BBB' });
      assert.notStrictEqual(h1, h2);
    })
  )
    passed++;
  else failed++;

  if (
    test('non-file tools hash by stable input to avoid false loop collisions', () => {
      const h1 = hashToolCall('Glob', { pattern: '**/*.js', path: '/repo/a' });
      const h2 = hashToolCall('Glob', { pattern: '**/*.md', path: '/repo/a' });
      const h3 = hashToolCall('Glob', { path: '/repo/a', pattern: '**/*.js' });
      assert.notStrictEqual(h1, h2);
      assert.strictEqual(h1, h3);
    })
  )
    passed++;
  else failed++;

  // extractFilePaths tests
  console.log('\nextractFilePaths:');

  if (
    test('Edit with file_path returns [file_path]', () => {
      const paths = extractFilePaths('Edit', { file_path: 'a.js' });
      assert.deepStrictEqual(paths, ['a.js']);
    })
  )
    passed++;
  else failed++;

  if (
    test('MultiEdit with edits array returns all file_paths', () => {
      const paths = extractFilePaths('MultiEdit', {
        edits: [{ file_path: 'a.js' }, { file_path: 'b.js' }]
      });
      assert.deepStrictEqual(paths, ['a.js', 'b.js']);
    })
  )
    passed++;
  else failed++;

  if (
    test('Bash with command returns empty array', () => {
      const paths = extractFilePaths('Bash', { command: 'ls' });
      assert.deepStrictEqual(paths, []);
    })
  )
    passed++;
  else failed++;

  if (
    test('null toolInput returns empty array', () => {
      const paths = extractFilePaths('Edit', null);
      assert.deepStrictEqual(paths, []);
    })
  )
    passed++;
  else failed++;

  // readSessionCost tests
  console.log('\nreadSessionCost:');

  if (
    test('nonexistent session returns object with numeric fields', () => {
      const result = readSessionCost('nonexistent-session-cost-test-xyz-999');
      assert.strictEqual(typeof result.totalCost, 'number');
      assert.strictEqual(typeof result.totalIn, 'number');
      assert.strictEqual(typeof result.totalOut, 'number');
      assert.ok(result.totalCost >= 0, 'totalCost should be non-negative');
    })
  )
    passed++;
  else failed++;

  if (
    test('readSessionCost returns the LAST cumulative row, not the sum (cost-tracker contract)', () => {
      // cost-tracker.js writes one row per Stop event; each row is already
      // a cumulative session total ("To get per-session cost, take the
      // last row per session_id."). Summing across rows over-counts:
      // 0.01 + 0.02 + 0.03 = 0.06, but the correct answer is 0.03.
      const tmpHome = makeTempHome();
      const originalHome = process.env.HOME;
      const originalUserProfile = process.env.USERPROFILE;
      try {
        process.env.HOME = tmpHome;
        process.env.USERPROFILE = tmpHome;
        const metricsDir = path.join(tmpHome, '.claude', 'metrics');
        fs.mkdirSync(metricsDir, { recursive: true });
        fs.writeFileSync(
          path.join(metricsDir, 'costs.jsonl'),
          [
            JSON.stringify({ session_id: 'S1', estimated_cost_usd: 0.01, input_tokens: 333, output_tokens: 166 }),
            JSON.stringify({ session_id: 'S1', estimated_cost_usd: 0.02, input_tokens: 666, output_tokens: 333 }),
            JSON.stringify({ session_id: 'S1', estimated_cost_usd: 0.03, input_tokens: 1000, output_tokens: 500 })
          ].join('\n') + '\n',
          'utf8'
        );
        const result = readSessionCost('S1');
        assert.strictEqual(result.totalCost, 0.03, `expected last-row 0.03, got ${result.totalCost} (was the bug: 0.06)`);
        assert.strictEqual(result.totalIn, 1000);
        assert.strictEqual(result.totalOut, 500);
      } finally {
        if (originalHome === undefined) delete process.env.HOME;
        else process.env.HOME = originalHome;
        if (originalUserProfile === undefined) delete process.env.USERPROFILE;
        else process.env.USERPROFILE = originalUserProfile;
        fs.rmSync(tmpHome, { recursive: true, force: true });
      }
    })
  )
    passed++;
  else failed++;

  if (
    test('readSessionCost finds session row beyond the old 8 KiB tail boundary', () => {
      // The previous implementation read only the trailing 8 KiB of
      // costs.jsonl. A long-running deployment where the target session's
      // most recent cumulative row sat further back than that — e.g.
      // pushed past by many rows from OTHER sessions — silently saw
      // cost=0. This test wedges the S1 row at the file start, fills
      // ~16 KiB of OTHER-session noise after it, and asserts the S1 row
      // is still found.
      const tmpHome = makeTempHome();
      const originalHome = process.env.HOME;
      const originalUserProfile = process.env.USERPROFILE;
      try {
        process.env.HOME = tmpHome;
        process.env.USERPROFILE = tmpHome;
        const metricsDir = path.join(tmpHome, '.claude', 'metrics');
        fs.mkdirSync(metricsDir, { recursive: true });
        const otherRow = JSON.stringify({ session_id: 'OTHER', estimated_cost_usd: 1, input_tokens: 100, output_tokens: 50 });
        const s1Row = JSON.stringify({ session_id: 'S1', estimated_cost_usd: 0.5, input_tokens: 500, output_tokens: 250 });
        const rows = [s1Row, ...Array(200).fill(otherRow)];
        fs.writeFileSync(path.join(metricsDir, 'costs.jsonl'), rows.join('\n') + '\n', 'utf8');
        // Confirm we're actually past the old 8 KiB ceiling so the test
        // would have failed under the previous implementation.
        const size = fs.statSync(path.join(metricsDir, 'costs.jsonl')).size;
        assert.ok(size > 8192, `setup: expected costs.jsonl > 8 KiB, got ${size} bytes`);
        const result = readSessionCost('S1');
        assert.strictEqual(result.totalCost, 0.5);
        assert.strictEqual(result.totalIn, 500);
        assert.strictEqual(result.totalOut, 250);
      } finally {
        if (originalHome === undefined) delete process.env.HOME;
        else process.env.HOME = originalHome;
        if (originalUserProfile === undefined) delete process.env.USERPROFILE;
        else process.env.USERPROFILE = originalUserProfile;
        fs.rmSync(tmpHome, { recursive: true, force: true });
      }
    })
  )
    passed++;
  else failed++;

  if (
    test('readSessionCost writes one stderr breadcrumb when malformed lines persist across calls', () => {
      // Reviewer (coderabbitai) asked for diagnosability when the inner
      // catch silently skips malformed JSON rows. Verify the aggregated
      // "skipped N malformed line(s)" breadcrumb appears on stderr while
      // the function still recovers the last valid matching row. Because
      // this hook runs after every tool invocation, the same bad rows should
      // not emit the same warning on every call.
      const tmpHome = makeTempHome();
      const originalHome = process.env.HOME;
      const originalUserProfile = process.env.USERPROFILE;
      const originalStderrWrite = process.stderr.write.bind(process.stderr);
      let captured = '';
      process.stderr.write = chunk => {
        captured += String(chunk);
        return true;
      };
      try {
        process.env.HOME = tmpHome;
        process.env.USERPROFILE = tmpHome;
        const metricsDir = path.join(tmpHome, '.claude', 'metrics');
        fs.mkdirSync(metricsDir, { recursive: true });
        fs.writeFileSync(
          path.join(metricsDir, 'costs.jsonl'),
          [
            JSON.stringify({ session_id: 'S1', estimated_cost_usd: 0.5, input_tokens: 500, output_tokens: 250 }),
            'NOT_JSON',
            '{"truncated":',
            JSON.stringify({ session_id: 'S1', estimated_cost_usd: 0.7, input_tokens: 700, output_tokens: 350 }),
          ].join('\n') + '\n',
          'utf8'
        );
        const result = readSessionCost('S1');
        assert.strictEqual(result.totalCost, 0.7, 'last valid row should still win');
        const secondResult = readSessionCost('S1');
        assert.deepStrictEqual(secondResult, result);
        const matches = captured.match(/skipped 2 malformed line\(s\)/g) || [];
        assert.strictEqual(matches.length, 1,
          `expected one aggregated malformed-line breadcrumb on stderr, got: ${captured}`);
      } finally {
        process.stderr.write = originalStderrWrite;
        if (originalHome === undefined) delete process.env.HOME;
        else process.env.HOME = originalHome;
        if (originalUserProfile === undefined) delete process.env.USERPROFILE;
        else process.env.USERPROFILE = originalUserProfile;
        fs.rmSync(tmpHome, { recursive: true, force: true });
      }
    })
  )
    passed++;
  else failed++;

  if (
    test('readSessionCost suppresses repeated malformed breadcrumbs across hook subprocesses', () => {
      const tmpHome = makeTempHome();
      const originalHome = process.env.HOME;
      const originalUserProfile = process.env.USERPROFILE;
      try {
        process.env.HOME = tmpHome;
        process.env.USERPROFILE = tmpHome;
        const metricsDir = path.join(tmpHome, '.claude', 'metrics');
        fs.mkdirSync(metricsDir, { recursive: true });
        fs.writeFileSync(
          path.join(metricsDir, 'costs.jsonl'),
          [
            JSON.stringify({ session_id: 'S1', estimated_cost_usd: 0.7, input_tokens: 700, output_tokens: 350 }),
            'NOT_JSON',
            '{"truncated":'
          ].join('\n') + '\n',
          'utf8'
        );

        const bridgePath = path.resolve(__dirname, '../../scripts/hooks/ecc-metrics-bridge');
        const code = "const { readSessionCost } = require(process.argv[1]); readSessionCost('S1');";
        const env = { ...process.env, HOME: tmpHome, USERPROFILE: tmpHome };
        const first = spawnSync(process.execPath, ['-e', code, bridgePath], { env, encoding: 'utf8' });
        const second = spawnSync(process.execPath, ['-e', code, bridgePath], { env, encoding: 'utf8' });

        assert.strictEqual(first.status, 0, first.stderr || first.stdout);
        assert.strictEqual(second.status, 0, second.stderr || second.stdout);
        assert.match(first.stderr, /skipped 2 malformed line\(s\)/);
        assert.strictEqual(second.stderr, '', `expected repeat subprocess warning suppression, got: ${second.stderr}`);
      } finally {
        if (originalHome === undefined) delete process.env.HOME;
        else process.env.HOME = originalHome;
        if (originalUserProfile === undefined) delete process.env.USERPROFILE;
        else process.env.USERPROFILE = originalUserProfile;
        fs.rmSync(tmpHome, { recursive: true, force: true });
      }
    })
  )
    passed++;
  else failed++;

  if (
    test('readSessionCost stays silent when costs.jsonl does not exist (ENOENT)', () => {
      // ENOENT is the common case before any Stop event has fired — it is
      // not a failure and should not produce stderr noise. Other errors
      // (permission, EISDIR, etc.) DO produce a breadcrumb, covered by the
      // malformed-line test above's surrounding harness.
      const tmpHome = makeTempHome();
      const originalHome = process.env.HOME;
      const originalUserProfile = process.env.USERPROFILE;
      const originalStderrWrite = process.stderr.write.bind(process.stderr);
      let captured = '';
      process.stderr.write = chunk => {
        captured += String(chunk);
        return true;
      };
      try {
        process.env.HOME = tmpHome;
        process.env.USERPROFILE = tmpHome;
        // Do NOT create the metrics dir or file — readSessionCost should
        // hit ENOENT and return zeros silently.
        const result = readSessionCost('S1');
        assert.deepStrictEqual(result, { totalCost: 0, totalIn: 0, totalOut: 0 });
        assert.strictEqual(captured, '', `expected no stderr on ENOENT, got: ${captured}`);
      } finally {
        process.stderr.write = originalStderrWrite;
        if (originalHome === undefined) delete process.env.HOME;
        else process.env.HOME = originalHome;
        if (originalUserProfile === undefined) delete process.env.USERPROFILE;
        else process.env.USERPROFILE = originalUserProfile;
        fs.rmSync(tmpHome, { recursive: true, force: true });
      }
    })
  )
    passed++;
  else failed++;

  if (
    test('readSessionCost does not include unrelated default-session rows', () => {
      const tmpHome = makeTempHome();
      const originalHome = process.env.HOME;
      const originalUserProfile = process.env.USERPROFILE;
      try {
        process.env.HOME = tmpHome;
        process.env.USERPROFILE = tmpHome;
        const metricsDir = path.join(tmpHome, '.claude', 'metrics');
        fs.mkdirSync(metricsDir, { recursive: true });
        fs.writeFileSync(
          path.join(metricsDir, 'costs.jsonl'),
          [
            JSON.stringify({ session_id: 'default', estimated_cost_usd: 50, input_tokens: 1000, output_tokens: 2000 }),
            JSON.stringify({ session_id: 'target-session', estimated_cost_usd: 1.25, input_tokens: 10, output_tokens: 20 })
          ].join('\n') + '\n',
          'utf8'
        );
        const result = readSessionCost('target-session');
        assert.strictEqual(result.totalCost, 1.25);
        assert.strictEqual(result.totalIn, 10);
        assert.strictEqual(result.totalOut, 20);
      } finally {
        if (originalHome === undefined) delete process.env.HOME;
        else process.env.HOME = originalHome;
        if (originalUserProfile === undefined) delete process.env.USERPROFILE;
        else process.env.USERPROFILE = originalUserProfile;
        fs.rmSync(tmpHome, { recursive: true, force: true });
      }
    })
  )
    passed++;
  else failed++;

  // run tests
  console.log('\nrun:');

  if (
    test('empty input returns empty input without crashing', () => {
      const result = run('');
      assert.strictEqual(result, '');
    })
  )
    passed++;
  else failed++;

  if (
    test('whitespace-only input returns input unchanged', () => {
      const result = run('   ');
      assert.strictEqual(result, '   ');
    })
  )
    passed++;
  else failed++;

  if (
    test('input without session_id returns input unchanged', () => {
      const input = JSON.stringify({ tool_name: 'Bash', tool_input: { command: 'ls' } });
      const result = run(input);
      assert.strictEqual(result, input);
    })
  )
    passed++;
  else failed++;

  // Summary
  console.log(`\nResults: ${passed} passed, ${failed} failed\n`);
  return { passed, failed };
}

const { failed } = runTests();
process.exit(failed > 0 ? 1 : 0);
