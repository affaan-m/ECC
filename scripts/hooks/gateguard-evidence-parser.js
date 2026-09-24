'use strict';

const path = require('path');

function normalizePath(value) {
  return String(value || '').replace(/\\/g, '/').trim();
}

/** Resolves shell-parsed paths while rejecting unexpanded glob and variable syntax. */
function resolveShellEvidencePath(value) {
  if (!value) return '';
  const rawPath = String(value);
  if (['$', '*', '?', '{', '}', '[', ']'].some(meta => rawPath.includes(meta))) return '';
  return normalizePath(path.resolve(rawPath));
}

const INVESTIGATIVE_COMMANDS = new Set(['grep', 'rg', 'find', 'fd', 'fdfind', 'tree', 'wc', 'stat', 'cat', 'head', 'tail', 'git']);
const GIT_INVESTIGATIVE_SUBCOMMANDS = new Set(['log', 'show', 'diff', 'blame', 'grep', 'status', 'ls-files']);
const GREP_OPTIONS_WITH_VALUE = new Set([
  '-A', '-B', '-C', '-D', '-d', '-e', '-f', '-m', '-T', '--after-context', '--before-context',
  '--context', '--devices', '--directories', '--regexp', '--file', '--max-count', '--max-columns',
  '--max-filesize', '--max-depth', '--glob', '--iglob', '-g', '--type', '-t', '--type-add',
  '--type-clear', '--type-not', '--encoding', '--engine', '--sort', '--sortr', '--threads', '--pre',
  '--pre-glob', '--color', '--colors', '--field-match-separator', '--context-separator',
  '--path-separator', '--replace'
]);
const GREP_SHORT_BOOLEAN_OPTIONS = new Set([
  '-a', '-b', '-c', '-H', '-h', '-i', '-l', '-L', '-n', '-o', '-q', '-r', '-s', '-v', '-w', '-x',
  '-z', '-Z', '-F', '-P', '-U', '-V', '-S'
]);
const GREP_LONG_BOOLEAN_OPTIONS = new Set([
  '--binary', '--count', '--count-matches', '--files', '--files-with-matches', '--files-without-match',
  '--fixed-strings', '--follow', '--glob-case-insensitive', '--heading', '--hidden', '--ignore-case',
  '--invert-match', '--json', '--line-number', '--multiline', '--multiline-dotall', '--no-filename',
  '--no-heading', '--no-ignore', '--no-ignore-dot', '--no-ignore-exclude', '--no-ignore-files',
  '--no-ignore-parent', '--no-ignore-vcs', '--null', '--null-data', '--only-matching', '--passthru',
  '--quiet', '--recursive', '--smart-case', '--stats', '--text', '--type-list', '--with-filename',
  '--column', '--line-buffered'
]);
const GREP_OPTIONS_WITH_VALUE_FOR_COMMAND = {
  rg: GREP_OPTIONS_WITH_VALUE,
  grep: new Set([...GREP_OPTIONS_WITH_VALUE].filter(option => option !== '-T'))
};
const FD_OPTIONS_WITH_VALUE = new Set(['-e', '--extension', '-t', '--type', '-E', '--exclude', '--base-directory']);
const PATH_OPTIONS_WITH_VALUE = new Set(['-n', '--lines', '-c', '--bytes', '-s', '--size', '-f', '-L', '--level']);
const GIT_SHOW_OPTIONS_WITH_VALUE = new Set(['--format', '--pretty', '--date', '--abbrev', '--diff-algorithm']);
const FIND_MUTATING_ACTIONS = new Set(['-delete', '-exec', '-execdir', '-ok', '-okdir']);

/** Splits shell input only at unquoted command boundaries. */
function splitShellCommandSegments(command) {
  const segments = [];
  let current = '';
  let quote = null;

  for (let i = 0; i < command.length; i += 1) {
    const ch = command[i];

    if (ch === '\\' && quote !== "'" && i + 1 < command.length) {
      current += command[i + 1];
      i += 1;
      continue;
    }

    if (quote) {
      if (ch === quote) quote = null;
      current += ch;
      continue;
    }

    if (ch === '"' || ch === "'") {
      quote = ch;
      current += ch;
      continue;
    }

    if (ch === '#' && (current.length === 0 || /\s/.test(current[current.length - 1]))) {
      while (i + 1 < command.length && command[i + 1] !== '\n' && command[i + 1] !== '\r') i += 1;
    }

    if (/[;|&\n\r]/.test(ch)) {
      if (current.trim()) segments.push(current.trim());
      current = '';
      if ((ch === '&' || ch === '|') && command[i + 1] === ch) i += 1;
      continue;
    }

    current += ch;
  }

  if (quote) return [];
  if (current.trim()) segments.push(current.trim());
  return segments;
}

