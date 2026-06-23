'use strict';

const fs = require('fs');
const os = require('os');
const path = require('path');
const { execFileSync } = require('child_process');

const { normalizeCodexWorktreeSession, persistCanonicalSnapshot } = require('./canonical-session');

const CODEX_TARGET_PREFIXES = ['codex-worktree:', 'codex:'];
const ROLLOUT_PREFIX = 'rollout-';
const RECENT_ACTIVITY_THRESHOLD_MS = 5 * 60 * 1000;

function parseCodexTarget(target) {
  if (typeof target !== 'string') {
    return null;
  }

  for (const prefix of CODEX_TARGET_PREFIXES) {
    if (target.startsWith(prefix)) {
      return target.slice(prefix.length).trim();
    }
  }

  return null;
}

function resolveSessionsDir(options = {}, context = {}) {
  const explicit = options.sessionsDir
    || context.codexSessionsDir
    || process.env.CODEX_SESSIONS_DIR;

  if (typeof explicit === 'string' && explicit.length > 0) {
    return path.resolve(explicit);
  }

  return path.join(os.homedir(), '.codex', 'sessions');
}

function isRolloutFile(filePath) {
  const base = path.basename(filePath);
  return base.startsWith(ROLLOUT_PREFIX) && base.endsWith('.jsonl');
}

function isCodexRolloutFileTarget(target, cwd) {
  if (typeof target !== 'string' || target.length === 0) {
    return false;
  }

  const absoluteTarget = path.resolve(cwd, target);
  return fs.existsSync(absoluteTarget)
    && fs.statSync(absoluteTarget).isFile()
    && isRolloutFile(absoluteTarget);
}

function listRolloutFiles(sessionsDir) {
  if (!fs.existsSync(sessionsDir) || !fs.statSync(sessionsDir).isDirectory()) {
    return [];
  }

  const files = [];
  const stack = [sessionsDir];

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
      } else if (entry.isFile() && isRolloutFile(entryPath)) {
        files.push(entryPath);
      }
    }
  }

  return files;
}

function findLatestRollout(sessionsDir) {
  const files = listRolloutFiles(sessionsDir);
  if (files.length === 0) {
    return null;
  }

  return files
    .map(filePath => ({ filePath, mtimeMs: fs.statSync(filePath).mtimeMs }))
    .sort((a, b) => b.mtimeMs - a.mtimeMs)[0].filePath;
}

function findRolloutById(sessionsDir, sessionId) {
  return listRolloutFiles(sessionsDir)
    .find(filePath => path.basename(filePath).includes(sessionId)) || null;
}

function resolveRolloutPath(target, cwd, options, context) {
  const explicitTarget = parseCodexTarget(target);
  const sessionsDir = resolveSessionsDir(options, context);

  if (explicitTarget) {
    if (explicitTarget === 'latest') {
      const latest = findLatestRollout(sessionsDir);
      if (!latest) {
        throw new Error('No Codex rollout sessions found');
      }

      return { rolloutPath: latest, sourceTarget: { type: 'codex-worktree', value: 'latest' } };
    }

    const absoluteExplicit = path.resolve(cwd, explicitTarget);
    if (fs.existsSync(absoluteExplicit) && isRolloutFile(absoluteExplicit)) {
      return { rolloutPath: absoluteExplicit, sourceTarget: { type: 'codex-rollout-file', value: absoluteExplicit } };
    }

    const byId = findRolloutById(sessionsDir, explicitTarget);
    if (byId) {
      return { rolloutPath: byId, sourceTarget: { type: 'codex-worktree', value: explicitTarget } };
    }

    throw new Error(`Codex rollout session not found: ${explicitTarget}`);
  }

  if (isCodexRolloutFileTarget(target, cwd)) {
    const absoluteTarget = path.resolve(cwd, target);
    return { rolloutPath: absoluteTarget, sourceTarget: { type: 'codex-rollout-file', value: absoluteTarget } };
  }

  throw new Error(`Unsupported Codex session target: ${target}`);
}

function readJsonLines(filePath) {
  const raw = fs.readFileSync(filePath, 'utf8');
  const records = [];

  for (const line of raw.split('\n')) {
    const trimmed = line.trim();
    if (trimmed.length === 0) {
      continue;
    }

    try {
      records.push(JSON.parse(trimmed));
    } catch {
      // Rollout logs are append-only; skip partial/corrupt trailing lines.
    }
  }

  return records;
}

function extractText(content) {
  if (typeof content === 'string') {
    return content;
  }

  if (Array.isArray(content)) {
    return content
      .map(part => (part && typeof part.text === 'string' ? part.text : ''))
      .join('')
      .trim();
  }

  return '';
}

