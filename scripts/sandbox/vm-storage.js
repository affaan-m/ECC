'use strict';

const fs = require('fs');
const os = require('os');
const path = require('path');
const { spawnSync } = require('child_process');

function storageError(message) {
  return Object.assign(new Error(`Cannot verify VM destination storage: ${message}`), {
    code: 'HOST_STORAGE_UNKNOWN',
  });
}

function hasControlCharacters(value) {
  return [...value].some(character => character.charCodeAt(0) < 32 || character.charCodeAt(0) === 127);
}

function absoluteDirectory(value, home, expandTilde = false) {
  if (typeof value !== 'string' || !value || hasControlCharacters(value)) {
    throw storageError('storage path is missing or malformed');
  }
  const expanded = expandTilde && value.startsWith('~/')
    ? path.join(home, value.slice(2)) : value;
  if (!path.isAbsolute(expanded)) throw storageError('storage path must be absolute');
  try {
    const canonical = fs.realpathSync.native(expanded);
    if (!fs.statSync(canonical).isDirectory()) throw new Error('not a directory');
    return canonical;
  } catch {
    throw storageError('destination directory is unavailable; prepare the configured VM storage before retrying');
  }
}

function lumeDestination(options, home) {
  let result;
  try {
    result = (options.run || spawnSync)('lume', ['config', 'get'], {
      encoding: 'utf8', shell: false, windowsHide: true,
      timeout: 5_000, maxBuffer: 64 * 1024,
      env: options.env || process.env,
      ...(options.cwd ? { cwd: options.cwd } : {}),
    });
  } catch {
    throw storageError('Lume effective configuration could not be read');
  }
  if (!result || result.error || result.status !== 0) {
    throw storageError('Lume effective configuration could not be read');
  }
  const text = String(result.stdout || '');
  if (Buffer.byteLength(text) > 64 * 1024) throw storageError('Lume configuration output is too large');
  const lines = text.split(/\r?\n/).filter(line => line.startsWith('Default VM storage:'));
  const match = lines.length === 1 && lines[0].match(/^Default VM storage: [A-Za-z0-9_-]+ \((.+)\)$/);
  if (!match) throw storageError('Lume did not report one unambiguous default storage location');
  return absoluteDirectory(match[1], home, true);
}

// The source seed's location is deliberately not the clone destination.
// Lume 0.5.1 uses the effective default when --dest-storage is absent. Query its
// own settings reader because Settings.swift uses a bespoke YAML-like parser:
// https://github.com/trycua/cua/blob/lume-v0.5.1/libs/lume/src/Commands/Config.swift
// https://github.com/trycua/cua/blob/lume-v0.5.1/libs/lume/src/FileSystem/Home.swift
// Lima instances live below LIMA_HOME; Tart local instances below TART_HOME/vms:
// https://lima-vm.io/docs/dev/internals/
// https://tart.run/faq/#vm-location-on-disk
function vmStoragePath(backend, _seed, _seedResult, options = {}) {
  const home = options.home || os.homedir();
  const env = options.env || process.env;
  if (!path.isAbsolute(home)) throw storageError('host home must be absolute');
  if (backend === 'lume') return lumeDestination(options, home);
  const variable = { lima: 'LIMA_HOME', tart: 'TART_HOME' }[backend];
  if (!variable) throw storageError(`unsupported VM backend ${backend}`);
  const configured = Object.prototype.hasOwnProperty.call(env, variable);
  const base = configured ? env[variable] : path.join(home, `.${backend}`);
  if (typeof base !== 'string' || !path.isAbsolute(base) || hasControlCharacters(base)) {
    throw storageError(`${variable} must be an explicit absolute directory`);
  }
  return absoluteDirectory(backend === 'tart' ? path.join(base, 'vms') : base, home);
}

function seedMetadata(seed, result) {
  if (!result || result.error || result.status !== 0 || typeof result.stdout !== 'string'
      || Buffer.byteLength(result.stdout) > 65_536) throw storageError('seed metadata is unavailable');
  const lines = result.stdout.trim().split(/\r?\n/);
  for (let index = 0; index < lines.length; index += 1) {
    if (!['[', '{'].includes(lines[index].trimStart()[0])) continue;
    let parsed;
    try { parsed = JSON.parse(lines.slice(index).join('\n')); } catch { continue; }
    const values = Array.isArray(parsed) ? parsed : [parsed];
    const item = values[0];
    if (values.length !== 1 || !item || typeof item !== 'object'
        || (item.name !== undefined && item.name !== seed)) {
      throw storageError('seed metadata does not identify one matching VM');
    }
    return item;
  }
  throw storageError('seed metadata is unreadable');
}

