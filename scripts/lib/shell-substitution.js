'use strict';

/** @returns {{ body: string, endIndex: number }} */
function readBacktickSubstitution(source, startIndex) {
  let body = '';
  let endIndex = startIndex + 1;
  while (endIndex < source.length) {
    const inner = source[endIndex];
    if (inner === '\\') {
      const escaped = source[endIndex + 1];
      body = escaped === undefined ? `${body}\\` : `${body}\\${escaped}`;
      endIndex += escaped === undefined ? 1 : 2;
      continue;
    }
    if (inner === '`') break;
    body = `${body}${inner}`;
    endIndex += 1;
  }
  return { body, endIndex };
}

/** @returns {{ body: string, endIndex: number }} */
function readDollarSubstitution(source, startIndex) {
  let body = '';
  let depth = 1;
  let inSingle = false;
  let inDouble = false;
  let endIndex = startIndex + 2;
  while (endIndex < source.length && depth > 0) {
    const inner = source[endIndex];
    if (inner === '\\' && !inSingle) {
      const escaped = source[endIndex + 1];
      body = escaped === undefined ? `${body}\\` : `${body}\\${escaped}`;
      endIndex += escaped === undefined ? 1 : 2;
      continue;
    }
    if (inner === "'" && !inDouble) inSingle = !inSingle;
    else if (inner === '"' && !inSingle) inDouble = !inDouble;
    else if (!inSingle && !inDouble && inner === '(') depth += 1;
    else if (!inSingle && !inDouble && inner === ')') depth -= 1;
    if (depth > 0) body = `${body}${inner}`;
    endIndex += depth > 0 ? 1 : 0;
  }
  return { body, endIndex };
}

/**
 * Iterate over command-substitution bodies, followed by nested bodies.
 * Quote characters in an unquoted heredoc are literal only at the outer level;
 * substitutions still use normal shell quote semantics internally.
 *
 * @param {string} input
 * @param {{ literalOuterQuotes?: boolean }} [options]
 * @returns {Generator<string>}
 */
function* iterateCommandSubstitutions(input, options = {}) {
  const source = String(input || '');
  const literalOuterQuotes = options.literalOuterQuotes === true;
  let inSingle = false;
  let inDouble = false;
  for (let i = 0; i < source.length; i += 1) {
    const ch = source[i];
    if (ch === '\\' && !inSingle) {
      i += 1;
      continue;
    }
    if (!literalOuterQuotes && ch === "'" && !inDouble) {
      inSingle = !inSingle;
      continue;
    }
    if (!literalOuterQuotes && ch === '"' && !inSingle) {
      inDouble = !inDouble;
      continue;
    }
    if (inSingle) continue;
    const span = ch === '`' ? readBacktickSubstitution(source, i) : null;
    const substitution = ch === '$' && source[i + 1] === '(' ? readDollarSubstitution(source, i) : span;
    if (!substitution) continue;
    i = substitution.endIndex;
    if (!substitution.body.trim()) continue;
    yield substitution.body;
    yield* iterateCommandSubstitutions(substitution.body);
  }
}

/**
 * Extract executable command-substitution bodies from a shell line.
 *
 * @param {string} input
 * @param {{ literalOuterQuotes?: boolean }} [options]
 * @returns {string[]}
 */
function extractCommandSubstitutions(input, options = {}) {
  return [...iterateCommandSubstitutions(input, options)];
}

// --- Shared span readers ------------------------------------------------------
// The group extractors below all need the same quote-aware skipping of
// `$(...)`, backtick and `(...)` spans. Each reader takes the index of the
// first character inside the span and returns where scanning should resume.

function parenDelta(ch) {
  if (ch === '(') return 1;
  if (ch === ')') return -1;
  return 0;
}

// `$'...'` (ANSI-C quoting) opens only on an unescaped `$`: an odd run of
// backslashes before it makes the `$` literal and the quote a plain one.
function opensAnsiC(source, i) {
  if (source[i - 1] !== '$') return false;
  let backslashes = 0;
  while (source[i - 2 - backslashes] === '\\') backslashes += 1;
  return backslashes % 2 === 0;
}

// Backslash escapes apply outside single quotes and inside `$'...'`.
function escapesActive(quotes) {
  return !quotes.inSingle || quotes.ansiC;
}

/**
 * Quote state after the quote character at `source[i]`, as a new object, or
 * null when it neither opens nor closes a quote. Callers consume escapes
 * first, so a quote after a backslash here still closes (`'C:\'`, `"C:\\"`),
 * while `\'` inside `$'...'` is consumed before it can close the string.
 */
