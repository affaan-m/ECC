'use strict';

const fs = require('fs');
const path = require('path');
const { writeFileAtomic } = require('./atomic-write');
const { sanitizeSessionId } = require('./session-bridge');

const COST_SNAPSHOT_SCHEMA_VERSION = 'ecc.cost-snapshot.v1';
const COST_SNAPSHOT_DIRECTORY = 'cost-snapshots';
const COST_LOG_FILENAME = 'costs.jsonl';

function assertSafeSessionId(sessionId) {
  if (sanitizeSessionId(sessionId) !== sessionId) {
    throw new Error('Cost snapshot requires a safe session ID');
  }
}

function getCostSnapshotPath(metricsDir, sessionId) {
  assertSafeSessionId(sessionId);
  // Prefix the filename so Windows device names such as CON/NUL/COM1 never
  // become the basename, even when they are otherwise valid session IDs.
  return path.join(metricsDir, COST_SNAPSHOT_DIRECTORY, `session-${sessionId}.json`);
}

function getCostLogSignature(metricsDir) {
  const stat = fs.statSync(path.join(metricsDir, COST_LOG_FILENAME));
  return {
    size_bytes: stat.size,
    mtime_ms: stat.mtimeMs
  };
}

function signaturesMatch(left, right) {
  return left?.size_bytes === right?.size_bytes
    && left?.mtime_ms === right?.mtime_ms;
}

function isValidCostRow(row, sessionId) {
  return row?.session_id === sessionId
    && typeof row.estimated_cost_usd === 'number'
    && Number.isFinite(row.estimated_cost_usd)
    && row.estimated_cost_usd >= 0
    && typeof row.input_tokens === 'number'
    && Number.isFinite(row.input_tokens)
    && row.input_tokens >= 0
    && typeof row.output_tokens === 'number'
    && Number.isFinite(row.output_tokens)
    && row.output_tokens >= 0;
}

function assertCostLogSignature(source) {
  if (!Number.isSafeInteger(source?.size_bytes) || source.size_bytes < 0) {
    throw new Error('Cost snapshot requires a valid source size');
  }
  if (!Number.isFinite(source?.mtime_ms) || source.mtime_ms < 0) {
    throw new Error('Cost snapshot requires a valid source mtime');
  }
}

function writeSnapshotForSource(metricsDir, sessionId, row, source) {
  assertSafeSessionId(sessionId);
  if (!isValidCostRow(row, sessionId)) {
    throw new Error('Cost snapshot requires valid non-negative numeric totals for its session');
  }

  const snapshotPath = getCostSnapshotPath(metricsDir, sessionId);
  assertCostLogSignature(source);
  return writeFileAtomic(
    snapshotPath,
    JSON.stringify({
      schema_version: COST_SNAPSHOT_SCHEMA_VERSION,
      source,
      row
    }),
    {
      beforeRename() {
        if (!signaturesMatch(source, getCostLogSignature(metricsDir))) {
          throw new Error('Cost log changed while publishing its session snapshot');
        }
      }
    }
  );
}

function costLogEndsWithRow(metricsDir, row) {
  const expected = Buffer.from(`${JSON.stringify(row)}\n`, 'utf8');
  const descriptor = fs.openSync(path.join(metricsDir, COST_LOG_FILENAME), 'r');
  try {
    const stat = fs.fstatSync(descriptor);
    if (stat.size < expected.length) return false;
    const actual = Buffer.allocUnsafe(expected.length);
    const bytesRead = fs.readSync(
      descriptor,
      actual,
      0,
      expected.length,
      stat.size - expected.length
    );
    return bytesRead === expected.length && actual.equals(expected);
  } finally {
    fs.closeSync(descriptor);
  }
}

function publishAppendedSessionCostSnapshot(metricsDir, sessionId, row) {
  assertSafeSessionId(sessionId);
  if (!isValidCostRow(row, sessionId)) {
    throw new Error('Cost snapshot requires valid non-negative numeric totals for its session');
  }
  const sourceBefore = getCostLogSignature(metricsDir);
  if (!costLogEndsWithRow(metricsDir, row)) return false;
  const sourceAfter = getCostLogSignature(metricsDir);
  if (!signaturesMatch(sourceBefore, sourceAfter)) return false;
  writeSnapshotForSource(metricsDir, sessionId, row, sourceAfter);
  return true;
}

function repairSessionCostSnapshot(metricsDir, sessionId, row, source) {
  writeSnapshotForSource(metricsDir, sessionId, row, source);
}

function readSessionCostSnapshot(metricsDir, sessionId) {
  try {
    const snapshot = JSON.parse(
      fs.readFileSync(getCostSnapshotPath(metricsDir, sessionId), 'utf8')
    );
    if (snapshot?.schema_version !== COST_SNAPSHOT_SCHEMA_VERSION) return null;
    if (!isValidCostRow(snapshot.row, sessionId)) return null;
    if (!signaturesMatch(snapshot.source, getCostLogSignature(metricsDir))) return null;
    return snapshot.row;
  } catch {
    return null;
  }
}

module.exports = {
  COST_SNAPSHOT_SCHEMA_VERSION,
  COST_SNAPSHOT_DIRECTORY,
  COST_LOG_FILENAME,
  getCostSnapshotPath,
  getCostLogSignature,
  signaturesMatch,
  isValidCostRow,
  publishAppendedSessionCostSnapshot,
  repairSessionCostSnapshot,
  readSessionCostSnapshot
};
