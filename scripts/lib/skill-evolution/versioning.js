'use strict';

const fs = require('fs');
const path = require('path');

const { appendFile, ensureDir } = require('../utils');

const VERSION_DIRECTORY_NAME = '.versions';
const EVOLUTION_DIRECTORY_NAME = '.evolution';
const EVOLUTION_LOG_TYPES = Object.freeze([
  'observations',
  'inspections',
  'amendments',
]);

function normalizeSkillDir(skillPath) {
  if (!skillPath || typeof skillPath !== 'string') {
    throw new Error('skillPath is required');
  }

  const resolvedPath = path.resolve(skillPath);
  if (path.basename(resolvedPath) === 'SKILL.md') {
    return path.dirname(resolvedPath);
  }

  return resolvedPath;
}

function getSkillFilePath(skillPath) {
  return path.join(normalizeSkillDir(skillPath), 'SKILL.md');
}

function ensureSkillExists(skillPath) {
  const skillFilePath = getSkillFilePath(skillPath);
  if (!fs.existsSync(skillFilePath)) {
    throw new Error(`Skill file not found: ${skillFilePath}`);
  }

  return skillFilePath;
}

function getVersionsDir(skillPath) {
  return path.join(normalizeSkillDir(skillPath), VERSION_DIRECTORY_NAME);
}

function getEvolutionDir(skillPath) {
  return path.join(normalizeSkillDir(skillPath), EVOLUTION_DIRECTORY_NAME);
}

function getEvolutionLogPath(skillPath, logType) {
  if (!EVOLUTION_LOG_TYPES.includes(logType)) {
    throw new Error(`Unknown evolution log type: ${logType}`);
  }

  return path.join(getEvolutionDir(skillPath), `${logType}.jsonl`);
}

function ensureSkillVersioning(skillPath) {
  ensureSkillExists(skillPath);

  const versionsDir = getVersionsDir(skillPath);
  const evolutionDir = getEvolutionDir(skillPath);

  ensureDir(versionsDir);
  ensureDir(evolutionDir);

  for (const logType of EVOLUTION_LOG_TYPES) {
    const logPath = getEvolutionLogPath(skillPath, logType);
    if (!fs.existsSync(logPath)) {
      fs.writeFileSync(logPath, '', 'utf8');
    }
  }

  return {
    versionsDir,
    evolutionDir,
  };
}

function parseVersionNumber(fileName) {
  const match = /^v(\d+)\.md$/.exec(fileName);
  if (!match) {
    return null;
  }

  const version = Number(match[1]);
  return Number.isSafeInteger(version) && version >= 1 ? version : null;
}

function listVersions(skillPath) {
  const versionsDir = getVersionsDir(skillPath);
  if (!fs.existsSync(versionsDir)) {
    return [];
  }

  return fs.readdirSync(versionsDir)
    .map(fileName => {
      const version = parseVersionNumber(fileName);
      if (version === null) {
        return null;
      }

      const filePath = path.join(versionsDir, fileName);
      let stats;
      try {
        stats = fs.statSync(filePath);
      } catch (error) {
        // A dangling link still occupies a path, but is not a readable snapshot.
        if (error.code === 'ENOENT') return null;
        throw error;
      }
      if (!stats.isFile()) {
        return null;
      }

      return {
        version,
        path: filePath,
        created_at: stats.mtime.toISOString(),
      };
    })
    .filter(Boolean)
    .sort((left, right) => left.version - right.version);
}

function getCurrentVersion(skillPath) {
  const skillFilePath = getSkillFilePath(skillPath);
  if (!fs.existsSync(skillFilePath)) {
    return 0;
  }

  const versions = listVersions(skillPath);
  if (versions.length === 0) {
    return 1;
  }

  return versions[versions.length - 1].version;
}

function appendEvolutionRecord(skillPath, logType, record) {
  ensureSkillVersioning(skillPath);
  appendFile(getEvolutionLogPath(skillPath, logType), `${JSON.stringify(record)}\n`);
  return { ...record };
}

function readJsonl(filePath) {
  if (!fs.existsSync(filePath)) {
    return [];
  }

  return fs.readFileSync(filePath, 'utf8')
    .split('\n')
    .map(line => line.trim())
    .filter(Boolean)
    .reduce((rows, line) => {
      try {
        const record = JSON.parse(line);
        if (record && typeof record === 'object' && !Array.isArray(record)) {
          rows.push(record);
        }
      } catch {
        // Ignore malformed rows so the log remains append-only and resilient.
      }
      return rows;
    }, []);
}

function getEvolutionLog(skillPath, logType) {
  return readJsonl(getEvolutionLogPath(skillPath, logType));
}

