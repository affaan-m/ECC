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

const MAX_STDIN = 1024 * 1024;
let raw = '';

/**
 * Git commands that support the --no-verify flag.
 */
const GIT_COMMANDS_WITH_NO_VERIFY = [
  'commit',
  'push',
  'merge',
  'cherry-pick',
  'rebase',
  'am',
];

/**
 * Characters that can appear immediately before 'git' in a command string.
 */
const VALID_BEFORE_GIT = ' \t\n\r;&|$`(<{!"\']/.~\\';

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
  '--pathspec-from-file',
]);

const COMMIT_OPTIONS_WITH_INLINE_VALUE = [
  '--message=',
  '--file=',
  '--reuse-message=',
  '--reedit-message=',
  '--author=',
  '--date=',
  '--template=',
  '--fixup=',
  '--squash=',
  '--pathspec-from-file=',
];

// Short options that take a value. When seen as part of a combined
// short-option token (e.g. -tn), git's parser treats the rest of the
// token as the option's value (template path 'n' here), so the scanner
// must stop at this character — anything after it is the inline value,
// not another flag.
const COMMIT_SHORT_OPTIONS_WITH_VALUE = new Set(['m', 'F', 'C', 'c', 't']);

function tokenizeShellWords(input, start = 0, end = input.length) {
  const tokens = [];
  let value = '';
  let tokenStart = null;
  let quote = null;
  let escaped = false;

  function beginToken(index) {
    if (tokenStart === null) {
      tokenStart = index;
    }
  }

  function pushToken(index) {
    if (tokenStart === null) {
      return;
    }

    tokens.push({
      value,
      start: tokenStart,
      end: index,
    });
    value = '';
    tokenStart = null;
  }

  for (let i = start; i < end; i++) {
    const char = input.charAt(i);

    if (escaped) {
      beginToken(i - 1);
      value += char;
      escaped = false;
      continue;
    }

    if (quote) {
      if (char === quote) {
        quote = null;
        continue;
      }

      if (quote === '"' && char === '\\') {
        beginToken(i);
        escaped = true;
        continue;
      }

      beginToken(i);
      value += char;
      continue;
    }

    if (char === '"' || char === "'") {
      beginToken(i);
      quote = char;
      continue;
    }

    if (char === '\\') {
      beginToken(i);
      escaped = true;
      continue;
    }

    if (/\s/.test(char)) {
      pushToken(i);
      continue;
    }

    beginToken(i);
    value += char;
  }

  if (escaped) {
    value += '\\';
  }
  pushToken(end);

  return tokens;
}

function findCommandSegmentEnd(input, start) {
  let quote = null;
  let escaped = false;

  for (let i = start; i < input.length; i++) {
    const char = input.charAt(i);

    if (escaped) {
      escaped = false;
      continue;
    }

    if (quote) {
      if (quote === '"' && char === '\\') {
        escaped = true;
        continue;
      }
      if (char === quote) {
        quote = null;
      }
      continue;
    }

    if (char === '"' || char === "'") {
      quote = char;
      continue;
    }

    if (char === '\\') {
      escaped = true;
      continue;
    }

    if (char === ';' || char === '|' || char === '&' || char === '\n') {
      return i;
    }
  }

  return input.length;
}

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

function getCommitShortValueOption(value) {
  if (!value.startsWith('-') || value.startsWith('--') || value === '-') {
    return null;
  }

  const options = value.slice(1);
  for (let i = 0; i < options.length; i++) {
    if (COMMIT_SHORT_OPTIONS_WITH_VALUE.has(options.charAt(i))) {
      return {
        consumesNextValue: i === options.length - 1,
        containsInlineValue: i < options.length - 1,
      };
    }
  }

  return null;
}

function isCommitNoVerifyShortFlag(value) {
  return value === '-n' || /^-n[a-zA-Z]/.test(value);
}

/**
 * Check if a position in the input is inside a shell comment.
 */
function isInComment(input, idx) {
  const lineStart = input.lastIndexOf('\n', idx - 1) + 1;
  const before = input.slice(lineStart, idx);
  for (let i = 0; i < before.length; i++) {
    if (before.charAt(i) === '#') {
      const prev = i > 0 ? before.charAt(i - 1) : '';
      if (prev !== '$' && prev !== '\\') return true;
    }
  }
  return false;
}

/**
 * Find the next 'git' token in the input starting from a position.
 */
