'use strict';

const fs = require('fs');
const os = require('os');
const path = require('path');
const crypto = require('crypto');
const { spawnSync } = require('child_process');

const MAX_AUX_BYTES = 16 * 1024 ** 2;
const MAX_DISK_BYTES = 8 * 1024 ** 4;
const SOURCE = path.join(__dirname, 'lume-clone.swift');
const PINNED_LUME_VERSION = '0.5.1';
const BLOCKED = new Set(['sessions.json', '.provisioning', 'resize.lock.json']);
const hash = bytes => crypto.createHash('sha256').update(bytes).digest('hex');

function assertPrivateDirectory(directory) {
  const info = fs.lstatSync(directory);
  if (!info.isDirectory() || info.isSymbolicLink() || info.uid !== process.getuid() || (info.mode & 0o077)) {
    throw new Error('Untrusted helper cache');
  }
}

function invoke(executable, args, timeout) {
  const result = spawnSync(executable, args, {
    encoding: 'utf8', timeout, killSignal: 'SIGKILL', maxBuffer: 65536, shell: false,
    env: { PATH: '/usr/bin:/bin:/usr/sbin:/sbin', HOME: os.homedir(), LC_ALL: 'C', LANG: 'C' },
  });
  if (result.error || result.signal || result.status !== 0) throw new Error('Helper operation failed');
  return result.stdout;
}

function helperIdentity(binary) {
  const info = fs.lstatSync(binary);
  if (!info.isFile() || info.isSymbolicLink() || info.uid !== process.getuid() || (info.mode & 0o077) || info.size > 16 * 1024 ** 2) {
    throw new Error('Untrusted helper binary');
  }
  return hash(fs.readFileSync(binary));
}

function compileHelper() {
  const source = fs.readFileSync(SOURCE);
  const digest = hash(Buffer.concat([source, Buffer.from(`\n${process.arch}\n${PINNED_LUME_VERSION}`)]));
  const cache = `/private/tmp/ecc-lume-clone-${process.getuid()}-${digest}`;
  try { fs.mkdirSync(cache, { mode: 0o700 }); } catch (error) { if (error.code !== 'EEXIST') throw error; }
  assertPrivateDirectory(cache);
  const binary = path.join(cache, 'helper');
  const record = path.join(cache, 'artifact.json');
  if (fs.existsSync(binary) && fs.existsSync(record)) {
    const metadata = JSON.parse(fs.readFileSync(record, 'utf8'));
    if (metadata.source_digest !== digest || metadata.binary_digest !== helperIdentity(binary)) throw new Error('Helper cache integrity failure');
    return Object.freeze({ binary, digest: metadata.binary_digest });
  }
  const staging = fs.mkdtempSync(path.join(cache, 'build-'));
  try {
    const snapshot = path.join(staging, 'source.swift');
    fs.writeFileSync(snapshot, source, { mode: 0o600, flag: 'wx' });
    const output = path.join(staging, 'helper');
    invoke('/usr/bin/xcrun', ['swiftc', '-O', '-framework', 'Virtualization', snapshot, '-o', output], 60_000);
    fs.chmodSync(output, 0o700);
    const binaryDigest = helperIdentity(output);
    fs.renameSync(output, binary);
    fs.writeFileSync(record, JSON.stringify({ source_digest: digest, binary_digest: binaryDigest }), { mode: 0o600 });
    return Object.freeze({ binary, digest: binaryDigest });
  } finally {
    fs.rmSync(staging, { recursive: true, force: true });
  }
}

function existingDirectory(directory) {
  if (typeof directory !== 'string' || !path.isAbsolute(directory) || directory.includes('\0') || fs.realpathSync(directory) !== directory) {
    throw new Error('Invalid or symlinked directory');
  }
  const info = fs.lstatSync(directory);
  if (!info.isDirectory() || info.isSymbolicLink()) throw new Error('Invalid directory');
  return info;
}

