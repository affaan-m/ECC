'use strict';

/**
 * Where a shell statement ends, and what can tie it to the commands after it,
 * for a guard that reads a command line without running a shell.
 */

const { quotedRegions, SHELL_RESERVED_WORDS } = require('./shell-quotes');

/**
 * Whether a statement's first word sits right inside or right after a
 * substitution. `$(echo '...')` runs what echo prints, `source <(echo '...')`
 * reads it as a script, and in `$(command -v sh) -c '...'` the program is only
 * known when the line runs.
 */
function startsAtSubstitution(input, argv0Start) {
  let i = argv0Start - 1;
  while (i >= 0 && /\s/.test(input.charAt(i))) i--;
  const char = input.charAt(i);
  if (char === '`' || char === ')') return true;
  return char === '(' && /[$<>]/.test(input.charAt(i - 1));
}

/**
 * Where the statement that starts at `start` ends: at an unquoted `;`, `|`,
 * `&` or newline, or at a `)` that closes the substitution or subshell around
 * it. A substitution inside the statement is part of it. `opaque` says the
 * shell may still change the statement's words: a parameter expansion or a
 * substitution in them.
 */
function statementBounds(input, start) {
  let quote = null;
  let opaque = false;
  let depth = 0;
  let backtick = false;
  for (let i = start; i < input.length; i++) {
    const char = input.charAt(i);
    if (quote === "'") {
      if (char === "'") quote = null;
      continue;
    }
    if (char === '\\') {
      i++;
      continue;
    }
    if (char === '$' && /[\w{(@*#?$!-]/.test(input.charAt(i + 1))) opaque = true;
    if (char === '`') {
      // A backtick that closes a substitution around the statement reads as
      // opening one, so the rest of the line counts: more operands, not fewer.
      opaque = true;
      backtick = !backtick;
    } else if (quote === '"') {
      if (char === '"') quote = null;
    } else if (char === "'" || char === '"') {
      quote = char;
    } else if (char === '(') {
      opaque = true;
      depth++;
    } else if (char === ')') {
      if (depth === 0) return { end: i, opaque };
      depth--;
    } else if (depth === 0 && !backtick && /[;|&\n]/.test(char)) {
      return { end: i, opaque };
    }
  }
  return { end: input.length, opaque };
}

/**
 * Whether the separator at `i` ends a statement instead of joining the next
 * command to it: `;`, a newline, `&&`, `||` or a background `&`. A pipe (`|`,
 * `|&`) joins, and so does the `&` of a redirection (`2>&1`, `>&2`, `&>`).
 */
function endsStatement(input, i) {
  const char = input.charAt(i);
  if (char === ';' || char === '\n') return true;
  if (char === '|') return input.charAt(i + 1) === '|';
  if (char !== '&') return false;
  const before = input.charAt(i - 1);
  return before !== '>' && before !== '<' && before !== '|' && input.charAt(i + 1) !== '>';
}

/**
 * Whether the command line before `end` holds anything that can carry the
 * output of a finished statement into a later pipe: a brace group or
 * subshell (`{ echo '...'; } | sh`), a function body called later on, a
 * compound command (`if ...; fi | sh`) or a substitution. Quoted text does
 * not count, and neither does a brace inside a word, which is brace or
 * parameter expansion (`/tmp/{a,b}`, `${HOME}`): a brace group opens with
 * `{` as a word of its own.
 */
function mayGroupStatements(input, end) {
  let bare = '';
  let pos = 0;
  for (const region of quotedRegions(input)) {
    if (region.start >= end) break;
    bare += `${input.slice(pos, region.start)} `;
    pos = region.end + 1;
  }
  bare += input.slice(pos, end);
  return /[()`]/.test(bare) || bare.split(/[\s;&|]+/).some((word) => SHELL_RESERVED_WORDS.has(word));
}

module.exports = { startsAtSubstitution, statementBounds, endsStatement, mayGroupStatements };
