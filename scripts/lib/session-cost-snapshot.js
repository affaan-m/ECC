'use strict';

const crypto = require('crypto');
const fs = require('fs');
const os = require('os');
const path = require('path');
const { writeFileAtomic } = require('./atomic-write');
const { sanitizeSessionId } = require('./session-bridge');

const COST_SNAPSHOT_SCHEMA_VERSION = 'ecc.cost-snapshot.v1';
const COST_SNAPSHOT_DIRECTORY = 'cost-snapshots';
const COST_LOG_FILENAME = 'costs.jsonl';
const READ_CHUNK_BYTES = 64 * 1024;
const MAX_JSONL_LINE_BYTES = 1024 * 1024;
const MAX_SCAN_BYTES = 16 * 1024 * 1024;
const FINGERPRINT_WINDOW_BYTES = 256;
const PRUNE_INTERVAL_MS = 24 * 60 * 60 * 1000;
const SNAPSHOT_MAX_AGE_MS = 30 * 24 * 60 * 60 * 1000;
const MAX_SNAPSHOTS = 512;
const WARNING_CACHE_PREFIX = 'ecc-cost-snapshot-warnings-';

function assertSafeSessionId(sessionId) {
  if (sanitizeSessionId(sessionId) !== sessionId) {
    throw new Error('Cost snapshot requires a safe session ID');
  }
}

function getSnapshotDirectory(metricsDir) {
  return path.join(metricsDir, COST_SNAPSHOT_DIRECTORY);
}

