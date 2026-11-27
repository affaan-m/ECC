#!/usr/bin/env node
'use strict';

const fs = require('fs');
const os = require('os');
const path = require('path');
const crypto = require('crypto');

const DEFAULT_BASH_TIMEOUT_SECONDS = 30 * 60;
const DEFAULT_LIMIT = 10;
const DEFAULT_WAKE_GRACE_MULTIPLIER = 2;
const DEFAULT_WATCH_INTERVAL_SECONDS = 5;

function usage() {
  console.log([
    'Usage:',
    '  node scripts/loop-status.js [--json] [--home <dir>] [--limit <n>] [--watch]',
    '  node scripts/loop-status.js --transcript <session.jsonl> [--json] [--watch]',
    '',
    'Options:',
    '  --json                         Emit machine-readable status JSON',
    '  --home <dir>                   Override the home directory to scan',
    '  --transcript <session.jsonl>    Inspect one transcript directly',
    '  --limit <n>                    Maximum recent transcripts to inspect (default: 10)',
    '  --bash-timeout-seconds <n>     Age before a pending Bash call is stale (default: 1800)',
    '  --wake-grace-multiplier <n>    ScheduleWakeup grace multiplier (default: 2)',
    '  --now <time>                   Override current time (ISO, epoch ms, or "now")',
    '  --exit-code                    Exit 2 on attention signals, 1 on scan errors',
    '  --watch                        Refresh status until interrupted',
    '  --watch-count <n>              Stop after n watch refreshes',
    '  --watch-interval-seconds <n>   Seconds between watch refreshes (default: 5)',
    '  --write-dir <dir>              Write index.json and per-session status snapshots',
    '',
    'Examples:',
    '  node scripts/loop-status.js --json',
    '  node scripts/loop-status.js --transcript ~/.claude/projects/-repo/session.jsonl'
  ].join('\n'));
}

function readValue(args, index, flagName) {
  const value = args[index + 1];
  if (!value || value.startsWith('--')) {
    throw new Error(`${flagName} requires a value`);
  }
  return value;
}

function readPositiveNumber(value, flagName) {
  const number = Number(value);
  if (!Number.isFinite(number) || number <= 0) {
    throw new Error(`${flagName} must be a positive number`);
  }
  return number;
}

function readPositiveInteger(value, flagName) {
  const number = readPositiveNumber(value, flagName);
  if (!Number.isInteger(number)) {
    throw new Error(`${flagName} must be a positive integer`);
  }
  return number;
}

function parseArgs(argv) {
  const args = argv.slice(2);
  const options = {
    bashTimeoutSeconds: DEFAULT_BASH_TIMEOUT_SECONDS,
    exitCode: false,
    home: null,
    json: false,
    limit: DEFAULT_LIMIT,
    now: null,
    showHelp: false,
    transcriptPaths: [],
    watch: false,
    watchCount: null,
    wakeGraceMultiplier: DEFAULT_WAKE_GRACE_MULTIPLIER,
    watchIntervalSeconds: DEFAULT_WATCH_INTERVAL_SECONDS,
    writeDir: null,
  };

  for (let index = 0; index < args.length; index += 1) {
    const arg = args[index];

    if (arg === '--help' || arg === '-h') {
      options.showHelp = true;
    } else if (arg === '--json') {
      options.json = true;
    } else if (arg === '--home') {
      options.home = readValue(args, index, arg);
      index += 1;
    } else if (arg === '--transcript') {
      options.transcriptPaths.push(readValue(args, index, arg));
      index += 1;
    } else if (arg === '--limit') {
      options.limit = readPositiveInteger(readValue(args, index, arg), arg);
      index += 1;
    } else if (arg === '--bash-timeout-seconds') {
      options.bashTimeoutSeconds = readPositiveNumber(readValue(args, index, arg), arg);
      index += 1;
    } else if (arg === '--wake-grace-multiplier') {
      options.wakeGraceMultiplier = readPositiveNumber(readValue(args, index, arg), arg);
      index += 1;
    } else if (arg === '--now') {
      options.now = readValue(args, index, arg);
      index += 1;
    } else if (arg === '--exit-code') {
      options.exitCode = true;
    } else if (arg === '--watch') {
      options.watch = true;
    } else if (arg === '--watch-count') {
      options.watchCount = readPositiveInteger(readValue(args, index, arg), arg);
      index += 1;
    } else if (arg === '--watch-interval-seconds') {
      options.watchIntervalSeconds = readPositiveNumber(readValue(args, index, arg), arg);
      index += 1;
    } else if (arg === '--write-dir') {
      options.writeDir = readValue(args, index, arg);
      index += 1;
    } else {
      throw new Error(`Unknown option: ${arg}`);
    }
  }

  if (options.exitCode && options.watch && options.watchCount === null) {
    throw new Error('--exit-code with --watch requires --watch-count so the process can exit');
  }

  return options;
}

