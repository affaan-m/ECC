'use strict';

/**
 * @fileoverview Evidence ledger for GateGuard.
 * Tracks investigative tool use (Read, Grep, Glob, Bash diagnostics),
 * evaluates evidence levels, risk tiers, and temporary directory scope passes.
 */

const crypto = require('crypto');
const fs = require('fs');
const path = require('path');

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

const INVESTIGATIVE_BASH = /\b(grep|rg|find|fd|fdfind|tree|wc|stat|cat|head|tail|git\s+(?:log|show|diff|blame|grep|status|ls-files))\b/i;

const HIGH_RISK_PATH_TOKENS = new Set([
  'auth', 'login', 'oauth', 'sso', 'payment', 'payments', 'billing', 'checkout',
  'secret', 'secrets', 'credential', 'credentials', 'migration', 'migrations'
]);

const HIGH_RISK_FILENAME_RE = /^\.env(?:[.-].*|rc)?$|^settings(\.local)?\.json$|\.plist$|^\.gateguard\.ya?ml$/i;
const HIGH_RISK_PATH_RE = /(?:^|\/)\.github\/workflows\//i;

// Public or exported signature line detection across multiple languages:
// JS/TS: export, function, interface, type
// Python: def, async def, class
// Java/C#/Kotlin: public class/interface/enum/record/method
// Go: func ExportedName, type ExportedName
// Rust: pub fn/struct/enum/trait/type/const
const SIGNATURE_LINE_RE = /^\s*(?:async\s+def\s|def\s|class\s|export\s|function\s|interface\s|type\s+\S+\s*=|public\s+(?:(?:static|abstract|final|synchronized)\s+)*(?:class|interface|enum|record|[\w<>\[\]]+\s+\w+\s*\()|func\s+(?:\([^)]+\)\s+)?[A-Z]\w*|type\s+[A-Z]\w*\s+(?:struct|interface)|pub\s+(?:fn|struct|enum|trait|type|const))/;

const INDENT_SENSITIVE_EXTS = new Set(['.py', '.pyw', '.yaml', '.yml', '.nim']);
const INDENT_SENSITIVE_BASES = new Set(['makefile', 'gnumakefile']);
const HASH_COMMENT_EXTS = new Set([
  '.py', '.pyw', '.yaml', '.yml', '.sh', '.bash', '.zsh', '.rb',
  '.pl', '.pm', '.r', '.toml', '.ini', '.cfg', '.conf', '.dockerfile'
]);

/**
 * Normalizes file paths for platform-agnostic matching.
 * @param {string} p File path to normalize.
 * @returns {string} Normalized path.
 */
function normalizePath(p) {
  if (!p) return '';
  return String(p).replace(/\\/g, '/').trim();
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
    if (typeof ts === 'number' && (now - ts) < EVIDENCE_TTL_MS) {
      activeEntries.push([p, ts]);
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
    const target = normalizePath(rawTarget);
    return {
      kind: 'read',
      target,
      stem: extractStem(target),
      ts: now
    };
  }

  if (normTool === 'grep') {
    const target = normalizePath(toolInput.path || '');
    const pattern = String(toolInput.pattern || '');
    return {
      kind: 'grep',
      target,
      pattern,
      ts: now
    };
  }

  if (normTool === 'glob') {
    const target = normalizePath(toolInput.path || '');
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
    if (cmd && INVESTIGATIVE_BASH.test(cmd)) {
      return {
        kind: 'bash',
        target: '',
        pattern: cmd.slice(0, 300),
        ts: now
      };
    }
  }

  return null;
}

/**
 * Finds relevant active evidence for a target file.
 * Requires exact path match or containing directory match.
 * @param {string} filePath Target file path.
 * @param {Object} state Session state object.
 * @param {number} [now=Date.now()] Current timestamp in ms.
 * @param {number} [limit=8] Maximum number of matched entries.
 * @returns {Array<Object>} Matched evidence records.
 */
