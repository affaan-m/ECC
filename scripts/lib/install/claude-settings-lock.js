'use strict';

const crypto = require('crypto');
const fs = require('fs');
const path = require('path');

const INVALID_LOCK_STALE_MS = 5 * 60 * 1000;

function sameFileIdentity(left, right) {
  return left.dev === right.dev && left.ino === right.ino;
}

function createSettingsLock(lockPath) {
  const tempPath = `${lockPath}.create-${process.pid}-${crypto.randomBytes(8).toString('hex')}`;
  let descriptor;
  let ownedStats;
  try {
    descriptor = fs.openSync(tempPath, 'wx', 0o600);
    fs.writeFileSync(descriptor, `${JSON.stringify({
      pid: process.pid,
      startedAt: new Date().toISOString(),
      token: crypto.randomBytes(16).toString('hex'),
    })}\n`);
    fs.fsyncSync(descriptor);
    ownedStats = fs.fstatSync(descriptor, { bigint: true });
    fs.closeSync(descriptor);
    descriptor = undefined;
    fs.linkSync(tempPath, lockPath);
  } catch (error) {
    if (descriptor !== undefined) fs.closeSync(descriptor);
    fs.rmSync(tempPath, { force: true });
    throw error;
  }
  fs.rmSync(tempPath, { force: true });

  let released = false;
  return () => {
    if (released) return;
    const quarantinePath = `${lockPath}.release-${process.pid}-${crypto.randomBytes(8).toString('hex')}`;
    fs.renameSync(lockPath, quarantinePath);
    const quarantinedStats = fs.lstatSync(quarantinePath, { bigint: true });
    if (!sameFileIdentity(quarantinedStats, ownedStats)) {
      if (!fs.existsSync(lockPath)) fs.renameSync(quarantinePath, lockPath);
      throw new Error(`Refusing to release a changed Claude settings lock: ${lockPath}`);
    }
    released = true;
    fs.rmSync(quarantinePath, { force: true });
  };
}

function inspectSettingsLock(lockPath) {
  const descriptor = fs.openSync(lockPath, fs.constants.O_RDONLY | (fs.constants.O_NOFOLLOW || 0));
  try {
    const stats = fs.fstatSync(descriptor, { bigint: true });
    const pathStats = fs.lstatSync(lockPath, { bigint: true });
    if (
      !stats.isFile()
      || pathStats.isSymbolicLink()
      || !pathStats.isFile()
      || !sameFileIdentity(stats, pathStats)
    ) {
      return { metadata: null, stats };
    }
    let metadata = null;
    try {
      metadata = JSON.parse(fs.readFileSync(descriptor, 'utf8'));
    } catch (_error) {
      // Invalid locks may be recovered only after the bounded lease below.
    }
    return { metadata, stats };
  } finally {
    fs.closeSync(descriptor);
  }
}

function processIsAlive(pid) {
  try {
    process.kill(pid, 0);
    return true;
  } catch (error) {
    return error.code !== 'ESRCH';
  }
}

function recoverSettingsLock(lockPath) {
  const recoveryPath = `${lockPath}.recover`;
  try {
    fs.mkdirSync(recoveryPath, { mode: 0o700 });
  } catch (error) {
    if (error && error.code === 'EEXIST') return null;
    throw error;
  }

  const quarantinePath = `${lockPath}.stale-${process.pid}-${crypto.randomBytes(8).toString('hex')}`;
  try {
    let inspected;
    try {
      inspected = inspectSettingsLock(lockPath);
    } catch (error) {
      if (error && error.code === 'ENOENT') return createSettingsLock(lockPath);
      throw error;
    }
    const validOwner = Number.isSafeInteger(inspected.metadata && inspected.metadata.pid)
      && inspected.metadata.pid > 0;
    const stale = validOwner
      ? !processIsAlive(inspected.metadata.pid)
      : Date.now() - Number(inspected.stats.mtimeMs) >= INVALID_LOCK_STALE_MS;
    if (!stale) return null;

    fs.renameSync(lockPath, quarantinePath);
    const quarantinedStats = fs.lstatSync(quarantinePath, { bigint: true });
    if (!sameFileIdentity(quarantinedStats, inspected.stats)) {
      if (!fs.existsSync(lockPath)) fs.renameSync(quarantinePath, lockPath);
      return null;
    }
    fs.rmSync(quarantinePath, { force: true });
    return createSettingsLock(lockPath);
  } finally {
    fs.rmSync(recoveryPath, { recursive: true, force: true });
    fs.rmSync(quarantinePath, { force: true });
  }
}

function acquireSettingsLock(settingsPath) {
  const lockPath = `${settingsPath}.ecc.lock`;
  fs.mkdirSync(path.dirname(settingsPath), { recursive: true });
  try {
    return createSettingsLock(lockPath);
  } catch (error) {
    if (!error || error.code !== 'EEXIST') {
      throw error;
    }
  }
  const recovered = recoverSettingsLock(lockPath);
  if (recovered) return recovered;
  throw new Error(
    `Another ECC process is updating Claude settings: ${settingsPath}. `
    + `If no ECC process is active, inspect and remove ${lockPath}.`
  );
}

function runWithSettingsLock(settingsPath, callback) {
  const releaseLock = acquireSettingsLock(settingsPath);
  let primaryError = null;
  let result;
  try {
    result = callback();
  } catch (error) {
    primaryError = error;
  }

  let releaseError = null;
  try {
    releaseLock();
  } catch (error) {
    releaseError = error;
  }

  if (primaryError) {
    if (releaseError) primaryError.releaseError = releaseError;
    throw primaryError;
  }
  if (releaseError) throw releaseError;
  return result;
}

module.exports = {
  acquireSettingsLock,
  runWithSettingsLock,
};