function toggleQuote(source, i, quotes) {
  const ch = source[i];
  if (ch === "'" && !quotes.inDouble) {
    const inSingle = !quotes.inSingle;
    return { ...quotes, inSingle, ansiC: inSingle && opensAnsiC(source, i) };
  }
  if (ch === '"' && !quotes.inSingle) {
    return { ...quotes, inDouble: !quotes.inDouble };
  }
  return null;
}

/**
 * Index just past the `)` that closes a paren span whose first inner character
 * is at `start`, honoring quotes and escapes inside the span.
 */
function findParenSpanEnd(source, start) {
  let quotes = { inSingle: false, inDouble: false, ansiC: false };
  let depth = 1;
  let i = start;
  while (i < source.length && depth > 0) {
    const inner = source[i];
    if (inner === '\\' && escapesActive(quotes)) {
      i += 2;
      continue;
    }
    const toggled = toggleQuote(source, i, quotes);
    if (toggled) {
      quotes = toggled;
    } else if (!quotes.inSingle && !quotes.inDouble) {
      depth += parenDelta(inner);
    }
    i += 1;
  }
  return i;
}

/**
 * Index of the backtick that closes a span whose first inner character is at
 * `start`, or `source.length` when the span is unterminated.
 */
function findBacktickEnd(source, start) {
  let i = start;
  while (i < source.length && source[i] !== '`') {
    if (source[i] === '\\' && i + 1 < source.length) {
      i += 2;
      continue;
    }
    i += 1;
  }
  return i;
}

/**
 * Top-level scan step shared by the group extractors: escapes, quote state,
 * `$(...)` and backtick spans. Returns the quote state after `source[i]` and
 * `skipped`, the last index consumed so a `for` loop's `i++` resumes after it,
 * or -1 when the caller must inspect `source[i]`.
 */
function skipOuterSpan(source, i, quotes) {
  const ch = source[i];
  if (ch === '\\' && escapesActive(quotes)) return { skipped: i + 1, quotes };
  const toggled = toggleQuote(source, i, quotes);
  if (toggled) return { skipped: i, quotes: toggled };
  if (quotes.inSingle || quotes.inDouble) return { skipped: i, quotes };
  if (ch === '$' && source[i + 1] === '(') return { skipped: findParenSpanEnd(source, i + 2) - 1, quotes };
  if (ch === '`') return { skipped: findBacktickEnd(source, i + 1), quotes };
  return { skipped: -1, quotes };
}

/**
 * Read a `(...)` subshell body starting just inside the opening paren. Returns
 * the body text and the index of the closing paren (or where input ran out).
 */
function readSubshellBody(source, start) {
  let quotes = { inSingle: false, inDouble: false, ansiC: false };
  let depth = 1;
  let body = '';
  let i = start;
  while (i < source.length && depth > 0) {
    const inner = source[i];
    if (inner === '\\' && escapesActive(quotes)) {
      // Keep the escape and its operand together; a trailing backslash at the
      // end of an unterminated span is appended once and the scan stops.
      body += source.slice(i, i + 2);
      i = Math.min(i + 2, source.length);
      continue;
    }
    const toggled = toggleQuote(source, i, quotes);
    if (toggled) {
      quotes = toggled;
    } else if (!quotes.inSingle && !quotes.inDouble) {
      depth += parenDelta(inner);
      if (depth === 0) break;
    }
    body += inner;
    i += 1;
  }
  return { body, end: i };
}

/**
 * Extract bodies of plain `(...)` subshell groups.
 *
 * Bash treats `(npm run dev)` as a subshell that executes its contents, but
 * the regex-light segment splitters used by our PreToolUse hooks don't peer
 * inside those parens. This helper finds top-level `(...)` groups (skipping
 * `$(...)` command substitutions and backticks, which `extractCommandSubstitutions`
 * already covers) and returns each body, recursing for nested groups.
 *
 * Quote semantics:
 * - Single quotes are literal: `'( ... )'` is a string, not a subshell.
 * - Double quotes are literal *for parens*: `"( ... )"` is a string too —
 *   bash only honors `$( )` inside double quotes, not bare `( )`.
 *
 * @param {string} input
 * @returns {string[]}
 */
function extractSubshellGroups(input) {
  const source = String(input || '');
  const groups = [];
  let quotes = { inSingle: false, inDouble: false, ansiC: false };

  for (let i = 0; i < source.length; i++) {
    const step = skipOuterSpan(source, i, quotes);
    quotes = step.quotes;
    if (step.skipped !== -1) {
      i = step.skipped;
      continue;
    }
    if (source[i] !== '(') continue;
    const { body, end } = readSubshellBody(source, i + 1);
    i = end;
    if (body.trim()) {
      groups.push(body);
      groups.push(...extractSubshellGroups(body));
    }
  }

  return groups;
}

