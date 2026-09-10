#!/usr/bin/env node
/**
 * SessionEnd hook - ask a working install for feedback, at most twice.
 *
 * Counts completed ECC sessions on disk and, on the milestones in
 * lib/success-feedback.js, prints one short prompt to stderr. It never blocks,
 * never uploads anything, and never reads project files.
 *
 * Opt out with ECC_NO_FEEDBACK_PROMPT=1.
 */

'use strict';

const fs = require('fs');
const path = require('path');

const { getSessionsDir, getSessionSearchDirs } = require('../lib/utils');
const { writeFileAtomic } = require('../lib/atomic-write');
const { emptyState, isOptedOut, recordMilestone, selectMilestone, successFeedbackLines } = require('../lib/success-feedback');

const STATE_FILENAME = '.ecc-success-feedback.json';

// Real session records are written as `*-session.tmp` (see session-manager.js);
// `.tmp` is a historical naming choice, not a transient file. Counting `.md`
// files here would silently count zero sessions forever.
const SESSION_FILE_SUFFIX = '-session.tmp';

function stateFilePath() {
  return path.join(getSessionsDir(), STATE_FILENAME);
}

/**
 * Count completed sessions across the canonical and legacy session
 * directories (see getSessionSearchDirs), so an upgraded or migrated install
 * does not lose credit for sessions run before the upgrade.
 */
function countSessions(sessionsDirs = getSessionSearchDirs()) {
  const dirs = Array.isArray(sessionsDirs) ? sessionsDirs : [sessionsDirs];

  return dirs.reduce((total, dir) => {
    try {
      const count = fs.readdirSync(dir, { withFileTypes: true })
        .filter(entry => entry.isFile() && entry.name.endsWith(SESSION_FILE_SUFFIX))
        .length;
      return total + count;
    } catch {
      return total;
    }
  }, 0);
}

function readState(filePath) {
  try {
    return JSON.parse(fs.readFileSync(filePath, 'utf8'));
  } catch {
    return emptyState();
  }
}

// Atomic write (temp file + fsync + rename) so a crash or a concurrent
// session can never leave a partially written or corrupt state file.
function writeState(filePath, state) {
  try {
    writeFileAtomic(filePath, `${JSON.stringify(state, null, 2)}\n`);
    return true;
  } catch {
    return false;
  }
}

/**
 * Hook entry point. Returns stderr lines only when a milestone is due, and
 * always exits 0 so a feedback prompt can never break a session.
 */
function run() {
  if (isOptedOut()) {
    return { exitCode: 0 };
  }

  const currentState = readState(stateFilePath());
  const milestone = selectMilestone(countSessions(), currentState);
  if (milestone === null) {
    return { exitCode: 0 };
  }

  // Record before printing: a failed write must not cause a repeat prompt loop.
  if (!writeState(stateFilePath(), recordMilestone(currentState, milestone))) {
    return { exitCode: 0 };
  }

  return { exitCode: 0, stderr: successFeedbackLines(milestone).join('\n') };
}

if (require.main === module) {
  try {
    const result = run();
    if (result.stderr) {
      process.stderr.write(`${result.stderr}\n`);
    }
  } catch {
    // Never fail a session over a feedback prompt.
  }
  process.exit(0);
}

module.exports = { run, countSessions, STATE_FILENAME };
