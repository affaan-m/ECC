'use strict';

const crypto = require('crypto');
const fs = require('fs');
const path = require('path');
const Ajv = require('ajv');
const { SUPPORTED_INSTALL_TARGETS } = require('./install-manifests');

const DEFAULT_REPO_ROOT = path.resolve(__dirname, '../..');
const MAX_FILE_BYTES = 4 * 1024 * 1024;
const MAX_TOTAL_BYTES = 16 * 1024 * 1024;
const MAX_SOURCE_FILES = 10000;
const TARGETS = Object.freeze([...new Set([...SUPPORTED_INSTALL_TARGETS, 'pi'])].sort());
const EXCLUDED_DIRECTORIES = new Set(['.git', 'node_modules', '__pycache__', '.pytest_cache']);

function stableValue(value) {
  if (Array.isArray(value)) return value.map(stableValue);
  if (!value || typeof value !== 'object') return value;
  return Object.fromEntries(Object.keys(value).sort().map(key => [key, stableValue(value[key])]));
}

function stableStringify(value) { return JSON.stringify(stableValue(value)); }
function digest(value) { return crypto.createHash('sha256').update(value).digest('hex'); }
function digestObject(value) { return digest(stableStringify(value)); }

function hasUnsafeControls(value, allowWhitespace = false) {
  return [...value].some(character => {
    const code = character.charCodeAt(0);
    return (code < 32 && !(allowWhitespace && [9, 10, 13].includes(code))) || (code >= 127 && code <= 159);
  });
}

function normalizeMetadataText(value, label) {
  if (typeof value !== 'string' || !value.trim() || hasUnsafeControls(value, true)) {
    throw new Error(`${label} metadata must be non-empty prose without terminal control characters`);
  }
  return value.replace(/\s+/g, ' ').trim();
}

// Match the installer's generated-file exclusions and npm's Python cache exclusions.
function isExcludedResource(relativePath) {
  return relativePath.split('/').some(part => EXCLUDED_DIRECTORIES.has(part) || /\.(pyc|pyo|pyd)$/i.test(part));
}

