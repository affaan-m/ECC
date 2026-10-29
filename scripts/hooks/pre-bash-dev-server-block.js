#!/usr/bin/env node
'use strict';

const MAX_STDIN = 1024 * 1024;
const path = require('path');
const { splitShellSegments } = require('../lib/shell-split');
const {
  extractCommandSubstitutions,
  extractSubshellGroups
} = require('../lib/shell-substitution');

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

let raw = '';
process.stdin.setEncoding('utf8');
process.stdin.on('data', chunk => {
  if (raw.length < MAX_STDIN) {
    const remaining = MAX_STDIN - raw.length;
    raw += chunk.substring(0, remaining);
  }
});

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
// Trailing (?![\w-]) rather than \b: \b treats a hyphen as a word boundary, so
// `dev\b` matches the `dev` prefix of distinct scripts like `dev-setup` /
// `dev-docs` / `dev-build` and wrongly blocks them. The lookahead still matches
// the dev server (`dev`, `dev;`, `dev:ssr`, ...) but not a `dev-<suffix>` script.
const DEV_PATTERN = /\b(npm\s+run\s+dev|pnpm(?:\s+run)?\s+dev|yarn(?:\s+run)?\s+dev|bun(?:\s+run)?\s+dev)(?![\w-])/;

/**
 * Collect every command-line segment we should evaluate. Returns the top-level
 * segments first, then segments harvested from `$(...)` / backtick command
 * substitutions and plain `(...)` subshell groups, recursively.
 *
 * Without this expansion the leading-command and dev-pattern check below only
 * sees the outermost command, so wrappers like `$(npm run dev)` and
 * `(npm run dev)` (which still spawn a dev server) sneak past.
 */
function collectCheckSegments(cmd) {
  const segments = [...splitShellSegments(cmd)];
  const queue = [cmd];
  const seen = new Set();

  while (queue.length) {
    const current = queue.shift();
    if (seen.has(current)) continue;
    seen.add(current);

    for (const body of extractCommandSubstitutions(current)) {
      for (const seg of splitShellSegments(body)) segments.push(seg);
      queue.push(body);
    }
    for (const body of extractSubshellGroups(current)) {
      for (const seg of splitShellSegments(body)) segments.push(seg);
      queue.push(body);
    }
  }

  return segments;
}

/**
 * Return true when the tmux invocation that starts at `index` runs the dev
 * server in a pane. The tmux commands follow tmux's own options (`-L work`,
 * `-f conf`), and the executable may come through a path or an env prefix, so
 * this reads the parsed tokens instead of the start of the segment. A sequence
 * (`new-session -d \; run-shell ...`) is exempt only when every command in it
 * that runs the dev server is a pane command.
 */
function isTmuxPaneLaunch(segment, index) {
  const tokens = [];
  for (let parsed = readToken(segment, index); parsed; parsed = readToken(segment, parsed.end)) {
    if (parsed.token) tokens.push(parsed.token);
  }

  let next = 0;
  for (; next < tokens.length && isOptionToken(tokens[next]); next++) {
    const letters = tokens[next].slice(1);
    for (let i = 0; i < letters.length; i++) {
      // -c runs its shell command without a pane.
      if (letters[i] === 'c') return false;
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
  const devCommands = commands.filter(command => DEV_PATTERN.test(command.join(' ')));
  return devCommands.length > 0 && devCommands.every(command => TMUX_PANE_COMMANDS.has(command[0]));
}

function isBlockedDevSegment(segment) {
  const command = getLeadingCommand(segment);
  if (!command || !DEV_COMMAND_WORDS.has(command.word)) return false;
  if (!DEV_PATTERN.test(segment)) return false;
  return !(command.word === 'tmux' && isTmuxPaneLaunch(segment, command.end));
}

process.stdin.on('end', () => {
  try {
    const input = JSON.parse(raw);
    const cmd = String(input.tool_input?.command || '');

    if (process.platform !== 'win32') {
      const segments = collectCheckSegments(cmd);
      const hasBlockedDev = segments.some(isBlockedDevSegment);

      if (hasBlockedDev) {
        console.error('[Hook] BLOCKED: Dev server must run in tmux for log access');
        console.error('[Hook] Use: tmux new-session -d -s dev "npm run dev"');
        console.error('[Hook] Then: tmux attach -t dev');
        process.exit(2);
      }
    }
  } catch {
    // ignore parse errors and pass through
  }

  process.stdout.write(raw);
});