function normalizeOptions(options = {}) {
  return {
    ...options,
    bashTimeoutSeconds: options.bashTimeoutSeconds ?? DEFAULT_BASH_TIMEOUT_SECONDS,
    exitCode: Boolean(options.exitCode),
    limit: options.limit ?? DEFAULT_LIMIT,
    transcriptPaths: options.transcriptPaths || [],
    watch: Boolean(options.watch),
    watchCount: options.watchCount ?? null,
    wakeGraceMultiplier: options.wakeGraceMultiplier ?? DEFAULT_WAKE_GRACE_MULTIPLIER,
    watchIntervalSeconds: options.watchIntervalSeconds ?? DEFAULT_WATCH_INTERVAL_SECONDS,
    writeDir: options.writeDir || null,
  };
}

function getHomeDir(options = {}) {
  if (options.home) {
    return path.resolve(options.home);
  }
  return process.env.HOME || process.env.USERPROFILE || os.homedir();
}

function getNow(options = {}) {
  if (!options.now) {
    return new Date();
  }

  if (options.now === 'now') {
    return new Date();
  }

  const now = /^\d+$/.test(String(options.now))
    ? new Date(Number(options.now))
    : new Date(options.now);
  if (Number.isNaN(now.getTime())) {
    throw new Error('--now must be a valid timestamp');
  }
  return now;
}

function walkJsonlFiles(dir, result = { errors: [], files: [] }) {
  if (!fs.existsSync(dir)) {
    return result;
  }

  let entries;
  try {
    entries = fs.readdirSync(dir, { withFileTypes: true });
  } catch (error) {
    result.errors.push({
      code: error.code || null,
      message: error.message,
      transcriptPath: dir,
    });
    return result;
  }

  for (const entry of entries) {
    const fullPath = path.join(dir, entry.name);
    if (entry.isDirectory()) {
      walkJsonlFiles(fullPath, result);
    } else if (entry.isFile() && entry.name.endsWith('.jsonl')) {
      result.files.push(fullPath);
    }
  }
  return result;
}

function findTranscriptPaths(options = {}) {
  const normalizedOptions = normalizeOptions(options);

  if (options.transcriptPaths && options.transcriptPaths.length > 0) {
    return {
      errors: [],
      transcriptPaths: normalizedOptions.transcriptPaths.map(transcriptPath => path.resolve(transcriptPath)),
    };
  }

  const homeDir = getHomeDir(normalizedOptions);
  const transcriptRoot = path.join(homeDir, '.claude', 'projects');
  const walkResult = walkJsonlFiles(transcriptRoot);
  const errors = [...walkResult.errors];
  const transcriptEntries = [];

  for (const transcriptPath of walkResult.files) {
    try {
      transcriptEntries.push({
        transcriptPath,
        mtimeMs: fs.statSync(transcriptPath).mtimeMs,
      });
    } catch (error) {
      errors.push({
        code: error.code || null,
        message: error.message,
        transcriptPath,
      });
    }
  }

  return {
    errors,
    transcriptPaths: transcriptEntries
    .sort((left, right) => right.mtimeMs - left.mtimeMs)
    .slice(0, normalizedOptions.limit)
    .map(entry => entry.transcriptPath),
  };
}

function parseTimestamp(value) {
  if (typeof value !== 'string' && typeof value !== 'number') {
    return null;
  }

  const date = new Date(value);
  if (Number.isNaN(date.getTime())) {
    return null;
  }
  return date;
}

function getEntryTimestamp(entry) {
  return parseTimestamp(entry.timestamp)
    || parseTimestamp(entry.createdAt)
    || parseTimestamp(entry.created_at)
    || parseTimestamp(entry.message && entry.message.timestamp);
}

function getSessionId(entry, transcriptPath) {
  return entry.sessionId
    || entry.session_id
    || (entry.session && entry.session.id)
    || (entry.message && entry.message.sessionId)
    || path.basename(transcriptPath, '.jsonl');
}

