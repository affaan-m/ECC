'use strict';

/**
 * Shell-scanning primitives shared by hook-bypass matchers.
 *
 * These helpers locate Git executables and bound each candidate's flag scan
 * to its enclosing quote, heredoc body line, or command segment. They keep
 * every `git` token — quoted data may later be executed by a shell.
 */

/**
 * Git commands that support the --no-verify flag.
 */
const GIT_COMMANDS_WITH_NO_VERIFY = ['commit', 'push', 'merge', 'cherry-pick', 'rebase', 'am'];

/**
 * Characters that can appear immediately before 'git' in a command string.
 */
const VALID_BEFORE_GIT = ' \t\n\r;&|$`(<{!"\']/.~\\';

/**
 * Sticky heredoc opener. `lastIndex` must be set to the candidate `<<` before exec.
 */
const HEREDOC_START = /<<(-?)[ \t]*(?:'([^']+)'|"([^"]+)"|([^ \t\r\n;|&()<>]+))/y;

/**
 * Return the last index of an unquoted backslash-newline continuation at `i`,
 * or -1 when `input[i]` is not a line continuation.
 *
 * @param {string} input
 * @param {number} i
 * @returns {number}
 */
function lineContinuationEnd(input, i) {
  if (input.charAt(i) !== '\\') return -1;
  if (input.charAt(i + 1) === '\n') return i + 1;
  if (input.charAt(i + 1) === '\r' && input.charAt(i + 2) === '\n') return i + 2;
  return -1;
}

/**
 * Return true when `input[i]` starts an ANSI-C quoted word (`$'...'`).
 *
 * @param {string} input
 * @param {number} i
 * @returns {boolean}
 */
function isAnsiCQuoteStart(input, i) {
  return input.charAt(i) === '$' && input.charAt(i + 1) === "'";
}

/**
 * Tokenize a slice of `input` into shell words, respecting quotes, escapes,
 * ANSI-C quoting, and backslash-newline continuations.
 *
 * @param {string} input
 * @param {number} [start=0]
 * @param {number} [end=input.length]
 * @returns {{value: string, start: number, end: number}[]}
 */
function tokenizeShellWords(input, start = 0, end = input.length) {
  const tokens = [];
  let value = '';
  let tokenStart = null;
  let quote = null;
  let escaped = false;

  /** Mark the current word's raw start the first time a character is consumed. */
  function beginToken(index) {
    if (tokenStart === null) tokenStart = index;
  }

  /** Push the current word and reset the assembler. */
  function pushToken(index) {
    if (tokenStart === null) return;
    tokens.push({ value, start: tokenStart, end: index });
    value = '';
    tokenStart = null;
  }

  for (let i = start; i < end; i++) {
    const char = input.charAt(i);

    if (escaped) {
      beginToken(i - 1);
      value += char;
      escaped = false;
      continue;
    }

    if (quote) {
      if (char === quote) {
        quote = null;
        continue;
      }

      if (quote === '"' && char === '\\') {
        const continued = lineContinuationEnd(input, i);
        if (continued !== -1) {
          i = continued;
          continue;
        }

        beginToken(i);
        escaped = true;
        continue;
      }

      beginToken(i);
      value += char;
      continue;
    }

    if (isAnsiCQuoteStart(input, i)) {
      beginToken(i);
      continue;
    }

    if (char === '"' || char === "'") {
      beginToken(i);
      quote = char;
      continue;
    }

    if (char === '\\') {
      const continued = lineContinuationEnd(input, i);
      if (continued !== -1) {
        i = continued;
        continue;
      }

      beginToken(i);
      escaped = true;
      continue;
    }

    if (/\s/.test(char)) {
      pushToken(i);
      continue;
    }

    beginToken(i);
    value += char;
  }

  if (escaped) {
    value += '\\';
  }
  pushToken(end);

  return tokens;
}

