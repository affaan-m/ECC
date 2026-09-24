'use strict';

const crypto = require('crypto');
const fs = require('fs');
const https = require('https');
const os = require('os');
const path = require('path');
const zlib = require('zlib');

const REGISTRY_ORIGIN = 'https://registry.nasiko.dev';
const REPOSITORY = 'nasiko/nasiko';
const SOURCE_URL = 'https://github.com/Nasiko-Labs/nasiko';
const LICENSE = 'Apache-2.0';
const METADATA_FILENAME = '.ecc-nasiko-install.json';
const MAX_MANIFEST_BYTES = 1024 * 1024;
const MAX_ARCHIVE_BYTES = 100 * 1024 * 1024;
const MAX_BINARY_BYTES = 64 * 1024 * 1024;
const MAX_METADATA_BYTES = 64 * 1024;
const SHA256_PATTERN = /^sha256:[a-f0-9]{64}$/;

const QUALIFIED_RELEASES = Object.freeze({
  'v0.1.0': Object.freeze({
    'linux/amd64': Object.freeze({ manifestDigest: 'sha256:0df748a40f3d714b6b6a3376a1d13a224c05bdb8d1628f31ace5a7bee8ceb9de', binaryDigest: 'sha256:94a2bcab2d3832257e0111480bb7c3dcac81d63a7ae9bac53206a92c0957ee0f' }),
    'linux/arm64': Object.freeze({ manifestDigest: 'sha256:655021a129c7df4621a80d16ea4eab38018530bfe9a20da646641d9f4ac5c249', binaryDigest: 'sha256:85f9fa5cfbed6c276fce6df2d71e9d0c66d7d8e8d46a40297464833d38db7a7e' }),
    'darwin/amd64': Object.freeze({ manifestDigest: 'sha256:b4188482621efd7da5a2ab630f653665ab5f80b9aceae448b6bb5fc93e003f06', binaryDigest: 'sha256:ed6232e0bb96a2dcfd86d3c25f86021091600d52f09250403a54528bfe8100a3' }),
    'darwin/arm64': Object.freeze({ manifestDigest: 'sha256:ce7e54fa19f989a5d125c4409b3587ca9503bb5a07bc5ff223c60e0fbad437f0', binaryDigest: 'sha256:3c60f862b04eea1b9a633593b39f1a443d9ca2123cf3edfd150d313e95f3894b' }),
    'windows/amd64': Object.freeze({ manifestDigest: 'sha256:0760fe1fc98e8fedb66796aaf891a1de9268af1338c5e88b949656fda5d9f045', binaryDigest: 'sha256:0f57672d24fc3c70e4cbbf22864e65b35b9978ddaae3793803841536e682929b' }),
  }),
});

function normalizePlatform(platform = process.platform, architecture = process.arch) {
  const osName = platform === 'win32' ? 'windows' : platform;
  if (!['linux', 'darwin', 'windows'].includes(osName)) throw new Error(`Unsupported platform: ${platform}`);
  const arch = architecture === 'x64' ? 'amd64' : architecture;
  if (!['amd64', 'arm64'].includes(arch)) throw new Error(`Unsupported architecture: ${architecture}`);
  if (osName === 'windows' && arch !== 'amd64') throw new Error(`Unsupported architecture for Windows: ${architecture}`);
  return { os: osName, arch, binaryName: osName === 'windows' ? 'nasiko.exe' : 'nasiko' };
}

function getQualifiedRelease(version, platform = process.platform, architecture = process.arch) {
  if (!/^v\d+\.\d+\.\d+$/.test(String(version || ''))) {
    throw new Error('Nasiko installation requires a pinned version such as v0.1.0; latest is not allowed.');
  }
  const normalized = normalizePlatform(platform, architecture);
  const qualification = QUALIFIED_RELEASES[version]?.[`${normalized.os}/${normalized.arch}`];
  if (!qualification) throw new Error(`Nasiko ${version} is not qualified for ${normalized.os}/${normalized.arch}.`);
  return { version, ...normalized, ...qualification, license: LICENSE, sourceUrl: SOURCE_URL };
}

function digestBytes(bytes) {
  return `sha256:${crypto.createHash('sha256').update(bytes).digest('hex')}`;
}

function assertDigest(bytes, expectedDigest, label) {
  if (!SHA256_PATTERN.test(expectedDigest)) throw new Error(`${label} has an invalid expected digest.`);
  const actual = digestBytes(bytes);
  if (actual !== expectedDigest) throw new Error(`${label} digest mismatch: expected ${expectedDigest}, got ${actual}.`);
}

