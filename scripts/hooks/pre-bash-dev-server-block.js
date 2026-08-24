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

      if (ch === '\\' && quote === '"' && index + 1 < input.length) {
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

function getLeadingCommandWord(segment) {
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

    return normalizedToken;
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

const TMUX_LAUNCHER = /^\s*tmux\s+(new|new-session|new-window|split-window)\b/;
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
const PACKAGE_MANAGERS = new Set(['npm', 'pnpm', 'yarn', 'bun']);
const RUN_KEYWORDS = new Set(['run', 'run-script']);
// Options that consume the following token, so their value is never mistaken
// for the script name (`yarn --cwd app dev` must read `dev`, not `app`).
const MANAGER_OPTIONS_WITH_VALUE = new Set([
  '--prefix',
  '--cwd',
  '-C',
  '--dir',
  '-d',
  '--workspace',
  '-w',
  '--filter',
  '-F',
  '--package',
  '-p',
  '--config',
  '-c'
]);

/**
 * The script a package manager is being asked to run, or null.
 *
 * Reads the tokens after the manager word: skips options (and the value of an
 * option known to take one), skips a `run` / `run-script` keyword, stops at a
 * `--` separator, and returns the first remaining token.
 */
function getRunScriptName(segment, managerWord) {
  let index = 0;
  let seenManager = false;
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

    if (!seenManager) {
      if (normalizeCommandWord(token) === managerWord) seenManager = true;
      continue;
    }

    // Everything after `--` is an argument to the script, not the script name.
    if (token === '--') return null;

    if (isOptionToken(token)) {
      if (MANAGER_OPTIONS_WITH_VALUE.has(token)) skipNextValue = true;
      continue;
    }

    if (RUN_KEYWORDS.has(token.toLowerCase())) continue;

    return token;
  }

  return null;
}

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

function isBlockedDevSegment(segment) {
  const commandWord = getLeadingCommandWord(segment);
  if (!commandWord || !DEV_COMMAND_WORDS.has(commandWord)) return false;
  if (TMUX_LAUNCHER.test(segment)) return false;
  if (!PACKAGE_MANAGERS.has(commandWord)) return false;

  const script = getRunScriptName(segment, commandWord);
  return Boolean(script) && DEV_SCRIPT_NAME.test(script);
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