function getContentBlocks(entry) {
  const blocks = [];
  if (entry.message && Array.isArray(entry.message.content)) {
    blocks.push(...entry.message.content);
  }
  if (Array.isArray(entry.content)) {
    blocks.push(...entry.content);
  }
  return blocks;
}

function extractToolUses(entry) {
  const uses = [];

  for (const block of getContentBlocks(entry)) {
    if (block && block.type === 'tool_use' && block.id) {
      uses.push({
        id: block.id,
        input: block.input || {},
        name: block.name || 'unknown',
      });
    }
  }

  const topLevelUse = entry.tool_use || entry.toolUse;
  if (topLevelUse && topLevelUse.id) {
    uses.push({
      id: topLevelUse.id,
      input: topLevelUse.input || {},
      name: topLevelUse.name || 'unknown',
    });
  }

  if (entry.type === 'tool_use' && entry.id) {
    uses.push({
      id: entry.id,
      input: entry.input || {},
      name: entry.name || 'unknown',
    });
  }

  return uses;
}

function extractToolResultIds(entry) {
  const resultIds = [];

  for (const block of getContentBlocks(entry)) {
    if (block && block.type === 'tool_result') {
      const toolUseId = block.tool_use_id || block.toolUseId || block.id;
      if (toolUseId) {
        resultIds.push(toolUseId);
      }
    }
  }

  const topLevelResult = entry.tool_result || entry.toolResult || entry.toolUseResult;
  if (topLevelResult) {
    const toolUseId = topLevelResult.tool_use_id || topLevelResult.toolUseId || topLevelResult.id;
    if (toolUseId) {
      resultIds.push(toolUseId);
    }
  }

  if (entry.type === 'tool_result') {
    const toolUseId = entry.tool_use_id || entry.toolUseId || entry.id;
    if (toolUseId) {
      resultIds.push(toolUseId);
    }
  }

  return resultIds;
}

function isAssistantProgressEntry(entry) {
  return entry.type === 'assistant'
    || (entry.message && entry.message.role === 'assistant')
    || extractToolUses(entry).length > 0;
}

function readJsonlEntries(transcriptPath) {
  const raw = fs.readFileSync(transcriptPath, 'utf8');
  const entries = [];
  let parseErrors = 0;

  for (const line of raw.split(/\r?\n/)) {
    if (!line.trim()) {
      continue;
    }

    try {
      entries.push(JSON.parse(line));
    } catch (_error) {
      parseErrors += 1;
    }
  }

  return { entries, parseErrors };
}

function readDelaySeconds(input) {
  const delay = input && (
    input.delaySeconds
    || input.delay_seconds
    || input.seconds
    || input.delay
  );
  const number = Number(delay);
  if (!Number.isFinite(number) || number <= 0) {
    return null;
  }
  return number;
}

function toIso(date) {
  return date ? date.toISOString() : null;
}

function buildRecommendation(signals) {
  if (signals.some(signal => signal.type === 'pending_bash_tool_result')) {
    return 'Open the transcript or interrupt the parked session; the Bash result appears stale.';
  }

  if (signals.some(signal => signal.type === 'schedule_wakeup_overdue')) {
    return 'Open the transcript or interrupt the parked session; the scheduled wake is overdue.';
  }

  if (signals.some(signal => signal.type === 'transcript_parse_errors')) {
    return 'Inspect the transcript; some JSONL lines could not be parsed.';
  }

  return 'No stale ScheduleWakeup or Bash waits detected.';
}

