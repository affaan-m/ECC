'use strict';

const crypto = require('crypto');
const fs = require('fs');
const path = require('path');

const MAX_EVENT_BYTES = 256 * 1024;
const MAX_LOG_BYTES = 16 * 1024 * 1024;

function canonicalJson(value) {
  if (Array.isArray(value)) return `[${value.map(canonicalJson).join(',')}]`;
  if (value && typeof value === 'object') {
    return `{${Object.keys(value).sort().map(key => (
      `${JSON.stringify(key)}:${canonicalJson(value[key])}`
    )).join(',')}}`;
  }
  return JSON.stringify(value);
}

function digestRecord(record) {
  return crypto.createHash('sha256').update(canonicalJson(record)).digest('hex');
}

function cloneEvent(event) {
  if (!event || typeof event !== 'object' || Array.isArray(event)) {
    throw new Error('event must be an object');
  }
  if (typeof event.type !== 'string' || event.type.length === 0) {
    throw new Error('event requires a type');
  }
  const serialized = JSON.stringify(event);
  if (serialized === undefined) throw new Error('event must be JSON serializable');
  if (Buffer.byteLength(serialized) > MAX_EVENT_BYTES) {
    throw new Error(`event exceeds ${MAX_EVENT_BYTES} bytes`);
  }
  return JSON.parse(serialized);
}

function inspectLogPath(logPath) {
  const resolved = path.resolve(logPath);
  const parent = path.dirname(resolved);
  if (!fs.existsSync(parent)) fs.mkdirSync(parent, { recursive: true, mode: 0o700 });
  const parentStat = fs.lstatSync(parent);
  if (!parentStat.isDirectory() || parentStat.isSymbolicLink()) {
    throw new Error('event log parent must be a real directory, not a symbolic link');
  }
  if ((parentStat.mode & 0o077) !== 0) {
    throw new Error('event log parent must have private permissions');
  }
  if (typeof process.getuid === 'function' && parentStat.uid !== process.getuid()) {
    throw new Error('event log parent must be owned by the current user');
  }
  let fileStat = null;
  if (fs.existsSync(resolved)) {
    fileStat = fs.lstatSync(resolved);
    if (fileStat.isSymbolicLink()) throw new Error('event log must not be a symbolic link');
    if (!fileStat.isFile()) throw new Error('event log must be a regular file');
    if ((fileStat.mode & 0o077) !== 0) throw new Error('event log must have private permissions');
    if (typeof process.getuid === 'function' && fileStat.uid !== process.getuid()) {
      throw new Error('event log must be owned by the current user');
    }
    if (fileStat.size > MAX_LOG_BYTES) throw new Error(`event log exceeds ${MAX_LOG_BYTES} bytes`);
  }
  return { resolved, parent, parentStat, fileStat };
}

function readEventLog(logPath) {
  const inspection = inspectLogPath(logPath);
  if (!inspection.fileStat) return [];
  const descriptor = fs.openSync(
    inspection.resolved,
    fs.constants.O_RDONLY | (fs.constants.O_NOFOLLOW || 0)
  );
  let text;
  try {
    const openedStat = fs.fstatSync(descriptor);
    if (!openedStat.isFile()
      || openedStat.dev !== inspection.fileStat.dev
      || openedStat.ino !== inspection.fileStat.ino) {
      throw new Error('event log identity changed before read');
    }
    text = fs.readFileSync(descriptor, 'utf8');
  } finally {
    fs.closeSync(descriptor);
  }
  if (Buffer.byteLength(text) > MAX_LOG_BYTES) throw new Error(`event log exceeds ${MAX_LOG_BYTES} bytes`);
  const records = [];
  let previous = null;
  for (const [index, line] of text.split('\n').entries()) {
    if (!line) continue;
    if (Buffer.byteLength(line) > MAX_EVENT_BYTES * 2) {
      throw new Error(`event record ${index + 1} exceeds the record limit`);
    }
    let record;
    try {
      record = JSON.parse(line);
    } catch (error) {
      throw new Error(`event record ${index + 1} is invalid JSON: ${error.message}`);
    }
    const expectedSequence = records.length + 1;
    if (record.schema_version !== 1 || record.seq !== expectedSequence) {
      throw new Error(`event sequence mismatch at record ${index + 1}`);
    }
    if (record.prev_sha256 !== previous) {
      throw new Error(`event previous hash mismatch at record ${index + 1}`);
    }
    const { sha256, ...unsigned } = record;
    if (!/^[a-f0-9]{64}$/.test(sha256 || '') || digestRecord(unsigned) !== sha256) {
      throw new Error(`event hash mismatch at record ${index + 1}`);
    }
    cloneEvent(record.event);
    records.push(record);
    previous = sha256;
  }
  return records;
}

