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
 * Find simple heredoc redirections on one complete shell command line.
 * Anything ambiguous returns null so the caller can fail closed.
 *
 * @param {string} line
 * @returns {{ delimiter: string, quoted: boolean, stripTabs: boolean }[] | null}
 */
function findHeredocs(line) {
  const heredocs = [];
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
    if ((ch === '$' && line[i + 1] === '(' && line[i + 2] === '(') || (ch === '(' && line[i + 1] === '(')) return null;
    if (ch === '$' && line[i + 1] === '[') return null;
    if (ch === '#' && (i === 0 || /[\s;&|()]/.test(line[i - 1]))) break;
    if (ch !== '<' || line[i + 1] !== '<') continue;
    if (line[i + 2] === '<') return null;
    const prefix = line.slice(0, i);
    if (prefix.includes('((') || prefix.includes('[[')) return null;
    const parsed = parseHeredocDelimiter(line, i);
    if (!parsed) return null;
    heredocs.push(parsed.heredoc);
    i = parsed.endIndex;
  }
  return quote || escaped ? null : heredocs;
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
  const substitutions = new Set();
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
      for (const substitution of extractCommandSubstitutions(text.slice(i))) {
        substitutions.add(substitution);
      }
    }
  }
  return [...substitutions];
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
  const kept = [];
  const pending = [];
  let completedHeredoc = false;
  for (const line of raw.split(/\r?\n/)) {
    if (pending.length > 0) {
      const current = pending[0];
      if (!current.quoted && /\\$/.test(line)) return raw;
      const delimiterLine = current.stripTabs ? line.replace(/^\t+/, '') : line;
      if (delimiterLine === current.delimiter) {
        if (!current.quoted) kept.push(...extractHeredocCommandSubstitutions(current.body));
        pending.shift();
        if (pending.length === 0) completedHeredoc = true;
      } else {
        current.body.push(line);
      }
      continue;
    }
    if (completedHeredoc && line.trim()) return raw;
    kept.push(line);
    const heredocs = findHeredocs(line);
    if (heredocs === null) return raw;
    if (heredocs.length > 0 && !isProvenPassiveHeredocLine(line)) return raw;
    pending.push(...heredocs.map(heredoc => ({ ...heredoc, body: [] })));
  }
  if (pending.length > 0) return raw;
  return kept.join('\n');
}

module.exports = { stripHeredocBodies };
