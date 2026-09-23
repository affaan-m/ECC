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

const INVESTIGATIVE_COMMANDS = new Set(['grep', 'rg', 'find', 'fd', 'fdfind', 'tree', 'wc', 'stat', 'cat', 'head', 'tail', 'git']);
const GIT_INVESTIGATIVE_SUBCOMMANDS = new Set(['log', 'show', 'diff', 'blame', 'grep', 'status', 'ls-files']);
const GREP_OPTIONS_WITH_VALUE = new Set([
  '-A', '-B', '-C', '-D', '-d', '-e', '-f', '-m', '-T', '--after-context', '--before-context',
  '--context', '--devices', '--directories', '--regexp', '--file', '--max-count', '--max-columns',
  '--max-filesize', '--max-depth', '--glob', '--iglob', '-g', '--type', '-t', '--type-add',
  '--type-clear', '--type-not', '--encoding', '--engine', '--sort', '--sortr', '--threads', '--pre',
  '--pre-glob', '--color', '--colors', '--field-match-separator', '--context-separator',
  '--path-separator', '--replace'
]);
const GREP_SHORT_BOOLEAN_OPTIONS = new Set([
  '-a', '-b', '-c', '-H', '-h', '-i', '-l', '-L', '-n', '-o', '-q', '-r', '-s', '-v', '-w', '-x',
  '-z', '-Z', '-F', '-P', '-U', '-V', '-S'
]);
const GREP_LONG_BOOLEAN_OPTIONS = new Set([
  '--binary', '--count', '--count-matches', '--files', '--files-with-matches', '--files-without-match',
  '--fixed-strings', '--follow', '--glob-case-insensitive', '--heading', '--hidden', '--ignore-case',
  '--invert-match', '--json', '--line-number', '--multiline', '--multiline-dotall', '--no-filename',
  '--no-heading', '--no-ignore', '--no-ignore-dot', '--no-ignore-exclude', '--no-ignore-files',
  '--no-ignore-parent', '--no-ignore-vcs', '--null', '--null-data', '--only-matching', '--passthru',
  '--quiet', '--recursive', '--smart-case', '--stats', '--text', '--type-list', '--with-filename',
  '--column', '--line-buffered'
]);
const GREP_OPTIONS_WITH_VALUE_FOR_COMMAND = {
  rg: GREP_OPTIONS_WITH_VALUE,
  grep: new Set([...GREP_OPTIONS_WITH_VALUE].filter(option => option !== '-T'))
};
const FD_OPTIONS_WITH_VALUE = new Set(['-e', '--extension', '-t', '--type', '-E', '--exclude', '--base-directory']);
const PATH_OPTIONS_WITH_VALUE = new Set(['-n', '--lines', '-c', '--bytes', '-s', '--size', '-f', '-L', '--level']);
const GIT_SHOW_OPTIONS_WITH_VALUE = new Set(['--format', '--pretty', '--date', '--abbrev', '--diff-algorithm']);
const FIND_MUTATING_ACTIONS = new Set(['-delete', '-exec', '-execdir', '-ok', '-okdir']);

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
const SIGNATURE_LINE_RE = /^\s*(?:async\s+def\s|def\s|class\s|export\s|function\s|interface\s|type\s+\S+\s*=|public\s+(?:(?:static|abstract|final|synchronized|suspend|inline|operator|override|open|tailrec|infix|external)\s+)*(?:class|interface|enum|record|fun\s+\w+(?:\s*<[^>]+>)?\s*\(|[\w<>[\]]+\s+\w+\s*\()|(?:suspend\s+)?fun\s+\w+(?:\s*<[^>]+>)?\s*\(|func\s+(?:\([^)]+\)\s+)?[A-Z]\w*|type\s+[A-Z]\w*\s+(?:struct|interface)|pub(?:\([^)]*\))?\s+(?:(?:async|unsafe|const|extern|default)\s+)*(?:fn|struct|enum|trait|type|const))/;

const INDENT_SENSITIVE_EXTS = new Set(['.py', '.pyw', '.yaml', '.yml', '.nim']);
const INDENT_SENSITIVE_BASES = new Set(['makefile', 'gnumakefile']);
const WHITESPACE_SAFE_EXTS = new Set([
  '.c', '.cc', '.cpp', '.cxx', '.h', '.hh', '.hpp', '.hxx', '.java', '.js', '.jsx', '.mjs',
  '.cjs', '.ts', '.tsx', '.go', '.rs', '.swift', '.kt', '.kts', '.scala', '.cs', '.py', '.pyw'
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

/** Resolves a concrete file or directory argument; dynamic and globbed paths are rejected. */
function resolveEvidencePath(p) {
  if (!p) return '';
  const rawPath = String(p);
  if (['$', '*', '?', '{', '}', '[', ']'].some(meta => rawPath.includes(meta))) return '';
  return normalizePath(path.resolve(rawPath));
}

/** Splits shell input only at unquoted command boundaries. */
function splitShellCommandSegments(command) {
  const segments = [];
  let current = '';
  let quote = null;

  for (let i = 0; i < command.length; i += 1) {
    const ch = command[i];

    if (ch === '\\' && quote !== "'" && i + 1 < command.length) {
      current += command[i + 1];
      i += 1;
      continue;
    }

    if (quote) {
      if (ch === quote) quote = null;
      current += ch;
      continue;
    }

    if (ch === '"' || ch === "'") {
      quote = ch;
      current += ch;
      continue;
    }

    if (ch === '#' && (current.length === 0 || /\s/.test(current[current.length - 1]))) {
      while (i + 1 < command.length && command[i + 1] !== '\n' && command[i + 1] !== '\r') i += 1;
    }

    if (/[;|&\n\r]/.test(ch)) {
      if (current.trim()) segments.push(current.trim());
      current = '';
      if ((ch === '&' || ch === '|') && command[i + 1] === ch) i += 1;
      continue;
    }

    current += ch;
  }

  if (quote) return [];
  if (current.trim()) segments.push(current.trim());
  return segments;
}

/** Rejects command forms where static parsing cannot prove which inspection ran. */
function hasUnsafeShellControlFlow(command) {
  let quote = null;
  for (let i = 0; i < command.length; i += 1) {
    const ch = command[i];
    if (ch === '\\' && quote !== "'" && i + 1 < command.length) {
      i += 1;
      continue;
    }
    if (quote) {
      if (ch === quote) quote = null;
      continue;
    }
    if (ch === '"' || ch === "'") {
      quote = ch;
      continue;
    }
    if (ch === ';' || ch === '\n' || ch === '\r' || ch === '&' || (ch === '|' && command[i + 1] === '|')) {
      return true;
    }
  }
  return Boolean(quote);
}

/** Tokenizes one shell segment while preserving quoted arguments as single tokens. */
function tokenizeShellSegment(segment) {
  const tokens = [];
  let current = '';
  let quote = null;
  let started = false;

  for (let i = 0; i < segment.length; i += 1) {
    const ch = segment[i];

    if (ch === '\\' && quote !== "'" && i + 1 < segment.length) {
      current += segment[i + 1];
      started = true;
      i += 1;
      continue;
    }

    if (quote) {
      if (ch === quote) quote = null;
      else current += ch;
      started = true;
      continue;
    }

    if (ch === '"' || ch === "'") {
      quote = ch;
      started = true;
      continue;
    }

    if (/\s/.test(ch)) {
      if (started) tokens.push(current);
      current = '';
      started = false;
      continue;
    }

    current += ch;
    started = true;
  }

  if (quote) return null;
  if (started) tokens.push(current);
  return tokens;
}

/** Removes options and their values to leave command positional arguments. */
function positionalArguments(args, optionsWithValue = new Set()) {
  const positionals = [];
  let afterOptions = false;

  for (let i = 0; i < args.length; i += 1) {
    const arg = args[i];
    if (afterOptions) {
      positionals.push(arg);
      continue;
    }
    if (arg === '--') {
      afterOptions = true;
      continue;
    }
    if (arg.startsWith('-') && arg !== '-') {
      const option = arg.split('=')[0];
      if (optionsWithValue.has(option) && !arg.includes('=')) i += 1;
      continue;
    }
    positionals.push(arg);
  }

  return positionals;
}

/** Converts a parsed inspection target to a normalized evidence record. */
function makeTargetEvidence(targetArg, pattern = targetArg) {
  const target = resolveEvidencePath(targetArg);
  return target ? { target, pattern: String(pattern).slice(0, 300) } : null;
}

/** Parses path evidence from a Git inspection command. */
function gitInvestigationTarget(args) {
  const subcommandIndex = args.findIndex(arg => !arg.startsWith('-'));
  const subcommand = subcommandIndex >= 0 ? args[subcommandIndex].toLowerCase() : '';
  if (!GIT_INVESTIGATIVE_SUBCOMMANDS.has(subcommand)) return null;

  const rest = args.slice(subcommandIndex + 1);
  const separator = rest.indexOf('--');
  const pathspecs = separator >= 0 ? positionalArguments(rest.slice(separator + 1)) : [];
  const objectArgs = separator >= 0 ? rest.slice(0, separator) : rest;
  let targetArg = pathspecs[0] || '';

  if (subcommand === 'show' && !targetArg) {
    const objectPath = positionalArguments(objectArgs, GIT_SHOW_OPTIONS_WITH_VALUE)
      .find(arg => !arg.startsWith('-') && arg.includes(':'));
    if (objectPath) targetArg = objectPath.slice(objectPath.indexOf(':') + 1);
  } else if (subcommand === 'blame' && !targetArg) {
    targetArg = positionalArguments(rest)[0] || '';
  }
  return targetArg ? makeTargetEvidence(targetArg) : null;
}

/** Rejects grep options the evidence parser cannot safely interpret. */
function isSupportedGrepOptions(args, executable) {
  const valueOptions = GREP_OPTIONS_WITH_VALUE_FOR_COMMAND[executable];
  for (let i = 0; i < args.length; i += 1) {
    const argument = args[i];
    if (argument === '--') break;
    if (!argument.startsWith('-') || argument === '-') continue;

    const option = argument.split('=')[0];
    if (valueOptions.has(option)) {
      if (!argument.includes('=')) {
        if (i + 1 >= args.length) return false;
        i += 1;
      }
      continue;
    }
    if (GREP_LONG_BOOLEAN_OPTIONS.has(option)) {
      if (argument.includes('=')) return false;
      continue;
    }
    if (argument.startsWith('--')) return false;

    let validCluster = true;
    for (const flag of argument.slice(1)) {
      if (valueOptions.has('-' + flag)) break;
      if (!GREP_SHORT_BOOLEAN_OPTIONS.has('-' + flag)) {
        validCluster = false;
        break;
      }
    }
    if (!validCluster) return false;
  }
  return true;
}

/** Parses file or pattern evidence from grep and ripgrep. */
function grepInvestigationTarget(args, executable) {
  if (!isSupportedGrepOptions(args, executable)) return null;
  const patternOptions = new Set(['-e', '-f', '--regexp', '--file']);
  const patternIndex = args.findIndex(arg => patternOptions.has(arg));
  const inlinePattern = args.find(arg => arg.startsWith('--regexp='))?.slice('--regexp='.length)
    || args.find(arg => arg.startsWith('--file='))?.slice('--file='.length)
    || args.find(arg => /^-e.+/.test(arg))?.slice(2)
    || '';
  const hasPattern = patternIndex >= 0 || Boolean(inlinePattern);
  const pattern = patternIndex >= 0 ? args[patternIndex + 1] || '' : inlinePattern;
  const positionals = positionalArguments(args, GREP_OPTIONS_WITH_VALUE_FOR_COMMAND[executable]);
  const inferredPattern = hasPattern ? pattern : positionals[0] || '';
  const targetArg = args.includes('--files')
    ? positionals[0] || ''
    : positionals[hasPattern ? 0 : 1] || '';
  return targetArg ? makeTargetEvidence(targetArg, inferredPattern || targetArg) : null;
}

/** Parses the search root from a find expression. */
function findInvestigationTarget(args) {
  if (args.some(arg => FIND_MUTATING_ACTIONS.has(arg.toLowerCase()))) return null;
  let index = 0;
  while (['-H', '-L', '-P'].includes(args[index])) index += 1;
  const start = index;
  while (index < args.length && args[index] !== '!' && args[index] !== '(' && !args[index].startsWith('-')) index += 1;
  return makeTargetEvidence(args[start] || '.');
}

/** Returns a concrete target and query for one allowlisted inspection command. */
function investigativeTarget(tokens) {
  if (!tokens.length) return null;
  const executable = tokens[0].toLowerCase();
  if (!INVESTIGATIVE_COMMANDS.has(executable)) return null;
  const args = tokens.slice(1);
  if (args.some(arg => ['--help', '-h', '--version', '-V'].includes(arg))) return null;
  if (executable === 'git') return gitInvestigationTarget(args);
  if (executable === 'grep' || executable === 'rg') return grepInvestigationTarget(args, executable);
  if (executable === 'find') return findInvestigationTarget(args);
  if (executable === 'fd' || executable === 'fdfind') {
    const positionals = positionalArguments(args, FD_OPTIONS_WITH_VALUE);
    return makeTargetEvidence(positionals[1] || '', positionals[0] || positionals[1] || '');
  }
  const targetArg = positionalArguments(args, PATH_OPTIONS_WITH_VALUE)[0] || '';
  return targetArg ? makeTargetEvidence(targetArg) : null;
}

/** Finds the first allowlisted inspection command with a concrete target. */
function investigativeCommandEvidence(command) {
  // Conditionals, sequential commands, and newlines can skip commands or change cwd.
  // A plain pipeline is safe to inspect because each pipeline stage is invoked.
  if (hasUnsafeShellControlFlow(command)) return null;

  for (const segment of splitShellCommandSegments(command)) {
    const tokens = tokenizeShellSegment(segment);
    if (!tokens || tokens.length === 0) continue;
    const evidence = investigativeTarget(tokens);
    if (evidence) return evidence;
  }
  return null;
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
 * Checks whether an edit changes only whitespace without parsing source syntax.
 * Ambiguous syntax falls back to the normal fact-forcing gate.
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
  if (!WHITESPACE_SAFE_EXTS.has(ext)) return false;

  const isIndentSensitive = INDENT_SENSITIVE_EXTS.has(ext) || INDENT_SENSITIVE_BASES.has(base);
  function normalizeWhitespace(text) {
    // Without a parser, quotes, escapes, and slash-delimited syntax can contain
    // semantic whitespace or comment-shaped string content. Do not auto-pass it.
    if (/['"`/\\]/.test(text)) return null;

    const lines = text.split(/\r?\n/).map(line => {
      const leading = line.match(/^[ \t]*/)[0];
      const body = line.slice(leading.length).replace(/[ \t]+/g, ' ').trimEnd();
      return isIndentSensitive ? `${leading}${body}` : body;
    });
    while (lines.length && lines[lines.length - 1] === '') lines.pop();
    return lines.join('\n');
  }

  const oldNormalized = normalizeWhitespace(oldStr);
  const newNormalized = normalizeWhitespace(newStr);
  return oldNormalized !== null && newNormalized !== null && oldNormalized === newNormalized;
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

/** Restores the newest valid backup if an interrupted replacement left no state file. */
function restoreStateBackup(stateFile) {
  const resolved = path.resolve(stateFile);
  if (fs.existsSync(resolved)) return false;

  const dir = path.dirname(resolved);
  const prefix = `${path.basename(resolved)}.backup.`;
  let names;
  try {
    names = fs.readdirSync(dir).filter(name => name.startsWith(prefix));
  } catch (err) {
    if (err && err.code === 'ENOENT') return false;
    throw err;
  }

  const candidates = names.map(name => path.join(dir, name)).map(file => ({
    file,
    modified: fs.lstatSync(file).mtimeMs
  })).sort((a, b) => b.modified - a.modified);

  for (const candidate of candidates) {
    const stat = fs.lstatSync(candidate.file);
    if (!stat.isFile() || stat.isSymbolicLink()) continue;
    try {
      const state = JSON.parse(fs.readFileSync(candidate.file, 'utf8'));
      if (!state || typeof state !== 'object' || Array.isArray(state)) continue;
    } catch (_err) {
      /* Ignore malformed backup candidates and try the next one. */
      continue;
    }
    fs.renameSync(candidate.file, resolved);
    return true;
  }
  return false;
}

/**
 * Loads and parses state file from disk, returning default state on missing/malformed file.
 * @param {string} stateFile Path to state file.
 * @returns {Object} Parsed state object or empty template.
 */
function loadStateFromDisk(stateFile) {
  const resolved = path.resolve(stateFile);
  restoreStateBackup(resolved);
  if (fs.existsSync(resolved)) {
    try {
      return JSON.parse(fs.readFileSync(resolved, 'utf8'));
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
 * @param {(source: string, destination: string) => void} [renameFile=fs.renameSync] Rename operation, injectable for failure tests.
 */
function writeStateToDiskAtomic(stateFile, state, renameFile = fs.renameSync) {
  const resolvedDest = path.resolve(stateFile);
  restoreStateBackup(resolvedDest);
  const tmpFile = path.resolve(`${resolvedDest}.tmp.${process.pid}.${crypto.randomBytes(4).toString('hex')}`);
  let renamed = false;
  try {
    fs.writeFileSync(tmpFile, JSON.stringify(state, null, 2), { encoding: 'utf8', mode: 0o600, flag: 'wx' });
    try {
      renameFile(tmpFile, resolvedDest);
    } catch (initialError) {
      if (!initialError || (initialError.code !== 'EEXIST' && initialError.code !== 'EPERM')) {
        throw initialError;
      }

      if (!fs.existsSync(resolvedDest)) {
        renameFile(tmpFile, resolvedDest);
      } else {
        const destinationStat = fs.lstatSync(resolvedDest);
        if (!destinationStat.isFile()) {
          throw initialError;
        }

        const backupFile = `${resolvedDest}.backup.${Date.now()}.${process.pid}.${crypto.randomBytes(4).toString('hex')}`;
        renameFile(resolvedDest, backupFile);
        try {
          renameFile(tmpFile, resolvedDest);
        } catch (replaceError) {
          try {
            renameFile(backupFile, resolvedDest);
          } catch (restoreError) {
            throw new Error(`${replaceError.message}; prior state is preserved at ${backupFile} because restoration failed: ${restoreError.message}`);
          }
          throw replaceError;
        }
        renamed = true;
        try {
          fs.unlinkSync(backupFile);
        } catch (cleanupError) {
          process.stderr.write(`[GateGuard] State was updated, but backup cleanup failed at ${backupFile}: ${cleanupError.message}\n`);
        }
      }
    }
    renamed = true;
  } finally {
    if (!renamed) {
      try { fs.unlinkSync(tmpFile); } catch (_cleanupErr) { void 0; }
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
  const stateDir = path.resolve(getStateDir());
  const stateFile = path.resolve(stateDir, `state-${sessionKey}.json`);
  if (!isPathInsideDirectory(stateDir, stateFile) || stateFile === stateDir) {
    return { output: '', exitCode: 0 };
  }

  try {
    withStateFileLock(`${stateFile}.lock`, () => {
      fs.mkdirSync(stateDir, { recursive: true });
      const diskState = loadStateFromDisk(stateFile);

      const now = Date.now();
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
