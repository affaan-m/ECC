'use strict';

const fs = require('fs');
const path = require('path');
const { realpathNearestExisting } = require('../path-safety');
const { acquireSettingsLock, getSettingsLockIdentity, sameFileIdentity } = require('./claude-settings-lock');

const activeLeases = new WeakMap();
const STATE_FILENAME = 'ecc-install-state.json';
const comparablePath = value => process.platform === 'win32' ? value.toLowerCase() : value;

function inspectEntry(filePath) {
  try { return fs.lstatSync(filePath, { bigint: true }); }
  catch (error) { if (error.code === 'ENOENT') return null; throw error; }
}

function canonicalRoots(roots) {
  if (!Array.isArray(roots)) throw new TypeError('OpenCode install roots must be an array.');
  const deduplicated = new Map();
  for (const root of roots) {
    if (typeof root !== 'string' || !path.isAbsolute(root)) {
      throw new TypeError('OpenCode install root must be an absolute trusted path.');
    }
    const stats = inspectEntry(root);
    if (stats && (stats.isSymbolicLink() || !stats.isDirectory())) {
      throw new Error(`Refusing OpenCode install lock through a non-directory or symlink root: ${root}`);
    }
    const canonical = realpathNearestExisting(root);
    deduplicated.set(comparablePath(canonical), canonical);
  }
  return [...deduplicated.values()].sort((left, right) => {
    const a = comparablePath(left);
    const b = comparablePath(right);
    return a < b ? -1 : a > b ? 1 : 0;
  });
}

function assertLockLocation(root, expectedRoot) {
  const stats = inspectEntry(root);
  if (!stats || !stats.isDirectory() || stats.isSymbolicLink()
    || comparablePath(fs.realpathSync(root)) !== comparablePath(root)
    || (expectedRoot && !sameFileIdentity(stats, expectedRoot))) {
    throw new Error(`Refusing changed OpenCode install lock root: ${root}`);
  }
  const lock = inspectEntry(path.join(root, `${STATE_FILENAME}.ecc.lock`));
  if (lock && (!lock.isFile() || lock.isSymbolicLink())) {
    throw new Error(`Refusing non-file or symlink OpenCode install lock: ${root}`);
  }
  return { root: stats, lock };
}

function assertOwnedLock(owned) {
  const live = assertLockLocation(owned.root, owned.rootStats);
  if (!live.lock || !sameFileIdentity(live.lock, owned.lockStats)) {
    throw new Error(`Refusing changed OpenCode install lock: ${owned.root}`);
  }
}

function annotateCleanupFailure(primary, property, value) {
  try {
    // Own data properties avoid invoking caller getters/setters. Frozen values,
    // primitives and rejecting proxy traps simply retain no extra diagnostic.
    Object.defineProperty(primary, property, { value, configurable: true, enumerable: true, writable: true });
  } catch {
    // Diagnostics must never replace the exact primary thrown value.
  }
}

function releaseOwned(ownedLocks) {
  const failures = [];
  for (const owned of [...ownedLocks].reverse()) {
    try {
      assertOwnedLock(owned);
      owned.release();
    } catch (error) {
      failures.push(error);
    }
  }
  // Finish every safe release before touching any caller-owned error object.
  if (failures.length > 0) {
    if (failures.length > 1) annotateCleanupFailure(failures[0], 'releaseErrors', failures.slice(1));
    throw failures[0];
  }
}

function acquireOpenCodeInstallLocks(roots, existingLease) {
  const orderedRoots = canonicalRoots(roots);
  if (existingLease !== undefined) {
    const existing = existingLease && typeof existingLease === 'object' && activeLeases.get(existingLease);
    if (!existing) throw new Error('Invalid or inactive OpenCode install lease.');
    const covered = new Set(existing.map(owned => comparablePath(owned.root)));
    if (orderedRoots.some(root => !covered.has(comparablePath(root)))) {
      throw new Error('OpenCode install lease does not cover every required root.');
    }
    existing.forEach(assertOwnedLock);
    return { lease: existingLease, release() {} };
  }
  const ownedLocks = [];
  try {
    for (const root of orderedRoots) {
      fs.mkdirSync(root, { recursive: true });
      const before = assertLockLocation(root);
      const release = acquireSettingsLock(path.join(root, STATE_FILENAME), { label: 'OpenCode installation' });
      // Bind descriptor-derived ownership before any path revalidation. Never
      // adopt the identity of a replacement published at the lock pathname.
      const owned = { root, rootStats: before.root, release,
        lockStats: getSettingsLockIdentity(release) };
      ownedLocks.push(owned);
      assertOwnedLock(owned);
    }
  } catch (error) {
    try { releaseOwned(ownedLocks); }
    catch (releaseError) { annotateCleanupFailure(error, 'releaseError', releaseError); }
    throw error;
  }
  const lease = Object.freeze({});
  activeLeases.set(lease, ownedLocks);
  return {
    lease,
    release() {
      if (!activeLeases.has(lease)) return;
      activeLeases.delete(lease);
      releaseOwned(ownedLocks);
    },
  };
}

function withOpenCodeInstallLocks(roots, callback, existingLease) {
  if (typeof callback !== 'function') throw new TypeError('OpenCode install lock callback must be a function.');
  const holder = acquireOpenCodeInstallLocks(roots, existingLease);
  let didThrow = false;
  let primaryError;
  let result;
  try { result = callback(holder.lease); }
  catch (error) { didThrow = true; primaryError = error; }
  try { holder.release(); }
  catch (error) {
    if (didThrow) annotateCleanupFailure(primaryError, 'releaseError', error);
    else { didThrow = true; primaryError = error; }
  }
  if (didThrow) throw primaryError;
  return result;
}

module.exports = { acquireOpenCodeInstallLocks, withOpenCodeInstallLocks };
