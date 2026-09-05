#!/usr/bin/env node
/**
 * PreToolUse Hook: Block --no-verify flag
 *
 * Blocks git hook-bypass flags (--no-verify, -c core.hooksPath=) to protect
 * pre-commit, commit-msg, and pre-push hooks from being skipped by AI agents.
 *
 * Replaces the previous npx-based invocation that failed in pnpm-only projects
 * (EBADDEVENGINES) and could not be disabled via ECC_DISABLED_HOOKS.
 *
 * Exit codes:
 *   0 = allow (not a git command or no bypass flags)
 *   2 = block (bypass flag detected)
 */

'use strict';

const { tokenizeShellWords, findCommandSegmentEnd, buildScanBoundaries, getScanBoundary, findGitSubcommand, findGit, assembleShellWordContaining } = require('./lib/shell-scan');

const MAX_STDIN = 1024 * 1024;
let raw = '';

// Git config section and variable names are case-insensitive
// (subsection names are case-sensitive but core.hooksPath has none),
// so we normalize the candidate token to lowercase before matching.
// See https://git-scm.com/docs/git-config — "The variable names are
// case-insensitive."
const GIT_CONFIG_KEY_PREFIX = 'core.hookspath=';

const COMMIT_OPTIONS_WITH_VALUE = new Set([
  '-m',
  '--message',
  '-F',
  '--file',
  '-C',
  '--reuse-message',
  '-c',
  '--reedit-message',
  '--author',
  '--date',
  '--template',
  '--fixup',
  '--squash',
  '--pathspec-from-file'
]);

const COMMIT_OPTIONS_WITH_INLINE_VALUE = ['--message=', '--file=', '--reuse-message=', '--reedit-message=', '--author=', '--date=', '--template=', '--fixup=', '--squash=', '--pathspec-from-file='];

// Short options that take a value. When seen as part of a combined
// short-option token (e.g. -tn), git's parser treats the rest of the
// token as the option's value (template path 'n' here), so the scanner
// must stop at this character — anything after it is the inline value,
// not another flag.
const COMMIT_SHORT_OPTIONS_WITH_VALUE = new Set(['m', 'F', 'C', 'c', 't']);

/**
 * Return true when a commit option consumes the following token as its value.
 *
 * @param {string} value
 * @returns {boolean}
 */
function commitOptionConsumesNextValue(value) {
  if (isCommitNoVerifyShortFlag(value)) {
    return false;
  }

  if (COMMIT_OPTIONS_WITH_VALUE.has(value)) {
    return true;
  }

  const shortValueOption = getCommitShortValueOption(value);
  return Boolean(shortValueOption && shortValueOption.consumesNextValue);
}

/**
 * Return true when a commit option already carries its value in the same token.
 *
 * @param {string} value
 * @returns {boolean}
 */
function commitOptionContainsInlineValue(value) {
  if (isCommitNoVerifyShortFlag(value)) {
    return false;
  }

  if (COMMIT_OPTIONS_WITH_INLINE_VALUE.some(prefix => value.startsWith(prefix))) {
    return true;
  }

  const shortValueOption = getCommitShortValueOption(value);
  return Boolean(shortValueOption && shortValueOption.containsInlineValue);
}

/**
 * Classify a combined short-option token that includes a value-taking option.
 *
 * @param {string} value
 * @returns {{consumesNextValue: boolean, containsInlineValue: boolean}|null}
 */
function getCommitShortValueOption(value) {
  if (!value.startsWith('-') || value.startsWith('--') || value === '-') {
    return null;
  }

  const options = value.slice(1);
  for (let i = 0; i < options.length; i++) {
    if (COMMIT_SHORT_OPTIONS_WITH_VALUE.has(options.charAt(i))) {
      return {
        consumesNextValue: i === options.length - 1,
        containsInlineValue: i < options.length - 1
      };
    }
  }

  return null;
}

/**
 * Return true when a token is commit's `-n` / `--no-verify` short form.
 *
 * @param {string} value
 * @returns {boolean}
 */
function isCommitNoVerifyShortFlag(value) {
  return value === '-n' || /^-n[a-zA-Z]/.test(value);
}

/**
 * Detect which git subcommand (commit, push, etc.) is being invoked.
 * Returns { command, offset } where offset is the position right after the
 * subcommand keyword, so callers can scope flag checks to only that portion.
 *
 * @param {string} input
 * @param {Int32Array} boundaries
 * @param {Uint8Array} comments
 * @param {number} [start=0]
 * @returns {{command: string, offset: number, gitStart: number, gitEnd: number, commandStart: number, scanEnd: number}|null}
 */
function detectGitCommand(input, boundaries, comments, start = 0) {
  while (start < input.length) {
    const git = findGit(input, start);
    if (!git) {
      return null;
    }

    if (comments[git.idx]) {
      start = git.end;
      continue;
    }

    const rawGitEnd = git.end;
    const enclosingEnd = getScanBoundary(boundaries, git.idx, input.length);
    const quotedExecutable = enclosingEnd === rawGitEnd;
    const assembledWord = quotedExecutable ? assembleShellWordContaining(input, git.idx) : null;
    const assembledExecutable = assembledWord && (assembledWord.value === 'git' || assembledWord.value === 'git.exe');

    if (quotedExecutable && !assembledExecutable) {
      start = git.end;
      continue;
    }

    const gitEnd = assembledExecutable ? assembledWord.end : rawGitEnd;
    const scanEnd = quotedExecutable ? input.length : enclosingEnd;

    const subcommand = findGitSubcommand(input, gitEnd, scanEnd);
    if (subcommand?.command) {
      return {
        command: subcommand.command,
        offset: subcommand.start + subcommand.command.length,
        gitStart: git.idx,
        gitEnd,
        commandStart: subcommand.start,
        scanEnd
      };
    }

    start = git.end;
  }
  return null;
}