function getCostSnapshotPath(metricsDir, sessionId) {
  assertSafeSessionId(sessionId);
  return path.join(getSnapshotDirectory(metricsDir), `session-${sessionId}.json`);
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

function readJsonFile(filePath) {
  try {
    return JSON.parse(fs.readFileSync(filePath, 'utf8'));
  } catch {
    return null;
  }
}

function chooseNewerCumulativeRow(currentRow, nextRow) {
  if (!currentRow) return nextRow;
  const nextDominates = nextRow.input_tokens >= currentRow.input_tokens
    && nextRow.output_tokens >= currentRow.output_tokens
    && nextRow.estimated_cost_usd >= currentRow.estimated_cost_usd;
  const currentDominates = currentRow.input_tokens >= nextRow.input_tokens
    && currentRow.output_tokens >= nextRow.output_tokens
    && currentRow.estimated_cost_usd >= nextRow.estimated_cost_usd;
  if (nextDominates && !currentDominates) return nextRow;
  if (currentDominates && !nextDominates) return currentRow;
  const nextTimestamp = Date.parse(nextRow.timestamp);
  const currentTimestamp = Date.parse(currentRow.timestamp);
  if (Number.isFinite(nextTimestamp) && Number.isFinite(currentTimestamp)) {
    return nextTimestamp >= currentTimestamp ? nextRow : currentRow;
  }
  return nextRow;
}

function sourceIdentity(stat) {
  return `${stat.dev}:${stat.ino}`;
}

function hashWindow(descriptor, position, length) {
  const buffer = Buffer.alloc(length);
  if (length > 0) fs.readSync(descriptor, buffer, 0, length, position);
  return crypto.createHash('sha256').update(buffer).digest('hex');
}

function fingerprintProcessedPrefix(descriptor, offset) {
  const windowLength = Math.min(FINGERPRINT_WINDOW_BYTES, offset);
  const middleStart = Math.max(0, Math.floor((offset - windowLength) / 2));
  return {
    start: hashWindow(descriptor, 0, windowLength),
    middle: hashWindow(descriptor, middleStart, windowLength),
    end: hashWindow(descriptor, offset - windowLength, windowLength)
  };
}

function fingerprintsMatch(left, right) {
  return left?.start === right?.start
    && left?.middle === right?.middle
    && left?.end === right?.end;
}

function validSnapshotBase(snapshot, descriptor, stat, sessionId) {
  if (snapshot?.schema_version !== COST_SNAPSHOT_SCHEMA_VERSION) return null;
  if (snapshot.row !== null && !isValidCostRow(snapshot.row, sessionId)) return null;
  const source = snapshot.source;
  if (source?.identity !== sourceIdentity(stat)) return null;
  if (!Number.isSafeInteger(source.offset_bytes) || source.offset_bytes < 0) return null;
  if (source.offset_bytes > stat.size) return null;
  if (source.offset_bytes === stat.size && source.mtime_ms !== stat.mtimeMs) return null;
  if (!fingerprintsMatch(
    source.fingerprint,
    fingerprintProcessedPrefix(descriptor, source.offset_bytes)
  )) return null;
  return {
    row: snapshot.row,
    offset: source.offset_bytes,
    discardingLine: source.discarding_line === true
  };
}

function createScanState(initialRow) {
  return {
    latestRow: initialRow,
    committedRow: initialRow,
    malformed: 0,
    invalid: 0,
    malformedHasher: crypto.createHash('sha256'),
    invalidHasher: crypto.createHash('sha256')
  };
}

function processCostLine(state, line, sessionId, committed = true) {
  if (!line.trim()) return state;
  try {
    const row = JSON.parse(line);
    if (row.session_id !== sessionId) return state;
    if (!isValidCostRow(row, sessionId)) {
      if (!committed) return state;
      return {
        ...state,
        invalid: state.invalid + 1,
        invalidHasher: state.invalidHasher.copy().update(line).update('\0')
      };
    }
    return {
      ...state,
      latestRow: chooseNewerCumulativeRow(state.latestRow, row),
      committedRow: committed
        ? chooseNewerCumulativeRow(state.committedRow, row)
        : state.committedRow
    };
  } catch {
    if (!committed) return state;
    return {
      ...state,
      malformed: state.malformed + 1,
      malformedHasher: state.malformedHasher.copy().update(line).update('\0')
    };
  }
}

function markOversizedLine(state, pendingChunks, segment) {
  const hasher = state.malformedHasher.copy();
  for (const chunk of pendingChunks) hasher.update(chunk);
  const remaining = Math.max(0, MAX_JSONL_LINE_BYTES - pendingChunks.reduce(
    (total, chunk) => total + chunk.length,
    0
  ));
  hasher.update(segment.subarray(0, remaining)).update('\0<oversized>');
  return { ...state, malformed: state.malformed + 1, malformedHasher: hasher };
}

function consumeLineSegment(scan, segment, terminated, sessionId) {
  if (scan.discardingLine) {
    return { ...scan, discardingLine: !terminated };
  }
  if (scan.pendingBytes + segment.length > MAX_JSONL_LINE_BYTES) {
    return {
      state: markOversizedLine(scan.state, scan.pendingChunks, segment),
      pendingChunks: [],
      pendingBytes: 0,
      discardingLine: !terminated
    };
  }
  const pendingChunks = segment.length > 0
    ? [...scan.pendingChunks, Buffer.from(segment)]
    : scan.pendingChunks;
  const pendingBytes = scan.pendingBytes + segment.length;
  if (!terminated) return { ...scan, pendingChunks, pendingBytes };
  const line = Buffer.concat(pendingChunks, pendingBytes).toString('utf8');
  return {
    state: processCostLine(scan.state, line, sessionId),
    pendingChunks: [],
    pendingBytes: 0,
    discardingLine: false
  };
}

function consumeJsonlChunk(scan, chunk, sessionId, absoluteStart, processedOffset) {
  let nextScan = scan;
  let nextOffset = processedOffset;
  let segmentStart = 0;
  for (;;) {
    const newlineIndex = chunk.indexOf(0x0a, segmentStart);
    if (newlineIndex < 0) break;
    nextScan = consumeLineSegment(
      nextScan, chunk.subarray(segmentStart, newlineIndex), true, sessionId
    );
    nextOffset = absoluteStart + newlineIndex + 1;
    segmentStart = newlineIndex + 1;
  }
  nextScan = consumeLineSegment(
    nextScan, chunk.subarray(segmentStart), false, sessionId
  );
  if (nextScan.discardingLine) nextOffset = absoluteStart + chunk.length;
  return { scan: nextScan, processedOffset: nextOffset };
}

function scanJsonlRange(descriptor, start, end, sessionId, initialRow, initialDiscard = false) {
  const buffer = Buffer.allocUnsafe(READ_CHUNK_BYTES);
  let lineScan = {
    state: createScanState(initialRow),
    pendingChunks: [],
    pendingBytes: 0,
    discardingLine: initialDiscard
  };
  let position = start;
  let processedOffset = start;

  while (position < end) {
    const bytesRead = fs.readSync(
      descriptor,
      buffer,
      0,
      Math.min(buffer.length, end - position),
      position
    );
    if (bytesRead === 0) break;
    const consumed = consumeJsonlChunk(
      lineScan, buffer.subarray(0, bytesRead), sessionId, position, processedOffset
    );
    lineScan = consumed.scan;
    processedOffset = consumed.processedOffset;
    position += bytesRead;
  }
  if (lineScan.pendingBytes > 0) {
    const line = Buffer.concat(lineScan.pendingChunks, lineScan.pendingBytes).toString('utf8');
    lineScan = {
      ...lineScan,
      state: processCostLine(lineScan.state, line, sessionId, false)
    };
  }
  const { state } = lineScan;
  return {
    row: state.latestRow,
    committedRow: state.committedRow,
    processedOffset,
    malformed: state.malformed,
    invalid: state.invalid,
    malformedSignature: state.malformed > 0
      ? state.malformedHasher.digest('hex').slice(0, 16)
      : null,
    invalidSignature: state.invalid > 0
      ? state.invalidHasher.digest('hex').slice(0, 16)
      : null,
    discardingLine: lineScan.discardingLine
  };
}

function writeSnapshotAtOffset(
  metricsDir, sessionId, row, descriptor, stat, offset, discardingLine = false
) {
  if (row !== null && !isValidCostRow(row, sessionId)) return false;
  const snapshot = {
    schema_version: COST_SNAPSHOT_SCHEMA_VERSION,
    source: {
      identity: sourceIdentity(stat),
      offset_bytes: offset,
      mtime_ms: stat.mtimeMs,
      discarding_line: discardingLine,
      fingerprint: fingerprintProcessedPrefix(descriptor, offset)
    },
    row
  };
  writeFileAtomic(
    getCostSnapshotPath(metricsDir, sessionId),
    JSON.stringify(snapshot),
    {
      beforeRename() {
        const current = fs.fstatSync(descriptor);
        if (current.size < offset) {
          throw new Error('Cost log was truncated during snapshot publication');
        }
        if (current.size === offset && current.mtimeMs !== snapshot.source.mtime_ms) {
          throw new Error('Cost log changed during snapshot publication');
        }
        if (!fingerprintsMatch(
          fingerprintProcessedPrefix(descriptor, offset),
          snapshot.source.fingerprint
        )) {
          throw new Error('Cost log prefix changed during snapshot publication');
        }
      }
    }
  );
  return true;
}

function emptySnapshotResult(row) {
  return {
    row,
    scannedBytes: 0,
    malformed: 0,
    invalid: 0,
    malformedSignature: null,
    invalidSignature: null,
    snapshotError: null
  };
}

function publishScanSnapshot(metricsDir, sessionId, scan, descriptor, stat) {
  if (!scan.committedRow && scan.processedOffset === 0) return null;
  try {
    writeSnapshotAtOffset(
      metricsDir,
      sessionId,
      scan.committedRow,
      descriptor,
      stat,
      scan.processedOffset,
      scan.discardingLine
    );
    return null;
  } catch (error) {
    return error;
  }
}

function refreshSessionCostSnapshot(metricsDir, sessionId) {
  assertSafeSessionId(sessionId);
  const costsPath = path.join(metricsDir, COST_LOG_FILENAME);
  const descriptor = fs.openSync(costsPath, 'r');
  try {
    const stat = fs.fstatSync(descriptor);
    const snapshot = readJsonFile(getCostSnapshotPath(metricsDir, sessionId));
    const base = validSnapshotBase(snapshot, descriptor, stat, sessionId);
    if (base?.offset === stat.size) return emptySnapshotResult(base.row);
    const scanEnd = Math.min(stat.size, (base?.offset || 0) + MAX_SCAN_BYTES);
    const scan = scanJsonlRange(
      descriptor,
      base?.offset || 0,
      scanEnd,
      sessionId,
      base?.row || null,
      base?.discardingLine || false
    );
    const snapshotError = publishScanSnapshot(
      metricsDir, sessionId, scan, descriptor, stat
    );
    return {
      row: scan.row,
      scannedBytes: scan.processedOffset - (base?.offset || 0),
      malformed: scan.malformed,
      invalid: scan.invalid,
      malformedSignature: scan.malformedSignature,
      invalidSignature: scan.invalidSignature,
      snapshotError
    };
  } finally {
    fs.closeSync(descriptor);
  }
}

function costLogNeedsSeparator(metricsDir) {
  const costsPath = path.join(metricsDir, COST_LOG_FILENAME);
  let descriptor;
  try {
    descriptor = fs.openSync(costsPath, 'r');
    const stat = fs.fstatSync(descriptor);
    if (stat.size === 0) return false;
    const lastByte = Buffer.alloc(1);
    return fs.readSync(descriptor, lastByte, 0, 1, stat.size - 1) === 1
      && lastByte[0] !== 0x0a;
  } catch (error) {
    if (error.code === 'ENOENT') return false;
    throw error;
  } finally {
    if (descriptor !== undefined) fs.closeSync(descriptor);
  }
}

function appendSessionCostRow(metricsDir, sessionId, row) {
  assertSafeSessionId(sessionId);
  if (!isValidCostRow(row, sessionId)) {
    throw new Error('Cost snapshot requires valid non-negative numeric totals for its session');
  }
  const prefix = costLogNeedsSeparator(metricsDir) ? '\n' : '';
  fs.appendFileSync(
    path.join(metricsDir, COST_LOG_FILENAME),
    `${prefix}${JSON.stringify(row)}\n`,
    'utf8'
  );
  const result = refreshSessionCostSnapshot(metricsDir, sessionId);
  if (result.snapshotError) throw result.snapshotError;
  try {
    maybePruneSessionCostSnapshots(metricsDir);
  } catch (error) {
    // Retention is opportunistic and retried by a later update, but a
    // persistent failure remains visible without rolling back the log append.
    warnSessionCostSnapshotFailure('retention', metricsDir, sessionId, error);
  }
  return JSON.stringify(result.row) === JSON.stringify(row);
}

function readSessionCostSnapshot(metricsDir, sessionId) {
  try {
    return refreshSessionCostSnapshot(metricsDir, sessionId);
  } catch (error) {
    if (error.code === 'ENOENT') {
      return { row: null, scannedBytes: 0, malformed: 0, invalid: 0, snapshotError: null };
    }
    throw error;
  }
}

function maybePruneSessionCostSnapshots(metricsDir, options = {}) {
  const snapshotDir = getSnapshotDirectory(metricsDir);
  const now = Number.isFinite(options.now) ? options.now : Date.now();
  const maxAgeMs = Number.isFinite(options.maxAgeMs) ? options.maxAgeMs : SNAPSHOT_MAX_AGE_MS;
  const maxSnapshots = Number.isSafeInteger(options.maxSnapshots)
    ? Math.max(0, options.maxSnapshots)
    : MAX_SNAPSHOTS;
  const markerPath = path.join(snapshotDir, '.last-prune');

  fs.mkdirSync(snapshotDir, { recursive: true });
  const snapshotEntries = fs.readdirSync(snapshotDir, { withFileTypes: true })
    .filter(entry => entry.isFile() && /^session-.+\.json$/.test(entry.name));
  if (!options.force) {
    try {
      const intervalIsFresh = now - fs.statSync(markerPath).mtimeMs < PRUNE_INTERVAL_MS;
      if (intervalIsFresh && snapshotEntries.length <= maxSnapshots) return 0;
    } catch (error) {
      if (error.code !== 'ENOENT') throw error;
    }
  }
  const snapshots = snapshotEntries
    .map(entry => {
      const filePath = path.join(snapshotDir, entry.name);
      return { filePath, mtimeMs: fs.statSync(filePath).mtimeMs };
    })
    .sort((left, right) => right.mtimeMs - left.mtimeMs);
  const removals = snapshots.filter((entry, index) => (
    index >= maxSnapshots || now - entry.mtimeMs > maxAgeMs
  ));
  let removed = 0;
  for (const entry of removals) {
    try {
      if (fs.statSync(entry.filePath).mtimeMs <= entry.mtimeMs) {
        fs.rmSync(entry.filePath, { force: true });
        removed += 1;
      }
    } catch (error) {
      if (error.code !== 'ENOENT') throw error;
    }
  }
  fs.writeFileSync(markerPath, String(now), { encoding: 'utf8', mode: 0o600 });
  return removed;
}

function warningClaimPath(kind, metricsDir, sessionId, signature) {
  const key = crypto.createHash('sha256')
    .update(`${path.resolve(metricsDir)}\0${sessionId}\0${kind}\0${signature}`)
    .digest('hex')
    .slice(0, 16);
  return path.join(os.tmpdir(), `${WARNING_CACHE_PREFIX}${key}.claim`);
}

function warnSessionCostSnapshotFailure(kind, metricsDir, sessionId, error) {
  const targetPath = getCostSnapshotPath(metricsDir, sessionId);
  const errorCode = error?.code || error?.name || 'error';
  const signature = `${kind}:${targetPath}:${errorCode}`;
  const claimPath = warningClaimPath(kind, metricsDir, sessionId, signature);
  let claimDescriptor;
  try {
    claimDescriptor = fs.openSync(claimPath, 'wx', 0o600);
    fs.closeSync(claimDescriptor);
    claimDescriptor = undefined;
  } catch (claimError) {
    if (claimDescriptor !== undefined) fs.closeSync(claimDescriptor);
    if (claimError.code === 'EEXIST') return;
    // Warning persistence is best effort. If the claim cannot be created,
    // still surface the underlying snapshot failure.
  }
  process.stderr.write(
    `[cost-snapshot] ${kind} failed for session ${sessionId}: ${error?.message || String(error)}\n`
  );
}

module.exports = {
  COST_SNAPSHOT_SCHEMA_VERSION,
  COST_SNAPSHOT_DIRECTORY,
  COST_LOG_FILENAME,
  getCostSnapshotPath,
  isValidCostRow,
  chooseNewerCumulativeRow,
  appendSessionCostRow,
  readSessionCostSnapshot,
  refreshSessionCostSnapshot,
  costLogNeedsSeparator,
  maybePruneSessionCostSnapshots,
  warnSessionCostSnapshotFailure
};
