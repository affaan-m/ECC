'use strict';

const { isSpace, isIdentChar, isLetter, rustCharEnd, isBlank, hashStartsComment, hasLoneCarriageReturn, PS_SMART_QUOTES, psHashStartsComment, isTrivialEdit } = require('./gateguard-code-lexer');

// --- File context ---
// see docs/gateguard/change-profile.md#file-context

const REPLACEMENT_PATTERN = /\$[$&'`<0-9]/;
const MAX_FILE_CHARS = 1024 * 1024;
const MAX_WINDOW_CHARS = 128 * 1024;
const MAX_CONTEXT_WORK = 8 * 1024 * 1024;
const JS_REGEX_KEYWORDS = new Set(['return', 'typeof', 'instanceof', 'in', 'of', 'new', 'delete', 'void', 'throw', 'case', 'do', 'else', 'yield', 'await']);
const JS_CONTROL_HEADERS = new Set(['if', 'while', 'for', 'with']);
const CPP_RAW_PREFIXES = new Set(['R', 'u8R', 'uR', 'UR', 'LR']);

function isNewline(ch) {
  return ch === '\n' || ch === '\r';
}

function lineEndAt(text, i) {
  let j = i;
  while (j < text.length && !isNewline(text[j])) j++;
  return j;
}

function quotedEnd(text, i, quote, multiline) {
  for (let j = i + 1; j < text.length; j++) {
    const ch = text[j];
    if (ch === '\\') {
      j++;
      if (text[j] === '\r' && text[j + 1] === '\n') j++;
    } else if (ch === quote) {
      return j + 1;
    } else if (isNewline(ch) && !multiline) {
      return -1;
    }
  }
  return -1;
}

function regexEnd(text, i) {
  let inClass = false;
  for (let j = i + 1; j < text.length; j++) {
    const ch = text[j];
    if (isNewline(ch)) return -1;
    if (ch === '\\') {
      if (j + 1 >= text.length || isNewline(text[j + 1])) return -1;
      j++;
    } else if (inClass) {
      if (ch === ']') inClass = false;
    } else if (ch === '[') {
      inClass = true;
    } else if (ch === '/') {
      let k = j + 1;
      while (isIdentChar(text[k])) k++;
      return k;
    }
  }
  return -1;
}

function nestedBlockEnd(text, i) {
  let depth = 0;
  for (let j = i; j + 1 < text.length; j++) {
    if (text[j] === '/' && text[j + 1] === '*') {
      depth++;
      j++;
    } else if (text[j] === '*' && text[j + 1] === '/') {
      depth--;
      j++;
      if (depth === 0) return j + 1;
    }
  }
  return -1;
}

function textBlockEnd(text, i, escapes) {
  for (let j = i + 3; j < text.length; j++) {
    if (escapes && text[j] === '\\') {
      j++;
    } else if (!escapes && text[j] === '$' && text[j + 1] === '{') {
      return -1;
    } else if (text.startsWith('"""', j)) {
      let end = j + 3;
      while (text[end] === '"') end++;
      return end;
    }
  }
  return -1;
}

function kotlinStringEnd(text, i) {
  for (let j = i + 1; j < text.length; j++) {
    const ch = text[j];
    if (ch === '\\') j++;
    else if (ch === '$' && text[j + 1] === '{') return -1;
    else if (ch === '"') return j + 1;
    else if (isNewline(ch)) return -1;
  }
  return -1;
}

function csharpStringEnd(text, i) {
  let j = i;
  let verbatim = false;
  let interpolated = false;
  while (text[j] === '@' || text[j] === '$') {
    if (text[j] === '@') verbatim = true;
    else interpolated = true;
    j++;
  }
  if (text.startsWith('"""', j)) return -1;
  for (let k = j + 1; k < text.length; k++) {
    const ch = text[k];
    if (ch === '"') {
      if (verbatim && text[k + 1] === '"') {
        k++;
        continue;
      }
      return k + 1;
    }
    if (!verbatim && ch === '\\') {
      k++;
    } else if (!verbatim && isNewline(ch)) {
      return -1;
    } else if (interpolated && ch === '{') {
      if (text[k + 1] === '{') {
        k++;
        continue;
      }
      let m = k + 1;
      while (m < text.length && text[m] !== '}') {
        if ('"\'{/\n\r'.includes(text[m])) return -1;
        m++;
      }
      if (m >= text.length) return -1;
      k = m;
    }
  }
  return -1;
}

function cppRawEnd(text, quote) {
  const open = text.indexOf('(', quote + 1);
  if (open === -1 || open - quote - 1 > 16) return -1;
  const delimiter = text.slice(quote + 1, open);
  for (const ch of delimiter) {
    if (isSpace(ch) || isNewline(ch) || '()\\"'.includes(ch)) return -1;
  }
  const end = text.indexOf(`)${delimiter}"`, open + 1);
  return end === -1 ? -1 : end + delimiter.length + 2;
}

function rustRawEnd(text, i) {
  let j = i + (text[i] === 'r' ? 1 : 2);
  let hashes = '';
  while (text[j] === '#') {
    hashes += '#';
    j++;
  }
  if (text[j] !== '"') return null;
  const end = text.indexOf(`"${hashes}`, j + 1);
  return end === -1 ? -1 : end + 1 + hashes.length;
}

function wordStart(text, i) {
  let start = i;
  while (start > 0 && isIdentChar(text[start - 1])) start--;
  return start;
}

function cFamilyStringEnd(text, i, spec) {
  const ch = text[i];
  const flavor = spec.flavor;
  if (ch === '`') {
    if (flavor === 'kotlin') return quotedEnd(text, i, '`', false);
    if (flavor !== 'go') return -1;
    const end = text.indexOf('`', i + 1);
    return end === -1 ? -1 : end + 1;
  }
  if (ch === "'") {
    if (flavor === 'rust') {
      const end = rustCharEnd(text, i);
      return end === -1 ? null : end + 1;
    }
    if (flavor === 'c' && isIdentChar(text[i - 1]) && isIdentChar(text[i + 1])) {
      const first = text[wordStart(text, i)];
      if (first >= '0' && first <= '9') return null;
    }
    return quotedEnd(text, i, "'", false);
  }
  if (flavor === 'c') {
    const start = wordStart(text, i);
    const prefix = text.slice(start, i);
    if (CPP_RAW_PREFIXES.has(prefix)) return cppRawEnd(text, i);
    if (prefix.endsWith('R')) return -1;
  }
  if (flavor === 'java' && text.startsWith('"""', i)) return textBlockEnd(text, i, true);
  if (flavor === 'kotlin') return text.startsWith('"""', i) ? textBlockEnd(text, i, false) : kotlinStringEnd(text, i);
  if (flavor === 'csharp' && text.startsWith('"""', i)) return -1;
  return quotedEnd(text, i, '"', flavor === 'rust');
}

function cFamilyStartsFresh(text, spec) {
  const js = spec.flavor === 'js';
  const frames = [{ template: false, depth: 0 }];
  const parens = [];
  let lastWord = '';
  let lastSig = 'op';
  let lineEnd = '';
  let continued = false;
  let i = js && text.startsWith('#!') ? lineEndAt(text, 0) : 0;
  while (i < text.length) {
    const frame = frames[frames.length - 1];
    const ch = text[i];
    const next = text[i + 1];
    if (frame.template) {
      if (ch === '\\') {
        i += 2;
      } else if (ch === '`') {
        frames.pop();
        lastSig = 'value';
        i++;
      } else if (ch === '$' && next === '{') {
        frames.push({ template: false, depth: 0 });
        lastSig = 'op';
        i += 2;
      } else {
        i++;
      }
      continue;
    }
    if (isNewline(ch)) {
      continued = lineEnd === '\\';
      lineEnd = '';
      i++;
      continue;
    }
    if (isSpace(ch)) {
      i++;
      continue;
    }
    if (ch === '/' && next === '/') {
      const end = lineEndAt(text, i);
      if (text.slice(i, end).trimEnd().endsWith('\\')) return false;
      i = end;
      continue;
    }
    if (ch === '/' && next === '*') {
      const end = spec.rustDocs ? nestedBlockEnd(text, i) : text.indexOf('*/', i + 2);
      if (end === -1) return false;
      i = spec.rustDocs ? end : end + 2;
      lineEnd = '';
      continue;
    }
    lineEnd = ch;
    if (js) {
      if (ch === '`') {
        frames.push({ template: true, depth: 0 });
        i++;
        continue;
      }
      if (ch === '/') {
        if (lastSig === 'op') {
          const end = regexEnd(text, i);
          if (end === -1) return false;
          lineEnd = text[end - 1];
          lastSig = 'value';
          i = end;
          continue;
        }
        if (lastSig === 'close' && /[/'"`]/.test(text.slice(i + 1, lineEndAt(text, i)))) return false;
        lastSig = 'op';
        i++;
        continue;
      }
      if (ch === '<' && (next === '!' || (spec.jsx && (isLetter(next) || next === '/' || next === '>')))) return false;
      if (ch === '-' && next === '-' && text[i + 2] === '>') return false;
      if (frames.length > 1 && ch === '{') frame.depth++;
      if (frames.length > 1 && ch === '}') {
        if (frame.depth === 0) {
          frames.pop();
          i++;
          continue;
        }
        frame.depth--;
      }
    }
    if (spec.flavor === 'csharp' && (ch === '@' || ch === '$') && /^[@$]{1,3}"/.test(text.slice(i, i + 4))) {
      const end = csharpStringEnd(text, i);
      if (end === -1) return false;
      lineEnd = '"';
      i = end;
      continue;
    }
    if (spec.flavor === 'rust' && (ch === 'r' || ((ch === 'b' || ch === 'c') && next === 'r')) && !isIdentChar(text[i - 1])) {
      const end = rustRawEnd(text, i);
      if (end === -1) return false;
      if (end !== null) {
        lineEnd = text[end - 1];
        lastSig = 'value';
        i = end;
        continue;
      }
    }
    if (ch === '"' || ch === "'" || ch === '`') {
      const end = cFamilyStringEnd(text, i, spec);
      if (end === -1) return false;
      if (end !== null) {
        lineEnd = text[end - 1];
        lastSig = 'value';
        i = end;
        continue;
      }
      i++;
      continue;
    }
    if (isIdentChar(ch)) {
      let end = i;
      while (end < text.length && isIdentChar(text[end])) end++;
      lastWord = text.slice(i, end);
      lastSig = js && JS_REGEX_KEYWORDS.has(lastWord) ? 'op' : 'value';
      lineEnd = text[end - 1];
      i = end;
      continue;
    }
    if (ch === '(') {
      parens.push(lastSig === 'value' && JS_CONTROL_HEADERS.has(lastWord));
      lastSig = 'op';
    } else if (ch === ')') {
      lastSig = parens.pop() ? 'op' : 'value';
    } else {
      lastSig = ch === '}' ? 'close' : ch === ']' ? 'value' : 'op';
    }
    lastWord = '';
    i++;
  }
  return frames.length === 1 && !continued;
}

function pythonStringEnd(text, i, prefix) {
  const quote = text[i];
  const triple = text[i + 1] === quote && text[i + 2] === quote;
  const fString = prefix.toLowerCase().includes('f');
  let depth = 0;
  for (let j = i + (triple ? 3 : 1); j < text.length; j++) {
    const ch = text[j];
    if (fString && depth > 0) {
      if (ch === '{') {
        depth++;
      } else if (ch === '}') {
        depth--;
      } else if ((ch === '"' || ch === "'") && ch !== quote) {
        let k = j + 1;
        while (k < text.length && text[k] !== ch) {
          if (text[k] === quote || text[k] === '\\' || isNewline(text[k])) return -1;
          k++;
        }
        if (k >= text.length) return -1;
        j = k;
      } else if (ch === quote || ch === '#' || ch === '\\' || isNewline(ch)) {
        return -1;
      }
      continue;
    }
    if (ch === '\\') {
      j++;
      if (text[j] === '\r' && text[j + 1] === '\n') j++;
    } else if (fString && ch === '{') {
      if (text[j + 1] === '{') j++;
      else depth = 1;
    } else if (isNewline(ch) && !triple) {
      return -1;
    } else if (ch === quote && (!triple || (text[j + 1] === quote && text[j + 2] === quote))) {
      return j + (triple ? 3 : 1);
    }
  }
  return -1;
}

function pythonStartsFresh(text) {
  let lineEnd = '';
  let continued = false;
  let i = 0;
  while (i < text.length) {
    const ch = text[i];
    if (isNewline(ch)) {
      continued = lineEnd === '\\';
      lineEnd = '';
      i++;
    } else if (isSpace(ch)) {
      i++;
    } else if (ch === '#') {
      i = lineEndAt(text, i);
    } else if (ch === '"' || ch === "'") {
      const start = wordStart(text, i);
      const prefix = text.slice(start, i);
      if (prefix.length > 2 || /[^rbuf]/i.test(prefix)) return false;
      const end = pythonStringEnd(text, i, prefix);
      if (end === -1) return false;
      lineEnd = ch;
      i = end;
    } else {
      lineEnd = ch;
      i++;
    }
  }
  return !continued;
}

function heredocDelimiter(text, i) {
  let j = i + 2;
  const stripTabs = text[j] === '-';
  if (stripTabs) j++;
  while (isBlank(text[j])) j++;
  let word = '';
  while (j < text.length && !isBlank(text[j]) && !isNewline(text[j]) && !';|&<>()'.includes(text[j])) {
    if (!'\'"\\'.includes(text[j])) word += text[j];
    j++;
  }
  return word ? { word, stripTabs, end: j } : null;
}

function skipHeredocs(text, i, pending) {
  let at = i;
  for (const doc of pending) {
    for (;;) {
      if (at >= text.length) return -1;
      const end = lineEndAt(text, at);
      let line = text.slice(at, end);
      if (doc.stripTabs) line = line.replace(/^\t+/, '');
      at = end + (text[end] === '\r' && text[end + 1] === '\n' ? 2 : 1);
      if (line === doc.word) break;
    }
  }
  return at;
}

const MAX_NESTING = 8;

function shSingleQuoteEnd(text, i) {
  if (text[i - 1] === '$') return quotedEnd(text, i, "'", true);
  return text.indexOf("'", i + 1) + 1 || -1;
}

function shSubstitutionEnd(text, i, level) {
  if (level > MAX_NESTING) return -1;
  let depth = 0;
  for (let j = i + 1; j < text.length; j++) {
    const ch = text[j];
    if (ch === '\\') {
      j++;
    } else if (ch === '(') {
      depth++;
    } else if (ch === ')') {
      depth--;
      if (depth === 0) return j + 1;
    } else if (ch === "'" || ch === '"') {
      const end = ch === "'" ? shSingleQuoteEnd(text, j) : shDoubleQuoteScan(text, j, level + 1);
      if (end === -1) return -1;
      j = end - 1;
    } else if (ch === '`' || (ch === '<' && text[j + 1] === '<') || (ch === '#' && hashStartsComment(text, j) !== false)) {
      return -1;
    } else if (ch === 'c' && text.startsWith('case', j) && !isIdentChar(text[j - 1]) && !isIdentChar(text[j + 4])) {
      return -1;
    }
  }
  return -1;
}

function shDoubleQuoteScan(text, i, level) {
  for (let j = i + 1; j < text.length; j++) {
    const ch = text[j];
    if (ch === '"') return j + 1;
    if (ch === '\\') {
      j++;
    } else if (ch === '`') {
      return -1;
    } else if (ch === '$' && text[j + 1] === '(') {
      const end = shSubstitutionEnd(text, j, level);
      if (end === -1) return -1;
      j = end - 1;
    } else if (ch === '$' && text[j + 1] === '{') {
      const close = text.indexOf('}', j + 2);
      if (close === -1 || /["'\n\r]/.test(text.slice(j + 2, close))) return -1;
      j = close;
    }
  }
  return -1;
}

function shStartsFresh(text) {
  if (hasLoneCarriageReturn(text)) return false;
  const pending = [];
  let lineEnd = '';
  let continued = false;
  let i = 0;
  while (i < text.length) {
    const ch = text[i];
    if (isNewline(ch)) {
      continued = lineEnd === '\\';
      lineEnd = '';
      i += ch === '\r' && text[i + 1] === '\n' ? 2 : 1;
      if (pending.length > 0) {
        i = skipHeredocs(text, i, pending);
        if (i === -1) return false;
        pending.length = 0;
      }
      continue;
    }
    if (isBlank(ch)) {
      i++;
      continue;
    }
    lineEnd = ch;
    if (ch === '\\') {
      i += isNewline(text[i + 1]) ? 1 : 2;
    } else if (ch === "'") {
      const end = shSingleQuoteEnd(text, i);
      if (end === -1) return false;
      i = end;
    } else if (ch === '"') {
      const end = shDoubleQuoteScan(text, i, 0);
      if (end === -1) return false;
      i = end;
    } else if (ch === '`') {
      const end = text.indexOf('`', i + 1);
      if (end === -1 || /['"\\#\n\r]/.test(text.slice(i + 1, end))) return false;
      i = end + 1;
    } else if (ch === '#') {
      const starts = hashStartsComment(text, i);
      if (starts === null) return false;
      i = starts ? lineEndAt(text, i) : i + 1;
      if (starts) lineEnd = '';
    } else if (ch === '<' && text[i + 1] === '<') {
      if (text[i + 2] === '<') {
        i += 3;
        continue;
      }
      const doc = heredocDelimiter(text, i);
      if (!doc) return false;
      pending.push(doc);
      i = doc.end;
    } else {
      i++;
    }
  }
  return !continued && pending.length === 0;
}

function psSingleQuoteEnd(text, i) {
  for (let j = i + 1; j < text.length; j++) {
    if (text[j] !== "'") continue;
    if (text[j + 1] !== "'") return j + 1;
    j++;
  }
  return -1;
}

function psSubexpressionEnd(text, i, level) {
  if (level > MAX_NESTING) return -1;
  let depth = 0;
  for (let j = i + 1; j < text.length; j++) {
    const ch = text[j];
    if (ch === '`') {
      j++;
    } else if (ch === '(') {
      depth++;
    } else if (ch === ')') {
      depth--;
      if (depth === 0) return j + 1;
    } else if (ch === "'" || ch === '"') {
      const end = ch === "'" ? psSingleQuoteEnd(text, j) : psDoubleQuoteScan(text, j, level + 1);
      if (end === -1) return -1;
      j = end - 1;
    } else if (ch === '#' || (ch === '@' && (text[j + 1] === '"' || text[j + 1] === "'"))) {
      return -1;
    }
  }
  return -1;
}

function psDoubleQuoteScan(text, i, level) {
  for (let j = i + 1; j < text.length; j++) {
    const ch = text[j];
    if (ch === '`') {
      j++;
    } else if (ch === '$' && text[j + 1] === '(') {
      const end = psSubexpressionEnd(text, j, level);
      if (end === -1) return -1;
      j = end - 1;
    } else if (ch === '"') {
      if (text[j + 1] !== '"') return j + 1;
      j++;
    }
  }
  return -1;
}

function psStartsFresh(text) {
  if (PS_SMART_QUOTES.test(text)) return false;
  let lineEnd = '';
  let continued = false;
  let i = 0;
  while (i < text.length) {
    const ch = text[i];
    const next = text[i + 1];
    if (isNewline(ch)) {
      continued = lineEnd === '`';
      lineEnd = '';
      i++;
      continue;
    }
    if (isBlank(ch)) {
      i++;
      continue;
    }
    lineEnd = ch;
    if (ch === '`') {
      i += isNewline(next) ? 1 : 2;
    } else if (ch === '@' && (next === '"' || next === "'")) {
      const open = lineEndAt(text, i);
      if (text.slice(i + 2, open).trim() !== '') return false;
      let at = open;
      let found = -1;
      while (at < text.length) {
        at += text[at] === '\r' && text[at + 1] === '\n' ? 2 : 1;
        if (text.startsWith(`${next}@`, at)) {
          found = at + 2;
          break;
        }
        at = lineEndAt(text, at);
      }
      if (found === -1) return false;
      i = found;
    } else if (ch === "'" || ch === '"') {
      const end = ch === "'" ? psSingleQuoteEnd(text, i) : psDoubleQuoteScan(text, i, 0);
      if (end === -1) return false;
      i = end;
    } else if (ch === '<' && next === '#') {
      if (!psHashStartsComment(text, i)) return false;
      const end = text.indexOf('#>', i + 2);
      if (end === -1) return false;
      i = end + 2;
      lineEnd = '';
    } else if (ch === '#') {
      if (psHashStartsComment(text, i)) {
        i = lineEndAt(text, i);
        lineEnd = '';
      } else if (isIdentChar(text[i - 1]) || '-.:'.includes(text[i - 1])) {
        i++;
      } else {
        return false;
      }
    } else {
      i++;
    }
  }
  return !continued;
}

function batchStartsFresh(text) {
  const lines = text.split(/\r\n|\r|\n/);
  const last = lines.length > 1 ? lines[lines.length - 2] : '';
  return !last.endsWith('^');
}

function lineStartOf(text, i) {
  let start = i;
  while (start > 0 && !isNewline(text[start - 1])) start--;
  return start;
}

function windowStart(text, at) {
  const start = lineStartOf(text, at);
  if (start === 0) return 0;
  let end = start - 1;
  if (text[end] === '\n' && text[end - 1] === '\r') end--;
  return lineStartOf(text, end);
}

function windowEnd(text, at) {
  const end = lineEndAt(text, at);
  if (end >= text.length) return text.length;
  return end + (text[end] === '\r' && text[end + 1] === '\n' ? 2 : 1);
}

function occurrences(text, needle, replaceAll) {
  const first = text.indexOf(needle);
  if (first === -1) return null;
  let last = first;
  for (let at = text.indexOf(needle, first + needle.length); at !== -1; at = text.indexOf(needle, at + needle.length)) {
    if (!replaceAll) return null;
    last = at;
  }
  return { first, last };
}

function trivialInFile(pairs, fileText, spec) {
  if (typeof fileText !== 'string' || fileText.length > MAX_FILE_CHARS || !spec.startsFresh) return false;
  if (spec.flavor === 'go' && fileText.includes('"C"')) return false;
  let text = fileText;
  let work = 0;
  for (const [oldString, newString, replaceAll] of pairs) {
    if (!oldString || REPLACEMENT_PATTERN.test(newString)) return false;
    const found = occurrences(text, oldString, replaceAll);
    if (!found) return false;
    const start = windowStart(text, found.first);
    const end = windowEnd(text, found.last + oldString.length);
    work += start + 2 * (end - start);
    if (end - start > MAX_WINDOW_CHARS || work > MAX_CONTEXT_WORK) return false;
    const before = text.slice(start, end);
    const after = replaceAll
      ? before.split(oldString).join(newString)
      : `${text.slice(start, found.first)}${newString}${text.slice(found.first + oldString.length, end)}`;
    // see docs/gateguard/change-profile.md#file-context
    if (!isTrivialEdit(before, after, spec) || !spec.startsFresh(text.slice(0, start), spec)) return false;
    text = `${text.slice(0, start)}${after}${text.slice(end)}`;
    if (text.length > MAX_FILE_CHARS) return false;
  }
  return true;
}


module.exports = {
  MAX_FILE_CHARS,
  lineEndAt,
  lineStartOf,
  cFamilyStartsFresh,
  pythonStartsFresh,
  shStartsFresh,
  psStartsFresh,
  batchStartsFresh,
  trivialInFile
};
