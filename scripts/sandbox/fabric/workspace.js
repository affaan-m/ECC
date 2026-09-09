'use strict';

const crypto = require('crypto');
const fs = require('fs');
const os = require('os');
const path = require('path');
const { spawnSync } = require('child_process');

const WORKSPACE_MODES = new Set(['in-place', 'isolated-copy', 'worktree']);
const MAX_GIT_BUFFER = 16 * 1024 * 1024;
const DEFAULT_COPY_LIMITS = Object.freeze({
  maxFileBytes: 32 * 1024 * 1024,
  maxTotalBytes: 256 * 1024 * 1024,
});

function runCommand(executable, argv, options = {}) {
  return spawnSync(executable, argv, {
    cwd: options.cwd,
    encoding: 'utf8',
    shell: false,
    windowsHide: true,
    timeout: options.timeout || 30_000,
    maxBuffer: options.maxBuffer || MAX_GIT_BUFFER,
    env: { ...(options.env || process.env) },
  });
}

function commandDetail(result) {
  return [result.stderr, result.stdout, result.error?.message]
    .filter(Boolean)
    .join('\n')
    .trim();
}

function requireSuccessful(result, label) {
  if (!result.error && result.status === 0) return result;
  const detail = commandDetail(result);
  throw new Error(`${label} failed${detail ? `: ${detail}` : ''}`);
}

function ensureDirectory(directory, label) {
  const resolved = path.resolve(directory);
  if (fs.existsSync(resolved)) {
    const stats = fs.lstatSync(resolved);
    if (stats.isSymbolicLink() || !stats.isDirectory()) {
      throw new Error(`${label} must be a real directory`);
    }
  } else {
    fs.mkdirSync(resolved, { recursive: true, mode: 0o700 });
  }
  return fs.realpathSync.native(resolved);
}

function requireSourceDirectory(sourcePath) {
  const resolved = path.resolve(sourcePath);
  const stats = fs.lstatSync(resolved);
  if (stats.isSymbolicLink() || !stats.isDirectory()) {
    throw new Error('Workspace source must be a real directory');
  }
  return fs.realpathSync.native(resolved);
}

function pathInside(parent, candidate) {
  const relative = path.relative(path.resolve(parent), path.resolve(candidate));
  return relative !== '' && !relative.startsWith('..') && !path.isAbsolute(relative);
}

function identityFromStats(stats) {
  return Object.freeze({
    dev: String(stats.dev),
    ino: String(stats.ino),
    mode: String(stats.mode),
    size: Number(stats.size),
    mtime_ns: String(stats.mtimeNs),
    ctime_ns: String(stats.ctimeNs),
  });
}

function identityMatches(stats, identity) {
  const actual = identityFromStats(stats);
  return Object.keys(actual).every(key => actual[key] === identity[key]);
}

function writeAll(descriptor, buffer, length) {
  let offset = 0;
  while (offset < length) {
    const written = fs.writeSync(descriptor, buffer, offset, length - offset);
    if (written < 1) throw new Error('Secure file copy made no write progress');
    offset += written;
  }
}

