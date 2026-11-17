/**
 * Shared dev-server command classification.
 *
 * Two hooks have to agree on what counts as "starting a dev server":
 * `pre-bash-dev-server-block.js` refuses it outside tmux, and
 * `auto-tmux-dev.js` rewrites it into a tmux session. They used to carry a
 * copy of the same raw-text regex each, with a comment in both asking the
 * other to stay byte-identical, so widening one silently left the other
 * behind. The classification lives here now, once.
 */

'use strict';

const path = require('path');
const { splitShellSegments } = require('./shell-split');
const {
  extractCommandSubstitutions,
  extractSubshellGroups
} = require('./shell-substitution');

const DEV_COMMAND_WORDS = new Set([
  'npm',
  'pnpm',
  'yarn',
  'bun',
  'npx',
  'tmux'
]);
const SKIPPABLE_PREFIX_WORDS = new Set(['env', 'command', 'builtin', 'exec', 'noglob', 'sudo', 'nohup']);
const PREFIX_OPTION_VALUE_WORDS = {
  env: new Set(['-u', '-C', '-S', '--unset', '--chdir', '--split-string']),
  sudo: new Set([
    '-u',
    '-g',
    '-h',
    '-p',
    '-r',
    '-t',
    '-C',
    '--user',
    '--group',
    '--host',
    '--prompt',
    '--role',
    '--type',
    '--close-from'
  ])
};

function readToken(input, startIndex) {
  let index = startIndex;
  while (index < input.length && /\s/.test(input[index])) index += 1;
  if (index >= input.length) return null;

  let token = '';
  let quote = null;

  while (index < input.length) {
    const ch = input[index];

    if (quote) {
      if (ch === quote) {
        quote = null;
        index += 1;
        continue;
      }

      // Inside double quotes, bash drops a backslash only before $ ` " \ or a
      // newline, so `"echo ready\;"` keeps its `\;` for tmux.
      if (ch === '\\' && quote === '"' && index + 1 < input.length && '$`"\\\n'.includes(input[index + 1])) {
        token += input[index + 1];
        index += 2;
        continue;
      }

      token += ch;
      index += 1;
      continue;
    }

    if (ch === '"' || ch === "'") {
      quote = ch;
      index += 1;
      continue;
    }

    if (/\s/.test(ch)) break;

    if (ch === '\\' && index + 1 < input.length) {
      token += input[index + 1];
      index += 2;
      continue;
    }

    token += ch;
    index += 1;
  }

  return { token, end: index };
}

function shouldSkipOptionValue(wrapper, optionToken) {
  if (!wrapper || !optionToken || optionToken.includes('=')) return false;
  const optionSet = PREFIX_OPTION_VALUE_WORDS[wrapper];
  return Boolean(optionSet && optionSet.has(optionToken));
}

function isOptionToken(token) {
  return token.startsWith('-') && token.length > 1;
}

function normalizeCommandWord(token) {
  if (!token) return '';
  const base = path.basename(token).toLowerCase();
  return base.replace(/\.(cmd|exe|bat)$/i, '');
}

function getLeadingCommand(segment) {
  let index = 0;
  let activeWrapper = null;
  let skipNextValue = false;

  while (index < segment.length) {
    const parsed = readToken(segment, index);
    if (!parsed) return null;
    index = parsed.end;

    const token = parsed.token;
    if (!token) continue;

    if (skipNextValue) {
      skipNextValue = false;
      continue;
    }

    if (token === '--') {
      activeWrapper = null;
      continue;
    }

    if (token === '{' || token === '}') continue;

    if (/^[A-Za-z_][A-Za-z0-9_]*=.*/.test(token)) continue;

    const normalizedToken = normalizeCommandWord(token);

    if (SKIPPABLE_PREFIX_WORDS.has(normalizedToken)) {
      activeWrapper = normalizedToken;
      continue;
    }

    if (activeWrapper && isOptionToken(token)) {
      if (shouldSkipOptionValue(activeWrapper, token)) {
        skipNextValue = true;
      }
      continue;
    }

    return { word: normalizedToken, end: index };
  }

  return null;
}

// tmux commands, and their aliases, that run their shell command in a tmux pane,
// where its output stays readable. run-shell and `tmux -c` run it without one.
const TMUX_PANE_COMMANDS = new Set([
  'new-session', 'new',
  'new-window', 'neww',
  'split-window', 'splitw',
  'respawn-pane', 'respawnp',
  'respawn-window', 'respawnw',
  'send-keys', 'send'
]);
// tmux's own options that take a value (`-L work`, `-Lwork`, or the last of a
// cluster such as `-vL work`).
const TMUX_OPTION_VALUE_LETTERS = new Set(['f', 'L', 'S', 'T']);
// Raw-text spelling of a dev server, kept for tmux and npx arguments, where the
// shell command is one argument among tmux's own. Trailing (?![\w-]) rather
// than \b: `dev-setup` / `dev-docs` / `dev-build` are distinct scripts.
const DEV_PATTERN = /\b(npm\s+run\s+dev|pnpm(?:\s+run)?\s+dev|yarn(?:\s+run)?\s+dev|bun(?:\s+run)?\s+dev)(?![\w-])/;

