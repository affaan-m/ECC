#!/usr/bin/env node
/**
 * PreToolUse Hook: GateGuard Fact-Forcing Gate
 *
 * Forces Claude to investigate before editing files or running commands.
 * Instead of asking "are you sure?" (which LLMs always answer "yes"),
 * this hook demands concrete facts: importers, public API, data schemas.
 *
 * The act of investigation creates awareness that self-evaluation never did.
 *
 * Gates:
 *   - Edit/Write: list importers, affected API, verify data schemas, quote instruction
 *   - Bash (destructive): list targets, rollback plan, quote instruction
 *   - Bash (routine): quote current instruction (once per session)
 *
 * Compatible with run-with-flags.js via module.exports.run().
 * Cross-platform (Windows, macOS, Linux).
 *
 * Full package with config support: pip install gateguard-ai
 * Repo: https://github.com/zunoworks/gateguard
 */

'use strict';

const crypto = require('crypto');
const fs = require('fs');
const path = require('path');

// Session state — scoped per session to avoid cross-session races.
const STATE_DIR = process.env.GATEGUARD_STATE_DIR || path.join(process.env.HOME || process.env.USERPROFILE || '/tmp', '.gateguard');
let activeStateFile = null;

// State expires after 30 minutes of inactivity
const SESSION_TIMEOUT_MS = 30 * 60 * 1000;
const READ_HEARTBEAT_MS = 60 * 1000;

// Maximum checked entries to prevent unbounded growth
const MAX_CHECKED_ENTRIES = 500;
const MAX_SESSION_KEYS = 50;
const ROUTINE_BASH_SESSION_KEY = '__bash_session__';

const _BASE_DESTRUCTIVE_PATTERN = '\\b(rm\\s+-rf|git\\s+reset\\s+--hard|git\\s+checkout\\s+--|git\\s+clean\\s+-f|drop\\s+table|delete\\s+from|truncate|git\\s+push\\s+--force|dd\\s+if=)\\b';
const MAX_EXTRA_DESTRUCTIVE_PATTERNS = 20;

