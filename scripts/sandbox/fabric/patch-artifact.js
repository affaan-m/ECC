'use strict';

const crypto = require('crypto');
const fs = require('fs');
const path = require('path');
const { spawnSync } = require('child_process');
const { canonicalContractJson } = require('../contracts');
const { validatePatchArtifact } = require('./contracts');
const {
  assertDirectoryIdentityUnchanged,
  assertIdentityUnchanged,
  identityFromStats,
  readVerifiedRegularFile,
} = require('./workspace');

const ARTIFACT_ROOT = Symbol.for('ecc.sandbox.fabric.artifact-root');
const DEFAULT_LIMITS = Object.freeze({
  maxFiles: 10_000,
  maxFileBytes: 32 * 1024 * 1024,
  maxTotalBytes: 256 * 1024 * 1024,
  maxPatchBytes: 64 * 1024 * 1024,
});

function sha256(value) {
  return crypto.createHash('sha256').update(value).digest('hex');
}

function safeHostEnvironment() {
  const allowed = new Set([
    'COMSPEC', 'LANG', 'PATH', 'PATHEXT', 'SYSTEMROOT', 'TEMP', 'TMP', 'TMPDIR', 'TZ', 'WINDIR',
  ]);
  return Object.fromEntries(Object.entries(process.env).filter(([name]) => (
    allowed.has(name.toUpperCase()) || name.toUpperCase().startsWith('LC_')
  )));
}

function gitEnvironment(homeDirectory) {
  return {
    ...safeHostEnvironment(),
    HOME: homeDirectory,
    GIT_CONFIG_GLOBAL: process.platform === 'win32' ? 'NUL' : '/dev/null',
    GIT_CONFIG_NOSYSTEM: '1',
    GIT_TERMINAL_PROMPT: '0',
  };
}

function runGit(cwd, argv, options = {}) {
  return spawnSync('git', ['-c', 'core.hooksPath=/dev/null', ...argv], {
    cwd,
    encoding: options.encoding === null ? null : 'utf8',
    shell: false,
    windowsHide: true,
    timeout: options.timeout || 60_000,
    maxBuffer: options.maxBuffer || 80 * 1024 * 1024,
    env: gitEnvironment(options.homeDirectory || cwd),
  });
}

function gitDetail(result) {
  return [result.stderr, result.stdout, result.error?.message]
    .filter(Boolean)
    .join('\n')
    .trim();
}

function requireGit(cwd, argv, label, options = {}) {
  const result = runGit(cwd, argv, options);
  if (!result.error && result.status === 0) return result;
  const detail = gitDetail(result);
  throw new Error(`${label} failed${detail ? `: ${detail}` : ''}`);
}

function normalizedLimits(input = {}) {
  const result = {
    maxFiles: input.maxFiles ?? DEFAULT_LIMITS.maxFiles,
    maxFileBytes: input.maxFileBytes ?? DEFAULT_LIMITS.maxFileBytes,
    maxTotalBytes: input.maxTotalBytes ?? DEFAULT_LIMITS.maxTotalBytes,
    maxPatchBytes: input.maxPatchBytes ?? DEFAULT_LIMITS.maxPatchBytes,
  };
  for (const [name, value] of Object.entries(result)) {
    if (!Number.isSafeInteger(value) || value < 0) throw new Error(`Candidate ${name} must be a non-negative integer`);
  }
  return Object.freeze(result);
}