function allocateSnapshotVersion(skillPath) {
  const versions = listVersions(skillPath);
  const versionsDir = getVersionsDir(skillPath);
  const occupiedPaths = new Set(fs.existsSync(versionsDir) ? fs.readdirSync(versionsDir) : []);
  let nextVersion = versions.length === 0 ? 1 : versions[versions.length - 1].version + 1;
  // Listing excludes non-files, but their paths remain user-owned and occupied.
  while (Number.isSafeInteger(nextVersion) && occupiedPaths.has(`v${nextVersion}.md`)) {
    nextVersion += 1;
  }
  if (!Number.isSafeInteger(nextVersion)) {
    throw new Error('Skill snapshot version range is exhausted; safe integer allocation is unavailable; existing snapshots were preserved');
  }
  return nextVersion;
}

function removeOwnedSnapshot(snapshot) {
  let current;
  try {
    current = fs.lstatSync(snapshot.path);
  } catch (error) {
    if (error.code === 'ENOENT') return;
    throw error;
  }
  if (!current.isFile() || current.dev !== snapshot.identity.dev || current.ino !== snapshot.identity.ino) {
    throw new Error('Snapshot path changed ownership; replacement was preserved');
  }
  fs.unlinkSync(snapshot.path);
}

function failSnapshotAttempt(snapshot, primaryError) {
  try {
    removeOwnedSnapshot(snapshot);
  } catch (recoveryError) {
    const error = new Error(`${primaryError.message}; snapshot cleanup failed: ${recoveryError.message}; recovery is pending`, { cause: primaryError });
    error.primaryError = primaryError;
    error.recoveryError = recoveryError;
    throw error;
  }
  throw primaryError;
}

function removeOwnedStaging(staging, contentIdentity) {
  const directory = fs.lstatSync(staging.path);
  if (!directory.isDirectory() || directory.dev !== staging.identity.dev || directory.ino !== staging.identity.ino) {
    throw new Error('Snapshot staging directory changed ownership; replacement was preserved');
  }
  let content;
  try {
    content = fs.lstatSync(staging.contentPath);
  } catch (error) {
    if (error.code !== 'ENOENT') throw error;
  }
  if (content) {
    if (!contentIdentity || !content.isFile() || content.dev !== contentIdentity.dev || content.ino !== contentIdentity.ino) {
      throw new Error('Snapshot staging content ownership could not be verified; content was preserved');
    }
    fs.unlinkSync(staging.contentPath);
  }
  // Unexpected entries remain owned by their writers. Empty-directory removal is safe.
  fs.rmdirSync(staging.path);
}

function prepareStaging(versionsDir, prefix = '.snapshot-') {
  const stagingDir = fs.mkdtempSync(path.join(versionsDir, prefix));
  try {
    return { path: stagingDir, contentPath: path.join(stagingDir, 'content.md'), identity: fs.lstatSync(stagingDir) };
  } catch (primaryError) {
    const recoveryError = new Error(`Staging directory identity could not be verified; preserved ${stagingDir}`);
    const error = new Error(`${primaryError.message}; ${recoveryError.message}; recovery is pending`, { cause: primaryError });
    error.primaryError = primaryError;
    error.recoveryError = recoveryError;
    throw error;
  }
}

function verifySnapshotStorage(skillPath) {
  const versionsDir = getVersionsDir(skillPath);
  const base = fs.existsSync(versionsDir) ? versionsDir : normalizeSkillDir(skillPath);
  const staging = prepareStaging(base, '.snapshot-storage-');
  const linkPath = path.join(staging.path, 'hardlink-check.md');
  let identity;
  let linked = false;
  let linking = false;
  try {
    const descriptor = fs.openSync(staging.contentPath, 'wx');
    try {
      identity = fs.fstatSync(descriptor);
      fs.writeFileSync(descriptor, 'ECC snapshot storage check\n', 'utf8');
    } finally {
      fs.closeSync(descriptor);
    }
    linking = true;
    fs.linkSync(staging.contentPath, linkPath);
    linked = true;
    linking = false;
    removeOwnedSnapshot({ path: linkPath, identity });
    linked = false;
    removeOwnedStaging(staging, identity);
  } catch (primaryError) {
    try {
      if (linked) removeOwnedSnapshot({ path: linkPath, identity });
      removeOwnedStaging(staging, identity);
    } catch (recoveryError) {
      const error = new Error(`${primaryError.message}; storage-check cleanup failed: ${recoveryError.message}; recovery is pending`, { cause: primaryError });
      error.primaryError = primaryError;
      error.recoveryError = recoveryError;
      throw error;
    }
    if (linking && ['ENOTSUP', 'EOPNOTSUPP', 'ENOSYS', 'EPERM', 'EXDEV', 'EINVAL'].includes(primaryError.code)) {
      const error = new Error(`Skill versioning requires hardlink-capable storage for snapshot creation and rollback; capability check failed before history initialization (${primaryError.code})`, { cause: primaryError });
      error.code = primaryError.code;
      error.primaryError = primaryError;
      throw error;
    }
    throw primaryError;
  }
}