function validateManifest(bytes) {
  let manifest;
  try { manifest = JSON.parse(bytes.toString('utf8')); } catch (_error) { throw new Error('Nasiko manifest is not valid JSON.'); }
  if (manifest.schemaVersion !== 2 || !Array.isArray(manifest.layers) || manifest.layers.length !== 1) {
    throw new Error('Nasiko manifest must contain exactly one OCI layer.');
  }
  const layer = manifest.layers[0];
  if (layer.mediaType !== 'application/gzip' || !SHA256_PATTERN.test(layer.digest)) {
    throw new Error('Nasiko manifest layer is not a qualified gzip artifact.');
  }
  if (!Number.isSafeInteger(layer.size) || layer.size <= 0 || layer.size > MAX_ARCHIVE_BYTES) {
    throw new Error('Nasiko manifest layer size is outside the allowed range.');
  }
  return { digest: layer.digest, size: layer.size };
}

function readTarString(block, offset, length) {
  return block.subarray(offset, offset + length).toString('utf8').replace(/\0.*$/, '');
}

function readTarOctal(block, offset, length) {
  const field = block.subarray(offset, offset + length).toString('ascii');
  const match = /^ *([0-7]+)[ \0]*$/.exec(field);
  if (!match) throw new Error('Unsafe Nasiko archive: invalid tar size field.');
  const size = Number.parseInt(match[1], 8);
  if (!Number.isSafeInteger(size) || size < 0) {
    throw new Error('Unsafe Nasiko archive: invalid tar size field.');
  }
  return size;
}

function extractQualifiedTarGzip(archiveBytes, expectedName) {
  let tar;
  try { tar = zlib.gunzipSync(archiveBytes, { maxOutputLength: MAX_BINARY_BYTES + 2048 }); }
  catch (_error) { throw new Error('Nasiko archive is invalid or exceeds the decompressed size limit.'); }
  let offset = 0;
  let binary = null;
  let terminated = false;
  while (offset < tar.length) {
    if (offset + 512 > tar.length) throw new Error('Unsafe Nasiko archive: truncated tar header.');
    const header = tar.subarray(offset, offset + 512);
    if (header.every(byte => byte === 0)) {
      const terminatorEnd = offset + 1024;
      if (
        terminatorEnd > tar.length
        || !tar.subarray(offset + 512, terminatorEnd).every(byte => byte === 0)
        || !tar.subarray(terminatorEnd).every(byte => byte === 0)
      ) {
        throw new Error('Unsafe Nasiko archive: incomplete terminator or nonzero trailing data.');
      }
      terminated = true;
      break;
    }
    const name = readTarString(header, 0, 100);
    const prefix = readTarString(header, 345, 155);
    const type = String.fromCharCode(header[156] || 48);
    const size = readTarOctal(header, 124, 12);
    const start = offset + 512;
    const end = start + size;
    const paddedEnd = start + Math.ceil(size / 512) * 512;
    if (!Number.isSafeInteger(end) || paddedEnd > tar.length) throw new Error('Nasiko archive is truncated.');
    const payload = tar.subarray(start, end);
    if (!tar.subarray(end, paddedEnd).every(byte => byte === 0)) {
      throw new Error('Unsafe Nasiko archive: nonzero tar padding.');
    }
    const isBinary = !prefix && name === expectedName && (type === '0' || type === '\0');
    const isAppleDouble = !prefix && name === `._${expectedName}` && type === '0' && size <= 1024 * 1024;
    const isPaxMetadata = !prefix && name === `PaxHeader/${expectedName}` && type === 'x' && size <= 64 * 1024
      && !/(?:^|\n)(?:path|linkpath)=/i.test(payload.toString('utf8'));
    if (isBinary && !binary && size > 0 && size <= MAX_BINARY_BYTES) binary = Buffer.from(payload);
    else if (!isAppleDouble && !isPaxMetadata) throw new Error('Unsafe Nasiko archive: expected exactly one bounded regular binary file.');
    offset = paddedEnd;
  }
  if (!terminated) throw new Error('Unsafe Nasiko archive: missing complete tar terminator.');
  if (!binary) throw new Error('Unsafe Nasiko archive: expected exactly one bounded regular binary file.');
  return binary;
}