function verifyCandidateTree(candidatePath, requestedLimits = {}) {
  const limits = normalizedLimits(requestedLimits);
  const resolved = path.resolve(candidatePath);
  const rootStats = fs.lstatSync(resolved);
  if (rootStats.isSymbolicLink() || !rootStats.isDirectory()) {
    throw new Error('Candidate root must be a real directory');
  }
  const files = [];
  const directories = [];
  let totalBytes = 0;

  function visit(directory, relativeDirectory = '') {
    const directoryStats = fs.lstatSync(directory, { bigint: true });
    if (directoryStats.isSymbolicLink() || !directoryStats.isDirectory()) {
      throw new Error(`Candidate directory became a symbolic link: ${directory}`);
    }
    directories.push(Object.freeze({
      path: relativeDirectory,
      identity: identityFromStats(directoryStats),
    }));
    const entries = fs.readdirSync(directory, { withFileTypes: true })
      .sort((left, right) => left.name.localeCompare(right.name));
    for (const entry of entries) {
      const relativePath = relativeDirectory
        ? path.posix.join(relativeDirectory, entry.name)
        : entry.name;
      if (entry.name === '.git') throw new Error(`Candidate path contains forbidden .git metadata: ${relativePath}`);
      if (relativePath.includes('\0')) throw new Error('Candidate path contains a NUL byte');
      const absolutePath = path.join(directory, entry.name);
      const stats = fs.lstatSync(absolutePath, { bigint: true });
      if (stats.isSymbolicLink()) throw new Error(`Candidate path is a symbolic link: ${relativePath}`);
      if (stats.isDirectory()) {
        visit(absolutePath, relativePath);
        continue;
      }
      if (!stats.isFile()) throw new Error(`Candidate path is a special file: ${relativePath}`);
      if (files.length + 1 > limits.maxFiles) throw new Error('Candidate exceeds the file count limit');
      if (stats.size > BigInt(limits.maxFileBytes)) throw new Error(`Candidate exceeds the per-file byte limit: ${relativePath}`);
      if (totalBytes + Number(stats.size) > limits.maxTotalBytes) {
        throw new Error('Candidate exceeds the total byte limit');
      }
      const verified = readVerifiedRegularFile(absolutePath, {
        expectedIdentity: identityFromStats(stats),
        maxBytes: Math.min(limits.maxFileBytes, limits.maxTotalBytes - totalBytes),
      });
      totalBytes += verified.size;
      if (totalBytes > limits.maxTotalBytes) throw new Error('Candidate exceeds the total byte limit');
      files.push(Object.freeze({
        path: relativePath,
        size: verified.size,
        sha256: verified.sha256,
        mode: stats.mode & 0o111n ? '100755' : '100644',
        identity: verified.identity,
      }));
    }
  }

  visit(resolved);
  for (const file of files) {
    assertIdentityUnchanged(path.join(resolved, ...file.path.split('/')), file.identity);
  }
  for (const directory of [...directories].reverse()) {
    assertDirectoryIdentityUnchanged(
      directory.path ? path.join(resolved, ...directory.path.split('/')) : resolved,
      directory.identity
    );
  }
  const digestInput = files.map(file => `${file.path}\0${file.mode}\0${file.size}\0${file.sha256}`).join('\n');
  return Object.freeze({
    path: fs.realpathSync.native(resolved),
    files: Object.freeze(files),
    directories: Object.freeze(directories),
    file_count: files.length,
    byte_count: totalBytes,
    tree_sha256: sha256(digestInput),
    limits,
  });
}

function copyVerifiedTree(verification, destination) {
  for (const directory of verification.directories) {
    assertDirectoryIdentityUnchanged(
      directory.path ? path.join(verification.path, ...directory.path.split('/')) : verification.path,
      directory.identity
    );
  }
  for (const file of verification.files) {
    const target = path.join(destination, ...file.path.split('/'));
    fs.mkdirSync(path.dirname(target), { recursive: true, mode: 0o700 });
    readVerifiedRegularFile(path.join(verification.path, ...file.path.split('/')), {
      destinationPath: target,
      expectedIdentity: file.identity,
      expectedSha256: file.sha256,
      maxBytes: file.size,
    });
    fs.chmodSync(target, file.mode === '100755' ? 0o755 : 0o644);
  }
  for (const file of verification.files) {
    assertIdentityUnchanged(
      path.join(verification.path, ...file.path.split('/')),
      file.identity
    );
  }
  for (const directory of [...verification.directories].reverse()) {
    assertDirectoryIdentityUnchanged(
      directory.path ? path.join(verification.path, ...directory.path.split('/')) : verification.path,
      directory.identity
    );
  }
}

function clearCheckout(repository) {
  for (const entry of fs.readdirSync(repository)) {
    if (entry === '.git') continue;
    fs.rmSync(path.join(repository, entry), { recursive: true, force: true });
  }
}

function parseNameStatus(output) {
  const fields = String(output || '').split('\0');
  if (fields.at(-1) === '') fields.pop();
  const files = [];
  for (let index = 0; index < fields.length;) {
    const token = fields[index++];
    const statusCode = token[0];
    if (statusCode === 'R' || statusCode === 'C') {
      const oldPath = fields[index++];
      const newPath = fields[index++];
      files.push({ path: newPath, old_path: oldPath, status: 'renamed' });
    } else {
      const filePath = fields[index++];
      const statuses = { A: 'added', M: 'modified', D: 'deleted', T: 'modified' };
      files.push({ path: filePath, status: statuses[statusCode] || 'modified' });
    }
  }
  return files.sort((left, right) => left.path.localeCompare(right.path));
}

function modeAt(repository, revision, filePath) {
  const result = runGit(repository, ['ls-tree', revision, '--', filePath]);
  if (result.error || result.status !== 0 || !result.stdout.trim()) return null;
  return result.stdout.trim().split(/\s+/, 1)[0] || null;
}

function indexMode(repository, filePath) {
  const result = runGit(repository, ['ls-files', '-s', '--', filePath]);
  if (result.error || result.status !== 0 || !result.stdout.trim()) return null;
  return result.stdout.trim().split(/\s+/, 1)[0] || null;
}

function artifactRoot(artifact, fallback) {
  return fallback ? path.resolve(fallback) : artifact?.[ARTIFACT_ROOT] || null;
}

function artifactPatchPath(artifact, runDirectory) {
  const root = artifactRoot(artifact, runDirectory);
  if (!root) return null;
  const resolved = path.resolve(root, artifact.patch.relative_path);
  const relative = path.relative(root, resolved);
  if (relative.startsWith('..') || path.isAbsolute(relative)) throw new Error('Artifact patch path escapes its run directory');
  return resolved;
}

