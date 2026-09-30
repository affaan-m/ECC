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

function lexCodeLines(text, spec) {
  const specials = codeSpecials(spec);
  const lines = [];
  let code = '';
  let state = 'code';
  let quote = '';
  let stringBody = '';
  let commentStart = 0;
  let tail = '';
  const append = piece => {
    code += piece;
    tail = (tail + piece).slice(-2);
  };
  const endComment = end => {
    const marker = directiveMarker(text.slice(commentStart, end), spec);
    if (marker) append(marker);
  };
  const endLine = () => {
    if (endsWithContinuation(code)) return false;
    lines.push(code);
    code = '';
    tail = '';
    return true;
  };
  if (spec.jsx !== undefined && text.startsWith('#!')) state = 'line';
  for (let i = 0; i < text.length; i++) {
    const ch = text[i];
    if (ch === '\n' || ch === '\r') {
      if (state === 'string') return null;
      if (state === 'line') {
        if (text.slice(commentStart, i).trimEnd().endsWith('\\')) return null;
        endComment(i);
        state = 'code';
      }
      if (state === 'block') {
        lines.push(code);
        code = '';
        tail = '';
      } else if (!endLine()) {
        return null;
      }
      if (ch === '\r' && text[i + 1] === '\n') i++;
      continue;
    }
    if (state === 'line') {
      i = nextSpecial(LINE_BREAK, text, i) - 1;
      continue;
    }
    if (state === 'block') {
      if (ch !== '*' && ch !== '/') {
        i = nextSpecial(BLOCK_SPECIALS, text, i + 1) - 1;
        continue;
      }
      if (ch === '*' && text[i + 1] === '/') {
        endComment(i);
        state = 'code';
        append(' ');
        i++;
      } else if (ch === '/' && text[i + 1] === '*') {
        return null;
      }
      continue;
    }
    if (state === 'string') {
      if (ch !== '\\' && ch !== quote) {
        const end = nextSpecial(stringSpecials(quote), text, i + 1);
        const run = text.slice(i, end);
        append(run);
        stringBody += run;
        i = end - 1;
        continue;
      }
      append(ch);
      if (ch === '\\') {
        const next = text[i + 1];
        if (next === undefined || next === '\n' || next === '\r') return null;
        append(next);
        i++;
      } else if (ch === quote) {
        if (spec.noDollarInStrings && stringBody.includes('$')) return null;
        state = 'code';
      } else {
        stringBody += ch;
      }
      continue;
    }
    if (!specials.chars.has(ch)) {
      const end = nextSpecial(specials.pattern, text, i + 1);
      append(text.slice(i, end));
      i = end - 1;
      continue;
    }
    if (spec.lineComment === '//' && ch === '/' && text[i + 1] === '/') {
      state = 'line';
      commentStart = i + 2;
      i++;
      continue;
    }
    if (spec.lineComment === '#' && ch === '#') {
      state = 'line';
      commentStart = i + 1;
      continue;
    }
    if (spec.blockComment && ch === '/' && text[i + 1] === '*') {
      state = 'block';
      commentStart = i + 2;
      i++;
      continue;
    }
    if (spec.forbiddenCode && spec.forbiddenCode.includes(ch)) return null;
    if (spec.jsx && ch === '<' && (isLetter(text[i + 1]) || text[i + 1] === '/' || text[i + 1] === '>' || text[i + 1] === '!')) return null;
    if (spec.jsx !== undefined && ch === '-' && text[i + 1] === '-' && text[i + 2] === '>') return null;
    if (ch === "'" && spec.rustChars) {
      const end = rustCharEnd(text, i);
      append(end === -1 ? ch : text.slice(i, end + 1));
      if (end !== -1) i = end;
      continue;
    }
    if (spec.quotes.includes(ch)) {
      if (spec.tripleQuotes && text[i + 1] === ch && text[i + 2] === ch) return null;
      if (stringPrefixIsUnsafe(tail, spec)) return null;
      state = 'string';
      quote = ch;
      stringBody = '';
      append(ch);
      continue;
    }
    append(ch);
  }
  if (state === 'string' || state === 'block') return null;
  if (state === 'line') {
    if (text.slice(commentStart).trimEnd().endsWith('\\')) return null;
    endComment(text.length);
  }
  return endLine() ? lines : null;
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

function isTrivialEdit(oldString, newString, spec) {
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

function shCodeLines(text) {
  if (text.includes('<<') || text.includes('`') || hasLoneCarriageReturn(text)) return null;
  const lines = [];
  let code = '';
  for (let i = 0; i < text.length; i++) {
    const ch = text[i];
    if (ch === '\n' || ch === '\r') {
      lines.push(code);
      code = '';
      if (ch === '\r' && text[i + 1] === '\n') i++;
      continue;
    }
    if (ch === '\\') {
      const next = text[i + 1];
      if (next === undefined || next === '\n' || next === '\r') return null;
      code += ch + next;
      i++;
      continue;
    }
    if (ch === "'") {
      if (text[i - 1] === '$') return null;
      const end = text.indexOf("'", i + 1);
      if (end === -1) return null;
      const body = text.slice(i, end + 1);
      if (body.includes('\n') || body.includes('\r')) return null;
      code += body;
      i = end;
      continue;
    }
    if (ch === '"') {
      const end = shDoubleQuoteEnd(text, i);
      if (end === -1) return null;
      code += text.slice(i, end + 1);
      i = end;
      continue;
    }
    if (ch === '#') {
      const starts = hashStartsComment(text, i);
      if (starts === null) return null;
      if (starts) {
        const start = i + 1;
        while (i + 1 < text.length && text[i + 1] !== '\n' && text[i + 1] !== '\r') i++;
        code += directiveMarker(text.slice(start, i + 1), SHELL_SPEC);
        continue;
      }
    }
    code += ch;
  }
  lines.push(code);
  return lines;
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

function psCodeLines(text) {
  if (text.includes('@"') || text.includes("@'") || PS_SMART_QUOTES.test(text)) return null;
  const lines = [];
  let code = '';
  let block = false;
  let blockStart = 0;
  for (let i = 0; i < text.length; i++) {
    const ch = text[i];
    if (ch === '\n' || ch === '\r') {
      lines.push(code);
      code = '';
      if (ch === '\r' && text[i + 1] === '\n') i++;
      continue;
    }
    if (block) {
      if (ch === '<' && text[i + 1] === '#') return null;
      if (ch === '#' && text[i + 1] === '>') {
        block = false;
        code += directiveMarker(text.slice(blockStart, i), SHELL_SPEC) || ' ';
        i++;
      }
      continue;
    }
    if (ch === '`') {
      const next = text[i + 1];
      if (next === undefined || next === '\n' || next === '\r') return null;
      code += ch + next;
      i++;
      continue;
    }
    if (ch === "'" || ch === '"') {
      const end = psQuoteEnd(text, i);
      if (end === -1) return null;
      code += text.slice(i, end + 1);
      i = end;
      continue;
    }
    if (ch === '<' && text[i + 1] === '#') {
      if (!psHashStartsComment(text, i)) return null;
      block = true;
      blockStart = i + 2;
      i++;
      continue;
    }
    if (ch === '#') {
      if (!psHashStartsComment(text, i)) return null;
      const start = i + 1;
      while (i + 1 < text.length && text[i + 1] !== '\n' && text[i + 1] !== '\r') i++;
      code += directiveMarker(text.slice(start, i + 1), SHELL_SPEC);
      continue;
    }
    code += ch;
  }
  if (block) return null;
  lines.push(code);
  return lines;
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