function readVerifiedRegularFile(filePath, options = {}) {
  const expectedIdentity = options.expectedIdentity;
  const maxBytes = options.maxBytes ?? DEFAULT_COPY_LIMITS.maxFileBytes;
  const openFlags = fs.constants.O_RDONLY
    | (fs.constants.O_NOFOLLOW || 0)
    | (fs.constants.O_NONBLOCK || 0);
  let sourceDescriptor;
  let destinationDescriptor;
  let destinationCreated = false;
  try {
    sourceDescriptor = fs.openSync(filePath, openFlags);
    const before = fs.fstatSync(sourceDescriptor, { bigint: true });
    if (!before.isFile()) throw new Error(`Secure source is a special file: ${filePath}`);
    if (expectedIdentity && !identityMatches(before, expectedIdentity)) {
      throw new Error(`File identity changed before secure open: ${filePath}`);
    }
    if (before.size > BigInt(maxBytes)) throw new Error(`Secure source exceeds the byte limit: ${filePath}`);
    if (options.destinationPath) {
      destinationDescriptor = fs.openSync(
        options.destinationPath,
        fs.constants.O_WRONLY | fs.constants.O_CREAT | fs.constants.O_EXCL | (fs.constants.O_NOFOLLOW || 0),
        0o600
      );
      destinationCreated = true;
    }
    const hash = crypto.createHash('sha256');
    const buffer = Buffer.alloc(64 * 1024);
    let byteCount = 0;
    while (true) {
      const bytesRead = fs.readSync(sourceDescriptor, buffer, 0, buffer.length, null);
      if (bytesRead === 0) break;
      byteCount += bytesRead;
      if (byteCount > maxBytes) throw new Error(`Secure source exceeds the byte limit during read: ${filePath}`);
      hash.update(buffer.subarray(0, bytesRead));
      if (destinationDescriptor !== undefined) writeAll(destinationDescriptor, buffer, bytesRead);
    }
    const after = fs.fstatSync(sourceDescriptor, { bigint: true });
    if (!identityMatches(after, identityFromStats(before)) || byteCount !== Number(before.size)) {
      throw new Error(`File identity changed during secure read: ${filePath}`);
    }
    const digest = hash.digest('hex');
    if (options.expectedSha256 && digest !== options.expectedSha256) {
      throw new Error(`File content changed after verification: ${filePath}`);
    }
    if (destinationDescriptor !== undefined) fs.fsyncSync(destinationDescriptor);
    return Object.freeze({
      sha256: digest,
      size: byteCount,
      identity: identityFromStats(after),
    });
  } catch (error) {
    if (destinationDescriptor !== undefined) {
      try { fs.closeSync(destinationDescriptor); } catch { /* best effort before unlink */ }
      destinationDescriptor = undefined;
    }
    if (destinationCreated) fs.rmSync(options.destinationPath, { force: true });
    throw error;
  } finally {
    if (destinationDescriptor !== undefined) fs.closeSync(destinationDescriptor);
    if (sourceDescriptor !== undefined) fs.closeSync(sourceDescriptor);
  }
}

function assertIdentityUnchanged(filePath, identity) {
  const stats = fs.lstatSync(filePath, { bigint: true });
  if (stats.isSymbolicLink() || !stats.isFile() || !identityMatches(stats, identity)) {
    throw new Error(`File identity changed after secure read: ${filePath}`);
  }
}

function assertDirectoryIdentityUnchanged(directoryPath, identity) {
  const stats = fs.lstatSync(directoryPath, { bigint: true });
  if (stats.isSymbolicLink() || !stats.isDirectory() || !identityMatches(stats, identity)) {
    throw new Error(`Directory identity changed after secure inspection: ${directoryPath}`);
  }
}

function normalizeGitCopyPath(candidate) {
  if (typeof candidate !== 'string' || candidate.length < 1 || candidate.includes('\0')) {
    throw new Error('Git workspace file set contains an invalid path');
  }
  const segments = candidate.split('/');
  if (path.isAbsolute(candidate)
    || segments.some(segment => segment === '' || segment === '.' || segment === '..')
    || segments.includes('.git')) {
    throw new Error(`Git workspace file set contains an unsafe path: ${candidate}`);
  }
  return segments.join(path.sep);
}

