'use strict';

const crypto = require('crypto');
const fs = require('fs');
const path = require('path');

/** Restores the newest valid backup if an interrupted replacement left no state file. */
function restoreStateBackup(stateFile) {
  const resolved = path.resolve(stateFile);
  if (fs.existsSync(resolved)) return false;

  const dir = path.dirname(resolved);
  const prefix = `${path.basename(resolved)}.backup.`;
  let names;
  try {
    names = fs.readdirSync(dir).filter(name => name.startsWith(prefix));
  } catch (err) {
    if (err && err.code === 'ENOENT') return false;
    throw err;
  }

  const candidates = names.map(name => path.join(dir, name)).map(file => ({
    file,
    modified: fs.lstatSync(file).mtimeMs
  })).sort((a, b) => b.modified - a.modified);

  for (const candidate of candidates) {
    const stat = fs.lstatSync(candidate.file);
    if (!stat.isFile() || stat.isSymbolicLink()) continue;
    try {
      const state = JSON.parse(fs.readFileSync(candidate.file, 'utf8'));
      if (!state || typeof state !== 'object' || Array.isArray(state)) continue;
    } catch (_err) {
      /* Ignore malformed backup candidates and try the next one. */
      continue;
    }
    fs.renameSync(candidate.file, resolved);
    return true;
  }
  return false;
}

/**
 * Loads and parses state file from disk, returning default state on missing/malformed file.
 * @param {string} stateFile Path to state file.
 * @returns {Object} Parsed state object or empty template.
 */
function loadStateFromDisk(stateFile) {
  const resolved = path.resolve(stateFile);
  restoreStateBackup(resolved);
  if (fs.existsSync(resolved)) {
    try {
      return JSON.parse(fs.readFileSync(resolved, 'utf8'));
    } catch (_err) {
      return { checked: [], last_active: Date.now() };
    }
  }
  return { checked: [], last_active: Date.now() };
}

/**
 * Atomically writes state to disk using a unique temporary file.
 * @param {string} stateFile Path to destination state file.
 * @param {Object} state State object to serialize.
 * @param {(source: string, destination: string) => void} [renameFile=fs.renameSync] Rename operation, injectable for failure tests.
 */
function writeStateToDiskAtomic(stateFile, state, renameFile = fs.renameSync) {
  const resolvedDest = path.resolve(stateFile);
  restoreStateBackup(resolvedDest);
  const tmpFile = path.resolve(`${resolvedDest}.tmp.${process.pid}.${crypto.randomBytes(4).toString('hex')}`);
  let renamed = false;
  try {
    fs.writeFileSync(tmpFile, JSON.stringify(state, null, 2), { encoding: 'utf8', mode: 0o600, flag: 'wx' });
    try {
      renameFile(tmpFile, resolvedDest);
    } catch (initialError) {
      if (!initialError || (initialError.code !== 'EEXIST' && initialError.code !== 'EPERM')) {
        throw initialError;
      }

      if (!fs.existsSync(resolvedDest)) {
        renameFile(tmpFile, resolvedDest);
      } else {
        const destinationStat = fs.lstatSync(resolvedDest);
        if (!destinationStat.isFile()) {
          throw initialError;
        }

        const backupFile = `${resolvedDest}.backup.${Date.now()}.${process.pid}.${crypto.randomBytes(4).toString('hex')}`;
        renameFile(resolvedDest, backupFile);
        try {
          renameFile(tmpFile, resolvedDest);
        } catch (replaceError) {
          try {
            renameFile(backupFile, resolvedDest);
          } catch (restoreError) {
            throw new Error(`${replaceError.message}; prior state is preserved at ${backupFile} because restoration failed: ${restoreError.message}`);
          }
          throw replaceError;
        }
        renamed = true;
        try {
          fs.unlinkSync(backupFile);
        } catch (cleanupError) {
          process.stderr.write(`[GateGuard] State was updated, but backup cleanup failed at ${backupFile}: ${cleanupError.message}\n`);
        }
      }
    }
    renamed = true;
  } finally {
    if (!renamed) {
      try { fs.unlinkSync(tmpFile); } catch (_cleanupErr) { void 0; }
    }
  }
}

module.exports = { restoreStateBackup, loadStateFromDisk, writeStateToDiskAtomic };
