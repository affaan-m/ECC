'use strict';

/**
 * @fileoverview Evidence ledger for GateGuard.
 * Tracks investigative tool use (Read, Grep, Glob, Bash diagnostics),
 * evaluates evidence levels, risk tiers, and temporary directory scope passes.
 */

const crypto = require('crypto');
const fs = require('fs');
const path = require('path');
const { withStateFileLock } = require('../lib/gateguard-state-lock');
const { investigativeCommandEvidence } = require('./gateguard-evidence-parser');
const { isTrivialChange, riskTier } = require('./gateguard-risk');
const { restoreStateBackup, loadStateFromDisk, writeStateToDiskAtomic } = require('./gateguard-evidence-store');

const EVIDENCE_TTL_MS = 30 * 60 * 1000; // 30 minutes
const EVIDENCE_MAX_ENTRIES = 200;
const SCOPE_PASS_TTL_MS = 30 * 60 * 1000; // 30 minutes

/**
 * Returns the state directory path, respecting GATEGUARD_STATE_DIR.
 * @returns {string} Absolute path to state directory.
 */
function getStateDir() {
  return process.env.GATEGUARD_STATE_DIR || path.join(process.env.HOME || process.env.USERPROFILE || '/tmp', '.gateguard');
}

/** Normalizes file paths for platform-agnostic matching. */
function normalizePath(value) {
  if (!value) return '';
  return String(value).replace(/\\/g, '/').trim();
}

/** Accepts absolute paths only, excluding relative legacy ledger entries. */
function isAbsoluteEvidenceTarget(target) {
  const normalized = normalizePath(target);
  return path.isAbsolute(normalized) || /^[A-Za-z]:\//.test(normalized);
}

/** Checks path containment without breaking when the parent is a filesystem root. */
function isPathInsideDirectory(directory, candidate) {
  const relative = path.relative(path.resolve(directory), path.resolve(candidate));
  return relative === '' || (!path.isAbsolute(relative) && relative !== '..' && !relative.startsWith(`..${path.sep}`));
}

/** Resolves literal tool-supplied paths without shell expansion rules. */
function resolveEvidencePath(value) {
  if (!value) return '';
  return normalizePath(path.resolve(String(value)));
}

/**
 * Extracts filename stem (basename without extension).
 * @param {string} filePath Path of the file.
 * @returns {string} Base filename without extension.
 */
function extractStem(filePath) {
  if (!filePath) return '';
  const base = path.basename(normalizePath(filePath));
  const ext = path.extname(base);
  return ext ? base.slice(0, -ext.length) : base;
}

/**
 * Prunes expired or excess evidence entries based on TTL and capacity.
 * @param {Array<Object>} evidence Array of evidence records.
 * @param {number} [now=Date.now()] Current timestamp in ms.
 * @returns {Array<Object>} Pruned evidence array.
 */
function pruneEvidence(evidence, now = Date.now()) {
  if (!Array.isArray(evidence)) return [];
  const valid = evidence.filter(e => e && typeof e.ts === 'number' && (now - e.ts) < EVIDENCE_TTL_MS);
  if (valid.length > EVIDENCE_MAX_ENTRIES) {
    return valid.slice(-EVIDENCE_MAX_ENTRIES);
  }
  return valid;
}

/**
 * Prunes timestamped read records map.
 * @param {Object} readFiles Map of path to timestamp.
 * @param {number} [now=Date.now()] Current timestamp in ms.
 * @returns {Object} Cleaned map of active reads.
 */
function pruneReadFiles(readFiles, now = Date.now()) {
  if (!readFiles || typeof readFiles !== 'object' || Array.isArray(readFiles)) return {};
  const activeEntries = [];
  for (const [p, ts] of Object.entries(readFiles)) {
    if (isAbsoluteEvidenceTarget(p) && typeof ts === 'number' && (now - ts) < EVIDENCE_TTL_MS) {
      activeEntries.push([normalizePath(p), ts]);
    }
  }
  // Keep the most recent entries up to EVIDENCE_MAX_ENTRIES
  activeEntries.sort((a, b) => b[1] - a[1]);
  const capped = activeEntries.slice(0, EVIDENCE_MAX_ENTRIES);
  const cleaned = {};
  for (const [p, ts] of capped) {
    cleaned[p] = ts;
  }
  return cleaned;
}