/**
 * Inside a brace body, `$(...)`, backtick and `(...)` spans are copied through
 * verbatim so a `}` inside them cannot close the group. Returns the index just
 * past the span, or -1 when `source[i]` does not open one.
 */
function findNestedSpanEnd(source, i) {
  const ch = source[i];
  if (ch === '$' && source[i + 1] === '(') return findParenSpanEnd(source, i + 2);
  if (ch === '`') return Math.min(findBacktickEnd(source, i + 1) + 1, source.length);
  if (ch === '(') return findParenSpanEnd(source, i + 1);
  return -1;
}

// `{` is a reserved word only when followed by whitespace and preceded by the
// line start, whitespace, or a shell operator (`;`, `|`, `&`, `(`).
function opensBraceGroup(source, i) {
  if (source[i] !== '{' || !/\s/.test(source[i + 1] || '')) return false;
  return i === 0 || /[\s;|&(]/.test(source[i - 1]);
}

/**
 * Read a `{ ...; }` brace body starting just after the opening brace. Returns
 * the body text and the index of the closing brace (or where input ran out).
 */
function readBraceBody(source, start) {
  let quotes = { inSingle: false, inDouble: false, ansiC: false };
  let depth = 1;
  let body = '';
  let i = start;
  while (i < source.length && depth > 0) {
    const inner = source[i];
    const prev = source[i - 1];
    if (inner === '\\' && escapesActive(quotes)) {
      body += source.slice(i, i + 2);
      i = Math.min(i + 2, source.length);
      continue;
    }
    const toggled = toggleQuote(source, i, quotes);
    if (toggled) quotes = toggled;
    if (toggled || quotes.inSingle || quotes.inDouble) {
      body += inner;
      i += 1;
      continue;
    }
    const spanEnd = findNestedSpanEnd(source, i);
    if (spanEnd !== -1) {
      body += source.slice(i, spanEnd);
      i = spanEnd;
      continue;
    }
    if (inner === '{' && /\s/.test(source[i + 1] || '')) {
      // Match the outer-scan boundary rule for nested `{` so tokens like
      // `foo{` (no boundary, but followed by space via `foo{ bar`) cannot
      // bump nested depth.
      if (/[\s;|&(]/.test(prev)) depth += 1;
    } else if (inner === '}' && (prev === ';' || /\s/.test(prev))) {
      depth -= 1;
      if (depth === 0) break;
    }
    body += inner;
    i += 1;
  }
  return { body, end: i };
}

/**
 * Extract bodies of `{ ...; }` brace groups.
 *
 * Bash brace groups run their body in the *current* shell (unlike `(...)`,
 * which forks a subshell). Both forms group multiple commands, so for the
 * purposes of destructive-bash and dev-server detection they are equivalent:
 * a `rm -rf` or `npm run dev` inside `{ ...; }` still executes.
 *
 * Recognition rules match bash's own reserved-word semantics:
 * - `{` is a reserved word only when followed by whitespace and preceded by
 *   the line start, whitespace, or a shell operator (`;`, `|`, `&`, `(`).
 *   So `{npm run dev}` is NOT a brace group (single token starting with `{`).
 * - `}` closes the group only when preceded by `;` or whitespace.
 *   So `foo}` inside the body is not a closing brace.
 * - Single quotes are literal; double quotes are also literal for `{`/`}`.
 * - `$(...)`, backticks, and plain `(...)` spans are skipped so we don't
 *   double-extract bodies the sibling extractors already cover.
 *
 * @param {string} input
 * @returns {string[]}
 */
function extractBraceGroups(input) {
  const source = String(input || '');
  const groups = [];
  let quotes = { inSingle: false, inDouble: false, ansiC: false };

  for (let i = 0; i < source.length; i++) {
    const step = skipOuterSpan(source, i, quotes);
    quotes = step.quotes;
    if (step.skipped !== -1) {
      i = step.skipped;
      continue;
    }
    if (source[i] === '(') {
      i = findParenSpanEnd(source, i + 1) - 1;
      continue;
    }
    if (!opensBraceGroup(source, i)) continue;
    const { body, end } = readBraceBody(source, i + 1);
    i = end;
    if (body.trim()) {
      groups.push(body);
      groups.push(...extractBraceGroups(body));
    }
  }

  return groups;
}

module.exports = { extractCommandSubstitutions, extractSubshellGroups, extractBraceGroups };
