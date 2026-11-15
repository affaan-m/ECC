/**
 * Tests for scripts/gateguard-report.js
 */

'use strict';

const assert = require('assert');
const fs = require('fs');
const os = require('os');
const path = require('path');
const { spawnSync } = require('child_process');

const SCRIPT = path.join(__dirname, '..', '..', 'scripts', 'gateguard-report.js');
const FIXTURE_DIR = path.join(__dirname, '..', 'fixtures', 'gateguard-metrics');
const { loadMetrics, summarize, formatReport, parseArgs } = require('../../scripts/gateguard-report');

let passed = 0;
let failed = 0;

function test(name, fn) {
  try {
    fn();
    console.log(`  ✓ ${name}`);
    passed++;
  } catch (error) {
    console.log(`  ✗ ${name}`);
    console.log(`    Error: ${error.message}`);
    failed++;
  }
}

function run(args, env = {}) {
  const result = spawnSync('node', [SCRIPT, ...args], {
    encoding: 'utf8',
    env: { ...process.env, ...env },
    timeout: 10000
  });
  return { status: result.status, stdout: result.stdout || '', stderr: result.stderr || '' };
}

console.log('\n=== Testing gateguard-report ===\n');

const loaded = loadMetrics(FIXTURE_DIR);
const report = summarize(loaded.events);

test('reads the rotated file first, then the current file', () => {
  assert.strictEqual(loaded.events.length, 12);
  assert.strictEqual(loaded.events[0].ts, '2026-09-01T10:00:00.000Z');
  assert.strictEqual(loaded.events[11].decision, 'pass-checked');
  assert.deepStrictEqual(loaded.files.map(f => path.basename(f)), ['metrics.jsonl.1', 'metrics.jsonl']);
});

test('skips malformed, unknown-version, unknown-decision and non-code lines', () => {
  assert.strictEqual(loaded.skipped, 6);
  assert.ok(loaded.events.every(e => e.session === 'aaaaaaaaaaaa' || e.session === 'bbbbbbbbbbbb'));
  assert.ok(!loaded.events.some(e => String(e.reason).includes('/')));
});

test('counts decisions by type', () => {
  assert.deepStrictEqual(report.total.decisions, {
    deny: 4,
    cap: 1,
    credit: 1,
    'destructive-deny': 1,
    'pass-checked': 1,
    'routine-deny': 1,
    'routine-readonly': 1,
    sibling: 1,
    trivial: 1
  });
  assert.strictEqual(report.total.events, 12);
});

test('breaks denials down by class and reason', () => {
  assert.strictEqual(report.total.denials.total, 6);
  assert.deepStrictEqual(report.total.denials.byClass, { code: 3, shell: 2, config: 1 });
  assert.deepStrictEqual(report.total.denials.byReason, {
    'first-touch': 2,
    destructive: 1,
    'first-command': 1,
    'near-miss:out-of-scope': 1,
    sensitive: 1
  });
});

test('reports the near-miss share of first-touch denials', () => {
  assert.deepStrictEqual(report.total.nearMiss, { count: 1, of: 4, share: 0.25 });
});

test('reports first-touch outcome rates', () => {
  const { firstTouch } = report.total;
  assert.strictEqual(firstTouch.total, 8);
  assert.deepStrictEqual(firstTouch.counts, { deny: 4, credit: 1, sibling: 1, cap: 1, trivial: 1 });
  assert.strictEqual(firstTouch.rates.deny, 0.5);
  assert.strictEqual(firstTouch.rates.trivial, 0.125);
});

test('counts routine read-only passes and ranks the most-asked questions', () => {
  assert.strictEqual(report.total.routineReadonlyPasses, 1);
  assert.deepStrictEqual(report.total.topQuestions.slice(0, 3), [
    ['quote-instruction', 4],
    ['callers', 1],
    ['config-effect', 1]
  ]);
});