/** Builds the stable identity used to deduplicate repeated evidence. */
function evidenceIdentity(evidence) {
  return `${evidence.kind}|${evidence.target}|${evidence.pattern || ''}|${evidence.ts}`;
}

/** Deduplicates evidence while preserving the first occurrence order. */
function dedupeEvidence(evidence) {
  const seen = new Set();
  return (Array.isArray(evidence) ? evidence : []).filter(entry => {
    if (!entry || typeof entry !== 'object') return false;
    const identity = evidenceIdentity(entry);
    if (seen.has(identity)) return false;
    seen.add(identity);
    return true;
  });
}

/**
 * Builds an evidence ledger entry from a tool use event.
 * @param {string} toolName Name of the tool.
 * @param {Object} toolInput Input payload of the tool.
 * @param {number} [now=Date.now()] Current timestamp in ms.
 * @returns {Object|null} Evidence entry object or null.
 */
function buildEvidenceEntry(toolName, toolInput, now = Date.now()) {
  if (!toolName || !toolInput) return null;
  const normTool = String(toolName).toLowerCase();

  if (normTool === 'read') {
    const rawTarget = toolInput.file_path || toolInput.path || '';
    if (!rawTarget) return null;
    const target = resolveEvidencePath(rawTarget);
    if (!target) return null;
    return {
      kind: 'read',
      target,
      stem: extractStem(target),
      ts: now
    };
  }

  if (normTool === 'grep') {
    const target = resolveEvidencePath(toolInput.path || '');
    if (!target) return null;
    const pattern = String(toolInput.pattern || '');
    return {
      kind: 'grep',
      target,
      pattern,
      ts: now
    };
  }

  if (normTool === 'glob') {
    const target = resolveEvidencePath(toolInput.path || '');
    if (!target) return null;
    const pattern = String(toolInput.pattern || '');
    return {
      kind: 'glob',
      target,
      pattern,
      ts: now
    };
  }

  if (normTool === 'bash' || normTool === 'powershell') {
    const cmd = String(toolInput.command || '').trim();
    const evidence = cmd ? investigativeCommandEvidence(cmd) : null;
    if (evidence) {
      return {
        kind: 'bash',
        target: evidence.target,
        pattern: evidence.pattern,
        ts: now
      };
    }
  }

  return null;
}

/**
 * Finds relevant active evidence for a target file.
 * Requires an exact path match or direct-parent directory match.
 * @param {string} filePath Target file path.
 * @param {Object} state Session state object.
 * @param {number} [now=Date.now()] Current timestamp in ms.
 * @param {number} [limit=8] Maximum number of matched entries.
 * @returns {Array<Object>} Matched evidence records.
 */
function matchingEvidence(filePath, state, now = Date.now(), limit = 8) {
  if (!filePath || !state || !Array.isArray(state.evidence)) return [];
  const target = resolveEvidencePath(filePath);
  const dir = normalizePath(path.dirname(target));

  const entries = state.evidence.filter(e => e && typeof e.ts === 'number' && (now - e.ts) < EVIDENCE_TTL_MS);
  const matched = [];

  for (let i = entries.length - 1; i >= 0; i--) {
    const e = entries[i];
    if (!isAbsoluteEvidenceTarget(e.target)) continue;
    const eTarget = normalizePath(path.resolve(e.target));

    let isMatch = false;

    // Old relative targets are not trusted because session IDs can span projects.
    if (eTarget && eTarget === target) {
      isMatch = true;
    } else if (dir && dir !== '.' && dir !== '/') {
      // Directory evidence applies only to the file's direct parent.
      if (eTarget && eTarget === dir) {
        isMatch = true;
      }
    }

    if (isMatch) {
      matched.push(e);
      if (matched.length >= limit) break;
    }
  }

  return matched;
}

/**
 * Determines the evidence level for a file: 'deep', 'touched', or 'none'.
 * Both direct read and investigation evidence must be within the 30-minute TTL.
 * @param {string} filePath Target file path.
 * @param {Object} state Session state object.
 * @param {number} [now=Date.now()] Current timestamp in ms.
 * @returns {'deep'|'touched'|'none'} Evidence level.
 */