// The script name is decided from TOKENS, not from a regex over the raw text.
// A raw-text `npm\s+run\s+dev` cannot see through the shell's own quoting, so
// `npm run "dev"`, `npm run 'dev'` and `npm run de"v"` all reached the shell as
// `npm run dev` and started the very server this hook exists to keep in tmux.
// An option in between hid it just as well: `npm --silent run dev` and
// `yarn --cwd app dev` were not matched either.
//
// Trailing `(?::|$)` rather than a word boundary: `dev` and `dev:ssr` are the
// dev server, while `dev-setup` / `dev-docs` / `dev-build` are distinct scripts
// that must keep running.
const DEV_SCRIPT_NAME = /^dev(?::|$)/;
const RUN_KEYWORDS = new Set(['run', 'run-script']);

/**
 * Each package manager's own grammar for the options that may precede a
 * script. The same short flag means different things per manager (pnpm `-d`
 * is `--loglevel=info`, bun `-d` is `--define <K:V>`, pnpm `-w` is the boolean
 * `--workspace-root`), so one shared table either swallows the script after a
 * boolean flag or reads an option's value as the script.
 *
 * - `requiresRun`: npm has no implicit script form (`npm dev` is not a
 *   command), so its script is only ever the token after `run`. That makes
 *   npm's open-ended `--<any-config-key> <value>` surface harmless without a
 *   value table: `npm -d run dev` and `npm --userconfig x run dev` both read
 *   the token after `run`.
 * - `values`: options that consume the following token (`--opt=value` is one
 *   token and needs no entry).
 * - `optionalValues`: options whose value is optional, so the next bare token
 *   may be either their value or the script; both readings are checked.
 *
 * Sources: pnpm `shorthands.ts` and CLI help, Yarn Classic/Berry global
 * options, bun `Arguments.rs`.
 */
const MANAGER_GRAMMARS = {
  npm: { requiresRun: true, values: new Set(), optionalValues: new Set() },
  pnpm: {
    requiresRun: false,
    values: new Set([
      '-C', '--dir', '-F', '--filter', '--filter-prod', '--test-pattern',
      '--changed-files-ignore-pattern', '--loglevel', '--reporter', '--store-dir',
      '--virtual-store-dir', '--modules-dir', '--lockfile-dir', '--registry',
      '--workspace-concurrency'
    ]),
    optionalValues: new Set()
  },
  yarn: {
    requiresRun: false,
    values: new Set([
      '--cwd', '--modules-folder', '--cache-folder', '--preferred-cache-folder',
      '--global-folder', '--link-folder', '--mutex', '--network-timeout',
      '--network-concurrency', '--child-concurrency', '--registry', '--use-yarnrc'
    ]),
    optionalValues: new Set()
  },
  bun: {
    requiresRun: false,
    values: new Set([
      '--cwd', '--env-file', '-F', '--filter', '-r', '--preload', '-d', '--define',
      '-l', '--loader', '--tsconfig-override', '--main-fields', '--shell',
      '--elide-lines', '--install', '--conditions', '--drop', '--feature'
    ]),
    optionalValues: new Set(['-c', '--config', '--inspect', '--inspect-wait', '--inspect-brk'])
  }
};

/**
 * True when a package-manager invocation runs the dev script.
 *
 * With a `run` keyword the script is the token right after it, and anything
 * further along is an ARGUMENT to that script: `npm run build dev` runs build.
 * Without one (`pnpm dev`, `yarn dev`, `bun dev`), the script is the first
 * bare token, and everything after it, a later `run` included, is its
 * argument. `--` ends the manager's own arguments.
 *
 * Residual gap, stated rather than hidden: an implicit form behind a
 * value-taking option missing from the manager's table (`pnpm --unknown value
 * dev`) reads `value` as the script. pnpm, Yarn and bun usually spell such
 * options `--flag=value`, and npm, the one manager with an open-ended config
 * surface, has no implicit form at all.
 *
 * @param {string} segment
 * @param {number} start index just past the manager word
 * @param {string} manager
 * @returns {boolean}
 */
