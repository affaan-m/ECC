'use strict';

/**
 * Quoted-region scanner for shell command lines.
 *
 * One forward pass records every quoted region: where it starts and ends, the
 * argv0 of the statement containing it (the first non-assignment, non-reserved
 * word before the quote; '' when the quote is part of that first word) and
 * whether the string carries a command substitution. A `$(` or backtick inside
 * "..." suspends the string: the substitution body is top-level shell again
 * (its own statements and quotes) until the matching `)` / backtick, after
 * which the string resumes as a new region. Both halves are flagged
 * `substitution`. Regions are appended only once complete, in order, so they
 * are disjoint and sorted. The result is cached per input, so a command line
 * holding thousands of quoted tokens is scanned once.
 */

// Words that open or structure a compound command; none of them receives the
// quoted string that follows, so none may become a statement's argv0.
const SHELL_RESERVED_WORDS = new Set([
  'if', 'then', 'else', 'elif', 'fi', 'do', 'done', 'while', 'until', 'for',
  'case', 'esac', 'in', 'select', 'function', 'coproc', '!', '{', '}', '[[', ']]',
]);

const ASSIGNMENT_WORD = /^[A-Za-z_][A-Za-z0-9_]*=/;

// Unquoted characters that start a new statement (or a nested command).
const STATEMENT_SEPARATORS = new Set([';', '|', '&', '\n', '(', ')', '`']);

let cache = { input: null, regions: [] };

function createState() {
  return {
    regions: [],
    suspended: [],
    quote: null,
    escaped: false,
    open: null,
    argv0: null,
    word: '',
    inWord: false,
  };
}

function endWord(state) {
  if (!state.inWord) return;
  if (
    state.argv0 === null &&
    state.word !== '' &&
    !SHELL_RESERVED_WORDS.has(state.word) &&
    !ASSIGNMENT_WORD.test(state.word)
  ) {
    state.argv0 = state.word;
  }
  state.word = '';
  state.inWord = false;
}

function newStatement(state) {
  endWord(state);
  state.argv0 = null;
}

function openRegion(state, start, quote, argv0, substitution) {
  state.quote = quote;
  state.open = { start, quote, argv0, substitution };
}

function closeRegion(state, end, substitution) {
  const region = state.open;
  state.regions.push({ ...region, end, substitution: region.substitution || substitution });
  state.open = null;
  state.quote = null;
}

/**
 * `$(` or a backtick inside "...": park the outer statement's word state (the
 * outer word `FOO="pre$(cmd)post"` continues after the substitution as if it
 * were a single character) and scan the body as a fresh statement. Returns
 * the number of characters consumed.
 */
function suspendString(state, index, char) {
  state.suspended.push({
    backtick: char === '`',
    depth: 0,
    argv0: state.open.argv0,
    outer: { word: state.word, inWord: state.inWord, argv0: state.argv0 },
  });
  closeRegion(state, index, true);
  state.word = '';
  state.inWord = false;
  state.argv0 = null;
  return char === '$' ? 2 : 1;
}

function resumeString(state, index, outer) {
  state.suspended.pop();
  state.word = outer.outer.word;
  state.inWord = outer.outer.inWord;
  state.argv0 = outer.outer.argv0;
  openRegion(state, index, '"', outer.argv0, true);
}

/** A character inside a quoted string. Returns the number of characters consumed. */
function scanQuotedChar(state, input, index) {
  const char = input.charAt(index);
  if (state.quote === '"' && char === '\\') {
    state.escaped = true;
    return 1;
  }
  if (char === state.quote) {
    closeRegion(state, index, false);
    return 1;
  }
  if (state.quote === '"' && (char === '`' || (char === '$' && input.charAt(index + 1) === '('))) {
    return suspendString(state, index, char);
  }
  state.word += char;
  state.inWord = true;
  return 1;
}

/** A character outside quotes. Returns the number of characters consumed. */
function scanBareChar(state, index, char) {
  if (char === '\\') {
    state.escaped = true;
    state.inWord = true;
    return 1;
  }
  if (char === '"' || char === "'") {
    state.inWord = true;
    openRegion(state, index, char, state.argv0 === null ? '' : state.argv0, false);
    return 1;
  }
  const outer = state.suspended.length > 0 ? state.suspended[state.suspended.length - 1] : null;
  if (outer !== null) {
    const resumes = outer.backtick ? char === '`' : char === ')' && outer.depth === 0;
    if (resumes) {
      resumeString(state, index, outer);
      return 1;
    }
    if (!outer.backtick && (char === '(' || char === ')')) {
      const depth = outer.depth + (char === '(' ? 1 : -1);
      state.suspended = [...state.suspended.slice(0, -1), { ...outer, depth }];
    }
  }
  if (STATEMENT_SEPARATORS.has(char)) {
    newStatement(state);
    return 1;
  }
  if (/\s/.test(char)) {
    endWord(state);
    return 1;
  }
  state.word += char;
  state.inWord = true;
  return 1;
}

/**
 * Every quoted region of `input`, sorted by start and disjoint.
 *
 * @param {string} input
 * @returns {Array<{start: number, end: number, quote: string, argv0: string, substitution: boolean}>}
 */
function quotedRegions(input) {
  if (cache.input === input) return cache.regions;
  const state = createState();
  for (let i = 0; i < input.length; ) {
    const char = input.charAt(i);
    if (state.escaped) {
      state.escaped = false;
      state.word += char;
      state.inWord = true;
      i += 1;
      continue;
    }
    i += state.quote ? scanQuotedChar(state, input, i) : scanBareChar(state, i, char);
  }
  if (state.open !== null) state.regions.push({ ...state.open, end: input.length });
  cache = { input, regions: state.regions };
  return state.regions;
}

/**
 * The quoted region that strictly contains `idx`, or null when `idx` is not
 * inside a quote. Regions are disjoint and sorted, so this is a binary search.
 *
 * @param {string} input
 * @param {number} idx
 */
function quotedRegionAt(input, idx) {
  const regions = quotedRegions(input);
  let lo = 0;
  let hi = regions.length - 1;
  while (lo <= hi) {
    const mid = (lo + hi) >> 1;
    const region = regions[mid];
    if (idx <= region.start) {
      hi = mid - 1;
    } else if (idx >= region.end) {
      lo = mid + 1;
    } else {
      return region;
    }
  }
  return null;
}

module.exports = { quotedRegions, quotedRegionAt, SHELL_RESERVED_WORDS };
