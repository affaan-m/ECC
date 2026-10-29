'use strict';

// $'...' quoting, in which a backslash also escapes the closing quote
const ANSI_C_QUOTED_RE = /\$'((?:\\[\s\S]|[^'\\])*)'/y;
const ANSI_C_ESCAPES = { a: '\x07', b: '\b', e: '\x1b', E: '\x1b', f: '\f', n: '\n', r: '\r', t: '\t', v: '\v' };

// A byte escape (\xHH, \NNN), another escape, or a run of text in $'...' quoting
const ANSI_C_TOKEN_RE = /\\(x[0-9A-Fa-f]{1,2}|[0-7]{1,3})|\\(u[0-9A-Fa-f]{1,4}|U[0-9A-Fa-f]{1,8}|c[\s\S]|[\s\S])|[^\\]+|\\/g;

// The character that an ANSI-C escape other than a byte escape stands for, or the escape itself.
function ansiCEscape(code, escape) {
  if ('uU'.includes(code[0]) && code.length > 1) {
    const value = parseInt(code.slice(1), 16);
    return value <= 0x10ffff ? String.fromCodePoint(value) : escape;
  }
  if (code[0] === 'c' && code.length > 1) return String.fromCharCode(code.charCodeAt(1) & 0x1f);
  return ANSI_C_ESCAPES[code] ?? (`\\'"?`.includes(code) ? code : escape);
}

const UTF8 = new TextDecoder('utf-8', { fatal: true, ignoreBOM: true });

// The text of $'...' quoting with its escapes decoded, as Bash decodes them, or null when the
// bytes are not UTF-8. Hex and octal escapes are bytes, so $'\xc3\xa9' is the UTF-8 text é.
function decodeAnsiC(text) {
  const chunks = [];
  for (const [token, byte, code] of text.matchAll(ANSI_C_TOKEN_RE)) {
    if (byte !== undefined) {
      chunks.push(Buffer.of(byte[0] === 'x' ? parseInt(byte.slice(1), 16) : parseInt(byte, 8) & 0xff));
    } else {
      chunks.push(Buffer.from(code === undefined ? token : ansiCEscape(code, token), 'utf8'));
    }
  }
  try {
    return UTF8.decode(Buffer.concat(chunks));
  } catch {
    return null;
  }
}

// The shell word at `start`, up to an unquoted space, tab, newline or operator character, with
// its quoting removed, and whether any part of it was quoted. As in Bash, a carriage return is
// part of the word. Null if a quote does not close. The word is
// null when it holds bytes that are not UTF-8: no line of the command can then be equal to it.
function readWord(command, start) {
  let word = '';
  let quote = null;
  let quoted = false;
  let utf8 = true;
  let i = start;
  for (; i < command.length; i++) {
    const ch = command[i];
    ANSI_C_QUOTED_RE.lastIndex = i;
    const ansiC = !quote && ch === '$' ? ANSI_C_QUOTED_RE.exec(command) : null;
    if (quote) {
      if (ch === quote) quote = null;
      else word += ch;
    } else if (ansiC) {
      // $'...' decodes its escapes, so $'E\x4fF' is EOF
      const decoded = decodeAnsiC(ansiC[1]);
      if (decoded === null) utf8 = false;
      else word += decoded;
      quoted = true;
      i += ansiC[0].length - 1;
    } else if (ch === "'" || ch === '"') {
      quote = ch;
      quoted = true;
    } else if (ch === '$' && command[i + 1] === '"') {
      // $"..." is double quoting; the $ is not part of the word
      continue;
    } else if (ch === '\\' && i + 1 < command.length) {
      word += command[++i];
      quoted = true;
    } else if (/[ \t\n|&;()<>]/.test(ch)) {
      break;
    } else {
      word += ch;
    }
  }
  return quote ? null : { word: utf8 ? word : null, quoted, end: i };
}

