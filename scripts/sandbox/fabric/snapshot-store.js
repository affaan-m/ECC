'use strict';

const crypto = require('crypto');
const fs = require('fs');
const path = require('path');
const { normalizeDigest } = require('./environment-receipt');

const SNAPSHOT_ID_PATTERN = /^snap_[a-f0-9]{24,64}$/;
const CACHE_KEY_PATTERN = /^env_[a-f0-9]{64}$/;

function assertPrivateRoot(root, options = {}) {
  const resolved = path.resolve(root);
  if (fs.existsSync(resolved)) {
    const stat = fs.lstatSync(resolved);
    if (stat.isSymbolicLink()) throw new Error('snapshot registry root must not be a symbolic link');
    if (!stat.isDirectory()) throw new Error('snapshot registry root must be a directory');
    if ((stat.mode & 0o077) !== 0) throw new Error('snapshot registry root must be private to its owner');
    const expectedUid = options.expectedUid ?? (typeof process.getuid === 'function' ? process.getuid() : null);
    if (expectedUid !== null && stat.uid !== expectedUid) {
      throw new Error('snapshot registry root must be owned by the current user');
    }
    return resolved;
  }
  fs.mkdirSync(resolved, { recursive: true, mode: 0o700 });
  const stat = fs.lstatSync(resolved);
  if (!stat.isDirectory() || stat.isSymbolicLink()) {
    throw new Error('snapshot registry root must be a private directory');
  }
  if ((stat.mode & 0o077) !== 0) throw new Error('snapshot registry root must be private to its owner');
  return resolved;
}

function snapshotId(receipt, backend, name) {
  const digest = crypto.createHash('sha256')
    .update(`${receipt.digest}\0${backend}\0${name}`)
    .digest('hex');
  return `snap_${digest.slice(0, 32)}`;
}

function validateSnapshotId(id) {
  if (!SNAPSHOT_ID_PATTERN.test(String(id || ''))) throw new Error('invalid snapshot record ID');
  return id;
}

function snapshotRecordPath(root, id) {
  const resolvedRoot = assertPrivateRoot(root);
  return path.join(resolvedRoot, `${validateSnapshotId(id)}.json`);
}

function writeJsonAtomic(filePath, value) {
  const directory = path.dirname(filePath);
  assertPrivateRoot(directory);
  const temporary = path.join(
    directory,
    `.${path.basename(filePath)}.${process.pid}.${crypto.randomBytes(6).toString('hex')}`
  );
  fs.writeFileSync(temporary, `${JSON.stringify(value, null, 2)}\n`, {
    encoding: 'utf8',
    mode: 0o600,
    flag: 'wx',
  });
  fs.renameSync(temporary, filePath);
  fs.chmodSync(filePath, 0o600);
}

function readSnapshotRecord(root, id) {
  const filePath = snapshotRecordPath(root, id);
  if (!fs.existsSync(filePath)) throw new Error(`snapshot record is missing: ${id}`);
  const stat = fs.lstatSync(filePath);
  if (!stat.isFile() || stat.isSymbolicLink()) throw new Error('snapshot record must be a regular file');
  if (stat.size > 1024 * 1024) throw new Error('snapshot record exceeds 1 MiB');
  return JSON.parse(fs.readFileSync(filePath, 'utf8'));
}

function normalizeMetadata(metadata = {}) {
  if (!metadata || typeof metadata !== 'object' || Array.isArray(metadata)) {
    throw new Error('snapshot metadata must be an object');
  }
  return { ...metadata };
}

function requireCacheKey(value, label) {
  const cacheKey = String(value || '');
  if (!CACHE_KEY_PATTERN.test(cacheKey)) throw new Error(`${label} must be an environment cache key`);
  return cacheKey;
}

function assertPromotionIdentity(record, options) {
  const expectedReceiptDigest = normalizeDigest(
    options.expectedReceiptDigest,
    'expected receipt digest'
  );
  const expectedCacheKey = requireCacheKey(options.expectedCacheKey, 'expected cache key');
  const expectedBackend = String(options.expectedBackend || '');
  if (!/^[A-Za-z0-9._:-]{1,200}$/.test(expectedBackend)) {
    throw new Error('expected backend identity is invalid');
  }
  if (record.receipt_digest !== expectedReceiptDigest) {
    throw new Error('snapshot receipt digest does not match the expected receipt digest');
  }
  if (record.cache_key !== expectedCacheKey) {
    throw new Error('snapshot cache key does not match the expected cache key');
  }
  if (record.backend !== expectedBackend) {
    throw new Error('snapshot backend identity does not match the expected backend');
  }
}

function createSnapshotRecord(root, receipt, options = {}) {
  normalizeDigest(receipt?.digest, 'environment receipt digest');
  const backend = String(options.backend || receipt.inputs?.route?.backend || '');
  const name = String(options.name || receipt.cache_key || '');
  if (!/^[A-Za-z0-9._:-]{1,200}$/.test(backend)) throw new Error('snapshot backend is invalid');
  if (!/^[A-Za-z0-9._:-]{1,240}$/.test(name)) throw new Error('snapshot name is invalid');
  const id = options.id || snapshotId(receipt, backend, name);
  const filePath = snapshotRecordPath(root, id);
  if (fs.existsSync(filePath)) throw new Error(`snapshot record already exists: ${id}`);
  const record = {
    schema_version: 1,
    id,
    state: 'quarantine',
    backend,
    name,
    receipt_digest: receipt.digest,
    cache_key: receipt.cache_key || null,
    metadata: normalizeMetadata(options.metadata || {}),
    created_at: options.now || new Date().toISOString(),
    ready_at: null,
  };
  writeJsonAtomic(filePath, record);
  return record;
}

function promoteSnapshotReady(root, id, options = {}) {
  const current = readSnapshotRecord(root, id);
  assertPromotionIdentity(current, options);
  if (current.state !== 'quarantine') {
    throw new Error(`snapshot record must be quarantine before promotion: ${id}`);
  }
  const next = {
    ...current,
    state: 'ready',
    metadata: {
      ...normalizeMetadata(current.metadata || {}),
      ...normalizeMetadata(options.metadata || {}),
    },
    ready_at: options.now || new Date().toISOString(),
  };
  writeJsonAtomic(snapshotRecordPath(root, id), next);
  return next;
}

module.exports = {
  CACHE_KEY_PATTERN,
  SNAPSHOT_ID_PATTERN,
  assertPrivateRoot,
  createSnapshotRecord,
  promoteSnapshotReady,
  readSnapshotRecord,
  snapshotRecordPath,
  writeJsonAtomic,
};