/**
 * Find the end of a shell command segment without scanning beyond `limit`.
 * Unquoted or double-quoted backslash-newline pairs join the next physical line.
 *
 * @param {string} input
 * @param {number} start
 * @param {number} [limit=input.length]
 * @returns {number}
 */
function findCommandSegmentEnd(input, start, limit = input.length) {
  let quote = null;
  let escaped = false;

  for (let i = start; i < limit; i++) {
    const char = input.charAt(i);

    if (escaped) {
      escaped = false;
      continue;
    }

    if (quote) {
      if (quote === '"' && char === '\\') {
        const continued = lineContinuationEnd(input, i);
        if (continued !== -1) {
          i = continued;
          continue;
        }

        escaped = true;
        continue;
      }
      if (char === quote) {
        quote = null;
      }
      continue;
    }

    if (char === '"' || char === "'") {
      quote = char;
      continue;
    }

    if (char === '\\') {
      const continued = lineContinuationEnd(input, i);
      if (continued !== -1) {
        i = continued;
        continue;
      }

      escaped = true;
      continue;
    }

    if (char === ';' || char === '|' || char === '&' || char === '\n') {
      return i;
    }
  }

  return limit;
}

/**
 * Apply one character of the comment-mask state machine.
 * Newlines stay unmarked and reset the comment/escape flags, matching the
 * historical `buildCommentMask` bit pattern.
 *
 * @param {string} input
 * @param {Uint8Array} comments
 * @param {{afterCommentMarker: boolean, quote: string|null, escaped: boolean}} state
 * @param {number} i
 */
function applyCommentMaskChar(input, comments, state, i) {
  const char = input.charAt(i);
  if (char === '\n') {
    state.afterCommentMarker = false;
    state.escaped = false;
    return;
  }

  comments[i] = state.afterCommentMarker ? 1 : 0;
  if (state.afterCommentMarker) return;
  if (state.escaped) {
    state.escaped = false;
    return;
  }

  if (state.quote) {
    if (state.quote === '"' && char === '\\') state.escaped = true;
    else if (char === state.quote) state.quote = null;
    return;
  }

  if (char === '\\') {
    state.escaped = true;
    return;
  }
  if (char === '"' || char === "'") {
    state.quote = char;
    return;
  }
  if (char === '#' && (i === 0 || /[\s;&|()]/.test(input.charAt(i - 1)))) {
    const previous = i > 0 ? input.charAt(i - 1) : '';
    if (previous !== '$' && previous !== '\\') state.afterCommentMarker = true;
  }
}

/**
 * Exclusive end of a heredoc body line starting at `start`, joining further
 * physical lines only while an unquoted backslash-newline continuation remains.
 * A trailing CR is stripped like the original single-line bound.
 *
 * @param {string} input
 * @param {number} start
 * @returns {number}
 */
function heredocContinuedBound(input, start) {
  let quote = null;

  for (let i = start; i < input.length; i++) {
    const char = input.charAt(i);

    if (quote) {
      if (char === '\n') {
        return input.charAt(i - 1) === '\r' ? i - 1 : i;
      }
      if (quote === '"' && char === '\\') {
        i++;
      } else if (char === quote) {
        quote = null;
      }
      continue;
    }

    if (char === '"' || char === "'") {
      quote = char;
      continue;
    }

    if (char === '\\') {
      const continued = lineContinuationEnd(input, i);
      if (continued !== -1) {
        i = continued;
        continue;
      }
      i++;
      continue;
    }

    if (char === '\n') {
      return input.charAt(i - 1) === '\r' ? i - 1 : i;
    }
  }

  return input.length;
}

/**
 * Compute the comment mask and the maximum scan endpoint for characters
 * inside outer quotes and heredoc body lines. One pass tracks quote, escape,
 * comment, and heredoc state so the mask and boundary array cannot drift.
 *
 * @param {string} input
 * @returns {{boundaries: Int32Array, comments: Uint8Array}}
 */
