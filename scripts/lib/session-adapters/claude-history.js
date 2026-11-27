'use strict';

const fs = require('fs');
const path = require('path');

const sessionManager = require('../session-manager');
const sessionAliases = require('../session-aliases');
const { normalizeClaudeHistorySession, persistCanonicalSnapshot } = require('./canonical-session');

function parseClaudeTarget(target) {
  if (typeof target !== 'string') {
    return null;
  }

  for (const prefix of ['claude-history:', 'claude:', 'history:']) {
    if (target.startsWith(prefix)) {
      return target.slice(prefix.length).trim();
    }
  }

  return null;
}

function isSessionFileTarget(target, cwd) {
  if (typeof target !== 'string' || target.length === 0) {
    return false;
  }

  const absoluteTarget = path.resolve(cwd, target);
  return fs.existsSync(absoluteTarget)
    && fs.statSync(absoluteTarget).isFile()
    && absoluteTarget.endsWith('.tmp');
}

function hydrateSessionFromPath(sessionPath) {
  const filename = path.basename(sessionPath);
  const parsed = sessionManager.parseSessionFilename(filename);
  if (!parsed) {
    throw new Error(`Unsupported session file: ${sessionPath}`);
  }

  const content = sessionManager.getSessionContent(sessionPath);
  const stats = fs.statSync(sessionPath);

  return {
    ...parsed,
    sessionPath,
    content,
    metadata: sessionManager.parseSessionMetadata(content),
    stats: sessionManager.getSessionStats(content || ''),
    size: stats.size,
    modifiedTime: stats.mtime,
    createdTime: stats.birthtime || stats.ctime
  };
}

function resolveSessionRecord(target, cwd) {
  const explicitTarget = parseClaudeTarget(target);

  if (explicitTarget) {
    if (explicitTarget === 'latest') {
      const [latest] = sessionManager.getAllSessions({ limit: 1 }).sessions;
      if (!latest) {
        throw new Error('No Claude session history found');
      }

      return {
        session: sessionManager.getSessionById(latest.filename, true),
        sourceTarget: {
          type: 'claude-history',
          value: 'latest'
        }
      };
    }

    const alias = sessionAliases.resolveAlias(explicitTarget);
    if (alias) {
      return {
        session: hydrateSessionFromPath(alias.sessionPath),
        sourceTarget: {
          type: 'claude-alias',
          value: explicitTarget
        }
      };
    }

    const session = sessionManager.getSessionById(explicitTarget, true);
    if (!session) {
      throw new Error(`Claude session not found: ${explicitTarget}`);
    }

    return {
      session,
      sourceTarget: {
        type: 'claude-history',
        value: explicitTarget
      }
    };
  }

  if (isSessionFileTarget(target, cwd)) {
    return {
      session: hydrateSessionFromPath(path.resolve(cwd, target)),
      sourceTarget: {
        type: 'session-file',
        value: path.resolve(cwd, target)
      }
    };
  }

  throw new Error(`Unsupported Claude session target: ${target}`);
}

function createClaudeHistoryAdapter(options = {}) {
  const persistCanonicalSnapshotImpl = options.persistCanonicalSnapshotImpl || persistCanonicalSnapshot;

  return {
    id: 'claude-history',
    description: 'Claude local session history and session-file snapshots',
    targetTypes: ['claude-history', 'claude-alias', 'session-file'],
    canOpen(target, context = {}) {
      if (context.adapterId && context.adapterId !== 'claude-history') {
        return false;
      }

      if (context.adapterId === 'claude-history') {
        return true;
      }

      const cwd = context.cwd || process.cwd();
      return parseClaudeTarget(target) !== null || isSessionFileTarget(target, cwd);
    },
    open(target, context = {}) {
      const cwd = context.cwd || process.cwd();

      return {
        adapterId: 'claude-history',
        getSnapshot() {
          const { session, sourceTarget } = resolveSessionRecord(target, cwd);
          const canonicalSnapshot = normalizeClaudeHistorySession(session, sourceTarget);

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
  createClaudeHistoryAdapter,
  isSessionFileTarget,
  parseClaudeTarget
};
