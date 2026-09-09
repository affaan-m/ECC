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
const MAX_DIRECTORY_ENTRIES = 10000;
const MAX_TRAVERSAL_OPERATIONS = 20000;
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

function sameIdentity(before, after) {
  return before.dev === after.dev && before.ino === after.ino && before.mode === after.mode;
}

function inspectSource(state, relativePath, kind) {
  validateRelativePath(relativePath);
  let current = state.root;
  let stats = fs.lstatSync(current);
  if (!sameIdentity(state.rootIdentity, stats)) throw new Error('Source root identity changed');
  const chain = [{ path: current, stats }];
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

function revalidateSource(source) {
  for (const entry of source.chain) {
    const current = fs.lstatSync(entry.path);
    if (current.isSymbolicLink() || !sameIdentity(entry.stats, current)) {
      throw new Error('Source ancestor or file identity changed during read');
    }
  }
}

function validateOpenedFile(state, source, before, relativePath) {
  // Recheck before the first byte read. O_NOFOLLOW only guards the leaf.
  revalidateSource(source);
  if (!sameIdentity(source.stats, before) || source.stats.size !== before.size
    || source.stats.mtimeMs !== before.mtimeMs || source.stats.ctimeMs !== before.ctimeMs) {
    throw new Error(`Source identity changed before read: ${relativePath}`);
  }
  if (!before.isFile() || before.size > MAX_FILE_BYTES) throw new Error(`Source byte limit exceeded: ${relativePath}`);
  if (state.totalBytes + before.size > MAX_TOTAL_BYTES) throw new Error('Cumulative source byte limit exceeded');
}

function readDescriptorBytes(descriptor, size) {
  const buffer = Buffer.alloc(size + 1);
  let bytes = 0;
  while (bytes < buffer.length) {
    const count = fs.readSync(descriptor, buffer, bytes, buffer.length - bytes, null);
    if (!count) break;
    bytes += count;
  }
  return buffer.subarray(0, bytes);
}

function readSourceFile(state, relativePath) {
  if (state.cache.has(relativePath)) return state.cache.get(relativePath);
  const source = inspectSource(state, relativePath, 'file');
  if (state.cache.size >= MAX_SOURCE_FILES) throw new Error('Source file count limit exceeded');
  const flags = fs.constants.O_RDONLY | (fs.constants.O_NOFOLLOW || 0) | (fs.constants.O_NONBLOCK || 0);
  const descriptor = fs.openSync(source.path, flags);
  try {
    const before = fs.fstatSync(descriptor);
    validateOpenedFile(state, source, before, relativePath);
    const content = readDescriptorBytes(descriptor, before.size);
    const after = fs.fstatSync(descriptor);
    revalidateSource(source);
    if (content.length !== before.size || after.size !== before.size || before.mtimeMs !== after.mtimeMs
      || before.ctimeMs !== after.ctimeMs) throw new Error(`Source changed during read: ${relativePath}`);
    const value = { path: relativePath, bytes: content.length, digest: digest(content), content };
    state.totalBytes += content.length;
    state.cache.set(relativePath, value);
    return value;
  } finally { fs.closeSync(descriptor); }
}

function chargeTraversal(state) {
  state.traversalOperations++;
  if (state.traversalOperations > MAX_TRAVERSAL_OPERATIONS) throw new Error('Source traversal operation limit exceeded');
}

function listSourceDirectory(state, relativePath) {
  const source = inspectSource(state, relativePath, 'directory');
  chargeTraversal(state); // Empty directories still consume a traversal operation.
  const directory = fs.opendirSync(source.path, { bufferSize: 32 });
  try {
    revalidateSource(source);
    const entries = [];
    for (let entry = directory.readSync(); entry !== null; entry = directory.readSync()) {
      if (entries.length >= MAX_DIRECTORY_ENTRIES) throw new Error('Source directory entry limit exceeded');
      chargeTraversal(state); // Count all names before any generated-file filtering.
      entries.push(entry.name);
    }
    revalidateSource(source);
    return entries.sort();
  } finally { directory.closeSync(); }
}

function walkSourceDirectory(state, relativePath, depth = 0) {
  if (depth > 32) throw new Error('Source directory depth limit exceeded');
  return listSourceDirectory(state, relativePath).flatMap(name => {
    const child = `${relativePath}/${name}`;
    if (isExcludedResource(child)) return [];
    const source = inspectSource(state, child);
    return source.stats.isDirectory() ? walkSourceDirectory(state, child, depth + 1) : [readSourceFile(state, child)];
  });
}

function readSourceJson(state, relativePath) {
  try { return JSON.parse(readSourceFile(state, relativePath).content.toString('utf8')); } catch (error) {
    throw new Error(`Cannot read JSON source ${relativePath}: ${error.message}`);
  }
}

function createSourceReader(repoRoot = DEFAULT_REPO_ROOT) {
  if (typeof repoRoot !== 'string' || !repoRoot.trim()) throw new Error('repoRoot must be a non-empty path');
  const root = fs.realpathSync(repoRoot);
  const rootIdentity = fs.lstatSync(root);
  if (!rootIdentity.isDirectory()) throw new Error('repoRoot must be a directory');
  const state = { root, rootIdentity, cache: new Map(), totalBytes: 0, traversalOperations: 0 };
  return {
    read: relativePath => readSourceFile(state, relativePath),
    list: relativePath => listSourceDirectory(state, relativePath),
    walk: (relativePath, depth = 0) => walkSourceDirectory(state, relativePath, depth),
    json: relativePath => readSourceJson(state, relativePath),
    resolve: (relativePath, kind) => inspectSource(state, relativePath, kind).path,
  };
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
