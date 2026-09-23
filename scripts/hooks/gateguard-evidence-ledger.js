'use strict';

const crypto = require('crypto');
const fs = require('fs');
const path = require('path');

const EVIDENCE_TTL_MS = 30 * 60 * 1000; // 30 minutes
const EVIDENCE_MAX_ENTRIES = 200;
const SCOPE_PASS_TTL_MS = 30 * 60 * 1000; // 30 minutes

function getStateDir() {
  return process.env.GATEGUARD_STATE_DIR || path.join(process.env.HOME || process.env.USERPROFILE || '/tmp', '.gateguard');
}

const INVESTIGATIVE_BASH = /\b(grep|rg|find|fd|fdfind|tree|wc|stat|cat|head|tail|git\s+(?:log|show|diff|blame|grep|status|ls-files))\b/i;

const HIGH_RISK_PATH_TOKENS = new Set([
  'auth', 'login', 'oauth', 'sso', 'payment', 'payments', 'billing', 'checkout',
  'secret', 'secrets', 'credential', 'credentials', 'migration', 'migrations'
]);

const HIGH_RISK_FILENAME_RE = /^\.env(\..+)?$|^settings(\.local)?\.json$|\.plist$|^\.gateguard\.ya?ml$/i;
const HIGH_RISK_PATH_RE = /(?:^|\/)\.github\/workflows\//i;

