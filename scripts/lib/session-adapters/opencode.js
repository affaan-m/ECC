'use strict';

const fs = require('fs');
const os = require('os');
const path = require('path');
const { execFileSync } = require('child_process');

const { normalizeOpencodeSession, persistCanonicalSnapshot } = require('./canonical-session');

const OPENCODE_TARGET_PREFIXES = ['opencode:'];
const RECENT_ACTIVITY_THRESHOLD_MS = 5 * 60 * 1000;
const MAX_MESSAGE_SCAN = 40;

function parseOpencodeTarget(target) {
  if (typeof target !== 'string') {
    return null;
  }

  for (const prefix of OPENCODE_TARGET_PREFIXES) {
    if (target.startsWith(prefix)) {
      return target.slice(prefix.length).trim();
    }
  }

  return null;
}

function resolveStorageDir(options = {}, context = {}) {
  const explicit = options.storageDir
    || context.opencodeStorageDir
    || process.env.OPENCODE_STORAGE_DIR;

  if (typeof explicit === 'string' && explicit.length > 0) {
    return path.resolve(explicit);
  }

  return path.join(os.homedir(), '.local', 'share', 'opencode', 'storage');
}

function isSessionInfoFile(filePath) {
  const base = path.basename(filePath);
  return base.startsWith('ses_') && base.endsWith('.json');
}

function isOpencodeSessionFileTarget(target, cwd) {
  if (typeof target !== 'string' || target.length === 0) {
    return false;
  }

  const absoluteTarget = path.resolve(cwd, target);
  return fs.existsSync(absoluteTarget)
    && fs.statSync(absoluteTarget).isFile()
    && isSessionInfoFile(absoluteTarget)
    && `${path.sep}session${path.sep}`.length > 0
    && absoluteTarget.includes(`${path.sep}session${path.sep}`);
}

function listSessionInfoFiles(storageDir) {
  const sessionDir = path.join(storageDir, 'session');
  if (!fs.existsSync(sessionDir) || !fs.statSync(sessionDir).isDirectory()) {
    return [];
  }

  const files = [];
  const stack = [sessionDir];

  while (stack.length > 0) {
    const current = stack.pop();
    let entries;
    try {
      entries = fs.readdirSync(current, { withFileTypes: true });
    } catch {
      continue;
    }

    for (const entry of entries) {
      const entryPath = path.join(current, entry.name);
      if (entry.isDirectory()) {
        stack.push(entryPath);
      } else if (entry.isFile() && isSessionInfoFile(entryPath)) {
        files.push(entryPath);
      }
    }
  }

  return files;
}

function readSessionUpdatedMs(filePath) {
  try {
    const info = JSON.parse(fs.readFileSync(filePath, 'utf8'));
    if (info && info.time && Number.isFinite(info.time.updated)) {
      return info.time.updated;
    }
  } catch {
    // fall through to file mtime
  }

  try {
    return fs.statSync(filePath).mtimeMs;
  } catch {
    return 0;
  }
}

function findLatestSessionInfo(storageDir) {
  const files = listSessionInfoFiles(storageDir);
  if (files.length === 0) {
    return null;
  }

  return files
    .map(filePath => ({ filePath, updatedMs: readSessionUpdatedMs(filePath) }))
    .sort((a, b) => b.updatedMs - a.updatedMs)[0].filePath;
}

function findSessionInfoById(storageDir, sessionId) {
  return listSessionInfoFiles(storageDir)
    .find(filePath => path.basename(filePath, '.json') === sessionId) || null;
}

function resolveSessionInfoPath(target, cwd, options, context) {
  const explicitTarget = parseOpencodeTarget(target);
  const storageDir = resolveStorageDir(options, context);

  if (explicitTarget) {
    if (explicitTarget === 'latest') {
      const latest = findLatestSessionInfo(storageDir);
      if (!latest) {
        throw new Error('No OpenCode sessions found');
      }

      return { sessionInfoPath: latest, sourceTarget: { type: 'opencode', value: 'latest' } };
    }

    const absoluteExplicit = path.resolve(cwd, explicitTarget);
    if (fs.existsSync(absoluteExplicit) && isSessionInfoFile(absoluteExplicit)) {
      return { sessionInfoPath: absoluteExplicit, sourceTarget: { type: 'opencode-session-file', value: absoluteExplicit } };
    }

    const byId = findSessionInfoById(storageDir, explicitTarget);
    if (byId) {
      return { sessionInfoPath: byId, sourceTarget: { type: 'opencode', value: explicitTarget } };
    }

    throw new Error(`OpenCode session not found: ${explicitTarget}`);
  }

  if (isOpencodeSessionFileTarget(target, cwd)) {
    const absoluteTarget = path.resolve(cwd, target);
    return { sessionInfoPath: absoluteTarget, sourceTarget: { type: 'opencode-session-file', value: absoluteTarget } };
  }

  throw new Error(`Unsupported OpenCode session target: ${target}`);
}

function readMessageFiles(messageDir) {
  if (!fs.existsSync(messageDir) || !fs.statSync(messageDir).isDirectory()) {
    return [];
  }

  try {
    return fs.readdirSync(messageDir)
      .filter(name => name.startsWith('msg_') && name.endsWith('.json'))
      .map(name => path.join(messageDir, name));
  } catch {
    return [];
  }
}

