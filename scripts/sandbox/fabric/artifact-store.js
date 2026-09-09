'use strict';

const crypto = require('crypto');
const fs = require('fs');
const path = require('path');

const DEFAULT_MAX_FILES = 128;
const DEFAULT_MAX_FILE_BYTES = 16 * 1024 * 1024;
const DEFAULT_MAX_TOTAL_BYTES = 64 * 1024 * 1024;

function pathIsInside(parent, candidate) {
  const relative = path.relative(path.resolve(parent), path.resolve(candidate));
  return relative === '' || (!relative.startsWith('..') && !path.isAbsolute(relative));
}

function positiveLimit(value, fallback, label) {
  if (value === undefined) return fallback;
  if (!Number.isSafeInteger(value) || value < 1) {
    throw new Error(`${label} must be a positive integer`);
  }
  return value;
}

function containsControlCharacter(value) {
  return [...value].some(character => {
    const code = character.codePointAt(0);
    return code < 32 || code === 127;
  });
}

function normalizeRelativePath(relativePath) {
  if (typeof relativePath !== 'string' || relativePath.length === 0) {
    throw new Error('Artifact path must be a non-empty relative path');
  }
  if (containsControlCharacter(relativePath)) {
    throw new Error('Artifact path contains control characters');
  }
  if (path.isAbsolute(relativePath) || path.win32.isAbsolute(relativePath)) {
    throw new Error(`Artifact path must be relative: ${relativePath}`);
  }
  const portable = relativePath.replace(/\\/g, '/');
  const normalized = path.posix.normalize(portable).replace(/^\.\//, '');
  if (
    normalized === ''
    || normalized === '.'
    || normalized === '..'
    || normalized.startsWith('../')
  ) {
    throw new Error(`Artifact path traversal is forbidden: ${relativePath}`);
  }
  return normalized;
}

function validateRoot(root) {
  if (typeof root !== 'string' || root.length === 0) {
    throw new Error('Artifact root must be a non-empty path');
  }
  const resolved = path.resolve(root);
  const stat = fs.lstatSync(resolved);
  if (stat.isSymbolicLink()) throw new Error('Artifact root must not be a symbolic link');
  if (!stat.isDirectory()) throw new Error('Artifact root must be a directory');
  if (
    process.platform !== 'win32'
    && (
      (stat.mode & 0o077) !== 0
      || (typeof process.getuid === 'function' && stat.uid !== process.getuid())
    )
  ) {
    throw new Error('Artifact root must be a private directory owned by the current user');
  }
  return fs.realpathSync.native(resolved);
}

function validateComponents(root, relativePath) {
  const components = relativePath.split('/');
  let candidate = root;
  for (let index = 0; index < components.length; index += 1) {
    candidate = path.join(candidate, components[index]);
    const stat = fs.lstatSync(candidate);
    if (stat.isSymbolicLink()) {
      throw new Error(`Artifact path must not contain a symbolic link: ${relativePath}`);
    }
    if (index < components.length - 1 && !stat.isDirectory()) {
      throw new Error(`Artifact parent must be a directory: ${relativePath}`);
    }
    if (index === components.length - 1 && !stat.isFile()) {
      throw new Error(`Artifact must be a regular file: ${relativePath}`);
    }
  }
  const canonical = fs.realpathSync.native(candidate);
  if (!pathIsInside(root, canonical)) {
    throw new Error(`Artifact path escapes its root: ${relativePath}`);
  }
  return candidate;
}

function readBoundedArtifact(filePath, relativePath, maxFileBytes) {
  const flags = fs.constants.O_RDONLY
    | (fs.constants.O_NONBLOCK || 0)
    | (fs.constants.O_NOFOLLOW || 0);
  const descriptor = fs.openSync(filePath, flags);
  try {
    const initial = fs.fstatSync(descriptor);
    if (!initial.isFile()) throw new Error(`Artifact must be a regular file: ${relativePath}`);
    if (initial.size > maxFileBytes) {
      throw new Error(`Artifact ${relativePath} exceeds ${maxFileBytes} bytes individual limit`);
    }
    const buffer = Buffer.alloc(Math.min(maxFileBytes + 1, initial.size + 1));
    let offset = 0;
    while (offset < buffer.length) {
      const bytesRead = fs.readSync(descriptor, buffer, offset, buffer.length - offset, null);
      if (bytesRead === 0) break;
      offset += bytesRead;
    }
    if (offset > maxFileBytes) {
      throw new Error(`Artifact ${relativePath} exceeds ${maxFileBytes} bytes individual limit`);
    }
    const final = fs.fstatSync(descriptor);
    if (!final.isFile() || final.dev !== initial.dev || final.ino !== initial.ino) {
      throw new Error(`Artifact changed identity while being collected: ${relativePath}`);
    }
    if (final.size > offset) {
      throw new Error(`Artifact changed size while being collected: ${relativePath}`);
    }
    return buffer.subarray(0, offset);
  } finally {
    fs.closeSync(descriptor);
  }
}

function collectArtifacts(root, relativePaths, options = {}) {
  if (!Array.isArray(relativePaths)) throw new Error('Artifact paths must be an array');
  // The supervisor must stop every writer before asserting this invariant.
  // Private ownership plus a stopped source closes parent-swap and content races
  // that path-only validation cannot make safe while untrusted code is live.
  if (options.sourceSealed !== true) {
    throw new Error('Artifact collection requires a stopped and sealed source tree');
  }
  const maxFiles = positiveLimit(options.maxFiles, DEFAULT_MAX_FILES, 'maxFiles');
  const maxFileBytes = positiveLimit(
    options.maxFileBytes,
    DEFAULT_MAX_FILE_BYTES,
    'maxFileBytes'
  );
  const maxTotalBytes = positiveLimit(
    options.maxTotalBytes,
    DEFAULT_MAX_TOTAL_BYTES,
    'maxTotalBytes'
  );
  if (relativePaths.length > maxFiles) {
    throw new Error(`Artifact collection contains more than ${maxFiles} files`);
  }
  const canonicalRoot = validateRoot(root);
  const normalized = relativePaths.map(normalizeRelativePath);
  if (new Set(normalized).size !== normalized.length) {
    throw new Error('Artifact collection contains duplicate normalized paths');
  }

  let totalBytes = 0;
  return [...normalized].sort().map(relativePath => {
    const filePath = validateComponents(canonicalRoot, relativePath);
    const content = readBoundedArtifact(filePath, relativePath, maxFileBytes);
    totalBytes += content.length;
    if (totalBytes > maxTotalBytes) {
      throw new Error(`Artifact collection exceeds ${maxTotalBytes} bytes total limit`);
    }
    return {
      kind: 'artifact',
      path: relativePath,
      bytes: content.length,
      sha256: crypto.createHash('sha256').update(content).digest('hex'),
      redacted: options.redacted === true,
    };
  });
}

function normalizeArtifactRef(reference, options = {}) {
  if (!reference || typeof reference !== 'object' || Array.isArray(reference)) {
    throw new Error('Artifact reference must be an object');
  }
  const normalizedPath = normalizeRelativePath(reference.path);
  if (!Number.isSafeInteger(reference.bytes) || reference.bytes < 0) {
    throw new Error(`Artifact ${normalizedPath} bytes must be a non-negative integer`);
  }
  const maxBytes = positiveLimit(
    options.maxBytes,
    DEFAULT_MAX_FILE_BYTES,
    'artifact reference maxBytes'
  );
  if (reference.bytes > maxBytes) {
    throw new Error(`Artifact ${normalizedPath} exceeds ${maxBytes} bytes reference limit`);
  }
  if (!/^[a-f0-9]{64}$/.test(String(reference.sha256 || ''))) {
    throw new Error(`Artifact ${normalizedPath} sha256 must be 64 lowercase hex characters`);
  }
  const kind = String(reference.kind || 'artifact');
  if (!/^[a-z0-9][a-z0-9._-]{0,79}$/.test(kind)) {
    throw new Error(`Artifact ${normalizedPath} kind is invalid`);
  }
  return {
    kind,
    path: normalizedPath,
    bytes: reference.bytes,
    sha256: reference.sha256,
    redacted: reference.redacted === true,
  };
}

module.exports = {
  DEFAULT_MAX_FILES,
  DEFAULT_MAX_FILE_BYTES,
  DEFAULT_MAX_TOTAL_BYTES,
  collectArtifacts,
  normalizeArtifactRef,
  normalizeRelativePath,
  pathIsInside,
};