function evidenceLevel(filePath, state, now = Date.now()) {
  if (!filePath || !state) return 'none';
  const target = resolveEvidencePath(filePath);
  const matches = matchingEvidence(filePath, state, now, EVIDENCE_MAX_ENTRIES);

  // Check direct read strictly within TTL
  let hasDirectRead = matches.some(m => m.kind === 'read');

  if (!hasDirectRead && state.read_files && typeof state.read_files === 'object' && !Array.isArray(state.read_files)) {
    const readTs = state.read_files[target];
    if (typeof readTs === 'number' && (now - readTs) < EVIDENCE_TTL_MS) {
      hasDirectRead = true;
    }
  }

  const hasInvestigation = matches.some(m => m.kind !== 'read');

  if (hasInvestigation && hasDirectRead) {
    return 'deep';
  }

  if (hasDirectRead) {
    return 'touched';
  }

  return 'none';
}

/**
 * Checks if an active temporary directory scope pass exists for the file.
 * @param {string} filePath Target file path.
 * @param {Object} state Session state object.
 * @param {number} [now=Date.now()] Current timestamp in ms.
 * @returns {boolean} True if a valid scope pass exists.
 */
function validScopePass(filePath, state, now = Date.now()) {
  if (!filePath || !state || !state.scope_passes) return false;
  const dir = normalizePath(path.dirname(resolveEvidencePath(filePath)));
  const expiry = state.scope_passes[dir];
  return typeof expiry === 'number' && expiry > now;
}

/**
 * Immutably grants a temporary directory scope pass.
 * @param {Object} state Current state object.
 * @param {string} filePath Target file path.
 * @param {number} [now=Date.now()] Current timestamp in ms.
 * @returns {Object} New state object with updated scope passes.
 */
function grantScopePass(state, filePath, now = Date.now()) {
  if (!state) return state;
  const dir = normalizePath(path.dirname(resolveEvidencePath(filePath)));
  const existing = state.scope_passes && typeof state.scope_passes === 'object' ? state.scope_passes : {};
  const cleaned = {};
  for (const [d, exp] of Object.entries(existing)) {
    if (typeof exp === 'number' && exp > now) {
      cleaned[d] = exp;
    }
  }
  cleaned[dir] = now + SCOPE_PASS_TTL_MS;
  return {
    ...state,
    scope_passes: cleaned
  };
}

/**
 * Sanitizes an arbitrary session identifier into a filesystem-safe string.
 * @param {string} value Raw session ID candidate.
 * @returns {string} Sanitized session key.
 */
function sanitizeSessionKey(value) {
  const raw = String(value || '').trim();
  if (!raw) return '';
  const sanitized = raw.replace(/[^a-zA-Z0-9_-]/g, '_');
  if (sanitized && sanitized.length <= 64) return sanitized;
  return `sid-${crypto.createHash('sha256').update(String(raw)).digest('hex').slice(0, 24)}`;
}

/**
 * Resolves a stable session key from tool context and environment variables.
 * @param {Object} data Input hook data.
 * @returns {string} Session key.
 */
function resolveSessionKey(data) {
  const directCandidates = [
    data && data.session_id,
    data && data.sessionId,
    data && data.session && data.session.id,
    process.env.CLAUDE_SESSION_ID,
    process.env.ECC_SESSION_ID
  ];

  for (const candidate of directCandidates) {
    const sanitized = sanitizeSessionKey(candidate);
    if (sanitized) return sanitized;
  }

  const transcriptPath = (data && (data.transcript_path || data.transcriptPath)) || process.env.CLAUDE_TRANSCRIPT_PATH;
  if (transcriptPath && String(transcriptPath).trim()) {
    return `tx-${crypto.createHash('sha256').update(path.resolve(String(transcriptPath).trim())).digest('hex').slice(0, 24)}`;
  }

  const projectFingerprint = process.env.CLAUDE_PROJECT_DIR || process.cwd();
  return `proj-${crypto.createHash('sha256').update(path.resolve(projectFingerprint)).digest('hex').slice(0, 24)}`;
}

/**
 * Merges in-memory state with freshly read disk state to handle concurrency safely.
 * @param {Object} diskState State currently persisted on disk.
 * @param {Object} memoryState In-memory updates.
 * @param {number} [now=Date.now()] Current timestamp in ms.
 * @returns {Object} Merged state object.
 */
