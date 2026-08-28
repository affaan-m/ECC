'use strict';

const { extractCommandSubstitutions } = require('../lib/shell-substitution');

/**
 * Recognize the deliberately narrow passive sink supported by this parser.
 * Shell operators and substitutions make the payload's destination ambiguous,
 * so every other form retains the original input for fail-closed checks.
 *
 * @param {string} line
 * @returns {boolean}
 */
function isProvenPassiveHeredocLine(line) {
  const trimmed = line.trim();
  return /^cat(?=\s|[<>])/.test(trimmed) && !/[;&|()`]/.test(trimmed);
}

/**
 * Parse a heredoc delimiter after a verified `<<` operator.
 *
 * @param {string} line
 * @param {number} operatorIndex
 * @returns {{ heredoc: { delimiter: string, quoted: boolean, stripTabs: boolean }, endIndex: number } | null}
 */
function parseHeredocDelimiter(line, operatorIndex) {
  let endIndex = operatorIndex + 2;
  const stripTabs = line[endIndex] === '-';
  if (stripTabs) endIndex += 1;
  while (endIndex < line.length && /[ \t]/.test(line[endIndex])) endIndex += 1;

  let delimiter = '';
  let quoted = false;
  const delimiterQuote = line[endIndex] === '"' || line[endIndex] === "'" ? line[endIndex] : null;
  if (delimiterQuote) {
    quoted = true;
    const closingQuote = line.indexOf(delimiterQuote, endIndex + 1);
    if (closingQuote < 0) return null;
    delimiter = line.slice(endIndex + 1, closingQuote);
    endIndex = closingQuote;
  } else {
    const match = line.slice(endIndex).match(/^[A-Za-z_][A-Za-z0-9_]*/);
    if (!match) return null;
    delimiter = match[0];
    endIndex += delimiter.length - 1;
  }

  if (!/^[A-Za-z_][A-Za-z0-9_]*$/.test(delimiter)) return null;
  const next = line[endIndex + 1];
  if (next && !/[\s;&|<>()]/.test(next)) return null;
  return { heredoc: { delimiter, quoted, stripTabs }, endIndex };
}

/**
 * Iterate over simple heredoc redirections on one complete shell command line.
 * A null item marks ambiguous syntax so the caller can fail closed.
 *
 * @param {string} line
 * @returns {Generator<{ delimiter: string, quoted: boolean, stripTabs: boolean } | null>}
 */
function* iterateHeredocs(line) {
  let quote = null;
  let escaped = false;
  for (let i = 0; i < line.length; i += 1) {
    const ch = line[i];
    if (quote === "'") {
      if (ch === "'") quote = null;
      continue;
    }
    if (escaped) {
      escaped = false;
      continue;
    }
    if (ch === '\\') {
      escaped = true;
      continue;
    }
    if (quote === '"') {
      if (ch === quote) quote = null;
      continue;
    }
    if (ch === '"' || ch === "'") {
      quote = ch;
      continue;
    }
    if ((ch === '$' && line[i + 1] === '(' && line[i + 2] === '(') || (ch === '(' && line[i + 1] === '(')) {
      yield null;
      return;
    }
    if (ch === '$' && line[i + 1] === '[') {
      yield null;
      return;
    }
    if (ch === '#' && (i === 0 || /[\s;&|()]/.test(line[i - 1]))) break;
    if (ch !== '<' || line[i + 1] !== '<') continue;
    if (line[i + 2] === '<') {
      yield null;
      return;
    }
    const prefix = line.slice(0, i);
    if (prefix.includes('((') || prefix.includes('[[')) {
      yield null;
      return;
    }
    const parsed = parseHeredocDelimiter(line, i);
    if (!parsed) {
      yield null;
      return;
    }
    yield parsed.heredoc;
    i = parsed.endIndex;
  }
  if (quote || escaped) yield null;
}

/**
 * Find simple heredoc redirections on one complete shell command line.
 * Anything ambiguous returns null so the caller can fail closed.
 *
 * @param {string} line
 * @returns {{ delimiter: string, quoted: boolean, stripTabs: boolean }[] | null}
 */
function findHeredocs(line) {
  const heredocs = [...iterateHeredocs(line)];
  return heredocs.includes(null) ? null : heredocs;
}

/**
 * Iterate over executable substitutions in an unquoted heredoc.
 *
 * @param {string} text
 * @returns {Generator<string>}
 */
function* iterateHeredocCommandSubstitutions(text) {
  let escaped = false;
  for (let i = 0; i < text.length; i += 1) {
    const ch = text[i];
    if (escaped) {
      escaped = false;
      continue;
    }
    if (ch === '\\') {
      escaped = true;
      continue;
    }
    if (ch === '`' || (ch === '$' && text[i + 1] === '(')) {
      yield* extractCommandSubstitutions(text.slice(i));
    }
  }
}

