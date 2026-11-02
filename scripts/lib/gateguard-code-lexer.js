'use strict';

// --- Code lines ---
// see docs/gateguard/change-profile.md#trivial-edits

function isSpace(ch) {
  return ch === ' ' || ch === '\t' || ch === '\f' || ch === '\v';
}

function isIdentChar(ch) {
  return ch !== undefined && ((ch >= 'a' && ch <= 'z') || (ch >= 'A' && ch <= 'Z') || (ch >= '0' && ch <= '9') || ch === '_' || ch === '$');
}

function isLetter(ch) {
  return ch !== undefined && ((ch >= 'a' && ch <= 'z') || (ch >= 'A' && ch <= 'Z'));
}

function rustCharEnd(text, i) {
  if (text[i + 1] === '\\') {
    if (text[i + 2] === "'") return text[i + 3] === "'" ? i + 3 : -1;
    const end = text.indexOf("'", i + 3);
    return end !== -1 && end <= i + 12 ? end : -1;
  }
  const cp = text.codePointAt(i + 1);
  if (cp === undefined || text[i + 1] === '\n' || text[i + 1] === '\r' || text[i + 1] === "'") return -1;
  const end = i + (cp > 0xffff ? 3 : 2);
  return text[end] === "'" ? end : -1;
}

function stringPrefixIsUnsafe(code, spec) {
  const last = code[code.length - 1];
  if (spec.rawPrefixes && last !== undefined && spec.rawPrefixes.includes(last)) return true;
  if (!spec.fStrings || !isLetter(last)) return false;
  const prefix = isLetter(code[code.length - 2]) ? code.slice(-2) : last;
  return prefix.toLowerCase().includes('f');
}

// --- Directive comments ---
// see docs/gateguard/change-profile.md#directive-comments

const DIRECTIVE_LEADS = ['@', '#', '<', '+', '!', 'type:', 'global ', 'globals ', 'exported ', 'requires'];
const DIRECTIVE_RAW_LEADS = ['!', '/', 'go:', 'export ', 'extern ', 'line '];
const DIRECTIVE_WORDS = [
  'lint', 'jshint', 'ts-', 'noqa', 'nosec', 'semgrep', 'sonar', 'noinspection', 'pragma', 'coding:', 'coding=', 'fmt:', 'isort:',
  'mypy:', 'pyright:', 'pyre-', 'yapf:', 'ruff:', 'flake8', 'bandit', 'no cover', 'nocover', 'istanbul', 'c8 ', 'v8 ',
  'prettier-', 'biome-', 'deno-', 'dprint-', 'rome-', 'webpack', 'vite-', '__pure__', '__no_side_effects__',
  '__inline__', '@preserve', '@license', 'sourcemappingurl', 'sourceurl', '+build', 'cgo', 'clang-', 'cppcheck',
  'coverity', 'iwyu', 'fallthrough', 'fall through', 'fall-through', 'fallthru', 'fall thru', 'shellcheck',
  'psscriptanalyzer', 'suppress', 'jscs', 'checkstyle', 'spotbugs', 'findbugs', 'nopmd', 'codeql', 'lgtm', 'gitleaks',
  'trufflehog', 'detect-secrets', 'allowlist', 'vim:', 'vi:', ' ex:', '-*-', 'code generated', 'do not edit',
  'rubocop', 'swiftlint', 'resharper', '@ts-', '@type', '@typedef', '@template', '@satisfies', '@import', '@callback',
  '@overload', '@enum', '@this', '@implements', '@extends', '@augments', '@jsx', '@flow', '@noflow', '@generated',
  'compdef', 'autoload', 'output:'
];

function isDirectiveComment(body, spec) {
  if (spec.rustDocs && (body[0] === '/' || body[0] === '!' || body[0] === '*')) return true;
  if (DIRECTIVE_RAW_LEADS.some(lead => body.startsWith(lead))) return true;
  const lower = body.toLowerCase();
  let start = 0;
  while (start < lower.length && (isSpace(lower[start]) || lower[start] === '*' || lower[start] === '/')) start++;
  const lead = lower.slice(start);
  if (DIRECTIVE_LEADS.some(word => lead.startsWith(word))) return true;
  if (DIRECTIVE_WORDS.some(word => lower.includes(word))) return true;
  return lower.includes('@') && lower.includes('{');
}

function directiveMarker(body, spec) {
  return isDirectiveComment(body, spec) ? ` \u0001${Buffer.from(body, 'utf8').toString('hex')}\u0001 ` : '';
}

function endsWithContinuation(code) {
  let end = code.length;
  while (end > 0 && isSpace(code[end - 1])) end--;
  return code[end - 1] === '\\';
}

