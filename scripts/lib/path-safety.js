'use strict';

const fs = require('fs');
const path = require('path');

/**
 * Path containment helpers for install-state-driven file operations.
 *
 * Install-state files are project-local and therefore attacker-controllable
 * (a cloned/forked repo can ship a crafted `.cursor/ecc-install-state.json`).
 * `repair`/`uninstall`/`auto-update` replay recorded operations, so every
 * write/delete destination MUST be confined to the adapter-derived trusted
 * root — never trusted from the state file itself (GHSA-hfpv-w6mp-5g95).
 */

function safeRealpath(target) {
  try {
    return fs.realpathSync(path.resolve(target));
  } catch {
    return path.resolve(target);
  }
}

/**
 * Canonicalize a path that may not exist yet: realpath its nearest existing
 * ancestor, then re-append the missing tail. This defeats symlink escapes
 * where an intermediate directory is a symlink pointing out of the root.
 */
function realpathNearestExisting(target) {
  let current = path.resolve(target);
  const tail = [];
  while (!fs.existsSync(current)) {
    const parent = path.dirname(current);
    if (parent === current) {
      break;
    }
    tail.unshift(path.basename(current));
    current = parent;
  }
  const real = safeRealpath(current);
  return tail.length > 0 ? path.join(real, ...tail) : real;
}

/**
 * True when `target` resolves to `root` itself or a path beneath it, with
 * symlinks resolved on both sides.
 */
function isWithinRoot(target, root) {
  if (!root) {
    return false;
  }
  const realRoot = safeRealpath(root);
  const realTarget = realpathNearestExisting(target);
  if (realTarget === realRoot) {
    return true;
  }
  const rel = path.relative(realRoot, realTarget);
  return rel !== '' && !rel.startsWith('..') && !path.isAbsolute(rel);
}

/**
 * Fail-closed guard: throw unless `target` is contained within `root`.
 * Returns the canonicalized target path on success.
 */
function assertWithinTrustedRoot(target, root, action = 'write') {
  if (!target || typeof target !== 'string') {
    throw new Error(`Refusing to ${action}: missing destination path.`);
  }
  if (!root) {
    throw new Error(`Refusing to ${action} '${target}': no trusted install root resolved.`);
  }
  if (!isWithinRoot(target, root)) {
    throw new Error(`Refusing to ${action} outside the install root: '${target}' is not within '${root}'.`);
  }
  return realpathNearestExisting(target);
}

module.exports = {
  realpathNearestExisting,
  isWithinRoot,
  assertWithinTrustedRoot
};
