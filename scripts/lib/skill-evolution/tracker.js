'use strict';

const fs = require('fs');
const os = require('os');
const path = require('path');

const { ensureDir } = require('../utils');

const VALID_OUTCOMES = new Set(['success', 'failure', 'partial']);
const VALID_FEEDBACK = new Set(['accepted', 'corrected', 'rejected']);

// Retention bound for the JSONL sink. The dashboard only aggregates recent
// runs, so an unbounded append-only file is pure cost. Trim from the front
// once the file grows past the cap.
const MAX_RUN_RECORDS = 5000;
// Owner-only. The sink lives under the user's home and is local telemetry;
// nothing else on the machine needs to read it.
const RUNS_FILE_MODE = 0o600;

function resolveHomeDir(homeDir) {
  return homeDir ? path.resolve(homeDir) : os.homedir();
}

function getRunsFilePath(options = {}) {
  if (options.runsFilePath) {
    return path.resolve(options.runsFilePath);
  }

  return path.join(resolveHomeDir(options.homeDir), '.claude', 'state', 'skill-runs.jsonl');
}

function toNullableNumber(value, fieldName) {
  if (value === null || typeof value === 'undefined') {
    return null;
  }

  const numericValue = Number(value);
  if (!Number.isFinite(numericValue)) {
    throw new Error(`${fieldName} must be a number`);
  }

  return numericValue;
}

function normalizeExecutionRecord(input, options = {}) {
  if (!input || typeof input !== 'object' || Array.isArray(input)) {
    throw new Error('skill execution payload must be an object');
  }

  const skillId = input.skill_id || input.skillId;
  const skillVersion = input.skill_version || input.skillVersion;
  const taskDescription = input.task_description || input.task_attempted || input.taskAttempted;
  const outcome = input.outcome;
  const recordedAt = input.recorded_at || options.now || new Date().toISOString();
  const userFeedback = input.user_feedback || input.userFeedback || null;

  if (typeof skillId !== 'string' || skillId.trim().length === 0) {
    throw new Error('skill_id is required');
  }

  if (typeof skillVersion !== 'string' || skillVersion.trim().length === 0) {
    throw new Error('skill_version is required');
  }

  if (typeof taskDescription !== 'string' || taskDescription.trim().length === 0) {
    throw new Error('task_description is required');
  }

  if (!VALID_OUTCOMES.has(outcome)) {
    throw new Error('outcome must be one of success, failure, or partial');
  }

  if (userFeedback !== null && !VALID_FEEDBACK.has(userFeedback)) {
    throw new Error('user_feedback must be accepted, corrected, rejected, or null');
  }

  if (Number.isNaN(Date.parse(recordedAt))) {
    throw new Error('recorded_at must be an ISO timestamp');
  }

  return {
    skill_id: skillId,
    skill_version: skillVersion,
    task_description: taskDescription,
    outcome,
    failure_reason: input.failure_reason || input.failureReason || null,
    tokens_used: toNullableNumber(input.tokens_used ?? input.tokensUsed, 'tokens_used'),
    duration_ms: toNullableNumber(input.duration_ms ?? input.durationMs, 'duration_ms'),
    user_feedback: userFeedback,
    recorded_at: recordedAt,
  };
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
        rows.push(JSON.parse(line));
      } catch {
        // Ignore malformed rows so analytics remain best-effort.
      }
      return rows;
    }, []);
}

// Append one record to the JSONL sink with owner-only permissions, then
// enforce the retention cap. `fs.appendFileSync`'s mode only applies when it
// creates the file, so an existing world-readable sink is chmod'd on the way
// past — cheap, and it repairs files written before this bound existed.
function appendRunRecord(runsFilePath, record, options = {}) {
  const maxRecords = Number.isInteger(options.maxRecords) && options.maxRecords > 0
    ? options.maxRecords
    : MAX_RUN_RECORDS;

  ensureDir(path.dirname(runsFilePath));
  fs.appendFileSync(runsFilePath, `${JSON.stringify(record)}\n`, { encoding: 'utf8', mode: RUNS_FILE_MODE });

  try {
    fs.chmodSync(runsFilePath, RUNS_FILE_MODE);
  } catch {
    // Windows and some mounts do not support POSIX modes; the record still lands.
  }

  pruneRunRecords(runsFilePath, maxRecords);
}

// Keep only the newest `maxRecords` lines. Rewrites the whole file, which is
// fine because the file is bounded by this very cap; it only runs on the
// appends that actually cross the line.
function pruneRunRecords(runsFilePath, maxRecords) {
  try {
    const lines = fs.readFileSync(runsFilePath, 'utf8').split('\n').filter(Boolean);
    if (lines.length <= maxRecords) {
      return;
    }
    fs.writeFileSync(
      runsFilePath,
      `${lines.slice(-maxRecords).join('\n')}\n`,
      { encoding: 'utf8', mode: RUNS_FILE_MODE }
    );
  } catch {
    // Retention is best-effort; never fail a recorded run over it.
  }
}

function recordSkillExecution(input, options = {}) {
  const record = normalizeExecutionRecord(input, options);

  if (options.stateStore && typeof options.stateStore.recordSkillExecution === 'function') {
    try {
      const result = options.stateStore.recordSkillExecution(record);
      return {
        storage: 'state-store',
        record,
        result,
      };
    } catch {
      // Fall back to JSONL until the formal state-store exists on this branch.
    }
  }

  const runsFilePath = getRunsFilePath(options);
  appendRunRecord(runsFilePath, record, options);

  return {
    storage: 'jsonl',
    path: runsFilePath,
    record,
  };
}

function readSkillExecutionRecords(options = {}) {
  if (options.stateStore && typeof options.stateStore.listSkillExecutionRecords === 'function') {
    return options.stateStore.listSkillExecutionRecords();
  }

  return readJsonl(getRunsFilePath(options));
}

module.exports = {
  MAX_RUN_RECORDS,
  RUNS_FILE_MODE,
  VALID_FEEDBACK,
  VALID_OUTCOMES,
  getRunsFilePath,
  normalizeExecutionRecord,
  readSkillExecutionRecords,
  recordSkillExecution,
};
