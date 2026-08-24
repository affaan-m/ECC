/**
 * Shared dev-server command classification.
 *
 * Two hooks have to agree on what counts as "starting a dev server":
 * `pre-bash-dev-server-block.js` refuses it outside tmux, and
 * `auto-tmux-dev.js` rewrites it into a tmux session. They used to carry a
 * copy of the same raw-text regex each, with a comment in both asking the
 * other to stay byte-identical — so widening one silently left the other
 * behind (a command the blocker refuses but the wrapper never detaches is the
 * worst of both). The classification lives here now, once.
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
 * Two shapes, because the managers do not agree:
 *
 *   - with a `run` keyword, the script is the token right after it. Anything
 *     further along is an ARGUMENT to that script: `npm run build dev` runs
 *     build, and `npm run run dev` runs a script called `run`.
 *   - without one (`pnpm dev`, `yarn dev`, `bun dev`), the script is the first
 *     bare token.
 *
 * Anchoring on the `run` keyword is also what makes npm's config surface
 * harmless. npm takes ANY config key as `--key value`, so an unknown option's
 * value lands in the token stream — reading the first bare token made
 * `npm --userconfig /tmp/npmrc run dev` resolve to `/tmp/npmrc` and let the
 * dev server through. Reading the token after `run` steps over it without
 * needing to know that `--userconfig` takes a value.
 *
 * Known value-taking options are still consumed, so `pnpm --filter dev run
 * build` is a filter named dev rather than the dev script.
 *
 * Residual gap, stated rather than hidden: the implicit form combined with an
 * unknown value-taking option (`pnpm --unknown value dev`) has no `run` to
 * anchor on, so `value` reads as the script name. pnpm/yarn/bun spell their
 * options `--flag=value` in practice, and npm — the one manager with an
 * open-ended config surface — has no implicit form at all.
 */
function getRunScriptName(segment, managerWord) {
  let index = 0;
  let seenManager = false;
  let seenRunKeyword = false;
  let skipNextValue = false;
  // The implicit-form candidate. Held rather than returned, because a `run`
  // further along means this token was an option value, not the script.
  let implicitScript = null;

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
    if (token === '--') break;

    if (isOptionToken(token)) {
      if (MANAGER_OPTIONS_WITH_VALUE.has(token)) skipNextValue = true;
      continue;
    }

    if (!seenRunKeyword && RUN_KEYWORDS.has(token.toLowerCase())) {
      seenRunKeyword = true;
      continue;
    }

    // After a `run` keyword this token IS the script it names.
    if (seenRunKeyword) return token;

    if (implicitScript === null) implicitScript = token;
  }

  return implicitScript;
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

function isDevServerSegment(segment) {
  const commandWord = getLeadingCommandWord(segment);
  if (!commandWord || !DEV_COMMAND_WORDS.has(commandWord)) return false;
  if (TMUX_LAUNCHER.test(segment)) return false;
  if (!PACKAGE_MANAGERS.has(commandWord)) return false;

  const script = getRunScriptName(segment, commandWord);
  return Boolean(script) && DEV_SCRIPT_NAME.test(script);
}

/** True when any segment of `command` starts a dev server. */
function isDevServerCommand(command) {
  return collectCheckSegments(String(command || '')).some(isDevServerSegment);
}

module.exports = {
  collectCheckSegments,
  isDevServerCommand,
  isDevServerSegment
};