function runsDevScript(segment, start, manager) {
  const grammar = MANAGER_GRAMMARS[manager];
  let index = start;
  let seenRunKeyword = false;
  let skipNextValue = false;
  let optionalValuePending = false;

  for (let parsed = readToken(segment, index); parsed; parsed = readToken(segment, index)) {
    index = parsed.end;
    const token = parsed.token;
    if (!token) continue;

    if (skipNextValue) {
      skipNextValue = false;
      continue;
    }

    if (token === '--') return false;

    if (isOptionToken(token)) {
      optionalValuePending = false;
      if (!seenRunKeyword && grammar.values.has(token)) skipNextValue = true;
      else if (!seenRunKeyword && grammar.optionalValues.has(token)) optionalValuePending = true;
      continue;
    }

    if (!seenRunKeyword && RUN_KEYWORDS.has(token.toLowerCase())) {
      seenRunKeyword = true;
      optionalValuePending = false;
      continue;
    }

    if (seenRunKeyword || !grammar.requiresRun) {
      if (DEV_SCRIPT_NAME.test(token)) return true;
      // Read as an optional option's value, the token is not the script.
      if (optionalValuePending) {
        optionalValuePending = false;
        continue;
      }
      return false;
    }
  }

  return false;
}

/**
 * Return true when the tmux invocation that starts at `index` runs the dev
 * server outside a pane. The tmux commands follow tmux's own options
 * (`-L work`, `-f conf`), and the executable may come through a path or an env
 * prefix, so this reads the parsed tokens instead of the start of the segment.
 * A sequence (`new-session -d \; run-shell ...`) is exempt only when every
 * command in it that runs the dev server is a pane command.
 */
function tmuxRunsDevOutsidePane(segment, index) {
  const tokens = [];
  for (let parsed = readToken(segment, index); parsed; parsed = readToken(segment, parsed.end)) {
    if (parsed.token) tokens.push(parsed.token);
  }
  // A shell command passed to tmux as one argument is classified on its own;
  // the raw pattern keeps the spellings tmux joins from several arguments.
  const runsDev = words => DEV_PATTERN.test(words.join(' ')) || words.some(isDevServerCommand);
  const segmentRunsDev = DEV_PATTERN.test(segment) || runsDev(tokens);

  let next = 0;
  for (; next < tokens.length && isOptionToken(tokens[next]); next++) {
    const letters = tokens[next].slice(1);
    for (let i = 0; i < letters.length; i++) {
      // -c runs its shell command without a pane.
      if (letters[i] === 'c') return segmentRunsDev;
      if (TMUX_OPTION_VALUE_LETTERS.has(letters[i])) {
        if (i === letters.length - 1) next++;
        break;
      }
    }
  }

  // tmux ends a command at a `;` argument and at a `;` that ends an argument
  // (`'npm run dev;'`); an escaped `\;` at the end stays literal.
  const commands = [[]];
  for (const token of tokens.slice(next)) {
    const ends = token.endsWith(';') && !token.endsWith('\\;');
    const value = ends ? token.slice(0, -1) : token;
    if (value) commands[commands.length - 1].push(value);
    if (ends) commands.push([]);
  }
  const devCommands = commands.filter(command => command.length > 0 && runsDev(command.slice(1)));
  if (devCommands.length === 0) return segmentRunsDev;
  return !devCommands.every(command => TMUX_PANE_COMMANDS.has(command[0]));
}

/**
 * Collect every command-line segment we should evaluate. Returns the top-level
 * segments first, then segments harvested from `$(...)` / backtick command
 * substitutions and plain `(...)` subshell groups, recursively.
 *
 * Without this expansion the leading-command check only sees the outermost
 * command, so wrappers like `$(npm run dev)` and `(npm run dev)` (which still
 * spawn a dev server) sneak past.
 */
function collectCheckSegments(cmd) {
  const segments = [...splitShellSegments(cmd)];
  // Expanded here-document bodies enter through splitShellSegments, so their
  // segments must also be scanned for substitutions nested inside them.
  const queue = [cmd, ...segments];
  const seen = new Set();

  // Read by index: shift() copies the queue each time, which is quadratic on a long command.
  for (let head = 0; head < queue.length; head++) {
    const current = queue[head];
    if (seen.has(current)) continue;
    seen.add(current);

    for (const body of [...extractCommandSubstitutions(current), ...extractSubshellGroups(current)]) {
      const bodySegments = splitShellSegments(body);
      // One at a time: spreading a long command's segments into push() exceeds the argument limit.
      queue.push(body);
      for (const segment of bodySegments) {
        segments.push(segment);
        queue.push(segment);
      }
    }
  }

  return segments;
}

function isDevServerSegment(segment) {
  const command = getLeadingCommand(segment);
  if (!command || !DEV_COMMAND_WORDS.has(command.word)) return false;
  if (command.word === 'tmux') return tmuxRunsDevOutsidePane(segment, command.end);
  if (Object.prototype.hasOwnProperty.call(MANAGER_GRAMMARS, command.word)) {
    return runsDevScript(segment, command.end, command.word);
  }
  // npx keeps the raw-text match on the package command it launches.
  return DEV_PATTERN.test(segment);
}

/** True when any segment of `command` starts a dev server outside a tmux pane. */
function isDevServerCommand(command) {
  return collectCheckSegments(String(command || '')).some(isDevServerSegment);
}

module.exports = {
  collectCheckSegments,
  isDevServerCommand,
  isDevServerSegment
};