function matchingEvidence(filePath, state, now = Date.now(), limit = 8) {
  if (!filePath || !state || !Array.isArray(state.evidence)) return [];
  const target = normalizePath(filePath);
  const targetLower = target.toLowerCase();
  const baseName = path.basename(targetLower);
  const dir = normalizePath(path.dirname(target)).toLowerCase();

  const entries = state.evidence.filter(e => e && typeof e.ts === 'number' && (now - e.ts) < EVIDENCE_TTL_MS);
  const matched = [];

  for (let i = entries.length - 1; i >= 0; i--) {
    const e = entries[i];
    const eTarget = normalizePath(e.target || '').toLowerCase();
    const ePattern = String(e.pattern || '').toLowerCase();

    let isMatch = false;

    // Direct target match: exact canonical path or full path suffix
    if (eTarget && (eTarget === targetLower || targetLower.endsWith('/' + eTarget) || eTarget.endsWith('/' + targetLower))) {
      isMatch = true;
    } else if (dir && dir !== '.' && dir !== '/') {
      // Directory match: grep/glob targeted this directory or a direct parent
      if (eTarget && (eTarget === dir || targetLower.startsWith(eTarget + '/'))) {
        isMatch = true;
      }
    }

    // Investigative bash command mentioning the target file specifically
    if (!isMatch && e.kind === 'bash' && ePattern) {
      if (ePattern.includes(baseName) || ePattern.includes(targetLower)) {
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
  const target = normalizePath(filePath);
  const targetLower = target.toLowerCase();

  const matches = matchingEvidence(filePath, state, now, EVIDENCE_MAX_ENTRIES);

  // Check direct read strictly within TTL
  let hasDirectRead = matches.some(m => m.kind === 'read');

  if (!hasDirectRead && state.read_files && typeof state.read_files === 'object' && !Array.isArray(state.read_files)) {
    const readTs = state.read_files[targetLower];
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
 * Checks if an edit contains only trivial comment or whitespace changes.
 * Conserves indentation for indentation-sensitive files (Python, YAML, Makefiles)
 * and distinguishes comments from preprocessor directives in C/C++.
 * @param {string} toolName Tool name ('Edit').
 * @param {Object} toolInput Tool input payload.
 * @param {string} [filePath=''] Target file path.
 * @returns {boolean} True if the change is strictly non-semantic.
 */
function isTrivialChange(toolName, toolInput, filePath = '') {
  const normTool = String(toolName || '').toLowerCase();
  if (normTool !== 'edit') return false;
  if (!toolInput || typeof toolInput.old_string !== 'string' || typeof toolInput.new_string !== 'string') {
    return false;
  }

  const oldStr = toolInput.old_string;
  const newStr = toolInput.new_string;
  if (!oldStr && !newStr) {
    return false;
  }

  const targetPath = normalizePath(filePath || toolInput.file_path || '');
  const ext = path.extname(targetPath).toLowerCase();
  const base = path.basename(targetPath).toLowerCase();

  const isIndentSensitive = INDENT_SENSITIVE_EXTS.has(ext) || INDENT_SENSITIVE_BASES.has(base);
  const allowsHashComment = HASH_COMMENT_EXTS.has(ext) || base === 'dockerfile';

  function isCommentLine(line) {
    const trimmed = line.trim();
    if (!trimmed) return false;
    if (trimmed.startsWith('//') || trimmed.startsWith('/*') || trimmed.startsWith('*') ||
        trimmed.startsWith('*/') || trimmed.startsWith('<!--') || trimmed.startsWith('-- ')) {
      return true;
    }
    if (allowsHashComment && trimmed.startsWith('#')) {
      return true;
    }
    return false;
  }

  function stripTrivia(text) {
    return text.split(/\r?\n/)
      .map(line => isIndentSensitive ? line.trimEnd() : line.trim())
      .filter(line => {
        const trimmed = line.trim();
        return trimmed.length > 0 && !isCommentLine(line);
      })
      .join('\n');
  }

  return stripTrivia(oldStr) === stripTrivia(newStr);
}

/**
 * Evaluates the risk tier for a file and operation: 'high', 'elevated', or 'normal'.
 * Sensitive paths and files are classified 'high'.
 * Public API signature changes (Edit) and public API definitions (Write) are classified 'elevated'.
 * @param {string} toolName Name of the tool ('Edit' or 'Write').
 * @param {Object} toolInput Tool input payload.
 * @param {string} filePath Target file path.
 * @returns {'high'|'elevated'|'normal'} Risk tier.
 */
function riskTier(toolName, toolInput, filePath) {
  const norm = normalizePath(filePath).toLowerCase();
  const base = path.basename(norm);

  if (HIGH_RISK_FILENAME_RE.test(base)) {
    return 'high';
  }

  if (HIGH_RISK_PATH_RE.test(norm)) {
    return 'high';
  }

  // Token check (e.g. auth, billing, migrations)
  const tokens = norm.split(/[/\\._-]/).filter(Boolean);
  for (const token of tokens) {
    if (HIGH_RISK_PATH_TOKENS.has(token)) {
      return 'high';
    }
  }

  const normTool = String(toolName || '').toLowerCase();
  if (normTool === 'edit' && toolInput) {
    const oldStr = String(toolInput.old_string || '');
    const newStr = String(toolInput.new_string || '');

    const oldHasSig = oldStr.split(/\r?\n/).some(l => SIGNATURE_LINE_RE.test(l));
    const newHasSig = newStr.split(/\r?\n/).some(l => SIGNATURE_LINE_RE.test(l));

    if (oldHasSig || newHasSig) {
      return 'elevated';
    }
  }

  if (normTool === 'write' && toolInput) {
    const content = String(toolInput.content || '');
    if (content.split(/\r?\n/).some(l => SIGNATURE_LINE_RE.test(l))) {
      return 'elevated';
    }
  }

  return 'normal';
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
  const dir = normalizePath(path.dirname(filePath)).toLowerCase();
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
  const dir = normalizePath(path.dirname(filePath)).toLowerCase();
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

  const combined = [...existingEvidence];
  const seen = new Set(existingEvidence.map(e => `${e.kind}|${e.target}|${e.pattern || ''}|${e.ts}`));
  for (const e of newEvidence) {
    const key = `${e.kind}|${e.target}|${e.pattern || ''}|${e.ts}`;
    if (!seen.has(key)) {
      seen.add(key);
      combined.push(e);
    }
  }

  const readMap = {};
  if (disk.read_files && typeof disk.read_files === 'object' && !Array.isArray(disk.read_files)) {
    Object.assign(readMap, disk.read_files);
  }
  if (mem.read_files && typeof mem.read_files === 'object' && !Array.isArray(mem.read_files)) {
    Object.assign(readMap, mem.read_files);
  }

  const merged = {
    ...disk,
    ...mem,
    evidence: pruneEvidence(combined, now),
    read_files: pruneReadFiles(readMap, now),
    scope_passes: { ...(disk.scope_passes || {}), ...(mem.scope_passes || {}) },
    checked: Array.from(new Set([...(disk.checked || []), ...(mem.checked || [])])),
    last_active: now
  };

  return merged;
}

/**
 * Loads and parses state file from disk, returning default state on missing/malformed file.
 * @param {string} stateFile Path to state file.
 * @returns {Object} Parsed state object or empty template.
 */
function loadStateFromDisk(stateFile) {
  if (fs.existsSync(stateFile)) {
    try {
      return JSON.parse(fs.readFileSync(stateFile, 'utf8'));
    } catch (_err) {
      return { checked: [], last_active: Date.now() };
    }
  }
  return { checked: [], last_active: Date.now() };
}

/**
 * Atomically writes state to disk using a unique temporary file.
 * @param {string} stateFile Path to destination state file.
 * @param {Object} state State object to serialize.
 */
function writeStateToDiskAtomic(stateFile, state) {
  const tmpFile = `${stateFile}.tmp.${process.pid}.${crypto.randomBytes(4).toString('hex')}`;
  fs.writeFileSync(tmpFile, JSON.stringify(state, null, 2), 'utf8');
  try {
    fs.renameSync(tmpFile, stateFile);
  } catch (e) {
    if (e && (e.code === 'EEXIST' || e.code === 'EPERM')) {
      try { fs.unlinkSync(stateFile); } catch (_unlinkErr) { void 0; }
      fs.renameSync(tmpFile, stateFile);
    } else {
      throw e;
    }
  }
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
  const stateDir = getStateDir();
  const stateFile = path.join(stateDir, `state-${sessionKey}.json`);

  try {
    fs.mkdirSync(stateDir, { recursive: true });
    const diskState = loadStateFromDisk(stateFile);

    const now = Date.now();
    const readFiles = (diskState.read_files && typeof diskState.read_files === 'object' && !Array.isArray(diskState.read_files))
      ? { ...diskState.read_files }
      : {};

    if (entry.kind === 'read' && entry.target) {
      readFiles[entry.target.toLowerCase()] = now;
    }

    const memoryState = {
      evidence: [entry],
      read_files: readFiles,
      last_active: now
    };

    const finalState = mergeState(diskState, memoryState, now);
    writeStateToDiskAtomic(stateFile, finalState);
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
  recordToolUse
};