function buildScanBoundaries(input) {
  const comments = new Uint8Array(input.length);
  const boundaries = new Int32Array(input.length);
  boundaries.fill(-1);

  const commentState = { afterCommentMarker: false, quote: null, escaped: false };
  const pendingHeredocs = [];
  let quote = null;
  let quoteStart = -1;
  let escaped = false;
  let comment = false;

  /** Fill the comment mask for a closed index range, preserving visit order. */
  function fillCommentMask(from, lastInclusive) {
    const last = Math.min(lastInclusive, input.length - 1);
    for (let j = from; j <= last; j++) {
      applyCommentMaskChar(input, comments, commentState, j);
    }
  }

  for (let i = 0; i < input.length; i++) {
    if ((i === 0 || input.charAt(i - 1) === '\n') && pendingHeredocs.length > 0) {
      const lineEnd = input.indexOf('\n', i);
      const physicalEnd = lineEnd === -1 ? input.length : lineEnd;
      const contentEnd = input.charAt(physicalEnd - 1) === '\r' ? physicalEnd - 1 : physicalEnd;
      const heredoc = pendingHeredocs[0];
      const line = input.slice(i, contentEnd);
      const comparableLine = heredoc.stripTabs ? line.replace(/^\t+/, '') : line;

      fillCommentMask(i, physicalEnd === input.length ? input.length - 1 : physicalEnd);

      if (comparableLine === heredoc.delimiter) {
        pendingHeredocs.shift();
      } else {
        const bound = heredocContinuedBound(input, i);
        boundaries.fill(bound, i, bound);
      }

      i = physicalEnd === input.length ? input.length : physicalEnd;
      continue;
    }

    applyCommentMaskChar(input, comments, commentState, i);

    const char = input.charAt(i);

    if (comment) {
      if (char === '\n') {
        comment = false;
      }
      continue;
    }

    if (escaped) {
      escaped = false;
      continue;
    }

    if (quote) {
      if (quote === '"' && char === '\\') {
        escaped = true;
        continue;
      }
      if (char === quote) {
        boundaries.fill(i, quoteStart + 1, i);
        quote = null;
        quoteStart = -1;
      }
      continue;
    }

    if (char === '\\') {
      escaped = true;
      continue;
    }

    if (char === '"' || char === "'") {
      quote = char;
      quoteStart = i;
      continue;
    }

    if (char === '#' && (i === 0 || /[\s;&|()]/.test(input.charAt(i - 1)))) {
      comment = true;
      continue;
    }

    if (char === '<' && input.charAt(i + 1) === '<' && input.charAt(i + 2) !== '<') {
      HEREDOC_START.lastIndex = i;
      const heredocMatch = HEREDOC_START.exec(input);
      if (heredocMatch) {
        pendingHeredocs.push({
          delimiter: heredocMatch[2] || heredocMatch[3] || heredocMatch[4],
          stripTabs: heredocMatch[1] === '-'
        });
        i += heredocMatch[0].length - 1;
      }
    }
  }

  if (quote) {
    boundaries.fill(input.length, quoteStart + 1);
  }

  return { boundaries, comments };
}

/**
 * Return the enclosing quote or heredoc-line endpoint for a candidate.
 *
 * @param {Int32Array} boundaries
 * @param {number} idx
 * @param {number} fallback
 * @returns {number}
 */
function getScanBoundary(boundaries, idx, fallback) {
  const boundary = boundaries[idx];
  return boundary >= 0 ? boundary : fallback;
}

/**
 * Parse the first non-global-option word after a `git` executable token.
 * Git chooses that word as its subcommand, so later words cannot change it.
 *
 * @param {string} input
 * @param {number} start
 * @param {number} end
 * @returns {{terminal: boolean, command: string|null, start: number}|null}
 */