function validatePaths(seedPath, destPath) {
  const source = existingDirectory(seedPath);
  if (typeof destPath !== 'string' || !path.isAbsolute(destPath) || destPath.includes('\0') ||
      !/^ecc-(sandbox|explore|fabric)-lume-[a-zA-Z0-9-]+$/.test(path.basename(destPath)) || path.normalize(destPath) !== destPath || fs.existsSync(destPath)) {
    throw new Error('Invalid or occupied destination');
  }
  const parent = existingDirectory(path.dirname(destPath));
  if (source.dev !== parent.dev) throw new Error('Cross-device clone unsupported');
  const entries = fs.readdirSync(seedPath);
  if (entries.length > 64 || !['disk.img', 'nvram.bin', 'config.json'].every(name => entries.includes(name))) throw new Error('Invalid seed contents');
  let auxiliaryBytes = 0;
  for (const name of entries) {
    if (BLOCKED.has(name)) throw new Error('Source state is unsafe to clone');
    const file = fs.lstatSync(path.join(seedPath, name));
    if (!file.isFile() || file.isSymbolicLink() || !Number.isSafeInteger(file.size) || file.size < 0 ||
        file.size > (name === 'disk.img' ? MAX_DISK_BYTES : name === 'nvram.bin' ? 64 * 1024 ** 2 : MAX_AUX_BYTES)) throw new Error('Unsupported seed entry');
    if (name !== 'disk.img') auxiliaryBytes += file.size;
  }
  if (auxiliaryBytes > 80 * 1024 ** 2) throw new Error('Oversized seed metadata');
  return Object.freeze({ sourceDevice: source.dev, sourceInode: source.ino, parentDevice: parent.dev, parentInode: parent.ino });
}

function verifyCompatibility(options) {
  // Match the lifecycle runner's PATH lookup, without invoking a shell.
  const requested = options.lumeExecutable || 'lume';
  const candidates = path.isAbsolute(requested) ? [requested] : requested === 'lume'
    ? (process.env.PATH || '').split(path.delimiter).map(directory => path.resolve(directory || '.', requested)) : [];
  const executable = candidates.find(candidate => {
    try { fs.accessSync(candidate, fs.constants.X_OK); return fs.statSync(candidate).isFile(); } catch { return false; }
  });
  if (typeof executable !== 'string' || !path.isAbsolute(executable) || !fs.statSync(executable).isFile()) throw new Error('Lume executable unavailable');
  const run = options.run || spawnSync;
  const settings = { encoding: 'utf8', shell: false, timeout: 2000, maxBuffer: 65536 };
  const version = run(executable, ['--version'], settings);
  if (version.error || version.signal || version.status !== 0 || typeof version.stdout !== 'string' || version.stdout.trim() !== PINNED_LUME_VERSION) throw new Error('Lume version unsupported');
  const pressure = run('/usr/sbin/sysctl', ['-n', 'kern.memorystatus_vm_pressure_level'], settings);
  if (pressure.error || pressure.signal || pressure.status !== 0 || typeof pressure.stdout !== 'string' || pressure.stdout.trim() !== '1') throw new Error('Compilation refused under unknown or elevated memory pressure');
}

function checkedStopped(callback) {
  if (typeof callback !== 'function' || callback() !== true) throw new Error('Source stopped state unverified');
}

