'use strict';

const crypto = require('node:crypto');
const fs = require('node:fs');
const path = require('node:path');
const { stableStringify, validateRelativePath } = require('./context-profile-support');

const MAX_BYTES = 16 * 1024 * 1024;
const hash = bytes => crypto.createHash('sha256').update(bytes).digest('hex');
const same = (a, b) => a.dev === b.dev && a.ino === b.ino && a.mode === b.mode;

function pathSegments(absolute, pathApi = path) {
  const root = pathApi.parse(absolute).root;
  return { root, parts: absolute.slice(root.length).split(pathApi.sep).filter(Boolean) };
}

function inspect(absolute, allowMissing = false) {
  const { root, parts } = pathSegments(absolute);
  let current = root;
  const chain = [];
  for (const [index, part] of parts.entries()) {
    current = path.join(current, part);
    const stat = fs.lstatSync(current, { throwIfNoEntry: false });
    if (!stat && allowMissing && index === parts.length - 1) return { chain, stat: null };
    if (!stat) throw new Error(`Managed parent directory is missing: ${current}`);
    if (stat.isSymbolicLink()) throw new Error(`Symbolic link in managed path: ${current}`);
    if (index < parts.length - 1 && !stat.isDirectory()) throw new Error('Managed parent is not a directory');
    chain.push({ path: current, stat });
  }
  return { chain, stat: chain.at(-1)?.stat || fs.lstatSync(current) };
}

function recheck(chain) {
  for (const item of chain) {
    const now = fs.lstatSync(item.path);
    if (now.isSymbolicLink() || !same(item.stat, now)) throw new Error('Managed path identity changed');
  }
}

function read(file) {
  const before = inspect(file);
  if (!before.stat.isFile() || before.stat.nlink !== 1 || before.stat.size > MAX_BYTES) {
    throw new Error('Managed file integrity requires a bounded regular file with one link');
  }
  const fd = fs.openSync(file, fs.constants.O_RDONLY | (fs.constants.O_NOFOLLOW || 0) | (fs.constants.O_NONBLOCK || 0));
  try {
    const opened = fs.fstatSync(fd);
    recheck(before.chain);
    if (!same(before.stat, opened) || opened.nlink !== 1 || opened.size !== before.stat.size
      || opened.mtimeMs !== before.stat.mtimeMs || opened.ctimeMs !== before.stat.ctimeMs) throw new Error('Managed file identity changed');
    const result = Buffer.alloc(opened.size + 1);
    let count = 0;
    while (count < result.length) {
      const n = fs.readSync(fd, result, count, result.length - count, null);
      if (!n) break;
      count += n;
    }
    const after = fs.fstatSync(fd);
    recheck(before.chain);
    if (count !== opened.size || opened.mtimeMs !== after.mtimeMs || opened.ctimeMs !== after.ctimeMs) throw new Error('Managed file changed during read');
    return result.subarray(0, count);
  } finally { fs.closeSync(fd); }
}

function syncDirectory(directory) {
  if (process.platform === 'win32') return;
  const fd = fs.openSync(directory, fs.constants.O_RDONLY);
  try { fs.fsyncSync(fd); } finally { fs.closeSync(fd); }
}

function writeExclusive(file, bytes) {
  const before = inspect(file, true);
  if (before.stat) throw new Error(`Managed file already exists: ${file}`);
  const fd = fs.openSync(file, fs.constants.O_WRONLY | fs.constants.O_CREAT | fs.constants.O_EXCL | (fs.constants.O_NOFOLLOW || 0), 0o600);
  try { recheck(before.chain); fs.writeFileSync(fd, bytes); fs.fsyncSync(fd); }
  finally { fs.closeSync(fd); }
  recheck(before.chain);
  syncDirectory(path.dirname(file));
}

function jsonBytes(value) { return Buffer.from(`${stableStringify(value)}\n`); }
function readJson(file) { return JSON.parse(read(file).toString('utf8')); }

function atomicJson(file, value) {
  const before = inspect(file, true);
  const previous = before.stat ? read(file) : null;
  const temporary = path.join(path.dirname(file), `.atomic-${crypto.randomUUID()}`);
  writeExclusive(temporary, jsonBytes(value));
  try {
    recheck(before.chain);
    if (previous && !previous.equals(read(file))) throw new Error('Managed file changed before replacement');
    if (!before.stat && fs.lstatSync(file, { throwIfNoEntry: false })) throw new Error('Managed destination appeared during write');
    fs.renameSync(temporary, file);
    syncDirectory(path.dirname(file));
  } finally {
    if (fs.lstatSync(temporary, { throwIfNoEntry: false })) fs.unlinkSync(temporary);
  }
}

function mkdir(directory) {
  const before = inspect(directory, true);
  if (before.stat) {
    if (!before.stat.isDirectory()) throw new Error('Managed path is not a directory');
    return;
  }
  fs.mkdirSync(directory, { mode: 0o700 });
  recheck(before.chain);
  syncDirectory(path.dirname(directory));
}

function ensureParents(root, relative) {
  validateRelativePath(relative);
  const parts = relative.split('/');
  for (let index = 1; index < parts.length; index++) mkdir(path.join(root, ...parts.slice(0, index)));
}

function inventory(root) {
  const files = []; const directories = []; let total = 0; let entries = 0;
  function visit(relative, depth) {
    if (depth > 40) throw new Error('Managed tree depth limit exceeded');
    const directory = path.join(root, relative);
    const before = inspect(directory);
    if (!before.stat.isDirectory()) throw new Error('Managed generation is not a directory');
    const handle = fs.opendirSync(directory);
    try {
      for (let item = handle.readSync(); item !== null; item = handle.readSync()) {
        if (++entries > 12000) throw new Error('Managed tree entry limit exceeded');
        const name = relative ? `${relative}/${item.name}` : item.name;
        validateRelativePath(name);
        const stat = inspect(path.join(root, name)).stat;
        if (stat.isDirectory()) { directories.push(name); visit(name, depth + 1); }
        else {
          const bytes = read(path.join(root, name));
          total += bytes.length;
          if (total > MAX_BYTES) throw new Error('Managed tree byte limit exceeded');
          files.push({ path: name, digest: hash(bytes), bytes: bytes.length });
        }
      }
      recheck(before.chain);
    } finally { handle.closeSync(); }
  }
  visit('', 0);
  return { files, directories };
}

// Remove only a previously verified private staging tree, never a user root.
function removeTree(root, expected) {
  const observed = inventory(root);
  if (stableStringify(observed) !== stableStringify(expected)) throw new Error('Managed staging tree changed before cleanup');
  for (const file of observed.files) {
    const absolute = path.join(root, file.path);
    if (hash(read(absolute)) !== file.digest) throw new Error('Managed staging file changed before cleanup');
    fs.unlinkSync(absolute);
  }
  for (const directory of [...observed.directories].sort((a, b) => b.length - a.length)) fs.rmdirSync(path.join(root, directory));
  fs.rmdirSync(root);
  syncDirectory(path.dirname(root));
}

module.exports = { atomicJson, ensureParents, hash, inspect, inventory, jsonBytes, mkdir,
  pathSegments, read, readJson, recheck, removeTree, syncDirectory, writeExclusive };