function findGitSubcommand(input, start, end) {
  let value = '';
  let tokenStart = -1;
  let quote = null;
  let escaped = false;
  let expectOptionValue = false;

  /** Classify a completed word, returning a protected Git subcommand if found. */
  function classifyWord() {
    if (tokenStart === -1) return null;

    const completed = { value, start: tokenStart };
    value = '';
    tokenStart = -1;

    if (expectOptionValue) {
      expectOptionValue = false;
      return null;
    }

    if (completed.value.startsWith('-')) {
      if (
        completed.value === '-c' ||
        completed.value === '-C' ||
        completed.value === '--work-tree' ||
        completed.value === '--git-dir' ||
        completed.value === '--namespace' ||
        completed.value === '--super-prefix'
      ) {
        expectOptionValue = true;
      }
      return null;
    }

    return {
      terminal: true,
      command: GIT_COMMANDS_WITH_NO_VERIFY.includes(completed.value) ? completed.value : null,
      start: completed.start
    };
  }

  for (let i = start; i < end; i++) {
    const char = input.charAt(i);

    if (escaped) {
      if (tokenStart === -1) {
        tokenStart = i - 1;
      }
      value += char;
      escaped = false;
      continue;
    }

    if (quote) {
      if (char === quote) {
        quote = null;
      } else if (quote === '"' && char === '\\') {
        const continued = lineContinuationEnd(input, i);
        if (continued !== -1) {
          i = continued;
          continue;
        }
        escaped = true;
      } else {
        if (tokenStart === -1) {
          tokenStart = i;
        }
        value += char;
      }
      continue;
    }

    if (isAnsiCQuoteStart(input, i)) {
      if (tokenStart === -1) {
        tokenStart = i;
      }
      continue;
    }

    if (char === '"' || char === "'") {
      if (tokenStart === -1) {
        tokenStart = i;
      }
      quote = char;
      continue;
    }

    if (char === '\\') {
      const continued = lineContinuationEnd(input, i);
      if (continued !== -1) {
        i = continued;
        continue;
      }

      if (tokenStart === -1) {
        tokenStart = i;
      }
      escaped = true;
      continue;
    }

    if (/\s/.test(char) || char === ';' || char === '|' || char === '&') {
      const completed = classifyWord();
      if (completed?.terminal) {
        return completed;
      }
      if (char === ';' || char === '|' || char === '&' || char === '\n') {
        return null;
      }
      continue;
    }

    if (tokenStart === -1) {
      tokenStart = i;
    }
    value += char;
  }

  return classifyWord();
}

/**
 * Find the next contiguous raw `git` token starting from a position.
 *
 * @param {string} input
 * @param {number} start
 * @returns {{idx: number, len: number, end: number}|null}
 */
