/**
 * Tests for scripts/lib/eval-harness/capsule.js
 * Run with: node tests/lib/eval-harness/capsule.test.js
 */
'use strict';

const assert = require('assert');
const fs = require('fs');
const path = require('path');
const capsule = require('../../../scripts/lib/eval-harness/capsule');
const { test, tempDir, cleanup, finish, fixedClock } = require('./helpers');

console.log('\n=== eval-harness capsule ===\n');

function seeded(dir) {
  const c = capsule.Capsule.create(dir, { run_id: 'run-1', capsule_id: 'cap-1', harness_version: 't/1', task_family: 'f', clock: fixedClock });
  c.append('plan', 'start', { task_id: 'a' });
  c.append('attempt', 'run', { status: 'pass', passed: 3, total: 3 }, { effect_class: 'SE2' });
  c.append('interaction', 'tool.call', { tool: 'read', status: 'replayed' });
  c.append('environment', 'sandbox', { digest: 'abc' });
  c.append('strategy', 'verdict', { verdict: 'PROMOTE' });
  return c;
}

test('append links every entry to its predecessor and verify passes', () => {
  const dir = tempDir('append');
  try {
    const c = seeded(dir);
    const entries = c.entries();
    assert.strictEqual(entries.length, 5);
    assert.strictEqual(entries[0].parent_hash, '0'.repeat(64));
    for (let i = 1; i < entries.length; i += 1) {
      assert.strictEqual(entries[i].parent_hash, entries[i - 1].entry_hash);
      assert.strictEqual(entries[i].seq, i);
    }
    const result = capsule.verify(dir);
    assert.ok(result.ok, result.reason);
    assert.strictEqual(result.entry_count, 5);
    assert.strictEqual(result.root_hash, entries[4].entry_hash);
  } finally {
    cleanup(dir);
  }
});

test('append refuses non-allowlisted keys and secret canaries without advancing the journal', () => {
  const dir = tempDir('refuse');
  try {
    const c = seeded(dir);
    assert.throws(() => c.append('plan', 'x', { reasoning: 'hidden' }), /capsule.payload_denied|not allowlisted/);
    assert.throws(() => c.append('plan', 'x', { message: 'AKIAABCDEFGHIJKLMNOP' }), /canary/);
    assert.throws(() => c.append('feelings', 'x', {}), /lineage/);
    assert.strictEqual(capsule.verify(dir).entry_count, 5);
  } finally {
    cleanup(dir);
  }
});

test('tamper with one historical byte fails at the exact entry', () => {
  const dir = tempDir('tamper');
  try {
    seeded(dir);
    const journal = path.join(dir, capsule.JOURNAL_FILE);
    const lines = fs.readFileSync(journal, 'utf8').split('\n');
    lines[1] = lines[1].replace('"passed":3', '"passed":2');
    fs.writeFileSync(journal, lines.join('\n'));
    const result = capsule.verify(dir);
    assert.strictEqual(result.ok, false);
    assert.strictEqual(result.failed_at, 1);
    assert.strictEqual(result.code, 'capsule.invalid_entry');
  } finally {
    cleanup(dir);
  }
});

test('truncation and a partial trailing write fail closed', () => {
  const dir = tempDir('truncate');
  try {
    seeded(dir);
    const journal = path.join(dir, capsule.JOURNAL_FILE);
    const original = fs.readFileSync(journal, 'utf8');
    const lines = original.split('\n');
    // Drop the middle entry: the link from entry 3 to entry 1 breaks.
    fs.writeFileSync(journal, [lines[0], lines[1], lines[3], lines[4], ''].join('\n'));
    let result = capsule.verify(dir);
    assert.strictEqual(result.ok, false);
    assert.strictEqual(result.failed_at, 2);
    assert.strictEqual(result.code, 'capsule.reordered');
    // Crash mid-append: the last line has no newline.
    fs.writeFileSync(journal, original + '{"schema":"capsule-envelope/v1","seq":5');
    result = capsule.verify(dir);
    assert.strictEqual(result.ok, false);
    assert.strictEqual(result.code, 'capsule.truncated_tail');
    assert.strictEqual(result.failed_at, 5);
    // Recovery: the complete prefix is still readable through readJournal.
    fs.writeFileSync(journal, original);
    assert.ok(capsule.verify(dir).ok);
  } finally {
    cleanup(dir);
  }
});

test('reordering two entries fails closed', () => {
  const dir = tempDir('reorder');
  try {
    seeded(dir);
    const journal = path.join(dir, capsule.JOURNAL_FILE);
    const lines = fs.readFileSync(journal, 'utf8').split('\n');
    [lines[2], lines[3]] = [lines[3], lines[2]];
    fs.writeFileSync(journal, lines.join('\n'));
    const result = capsule.verify(dir);
    assert.strictEqual(result.ok, false);
    assert.strictEqual(result.failed_at, 2);
  } finally {
    cleanup(dir);
  }
});

test('open resumes the chain and projection is byte-for-byte stable', () => {
  const dir = tempDir('project');
  try {
    seeded(dir);
    const reopened = capsule.Capsule.open(dir, { clock: fixedClock });
    reopened.append('attempt', 'run', { status: 'pass' });
    assert.ok(capsule.verify(dir).ok);
    const first = JSON.stringify(capsule.writeProjection(dir));
    const second = JSON.stringify(capsule.writeProjection(dir));
    assert.strictEqual(first, second);
    const projection = JSON.parse(first);
    assert.deepStrictEqual(projection.by_lineage, { plan: 1, attempt: 2, interaction: 1, environment: 1, strategy: 1 });
    assert.strictEqual(projection.max_effect_class, 'SE2');
    assert.strictEqual(projection.entry_count, 6);
  } finally {
    cleanup(dir);
  }
});

test('exportBundle copies only the capsule files, never workspace contents', () => {
  const dir = tempDir('export');
  const out = tempDir('export-out');
  try {
    seeded(dir);
    fs.writeFileSync(path.join(dir, 'workspace-secret.txt'), 'do not copy');
    const bundle = capsule.exportBundle(dir, out);
    assert.deepStrictEqual(fs.readdirSync(out).sort(), ['capsule.json', 'journal.ndjson', 'projection.json']);
    assert.deepStrictEqual(bundle.files.sort(), ['capsule.json', 'journal.ndjson', 'projection.json']);
    assert.ok(capsule.verify(out).ok);
  } finally {
    cleanup(dir);
    cleanup(out);
  }
});

finish('capsule');
