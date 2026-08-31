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

const { getSessionsDir } = require('../lib/utils');
const { emptyState, isOptedOut, recordMilestone, selectMilestone, successFeedbackLines } = require('../lib/success-feedback');

const STATE_FILENAME = '.ecc-success-feedback.json';

function stateFilePath() {
  return path.join(getSessionsDir(), STATE_FILENAME);
}

function countSessions(sessionsDir) {
  try {
    return fs.readdirSync(sessionsDir, { withFileTypes: true }).filter(entry => entry.isFile() && entry.name.endsWith('.md')).length;
  } catch {
    return 0;
  }
}

function readState(filePath) {
  try {
    return JSON.parse(fs.readFileSync(filePath, 'utf8'));
  } catch {
    return emptyState();
  }
}

function writeState(filePath, state) {
  try {
    fs.mkdirSync(path.dirname(filePath), { recursive: true });
    fs.writeFileSync(filePath, `${JSON.stringify(state, null, 2)}\n`, 'utf8');
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

  const sessionsDir = getSessionsDir();
  const milestone = selectMilestone(countSessions(sessionsDir), readState(stateFilePath()));
  if (milestone === null) {
    return { exitCode: 0 };
  }

  // Record before printing: a failed write must not cause a repeat prompt loop.
  if (!writeState(stateFilePath(), recordMilestone(readState(stateFilePath()), milestone))) {
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
