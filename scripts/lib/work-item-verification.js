'use strict';

// Opt-in artifact verification for a local, user-owned queue. This is an
// application invariant, not an authorization boundary against a DB/file owner.
const crypto = require('crypto');
const fs = require('fs');
const path = require('path');
const { performance } = require('perf_hooks');
const { isDeepStrictEqual } = require('util');
const { renderMarkdownTable, validateDocumentation } = require('./harness-adapter-compliance');

const VERIFIER = 'harness-adapter-documentation/v1';
const MAX_ARTIFACT_BYTES = 1024 * 1024;
const MAX_ATTEMPTS = 1000;
const SUCCESS_STATUSES = new Set(['done', 'closed', 'resolved', 'merged']);
const RUNNING_STATUSES = new Set(['running', 'claimed', 'in-progress']);
const VERIFIABLE_STATUSES = new Set([...RUNNING_STATUSES, ...SUCCESS_STATUSES, 'blocked']);
const statusKey = value => String(value || '').trim().toLowerCase();
const digest = value => crypto.createHash('sha256').update(value).digest('hex');
const record = value => value !== null && typeof value === 'object' && !Array.isArray(value);
const hasVerification = item => Boolean(item && item.metadata && Object.hasOwn(item.metadata, 'verification'));

function validateContract(contract, repoRoot) {
  if (!record(contract) || Object.keys(contract).sort().join(',') !== 'artifact,verifier' || contract.verifier !== VERIFIER) {
    throw new Error(`Verification contract requires verifier '${VERIFIER}' and artifact only.`);
  }
  const artifact = contract.artifact;
  if (typeof artifact !== 'string' || !artifact || artifact.length > 4096 || artifact.includes('\0') || artifact.includes('\\')
    || path.isAbsolute(artifact) || path.win32.isAbsolute(artifact) || artifact.split('/').some(part => !part || part === '.' || part === '..')
    || path.extname(artifact) !== '.md') {
    throw new Error('Verification artifact must be a bounded relative .md path without traversal.');
  }
  if (typeof repoRoot !== 'string' || !path.isAbsolute(repoRoot)) {
    throw new Error('Verification requires an absolute repo root.');
  }
  return { verifier: VERIFIER, artifact };
}

function identity(item) {
  return [item.id, item.source, item.sourceId, item.title, item.repoRoot];
}

function binding(item) {
  const contract = item.metadata.verification.contract;
  const contractDigest = digest(JSON.stringify([item.repoRoot, contract.verifier, contract.artifact]));
  return { contractDigest, taskDigest: digest(JSON.stringify([...identity(item), item.owner, item.sessionId, contractDigest])) };
}

function requireClaim(item) {
  if (!item.owner || !item.sessionId || !VERIFIABLE_STATUSES.has(statusKey(item.status))) {
    throw new Error('Verification requires claimed work with an owner and registered session.');
  }
}

function assertContained(root, filename) {
  const relative = path.relative(root, filename);
  if (!relative || relative.startsWith(`..${path.sep}`) || relative === '..' || path.isAbsolute(relative)) {
    throw new Error('Artifact escapes the registered repo root.');
  }
}

function readArtifact(item) {
  const { artifact } = validateContract(item.metadata.verification.contract, item.repoRoot);
  const root = fs.realpathSync(item.repoRoot);
  if (root !== item.repoRoot) throw new Error('Registered repo root changed or became a symlink.');
  let filename = root;
  for (const component of artifact.split('/')) {
    filename = path.join(filename, component);
    if (fs.lstatSync(filename).isSymbolicLink()) throw new Error('Artifact symlinks are not supported.');
  }
  assertContained(root, fs.realpathSync(filename));
  const descriptor = fs.openSync(filename, fs.constants.O_RDONLY | (fs.constants.O_NOFOLLOW || 0) | (fs.constants.O_NONBLOCK || 0));
  try {
    const before = fs.fstatSync(descriptor);
    if (!before.isFile() || before.size > MAX_ARTIFACT_BYTES) throw new Error('Artifact must be a regular file no larger than 1 MiB.');
    const buffer = Buffer.alloc(MAX_ARTIFACT_BYTES + 1);
    let length = 0;
    while (length < buffer.length) {
      const count = fs.readSync(descriptor, buffer, length, buffer.length - length, length);
      if (!count) break;
      length += count;
    }
    const after = fs.fstatSync(descriptor);
    // Detect replacement/changes during read; validate exactly the bytes hashed.
    assertContained(root, fs.realpathSync(filename));
    const current = fs.lstatSync(filename);
    if (current.isSymbolicLink() || length > MAX_ARTIFACT_BYTES || before.size !== length
      || ['dev', 'ino', 'size', 'mtimeMs', 'ctimeMs'].some(key => before[key] !== after[key] || after[key] !== current[key])) {
      throw new Error('Artifact changed during verification; retry.');
    }
    return { filename, bytes: buffer.subarray(0, length) };
  } finally {
    fs.closeSync(descriptor);
  }
}

