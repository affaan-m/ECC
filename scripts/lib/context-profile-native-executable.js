'use strict';

const crypto = require('node:crypto');
const fs = require('node:fs');
const path = require('node:path');
const { createRequire } = require('node:module');
const io = require('./context-profile-store-fs');
const cache = new Map();
const MAX_BYTES = 512 * 1024 * 1024;

function nativeFormat(header) {
  const hex = header.subarray(0, 4).toString('hex');
  return ['7f454c46', 'cffaedfe', 'cefaedfe', 'feedfacf', 'feedface', 'cafebabe', 'bebafeca'].includes(hex)
    || header.subarray(0, 2).toString() === 'MZ';
}

function resolveExecutable(command) {
  const candidate = path.isAbsolute(command) ? command : (process.env.PATH || '').split(path.delimiter)
    .filter(directory => path.isAbsolute(directory)).map(directory => path.join(directory, process.platform === 'win32' ? 'codex.exe' : 'codex'))
    .find(file => fs.existsSync(file));
  if (!candidate) throw new Error('Native Codex executable was not found');
  let executable = fs.realpathSync(candidate);
  const before = io.inspect(executable);
  if (!before.stat.isFile() || before.stat.nlink !== 1 || before.stat.size < 4 || before.stat.size > MAX_BYTES) {
    throw new Error('Native executable must be a bounded regular file with one link');
  }
  const header = Buffer.alloc(4);
  const fd = fs.openSync(executable, fs.constants.O_RDONLY | (fs.constants.O_NOFOLLOW || 0) | (fs.constants.O_NONBLOCK || 0));
  try {
    const opened = fs.fstatSync(fd);
    if (opened.dev !== before.stat.dev || opened.ino !== before.stat.ino || !opened.isFile()) throw new Error('Native executable identity changed');
    fs.readSync(fd, header, 0, 4, 0); io.recheck(before.chain);
  } finally { fs.closeSync(fd); }
  if (!nativeFormat(header)) {
    // Supported npm distribution: bind its platform binary, never only its JS shim.
    if (path.basename(executable) !== 'codex.js') throw new Error('Native adapter requires a native Codex executable');
    const packageName = `@openai/codex-${process.platform}-${process.arch}`;
    let manifest;
    try { manifest = createRequire(executable).resolve(`${packageName}/package.json`); }
    catch { throw new Error('Native Codex npm platform package is unavailable'); }
    const targets = { 'linux/arm64': 'aarch64-unknown-linux-musl', 'linux/x64': 'x86_64-unknown-linux-musl',
      'darwin/arm64': 'aarch64-apple-darwin', 'darwin/x64': 'x86_64-apple-darwin',
      'win32/arm64': 'aarch64-pc-windows-msvc', 'win32/x64': 'x86_64-pc-windows-msvc' };
    const target = targets[`${process.platform}/${process.arch}`];
    if (!target) throw new Error('Unsupported native Codex platform');
    executable = fs.realpathSync(path.join(path.dirname(manifest), 'vendor', target, 'bin', process.platform === 'win32' ? 'codex.exe' : 'codex'));
  }
  return fingerprintExecutable(executable);
}

function fingerprintExecutable(executable) {
  const before = io.inspect(executable);
  if (!before.stat.isFile() || before.stat.nlink !== 1 || before.stat.size < 4 || before.stat.size > MAX_BYTES) {
    throw new Error('Native executable must be a bounded regular file with one link');
  }
  const identity = [before.stat.dev, before.stat.ino, before.stat.mode, before.stat.size, before.stat.mtimeMs, before.stat.ctimeMs].join(':');
  const cached = cache.get(executable);
  if (cached?.identity === identity) return cached.value;
  const fd = fs.openSync(executable, fs.constants.O_RDONLY | (fs.constants.O_NOFOLLOW || 0) | (fs.constants.O_NONBLOCK || 0));
  try {
    const opened = fs.fstatSync(fd);
    if (opened.ino !== before.stat.ino || opened.dev !== before.stat.dev || opened.size !== before.stat.size) throw new Error('Native executable changed during verification');
    const hash = crypto.createHash('sha256'); const bytes = Buffer.alloc(512 * 1024); let total = 0;
    for (let count = fs.readSync(fd, bytes); count; count = fs.readSync(fd, bytes)) {
      if (total === 0 && !nativeFormat(bytes.subarray(0, count))) throw new Error('Native executable format is unsupported');
      total += count;
      if (total > MAX_BYTES) throw new Error('Native executable exceeds the byte bound');
      hash.update(bytes.subarray(0, count));
    }
    const after = fs.fstatSync(fd); io.recheck(before.chain);
    if (total !== before.stat.size || after.mtimeMs !== before.stat.mtimeMs || after.ctimeMs !== before.stat.ctimeMs
      || after.size !== before.stat.size) throw new Error('Native executable changed during verification');
    const value = { path: executable, bytes: total, digest: hash.digest('hex') };
    cache.set(executable, { identity, value });
    return value;
  } finally { fs.closeSync(fd); }
}

module.exports = { fingerprintExecutable, resolveExecutable };