function metadataDiskBytes(backend, item) {
  // Tart Get.Disk truncates disk image bytes to decimal GB. Add a full GB to
  // cover the truncated fraction. Lume and Lima publish byte counts directly.
  // https://github.com/cirruslabs/tart/blob/2.32.1/Sources/tart/VMDirectory.swift
  const bytes = { lume: item.diskSize?.total, lima: item.disk,
    tart: Number.isSafeInteger(item.Disk) && item.Disk >= 0 ? (item.Disk + 1) * 1000 ** 3 : null }[backend];
  if (!Number.isSafeInteger(bytes) || bytes <= 0) throw storageError('logical seed disk size is unknown');
  return bytes;
}

function logicalTreeBytes(root) {
  let count = 0;
  let total = 0;
  const started = Date.now();
  const visit = (entryPath, depth) => {
    count += 1;
    if (count > 4096 || depth > 8 || Date.now() - started > 2_000) {
      throw storageError('seed storage inventory exceeds the bounded inspection limit');
    }
    const before = fs.lstatSync(entryPath);
    if (before.isSymbolicLink()) throw storageError('seed storage contains an unsupported symbolic link');
    if (before.isDirectory()) {
      const entries = fs.readdirSync(entryPath);
      if (entries.length + count > 4096) throw storageError('seed storage has too many entries');
      for (const name of entries) visit(path.join(entryPath, name), depth + 1);
    } else if (before.isFile()) {
      if (!Number.isSafeInteger(before.size) || before.size < 0) throw storageError('seed file size is invalid');
      total += before.size;
      if (!Number.isSafeInteger(total)) throw storageError('seed storage size exceeds supported limits');
    } else {
      throw storageError('seed storage contains an unsupported special file');
    }
    const after = fs.lstatSync(entryPath);
    if (before.dev !== after.dev || before.ino !== after.ino || before.size !== after.size
        || before.mtimeMs !== after.mtimeMs || before.ctimeMs !== after.ctimeMs) {
      throw storageError('seed storage changed during inspection');
    }
  };
  try { visit(root, 0); } catch (error) {
    if (error.code === 'HOST_STORAGE_UNKNOWN') throw error;
    throw storageError('stopped seed files could not be inspected');
  }
  return total;
}

// Budget a possible full logical seed copy before cloning. Lume 0.5.1 silently
// falls back to a regular copy if clonefile fails, so APFS or allocated-block
// size alone cannot justify a lower budget. Caller adds host disk headroom.
function vmCloneBudget(backend, seed, seedResult, options = {}) {
  if (typeof seed !== 'string' || !/^[A-Za-z0-9][A-Za-z0-9._-]{0,119}$/.test(seed)) {
    throw storageError('seed name is invalid');
  }
  const metadata = seedMetadata(seed, seedResult);
  const minimum = metadataDiskBytes(backend, metadata);
  const pinned = Object.prototype.hasOwnProperty.call(options, 'storagePath');
  const storage = pinned
    ? absoluteDirectory(options.storagePath, options.home || os.homedir())
    : vmStoragePath(backend, seed, seedResult, options);
  if (pinned && storage !== options.storagePath) throw storageError('pinned storage changed canonical identity');
  const bytes = logicalTreeBytes(path.join(storage, seed));
  return Math.max(minimum, bytes);
}

// Bind backend operations to the directory whose capacity was checked. Remote
// SSH command tokens after -- belong to the guest and must remain unchanged.
function withLumeStorage(argv, storagePath) {
  if (typeof storagePath !== 'string' || !path.isAbsolute(storagePath)
      || hasControlCharacters(storagePath)) throw storageError('Lume storage must be an absolute path');
  if (!Array.isArray(argv) || !argv.length || argv.some(value => typeof value !== 'string')) {
    throw storageError('Lume arguments are invalid');
  }
  const [command] = argv;
  if (['config', 'ls'].includes(command)) return [...argv];
  if (!['clone', 'get', 'set', 'run', 'stop', 'delete', 'ssh'].includes(command)) {
    throw storageError('Lume command has no verified storage binding');
  }
  const separator = argv.indexOf('--');
  const boundary = separator === -1 ? argv.length : separator;
  if (argv.slice(0, boundary).some(value => /^--(?:source-|dest-)?storage(?:=|$)/.test(value))) {
    throw storageError('Lume arguments already contain a storage override');
  }
  const binding = command === 'clone'
    ? ['--source-storage', storagePath, '--dest-storage', storagePath]
    : ['--storage', storagePath];
  return [...argv.slice(0, boundary), ...binding, ...argv.slice(boundary)];
}

module.exports = { vmCloneBudget, vmStoragePath, withLumeStorage };