function findRawGit(input, start) {
  let pos = start;
  while (pos < input.length) {
    const idx = input.indexOf('git', pos);
    if (idx === -1) {
      return null;
    }

    const isExe = input.slice(idx + 3, idx + 7).toLowerCase() === '.exe';
    const len = isExe ? 7 : 3;
    const after = input[idx + len] || ' ';
    if (!/[\s"']/.test(after)) {
      pos = idx + 1;
      continue;
    }

    const before = idx > 0 ? input[idx - 1] : ' ';
    if (VALID_BEFORE_GIT.includes(before)) {
      return { idx, len, end: idx + len };
    }
    pos = idx + 1;
  }
  return null;
}

/**
 * Find a shell word assembled through quoting or escapes that evaluates to
 * `git` or `git.exe`. Only words before `end` need inspection because a raw
 * candidate at that position is already known to be earlier.
 *
 * @param {string} input
 * @param {number} start
 * @param {number} end
 * @returns {{idx: number, len: number, end: number}|null}
 */
function findAssembledGit(input, start, end) {
  let value = '';
  let tokenStart = -1;
  let quote = null;
  let escaped = false;

  /** Complete the current word and return it when it evaluates to Git. */
  function completeWord(wordEnd) {
    if (tokenStart === -1) return null;
    const normalized = value.toLowerCase();
    const candidate = normalized === 'git' || normalized === 'git.exe' ? { idx: tokenStart, len: wordEnd - tokenStart, end: wordEnd } : null;
    value = '';
    tokenStart = -1;
    return candidate;
  }

  for (let i = start; i < end; i++) {
    const char = input.charAt(i);

    if (escaped) {
      value += char;
      escaped = false;
      continue;
    }

    if (quote) {
      if (char === quote) {
        quote = null;
      } else if (quote === '"' && char === '\\') {
        const continued = lineContinuationEnd(input, i);
        if (continued !== -1) {
          i = continued;
          continue;
        }
        escaped = true;
      } else {
        value += char;
      }
      continue;
    }

    if (isAnsiCQuoteStart(input, i)) {
      if (tokenStart === -1) {
        tokenStart = i;
      }
      continue;
    }

    if (char === '"' || char === "'") {
      if (tokenStart === -1) {
        tokenStart = i;
      }
      quote = char;
      continue;
    }

    if (char === '\\') {
      const continued = lineContinuationEnd(input, i);
      if (continued !== -1) {
        i = continued;
        continue;
      }

      if (tokenStart === -1) {
        tokenStart = i;
      }
      escaped = true;
      continue;
    }

    if (/\s/.test(char) || char === ';' || char === '|' || char === '&') {
      const candidate = completeWord(i);
      if (candidate) {
        return candidate;
      }
      continue;
    }

    if (tokenStart === -1) {
      tokenStart = i;
    }
    value += char;
  }

  return completeWord(end);
}

/**
 * Find the next raw or shell-assembled Git executable token.
 *
 * @param {string} input
 * @param {number} start
 * @returns {{idx: number, len: number, end: number}|null}
 */
function findGit(input, start) {
  const rawCandidate = findRawGit(input, start);
  const assembledCandidate = findAssembledGit(input, start, rawCandidate ? rawCandidate.idx : input.length);
  return assembledCandidate || rawCandidate;
}

/**
 * Normalize the shell word containing `idx`, including adjacent quoted,
 * ANSI-C, and escaped fragments, and return its raw endpoint.
 *
 * @param {string} input
 * @param {number} idx
 * @returns {{value: string, end: number}}
 */
function assembleShellWordContaining(input, idx) {
  let wordStart = idx;
  while (wordStart > 0 && !/[\s;&|]/.test(input.charAt(wordStart - 1))) {
    wordStart--;
  }

  let value = '';
  let quote = null;
  let escaped = false;
  let wordEnd = input.length;

  for (let i = wordStart; i < input.length; i++) {
    const char = input.charAt(i);

    if (escaped) {
      value += char;
      escaped = false;
      continue;
    }

    if (quote) {
      if (char === quote) {
        quote = null;
      } else if (quote === '"' && char === '\\') {
        const continued = lineContinuationEnd(input, i);
        if (continued !== -1) {
          i = continued;
          continue;
        }
        escaped = true;
      } else {
        value += char;
      }
      continue;
    }

    if (isAnsiCQuoteStart(input, i)) {
      continue;
    }

    if (char === '"' || char === "'") {
      quote = char;
      continue;
    }

    if (char === '\\') {
      const continued = lineContinuationEnd(input, i);
      if (continued !== -1) {
        i = continued;
        continue;
      }
      escaped = true;
      continue;
    }

    if (/\s/.test(char) || char === ';' || char === '|' || char === '&') {
      wordEnd = i;
      break;
    }

    value += char;
  }

  return { value: value.toLowerCase(), end: wordEnd };
}

module.exports = {
  GIT_COMMANDS_WITH_NO_VERIFY,
  tokenizeShellWords,
  findCommandSegmentEnd,
  buildScanBoundaries,
  getScanBoundary,
  findGitSubcommand,
  findRawGit,
  findAssembledGit,
  findGit,
  assembleShellWordContaining
};