/** Rejects command forms where static parsing cannot prove which inspection ran. */
function hasUnsafeShellControlFlow(command) {
  let quote = null;
  for (let i = 0; i < command.length; i += 1) {
    const ch = command[i];
    if (ch === '\\' && quote !== "'" && i + 1 < command.length) {
      i += 1;
      continue;
    }
    if (quote) {
      if (ch === quote) quote = null;
      continue;
    }
    if (ch === '"' || ch === "'") {
      quote = ch;
      continue;
    }
    if (ch === ';' || ch === '\n' || ch === '\r' || ch === '&' || (ch === '|' && command[i + 1] === '|')) {
      return true;
    }
  }
  return Boolean(quote);
}

/** Tokenizes one shell segment while preserving quoted arguments as single tokens. */
function tokenizeShellSegment(segment) {
  const tokens = [];
  let current = '';
  let quote = null;
  let started = false;

  for (let i = 0; i < segment.length; i += 1) {
    const ch = segment[i];

    if (ch === '\\' && quote !== "'" && i + 1 < segment.length) {
      current += segment[i + 1];
      started = true;
      i += 1;
      continue;
    }

    if (quote) {
      if (ch === quote) quote = null;
      else current += ch;
      started = true;
      continue;
    }

    if (ch === '"' || ch === "'") {
      quote = ch;
      started = true;
      continue;
    }

    if (/\s/.test(ch)) {
      if (started) tokens.push(current);
      current = '';
      started = false;
      continue;
    }

    current += ch;
    started = true;
  }

  if (quote) return null;
  if (started) tokens.push(current);
  return tokens;
}

/** Removes options and their values to leave command positional arguments. */
function positionalArguments(args, optionsWithValue = new Set()) {
  const positionals = [];
  let afterOptions = false;

  for (let i = 0; i < args.length; i += 1) {
    const arg = args[i];
    if (afterOptions) {
      positionals.push(arg);
      continue;
    }
    if (arg === '--') {
      afterOptions = true;
      continue;
    }
    if (arg.startsWith('-') && arg !== '-') {
      const option = arg.split('=')[0];
      if (optionsWithValue.has(option) && !arg.includes('=')) i += 1;
      continue;
    }
    positionals.push(arg);
  }

  return positionals;
}

/** Converts a parsed inspection target to a normalized evidence record. */
function makeTargetEvidence(targetArg, pattern = targetArg) {
  const target = resolveShellEvidencePath(targetArg);
  return target ? { target, pattern: String(pattern).slice(0, 300) } : null;
}

/** Parses path evidence from a Git inspection command. */
function gitInvestigationTarget(args) {
  const subcommandIndex = args.findIndex(arg => !arg.startsWith('-'));
  const subcommand = subcommandIndex >= 0 ? args[subcommandIndex].toLowerCase() : '';
  if (!GIT_INVESTIGATIVE_SUBCOMMANDS.has(subcommand)) return null;

  const rest = args.slice(subcommandIndex + 1);
  const separator = rest.indexOf('--');
  const pathspecs = separator >= 0 ? positionalArguments(rest.slice(separator + 1)) : [];
  const objectArgs = separator >= 0 ? rest.slice(0, separator) : rest;
  let targetArg = pathspecs[0] || '';

  if (subcommand === 'show' && !targetArg) {
    const objectPath = positionalArguments(objectArgs, GIT_SHOW_OPTIONS_WITH_VALUE)
      .find(arg => !arg.startsWith('-') && arg.includes(':'));
    if (objectPath) targetArg = objectPath.slice(objectPath.indexOf(':') + 1);
  } else if (subcommand === 'blame' && !targetArg) {
    targetArg = positionalArguments(rest)[0] || '';
  }
  return targetArg ? makeTargetEvidence(targetArg) : null;
}