function fetchBytes(url, options = {}) {
  const parsed = new URL(url);
  if (parsed.origin !== REGISTRY_ORIGIN || parsed.protocol !== 'https:') return Promise.reject(new Error('Nasiko download origin is not allowed.'));
  const maxBytes = options.maxBytes || MAX_ARCHIVE_BYTES;
  return new Promise((resolve, reject) => {
    const request = https.get(parsed, { headers: options.accept ? { Accept: options.accept } : {} }, response => {
      if (response.statusCode >= 300 && response.statusCode < 400) { response.resume(); reject(new Error('Nasiko registry redirects are not allowed.')); return; }
      if (response.statusCode !== 200) { response.resume(); reject(new Error(`Nasiko registry returned HTTP ${response.statusCode}.`)); return; }
      const chunks = [];
      let total = 0;
      response.on('data', chunk => {
        total += chunk.length;
        if (total > maxBytes) request.destroy(new Error('Nasiko registry response exceeded the size limit.'));
        else chunks.push(chunk);
      });
      response.on('end', () => resolve(Buffer.concat(chunks)));
      response.on('error', reject);
    });
    request.setTimeout(options.timeoutMs || 15000, () => request.destroy(new Error('Nasiko registry request timed out.')));
    request.on('error', reject);
  });
}

function defaultInstallDirectory(normalized, environment = process.env, homeDirectory = os.homedir()) {
  if (normalized.os === 'windows') {
    if (!environment.LOCALAPPDATA) throw new Error('LOCALAPPDATA is required on Windows.');
    return path.join(environment.LOCALAPPDATA, 'nasiko', 'bin');
  }
  return path.join(homeDirectory, '.local', 'bin');
}

function validateInstallDirectory(directory) {
  if (typeof directory !== 'string' || directory.includes('\0') || !path.isAbsolute(directory)) throw new Error('Nasiko install directory must be an absolute path.');
  if (/^(?:\\\\|\\\\\?\\|\\\\\.\\)/.test(directory)) throw new Error('Nasiko install directory must be on a local filesystem.');
  const resolved = path.resolve(directory);
  if (resolved === path.parse(resolved).root) throw new Error('Nasiko cannot install directly into a filesystem root.');
  let ancestor = resolved;
  while (!fs.existsSync(ancestor)) {
    const parent = path.dirname(ancestor);
    if (parent === ancestor) throw new Error('Nasiko install directory has no resolvable filesystem ancestor.');
    ancestor = parent;
  }
  const canonical = fs.realpathSync(ancestor);
  return path.join(canonical, path.relative(ancestor, resolved));
}

function assertPrivateInstallDirectory(directory) {
  const stats = fs.lstatSync(directory);
  if (!stats.isDirectory() || stats.isSymbolicLink()) throw new Error('Nasiko install directory must be a real directory, not a symlink.');
  if (process.platform !== 'win32') {
    if (typeof process.getuid === 'function' && stats.uid !== process.getuid()) throw new Error('Nasiko install directory must be owned by the current user.');
    if ((stats.mode & 0o022) !== 0) throw new Error('Nasiko install directory must not be group- or world-writable.');
  }
}

function metadataPathFor(executable) { return path.join(path.dirname(executable), METADATA_FILENAME); }

function readBoundedRegularFile(filePath, maximumBytes) {
  const noFollow = fs.constants.O_NOFOLLOW;
  const descriptor = fs.openSync(filePath, fs.constants.O_RDONLY | (noFollow || 0));
  try {
    const stats = fs.fstatSync(descriptor);
    if (!stats.isFile() || stats.size <= 0 || stats.size > maximumBytes) return null;
    if (!noFollow) {
      const pathStats = fs.lstatSync(filePath);
      if (pathStats.isSymbolicLink()
        || pathStats.dev !== stats.dev
        || pathStats.ino !== stats.ino
        || pathStats.birthtimeMs !== stats.birthtimeMs) {
        const error = new Error('Nasiko managed files must not be symbolic links or reparse points.');
        error.code = 'ELOOP';
        throw error;
      }
    }
    const bytes = Buffer.allocUnsafe(stats.size);
    let total = 0;
    while (total < bytes.length) {
      const count = fs.readSync(descriptor, bytes, total, bytes.length - total, total);
      if (count === 0) return null;
      total += count;
    }
    if (fs.fstatSync(descriptor).size !== stats.size) return null;
    return bytes;
  } finally { fs.closeSync(descriptor); }
}