function acquireLock(lockPath) {
  try {
    fs.mkdirSync(lockPath, { mode: 0o700 });
  } catch (error) {
    if (error.code === 'EEXIST') throw new Error('event store is locked by another writer');
    throw error;
  }
}

function appendEventAtomic(logPath, event, options = {}) {
  const initialInspection = inspectLogPath(logPath);
  const { resolved } = initialInspection;
  const safeEvent = cloneEvent(event);
  const lockPath = `${resolved}.lock`;
  acquireLock(lockPath);
  try {
    const records = readEventLog(resolved);
    const recordedAtMs = (options.now || Date.now)();
    if (!Number.isSafeInteger(recordedAtMs) || recordedAtMs < 0) {
      throw new Error('event timestamp must be a non-negative integer');
    }
    if (records.length > 0 && recordedAtMs < records.at(-1).recorded_at_ms) {
      throw new Error('event timestamp must be monotonic');
    }
    const unsigned = {
      schema_version: 1,
      seq: records.length + 1,
      recorded_at_ms: recordedAtMs,
      prev_sha256: records.at(-1)?.sha256 || null,
      event: safeEvent,
    };
    const record = { ...unsigned, sha256: digestRecord(unsigned) };
    const line = `${JSON.stringify(record)}\n`;
    if (Buffer.byteLength(line) > MAX_EVENT_BYTES * 2) throw new Error('event record is too large');
    const descriptor = fs.openSync(
      resolved,
      fs.constants.O_APPEND
        | fs.constants.O_CREAT
        | fs.constants.O_WRONLY
        | (fs.constants.O_NOFOLLOW || 0),
      0o600
    );
    try {
      const openedStat = fs.fstatSync(descriptor);
      if (!openedStat.isFile()) throw new Error('event log must be a regular file');
      if (typeof process.getuid === 'function' && openedStat.uid !== process.getuid()) {
        throw new Error('event log must be owned by the current user');
      }
      if (initialInspection.fileStat
        && (openedStat.dev !== initialInspection.fileStat.dev
          || openedStat.ino !== initialInspection.fileStat.ino)) {
        throw new Error('event log identity changed before append');
      }
      const currentParentStat = fs.lstatSync(initialInspection.parent);
      if (currentParentStat.dev !== initialInspection.parentStat.dev
        || currentParentStat.ino !== initialInspection.parentStat.ino) {
        throw new Error('event log parent identity changed before append');
      }
      if (openedStat.size + Buffer.byteLength(line) > MAX_LOG_BYTES) {
        throw new Error(`event log exceeds ${MAX_LOG_BYTES} bytes`);
      }
      fs.writeSync(descriptor, line, null, 'utf8');
      fs.fsyncSync(descriptor);
    } finally {
      fs.closeSync(descriptor);
    }
    fs.chmodSync(resolved, 0o600);
    return record;
  } finally {
    fs.rmdirSync(lockPath);
  }
}

function replayEventLog(logPath, initialState, reducer) {
  if (typeof reducer !== 'function') throw new Error('event replay requires a reducer');
  return readEventLog(logPath).reduce(
    (state, record) => reducer(state, record.event),
    initialState
  );
}

module.exports = {
  MAX_EVENT_BYTES,
  MAX_LOG_BYTES,
  appendEventAtomic,
  canonicalJson,
  digestRecord,
  readEventLog,
  replayEventLog,
};