function preferredGitCopyPaths(run, source) {
  const rootResult = gitResult(run, source, ['rev-parse', '--show-toplevel']);
  if (rootResult.error || rootResult.status !== 0) return null;
  const gitRoot = fs.realpathSync.native(String(rootResult.stdout || '').trim());
  if (gitRoot !== source) return null;

  const filesResult = requireSuccessful(
    gitResult(run, source, ['ls-files', '--cached', '--others', '--exclude-standard', '-z', '--']),
    'Git workspace file discovery'
  );
  const deletedResult = requireSuccessful(
    gitResult(run, source, ['ls-files', '--deleted', '-z', '--']),
    'Git workspace deletion discovery'
  );
  const parsePaths = output => {
    const text = String(output || '');
    if (text.includes('\uFFFD')) throw new Error('Git workspace file set is not valid UTF-8');
    return text.split('\0').filter(Boolean).map(normalizeGitCopyPath);
  };
  const deleted = new Set(parsePaths(deletedResult.stdout));
  return [...new Set(parsePaths(filesResult.stdout))]
    .filter(candidate => !deleted.has(candidate))
    .sort((left, right) => left.localeCompare(right));
}

function copySourceTree(source, destination, requestedLimits = {}) {
  const limits = {
    maxFileBytes: requestedLimits.maxFileBytes ?? DEFAULT_COPY_LIMITS.maxFileBytes,
    maxTotalBytes: requestedLimits.maxTotalBytes ?? DEFAULT_COPY_LIMITS.maxTotalBytes,
  };
  for (const [name, value] of Object.entries(limits)) {
    if (!Number.isSafeInteger(value) || value < 0) throw new Error(`Workspace ${name} must be a non-negative integer`);
  }
  const digestEntries = [];
  const copiedFiles = [];
  const inspectedDirectories = [];
  const includedFiles = requestedLimits.includedPaths === undefined
    || requestedLimits.includedPaths === null
    ? null
    : new Set(requestedLimits.includedPaths);
  const includedDirectories = includedFiles === null
    ? null
    : new Set(['']);
  if (includedFiles !== null) {
    for (const includedPath of includedFiles) {
      let parent = path.dirname(includedPath);
      while (parent !== '.') {
        includedDirectories.add(parent);
        parent = path.dirname(parent);
      }
    }
  }
  let totalBytes = 0;

  function copyDirectory(sourceDirectory, destinationDirectory, relativeDirectory = '') {
    const directoryStats = fs.lstatSync(sourceDirectory, { bigint: true });
    if (directoryStats.isSymbolicLink() || !directoryStats.isDirectory()) {
      throw new Error(`Workspace source directory became a symbolic link: ${sourceDirectory}`);
    }
    inspectedDirectories.push({
      path: sourceDirectory,
      identity: identityFromStats(directoryStats),
    });
    fs.mkdirSync(destinationDirectory, { recursive: true, mode: 0o700 });
    const entries = fs.readdirSync(sourceDirectory, { withFileTypes: true })
      .sort((left, right) => left.name.localeCompare(right.name));
    for (const entry of entries) {
      if (relativeDirectory === '' && entry.name === '.git') continue;
      if (entry.name === '.git') {
        throw new Error(`Workspace source contains nested Git metadata: ${path.join(relativeDirectory, entry.name)}`);
      }
      const relativePath = relativeDirectory
        ? path.join(relativeDirectory, entry.name)
        : entry.name;
      if (includedFiles !== null
        && !includedFiles.has(relativePath)
        && !includedDirectories.has(relativePath)) {
        continue;
      }
      const sourceEntry = path.join(sourceDirectory, entry.name);
      const destinationEntry = path.join(destinationDirectory, entry.name);
      const stats = fs.lstatSync(sourceEntry, { bigint: true });
      if (stats.isSymbolicLink()) {
        throw new Error(`Workspace source contains a symbolic link: ${relativePath}`);
      }
      if (stats.isDirectory()) {
        copyDirectory(sourceEntry, destinationEntry, relativePath);
      } else if (stats.isFile()) {
        const expectedIdentity = identityFromStats(stats);
        const copied = readVerifiedRegularFile(sourceEntry, {
          destinationPath: destinationEntry,
          expectedIdentity,
          maxBytes: Math.min(limits.maxFileBytes, limits.maxTotalBytes - totalBytes),
        });
        totalBytes += copied.size;
        if (totalBytes > limits.maxTotalBytes) throw new Error('Workspace source exceeds the total byte limit');
        const executable = Number(stats.mode & 0o111n);
        fs.chmodSync(destinationEntry, executable ? 0o755 : 0o644);
        digestEntries.push(`${relativePath.split(path.sep).join('/')}\0${executable}\0${copied.sha256}`);
        copiedFiles.push({ path: sourceEntry, identity: copied.identity });
      } else {
        throw new Error(`Workspace source contains a special file: ${relativePath}`);
      }
    }
  }

  copyDirectory(source, destination);
  for (const file of copiedFiles) assertIdentityUnchanged(file.path, file.identity);
  for (const directory of [...inspectedDirectories].reverse()) {
    assertDirectoryIdentityUnchanged(directory.path, directory.identity);
  }
  return crypto.createHash('sha256').update(digestEntries.join('\n')).digest('hex');
}