const SIGNATURE_LINE_RE = /^\s*(async\s+def\s|def\s|class\s|import\s|from\s+\S+\s+import\s|export\s|function\s|interface\s|type\s+\S+\s*=)/;
const COMMENT_LINE_RE = /^\s*(#|\/\/|\/\*|\*\/|\*|<!--|--\s)/;

function normalizePath(p) {
  if (!p) return '';
  return String(p).replace(/\\/g, '/').trim();
}

function extractStem(filePath) {
  if (!filePath) return '';
  const base = path.basename(normalizePath(filePath));
  const ext = path.extname(base);
  return ext ? base.slice(0, -ext.length) : base;
}

function pruneEvidence(evidence, now = Date.now()) {
  if (!Array.isArray(evidence)) return [];
  const valid = evidence.filter(e => e && typeof e.ts === 'number' && (now - e.ts) < EVIDENCE_TTL_MS);
  if (valid.length > EVIDENCE_MAX_ENTRIES) {
    return valid.slice(-EVIDENCE_MAX_ENTRIES);
  }
  return valid;
}

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

function matchingEvidence(filePath, state, now = Date.now(), limit = 8) {
  if (!filePath || !state || !Array.isArray(state.evidence)) return [];
  const target = normalizePath(filePath);
  const targetLower = target.toLowerCase();
  const stem = extractStem(target).toLowerCase();
  const dir = normalizePath(path.dirname(target)).toLowerCase();

  const entries = state.evidence.filter(e => e && typeof e.ts === 'number' && (now - e.ts) < EVIDENCE_TTL_MS);
  const matched = [];

  for (let i = entries.length - 1; i >= 0; i--) {
    const e = entries[i];
    const eTarget = normalizePath(e.target || '').toLowerCase();
    const ePattern = String(e.pattern || '').toLowerCase();

    let isMatch = false;

    // Direct read or exact target match
    if (eTarget && (eTarget === targetLower || targetLower.endsWith('/' + eTarget) || eTarget.endsWith('/' + targetLower))) {
      isMatch = true;
    } else if (stem && stem.length >= 3) {
      if (ePattern && ePattern.includes(stem)) {
        isMatch = true;
      } else if (eTarget && eTarget.includes(stem)) {
        isMatch = true;
      }
    }

    if (!isMatch && dir && dir !== '.' && dir !== '/') {
      if (eTarget && (eTarget === dir || targetLower.startsWith(eTarget + '/'))) {
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

function evidenceLevel(filePath, state, now = Date.now()) {
  if (!filePath || !state) return 'none';
  const target = normalizePath(filePath);
  const targetLower = target.toLowerCase();

  const readFiles = new Set((state.read_files || []).map(f => normalizePath(f).toLowerCase()));
  const touched = readFiles.has(targetLower) ||
    Array.from(readFiles).some(f => targetLower.endsWith('/' + f) || f.endsWith('/' + targetLower));

  const matches = matchingEvidence(filePath, state, now, EVIDENCE_MAX_ENTRIES);
  const hasInvestigation = matches.some(m => m.kind !== 'read');
  const hasDirectRead = touched || matches.some(m => m.kind === 'read');

  if (hasInvestigation && hasDirectRead) {
    return 'deep';
  }

  if (hasDirectRead) {
    return 'touched';
  }

  return 'none';
}

function isTrivialChange(toolName, toolInput) {
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

  function stripTrivia(text) {
    return text.split(/\r?\n/)
      .map(line => line.trim())
      .filter(line => line.length > 0 && !COMMENT_LINE_RE.test(line))
      .join('\n');
  }

  return stripTrivia(oldStr) === stripTrivia(newStr);
}

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
  if (normTool === 'edit') {
    const oldStr = String(toolInput.old_string || '');
    const newStr = String(toolInput.new_string || '');

    const oldHasSig = oldStr.split(/\r?\n/).some(l => SIGNATURE_LINE_RE.test(l));
    const newHasSig = newStr.split(/\r?\n/).some(l => SIGNATURE_LINE_RE.test(l));

    if (oldHasSig || newHasSig) {
      return 'elevated';
    }
  }

  return 'normal';
}

function validScopePass(filePath, state, now = Date.now()) {
  if (!filePath || !state || !state.scope_passes) return false;
  const dir = normalizePath(path.dirname(filePath)).toLowerCase();
  const expiry = state.scope_passes[dir];
  return typeof expiry === 'number' && expiry > now;
}

function grantScopePass(state, filePath, now = Date.now()) {
  if (!state) return state;
  const dir = normalizePath(path.dirname(filePath)).toLowerCase();
  if (!state.scope_passes || typeof state.scope_passes !== 'object') {
    state.scope_passes = {};
  }

  // Prune expired
  for (const [d, exp] of Object.entries(state.scope_passes)) {
    if (typeof exp !== 'number' || exp <= now) {
      delete state.scope_passes[d];
    }
  }

  state.scope_passes[dir] = now + SCOPE_PASS_TTL_MS;
  return state;
}

function sanitizeSessionKey(value) {
  const raw = String(value || '').trim();
  if (!raw) return '';
  const sanitized = raw.replace(/[^a-zA-Z0-9_-]/g, '_');
  if (sanitized && sanitized.length <= 64) return sanitized;
  return `sid-${crypto.createHash('sha256').update(String(raw)).digest('hex').slice(0, 24)}`;
}

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

function recordToolUse(rawInput) {
  let data;
  try {
    data = typeof rawInput === 'string' ? JSON.parse(rawInput) : rawInput;
  } catch (_) {
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
    let state = { checked: [], last_active: Date.now() };

    if (fs.existsSync(stateFile)) {
      try {
        state = JSON.parse(fs.readFileSync(stateFile, 'utf8'));
      } catch (_) {
        state = { checked: [], last_active: Date.now() };
      }
    }

    if (!Array.isArray(state.evidence)) {
      state.evidence = [];
    }
    if (!Array.isArray(state.read_files)) {
      state.read_files = [];
    }

    const now = Date.now();
    state.evidence = pruneEvidence([...state.evidence, entry], now);

    if (entry.kind === 'read' && entry.target) {
      if (!state.read_files.includes(entry.target)) {
        state.read_files.push(entry.target);
        if (state.read_files.length > EVIDENCE_MAX_ENTRIES) {
          state.read_files = state.read_files.slice(-EVIDENCE_MAX_ENTRIES);
        }
      }
    }

    state.last_active = now;

    // Atomic write
    const tmpFile = `${stateFile}.tmp.${process.pid}.${crypto.randomBytes(4).toString('hex')}`;
    fs.writeFileSync(tmpFile, JSON.stringify(state, null, 2), 'utf8');
    try {
      fs.renameSync(tmpFile, stateFile);
    } catch (e) {
      if (e && (e.code === 'EEXIST' || e.code === 'EPERM')) {
        try { fs.unlinkSync(stateFile); } catch (_) {}
        fs.renameSync(tmpFile, stateFile);
      } else {
        throw e;
      }
    }
  } catch (_) {
    // Fail silently in PostToolUse to never disrupt the agent
  }

  return { output: '', exitCode: 0 };
}

module.exports = {
  EVIDENCE_TTL_MS,
  EVIDENCE_MAX_ENTRIES,
  SCOPE_PASS_TTL_MS,
  normalizePath,
  extractStem,
  pruneEvidence,
  buildEvidenceEntry,
  matchingEvidence,
  evidenceLevel,
  isTrivialChange,
  riskTier,
  validScopePass,
  grantScopePass,
  resolveSessionKey,
  recordToolUse
};
