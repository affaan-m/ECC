'use strict';

const path = require('path');

function normalizePath(value) {
  if (!value) return '';
  return String(value).replace(/\\/g, '/').trim();
}

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

module.exports = { isTrivialChange, riskTier };