/**
 * Extract executable substitutions from an unquoted heredoc. Quote characters
 * in its payload are literal and do not suppress expansion.
 *
 * @param {string[]} body
 * @returns {string[]}
 */
function extractHeredocCommandSubstitutions(body) {
  const text = body.join('\n');
  return [...new Set(iterateHeredocCommandSubstitutions(text))];
}

/**
 * Remove heredoc payload text before classifying the surrounding shell
 * command. Prose in a heredoc is data, so matching it as a command produces
 * false positives. Unquoted heredocs can still execute `$()` and backtick
 * substitutions; retain only those substitution bodies for classification and
 * drop the remaining payload text. Quoted heredoc payloads are fully inert.
 * Ambiguous shell syntax returns the original input unchanged (fail closed).
 *
 * @param {string} input
 * @returns {string}
 */
function stripHeredocBodies(input) {
  const raw = String(input || '');
  const lines = raw.split(/\r?\n/);
  let pending = [];
  let pendingIndex = 0;
  let bodyStartIndex = -1;
  let headerIndex = -1;
  let trailingStartIndex = lines.length;
  let substitutionText = '';
  let substitutionCount = 0;
  let completedHeredoc = false;
  for (let lineIndex = 0; lineIndex < lines.length; lineIndex += 1) {
    const line = lines[lineIndex];
    if (pendingIndex < pending.length) {
      const current = pending[pendingIndex];
      if (!current.quoted && /\\$/.test(line)) return raw;
      const delimiterLine = current.stripTabs ? line.replace(/^\t+/, '') : line;
      if (delimiterLine === current.delimiter) {
        if (!current.quoted) {
          for (const substitution of extractHeredocCommandSubstitutions(lines.slice(bodyStartIndex, lineIndex))) {
            substitutionText = substitutionCount === 0 ? substitution : `${substitutionText}\n${substitution}`;
            substitutionCount += 1;
          }
        }
        pendingIndex += 1;
        bodyStartIndex = lineIndex + 1;
        if (pendingIndex === pending.length) {
          completedHeredoc = true;
          trailingStartIndex = lineIndex + 1;
        }
      }
      continue;
    }
    if (completedHeredoc && line.trim()) return raw;
    if (completedHeredoc) continue;
    const heredocs = findHeredocs(line);
    if (heredocs === null) return raw;
    if (heredocs.length > 0 && !isProvenPassiveHeredocLine(line)) return raw;
    if (heredocs.length > 0) {
      pending = heredocs;
      pendingIndex = 0;
      bodyStartIndex = lineIndex + 1;
      headerIndex = lineIndex;
    }
  }
  if (pendingIndex < pending.length) return raw;
  if (headerIndex < 0) return lines.join('\n');

  const prefix = lines.slice(0, headerIndex + 1).join('\n');
  const trailingCount = lines.length - trailingStartIndex;
  const trailing = lines.slice(trailingStartIndex).join('\n');
  let result = prefix;
  let resultCount = headerIndex + 1;
  if (substitutionCount > 0) {
    result = resultCount === 0 ? substitutionText : `${result}\n${substitutionText}`;
    resultCount += substitutionCount;
  }
  if (trailingCount > 0) result = resultCount === 0 ? trailing : `${result}\n${trailing}`;
  return result;
}

module.exports = { stripHeredocBodies };
