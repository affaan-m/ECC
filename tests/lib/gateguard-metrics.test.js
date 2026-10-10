/**
 * Tests for scripts/lib/gateguard-metrics.js
 */

'use strict';

const assert = require('assert');
const crypto = require('crypto');
const fs = require('fs');
const os = require('os');
const path = require('path');

const {
  DECISIONS,
  METRICS_FILE_NAME,
  METRICS_MAX_BYTES,
  metricsEvent,
  appendMetrics,
  isMetricsEvent
} = require('../../scripts/lib/gateguard-metrics');

let passed = 0;
let failed = 0;

function test(name, fn) {
  try {
    fn();
    console.log(`  \u2713 ${name}`);
    passed++;
  } catch (error) {
    console.log(`  \u2717 ${name}`);
    console.log(`    Error: ${error.message}`);
    failed++;
  }
}

const NOW = Date.parse('2026-09-01T10:00:00.000Z');
const base = { sessionKey: 'sess-1', tool: 'Edit', decision: 'deny', reason: 'first-touch', now: NOW };

console.log('\n=== Testing gateguard-metrics ===\n');

test('builds a schema 1 event with a 12-character session digest', () => {
  const event = metricsEvent({
    ...base,
    cls: 'code',
    questions: ['importers', 'quote-instruction'],
    sensitive: false,
    profile: { known: true, language: 'js', touchesPublicSurface: true, touchesData: false, trivial: false, extra: 'x' }
  });
  assert.deepStrictEqual(event, {
    v: 1,
    ts: '2026-09-01T10:00:00.000Z',
    session: crypto.createHash('sha256').update('sess-1').digest('hex').slice(0, 12),
    tool: 'Edit',
    class: 'code',
    decision: 'deny',
    reason: 'first-touch',
    questions: ['importers', 'quote-instruction'],
    sensitive: false,
    profile: { known: true, language: 'js', touchesPublicSurface: true, touchesData: false, trivial: false }
  });
  assert.ok(isMetricsEvent(event));
});

test('returns null for unknown decisions or tools', () => {
  assert.strictEqual(metricsEvent({ ...base, decision: 'allow' }), null);
  assert.strictEqual(metricsEvent({ ...base, tool: 'Read' }), null);
});

test('drops any class, reason, question or language that is not a short code', () => {
  const event = metricsEvent({
    ...base,
    cls: '/src/app.js',
    reason: 'rm -rf /',
    questions: ['importers', '/etc/passwd', 'x'.repeat(100)],
    profile: { known: true, language: 'C:\\x' }
  });
  assert.strictEqual(event.class, null);
  assert.strictEqual(event.reason, null);
  assert.deepStrictEqual(event.questions, ['importers']);
  assert.strictEqual(event.profile.language, null);
});

test('records NotebookEdit decisions and the hard-linked reason codes', () => {
  const event = metricsEvent({ ...base, tool: 'NotebookEdit', reason: 'hard-linked' });
  assert.strictEqual(event.tool, 'NotebookEdit');
  assert.strictEqual(event.reason, 'hard-linked');
  assert.ok(isMetricsEvent(event));
  assert.strictEqual(metricsEvent({ ...base, reason: 'subagent-hard-linked' }).reason, 'subagent-hard-linked');
});

test('keeps near-miss reason codes', () => {
  assert.strictEqual(metricsEvent({ ...base, reason: 'near-miss:out-of-scope' }).reason, 'near-miss:out-of-scope');
});

test('lists every decision the hook records', () => {
  assert.deepStrictEqual([...DECISIONS].sort(), [
    'cap',
    'credit',
    'deny',
    'destructive-deny',
    'pass',
    'pass-checked',
    'pass-exempt',
    'pass-subagent',
    'routine-deny',
    'routine-readonly',
    'sibling',
    'trivial'
  ]);
});

test('rejects events with the wrong shape', () => {
  const good = metricsEvent(base);
  assert.ok(isMetricsEvent(good));
  for (const bad of [
    null,
    [],
    { ...good, v: 2 },
    { ...good, session: 'ABC' },
    { ...good, decision: 'allow' },
    { ...good, tool: 'Read' },
    { ...good, reason: '/x' },
    { ...good, class: 'a b' },
    { ...good, questions: ['ok', '/x'] },
    { ...good, sensitive: 'no' },
    { ...good, ts: 5 }
  ]) {
    assert.strictEqual(isMetricsEvent(bad), false, JSON.stringify(bad));
  }
});

test('appends one line per event in a single write and rotates past the cap', () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'gateguard-metrics-lib-'));
  try {
    const file = path.join(dir, 'nested', METRICS_FILE_NAME);
    assert.strictEqual(appendMetrics(path.dirname(file), [metricsEvent(base), null, metricsEvent({ ...base, decision: 'credit' })]), true);
    assert.strictEqual(fs.readFileSync(file, 'utf8').split('\n').filter(Boolean).length, 2);
    fs.writeFileSync(`${file}.1`, 'old\n');
    fs.writeFileSync(file, 'x'.repeat(METRICS_MAX_BYTES));
    assert.strictEqual(appendMetrics(path.dirname(file), [metricsEvent(base)]), true);
    assert.strictEqual(fs.statSync(`${file}.1`).size, METRICS_MAX_BYTES);
    assert.strictEqual(fs.readFileSync(file, 'utf8').split('\n').filter(Boolean).length, 1);
    assert.strictEqual(appendMetrics(path.dirname(file), [null]), false);
  } finally {
    fs.rmSync(dir, { recursive: true, force: true });
  }
});

test('reports failure instead of throwing when the file cannot be written', () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'gateguard-metrics-lib-'));
  try {
    fs.mkdirSync(path.join(dir, METRICS_FILE_NAME));
    assert.strictEqual(appendMetrics(dir, [metricsEvent(base)]), false);
  } finally {
    fs.rmSync(dir, { recursive: true, force: true });
  }
});

test('never writes through a symlink in place of the metrics file', () => {
  if (process.platform === 'win32') return;
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'gateguard-metrics-lib-'));
  try {
    const victim = path.join(dir, 'victim.txt');
    fs.writeFileSync(victim, 'keep\n');
    fs.symlinkSync(victim, path.join(dir, METRICS_FILE_NAME));
    assert.strictEqual(appendMetrics(dir, [metricsEvent(base)]), false);
    assert.strictEqual(fs.readFileSync(victim, 'utf8'), 'keep\n');
    fs.writeFileSync(victim, 'x'.repeat(METRICS_MAX_BYTES));
    assert.strictEqual(appendMetrics(dir, [metricsEvent(base)]), false);
    assert.strictEqual(fs.statSync(victim).size, METRICS_MAX_BYTES, 'a symlink is not rotated onto');
  } finally {
    fs.rmSync(dir, { recursive: true, force: true });
  }
});

console.log(`\n  ${passed} passed, ${failed} failed\n`);
process.exit(failed > 0 ? 1 : 0);