function gitResult(run, source, argv, options = {}) {
  return run('git', ['-C', source, ...argv], { cwd: source, env: options.env });
}

function safeGitEnvironment(runDirectory) {
  const home = ensureDirectory(path.join(runDirectory, '.git-home'), 'Isolated Git home');
  const temporaryDirectory = ensureDirectory(path.join(runDirectory, '.git-tmp'), 'Isolated Git temp directory');
  const environment = {
    GIT_ATTR_NOSYSTEM: '1',
    GIT_CONFIG_GLOBAL: os.devNull,
    GIT_CONFIG_NOSYSTEM: '1',
    GIT_TERMINAL_PROMPT: '0',
    HOME: home,
    LANG: 'C',
    LC_ALL: 'C',
    PATH: process.env.PATH || '/usr/bin:/bin',
    TEMP: temporaryDirectory,
    TMP: temporaryDirectory,
    TMPDIR: temporaryDirectory,
    XDG_CONFIG_HOME: home,
  };
  for (const name of ['ComSpec', 'PATHEXT', 'SystemRoot']) {
    if (process.env[name]) environment[name] = process.env[name];
  }
  return Object.freeze(environment);
}

function containsCheckoutFilterAttribute(content) {
  return String(content).split(/\r?\n/u).some(line => {
    const trimmed = line.trimStart();
    if (trimmed === '' || trimmed.startsWith('#')) return false;
    return /(?:^|[\t ])(?:filter(?:=[^\t ]+)?|-filter|!filter)(?=$|[\t ])/u.test(line);
  });
}

function readBoundedAttributeFile(filePath, maxBytes = 1024 * 1024) {
  const inspected = fs.lstatSync(filePath, { bigint: true });
  if (inspected.isSymbolicLink() || !inspected.isFile()) {
    throw new Error('Git checkout attribute source must be a regular file');
  }
  if (inspected.size > BigInt(maxBytes)) throw new Error('Git checkout attribute source exceeds the byte limit');
  const flags = fs.constants.O_RDONLY
    | (fs.constants.O_NOFOLLOW || 0)
    | (fs.constants.O_NONBLOCK || 0);
  const descriptor = fs.openSync(filePath, flags);
  try {
    const before = fs.fstatSync(descriptor, { bigint: true });
    if (!before.isFile() || !identityMatches(before, identityFromStats(inspected))) {
      throw new Error('Git checkout attribute source changed before secure open');
    }
    const chunks = [];
    const buffer = Buffer.alloc(64 * 1024);
    let total = 0;
    while (true) {
      const count = fs.readSync(descriptor, buffer, 0, buffer.length, null);
      if (count === 0) break;
      total += count;
      if (total > maxBytes) throw new Error('Git checkout attribute source exceeds the byte limit');
      chunks.push(Buffer.from(buffer.subarray(0, count)));
    }
    const after = fs.fstatSync(descriptor, { bigint: true });
    if (!identityMatches(after, identityFromStats(before)) || total !== Number(before.size)) {
      throw new Error('Git checkout attribute source changed during secure read');
    }
    return Buffer.concat(chunks).toString('utf8');
  } finally {
    fs.closeSync(descriptor);
  }
}