function stripLeadingMessageId(text) {
  // Codex rollouts sometimes prepend a message UUID directly onto the user
  // text (e.g. "019e52db-...please continue"). Drop it for a clean objective.
  return text.replace(/^[0-9a-f]{8}-?[0-9a-f]{4}-?[0-9a-f]{4}-?[0-9a-f]{4}-?[0-9a-f]{12}/i, '').trim();
}

function isPreambleText(text) {
  // The first user record in a Codex rollout is the injected harness preamble
  // (AGENTS.md / environment context), not the operator's actual objective.
  return text.startsWith('#')
    || text.startsWith('<')
    || text.includes('<cwd>')
    || text.includes('AGENTS.md instructions');
}

function deriveObjective(records) {
  for (const record of records) {
    const payload = record && record.payload;
    if (!payload || payload.type !== 'message' || payload.role !== 'user') {
      continue;
    }

    const text = stripLeadingMessageId(extractText(payload.content).trim());
    if (text.length === 0 || isPreambleText(text)) {
      continue;
    }

    return text.length > 280 ? `${text.slice(0, 277)}...` : text;
  }

  return '';
}

function recordTimestampMs(record) {
  const ts = record && record.timestamp;
  if (typeof ts !== 'string') {
    return null;
  }

  const ms = Date.parse(ts);
  return Number.isNaN(ms) ? null : ms;
}

function deriveLastActivityMs(records, fallbackPath) {
  for (let index = records.length - 1; index >= 0; index -= 1) {
    const ms = recordTimestampMs(records[index]);
    if (ms !== null) {
      return ms;
    }
  }

  try {
    return fs.statSync(fallbackPath).mtimeMs;
  } catch {
    return null;
  }
}

function deriveModel(meta, records) {
  for (const record of records) {
    if (record && record.type === 'turn_context' && record.payload) {
      if (typeof record.payload.model === 'string' && record.payload.model.length > 0) {
        return record.payload.model;
      }
    }
  }

  if (meta && typeof meta.model === 'string' && meta.model.length > 0) {
    return meta.model;
  }

  if (meta && typeof meta.model_provider === 'string' && meta.model_provider.length > 0) {
    return meta.model_provider;
  }

  return null;
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

function parseCodexRollout(rolloutPath, options = {}) {
  const records = readJsonLines(rolloutPath);
  const metaRecord = records.find(record => record && record.type === 'session_meta');
  const meta = (metaRecord && metaRecord.payload) || {};

  const cwd = typeof meta.cwd === 'string' && meta.cwd.length > 0 ? meta.cwd : null;
  const lastActivityMs = deriveLastActivityMs(records, rolloutPath);
  const isRecent = lastActivityMs !== null && (Date.now() - lastActivityMs) <= RECENT_ACTIVITY_THRESHOLD_MS;

  return {
    sessionId: typeof meta.id === 'string' && meta.id.length > 0
      ? meta.id
      : path.basename(rolloutPath, '.jsonl'),
    sessionPath: rolloutPath,
    cwd,
    branch: resolveGitBranch(cwd, options.resolveBranchImpl),
    objective: deriveObjective(records),
    model: deriveModel(meta, records),
    originator: typeof meta.originator === 'string' ? meta.originator : null,
    cliVersion: typeof meta.cli_version === 'string' ? meta.cli_version : null,
    startedAt: typeof meta.timestamp === 'string' ? meta.timestamp : null,
    recordCount: records.length,
    active: isRecent
  };
}

function createCodexWorktreeAdapter(options = {}) {
  const parseCodexRolloutImpl = options.parseCodexRolloutImpl || parseCodexRollout;
  const persistCanonicalSnapshotImpl = options.persistCanonicalSnapshotImpl || persistCanonicalSnapshot;

  return {
    id: 'codex-worktree',
    description: 'Codex rollout sessions running in git worktrees, normalized to ecc.session.v1',
    targetTypes: ['codex-worktree', 'codex'],
    canOpen(target, context = {}) {
      if (context.adapterId && context.adapterId !== 'codex-worktree') {
        return false;
      }

      if (context.adapterId === 'codex-worktree') {
        return true;
      }

      const cwd = context.cwd || process.cwd();
      return parseCodexTarget(target) !== null || isCodexRolloutFileTarget(target, cwd);
    },
    open(target, context = {}) {
      const cwd = context.cwd || process.cwd();

      return {
        adapterId: 'codex-worktree',
        getSnapshot() {
          const { rolloutPath, sourceTarget } = resolveRolloutPath(target, cwd, options, context);
          const session = parseCodexRolloutImpl(rolloutPath, options);
          const canonicalSnapshot = normalizeCodexWorktreeSession(session, sourceTarget);

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
  createCodexWorktreeAdapter,
  parseCodexTarget,
  parseCodexRollout,
  isCodexRolloutFileTarget,
  findLatestRollout,
  findRolloutById
};