/** Rejects grep options the evidence parser cannot safely interpret. */
function isSupportedGrepOptions(args, executable) {
  const valueOptions = GREP_OPTIONS_WITH_VALUE_FOR_COMMAND[executable];
  for (let i = 0; i < args.length; i += 1) {
    const argument = args[i];
    if (argument === '--') break;
    if (!argument.startsWith('-') || argument === '-') continue;

    const option = argument.split('=')[0];
    if (valueOptions.has(option)) {
      if (!argument.includes('=')) {
        if (i + 1 >= args.length) return false;
        i += 1;
      }
      continue;
    }
    if (GREP_LONG_BOOLEAN_OPTIONS.has(option)) {
      if (argument.includes('=')) return false;
      continue;
    }
    if (argument.startsWith('--')) return false;

    let validCluster = true;
    for (const flag of argument.slice(1)) {
      if (valueOptions.has('-' + flag)) break;
      if (!GREP_SHORT_BOOLEAN_OPTIONS.has('-' + flag)) {
        validCluster = false;
        break;
      }
    }
    if (!validCluster) return false;
  }
  return true;
}

/** Parses file or pattern evidence from grep and ripgrep. */
function grepInvestigationTarget(args, executable) {
  if (!isSupportedGrepOptions(args, executable)) return null;
  const patternOptions = new Set(['-e', '-f', '--regexp', '--file']);
  const patternIndex = args.findIndex(arg => patternOptions.has(arg));
  const inlinePattern = args.find(arg => arg.startsWith('--regexp='))?.slice('--regexp='.length)
    || args.find(arg => arg.startsWith('--file='))?.slice('--file='.length)
    || args.find(arg => /^-e.+/.test(arg))?.slice(2)
    || '';
  const hasPattern = patternIndex >= 0 || Boolean(inlinePattern);
  const pattern = patternIndex >= 0 ? args[patternIndex + 1] || '' : inlinePattern;
  const positionals = positionalArguments(args, GREP_OPTIONS_WITH_VALUE_FOR_COMMAND[executable]);
  const inferredPattern = hasPattern ? pattern : positionals[0] || '';
  const targetArg = args.includes('--files')
    ? positionals[0] || ''
    : positionals[hasPattern ? 0 : 1] || '';
  return targetArg ? makeTargetEvidence(targetArg, inferredPattern || targetArg) : null;
}

/** Parses the search root from a find expression. */
function findInvestigationTarget(args) {
  if (args.some(arg => FIND_MUTATING_ACTIONS.has(arg.toLowerCase()))) return null;
  let index = 0;
  while (['-H', '-L', '-P'].includes(args[index])) index += 1;
  const start = index;
  while (index < args.length && args[index] !== '!' && args[index] !== '(' && !args[index].startsWith('-')) index += 1;
  return makeTargetEvidence(args[start] || '.');
}

/** Returns a concrete target and query for one allowlisted inspection command. */
function investigativeTarget(tokens) {
  if (!tokens.length) return null;
  const executable = tokens[0].toLowerCase();
  if (!INVESTIGATIVE_COMMANDS.has(executable)) return null;
  const args = tokens.slice(1);
  if (args.some(arg => ['--help', '-h', '--version', '-V'].includes(arg))) return null;
  if (executable === 'git') return gitInvestigationTarget(args);
  if (executable === 'grep' || executable === 'rg') return grepInvestigationTarget(args, executable);
  if (executable === 'find') return findInvestigationTarget(args);
  if (executable === 'fd' || executable === 'fdfind') {
    const positionals = positionalArguments(args, FD_OPTIONS_WITH_VALUE);
    return makeTargetEvidence(positionals[1] || '', positionals[0] || positionals[1] || '');
  }
  const targetArg = positionalArguments(args, PATH_OPTIONS_WITH_VALUE)[0] || '';
  return targetArg ? makeTargetEvidence(targetArg) : null;
}

/** Finds the first allowlisted inspection command with a concrete target. */
function investigativeCommandEvidence(command) {
  // Conditionals, sequential commands, and newlines can skip commands or change cwd.
  // A plain pipeline is safe to inspect because each pipeline stage is invoked.
  if (hasUnsafeShellControlFlow(command)) return null;

  for (const segment of splitShellCommandSegments(command)) {
    const tokens = tokenizeShellSegment(segment);
    if (!tokens || tokens.length === 0) continue;
    const evidence = investigativeTarget(tokens);
    if (evidence) return evidence;
  }
  return null;
}

module.exports = { investigativeCommandEvidence };