function findGit(input, start) {
  let pos = start;
  while (pos < input.length) {
    const idx = input.indexOf('git', pos);
    if (idx === -1) return null;

    const isExe = input.slice(idx + 3, idx + 7).toLowerCase() === '.exe';
    const len = isExe ? 7 : 3;
    const after = input[idx + len] || ' ';
    if (!/[\s"']/.test(after)) {
      pos = idx + 1;
      continue;
    }

    const before = idx > 0 ? input[idx - 1] : ' ';
    if (VALID_BEFORE_GIT.includes(before)) return { idx, len };
    pos = idx + 1;
  }
  return null;
}

/**
 * Detect which git subcommand (commit, push, etc.) is being invoked.
 * Returns { command, offset } where offset is the position right after the
 * subcommand keyword, so callers can scope flag checks to only that portion.
 */
function detectGitCommand(input, start = 0) {
  while (start < input.length) {
    const git = findGit(input, start);
    if (!git) return null;

    if (isInComment(input, git.idx)) {
      start = git.idx + git.len;
      continue;
    }

    // Find the first matching subcommand token after "git".
    // We pick the one closest to "git" so that argument values like
    // "git push origin commit" don't misclassify "commit" as the subcommand.
    let bestCmd = null;
    let bestIdx = Infinity;

    for (const cmd of GIT_COMMANDS_WITH_NO_VERIFY) {
      let searchPos = git.idx + git.len;
      while (searchPos < input.length) {
        const cmdIdx = input.indexOf(cmd, searchPos);
        if (cmdIdx === -1) break;

        const before = cmdIdx > 0 ? input[cmdIdx - 1] : ' ';
        const after = input[cmdIdx + cmd.length] || ' ';
        if (!/\s/.test(before)) { searchPos = cmdIdx + 1; continue; }
        if (!/[\s;&#|>)\]}"']/.test(after) && after !== '') { searchPos = cmdIdx + 1; continue; }
        if (/[;|]/.test(input.slice(git.idx + git.len, cmdIdx))) break;
        if (isInComment(input, cmdIdx)) { searchPos = cmdIdx + 1; continue; }

        // Verify this token is the first non-flag word after "git" — i.e. the
        // actual subcommand, not an argument value to a different subcommand.
        const gap = input.slice(git.idx + git.len, cmdIdx);
        const tokens = gap.trim().split(/\s+/).filter(Boolean);
        // Every token before the candidate must be a flag or a flag argument.
        // Git global flags like -c take a value argument (e.g. -c key=value).
        let onlyFlagsAndArgs = true;
        let expectFlagArg = false;
        for (const t of tokens) {
          if (expectFlagArg) { expectFlagArg = false; continue; }
          if (t.startsWith('-')) {
            // -c is a git global flag that takes the next token as its argument
            if (t === '-c' || t === '-C' || t === '--work-tree' || t === '--git-dir' ||
                t === '--namespace' || t === '--super-prefix') {
              expectFlagArg = true;
            }
            continue;
          }
          onlyFlagsAndArgs = false;
          break;
        }
        if (!onlyFlagsAndArgs) { searchPos = cmdIdx + 1; continue; }

        if (cmdIdx < bestIdx) {
          bestIdx = cmdIdx;
          bestCmd = cmd;
        }
        break;
      }
    }

    if (bestCmd) {
      return {
        command: bestCmd,
        offset: bestIdx + bestCmd.length,
        gitStart: git.idx,
        gitEnd: git.idx + git.len,
        commandStart: bestIdx,
      };
    }

    start = git.idx + git.len;
  }
  return null;
}

/**
 * Check if the input contains a --no-verify flag for a specific git command.
 * Only inspects the portion of the input starting at `offset` (the position
 * right after the detected subcommand keyword) so that flags belonging to
 * earlier commands in a chain are not falsely matched.
 */
function hasNoVerifyFlag(input, command, offset) {
  const segmentEnd = findCommandSegmentEnd(input, offset);
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

    if (value === '--no-verify') return true;

    // For commit, -n is shorthand for --no-verify.
    if (command === 'commit' && isCommitNoVerifyShortFlag(value)) {
      return true;
    }
  }

  return false;
}

/**
 * Check if the input contains a -c core.hooksPath= override.
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
 */
function checkCommand(input) {
  let start = 0;

  while (start < input.length) {
    const detected = detectGitCommand(input, start);
    if (!detected) return { blocked: false };

    const { command: gitCommand, offset } = detected;

    if (hasHooksPathOverride(input, detected)) {
      return {
        blocked: true,
        reason: `BLOCKED: Overriding core.hooksPath is not allowed with git ${gitCommand}. Git hooks must not be bypassed.`,
      };
    }

    if (hasNoVerifyFlag(input, gitCommand, offset)) {
      return {
        blocked: true,
        reason: `BLOCKED: --no-verify flag is not allowed with git ${gitCommand}. Git hooks must not be bypassed.`,
      };
    }

    start = findCommandSegmentEnd(input, offset) + 1;
  }

  return { blocked: false };
}

/**
 * Extract the command string from hook input (JSON or plain text).
 */
function extractCommand(rawInput) {
  const trimmed = rawInput.trim();
  if (!trimmed.startsWith('{')) return trimmed;

  try {
    const parsed = JSON.parse(trimmed);
    if (typeof parsed !== 'object' || parsed === null) return trimmed;

    // Claude Code format: { tool_input: { command: "..." } }
    const cmd = parsed.tool_input?.command;
    if (typeof cmd === 'string') return cmd;

    // Generic JSON formats
    for (const key of ['command', 'cmd', 'input', 'shell', 'script']) {
      if (typeof parsed[key] === 'string') return parsed[key];
    }

    return trimmed;
  } catch {
    return trimmed;
  }
}

/**
 * Exportable run() for in-process execution via run-with-flags.js.
 */
function run(rawInput) {
  const command = extractCommand(rawInput);
  const result = checkCommand(command);

  if (result.blocked) {
    return {
      exitCode: 2,
      stderr: result.reason,
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