function analyzeTranscript(transcriptPath, options = {}) {
  const normalizedOptions = normalizeOptions(options);
  const absoluteTranscriptPath = path.resolve(transcriptPath);
  const now = normalizedOptions.nowDate || getNow(normalizedOptions);
  const nowMs = now.getTime();
  const { entries, parseErrors } = readJsonlEntries(absoluteTranscriptPath);
  const pendingTools = new Map();
  let latestAssistantProgressAt = null;
  let lastEventAt = null;
  let latestWake = null;
  let sessionId = path.basename(absoluteTranscriptPath, '.jsonl');

  for (const entry of entries) {
    sessionId = getSessionId(entry, absoluteTranscriptPath) || sessionId;
    const timestamp = getEntryTimestamp(entry);
    if (timestamp && (!lastEventAt || timestamp.getTime() > lastEventAt.getTime())) {
      lastEventAt = timestamp;
    }
    if (
      timestamp
      && isAssistantProgressEntry(entry)
      && (!latestAssistantProgressAt || timestamp.getTime() > latestAssistantProgressAt.getTime())
    ) {
      latestAssistantProgressAt = timestamp;
    }

    for (const toolUse of extractToolUses(entry)) {
      const startedAt = timestamp || lastEventAt;
      pendingTools.set(toolUse.id, {
        command: toolUse.input && toolUse.input.command ? String(toolUse.input.command) : null,
        input: toolUse.input || {},
        name: toolUse.name,
        startedAt: toIso(startedAt),
        toolUseId: toolUse.id,
      });

      if (toolUse.name === 'ScheduleWakeup') {
        const delaySeconds = readDelaySeconds(toolUse.input);
        if (delaySeconds && startedAt) {
          const dueAt = new Date(startedAt.getTime() + delaySeconds * 1000);
          latestWake = {
            delaySeconds,
            dueAt: dueAt.toISOString(),
            reason: toolUse.input && toolUse.input.reason ? String(toolUse.input.reason) : null,
            scheduledAt: startedAt.toISOString(),
            toolUseId: toolUse.id,
          };
        }
      }
    }

    for (const toolUseId of extractToolResultIds(entry)) {
      pendingTools.delete(toolUseId);
    }
  }

  const pendingToolList = Array.from(pendingTools.values()).map(tool => {
    const startedAt = parseTimestamp(tool.startedAt);
    return {
      ...tool,
      ageSeconds: startedAt ? Math.max(0, Math.floor((nowMs - startedAt.getTime()) / 1000)) : null,
    };
  });

  const signals = [];
  if (latestWake) {
    const scheduledAt = parseTimestamp(latestWake.scheduledAt);
    const dueAt = parseTimestamp(latestWake.dueAt);
    const thresholdMs = scheduledAt
      ? scheduledAt.getTime() + latestWake.delaySeconds * normalizedOptions.wakeGraceMultiplier * 1000
      : null;
    const hasAssistantProgressAfterDue = Boolean(
      dueAt
      && latestAssistantProgressAt
      && latestAssistantProgressAt.getTime() >= dueAt.getTime()
    );

    if (thresholdMs && nowMs >= thresholdMs && !hasAssistantProgressAfterDue) {
      signals.push({
        delaySeconds: latestWake.delaySeconds,
        dueAt: latestWake.dueAt,
        overdueSeconds: dueAt ? Math.max(0, Math.floor((nowMs - dueAt.getTime()) / 1000)) : null,
        scheduledAt: latestWake.scheduledAt,
        toolUseId: latestWake.toolUseId,
        type: 'schedule_wakeup_overdue',
      });
    }
  }

  for (const tool of pendingToolList) {
    if (
      tool.name === 'Bash'
      && tool.ageSeconds !== null
      && tool.ageSeconds >= normalizedOptions.bashTimeoutSeconds
    ) {
      signals.push({
        ageSeconds: tool.ageSeconds,
        command: tool.command,
        startedAt: tool.startedAt,
        thresholdSeconds: normalizedOptions.bashTimeoutSeconds,
        toolUseId: tool.toolUseId,
        type: 'pending_bash_tool_result',
      });
    }
  }

  if (parseErrors > 0) {
    signals.push({
      count: parseErrors,
      type: 'transcript_parse_errors',
    });
  }

  return {
    eventCount: entries.length,
    lastEventAt: toIso(lastEventAt),
    latestWake,
    parseErrors,
    pendingTools: pendingToolList,
    projectSlug: path.basename(path.dirname(absoluteTranscriptPath)),
    recommendedAction: buildRecommendation(signals),
    sessionId,
    signals,
    state: signals.length > 0 ? 'attention' : 'ok',
    transcriptPath: absoluteTranscriptPath,
  };
}