function deriveModelFromMessages(messageFiles) {
  for (const filePath of messageFiles.slice(0, MAX_MESSAGE_SCAN)) {
    let message;
    try {
      message = JSON.parse(fs.readFileSync(filePath, 'utf8'));
    } catch {
      continue;
    }

    if (message && message.role === 'assistant' && typeof message.modelID === 'string' && message.modelID.length > 0) {
      return {
        model: message.modelID,
        provider: typeof message.providerID === 'string' ? message.providerID : null
      };
    }
  }

  return { model: null, provider: null };
}

function deriveObjective(title) {
  if (typeof title !== 'string') {
    return '';
  }

  const trimmed = title.trim();
  // OpenCode seeds an auto title ("New session - <ISO date>") until the model
  // renames it; treat that as no objective rather than noise.
  if (trimmed.length === 0 || /^New session\b/i.test(trimmed)) {
    return '';
  }

  return trimmed.length > 280 ? `${trimmed.slice(0, 277)}...` : trimmed;
}

function resolveGitBranch(cwd, resolveBranchImpl) {
  if (typeof resolveBranchImpl === 'function') {
    return resolveBranchImpl(cwd);
  }

  if (typeof cwd !== 'string' || cwd.length === 0 || !fs.existsSync(cwd)) {
    return null;
  }

  try {
    // Strip inherited git env (GIT_DIR etc., set when running inside a git
    // hook) so the -C target is honored instead of the host repo.
    const gitEnv = { ...process.env };
    for (const key of ['GIT_DIR', 'GIT_WORK_TREE', 'GIT_INDEX_FILE', 'GIT_COMMON_DIR', 'GIT_PREFIX']) {
      delete gitEnv[key];
    }
    const branch = execFileSync('git', ['-C', cwd, 'rev-parse', '--abbrev-ref', 'HEAD'], {
      stdio: ['ignore', 'pipe', 'ignore'],
      encoding: 'utf8',
      env: gitEnv
    }).trim();

    return branch.length > 0 ? branch : null;
  } catch {
    return null;
  }
}

function parseOpencodeSession(sessionInfoPath, options = {}) {
  const storageDir = options.storageDir
    ? path.resolve(options.storageDir)
    : path.resolve(path.dirname(sessionInfoPath), '..', '..');
  const info = JSON.parse(fs.readFileSync(sessionInfoPath, 'utf8'));

  const sessionId = typeof info.id === 'string' && info.id.length > 0
    ? info.id
    : path.basename(sessionInfoPath, '.json');
  const directory = typeof info.directory === 'string' && info.directory.length > 0 ? info.directory : null;
  const updatedMs = info.time && Number.isFinite(info.time.updated) ? info.time.updated : null;
  const createdMs = info.time && Number.isFinite(info.time.created) ? info.time.created : null;

  const messageFiles = readMessageFiles(path.join(storageDir, 'message', sessionId));
  const { model, provider } = deriveModelFromMessages(messageFiles);

  return {
    sessionId,
    sessionPath: sessionInfoPath,
    cwd: directory,
    branch: resolveGitBranch(directory, options.resolveBranchImpl),
    objective: deriveObjective(info.title),
    title: typeof info.title === 'string' ? info.title : null,
    model,
    provider,
    version: typeof info.version === 'string' ? info.version : null,
    projectId: typeof info.projectID === 'string' ? info.projectID : null,
    createdAt: createdMs !== null ? new Date(createdMs).toISOString() : null,
    updatedAt: updatedMs !== null ? new Date(updatedMs).toISOString() : null,
    messageCount: messageFiles.length,
    active: updatedMs !== null && (Date.now() - updatedMs) <= RECENT_ACTIVITY_THRESHOLD_MS
  };
}

function createOpencodeAdapter(options = {}) {
  const parseOpencodeSessionImpl = options.parseOpencodeSessionImpl || parseOpencodeSession;
  const persistCanonicalSnapshotImpl = options.persistCanonicalSnapshotImpl || persistCanonicalSnapshot;

  return {
    id: 'opencode',
    description: 'OpenCode sessions normalized to ecc.session.v1',
    targetTypes: ['opencode'],
    canOpen(target, context = {}) {
      if (context.adapterId && context.adapterId !== 'opencode') {
        return false;
      }

      if (context.adapterId === 'opencode') {
        return true;
      }

      const cwd = context.cwd || process.cwd();
      return parseOpencodeTarget(target) !== null || isOpencodeSessionFileTarget(target, cwd);
    },
    open(target, context = {}) {
      const cwd = context.cwd || process.cwd();

      return {
        adapterId: 'opencode',
        getSnapshot() {
          const { sessionInfoPath, sourceTarget } = resolveSessionInfoPath(target, cwd, options, context);
          const session = parseOpencodeSessionImpl(sessionInfoPath, options);
          const canonicalSnapshot = normalizeOpencodeSession(session, sourceTarget);

          persistCanonicalSnapshotImpl(canonicalSnapshot, {
            loadStateStoreImpl: options.loadStateStoreImpl,
            persist: context.persistSnapshots !== false && options.persistSnapshots !== false,
            recordingDir: context.recordingDir || options.recordingDir,
            stateStore: options.stateStore
          });

          return canonicalSnapshot;
        }
      };
    }
  };
}

module.exports = {
  createOpencodeAdapter,
  parseOpencodeTarget,
  parseOpencodeSession,
  isOpencodeSessionFileTarget,
  findLatestSessionInfo,
  findSessionInfoById
};