// A here-document opener at `index`, but not a here-string (<<<): `<<` or `<<-`, then the
// delimiter, a shell word whose quotes are removed (`<<'EOF'`, `<<E"OF"`, `<<$'EOF'`,
// `<<EOF/END`, `<<123`, and `<<''`, whose body ends at the first empty line). Unless part of the
// word is quoted, Bash expands the body, so its command substitutions run.
function heredocAt(command, index) {
  if (command[index - 1] === '<' || command[index + 2] === '<') return null;
  let i = index + 2;
  const stripTabs = command[i] === '-';
  if (stripTabs) i++;
  while (command[i] === ' ' || command[i] === '\t') i++;
  const word = readWord(command, i);
  if (!word || (!word.word && !word.quoted)) return null;
  return { text: command.slice(index, word.end), delimiter: word.word, stripTabs, expands: !word.quoted };
}

// The index after the `)` that closes the `(` at `index`, or -1. Quoted parentheses and escaped
// characters do not count.
function endOfParens(command, index) {
  let depth = 0;
  let quote = null;
  for (let i = index; i < command.length; i++) {
    const ch = command[i];
    if (ch === '\\' && quote !== "'") i++;
    else if (quote) quote = ch === quote ? null : quote;
    else if (ch === "'" || ch === '"') quote = ch;
    else if (ch === '(') depth++;
    else if (ch === ')' && --depth === 0) return i + 1;
  }
  return -1;
}

// The index after the `))` that closes the arithmetic `((` at `index`, or -1.
function endOfArithmetic(command, index) {
  const end = endOfParens(command, index);
  return end !== -1 && command[end - 2] === ')' ? end : -1;
}

// The commands of the `$(...)` and backquoted substitutions in an expanded here-document body.
// Bash runs them while it reads the body, where quotes are plain text and a backslash escapes.
function commandSubstitutions(body) {
  const commands = [];
  let i = 0;
  while (i < body.length) {
    const backquoted = body[i] === '`';
    if (body[i] === '\\') {
      i += 2;
    } else if (backquoted || (body[i] === '$' && body[i + 1] === '(')) {
      const end = backquoted ? body.indexOf('`', i + 1) + 1 : endOfParens(body, i + 1);
      if (end <= 0) break;
      commands.push(body.slice(backquoted ? i + 1 : i + 2, end - 1));
      i = end;
    } else {
      i++;
    }
  }
  return commands;
}

// Whether the character at `index` is escaped by an odd run of backslashes before it.
function isEscaped(command, index) {
  let count = 0;
  for (let i = index - 1; i >= 0 && command[i] === '\\'; i--) count++;
  return count % 2 === 1;
}

