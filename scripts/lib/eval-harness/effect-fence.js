'use strict';

/**
 * Effect fence preload. Loaded into a child process with `node --require`.
 *
 * Framework 4 support (replay-safe execution). Any attempt to load a network
 * module inside a fenced process throws and is recorded to the canary file
 * named by ECC_EFFECT_FENCE_LOG. The parent reads that file after the run:
 * a non-empty log proves the candidate reached for the network even if it
 * swallowed the error. Filesystem writes outside ECC_EFFECT_FENCE_ROOT are
 * refused the same way.
 */

const fs = require('fs');
const path = require('path');
const Module = require('module');

const BLOCKED_MODULES = new Set(['http', 'https', 'net', 'tls', 'dgram', 'dns', 'http2', 'child_process']);
const logPath = process.env.ECC_EFFECT_FENCE_LOG;
// Low-level handles captured before the filesystem guard below. appendFileSync
// delegates to writeFileSync internally, so the canary log uses open/write/close
// directly and is never fenced by its own guard.
const openUnfenced = fs.openSync;
const writeUnfenced = fs.writeSync;
const closeUnfenced = fs.closeSync;
const realpathUnfenced = fs.realpathSync;

// Resolve symlinked prefixes (macOS temp dirs live under /private/var) so the
// root comparison is on real paths. Missing tail segments are kept verbatim.
function realish(target) {
  try {
    return realpathUnfenced(target);
  } catch (_error) {
    const parent = path.dirname(target);
    if (parent === target) {
      return target;
    }
    return path.join(realish(parent), path.basename(target));
  }
}

const root = process.env.ECC_EFFECT_FENCE_ROOT ? realish(path.resolve(process.env.ECC_EFFECT_FENCE_ROOT)) : null;

function record(kind, detail) {
  if (!logPath) {
    return;
  }
  try {
    const fd = openUnfenced(logPath, 'a');
    try {
      writeUnfenced(fd, JSON.stringify({ kind, detail, ts: new Date().toISOString() }) + '\n');
    } finally {
      closeUnfenced(fd);
    }
  } catch (_error) {
    // The canary log is best effort; the throw below still stops the effect.
  }
}

const originalLoad = Module._load;
Module._load = function fencedLoad(request, parent, isMain) {
  const bare = request.startsWith('node:') ? request.slice(5) : request;
  if (BLOCKED_MODULES.has(bare)) {
    record('module_blocked', bare);
    const error = new Error(`effect fence: module '${bare}' is not available in a fenced run`);
    error.code = 'effect.fenced';
    throw error;
  }
  return originalLoad.call(this, request, parent, isMain);
};

if (typeof globalThis.fetch === 'function') {
  globalThis.fetch = function fencedFetch(input) {
    record('fetch_blocked', String(input));
    const error = new Error('effect fence: fetch is not available in a fenced run');
    error.code = 'effect.fenced';
    return Promise.reject(error);
  };
}

if (root) {
  const guard = (name) => {
    const original = fs[name];
    if (typeof original !== 'function') {
      return;
    }
    fs[name] = function fencedWrite(target, ...rest) {
      const resolved = typeof target === 'string' || Buffer.isBuffer(target) || target instanceof URL
        ? realish(path.resolve(String(target)))
        : null;
      if (resolved && resolved !== root && !resolved.startsWith(root + path.sep)) {
        record('write_outside_root', resolved);
        const error = new Error(`effect fence: write outside sandbox root refused (${resolved})`);
        error.code = 'effect.fenced';
        throw error;
      }
      return original.call(this, target, ...rest);
    };
  };
  for (const name of ['writeFileSync', 'appendFileSync', 'mkdirSync', 'rmSync', 'unlinkSync', 'renameSync', 'copyFileSync']) {
    guard(name);
  }
}