function mergeState(diskState, memoryState, now = Date.now()) {
  const disk = diskState && typeof diskState === 'object' ? diskState : {};
  const mem = memoryState && typeof memoryState === 'object' ? memoryState : {};

  const existingEvidence = Array.isArray(disk.evidence) ? disk.evidence : [];
  const newEvidence = Array.isArray(mem.evidence) ? mem.evidence : [];

  const combined = dedupeEvidence([...existingEvidence, ...newEvidence]);

  const readMap = mergeTimestampMaps(disk.read_files, mem.read_files);

  const merged = {
    ...disk,
    ...mem,
    evidence: pruneEvidence(combined, now),
    read_files: pruneReadFiles(readMap, now),
    scope_passes: mergeTimestampMaps(disk.scope_passes, mem.scope_passes),
    checked: Array.from(new Set([...(disk.checked || []), ...(mem.checked || [])])),
    last_active: now
  };

  return merged;
}

/** Merges timestamp maps without allowing stale values to shorten a TTL. */
function mergeTimestampMaps(first, second) {
  const merged = {};
  for (const map of [first, second]) {
    if (!map || typeof map !== 'object' || Array.isArray(map)) continue;
    for (const [key, timestamp] of Object.entries(map)) {
      if (typeof timestamp !== 'number' || !Number.isFinite(timestamp)) continue;
      merged[key] = Math.max(merged[key] || 0, timestamp);
    }
  }
  return merged;
}

/**
 * Records a tool use event in the session evidence ledger.
 * Concurrency-safe: merges updates with current on-disk state.
 * @param {string|Object} rawInput Raw hook JSON string or parsed object.
 * @returns {{output: string, exitCode: number, stderr?: string}} Hook response.
 */
function recordToolUse(rawInput) {
  let data;
  try {
    data = typeof rawInput === 'string' ? JSON.parse(rawInput) : rawInput;
  } catch (_err) {
    return { output: '', exitCode: 0 };
  }

  const toolName = data.tool_name || '';
  const toolInput = data.tool_input || {};
  const entry = buildEvidenceEntry(toolName, toolInput);
  if (!entry) {
    return { output: '', exitCode: 0 };
  }

  const sessionKey = resolveSessionKey(data);
  const stateDir = path.resolve(getStateDir());
  const stateFile = path.resolve(stateDir, `state-${sessionKey}.json`);
  if (!isPathInsideDirectory(stateDir, stateFile) || stateFile === stateDir) {
    return { output: '', exitCode: 0 };
  }

  try {
    withStateFileLock(`${stateFile}.lock`, () => {
      fs.mkdirSync(stateDir, { recursive: true });
      const now = Date.now();
      const loadedState = loadStateFromDisk(stateFile);
      const diskState = now - (Number(loadedState.last_active) || 0) > EVIDENCE_TTL_MS
        ? { checked: [], last_active: now }
        : loadedState;
      const readFiles = (diskState.read_files && typeof diskState.read_files === 'object' && !Array.isArray(diskState.read_files))
        ? { ...diskState.read_files }
        : {};

      if (entry.kind === 'read' && entry.target) {
        readFiles[entry.target] = now;
      }

      const memoryState = {
        evidence: [entry],
        read_files: readFiles,
        last_active: now
      };

      const finalState = mergeState(diskState, memoryState, now);
      writeStateToDiskAtomic(stateFile, finalState);
    });
  } catch (err) {
    const errorMsg = `[GateGuard] Failed to persist evidence state: ${err.message}\n`;
    process.stderr.write(errorMsg);
    return { output: '', stderr: errorMsg.trim(), exitCode: 0 };
  }

  return { output: '', exitCode: 0 };
}

module.exports = {
  EVIDENCE_TTL_MS,
  EVIDENCE_MAX_ENTRIES,
  SCOPE_PASS_TTL_MS,
  getStateDir,
  normalizePath,
  isPathInsideDirectory,
  extractStem,
  pruneEvidence,
  pruneReadFiles,
  buildEvidenceEntry,
  matchingEvidence,
  evidenceLevel,
  isTrivialChange,
  riskTier,
  validScopePass,
  grantScopePass,
  sanitizeSessionKey,
  resolveSessionKey,
  mergeState,
  mergeTimestampMaps,
  restoreStateBackup,
  evidenceIdentity,
  dedupeEvidence,
  loadStateFromDisk,
  writeStateToDiskAtomic,
  recordToolUse
};
