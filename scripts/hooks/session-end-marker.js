#!/usr/bin/env node
'use strict';

/**
 * Session end marker hook - performs lightweight observer cleanup and
 * outputs stdin to stdout unchanged. Exports run() for in-process execution.
 */

const {
  resolveProjectContext,
  getAliasContexts,
  removeSessionLease,
  listSessionLeases,
  stopObserverForContext,
  resolveSessionId
} = require('../lib/observer-sessions');
const { resolveHookSessionId } = require('../lib/hook-session');

function log(message) {
  process.stderr.write(`[SessionEnd] ${message}\n`);
}

function run(rawInput) {
  const output = rawInput || '';
  const sessionId = resolveSessionId(resolveHookSessionId(output));

  if (!sessionId) {
    log('No session ID available; skipping observer cleanup');
    return output;
  }

  try {
    const observerContext = resolveProjectContext();
    // Leases from sessions that started before a remote was added sit under the root's older ids.
    const contexts = [observerContext, ...getAliasContexts(observerContext)];
    for (const context of contexts) removeSessionLease(context, sessionId);
    const remainingLeases = contexts.reduce((count, context) => count + listSessionLeases(context).length, 0);

    if (remainingLeases === 0) {
      for (const context of contexts) {
        if (stopObserverForContext(context)) {
          log(`Stopped observer for project ${context.projectId} after final session lease ended`);
        } else if (context === observerContext) {
          log(`No running observer to stop for project ${context.projectId}`);
        }
      }
    } else {
      log(`Retained observer for project ${observerContext.projectId}; ${remainingLeases} session lease(s) remain`);
    }
  } catch (err) {
    log(`Observer cleanup skipped: ${err.message}`);
  }

  return output;
}

// Legacy CLI execution (when run directly)
if (require.main === module) {
  const MAX_STDIN = 1024 * 1024;
  let raw = '';
  process.stdin.setEncoding('utf8');
  process.stdin.on('data', chunk => {
    if (raw.length < MAX_STDIN) {
      const remaining = MAX_STDIN - raw.length;
      raw += chunk.substring(0, remaining);
    }
  });
  process.stdin.on('end', () => {
    process.stdout.write(run(raw));
  });
}

module.exports = { run };