// Whether the character at `index` starts a word: it is the first of the command, or it follows an
// unescaped blank or operator character. Bash removes a backslash-newline pair first, so the
// character before the pair is the one that counts.
function startsWord(command, index, current) {
  if (current === '') return true;
  let before = index - 1;
  while (before >= 1 && command[before] === '\n' && command[before - 1] === '\\' && !isEscaped(command, before - 1)) {
    before -= 2;
  }
  return before < 0 || (/[\s;&|(]/.test(command[before]) && !isEscaped(command, before));
}

// The end of a span copied as is, or -1: a comment, which runs to the end of its line, or an
// arithmetic expression such as $((x << n)), whose `<<` is a shift and `&&` an operator.
function literalSpanEnd(command, index, atWordStart) {
  if (command[index] === '#' && atWordStart) {
    const newline = command.indexOf('\n', index);
    return newline === -1 ? command.length : newline;
  }
  return command[index] === '(' && command[index + 1] === '(' ? endOfArithmetic(command, index) : -1;
}

// Whether `text` ends in an odd number of backslashes, the last of which escapes what follows.
function endsInEscape(text) {
  let count = 0;
  while (count < text.length && text[text.length - 1 - count] === '\\') count++;
  return count % 2 === 1;
}

// The here-document bodies that start at `start`, one after the other: the index after them,
// and the commands that the expanded ones run through command substitution.
function readHeredocBodies(command, start, heredocs) {
  let end = start;
  const substitutions = [];
  for (const { delimiter, stripTabs, expands } of heredocs) {
    const bodyStart = end;
    let bodyEnd = command.length;
    while (end < command.length) {
      const lineStart = end;
      let line = '';
      for (;;) {
        const newline = command.indexOf('\n', end);
        const lineEnd = newline === -1 ? command.length : newline;
        const part = command.slice(end, lineEnd);
        end = lineEnd + 1;
        // In an expanded body, Bash joins a line that ends in an escaping backslash with the
        // next one before it compares the line with the delimiter.
        if (!expands || newline === -1 || !endsInEscape(part)) {
          line += part;
          break;
        }
        line += part.slice(0, -1);
      }
      if ((stripTabs ? line.replace(/^\t+/, '') : line) === delimiter) {
        bodyEnd = lineStart;
        break;
      }
    }
    if (expands) substitutions.push(...commandSubstitutions(command.slice(bodyStart, bodyEnd)));
  }
  return { end: Math.min(end, command.length), substitutions };
}

// At the newline at `index` the command ends. The bodies of the here-documents opened on its
// line follow it. They are data, not commands, so they are left out of the segments, except for
// the commands that an expanded body runs. Returns the index after the bodies.
function endLine(command, index, current, heredocs, segments) {
  if (current.trim()) segments.push(current.trim());
  const { end, substitutions } = readHeredocBodies(command, index + 1, heredocs);
  for (const substitution of substitutions) segments.push(...splitShellSegments(substitution));
  return end;
}

/**
 * Split a shell command into segments by operators (&&, ||, ;, &) and by
 * newlines, while respecting quoting (single/double) and escaped characters.
 * Redirection operators (&>, >&, 2>&1) are NOT treated as separators, and the
 * body of a here-document, which is data, is left out of the segments.
 */
function splitShellSegments(command) {
  const segments = [];
  let current = '';
  let quote = null;
  // Here-documents opened on the current line, read after its newline.
  let heredocs = [];

  for (let i = 0; i < command.length; i++) {
    const ch = command[i];

    // Inside quotes: handle escapes and closing quote
    if (quote) {
      if (ch === '\\' && i + 1 < command.length) {
        current += ch + command[i + 1];
        i++;
        continue;
      }
      if (ch === quote) quote = null;
      current += ch;
      continue;
    }

    // Backslash escape outside quotes
    if (ch === '\\' && i + 1 < command.length) {
      current += ch + command[i + 1];
      i++;
      continue;
    }

    // Opening quote
    if (ch === '"' || ch === "'") {
      quote = ch;
      current += ch;
      continue;
    }

    const next = command[i + 1] || '';
    const prev = i > 0 ? command[i - 1] : '';

    const spanEnd = literalSpanEnd(command, i, ch === '#' && startsWord(command, i, current));
    if (spanEnd !== -1) {
      current += command.slice(i, spanEnd);
      i = spanEnd - 1;
      continue;
    }

    const heredoc = ch === '<' && next === '<' ? heredocAt(command, i) : null;
    if (heredoc) {
      heredocs.push(heredoc);
      current += heredoc.text;
      i += heredoc.text.length - 1;
      continue;
    }

    // A newline ends a command, after the bodies of the here-documents opened on its line
    if (ch === '\n') {
      i = endLine(command, i, current, heredocs, segments) - 1;
      heredocs = [];
      current = '';
      continue;
    }

    // && operator
    if (ch === '&' && next === '&') {
      if (current.trim()) segments.push(current.trim());
      current = '';
      i++;
      continue;
    }

    // || operator
    if (ch === '|' && next === '|') {
      if (current.trim()) segments.push(current.trim());
      current = '';
      i++;
      continue;
    }

    // ; separator
    if (ch === ';') {
      if (current.trim()) segments.push(current.trim());
      current = '';
      continue;
    }

    // Single & — but skip redirection patterns (&>, >&, digit>&)
    if (ch === '&' && next !== '&') {
      if (next === '>' || prev === '>') {
        current += ch;
        continue;
      }
      if (current.trim()) segments.push(current.trim());
      current = '';
      continue;
    }

    current += ch;
  }

  if (current.trim()) segments.push(current.trim());
  return segments;
}

module.exports = { splitShellSegments };
