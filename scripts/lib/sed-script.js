'use strict';

/**
 * GNU sed, as far as a command guard needs it: which of sed's arguments are
 * its scripts, and what a script runs through a shell. The `e` command and
 * the `e` flag of `s` run a command line; nothing else in a script does.
 */

const SED_PROGRAMS = new Set(['sed', 'gsed']);

/**
 * The scripts in sed's arguments, read as GNU sed's option parser reads them:
 * each `-e`/`--expression` value, or else the first operand. The other
 * operands are input files, and a script named with `-f` is not on the line.
 * When the shell may still change the words (`$OPTS`, a substitution), every
 * operand may be the script.
 */
function sedScripts(args, everyOperand = false) {
  const scripts = [];
  const operands = [];
  let scriptOption = false;
  for (let i = 0; i < args.length; i++) {
    const arg = args[i];
    if (arg === '--') {
      operands.push(...args.slice(i + 1));
      break;
    }
    if (arg.startsWith('--')) {
      // A long option may be shortened to any prefix that names only it.
      const [name, value] = arg.slice(2).split(/=(.*)/s);
      if ('expression'.startsWith(name)) {
        scripts.push(value ?? args[++i] ?? '');
        scriptOption = true;
      } else if (name.length >= 2 && 'file'.startsWith(name)) {
        scriptOption = true;
        if (value === undefined) i++;
      } else if ('line-length'.startsWith(name) && value === undefined) {
        i++;
      }
      continue;
    }
    if (arg.startsWith('-') && arg !== '-') {
      for (let j = 1; j < arg.length; j++) {
        const option = arg[j];
        // -i takes the rest of the word as its backup suffix: `-ie` is -i with suffix e.
        if (option === 'i') break;
        if (option !== 'e' && option !== 'f' && option !== 'l') continue;
        const value = j + 1 < arg.length ? arg.slice(j + 1) : args[++i];
        if (option === 'e') scripts.push(value ?? '');
        if (option !== 'l') scriptOption = true;
        break;
      }
      continue;
    }
    operands.push(arg);
  }
  if (everyOperand) return [...scripts, ...operands];
  if (!scriptOption && operands.length > 0) scripts.push(operands[0]);
  return scripts;
}

/**
 * The texts to read as sed scripts, each on its own. sed joins its scripts
 * with newlines into one; when the shell may still change the words, every
 * operand is read as a script of its own.
 */
function sedScriptTexts(args, opaque) {
  return opaque ? sedScripts(args, true) : [sedScripts(args).join('\n')];
}

/** Past the spaces and tabs at `i`. */
function skipBlanks(script, i) {
  while (script[i] === ' ' || script[i] === '\t') i++;
  return i;
}

/**
 * One part of a sed `s` or `y` command or of a regex address, from `start` up
 * to the next unescaped `delimiter`. An escaped delimiter stands for itself.
 * sed rejects a part that an unescaped newline cuts short.
 */
function sedPart(script, start, delimiter) {
  let text = '';
  for (let i = start; i < script.length; i++) {
    const char = script[i];
    if (char === '\\' && i + 1 < script.length) {
      text += script[i + 1] === delimiter ? delimiter : char + script[i + 1];
      i++;
      continue;
    }
    if (char === delimiter) return { text, end: i };
    if (char === '\n') return null;
    text += char;
  }
  return null;
}

/**
 * Past the sed address at `i`, if there is one: a line number (`3`, `0~4`),
 * `$`, a regex (`/re/I`, `\%re%`) or, as the second address, `+N` or `~N`.
 */
function sedAddressEnd(script, i, second) {
  const char = script[i];
  if (char === '/' || char === '\\') {
    const delimiter = char === '\\' ? script[i + 1] : char;
    const regex = sedPart(script, char === '\\' ? i + 2 : i + 1, delimiter);
    if (regex === null) return script.length;
    i = skipBlanks(script, regex.end + 1);
    while (script[i] === 'I' || script[i] === 'M') i = skipBlanks(script, i + 1);
    return i;
  }
  if (char === '$') return i + 1;
  if (!/[0-9]/.test(char || '') && !(second && (char === '+' || char === '~'))) return i;
  if (!/[0-9]/.test(char)) i = skipBlanks(script, i + 1);
  while (/[0-9]/.test(script[i] || '')) i++;
  const step = skipBlanks(script, i);
  if (second || script[step] !== '~') return i;
  i = skipBlanks(script, step + 1);
  while (/[0-9]/.test(script[i] || '')) i++;
  return i;
}

/**
 * The end of the text of an `a`, `i`, `c` or `e` command: the first newline
 * that no backslash escapes. A backslash before a newline carries the text on.
 */