/**
 * Check if the input contains a --no-verify flag for a specific git command.
 * Only inspects the portion of the input starting at `offset` (the position
 * right after the detected subcommand keyword) so that flags belonging to
 * earlier commands in a chain are not falsely matched.
 *
 * @param {string} input
 * @param {string} command
 * @param {number} offset
 * @param {number} scanEnd
 * @returns {boolean}
 */
function hasNoVerifyFlag(input, command, offset, scanEnd) {
  const segmentEnd = findCommandSegmentEnd(input, offset, scanEnd);
  const tokens = tokenizeShellWords(input, offset, segmentEnd);
  let skipNext = false;

  for (const token of tokens) {
    const value = token.value;

    if (skipNext) {
      skipNext = false;
      continue;
    }

    if (value === '--') {
      break;
    }

    if (command === 'commit') {
      if (commitOptionConsumesNextValue(value)) {
        skipNext = true;
        continue;
      }

      if (commitOptionContainsInlineValue(value)) {
        continue;
      }
    }

    if (value === '--no-verify') {
      return true;
    }

    // For commit, -n is shorthand for --no-verify.
    if (command === 'commit' && isCommitNoVerifyShortFlag(value)) {
      return true;
    }
  }

  return false;
}

/**
 * Check if the input contains a -c core.hooksPath= override.
 *
 * @param {string} input
 * @param {{gitEnd: number, commandStart: number}} detected
 * @returns {boolean}
 */
function hasHooksPathOverride(input, detected) {
  const tokens = tokenizeShellWords(input, detected.gitEnd, detected.commandStart);

  for (let i = 0; i < tokens.length; i++) {
    const value = tokens[i].value;
    // Git config section + variable names are case-insensitive, so a
    // bypass attempt like `core.HOOKSPATH=...` or `core.hookspath=...`
    // must compare against the lowercased token.
    const lowered = value.toLowerCase();

    if (value === '-c') {
      const next = tokens[i + 1] && tokens[i + 1].value;
      if (typeof next === 'string' && next.toLowerCase().startsWith(GIT_CONFIG_KEY_PREFIX)) {
        return true;
      }
      i++;
      continue;
    }

    if (lowered.startsWith(`-c${GIT_CONFIG_KEY_PREFIX}`)) {
      return true;
    }
  }

  return false;
}

/**
 * Check a command string for git hook bypass attempts.
 *
 * @param {string} input
 * @returns {{blocked: boolean, reason?: string}}
 */
function checkCommand(input) {
  const { boundaries, comments } = buildScanBoundaries(input);
  let start = 0;

  while (start < input.length) {
    const detected = detectGitCommand(input, boundaries, comments, start);
    if (!detected) {
      return { blocked: false };
    }

    const { command: gitCommand, offset } = detected;

    if (hasHooksPathOverride(input, detected)) {
      return {
        blocked: true,
        reason: `BLOCKED: Overriding core.hooksPath is not allowed with git ${gitCommand}. Git hooks must not be bypassed.`
      };
    }

    if (hasNoVerifyFlag(input, gitCommand, offset, detected.scanEnd)) {
      return {
        blocked: true,
        reason: `BLOCKED: --no-verify flag is not allowed with git ${gitCommand}. Git hooks must not be bypassed.`
      };
    }

    start = findCommandSegmentEnd(input, offset, detected.scanEnd) + 1;
  }

  return { blocked: false };
}

/**
 * Extract the command string from hook input (JSON or plain text).
 *
 * @param {string} rawInput
 * @returns {string}
 */
function extractCommand(rawInput) {
  const trimmed = rawInput.trim();
  if (!trimmed.startsWith('{')) {
    return trimmed;
  }

  try {
    const parsed = JSON.parse(trimmed);
    if (typeof parsed !== 'object' || parsed === null) {
      return trimmed;
    }

    // Claude Code format: { tool_input: { command: "..." } }
    const cmd = parsed.tool_input?.command;
    if (typeof cmd === 'string') {
      return cmd;
    }

    // Generic JSON formats
    for (const key of ['command', 'cmd', 'input', 'shell', 'script']) {
      if (typeof parsed[key] === 'string') {
        return parsed[key];
      }
    }

    return trimmed;
  } catch {
    return trimmed;
  }
}

/**
 * Exportable run() for in-process execution via run-with-flags.js.
 *
 * @param {string} rawInput
 * @returns {{exitCode: number, stderr?: string}}
 */
function run(rawInput) {
  const command = extractCommand(rawInput);
  const result = checkCommand(command);

  if (result.blocked) {
    return {
      exitCode: 2,
      stderr: result.reason
    };
  }

  return { exitCode: 0 };
}

module.exports = { run };

// Stdin fallback for spawnSync execution — only when invoked directly, not via require()
if (require.main === module) {
  process.stdin.setEncoding('utf8');
  process.stdin.on('data', chunk => {
    if (raw.length < MAX_STDIN) {
      const remaining = MAX_STDIN - raw.length;
      raw += chunk.substring(0, remaining);
    }
  });

  process.stdin.on('end', () => {
    const command = extractCommand(raw);
    const result = checkCommand(command);

    if (result.blocked) {
      process.stderr.write(result.reason + '\n');
      process.exit(2);
    }

    process.stdout.write(raw);
  });
}