function buildStatus(options = {}) {
  const normalizedOptions = normalizeOptions(options);
  const nowDate = getNow(normalizedOptions);
  const mergedOptions = {
    ...normalizedOptions,
    nowDate,
  };
  const homeDir = getHomeDir(normalizedOptions);
  const { errors, transcriptPaths } = findTranscriptPaths(normalizedOptions);
  const sessions = [];

  for (const transcriptPath of transcriptPaths) {
    try {
      sessions.push(analyzeTranscript(transcriptPath, mergedOptions));
    } catch (error) {
      errors.push({
        code: error.code || null,
        message: error.message,
        transcriptPath,
      });
    }
  }

  sessions.sort((left, right) => {
    if (left.state !== right.state) {
      return left.state === 'attention' ? -1 : 1;
    }
    return String(right.lastEventAt || '').localeCompare(String(left.lastEventAt || ''));
  });

  return {
    generatedAt: nowDate.toISOString(),
    errors,
    schemaVersion: 'ecc.loop-status.v1',
    sessions,
    source: {
      bashTimeoutSeconds: normalizedOptions.bashTimeoutSeconds,
      homeDir,
      limit: normalizedOptions.limit,
      transcriptCount: transcriptPaths.length,
      transcriptRoot: path.join(homeDir, '.claude', 'projects'),
      wakeGraceMultiplier: normalizedOptions.wakeGraceMultiplier,
    },
  };
}

function formatSignals(signals) {
  if (signals.length === 0) {
    return 'none';
  }
  return signals.map(signal => signal.type).join(', ');
}

function formatText(payload) {
  const skippedLines = payload.errors.map(error => `  - ${error.transcriptPath}: ${error.message}`);

  if (payload.sessions.length === 0) {
    const lines = [
      `ECC loop status (${payload.generatedAt})`,
      skippedLines.length > 0
        ? 'No readable Claude transcript JSONL files were found.'
        : `No Claude transcript JSONL files found under ${payload.source.transcriptRoot}.`,
    ];
    if (skippedLines.length > 0) {
      lines.push('Skipped transcript errors:');
      lines.push(...skippedLines);
    }
    return lines.join('\n');
  }

  const lines = [`ECC loop status (${payload.generatedAt})`];
  for (const session of payload.sessions) {
    lines.push(`- ${session.sessionId} [${session.state}] ${session.transcriptPath}`);
    lines.push(`  last event: ${session.lastEventAt || 'unknown'}; events: ${session.eventCount}`);
    lines.push(`  signals: ${formatSignals(session.signals)}`);
    lines.push(`  action: ${session.recommendedAction}`);
  }
  if (skippedLines.length > 0) {
    lines.push('Skipped transcript errors:');
    lines.push(...skippedLines);
  }
  return lines.join('\n');
}

function hashString(value) {
  return crypto.createHash('sha256').update(String(value)).digest('hex');
}

function isWindowsReservedBasename(value) {
  const basename = String(value).split('.')[0];
  return /^(con|prn|aux|nul|com[1-9]|lpt[1-9])$/i.test(basename);
}

function sanitizeSnapshotName(value, fallback = 'session') {
  const raw = String(value || '').trim() || fallback;
  const sanitized = raw.replace(/[^a-zA-Z0-9._-]/g, '_').replace(/^_+|_+$/g, '');
  if (sanitized && sanitized.length <= 96 && !isWindowsReservedBasename(sanitized)) {
    return sanitized;
  }
  if (sanitized && isWindowsReservedBasename(sanitized)) {
    const firstDotIndex = sanitized.indexOf('.');
    const hashSuffix = hashString(raw).slice(0, 8);
    if (firstDotIndex === -1) {
      return `${sanitized}-${hashSuffix}`;
    }
    return `${sanitized.slice(0, firstDotIndex)}-${hashSuffix}${sanitized.slice(firstDotIndex)}`;
  }

  const prefix = sanitized ? sanitized.slice(0, 48).replace(/[._-]+$/g, '') : fallback;
  return `${prefix || fallback}-${hashString(raw).slice(0, 12)}`;
}

function atomicWriteJson(filePath, payload) {
  const data = JSON.stringify(payload, null, 2) + '\n';
  const tempPath = `${filePath}.${process.pid}.${Date.now()}.${Math.random().toString(16).slice(2)}.tmp`;
  fs.writeFileSync(tempPath, data, 'utf8');
  try {
    fs.renameSync(tempPath, filePath);
  } catch (error) {
    try {
      fs.unlinkSync(tempPath);
    } catch (cleanupError) {
      if (cleanupError.code !== 'ENOENT') {
        console.error(`[loop-status] WARNING: could not remove temporary snapshot file ${tempPath}: ${cleanupError.message}`);
      }
    }
    throw error;
  }
}