function digestArtifact(artifact) {
  return sha256(canonicalContractJson(artifact));
}

function buildPatchArtifact(options = {}) {
  const basePath = fs.realpathSync.native(path.resolve(options.basePath));
  const runDirectory = path.resolve(options.runDirectory);
  fs.mkdirSync(runDirectory, { recursive: true, mode: 0o700 });
  const runStats = fs.lstatSync(runDirectory);
  if (runStats.isSymbolicLink() || !runStats.isDirectory()) throw new Error('Artifact run directory must be a real directory');
  const verification = verifyCandidateTree(options.candidatePath, options.limits);
  const baseRef = options.baseRef || 'HEAD';
  const baseCommit = String(requireGit(basePath, ['rev-parse', '--verify', `${baseRef}^{commit}`], 'Base commit resolution').stdout).trim();
  const baseTreeListing = requireGit(basePath, ['ls-tree', '-r', '-z', '--full-tree', baseCommit], 'Base tree inspection').stdout;
  const baseTreeDigest = sha256(baseTreeListing);
  const artifactId = `artifact_${crypto.randomBytes(12).toString('hex')}`;
  const stagingRoot = fs.mkdtempSync(path.join(runDirectory, '.patch-stage-'));
  const stagingRepository = path.join(stagingRoot, 'repository');
  try {
    requireGit(runDirectory, ['clone', '--quiet', '--no-local', '--no-hardlinks', '--no-checkout', basePath, stagingRepository], 'Isolated base clone');
    requireGit(stagingRepository, ['checkout', '--quiet', '--detach', baseCommit], 'Isolated base checkout');
    clearCheckout(stagingRepository);
    copyVerifiedTree(verification, stagingRepository);
    requireGit(stagingRepository, ['add', '-A', '--', '.'], 'Candidate indexing');
    const patchResult = requireGit(
      stagingRepository,
      ['diff', '--cached', '--binary', '--full-index', '--find-renames', '--no-ext-diff', baseCommit, '--', '.'],
      'Candidate patch creation',
      { maxBuffer: verification.limits.maxPatchBytes + (1024 * 1024) }
    );
    const patchBuffer = Buffer.from(patchResult.stdout, 'utf8');
    if (patchBuffer.length > verification.limits.maxPatchBytes) throw new Error('Candidate patch exceeds the patch byte limit');
    const changed = parseNameStatus(requireGit(
      stagingRepository,
      ['diff', '--cached', '--name-status', '-z', '--find-renames', baseCommit, '--', '.'],
      'Candidate path inventory'
    ).stdout);
    const candidateFiles = new Map(verification.files.map(file => [file.path, file]));
    const files = changed.map(file => {
      const candidate = candidateFiles.get(file.path);
      return Object.freeze({
        path: file.path,
        ...(file.old_path ? { old_path: file.old_path } : {}),
        status: file.status,
        mode_before: modeAt(stagingRepository, baseCommit, file.old_path || file.path),
        mode_after: indexMode(stagingRepository, file.path),
        size: candidate?.size ?? null,
        sha256: candidate?.sha256 ?? null,
      });
    });
    const artifactsDirectory = path.join(runDirectory, 'artifacts');
    fs.mkdirSync(artifactsDirectory, { recursive: true, mode: 0o700 });
    const patchPath = path.join(artifactsDirectory, `${artifactId}.patch`);
    fs.writeFileSync(patchPath, patchBuffer, { mode: 0o600, flag: 'wx' });
    const artifact = {
      schema_version: 1,
      artifact_id: artifactId,
      run_id: options.runId || null,
      job_id: options.jobId || null,
      worker_id: options.workerId || options.jobId || 'unknown-worker',
      workspace_mode: options.workspaceMode || 'isolated-copy',
      base: {
        ref: baseRef,
        commit: baseCommit,
        tree_sha256: baseTreeDigest,
      },
      candidate: {
        tree_sha256: verification.tree_sha256,
        byte_count: verification.byte_count,
        file_count: verification.file_count,
      },
      patch: {
        relative_path: path.relative(runDirectory, patchPath).split(path.sep).join('/'),
        sha256: sha256(patchBuffer),
        byte_count: patchBuffer.length,
        format: 'git-binary-diff',
      },
      files: Object.freeze(files),
      findings: Object.freeze([]),
      created_at: new Date().toISOString(),
    };
    Object.defineProperty(artifact, ARTIFACT_ROOT, {
      value: fs.realpathSync.native(runDirectory),
      enumerable: false,
      configurable: false,
      writable: false,
    });
    Object.freeze(artifact.base);
    Object.freeze(artifact.candidate);
    Object.freeze(artifact.patch);
    validatePatchArtifact(artifact);
    return Object.freeze(artifact);
  } finally {
    fs.rmSync(stagingRoot, { recursive: true, force: true });
  }
}

module.exports = {
  ARTIFACT_ROOT,
  DEFAULT_LIMITS,
  artifactPatchPath,
  artifactRoot,
  buildPatchArtifact,
  copyVerifiedTree,
  digestArtifact,
  normalizedLimits,
  sha256,
  verifyCandidateTree,
};