function publishVersion(skillPath, skillContent, options) {
  ensureSkillExists(skillPath);
  const nextVersion = allocateSnapshotVersion(skillPath);
  const versionsDir = getVersionsDir(skillPath);
  verifySnapshotStorage(skillPath);
  ensureSkillVersioning(skillPath);
  const staging = prepareStaging(versionsDir);
  const stagedPath = staging.contentPath;
  const snapshotPath = path.join(versionsDir, `v${nextVersion}.md`);
  const createdAt = options.timestamp || new Date().toISOString();
  let snapshot;
  let published = false;
  try {
    const descriptor = fs.openSync(stagedPath, 'wx');
    try {
      snapshot = { version: nextVersion, path: snapshotPath, created_at: createdAt, identity: fs.fstatSync(descriptor) };
      fs.writeFileSync(descriptor, skillContent, 'utf8');
    } finally {
      fs.closeSync(descriptor);
    }
    // Exclusive linking publishes fully written bytes without replacing occupied paths.
    fs.linkSync(stagedPath, snapshotPath);
    published = true;
    removeOwnedStaging(staging, snapshot.identity);
    return snapshot;
  } catch (primaryError) {
    try {
      if (published) removeOwnedSnapshot(snapshot);
      removeOwnedStaging(staging, snapshot?.identity);
    } catch (recoveryError) {
      const error = new Error(`${primaryError.message}; publication cleanup failed: ${recoveryError.message}; recovery is pending`, { cause: primaryError });
      error.primaryError = primaryError;
      error.recoveryError = recoveryError;
      throw error;
    }
    throw primaryError;
  }
}

function recordSnapshot(skillPath, snapshot, options) {
  appendEvolutionRecord(skillPath, 'amendments', {
    event: 'snapshot',
    version: snapshot.version,
    reason: options.reason || null,
    author: options.author || null,
    status: 'applied',
    created_at: snapshot.created_at,
  });
  return { version: snapshot.version, path: snapshot.path, created_at: snapshot.created_at };
}

/** Snapshot creation requires hardlink-capable storage, checked before history initialization. */
function createVersion(skillPath, options = {}) {
  const skillFilePath = ensureSkillExists(skillPath);
  const skillContent = fs.readFileSync(skillFilePath, 'utf8');
  return recordSnapshot(skillPath, publishVersion(skillPath, skillContent, options), options);
}

function rollbackTo(skillPath, targetVersion, options = {}) {
  const normalizedTargetVersion = Number(targetVersion);
  if (!Number.isSafeInteger(normalizedTargetVersion) || normalizedTargetVersion <= 0) {
    throw new Error(`Invalid target version: ${targetVersion}`);
  }

  ensureSkillExists(skillPath);

  const targetPath = path.join(getVersionsDir(skillPath), `v${normalizedTargetVersion}.md`);
  if (!fs.existsSync(targetPath)) {
    throw new Error(`Version not found: v${normalizedTargetVersion}`);
  }

  const priorContent = fs.readFileSync(getSkillFilePath(skillPath));
  const currentVersion = getCurrentVersion(skillPath);
  const targetContent = fs.readFileSync(targetPath, 'utf8');
  // Publish the restored-content snapshot before replacing unsnapshotted live work.
  // Initialization and exclusive publication failures therefore leave SKILL.md intact.
  const snapshotOptions = {
    timestamp: options.timestamp,
    reason: options.reason || `rollback to v${normalizedTargetVersion}`,
    author: options.author || null,
  };
  const snapshot = publishVersion(skillPath, targetContent, snapshotOptions);
  try {
    fs.writeFileSync(getSkillFilePath(skillPath), targetContent, 'utf8');
  } catch (primaryError) {
    try {
      if (!fs.readFileSync(getSkillFilePath(skillPath)).equals(priorContent)) {
        throw new Error('Live skill changed during the failed write; target snapshot retained');
      }
    } catch (recoveryError) {
      const error = new Error(`${primaryError.message}; ${recoveryError.message}; recovery is pending`, { cause: primaryError });
      error.primaryError = primaryError;
      error.recoveryError = recoveryError;
      throw error;
    }
    failSnapshotAttempt(snapshot, primaryError);
  }
  const createdVersion = recordSnapshot(skillPath, snapshot, snapshotOptions);

  appendEvolutionRecord(skillPath, 'amendments', {
    event: 'rollback',
    version: createdVersion.version,
    source_version: currentVersion,
    target_version: normalizedTargetVersion,
    reason: options.reason || null,
    author: options.author || null,
    status: 'applied',
    created_at: options.timestamp || new Date().toISOString(),
  });

  return createdVersion;
}

module.exports = {
  EVOLUTION_DIRECTORY_NAME,
  EVOLUTION_LOG_TYPES,
  VERSION_DIRECTORY_NAME,
  appendEvolutionRecord,
  createVersion,
  ensureSkillVersioning,
  getCurrentVersion,
  getEvolutionDir,
  getEvolutionLog,
  getEvolutionLogPath,
  getVersionsDir,
  listVersions,
  rollbackTo,
};