function readMetadata(executable) {
  try {
    const bytes = readBoundedRegularFile(metadataPathFor(executable), MAX_METADATA_BYTES);
    return bytes ? JSON.parse(bytes.toString('utf8')) : null;
  }
  catch (_error) { return null; }
}

function inspectInstalledNasiko(executable, resolveRelease = getQualifiedRelease) {
  if (!executable) return { installed: false, qualified: false, version: null, executable: null };
  let binary;
  try { binary = readBoundedRegularFile(executable, MAX_BINARY_BYTES); }
  catch (error) {
    if (error.code === 'ENOENT') return { installed: false, qualified: false, version: null, executable };
    if (error.code === 'ELOOP') throw new Error('Nasiko executable must be a regular file, not a symlink.');
    throw error;
  }
  if (!binary) return { installed: true, qualified: false, version: null, executable, binaryDigest: null, metadataPath: metadataPathFor(executable) };
  const binaryDigest = digestBytes(binary);
  const metadata = readMetadata(executable);
  let release = null;
  try { if (metadata) release = resolveRelease(metadata.version, metadata.platform, metadata.architecture); } catch (_error) { release = null; }
  const qualified = Boolean(release
    && metadata.installedPath === executable
    && metadata.manifestDigest === release.manifestDigest
    && metadata.binaryDigest === release.binaryDigest
    && binaryDigest === release.binaryDigest
    && metadata.license === release.license
    && metadata.sourceUrl === release.sourceUrl);
  return { installed: true, qualified, version: qualified ? metadata.version : null, executable, binaryDigest, metadataPath: metadataPathFor(executable) };
}

function writeMetadataExclusive(metadataPath, metadata) {
  fs.writeFileSync(metadataPath, `${JSON.stringify(metadata, null, 2)}\n`, { mode: 0o600, flag: 'wx' });
}

function sameFileIdentity(left, right) {
  return left.dev === right.dev && left.ino === right.ino;
}

function processIsAlive(pid) {
  try {
    process.kill(pid, 0);
    return true;
  } catch (error) {
    return error.code !== 'ESRCH';
  }
}

function inspectLifecycleLock(lockPath, fileSystem) {
  const descriptor = fileSystem.openSync(lockPath, fs.constants.O_RDONLY | (fs.constants.O_NOFOLLOW || 0));
  try {
    const descriptorStats = fileSystem.fstatSync(descriptor, { bigint: true });
    if (!descriptorStats.isFile() || descriptorStats.size <= 0n || descriptorStats.size > 4096n) return null;
    const bytes = fileSystem.readFileSync(descriptor);
    const pathStats = fileSystem.lstatSync(lockPath);
    if (pathStats.isSymbolicLink() || !pathStats.isFile()) return null;
    let metadata;
    try { metadata = JSON.parse(bytes.toString('utf8')); } catch (_error) { return null; }
    if (
      !Number.isSafeInteger(metadata.pid)
      || metadata.pid <= 0
      || typeof metadata.startedAt !== 'string'
      || !Number.isFinite(Date.parse(metadata.startedAt))
    ) return null;
    return { metadata, stats: descriptorStats };
  } finally { fileSystem.closeSync(descriptor); }
}

function removeLockIfOwned(lockPath, expectedStats, fileSystem) {
  let descriptor;
  try {
    descriptor = fileSystem.openSync(lockPath, fs.constants.O_RDONLY | (fs.constants.O_NOFOLLOW || 0));
    const current = fileSystem.fstatSync(descriptor, { bigint: true });
    const pathStats = fileSystem.lstatSync(lockPath);
    if (!pathStats.isSymbolicLink() && pathStats.isFile() && current.isFile() && sameFileIdentity(current, expectedStats)) {
      fileSystem.closeSync(descriptor);
      descriptor = undefined;
      fileSystem.rmSync(lockPath, { force: true });
      return true;
    }
  } catch (error) {
    if (error.code !== 'ENOENT' && error.code !== 'ELOOP') throw error;
  } finally {
    if (descriptor !== undefined) fileSystem.closeSync(descriptor);
  }
  return false;
}