const CODE_SPECIALS = new WeakMap();

function escapeClass(chars) {
  return chars.replace(/[\\\]^-]/g, ch => `\\${ch}`);
}

function codeSpecials(spec) {
  let specials = CODE_SPECIALS.get(spec);
  if (!specials) {
    const chars = `\n\r/${spec.lineComment === '#' ? '#' : ''}${spec.quotes || ''}${spec.forbiddenCode || ''}${spec.jsx !== undefined ? '<-' : ''}${spec.rustChars ? "'" : ''}`;
    specials = { pattern: new RegExp(`[${escapeClass(chars)}]`, 'g'), chars: new Set(chars) };
    CODE_SPECIALS.set(spec, specials);
  }
  return specials;
}

function nextSpecial(pattern, text, i) {
  pattern.lastIndex = i;
  const match = pattern.exec(text);
  return match ? match.index : text.length;
}

const LINE_BREAK = /[\n\r]/g;
const BLOCK_SPECIALS = /[\n\r*/]/g;
const STRING_SPECIALS = new Map();

function stringSpecials(quote) {
  let pattern = STRING_SPECIALS.get(quote);
  if (!pattern) {
    pattern = new RegExp(`[\\n\\r\\\\${escapeClass(quote)}]`, 'g');
    STRING_SPECIALS.set(quote, pattern);
  }
  return pattern;
}

// --- lexCodeLines state ---
// lx carries the text, spec and partial line. Each step reads from index i and
// returns the index of the last consumed character, or null when the text is
// not lexable and the edit cannot be trivial.

function appendCode(lx, piece) {
  lx.code += piece;
  lx.tail = (lx.tail + piece).slice(-2);
}

function endComment(lx, end) {
  const marker = directiveMarker(lx.text.slice(lx.commentStart, end), lx.spec);
  if (marker) appendCode(lx, marker);
}

function endLine(lx) {
  if (endsWithContinuation(lx.code)) return false;
  lx.lines.push(lx.code);
  lx.code = '';
  lx.tail = '';
  return true;
}

function lexNewline(lx, i) {
  const { text } = lx;
  if (lx.state === 'string') return null;
  if (lx.state === 'line') {
    if (text.slice(lx.commentStart, i).trimEnd().endsWith('\\')) return null;
    endComment(lx, i);
    lx.state = 'code';
  }
  if (lx.state === 'block') {
    lx.lines.push(lx.code);
    lx.code = '';
    lx.tail = '';
  } else if (!endLine(lx)) {
    return null;
  }
  return text[i] === '\r' && text[i + 1] === '\n' ? i + 1 : i;
}

function lexLineComment(lx, i) {
  return nextSpecial(LINE_BREAK, lx.text, i) - 1;
}

function lexBlockComment(lx, i) {
  const { text } = lx;
  const ch = text[i];
  if (ch !== '*' && ch !== '/') return nextSpecial(BLOCK_SPECIALS, text, i + 1) - 1;
  if (ch === '*' && text[i + 1] === '/') {
    endComment(lx, i);
    lx.state = 'code';
    appendCode(lx, ' ');
    return i + 1;
  }
  if (ch === '/' && text[i + 1] === '*') return null;
  return i;
}

function lexString(lx, i) {
  const { text, quote } = lx;
  const ch = text[i];
  if (ch !== '\\' && ch !== quote) {
    const end = nextSpecial(stringSpecials(quote), text, i + 1);
    const run = text.slice(i, end);
    appendCode(lx, run);
    lx.stringBody += run;
    return end - 1;
  }
  appendCode(lx, ch);
  if (ch === '\\') {
    const next = text[i + 1];
    if (next === undefined || next === '\n' || next === '\r') return null;
    appendCode(lx, next);
    return i + 1;
  }
  if (lx.spec.noDollarInStrings && lx.stringBody.includes('$')) return null;
  lx.state = 'code';
  return i;
}

function lexCommentStart(lx, i) {
  const { text, spec } = lx;
  const ch = text[i];
  if (spec.lineComment === '//' && ch === '/' && text[i + 1] === '/') {
    lx.state = 'line';
    lx.commentStart = i + 2;
    return i + 1;
  }
  if (spec.lineComment === '#' && ch === '#') {
    lx.state = 'line';
    lx.commentStart = i + 1;
    return i;
  }
  if (spec.blockComment && ch === '/' && text[i + 1] === '*') {
    lx.state = 'block';
    lx.commentStart = i + 2;
    return i + 1;
  }
  return undefined;
}