function denied(code, message, ownership = {}) {
  return Object.freeze({ ok: false, code, message, copy_method: 'clonefile-required', owned_destination: false, cleanup_pass: true, ...ownership });
}
function fail(receipt) {
  const error = new Error(receipt.message);
  error.receipt = receipt;
  throw error;
}
function executeClone(helper, seedPath, destPath, identity) {
  const expected = [identity.sourceDevice, identity.sourceInode, identity.parentDevice, identity.parentInode].map(String);
  const result = spawnSync(helper.binary, ['clone', seedPath, destPath, ...expected], {
    encoding: 'utf8', timeout: 30_000, killSignal: 'SIGKILL', maxBuffer: 65536, shell: false,
    env: { PATH: '/usr/bin:/bin:/usr/sbin:/sbin', HOME: os.homedir(), LC_ALL: 'C', LANG: 'C' },
  });
  return validateCloneReceipt(result);
}
function validateCloneReceipt(result) {
  let receipt;
  try { receipt = JSON.parse(result.stdout); } catch { receipt = null; }
  if (result.error || result.signal || !receipt || typeof receipt.owned_destination !== 'boolean' ||
      !(receipt.cleanup_pass === null || typeof receipt.cleanup_pass === 'boolean') || receipt.copy_method !== 'clonefile-required') {
    fail(denied('lume_cow_unverified', 'Clone helper was interrupted or returned incomplete evidence. Inspect the destination; ownership could not be verified.', { cleanup_pass: false }));
  }
  if (result.status !== 0 || receipt.ok !== true) {
    fail(denied('lume_cow_failed', 'Forced copy-on-write cloning failed without regular-copy fallback.', { owned_destination: receipt.owned_destination, cleanup_pass: receipt.cleanup_pass }));
  }
  if (receipt.owned_destination !== true || receipt.cleanup_pass !== null) {
    fail(denied('lume_cow_unverified', 'Clone helper returned inconsistent ownership evidence. Inspect the destination before retrying.', { cleanup_pass: false }));
  }
  return Object.freeze({ ok: true, code: 'lume_cow_cloned', message: 'VM files cloned with fresh machine and network identities; full-copy fallback was disabled.', copy_method: 'clonefile-required', owned_destination: true, cleanup_pass: null });
}

// ECC-owned compatibility optimization for the pinned Lume version. Unsupported
// preparation keeps the caller's full-copy disk budget. A prepared operation
// never falls back to copying and never starts a VM.
function prepareLumeClone(seedPath, destPath, options = {}) {
  const unavailable = (message, reason = 'unsupported_platform') => Object.freeze({
    supported: false, cloneBytes: null, code: 'lume_cow_unavailable', reason, message,
    clone: () => fail(denied('lume_cow_unavailable', message)),
  });
  if ((options.platform || process.platform) !== 'darwin') return unavailable('Forced copy-on-write cloning requires macOS. Keep the full-copy disk budget.');
  let identity;
  let helper;
  let phase = 'source_state_unverified';
  try {
    checkedStopped(options.verifySourceStopped);
    phase = 'seed_layout_invalid';
    identity = validatePaths(seedPath, destPath);
    phase = 'lume_compatibility_unverified';
    verifyCompatibility(options);
    phase = 'helper_build_failed';
    helper = compileHelper();
    phase = 'cow_probe_failed';
    const proof = JSON.parse(invoke(helper.binary, ['probe', path.dirname(destPath)], 5_000));
    if (proof.ok !== true || proof.copy_method !== 'clonefile-required') throw new Error('Clone capability unproven');
  } catch {
    return unavailable(`Forced copy-on-write cloning could not be verified (${phase}). Keep the full-copy disk budget; check the stopped seed, storage, Lume version, memory pressure, and Xcode command-line tools.`, phase);
  }
  let consumed = false;
  return Object.freeze({
    supported: true, cloneBytes: 0, code: 'lume_cow_ready',
    message: 'Per-file copy-on-write cloning is verified on the destination volume; full-copy fallback is disabled.',
    clone() {
      if (consumed) fail(denied('lume_cow_consumed', 'This prepared clone operation has already been consumed.'));
      consumed = true;
      try {
        checkedStopped(options.verifySourceStopped);
        const current = validatePaths(seedPath, destPath);
        if (JSON.stringify(current) !== JSON.stringify(identity) || helperIdentity(helper.binary) !== helper.digest) throw new Error('Clone inputs changed');
        return executeClone(helper, seedPath, destPath, identity);
      } catch (error) {
        if (error.receipt) throw error;
        fail(denied('lume_cow_failed', 'Forced copy-on-write cloning failed validation before destination creation. No regular-copy fallback was attempted.'));
      }
    },
  });
}

module.exports = { prepareLumeClone, validateCloneReceipt };
