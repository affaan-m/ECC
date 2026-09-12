'use strict';

const assert = require('assert');
const fs = require('fs');
const os = require('os');
const path = require('path');
const {
  COST_SNAPSHOT_SCHEMA_VERSION,
  getCostSnapshotPath,
  publishAppendedSessionCostSnapshot,
  readSessionCostSnapshot,
} = require('../../scripts/lib/session-cost-snapshot');

function test(name, fn) {
  try {
    fn();
    console.log(`  PASS  ${name}`);
    return true;
  } catch (error) {
    console.log(`  FAIL  ${name}`);
    console.log(`        ${error.message}`);
    return false;
  }
}

const root = fs.mkdtempSync(path.join(os.tmpdir(), 'ecc-cost-snapshot-'));
const costLogPath = path.join(root, 'costs.jsonl');
let passed = 0;
let failed = 0;

try {
  if (test('round-trips a versioned cumulative row atomically', () => {
    const row = {
      session_id: 'session-1',
      estimated_cost_usd: 1.25,
      input_tokens: 10,
      output_tokens: 20
    };
    fs.writeFileSync(costLogPath, `${JSON.stringify(row)}\n`, 'utf8');
    assert.strictEqual(publishAppendedSessionCostSnapshot(root, 'session-1', row), true);
    const filePath = getCostSnapshotPath(root, 'session-1');
    assert.strictEqual(filePath, getCostSnapshotPath(root, 'session-1'));
    assert.deepStrictEqual(readSessionCostSnapshot(root, 'session-1'), row);
    assert.deepStrictEqual(
      fs.readdirSync(path.dirname(filePath)).filter(name => name.endsWith('.tmp')),
      []
    );
  })) passed++; else failed++;

  if (test('replaces the previous cumulative row for the same session', () => {
    const first = {
      session_id: 'session-update',
      estimated_cost_usd: 1,
      input_tokens: 100,
      output_tokens: 50
    };
    fs.writeFileSync(costLogPath, `${JSON.stringify(first)}\n`, 'utf8');
    assert.strictEqual(publishAppendedSessionCostSnapshot(root, 'session-update', first), true);
    const latest = {
      session_id: 'session-update',
      estimated_cost_usd: 2,
      input_tokens: 200,
      output_tokens: 100
    };
    fs.appendFileSync(costLogPath, `${JSON.stringify(latest)}\n`, 'utf8');
    assert.strictEqual(publishAppendedSessionCostSnapshot(root, 'session-update', latest), true);
    assert.deepStrictEqual(readSessionCostSnapshot(root, 'session-update'), latest);
  })) passed++; else failed++;

  if (test('invalidates a snapshot when the append-only cost log advances', () => {
    const first = {
      session_id: 'session-stale',
      estimated_cost_usd: 1,
      input_tokens: 100,
      output_tokens: 50
    };
    fs.writeFileSync(costLogPath, `${JSON.stringify(first)}\n`, 'utf8');
    assert.strictEqual(publishAppendedSessionCostSnapshot(root, 'session-stale', first), true);
    fs.appendFileSync(
      costLogPath,
      `${JSON.stringify({ session_id: 'session-stale', estimated_cost_usd: 2, input_tokens: 200, output_tokens: 100 })}\n`,
      'utf8'
    );
    assert.strictEqual(readSessionCostSnapshot(root, 'session-stale'), null);
  })) passed++; else failed++;

  if (test('a delayed older writer cannot overwrite the newest session row', () => {
    const older = { session_id: 'session-race', estimated_cost_usd: 1, input_tokens: 100, output_tokens: 50 };
    const newer = { session_id: 'session-race', estimated_cost_usd: 2, input_tokens: 200, output_tokens: 100 };
    fs.writeFileSync(costLogPath, `${JSON.stringify(older)}\n`, 'utf8');
    fs.appendFileSync(costLogPath, `${JSON.stringify(newer)}\n`, 'utf8');
    assert.strictEqual(publishAppendedSessionCostSnapshot(root, 'session-race', newer), true);
    assert.strictEqual(publishAppendedSessionCostSnapshot(root, 'session-race', older), false);
    assert.deepStrictEqual(readSessionCostSnapshot(root, 'session-race'), newer);
  })) passed++; else failed++;

  if (test('rejects unsafe session IDs instead of escaping the snapshot directory', () => {
    const unsafeId = '../outside';
    const row = { session_id: unsafeId, estimated_cost_usd: 9, input_tokens: 9, output_tokens: 9 };
    fs.writeFileSync(costLogPath, `${JSON.stringify(row)}\n`, 'utf8');
    assert.throws(
      () => publishAppendedSessionCostSnapshot(root, unsafeId, row),
      /safe session ID/
    );

    const escapedPath = path.join(root, 'outside.json');
    fs.writeFileSync(
      escapedPath,
      JSON.stringify({ schema_version: COST_SNAPSHOT_SCHEMA_VERSION, row }),
      'utf8'
    );
    assert.strictEqual(readSessionCostSnapshot(root, unsafeId), null);
  })) passed++; else failed++;

  if (test('prefixes Windows reserved device names with a safe basename', () => {
    assert.strictEqual(path.basename(getCostSnapshotPath(root, 'CON')), 'session-CON.json');
    assert.strictEqual(path.basename(getCostSnapshotPath(root, 'nul')), 'session-nul.json');
  })) passed++; else failed++;

  if (test('rejects a snapshot whose row is bound to another session', () => {
    const filePath = getCostSnapshotPath(root, 'session-2');
    fs.mkdirSync(path.dirname(filePath), { recursive: true });
    fs.writeFileSync(
      filePath,
      JSON.stringify({
        schema_version: COST_SNAPSHOT_SCHEMA_VERSION,
        row: { session_id: 'session-3', estimated_cost_usd: 3 }
      }),
      'utf8'
    );
    assert.strictEqual(readSessionCostSnapshot(root, 'session-2'), null);
  })) passed++; else failed++;

  if (test('rejects rows with missing, non-numeric, or negative totals', () => {
    const invalidRows = [
      { session_id: 'invalid-row', input_tokens: 1, output_tokens: 1 },
      { session_id: 'invalid-row', estimated_cost_usd: '1', input_tokens: 1, output_tokens: 1 },
      { session_id: 'invalid-row', estimated_cost_usd: 1, input_tokens: -1, output_tokens: 1 },
      { session_id: 'invalid-row', estimated_cost_usd: 1, input_tokens: 1, output_tokens: Infinity }
    ];
    for (const row of invalidRows) {
      fs.writeFileSync(costLogPath, `${JSON.stringify(row)}\n`, 'utf8');
      assert.throws(
        () => publishAppendedSessionCostSnapshot(root, 'invalid-row', row),
        /valid non-negative numeric totals/
      );
    }
  })) passed++; else failed++;

  if (test('rejects unknown schemas and malformed JSON', () => {
    const filePath = getCostSnapshotPath(root, 'session-4');
    fs.mkdirSync(path.dirname(filePath), { recursive: true });
    fs.writeFileSync(
      filePath,
      JSON.stringify({
        schema_version: 'ecc.cost-snapshot.v999',
        row: { session_id: 'session-4' }
      }),
      'utf8'
    );
    assert.strictEqual(readSessionCostSnapshot(root, 'session-4'), null);
    fs.writeFileSync(filePath, '{broken', 'utf8');
    assert.strictEqual(readSessionCostSnapshot(root, 'session-4'), null);
  })) passed++; else failed++;
} finally {
  fs.rmSync(root, { recursive: true, force: true });
}

console.log(`\nResults: ${passed} passed, ${failed} failed`);
process.exit(failed > 0 ? 1 : 0);