function startsJsx(spec, text, i) {
  const ch = text[i];
  const next = text[i + 1];
  if (spec.jsx && ch === '<') return isLetter(next) || next === '/' || next === '>' || next === '!';
  return spec.jsx !== undefined && ch === '-' && next === '-' && text[i + 2] === '>';
}

function lexStringStart(lx, i) {
  const { text, spec } = lx;
  const ch = text[i];
  if (spec.tripleQuotes && text[i + 1] === ch && text[i + 2] === ch) return null;
  if (stringPrefixIsUnsafe(lx.tail, spec)) return null;
  lx.state = 'string';
  lx.quote = ch;
  lx.stringBody = '';
  appendCode(lx, ch);
  return i;
}

function lexCode(lx, i) {
  const { text, spec } = lx;
  const ch = text[i];
  if (!lx.specials.chars.has(ch)) {
    const end = nextSpecial(lx.specials.pattern, text, i + 1);
    appendCode(lx, text.slice(i, end));
    return end - 1;
  }
  const comment = lexCommentStart(lx, i);
  if (comment !== undefined) return comment;
  if (spec.forbiddenCode && spec.forbiddenCode.includes(ch)) return null;
  if (startsJsx(spec, text, i)) return null;
  if (ch === "'" && spec.rustChars) {
    const end = rustCharEnd(text, i);
    appendCode(lx, end === -1 ? ch : text.slice(i, end + 1));
    return end === -1 ? i : end;
  }
  if (spec.quotes.includes(ch)) return lexStringStart(lx, i);
  appendCode(lx, ch);
  return i;
}

const LEX_STEPS = { code: lexCode, line: lexLineComment, block: lexBlockComment, string: lexString };

function finishLex(lx) {
  if (lx.state === 'string' || lx.state === 'block') return null;
  if (lx.state === 'line') {
    if (lx.text.slice(lx.commentStart).trimEnd().endsWith('\\')) return null;
    endComment(lx, lx.text.length);
  }
  return endLine(lx) ? lx.lines : null;
}

function lexCodeLines(text, spec) {
  const lx = { text, spec, specials: codeSpecials(spec), lines: [], code: '', state: 'code', quote: '', stringBody: '', commentStart: 0, tail: '' };
  if (spec.jsx !== undefined && text.startsWith('#!')) lx.state = 'line';
  for (let i = 0; i < text.length; i++) {
    const ch = text[i];
    const next = ch === '\n' || ch === '\r' ? lexNewline(lx, i) : LEX_STEPS[lx.state](lx, i);
    if (next === null) return null;
    i = next;
  }
  return finishLex(lx);
}

function normalizeCodeLine(line, spec) {
  let out = '';
  let pendingSpace = false;
  let quote = '';
  let indent = '';
  let leading = true;
  for (let i = 0; i < line.length; i++) {
    const ch = line[i];
    if (quote) {
      out += ch;
      if (ch === '\\' && i + 1 < line.length) out += line[++i];
      else if (ch === quote) quote = '';
      continue;
    }
    if (isSpace(ch)) {
      if (leading) indent += ch;
      else pendingSpace = true;
      continue;
    }
    leading = false;
    if (pendingSpace && out) out += ' ';
    pendingSpace = false;
    if (ch === "'" && spec.rustChars) {
      const end = rustCharEnd(line, i);
      out += end === -1 ? ch : line.slice(i, end + 1);
      if (end !== -1) i = end;
      continue;
    }
    if (spec.quotes.includes(ch)) quote = ch;
    out += ch;
  }
  if (!out) return '';
  return spec.indentSensitive ? `${indent}\u0000${out}` : out;
}

function hasSpaceAfterContinuation(line) {
  let end = line.length;
  while (end > 0 && isSpace(line[end - 1])) end--;
  return end < line.length && line[end - 1] === '\\';
}

function codeSignature(text, spec) {
  const lines = spec.lexer ? spec.lexer(text) : lexCodeLines(text, spec);
  if (lines === null) return null;
  const signature = [];
  for (const line of lines) {
    if (hasSpaceAfterContinuation(line)) return null;
    const normalized = spec.normalize ? spec.normalize(line) : normalizeCodeLine(line, spec);
    if (normalized === null) return null;
    if (normalized) signature.push(normalized);
  }
  return signature;
}

// JavaScript ends a line at U+2028 and U+2029, and C# also at U+0085; the lexer splits only at \n and \r.
const UNICODE_LINE_TERMINATORS = /[\u0085\u2028\u2029]/;