function rejectCheckoutFilters(run, source, baseOid, environment) {
  const config = gitResult(run, source, [
    'config',
    '--local',
    '--no-includes',
    '--name-only',
    '--get-regexp',
    '^(filter\\..*\\.(smudge|process)|include(if)?\\..*|core\\.attributesfile)$',
  ], { env: environment });
  if (config.error || ![0, 1].includes(config.status)) {
    requireSuccessful(config, 'Git checkout filter configuration inspection');
  }
  if (config.status === 0) {
    throw new Error('Git worktree checkout filter configuration is not allowed');
  }

  const tree = requireSuccessful(
    gitResult(run, source, ['ls-tree', '-r', '--name-only', '-z', baseOid], { env: environment }),
    'Git checkout attribute discovery'
  );
  const attributePaths = String(tree.stdout || '')
    .split('\0')
    .filter(Boolean)
    .map(normalizeGitCopyPath)
    .filter(candidate => path.basename(candidate) === '.gitattributes');
  if (attributePaths.length > 1024) throw new Error('Git checkout attribute file count exceeds the limit');
  for (const attributePath of attributePaths) {
    const attribute = requireSuccessful(
      gitResult(run, source, ['cat-file', 'blob', `${baseOid}:${attributePath.split(path.sep).join('/')}`], {
        env: environment,
      }),
      'Git checkout attribute inspection'
    );
    if (containsCheckoutFilterAttribute(attribute.stdout)) {
      throw new Error('Git worktree checkout filter attributes are not allowed');
    }
  }

  const commonDirectoryResult = requireSuccessful(
    gitResult(run, source, ['rev-parse', '--git-common-dir'], { env: environment }),
    'Git common directory discovery'
  );
  const commonDirectory = fs.realpathSync.native(path.resolve(
    source,
    String(commonDirectoryResult.stdout || '').trim()
  ));
  const localAttributes = path.join(commonDirectory, 'info', 'attributes');
  if (fs.existsSync(localAttributes)
    && containsCheckoutFilterAttribute(readBoundedAttributeFile(localAttributes))) {
    throw new Error('Git worktree checkout filter attributes are not allowed');
  }
}

function optionalBaseOid(run, source, baseRef) {
  const result = gitResult(run, source, ['rev-parse', '--verify', `${baseRef}^{commit}`]);
  return !result.error && result.status === 0 ? String(result.stdout || '').trim() : null;
}

function immutableReceipt(value) {
  return Object.freeze({ ...value });
}