test('summarizes each session separately in order of first appearance', () => {
  assert.deepStrictEqual(Object.keys(report.sessions), ['aaaaaaaaaaaa', 'bbbbbbbbbbbb']);
  const a = report.sessions.aaaaaaaaaaaa;
  assert.strictEqual(a.events, 6);
  assert.strictEqual(a.denials.total, 3);
  assert.deepStrictEqual(a.nearMiss, { count: 1, of: 2, share: 0.5 });
  assert.strictEqual(a.firstTouch.total, 4);
  assert.strictEqual(a.first, '2026-09-01T10:00:00.000Z');
  assert.strictEqual(a.last, '2026-09-01T10:05:00.000Z');
  const b = report.sessions.bbbbbbbbbbbb;
  assert.strictEqual(b.events, 6);
  assert.deepStrictEqual(b.denials.byClass, { code: 1, config: 1, shell: 1 });
  assert.strictEqual(b.routineReadonlyPasses, 0);
});

test('reports empty rates as null instead of dividing by zero', () => {
  const empty = summarize([]);
  assert.strictEqual(empty.total.events, 0);
  assert.strictEqual(empty.total.nearMiss.share, null);
  assert.strictEqual(empty.total.firstTouch.rates.deny, null);
});

test('formats a readable text report', () => {
  const text = formatReport({ ...loaded, report });
  assert.ok(text.includes('12 events in 2 sessions (6 malformed lines skipped)'));
  assert.ok(text.includes('Total'));
  assert.ok(text.includes('Session aaaaaaaaaaaa'));
  assert.ok(text.includes('near-miss share of first-touch denials: 25.0% (1 of 4)'));
  assert.ok(text.includes('routine read-only passes: 1'));
  assert.ok(text.includes('quote-instruction 4'));
});

test('parses --dir, --dir=, --json and --help', () => {
  assert.deepStrictEqual(parseArgs(['--dir', '/x', '--json']), { dir: '/x', json: true, help: false });
  assert.deepStrictEqual(parseArgs(['--dir=/y']), { dir: '/y', json: false, help: false });
  assert.strictEqual(parseArgs(['-h']).help, true);
  assert.throws(() => parseArgs(['--dir']), /Missing value for --dir/);
  assert.throws(() => parseArgs(['--bogus']), /Unknown argument: --bogus/);
});

test('CLI prints JSON with --json', () => {
  const result = run(['--dir', FIXTURE_DIR, '--json']);
  assert.strictEqual(result.status, 0, result.stderr);
  const parsed = JSON.parse(result.stdout);
  assert.strictEqual(parsed.events, 12);
  assert.strictEqual(parsed.skipped, 6);
  assert.strictEqual(parsed.total.denials.total, 6);
  assert.deepStrictEqual(Object.keys(parsed.sessions), ['aaaaaaaaaaaa', 'bbbbbbbbbbbb']);
});

test('CLI reads GATEGUARD_STATE_DIR when --dir is not given', () => {
  const result = run([], { GATEGUARD_STATE_DIR: FIXTURE_DIR });
  assert.strictEqual(result.status, 0, result.stderr);
  assert.ok(result.stdout.includes('12 events in 2 sessions'));
});

test('CLI explains how to enable metrics when none are found', () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'gateguard-report-'));
  try {
    const result = run(['--dir', dir]);
    assert.strictEqual(result.status, 0, result.stderr);
    assert.ok(result.stdout.includes('No GateGuard metrics'));
    assert.ok(result.stdout.includes('GATEGUARD_METRICS=1'));
  } finally {
    fs.rmSync(dir, { recursive: true, force: true });
  }
});

test('CLI exits 1 on an unknown argument', () => {
  const result = run(['--bogus']);
  assert.strictEqual(result.status, 1);
  assert.ok(result.stderr.includes('Unknown argument: --bogus'));
});

console.log(`\n  ${passed} passed, ${failed} failed\n`);
process.exit(failed > 0 ? 1 : 0);