function isTrivialEdit(oldString, newString, spec) {
  if (UNICODE_LINE_TERMINATORS.test(oldString) || UNICODE_LINE_TERMINATORS.test(newString)) return false;
  if (spec.lineComment === '//' && (oldString.includes('??/') || newString.includes('??/'))) return false;
  const before = codeSignature(oldString, spec);
  if (before === null) return false;
  const after = codeSignature(newString, spec);
  if (after === null || before.length !== after.length) return false;
  return before.every((line, index) => line === after[index]);
}


// --- Shell lexing ---
// see docs/gateguard/change-profile.md#shell-scripts

const SHELL_SPEC = Object.freeze({});

function isLineStart(text, i) {
  return i === 0 || text[i - 1] === '\n' || text[i - 1] === '\r';
}

function hashStartsComment(text, i) {
  if (isLineStart(text, i)) return true;
  const prev = text[i - 1];
  if (prev === ' ' || prev === '\t' || prev === ';') return true;
  return '()|&<>'.includes(prev) ? null : false;
}

function shDoubleQuoteEnd(text, i) {
  for (let j = i + 1; j < text.length; j++) {
    const ch = text[j];
    if (ch === '"') return j;
    if (ch === '\n' || ch === '\r' || ch === '`') return -1;
    if (ch === '\\') {
      if (j + 1 >= text.length || text[j + 1] === '\n' || text[j + 1] === '\r') return -1;
      j++;
    } else if (ch === '$' && text[j + 1] === '(') {
      return -1;
    } else if (ch === '$' && text[j + 1] === '{') {
      const close = text.indexOf('}', j + 2);
      if (close === -1) return -1;
      for (let k = j + 2; k < close; k++) {
        if ('"\'\n\r'.includes(text[k])) return -1;
      }
      j = close;
    }
  }
  return -1;
}

function hasLoneCarriageReturn(text) {
  for (let at = text.indexOf('\r'); at !== -1; at = text.indexOf('\r', at + 1)) {
    if (text[at + 1] !== '\n') return true;
  }
  return false;
}

function isBlank(ch) {
  return ch === ' ' || ch === '\t';
}

// --- Shell and PowerShell readers ---
// Each reader appends what it consumed to lx.code and returns the index of the
// last consumed character, or -1 when the text is not lexable.

function pushShellLine(lx, i) {
  lx.lines.push(lx.code);
  lx.code = '';
  return lx.text[i] === '\r' && lx.text[i + 1] === '\n' ? i + 1 : i;
}

function readEscapedPair(lx, i) {
  const next = lx.text[i + 1];
  if (next === undefined || next === '\n' || next === '\r') return -1;
  lx.code += lx.text[i] + next;
  return i + 1;
}

function readQuotedSpan(lx, i, end) {
  if (end === -1) return -1;
  lx.code += lx.text.slice(i, end + 1);
  return end;
}

function lineCommentEnd(text, i) {
  while (i + 1 < text.length && text[i + 1] !== '\n' && text[i + 1] !== '\r') i++;
  return i;
}

function readLineComment(lx, i) {
  const end = lineCommentEnd(lx.text, i);
  lx.code += directiveMarker(lx.text.slice(i + 1, end + 1), SHELL_SPEC);
  return end;
}

function shSingleQuoted(lx, i) {
  const { text } = lx;
  if (text[i - 1] === '$') return -1;
  const end = text.indexOf("'", i + 1);
  if (end === -1) return -1;
  const body = text.slice(i, end + 1);
  if (body.includes('\n') || body.includes('\r')) return -1;
  lx.code += body;
  return end;
}

function shDoubleQuoted(lx, i) {
  return readQuotedSpan(lx, i, shDoubleQuoteEnd(lx.text, i));
}

function shHash(lx, i) {
  const starts = hashStartsComment(lx.text, i);
  if (starts === null) return -1;
  if (!starts) {
    lx.code += '#';
    return i;
  }
  return readLineComment(lx, i);
}

const SH_READERS = new Map([['\\', readEscapedPair], ["'", shSingleQuoted], ['"', shDoubleQuoted], ['#', shHash]]);

function shCodeLines(text) {
  if (text.includes('<<') || text.includes('`') || hasLoneCarriageReturn(text)) return null;
  const lx = { text, code: '', lines: [] };
  for (let i = 0; i < text.length; i++) {
    const ch = text[i];
    if (ch === '\n' || ch === '\r') {
      i = pushShellLine(lx, i);
      continue;
    }
    const reader = SH_READERS.get(ch);
    if (!reader) {
      lx.code += ch;
      continue;
    }
    i = reader(lx, i);
    if (i === -1) return null;
  }
  lx.lines.push(lx.code);
  return lx.lines;
}