function prepareWorkspace(options = {}) {
  const mode = options.mode || 'in-place';
  if (!WORKSPACE_MODES.has(mode)) throw new Error(`Unsupported workspace mode: ${mode}`);
  if (typeof options.ownerToken !== 'string' || options.ownerToken.length < 1) {
    throw new Error('Workspace owner token is required');
  }
  const source = requireSourceDirectory(options.sourcePath || process.cwd());
  const runDirectory = ensureDirectory(options.runDirectory, 'Workspace run directory');
  const run = options.run || runCommand;
  const baseRef = options.baseRef || 'HEAD';
  const workspaceId = `workspace_${crypto.randomBytes(12).toString('hex')}`;
  const common = {
    schema_version: 1,
    workspace_id: workspaceId,
    owner_token: options.ownerToken,
    mode,
    source_path: source,
    run_directory: runDirectory,
    base_ref: baseRef,
  };

  if (mode === 'in-place') {
    return immutableReceipt({
      ...common,
      path: source,
      owned: false,
      base_oid: optionalBaseOid(run, source, baseRef),
      input_digest: null,
    });
  }

  const workspaceRoot = path.join(runDirectory, 'workspaces');
  fs.mkdirSync(workspaceRoot, { recursive: true, mode: 0o700 });
  const workspacePath = path.join(workspaceRoot, workspaceId);
  if (!pathInside(runDirectory, workspacePath)) {
    throw new Error('Workspace destination escapes the run directory');
  }

  if (mode === 'worktree') {
    if (options.trust !== 'first-party') {
      throw new Error('Git worktree mode is available only for first-party workloads');
    }
    const rootResult = requireSuccessful(
      gitResult(run, source, ['rev-parse', '--show-toplevel']),
      'Git repository discovery'
    );
    const gitRoot = fs.realpathSync.native(String(rootResult.stdout).trim());
    const baseOid = String(requireSuccessful(
      gitResult(run, gitRoot, ['rev-parse', '--verify', `${baseRef}^{commit}`]),
      'Git base resolution'
    ).stdout).trim();
    const gitEnvironment = safeGitEnvironment(runDirectory);
    rejectCheckoutFilters(run, gitRoot, baseOid, gitEnvironment);
    try {
      requireSuccessful(
        gitResult(run, gitRoot, ['worktree', 'add', '--detach', workspacePath, baseOid], {
          env: gitEnvironment,
        }),
        'Git worktree creation'
      );
    } catch (error) {
      fs.rmSync(workspacePath, { recursive: true, force: true });
      throw error;
    }
    return immutableReceipt({
      ...common,
      path: fs.realpathSync.native(workspacePath),
      owned: true,
      git_root: gitRoot,
      base_oid: baseOid,
      input_digest: crypto.createHash('sha256').update(baseOid).digest('hex'),
    });
  }

  fs.mkdirSync(workspacePath, { mode: 0o700 });
  try {
    const includedPaths = preferredGitCopyPaths(run, source);
    const inputDigest = copySourceTree(source, workspacePath, {
      maxFileBytes: options.maxFileBytes,
      maxTotalBytes: options.maxTotalBytes,
      includedPaths,
    });
    return immutableReceipt({
      ...common,
      path: fs.realpathSync.native(workspacePath),
      owned: true,
      base_oid: optionalBaseOid(run, source, baseRef),
      input_digest: inputDigest,
    });
  } catch (error) {
    fs.rmSync(workspacePath, { recursive: true, force: true });
    throw error;
  }
}

function cleanupWorkspace(receipt, options = {}) {
  if (!receipt || receipt.schema_version !== 1 || !WORKSPACE_MODES.has(receipt.mode)) {
    throw new Error('Workspace receipt is invalid');
  }
  if (options.ownerToken !== receipt.owner_token) {
    throw new Error('Workspace owner token does not match the receipt');
  }
  if (!receipt.owned) {
    return { attempted: false, pass: true, retained: true };
  }
  const runDirectory = fs.realpathSync.native(receipt.run_directory);
  const candidatePath = path.resolve(receipt.path);
  if (!pathInside(runDirectory, candidatePath)) {
    throw new Error('Owned workspace path escapes the run directory');
  }
  const run = options.run || runCommand;
  if (receipt.mode === 'worktree') {
    const removal = gitResult(
      run,
      receipt.git_root,
      ['worktree', 'remove', '--force', candidatePath],
      { env: safeGitEnvironment(runDirectory) }
    );
    if (removal.error || removal.status !== 0) {
      return { attempted: true, pass: false, retained: fs.existsSync(candidatePath), error: commandDetail(removal) };
    }
  } else {
    fs.rmSync(candidatePath, { recursive: true, force: true });
  }
  return { attempted: true, pass: !fs.existsSync(candidatePath), retained: fs.existsSync(candidatePath) };
}

module.exports = {
  DEFAULT_COPY_LIMITS,
  WORKSPACE_MODES,
  assertDirectoryIdentityUnchanged,
  assertIdentityUnchanged,
  cleanupWorkspace,
  copySourceTree,
  identityFromStats,
  identityMatches,
  pathInside,
  preferredGitCopyPaths,
  prepareWorkspace,
  readVerifiedRegularFile,
  rejectCheckoutFilters,
  runCommand,
  safeGitEnvironment,
};