function checkArtifact(item) {
  try {
    const { filename, bytes } = readArtifact(item);
    const reasons = validateDocumentation({ repoRoot: item.repoRoot, docPath: filename, source: bytes.toString('utf8') });
    return { outcome: reasons.length ? 'failure' : 'success', reasons, artifactDigest: digest(bytes) };
  } catch (error) {
    return { outcome: 'unknown', reasons: [error.message], artifactDigest: null };
  }
}

function appendAttempt(item, kind = 'verification') {
  requireClaim(item);
  const previous = item.metadata.verification;
  if (previous.attempts.length >= MAX_ATTEMPTS) throw new Error('Verification attempt limit reached; create a new work item.');
  const started = performance.now();
  const result = checkArtifact(item);
  const attempt = {
    schemaVersion: 'ecc.work-item-verification.v1',
    attemptId: crypto.randomUUID(),
    previousAttemptId: previous.attempts.at(-1)?.attemptId || null,
    kind,
    taskId: item.id,
    sessionId: item.sessionId,
    owner: item.owner,
    verifier: VERIFIER,
    verifierDigest: digest(`${VERIFIER}\n${renderMarkdownTable()}`),
    ...binding(item),
    ...result,
    durationMs: Math.round((performance.now() - started) * 1000) / 1000,
    checkedAt: new Date().toISOString()
  };
  return {
    verified: attempt.outcome === 'success',
    attempt,
    item: {
      ...item,
      status: attempt.outcome === 'success' ? 'done' : 'blocked',
      updatedAt: attempt.checkedAt,
      metadata: { ...item.metadata, verification: { ...previous, attempts: [...previous.attempts, attempt] } }
    }
  };
}

function registerVerification(existing, item) {
  if (existing) throw new Error('Register verification at creation of a new work item, before work begins.');
  const verification = item.metadata.verification;
  if (!record(verification) || Object.keys(verification).join(',') !== 'contract' || item.owner
    || !['open', 'ready', 'needs-review'].includes(statusKey(item.status))) {
    throw new Error('Register a verification contract before assigning or running work; outcome history is reserved.');
  }
  const contract = validateContract(verification.contract, item.repoRoot);
  const repoRoot = fs.realpathSync(item.repoRoot);
  if (!fs.statSync(repoRoot).isDirectory()) throw new Error('Verification repo root must be a directory.');
  return {
    ...item,
    repoRoot,
    metadata: { ...item.metadata, verification: { contract, registeredAt: new Date().toISOString(), attempts: [] } }
  };
}

// Called centrally by state-store upsert, covering CLI, board and runner writes.
function prepareVerifiedUpdate(existing, item) {
  if (!hasVerification(existing)) return hasVerification(item) ? registerVerification(existing, item) : item;
  if (!hasVerification(item) || !isDeepStrictEqual(existing.metadata.verification, item.metadata.verification)) {
    throw new Error('Verification contract and attempt history are reserved and cannot be replaced or removed.');
  }
  if (!isDeepStrictEqual(identity(existing), identity(item))) {
    throw new Error('Contracted task identity is immutable; create a new work item.');
  }
  if (RUNNING_STATUSES.has(statusKey(item.status))) requireClaim(item);
  if (!SUCCESS_STATUSES.has(statusKey(item.status))) return item;
  const last = item.metadata.verification.attempts.at(-1);
  if (!last || last.outcome !== 'success' || last.taskDigest !== binding(item).taskDigest) {
    throw new Error('Completion requires a successful verification for this task and session; run verify.');
  }
  const checked = appendAttempt(item, 'completion-recheck');
  // Persist failed observations too: a previously done item must not retain a
  // success-only history after its artifact regresses. Fresh semantic success
  // binds any changed valid bytes to this new completion receipt.
  return checked.verified ? { ...checked.item, status: item.status } : checked.item;
}

function verifyWorkItem(item) {
  if (!item) throw new Error('Work item not found.');
  if (!hasVerification(item)) throw new Error('Work item has no verification contract.');
  return appendAttempt(item);
}

function verificationLabel(item) {
  if (!hasVerification(item)) return 'unverified (no contract)';
  const last = item.metadata.verification.attempts.at(-1);
  return last ? `last check ${last.outcome} at ${last.checkedAt} (${last.attemptId})` : 'unverified (contract registered)';
}

module.exports = { prepareVerifiedUpdate, verifyWorkItem, verificationLabel };