const PS_SMART_QUOTES = /[\u2018\u2019\u201a\u201b\u201c\u201d\u201e]/;

function psHashStartsComment(text, i) {
  if (isLineStart(text, i)) return true;
  const prev = text[i - 1];
  return prev === ' ' || prev === '\t' || prev === ';';
}

function psQuoteEnd(text, i) {
  const quote = text[i];
  for (let j = i + 1; j < text.length; j++) {
    const ch = text[j];
    if (ch === '\n' || ch === '\r') return -1;
    if (quote === '"' && ch === '`') {
      if (j + 1 >= text.length || text[j + 1] === '\n' || text[j + 1] === '\r') return -1;
      j++;
    } else if (quote === '"' && ch === '$' && text[j + 1] === '(') {
      return -1;
    } else if (ch === quote) {
      if (text[j + 1] !== quote) return j;
      j++;
    }
  }
  return -1;
}

function psQuoted(lx, i) {
  return readQuotedSpan(lx, i, psQuoteEnd(lx.text, i));
}

function psBlockStart(lx, i) {
  if (!psHashStartsComment(lx.text, i)) return -1;
  lx.block = true;
  lx.blockStart = i + 2;
  return i + 1;
}

function psHash(lx, i) {
  if (!psHashStartsComment(lx.text, i)) return -1;
  return readLineComment(lx, i);
}

function psBlockComment(lx, i) {
  const { text } = lx;
  if (text[i] === '<' && text[i + 1] === '#') return -1;
  if (text[i] === '#' && text[i + 1] === '>') {
    lx.block = false;
    lx.code += directiveMarker(text.slice(lx.blockStart, i), SHELL_SPEC) || ' ';
    return i + 1;
  }
  return i;
}

function psToken(lx, i) {
  const ch = lx.text[i];
  if (ch === '`') return readEscapedPair(lx, i);
  if (ch === "'" || ch === '"') return psQuoted(lx, i);
  if (ch === '<' && lx.text[i + 1] === '#') return psBlockStart(lx, i);
  if (ch === '#') return psHash(lx, i);
  lx.code += ch;
  return i;
}

function psCodeLines(text) {
  if (text.includes('@"') || text.includes("@'") || PS_SMART_QUOTES.test(text)) return null;
  const lx = { text, code: '', lines: [], block: false, blockStart: 0 };
  for (let i = 0; i < text.length; i++) {
    const ch = text[i];
    if (ch === '\n' || ch === '\r') {
      i = pushShellLine(lx, i);
      continue;
    }
    i = lx.block ? psBlockComment(lx, i) : psToken(lx, i);
    if (i === -1) return null;
  }
  if (lx.block) return null;
  lx.lines.push(lx.code);
  return lx.lines;
}

function batchCodeLines(text) {
  const lines = [];
  for (const line of text.split(/\r\n|\r|\n/)) {
    if (line.endsWith('^')) return null;
    let start = 0;
    while (isBlank(line[start])) start++;
    if (line[start] === '@') start++;
    while (isBlank(line[start])) start++;
    const word = line.slice(start, start + 3).toLowerCase();
    const after = line[start + 3];
    if (word === 'rem' && (after === undefined || isBlank(after))) {
      if (/[%^&|<>()]/.test(line)) return null;
      lines.push(directiveMarker(line.slice(start + 4), SHELL_SPEC));
    } else {
      lines.push(line.trim() ? line : '');
    }
  }
  return lines;
}

function normalizeShellLine(line, escape) {
  let out = '';
  let pendingSpace = false;
  for (let i = 0; i < line.length; i++) {
    const ch = line[i];
    if (isBlank(ch)) {
      pendingSpace = true;
      continue;
    }
    if (pendingSpace && out) out += ' ';
    pendingSpace = false;
    if (ch === escape && i + 1 < line.length) {
      out += ch + line[++i];
    } else if (ch === "'" || ch === '"') {
      const end = escape === '`' ? psQuoteEnd(line, i) : ch === "'" ? line.indexOf("'", i + 1) : shDoubleQuoteEnd(line, i);
      if (end === -1) return null;
      out += line.slice(i, end + 1);
      i = end;
    } else {
      out += ch;
    }
  }
  return out;
}


module.exports = {
  isSpace,
  isIdentChar,
  isLetter,
  rustCharEnd,
  isBlank,
  hashStartsComment,
  hasLoneCarriageReturn,
  PS_SMART_QUOTES,
  psHashStartsComment,
  isTrivialEdit,
  shCodeLines,
  psCodeLines,
  batchCodeLines,
  normalizeShellLine
};