function escapeRegexLiteral(value) {
  return String(value).replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

function readExtraDestructivePatterns() {
  const extraRaw = (process.env.GATEGUARD_BASH_EXTRA_DESTRUCTIVE || '').trim();
  if (!extraRaw) {
    return [];
  }

  return extraRaw
    .split('|')
    .map(pattern => pattern.trim())
    .filter(Boolean)
    .slice(0, MAX_EXTRA_DESTRUCTIVE_PATTERNS)
    .map(escapeRegexLiteral);
}

function buildDestructiveRegex() {
  const extraPatterns = readExtraDestructivePatterns();
  const pattern = extraPatterns.length > 0
    ? `(${_BASE_DESTRUCTIVE_PATTERN})|(${extraPatterns.join('|')})`
    : _BASE_DESTRUCTIVE_PATTERN;
  return new RegExp(pattern, 'i');
}

const DESTRUCTIVE_BASH = buildDestructiveRegex();

// --- State management (per-session, atomic writes, bounded) ---

function sanitizeSessionKey(value) {
  const raw = String(value || '').trim();
  if (!raw) {
    return '';
  }

  const sanitized = raw.replace(/[^a-zA-Z0-9_-]/g, '_');
  if (sanitized && sanitized.length <= 64) {
    return sanitized;
  }

  return hashSessionKey('sid', raw);
}

function hashSessionKey(prefix, value) {
  return `${prefix}-${crypto.createHash('sha256').update(String(value)).digest('hex').slice(0, 24)}`;
}

function resolveSessionKey(data) {
  const directCandidates = [
    data && data.session_id,
    data && data.sessionId,
    data && data.session && data.session.id,
    process.env.CLAUDE_SESSION_ID,
    process.env.ECC_SESSION_ID,
  ];

  for (const candidate of directCandidates) {
    const sanitized = sanitizeSessionKey(candidate);
    if (sanitized) {
      return sanitized;
    }
  }

  const transcriptPath = (data && (data.transcript_path || data.transcriptPath)) || process.env.CLAUDE_TRANSCRIPT_PATH;
  if (transcriptPath && String(transcriptPath).trim()) {
    return hashSessionKey('tx', path.resolve(String(transcriptPath).trim()));
  }

  const projectFingerprint = process.env.CLAUDE_PROJECT_DIR || process.cwd();
  return hashSessionKey('proj', path.resolve(projectFingerprint));
}

function getStateFile(data) {
  if (!activeStateFile) {
    const sessionKey = resolveSessionKey(data);
    activeStateFile = path.join(STATE_DIR, `state-${sessionKey}.json`);
  }
  return activeStateFile;
}

function loadState() {
  const stateFile = getStateFile();
  try {
    if (fs.existsSync(stateFile)) {
      const state = JSON.parse(fs.readFileSync(stateFile, 'utf8'));
      const lastActive = state.last_active || 0;
      if (Date.now() - lastActive > SESSION_TIMEOUT_MS) {
        try { fs.unlinkSync(stateFile); } catch (_) { /* ignore */ }
        return { checked: [], last_active: Date.now() };
      }
      return state;
    }
  } catch (_) { /* ignore */ }
  return { checked: [], last_active: Date.now() };
}

function pruneCheckedEntries(checked) {
  if (checked.length <= MAX_CHECKED_ENTRIES) {
    return checked;
  }

  const preserved = checked.includes(ROUTINE_BASH_SESSION_KEY) ? [ROUTINE_BASH_SESSION_KEY] : [];
  const sessionKeys = checked.filter(k => k.startsWith('__') && k !== ROUTINE_BASH_SESSION_KEY);
  const fileKeys = checked.filter(k => !k.startsWith('__'));
  const remainingSessionSlots = Math.max(MAX_SESSION_KEYS - preserved.length, 0);
  const cappedSession = sessionKeys.slice(-remainingSessionSlots);
  const remainingFileSlots = Math.max(MAX_CHECKED_ENTRIES - preserved.length - cappedSession.length, 0);
  const cappedFiles = fileKeys.slice(-remainingFileSlots);
  return [...preserved, ...cappedSession, ...cappedFiles];
}

function saveState(state) {
  const stateFile = getStateFile();
  let tmpFile = null;
  try {
    state.last_active = Date.now();
    state.checked = pruneCheckedEntries(state.checked);
    fs.mkdirSync(STATE_DIR, { recursive: true });
    // Atomic write: temp file + rename prevents partial reads
    tmpFile = stateFile + '.tmp.' + process.pid;
    fs.writeFileSync(tmpFile, JSON.stringify(state, null, 2), 'utf8');
    try {
      fs.renameSync(tmpFile, stateFile);
    } catch (error) {
      if (error && (error.code === 'EEXIST' || error.code === 'EPERM')) {
        try { fs.unlinkSync(stateFile); } catch (_) { /* ignore */ }
        fs.renameSync(tmpFile, stateFile);
      } else {
        throw error;
      }
    }
  } catch (_) {
    if (tmpFile) {
      try { fs.unlinkSync(tmpFile); } catch (_) { /* ignore */ }
    }
  }
}

function markChecked(key) {
  const state = loadState();
  if (!state.checked.includes(key)) {
    state.checked.push(key);
    saveState(state);
  }
}

function isChecked(key) {
  const state = loadState();
  const found = state.checked.includes(key);
  if (found && Date.now() - (state.last_active || 0) > READ_HEARTBEAT_MS) {
    saveState(state);
  }
  return found;
}

// Prune stale session files older than 1 hour
(function pruneStaleFiles() {
  try {
    const files = fs.readdirSync(STATE_DIR);
    const now = Date.now();
    for (const f of files) {
      if (!f.startsWith('state-') || !f.endsWith('.json')) continue;
      const fp = path.join(STATE_DIR, f);
      try {
        const stat = fs.statSync(fp);
        if (now - stat.mtimeMs > SESSION_TIMEOUT_MS * 2) {
          fs.unlinkSync(fp);
        }
      } catch (_) {
        // Ignore files that disappear between readdir/stat/unlink.
      }
    }
  } catch (_) { /* ignore */ }
})();

// --- Sanitize file path against injection ---

function sanitizePath(filePath) {
  // Strip control chars (including null), bidi overrides, and newlines
  let sanitized = '';
  for (const char of String(filePath || '')) {
    const code = char.codePointAt(0);
    const isAsciiControl = code <= 0x1f || code === 0x7f;
    const isBidiOverride = (code >= 0x200e && code <= 0x200f) || (code >= 0x202a && code <= 0x202e) || (code >= 0x2066 && code <= 0x2069);
    sanitized += (isAsciiControl || isBidiOverride) ? ' ' : char;
  }
  return sanitized.trim().slice(0, 500);
}

function normalizeForMatch(value) {
  return String(value || '').replace(/\\/g, '/').toLowerCase();
}

function isClaudeSettingsPath(filePath) {
  const normalized = normalizeForMatch(filePath);
  return /(^|\/)\.claude\/settings(?:\.[^/]+)?\.json$/.test(normalized);
}

function isReadOnlyGitIntrospection(command) {
  const trimmed = String(command || '').trim();
  if (!trimmed || /[\r\n;&|><`$()]/.test(trimmed)) {
    return false;
  }

  const tokens = trimmed.split(/\s+/);
  if (tokens[0] !== 'git' || tokens.length < 2) {
    return false;
  }

  const subcommand = tokens[1].toLowerCase();
  const args = tokens.slice(2);

  if (subcommand === 'status') {
    return args.every(arg => ['--porcelain', '--short', '--branch'].includes(arg));
  }

  if (subcommand === 'diff') {
    return args.length <= 1 && args.every(arg => ['--name-only', '--name-status'].includes(arg));
  }

  if (subcommand === 'log') {
    return args.every(arg => arg === '--oneline' || /^--max-count=\d+$/.test(arg));
  }

  if (subcommand === 'show') {
    return args.length === 1 && !args[0].startsWith('--') && /^[a-zA-Z0-9._:/-]+$/.test(args[0]);
  }

  if (subcommand === 'branch') {
    return args.length === 1 && args[0] === '--show-current';
  }

  if (subcommand === 'rev-parse') {
    return args.length === 2 && args[0] === '--abbrev-ref' && /^head$/i.test(args[1]);
  }

  return false;
}

// --- Gate messages ---

function editGateMsg(filePath) {
  const safe = sanitizePath(filePath);
  return [
    '[Fact-Forcing Gate]',
    '',
    `Before editing ${safe}, present these facts:`,
    '',
    '1. List ALL files that import/require this file (use Grep)',
    '2. List the public functions/classes affected by this change',
    '3. If this file reads/writes data files, show field names, structure, and date format (use redacted or synthetic values, not raw production data)',
    '4. Quote the user\'s current instruction verbatim',
    '',
    'Present the facts, then retry the same operation.'
  ].join('\n');
}

function writeGateMsg(filePath) {
  const safe = sanitizePath(filePath);
  return [
    '[Fact-Forcing Gate]',
    '',
    `Before creating ${safe}, present these facts:`,
    '',
    '1. Name the file(s) and line(s) that will call this new file',
    '2. Confirm no existing file serves the same purpose (use Glob)',
    '3. If this file reads/writes data files, show field names, structure, and date format (use redacted or synthetic values, not raw production data)',
    '4. Quote the user\'s current instruction verbatim',
    '',
    'Present the facts, then retry the same operation.'
  ].join('\n');
}

function destructiveBashMsg() {
  return [
    '[Fact-Forcing Gate]',
    '',
    'Destructive command detected. Before running, present:',
    '',
    '1. List all files/data this command will modify or delete',
    '2. Write a one-line rollback procedure',
    '3. Quote the user\'s current instruction verbatim',
    '',
    'Present the facts, then retry the same operation.'
  ].join('\n');
}

function routineBashMsg() {
  return [
    '[Fact-Forcing Gate]',
    '',
    'Quote the user\'s current instruction verbatim.',
    'Then retry the same operation.'
  ].join('\n');
}

// --- Deny helper ---

function denyResult(reason) {
  return {
    stdout: JSON.stringify({
      hookSpecificOutput: {
        hookEventName: 'PreToolUse',
        permissionDecision: 'deny',
        permissionDecisionReason: reason
      }
    }),
    exitCode: 0
  };
}

// --- Core logic (exported for run-with-flags.js) ---

function run(rawInput) {
  let data;
  try {
    data = typeof rawInput === 'string' ? JSON.parse(rawInput) : rawInput;
  } catch (_) {
    return rawInput; // allow on parse error
  }
  activeStateFile = null;
  getStateFile(data);

  const rawToolName = data.tool_name || '';
  const toolInput = data.tool_input || {};
  // Normalize: case-insensitive matching via lookup map
  const TOOL_MAP = { 'edit': 'Edit', 'write': 'Write', 'multiedit': 'MultiEdit', 'bash': 'Bash' };
  const toolName = TOOL_MAP[rawToolName.toLowerCase()] || rawToolName;

  if (toolName === 'Edit' || toolName === 'Write') {
    const filePath = toolInput.file_path || '';
    if (!filePath || isClaudeSettingsPath(filePath)) {
      return rawInput; // allow
    }

    if (!isChecked(filePath)) {
      markChecked(filePath);
      return denyResult(toolName === 'Edit' ? editGateMsg(filePath) : writeGateMsg(filePath));
    }

    return rawInput; // allow
  }

  if (toolName === 'MultiEdit') {
    const edits = toolInput.edits || [];
    for (const edit of edits) {
      const filePath = edit.file_path || '';
      if (filePath && !isClaudeSettingsPath(filePath) && !isChecked(filePath)) {
        markChecked(filePath);
        return denyResult(editGateMsg(filePath));
      }
    }
    return rawInput; // allow
  }

  if (toolName === 'Bash') {
    const command = toolInput.command || '';
    if (isReadOnlyGitIntrospection(command)) {
      return rawInput;
    }

    if (DESTRUCTIVE_BASH.test(command)) {
      // Gate destructive commands on first attempt; allow retry after facts presented
      const key = '__destructive__' + crypto.createHash('sha256').update(command).digest('hex').slice(0, 16);
      if (!isChecked(key)) {
        markChecked(key);
        return denyResult(destructiveBashMsg());
      }
      return rawInput; // allow retry after facts presented
    }

    if (process.env.GATEGUARD_BASH_ROUTINE_DISABLED === '1') {
      return rawInput;
    }

    if (!isChecked(ROUTINE_BASH_SESSION_KEY)) {
      markChecked(ROUTINE_BASH_SESSION_KEY);
      return denyResult(routineBashMsg());
    }

    return rawInput; // allow
  }

  return rawInput; // allow
}

module.exports = { run };