function validateRelativePath(relativePath) {
  if (typeof relativePath !== 'string' || relativePath.length === 0
    || relativePath.length > 4096 || /[\\<>:"|?*]/.test(relativePath) || hasUnsafeControls(relativePath)
    || path.posix.isAbsolute(relativePath)
    || relativePath.split('/').some(part => !part || part === '.' || part === '..'
      || /[. ]$/.test(part) || /^(con|prn|aux|nul|com[1-9]|lpt[1-9])(?:\.|$)/i.test(part))) {
    throw new Error('Source path must be a portable relative path');
  }
}

function createSourceReader(repoRoot = DEFAULT_REPO_ROOT) {
  if (typeof repoRoot !== 'string' || !repoRoot.trim()) throw new Error('repoRoot must be a non-empty path');
  const root = fs.realpathSync(repoRoot);
  const rootIdentity = fs.lstatSync(root);
  if (!rootIdentity.isDirectory()) throw new Error('repoRoot must be a directory');
  const cache = new Map();
  let totalBytes = 0;

  function sameIdentity(before, after) {
    return before.dev === after.dev && before.ino === after.ino && before.mode === after.mode;
  }

  function inspect(relativePath, kind) {
    validateRelativePath(relativePath);
    let current = root;
    let stats = fs.lstatSync(root);
    if (!sameIdentity(rootIdentity, stats)) throw new Error('Source root identity changed');
    const chain = [{ path: root, stats }];
    const segments = relativePath.split('/');
    for (const [index, segment] of segments.entries()) {
      current = path.join(current, segment);
      stats = fs.lstatSync(current);
      if (stats.isSymbolicLink()) throw new Error(`Symbolic link source is forbidden: ${relativePath}`);
      if (index < segments.length - 1 && !stats.isDirectory()) throw new Error(`Source ancestor is not a directory: ${relativePath}`);
      chain.push({ path: current, stats });
    }
    if (kind === 'file' && !stats.isFile()) throw new Error(`Source is not a regular file: ${relativePath}`);
    if (kind === 'directory' && !stats.isDirectory()) throw new Error(`Source is not a directory: ${relativePath}`);
    return { path: current, stats, chain };
  }

  function revalidate(source) {
    for (const entry of source.chain) {
      const current = fs.lstatSync(entry.path);
      if (current.isSymbolicLink() || !sameIdentity(entry.stats, current)) {
        throw new Error('Source ancestor or file identity changed during read');
      }
    }
  }

  function resolve(relativePath, kind) {
    return inspect(relativePath, kind).path;
  }

  function read(relativePath) {
    if (cache.has(relativePath)) return cache.get(relativePath);
    const source = inspect(relativePath, 'file');
    if (cache.size >= MAX_SOURCE_FILES) throw new Error('Source file count limit exceeded');
    const flags = fs.constants.O_RDONLY | (fs.constants.O_NOFOLLOW || 0) | (fs.constants.O_NONBLOCK || 0);
    const descriptor = fs.openSync(source.path, flags);
    try {
      const before = fs.fstatSync(descriptor);
      // Recheck before the first byte read. O_NOFOLLOW only guards the leaf.
      revalidate(source);
      if (!sameIdentity(source.stats, before) || source.stats.size !== before.size
        || source.stats.mtimeMs !== before.mtimeMs || source.stats.ctimeMs !== before.ctimeMs) {
        throw new Error(`Source identity changed before read: ${relativePath}`);
      }
      if (!before.isFile() || before.size > MAX_FILE_BYTES) throw new Error(`Source byte limit exceeded: ${relativePath}`);
      if (totalBytes + before.size > MAX_TOTAL_BYTES) throw new Error('Cumulative source byte limit exceeded');
      const buffer = Buffer.alloc(before.size + 1);
      let bytes = 0;
      while (bytes < buffer.length) {
        const count = fs.readSync(descriptor, buffer, bytes, buffer.length - bytes, null);
        if (!count) break;
        bytes += count;
      }
      const after = fs.fstatSync(descriptor);
      revalidate(source);
      if (bytes !== before.size || after.size !== before.size || before.mtimeMs !== after.mtimeMs
        || before.ctimeMs !== after.ctimeMs) throw new Error(`Source changed during read: ${relativePath}`);
      const content = buffer.subarray(0, bytes);
      const value = { path: relativePath, bytes, digest: digest(content), content };
      totalBytes += bytes;
      cache.set(relativePath, value);
      return value;
    } finally { fs.closeSync(descriptor); }
  }

  function list(relativePath) {
    const source = inspect(relativePath, 'directory');
    const entries = fs.readdirSync(source.path).sort();
    revalidate(source);
    return entries;
  }

  function walk(relativePath, depth = 0) {
    if (depth > 32) throw new Error('Source directory depth limit exceeded');
    return list(relativePath).flatMap(name => {
      const child = `${relativePath}/${name}`;
      if (isExcludedResource(child)) return [];
      const absolute = resolve(child);
      const stats = fs.lstatSync(absolute);
      return stats.isDirectory() ? walk(child, depth + 1) : [read(child)];
    });
  }

  function json(relativePath) {
    try { return JSON.parse(read(relativePath).content.toString('utf8')); } catch (error) {
      throw new Error(`Cannot read JSON source ${relativePath}: ${error.message}`);
    }
  }
  return { read, list, walk, json, resolve };
}

const schemaValidators = new Map();
function validateSchema(value, schemaName) {
  if (!schemaValidators.has(schemaName)) {
    const schema = JSON.parse(fs.readFileSync(path.join(DEFAULT_REPO_ROOT, 'schemas', schemaName), 'utf8'));
    schemaValidators.set(schemaName, new Ajv({ allErrors: true, strict: true }).compile(schema));
  }
  const validate = schemaValidators.get(schemaName);
  if (!validate(value)) throw new Error(`Invalid ${schemaName} schema: ${JSON.stringify(validate.errors)}`);
}

function validateTarget(target = 'codex') {
  if (!TARGETS.includes(target)) throw new Error(`Unknown context target: ${target}`);
  return target;
}

function compilerDigest() {
  const sources = [
    'scripts/lib/context-profile-support.js', 'scripts/lib/context-pack-registry.js',
    'scripts/lib/context-profiles.js', 'schemas/context-pack-registry.schema.json',
    'schemas/context-profile.schema.json', 'scripts/lib/install-manifests.js',
  ];
  const reader = createSourceReader(DEFAULT_REPO_ROOT);
  return digestObject(sources.map(source => ({ path: source, digest: reader.read(source).digest })));
}

module.exports = {
  DEFAULT_REPO_ROOT, TARGETS, compilerDigest, createSourceReader, digestObject,
  isExcludedResource, normalizeMetadataText, stableStringify, validateRelativePath, validateSchema, validateTarget,
};
