'use strict';

const assert = require('assert');
const { execFileSync } = require('child_process');
const fs = require('fs');
const os = require('os');
const path = require('path');
const {
  appendSessionCostRow,
  getCostSnapshotPath,
  maybePruneSessionCostSnapshots,
  readSessionCostSnapshot,
  refreshSessionCostSnapshot,
  warnSessionCostSnapshotFailure
} = require('../../scripts/lib/session-cost-snapshot');

function row(sessionId, cost = 1) {
  return {
    timestamp: new Date(Date.UTC(2026, 0, 1, 0, 0, cost)).toISOString(),
    session_id: sessionId,
    estimated_cost_usd: cost,
    input_tokens: cost * 100,
    output_tokens: cost * 50
  };
}

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
let passed = 0;
let failed = 0;

try {
  if (test('appends and atomically publishes a private cumulative snapshot', () => {
    const current = row('session-1', 1.25);
    assert.strictEqual(appendSessionCostRow(root, 'session-1', current), true);
    const filePath = getCostSnapshotPath(root, 'session-1');
    assert.deepStrictEqual(readSessionCostSnapshot(root, 'session-1').row, current);
    assert.strictEqual(fs.statSync(filePath).mode & 0o777, 0o600);
    assert.deepStrictEqual(
      fs.readdirSync(path.dirname(filePath)).filter(name => name.endsWith('.tmp')),
      []
    );
  })) passed++; else failed++;

  if (test('replaces the previous cumulative row for the same session', () => {
    appendSessionCostRow(root, 'session-update', row('session-update', 1));
    const latest = row('session-update', 2);
    appendSessionCostRow(root, 'session-update', latest);
    assert.deepStrictEqual(readSessionCostSnapshot(root, 'session-update').row, latest);
  })) passed++; else failed++;

  if (test('a delayed older writer cannot lower the latest cumulative total', () => {
    const older = row('session-order', 1);
    const newer = row('session-order', 2);
    older.timestamp = new Date(Date.parse(newer.timestamp) + 1000).toISOString();
    assert.strictEqual(appendSessionCostRow(root, 'session-order', newer), true);
    assert.strictEqual(appendSessionCostRow(root, 'session-order', older), false);
    assert.deepStrictEqual(readSessionCostSnapshot(root, 'session-order').row, newer);
  })) passed++; else failed++;

  if (test('publication failure followed by an older writer still converges to the newer row', () => {
    const sessionId = 'session-publication-race';
    const older = row(sessionId, 1);
    const newer = row(sessionId, 2);
    older.timestamp = new Date(Date.parse(newer.timestamp) + 1000).toISOString();
    const snapshotPath = getCostSnapshotPath(root, sessionId);
    const originalRenameSync = fs.renameSync;
    let injectedFailure = false;
    fs.renameSync = function failNewerSnapshot(sourcePath, destinationPath) {
      if (!injectedFailure && path.resolve(destinationPath) === path.resolve(snapshotPath)) {
        injectedFailure = true;
        const error = new Error('injected snapshot publication failure');
        error.code = 'EIO';
        throw error;
      }
      return originalRenameSync.call(this, sourcePath, destinationPath);
    };
    try {
      assert.throws(() => appendSessionCostRow(root, sessionId, newer), /injected/);
    } finally {
      fs.renameSync = originalRenameSync;
    }
    assert.strictEqual(appendSessionCostRow(root, sessionId, older), false);
    assert.deepStrictEqual(readSessionCostSnapshot(root, sessionId).row, newer);
  })) passed++; else failed++;

  if (test('accepts increasing cumulative totals that share a timestamp', () => {
    const first = row('session-same-time', 1);
    const next = row('session-same-time', 2);
    next.timestamp = first.timestamp;
    appendSessionCostRow(root, 'session-same-time', first);
    assert.strictEqual(appendSessionCostRow(root, 'session-same-time', next), true);
    assert.deepStrictEqual(readSessionCostSnapshot(root, 'session-same-time').row, next);
  })) passed++; else failed++;

  if (test('uses timestamps when cumulative dimensions move in opposite directions', () => {
    const newer = row('session-mixed', 1);
    newer.input_tokens = 200;
    newer.output_tokens = 100;
    newer.timestamp = '2026-01-02T00:00:00.000Z';
    const delayedOlder = row('session-mixed', 2);
    delayedOlder.input_tokens = 100;
    delayedOlder.output_tokens = 50;
    delayedOlder.timestamp = '2026-01-01T00:00:00.000Z';
    appendSessionCostRow(root, 'session-mixed', newer);
    assert.strictEqual(appendSessionCostRow(root, 'session-mixed', delayedOlder), false);
    assert.deepStrictEqual(readSessionCostSnapshot(root, 'session-mixed').row, newer);
  })) passed++; else failed++;

  if (test('session B only creates a bounded delta scan for session A', () => {
    const sessionA = row('session-a', 3);
    appendSessionCostRow(root, 'session-a', sessionA);
    const sessionB = row('session-b', 4);
    appendSessionCostRow(root, 'session-b', sessionB);
    const refreshed = refreshSessionCostSnapshot(root, 'session-a');
    assert.deepStrictEqual(refreshed.row, sessionA);
    assert.ok(refreshed.scannedBytes > 0);
    assert.ok(refreshed.scannedBytes <= Buffer.byteLength(`${JSON.stringify(sessionB)}\n`));
    assert.strictEqual(refreshSessionCostSnapshot(root, 'session-a').scannedBytes, 0);
  })) passed++; else failed++;

  if (test('sessions with no row cache their progress cursor', () => {
    const caseRoot = path.join(root, 'missing-session');
    fs.mkdirSync(caseRoot, { recursive: true });
    const costsPath = path.join(caseRoot, 'costs.jsonl');
    const other = row('other-only', 1);
    fs.writeFileSync(costsPath, `${JSON.stringify(other)}\n`.repeat(4000), 'utf8');
    const first = refreshSessionCostSnapshot(caseRoot, 'missing');
    const second = refreshSessionCostSnapshot(caseRoot, 'missing');
    assert.ok(first.scannedBytes > 100000);
    assert.strictEqual(first.row, null);
    assert.strictEqual(second.scannedBytes, 0);
    assert.strictEqual(second.row, null);
  })) passed++; else failed++;

  if (test('does not advance the cursor past an incomplete trailing row', () => {
    const caseRoot = path.join(root, 'partial-row');
    fs.mkdirSync(caseRoot, { recursive: true });
    const current = row('partial', 6);
    const serialized = JSON.stringify(current);
    fs.writeFileSync(path.join(caseRoot, 'costs.jsonl'), serialized, 'utf8');
    const partial = refreshSessionCostSnapshot(caseRoot, 'partial');
    assert.deepStrictEqual(partial.row, current);
    assert.strictEqual(partial.scannedBytes, 0);
    assert.strictEqual(partial.malformed, 0);
    fs.appendFileSync(path.join(caseRoot, 'costs.jsonl'), '\n', 'utf8');
    const complete = refreshSessionCostSnapshot(caseRoot, 'partial');
    assert.deepStrictEqual(complete.row, current);
    assert.strictEqual(complete.scannedBytes, Buffer.byteLength(`${serialized}\n`));
  })) passed++; else failed++;

  if (test('never persists a provisional unterminated row when later bytes corrupt it', () => {
    const caseRoot = path.join(root, 'partial-corruption');
    fs.mkdirSync(caseRoot, { recursive: true });
    const costsPath = path.join(caseRoot, 'costs.jsonl');
    const provisional = row('partial-corruption', 7);
    fs.writeFileSync(costsPath, JSON.stringify(provisional), 'utf8');
    const first = refreshSessionCostSnapshot(caseRoot, 'partial-corruption');
    assert.deepStrictEqual(first.row, provisional);
    assert.strictEqual(first.scannedBytes, 0);

    const recovered = row('partial-corruption', 8);
    appendSessionCostRow(caseRoot, 'partial-corruption', recovered);
    assert.deepStrictEqual(refreshSessionCostSnapshot(caseRoot, 'partial-corruption').row, recovered);
  })) passed++; else failed++;

  if (test('keeps UTF-8 rows intact across the 64 KiB read boundary', () => {
    const caseRoot = path.join(root, 'utf8-boundary');
    fs.mkdirSync(caseRoot, { recursive: true });
    const current = { ...row('utf8', 7), note: `${'x'.repeat(65520)}数据` };
    fs.writeFileSync(
      path.join(caseRoot, 'costs.jsonl'),
      `${JSON.stringify(current)}\n`,
      'utf8'
    );
    assert.deepStrictEqual(refreshSessionCostSnapshot(caseRoot, 'utf8').row, current);
  })) passed++; else failed++;

  if (test('rebuilds after an in-place rewrite or inode rotation', () => {
    const caseRoot = path.join(root, 'rotation');
    fs.mkdirSync(caseRoot, { recursive: true });
    const costsPath = path.join(caseRoot, 'costs.jsonl');
    const first = row('rotated', 1);
    const rewritten = row('rotated', 9);
    appendSessionCostRow(caseRoot, 'rotated', first);
    fs.writeFileSync(costsPath, `${JSON.stringify(rewritten)}\n`, 'utf8');
    assert.deepStrictEqual(refreshSessionCostSnapshot(caseRoot, 'rotated').row, rewritten);

    const rotated = row('rotated', 10);
    fs.renameSync(costsPath, `${costsPath}.old`);
    fs.writeFileSync(costsPath, `${JSON.stringify(rotated)}\n`, 'utf8');
    assert.deepStrictEqual(refreshSessionCostSnapshot(caseRoot, 'rotated').row, rotated);
  })) passed++; else failed++;

  if (test('detects same-size in-place changes outside the tail window', () => {
    const caseRoot = path.join(root, 'same-size-rewrite');
    fs.mkdirSync(caseRoot, { recursive: true });
    const costsPath = path.join(caseRoot, 'costs.jsonl');
    const first = row('same-size', 1);
    const rewritten = { ...first, estimated_cost_usd: 9 };
    const filler = `${JSON.stringify(row('filler', 2))}\n`.repeat(20);
    fs.writeFileSync(costsPath, `${JSON.stringify(first)}\n${filler}`, 'utf8');
    refreshSessionCostSnapshot(caseRoot, 'same-size');
    fs.writeFileSync(costsPath, `${JSON.stringify(rewritten)}\n${filler}`, 'utf8');
    const rebuilt = refreshSessionCostSnapshot(caseRoot, 'same-size');
    assert.ok(rebuilt.scannedBytes > 0);
    assert.deepStrictEqual(rebuilt.row, rewritten);
  })) passed++; else failed++;

  if (test('rejects unsafe session IDs and prefixes Windows device names', () => {
    assert.throws(
      () => appendSessionCostRow(root, '../outside', row('../outside', 9)),
      /safe session ID/
    );
    assert.strictEqual(path.basename(getCostSnapshotPath(root, 'CON')), 'session-CON.json');
    assert.strictEqual(path.basename(getCostSnapshotPath(root, 'nul')), 'session-nul.json');
  })) passed++; else failed++;

  if (test('rejects rows with missing, non-numeric, or negative totals', () => {
    const invalidRows = [
      { session_id: 'invalid-row', input_tokens: 1, output_tokens: 1 },
      { session_id: 'invalid-row', estimated_cost_usd: '1', input_tokens: 1, output_tokens: 1 },
      { session_id: 'invalid-row', estimated_cost_usd: 1, input_tokens: -1, output_tokens: 1 },
      { session_id: 'invalid-row', estimated_cost_usd: 1, input_tokens: 1, output_tokens: Infinity }
    ];
    for (const invalidRow of invalidRows) {
      assert.throws(
        () => appendSessionCostRow(root, 'invalid-row', invalidRow),
        /valid non-negative numeric totals/
      );
    }
  })) passed++; else failed++;

  if (test('malformed snapshots rebuild from the authoritative JSONL', () => {
    const sessionId = 'session-invalid';
    const current = row(sessionId, 5);
    appendSessionCostRow(root, sessionId, current);
    fs.writeFileSync(getCostSnapshotPath(root, sessionId), '{broken', 'utf8');
    const rebuilt = refreshSessionCostSnapshot(root, sessionId);
    assert.deepStrictEqual(rebuilt.row, current);
    assert.deepStrictEqual(readSessionCostSnapshot(root, sessionId).row, current);
  })) passed++; else failed++;

  if (test('prunes expired snapshots and enforces the count bound', () => {
    const now = Date.now();
    for (let index = 0; index < 4; index += 1) {
      const sessionId = `prune-${index}`;
      appendSessionCostRow(root, sessionId, row(sessionId, index + 1));
      const old = new Date(now - ((index + 1) * 1000));
      fs.utimesSync(getCostSnapshotPath(root, sessionId), old, old);
    }
    const removed = maybePruneSessionCostSnapshots(root, {
      force: true,
      now,
      maxAgeMs: 2500,
      maxSnapshots: 2
    });
    const remaining = fs.readdirSync(path.join(root, 'cost-snapshots'))
      .filter(name => name.startsWith('session-'));
    assert.ok(removed >= 2);
    assert.ok(remaining.length <= 2);
  })) passed++; else failed++;

  if (test('enforces the count bound while the age-prune marker is fresh', () => {
    const caseRoot = path.join(root, 'count-bound');
    fs.mkdirSync(caseRoot, { recursive: true });
    const now = Date.now();
    assert.strictEqual(maybePruneSessionCostSnapshots(caseRoot, {
      force: true,
      now,
      maxSnapshots: 2
    }), 0);
    for (let index = 0; index < 5; index += 1) {
      appendSessionCostRow(caseRoot, `count-${index}`, row(`count-${index}`, index + 1));
    }
    const removed = maybePruneSessionCostSnapshots(caseRoot, {
      now: now + 1000,
      maxSnapshots: 2
    });
    const remaining = fs.readdirSync(path.join(caseRoot, 'cost-snapshots'))
      .filter(name => name.startsWith('session-'));
    assert.strictEqual(removed, 3);
    assert.strictEqual(remaining.length, 2);
  })) passed++; else failed++;

  if (test('deduplicates snapshot warnings independently by failure kind', () => {
    const caseRoot = path.join(root, 'warning-dedupe');
    const originalWrite = process.stderr.write.bind(process.stderr);
    let captured = '';
    process.stderr.write = chunk => {
      captured += String(chunk);
      return true;
    };
    try {
      const error = Object.assign(new Error('persistent failure'), { code: 'EIO' });
      warnSessionCostSnapshotFailure('publication', caseRoot, 'warn-session', error);
      warnSessionCostSnapshotFailure('repair', caseRoot, 'warn-session', error);
      warnSessionCostSnapshotFailure('publication', caseRoot, 'warn-session', error);
      warnSessionCostSnapshotFailure('repair', caseRoot, 'warn-session', error);
      const warnings = captured.trim().split('\n');
      assert.strictEqual(warnings.length, 2);
      assert.match(warnings[0], /publication failed/);
      assert.match(warnings[1], /repair failed/);
    } finally {
      process.stderr.write = originalWrite;
    }
  })) passed++; else failed++;

  if (test('deduplicates the same snapshot warning across concurrent processes', () => {
    const caseRoot = path.join(root, 'warning-concurrency');
    fs.mkdirSync(caseRoot, { recursive: true });
    const modulePath = path.resolve(__dirname, '../../scripts/lib/session-cost-snapshot.js');
    const workerScript = [
      "const fs = require('fs');",
      "const path = require('path');",
      "const [modulePath, metricsDir, gatePath, index] = process.argv.slice(1);",
      "fs.writeFileSync(path.join(metricsDir, `ready-${index}`), '');",
      "const timer = setInterval(() => {",
      "  if (!fs.existsSync(gatePath)) return;",
      "  clearInterval(timer);",
      "  const { warnSessionCostSnapshotFailure } = require(modulePath);",
      "  const error = Object.assign(new Error('persistent failure'), { code: 'EIO' });",
      "  warnSessionCostSnapshotFailure('publication', metricsDir, 'shared-session', error);",
      "}, 1);"
    ].join('\n');
    const orchestratorScript = [
      "const { spawn } = require('child_process');",
      "const fs = require('fs');",
      "const path = require('path');",
      "const [modulePath, metricsDir] = process.argv.slice(1);",
      "const gatePath = path.join(metricsDir, 'go');",
      `const workerScript = ${JSON.stringify(workerScript)};`,
      "const runs = Array.from({ length: 16 }, (_, index) => new Promise((resolve, reject) => {",
      "  const child = spawn(process.execPath, ['-e', workerScript, modulePath, metricsDir, gatePath, String(index)], { stdio: ['ignore', 'ignore', 'pipe'] });",
      "  let stderr = '';",
      "  child.stderr.on('data', chunk => { stderr += chunk; });",
      "  child.on('error', reject);",
      "  child.on('close', code => resolve({ code, stderr }));",
      "}));",
      "const readyTimer = setInterval(() => {",
      "  const ready = fs.readdirSync(metricsDir).filter(name => name.startsWith('ready-'));",
      "  if (ready.length !== runs.length) return;",
      "  clearInterval(readyTimer);",
      "  fs.writeFileSync(gatePath, 'go');",
      "}, 1);",
      "Promise.all(runs).then(results => {",
      "  const warnings = results.flatMap(result => result.stderr.split('\\n')).filter(line => line.includes('publication failed'));",
      "  process.stdout.write(JSON.stringify({ codes: results.map(result => result.code), warnings: warnings.length }));",
      "});"
    ].join('\n');
    const result = JSON.parse(execFileSync(
      process.execPath,
      ['-e', orchestratorScript, modulePath, caseRoot],
      { encoding: 'utf8', timeout: 10000 }
    ));
    assert.deepStrictEqual(result.codes, Array(16).fill(0));
    assert.strictEqual(result.warnings, 1);
  })) passed++; else failed++;
} finally {
  fs.rmSync(root, { recursive: true, force: true });
}

console.log(`\nResults: Passed: ${passed}, Failed: ${failed}`);
process.exit(failed > 0 ? 1 : 0);