function createLifecycleLock(lockPath, fileSystem) {
  let descriptor;
  try {
    descriptor = fileSystem.openSync(lockPath, 'wx', 0o600);
    fileSystem.writeFileSync(descriptor, `${JSON.stringify({
      pid: process.pid,
      startedAt: new Date().toISOString(),
      token: crypto.randomBytes(16).toString('hex'),
    })}\n`);
    fileSystem.fsyncSync(descriptor);
  }
  catch (error) {
    if (descriptor !== undefined) {
      const ownedStats = fileSystem.fstatSync(descriptor, { bigint: true });
      try { fileSystem.closeSync(descriptor); } finally { removeLockIfOwned(lockPath, ownedStats, fileSystem); }
    }
    throw error;
  }
  const ownedStats = fileSystem.fstatSync(descriptor, { bigint: true });
  let released = false;
  return () => {
    if (released) return;
    released = true;
    try { fileSystem.closeSync(descriptor); } finally { removeLockIfOwned(lockPath, ownedStats, fileSystem); }
  };
}

function acquireLifecycleLock(installDirectory, fileSystem = fs, options = {}) {
  const lockPath = path.join(installDirectory, '.ecc-nasiko-lifecycle.lock');
  try {
    return createLifecycleLock(lockPath, fileSystem);
  } catch (error) {
    if (error.code !== 'EEXIST') throw error;
  }

  let existing;
  try { existing = inspectLifecycleLock(lockPath, fileSystem); }
  catch (error) {
    if (error.code === 'ENOENT') {
      try { return createLifecycleLock(lockPath, fileSystem); }
      catch (retryError) {
        if (retryError.code === 'EEXIST') {
          throw new Error(`Another Nasiko lifecycle operation won lock acquisition: ${lockPath}.`);
        }
        throw retryError;
      }
    }
    throw error;
  }
  const isProcessAlive = options.isProcessAlive || processIsAlive;
  if (!existing || isProcessAlive(existing.metadata.pid)) {
    throw new Error(`Another Nasiko lifecycle operation is already in progress; inspect ${lockPath} before recovering a stale lock.`);
  }
  if (!removeLockIfOwned(lockPath, existing.stats, fileSystem)) {
    throw new Error(`Nasiko lifecycle lock changed during stale-owner recovery: ${lockPath}.`);
  }
  try {
    return createLifecycleLock(lockPath, fileSystem);
  } catch (error) {
    if (error.code === 'EEXIST') {
      throw new Error(`Another Nasiko lifecycle operation won stale-lock recovery: ${lockPath}.`);
    }
    throw error;
  }
}

async function installNasiko(options = {}, dependencies = {}) {
  const version = options.version || 'v0.1.0';
  const base = getQualifiedRelease(version, dependencies.platform || process.platform, dependencies.arch || process.arch);
  const release = dependencies.releaseOverride ? { ...base, ...dependencies.releaseOverride } : base;
  const installDirectory = validateInstallDirectory(options.installDir || defaultInstallDirectory(release, dependencies.environment || process.env, dependencies.homeDirectory || os.homedir()));
  const destination = path.join(installDirectory, release.binaryName);
  const plan = { dryRun: Boolean(options.dryRun), version, platform: release.os, architecture: release.arch, manifestDigest: release.manifestDigest, binaryDigest: release.binaryDigest, registryOrigin: REGISTRY_ORIGIN, destination, license: release.license, sourceUrl: release.sourceUrl };
  if (options.dryRun) return plan;
  if (!options.yes) throw new Error('Nasiko installation requires explicit --yes consent.');
  fs.mkdirSync(installDirectory, { recursive: true, mode: 0o755 });
  assertPrivateInstallDirectory(installDirectory);
  const releaseLock = acquireLifecycleLock(installDirectory);
  const metadataPath = metadataPathFor(destination);
  let destinationOwned = false;
  let metadataOwned = false;
  try {
    const existing = inspectInstalledNasiko(destination);
    if (existing.installed) {
      if (existing.qualified && existing.version === version) return { ...plan, dryRun: false, installed: true, reused: true };
      throw new Error('An unqualified or incompatible Nasiko executable or receipt already exists at the destination.');
    }
    const retrieve = dependencies.fetchBytes || fetchBytes;
    const manifestBytes = await retrieve(`${REGISTRY_ORIGIN}/v2/${REPOSITORY}/manifests/${release.manifestDigest}`, { accept: 'application/vnd.oci.image.manifest.v1+json', maxBytes: MAX_MANIFEST_BYTES });
    assertDigest(manifestBytes, release.manifestDigest, 'Nasiko manifest');
    const layer = validateManifest(manifestBytes);
    const archiveBytes = await retrieve(`${REGISTRY_ORIGIN}/v2/${REPOSITORY}/blobs/${layer.digest}`, { maxBytes: MAX_ARCHIVE_BYTES });
    if (archiveBytes.length !== layer.size) throw new Error('Nasiko archive size mismatch.');
    assertDigest(archiveBytes, layer.digest, 'Nasiko archive');
    const binary = (dependencies.extractBinary || extractQualifiedTarGzip)(archiveBytes, release.binaryName);
    assertDigest(binary, release.binaryDigest, 'Nasiko binary');
    if (dependencies.beforePublish) dependencies.beforePublish(destination);
    const descriptor = fs.openSync(destination, 'wx', 0o700);
    destinationOwned = true;
    try {
      fs.writeFileSync(descriptor, binary);
      fs.fsyncSync(descriptor);
      if (fs.fstatSync(descriptor).size !== binary.length) throw new Error('Published Nasiko binary size mismatch.');
    } finally { fs.closeSync(descriptor); }
    const metadata = { version, platform: release.os, architecture: release.arch, manifestDigest: release.manifestDigest, artifactDigest: layer.digest, binaryDigest: release.binaryDigest, installedPath: destination, license: release.license, sourceUrl: release.sourceUrl };
    (dependencies.writeMetadata || writeMetadataExclusive)(metadataPath, metadata);
    metadataOwned = true;
    return { ...plan, dryRun: false, installed: true, reused: false, artifactDigest: layer.digest };
  } catch (error) {
    if (metadataOwned) fs.rmSync(metadataPath, { force: true });
    if (destinationOwned) fs.rmSync(destination, { force: true });
    throw error;
  } finally { releaseLock(); }
}