function getSnapshotPath(outputDir, session, usedNames) {
  const baseName = sanitizeSnapshotName(session.sessionId);
  const hashSuffix = hashString(session.transcriptPath || session.sessionId).slice(0, 8);
  let attempt = 0;

  while (attempt < 1000) {
    const suffix = attempt === 0 ? '' : `-${hashSuffix}${attempt === 1 ? '' : `-${attempt}`}`;
    const fileName = `${baseName}${suffix}.json`;
    if (!usedNames.has(fileName)) {
      usedNames.add(fileName);
      return path.join(outputDir, fileName);
    }
    attempt += 1;
  }

  throw new Error(`Could not allocate a snapshot filename for session ${session.sessionId}`);
}

function writeStatusSnapshots(payload, writeDir) {
  if (!writeDir) {
    return null;
  }

  const outputDir = path.resolve(writeDir);
  fs.mkdirSync(outputDir, { recursive: true });

  const usedNames = new Set(['index.json']);
  const sessions = payload.sessions.map(session => {
    const snapshotPath = getSnapshotPath(outputDir, session, usedNames);
    atomicWriteJson(snapshotPath, {
      generatedAt: payload.generatedAt,
      schemaVersion: 'ecc.loop-status.session.v1',
      session,
    });

    return {
      lastEventAt: session.lastEventAt,
      sessionId: session.sessionId,
      signalTypes: session.signals.map(signal => signal.type),
      snapshotPath,
      state: session.state,
      transcriptPath: session.transcriptPath,
    };
  });

  const indexPath = path.join(outputDir, 'index.json');
  atomicWriteJson(indexPath, {
    errors: payload.errors,
    generatedAt: payload.generatedAt,
    schemaVersion: 'ecc.loop-status.index.v1',
    sessionCount: payload.sessions.length,
    sessions,
    source: payload.source,
  });

  return {
    indexPath,
    sessionCount: payload.sessions.length,
  };
}

function tryWriteStatusSnapshots(payload, options) {
  if (!options.writeDir) {
    return null;
  }

  try {
    return writeStatusSnapshots(payload, options.writeDir);
  } catch (error) {
    console.error(`[loop-status] WARNING: could not write status snapshots: ${error.message}`);
    return null;
  }
}

function sleep(ms) {
  return new Promise(resolve => setTimeout(resolve, ms));
}

function writeStatus(payload, options) {
  if (options.json) {
    console.log(options.watch ? JSON.stringify(payload) : JSON.stringify(payload, null, 2));
  } else {
    console.log(formatText(payload));
  }
}

function getStatusExitCode(payload) {
  if (payload.sessions.some(session => session.state === 'attention')) {
    return 2;
  }
  if (payload.errors.length > 0) {
    return 1;
  }
  return 0;
}

async function runWatch(options) {
  const normalizedOptions = normalizeOptions(options);
  let iteration = 0;
  let exitCode = 0;

  while (normalizedOptions.watchCount === null || iteration < normalizedOptions.watchCount) {
    if (iteration > 0 && !normalizedOptions.json) {
      console.log('');
    }
    const payload = buildStatus(normalizedOptions);
    tryWriteStatusSnapshots(payload, normalizedOptions);
    writeStatus(payload, normalizedOptions);
    exitCode = Math.max(exitCode, getStatusExitCode(payload));
    iteration += 1;

    if (normalizedOptions.watchCount !== null && iteration >= normalizedOptions.watchCount) {
      break;
    }

    await sleep(normalizedOptions.watchIntervalSeconds * 1000);
  }

  return exitCode;
}

async function main() {
  const options = parseArgs(process.argv);
  if (options.showHelp) {
    usage();
    return;
  }

  if (options.watch) {
    const exitCode = await runWatch(options);
    if (options.exitCode) {
      process.exitCode = exitCode;
    }
    return;
  }

  const payload = buildStatus(options);
  tryWriteStatusSnapshots(payload, options);
  writeStatus(payload, options);
  if (options.exitCode) {
    process.exitCode = getStatusExitCode(payload);
  }
}

if (require.main === module) {
  main().catch(error => {
    console.error(`[loop-status] ${error.message}`);
    process.exit(1);
  });
}

module.exports = {
  analyzeTranscript,
  buildStatus,
  extractToolResultIds,
  extractToolUses,
  getStatusExitCode,
  parseArgs,
  runWatch,
  tryWriteStatusSnapshots,
  writeStatusSnapshots,
};