function sedTextEnd(script, i) {
  for (; i < script.length; i++) {
    if (script[i] === '\\') i++;
    else if (script[i] === '\n') return i;
  }
  return script.length;
}

/**
 * sed's text as the shell running it reads it: escaped characters stand for
 * themselves, and a backslash before a newline joins the two lines.
 */
function sedUnescape(text) {
  return text.replace(/\\\n/g, '').replace(/\\([\s\S])/g, (match, char) => (char === 'n' ? '\n' : char));
}

// Commands whose argument runs to the end of the line: a comment and a file name.
const SED_LINE_COMMANDS = new Set(['#', 'r', 'R', 'w', 'W']);

// Commands that take text, which the next newline without a backslash ends.
const SED_TEXT_COMMANDS = new Set(['a', 'i', 'c', 'e']);

// Commands that take a label or a version, which a blank or `;` ends.
const SED_LABEL_COMMANDS = new Set([':', 'b', 't', 'T', 'v']);

/** The end of the line that `i` is on. */
function lineEnd(script, i) {
  const end = script.indexOf('\n', i);
  return end === -1 ? script.length : end;
}

/** Past a command's addresses and any `!`, to its command letter. */
function sedCommandStart(script, i) {
  i = skipBlanks(script, sedAddressEnd(script, i, false));
  if (script[i] === ',') i = skipBlanks(script, sedAddressEnd(script, skipBlanks(script, i + 1), true));
  while (script[i] === '!') i = skipBlanks(script, i + 1);
  return i;
}

/**
 * The text of an `a`, `i`, `c` or `e` command, from `i` after its letter: past
 * blanks and one backslash. An `e` command's text is recorded in `found`: the
 * command it runs, or, with no text, the pattern space. Returns where it ends.
 */
function readSedText(script, i, command, found) {
  i = skipBlanks(script, i);
  if (script[i] === '\\') i += script[i + 1] === '\n' ? 2 : 1;
  const end = sedTextEnd(script, i);
  if (command === 'e') {
    const text = sedUnescape(script.slice(i, end)).trim();
    if (text === '') found.runsInput = true;
    else found.commands.push(text);
  }
  return end;
}

/**
 * An `s` or `y` command from its delimiter at `i`. An `s` command with the `e`
 * flag runs its replacement, and the text sed reads with it, which `found`
 * records. Returns where the command ends, or -1 when a part is not closed:
 * sed then rejects the whole script and runs none of it.
 */
function readSedSubstitution(script, i, command, found) {
  const delimiter = script[i];
  const pattern = delimiter === undefined ? null : sedPart(script, i + 1, delimiter);
  const replacement = pattern && sedPart(script, pattern.end + 1, delimiter);
  if (!replacement) return -1;
  i = replacement.end + 1;
  if (command === 'y') return i;
  const flags = /^[gpiImMe0-9]*/.exec(script.slice(i))[0];
  i += flags.length;
  if (script[i] === 'w') i = lineEnd(script, i);
  if (flags.includes('e')) {
    found.commands.push(sedUnescape(replacement.text));
    found.runsInput = true;
  }
  return i;
}

/** The command whose letter is at `i`. Returns where it ends, or -1 (see above). */
function readSedCommand(script, i, found) {
  const command = script[i];
  const next = i + 1;
  if (SED_LINE_COMMANDS.has(command)) return lineEnd(script, next);
  if (SED_TEXT_COMMANDS.has(command)) return readSedText(script, next, command, found);
  if (command === 's' || command === 'y') return readSedSubstitution(script, next, command, found);
  if (!SED_LABEL_COMMANDS.has(command)) return next;
  let end = skipBlanks(script, next);
  while (end < script.length && !/[\s;]/.test(script[end])) end++;
  return end;
}

/**
 * What a sed script runs through a shell (GNU sed). An `s` command with the
 * `e` flag runs the pattern space once the replacement is made, and an `e`
 * command runs its text, or the pattern space when it has none. The script is
 * read command by command, as sed reads it, so the text `a`, `i` and `c` add,
 * a comment, a label or a file name is never taken for a command. `commands`
 * holds the command text the script itself supplies; `runsInput` says the text
 * sed reads is run too.
 */
function sedExecution(script) {
  const found = { commands: [], runsInput: false };
  let i = 0;
  while (i >= 0 && i < script.length) {
    if (/[\s;]/.test(script[i])) i++;
    else i = readSedCommand(script, sedCommandStart(script, i), found);
  }
  return found;
}

module.exports = { SED_PROGRAMS, sedScripts, sedScriptTexts, sedExecution };