function uninstallNasiko(options = {}, dependencies = {}) {
  const version = options.version || 'v0.1.0';
  const release = getQualifiedRelease(version, dependencies.platform || process.platform, dependencies.arch || process.arch);
  const installDirectory = validateInstallDirectory(options.installDir || defaultInstallDirectory(release, dependencies.environment || process.env, dependencies.homeDirectory || os.homedir()));
  const destination = path.join(installDirectory, release.binaryName);
  const plan = { dryRun: Boolean(options.dryRun), version, destination };
  if (options.dryRun) return plan;
  if (!options.yes) throw new Error('Nasiko uninstall requires explicit --yes consent.');
  if (!fs.existsSync(installDirectory)) return { ...plan, dryRun: false, removed: false };
  assertPrivateInstallDirectory(installDirectory);
  const releaseLock = acquireLifecycleLock(installDirectory);
  const metadataPath = metadataPathFor(destination);
  const suffix = `${process.pid}-${crypto.randomBytes(6).toString('hex')}`;
  const binaryTombstone = `${destination}.remove-${suffix}`;
  const metadataTombstone = `${metadataPath}.remove-${suffix}`;
  let binaryStaged = false;
  let metadataStaged = false;
  const rename = dependencies.rename || fs.renameSync;
  const remove = dependencies.remove || (target => fs.rmSync(target));
  try {
    const status = (dependencies.inspectInstalled || inspectInstalledNasiko)(destination);
    if (!status.installed) return { ...plan, dryRun: false, removed: false };
    if (!status.qualified || status.version !== version) throw new Error('Refusing to remove an unqualified or modified Nasiko executable.');
    rename(destination, binaryTombstone);
    binaryStaged = true;
    rename(metadataPath, metadataTombstone);
    metadataStaged = true;
    const cleanupPending = [];
    try { remove(metadataTombstone); } catch (_error) { cleanupPending.push(metadataTombstone); }
    metadataStaged = false;
    try { remove(binaryTombstone); } catch (_error) { cleanupPending.push(binaryTombstone); }
    binaryStaged = false;
    if (cleanupPending.length > 0) {
      const cleanupError = new Error(`Nasiko uninstall is incomplete; retained staged file(s): ${cleanupPending.join(', ')}. Remove these files before reinstalling.`);
      cleanupError.cleanupPending = cleanupPending;
      throw cleanupError;
    }
    return { ...plan, dryRun: false, removed: true, cleanupPending: [] };
  } catch (error) {
    if (metadataStaged && !fs.existsSync(metadataPath)) rename(metadataTombstone, metadataPath);
    if (binaryStaged && !fs.existsSync(destination)) rename(binaryTombstone, destination);
    throw error;
  } finally { releaseLock(); }
}

module.exports = { QUALIFIED_RELEASES, REGISTRY_ORIGIN, acquireLifecycleLock, digestBytes, extractQualifiedTarGzip, fetchBytes, getQualifiedRelease, inspectInstalledNasiko, installNasiko, normalizePlatform, uninstallNasiko, validateInstallDirectory };
