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

/**
 * Find the end of a shell command segment without scanning beyond `limit`.
 */
function findCommandSegmentEnd(input, start, limit = input.length) {
  let quote = null;
  let escaped = false;

  for (let i = start; i < limit; i++) {
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

  return limit;
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
 * Precompute the positions that follow a comment marker on their current line.
 * This preserves the hook's existing comment heuristic without rescanning a
 * potentially long line for every `git` candidate.
 */
function buildCommentMask(input) {
  const comments = new Uint8Array(input.length);
  let afterCommentMarker = false;
  let quote = null;
  let escaped = false;

  for (let i = 0; i < input.length; i++) {
    const char = input.charAt(i);
    if (char === '\n') {
      afterCommentMarker = false;
      escaped = false;
      continue;
    }

    comments[i] = afterCommentMarker ? 1 : 0;

    if (afterCommentMarker) continue;

    if (escaped) {
      escaped = false;
      continue;
    }

    if (quote) {
      if (quote === '"' && char === '\\') {
        escaped = true;
      } else if (char === quote) {
        quote = null;
      }
      continue;
    }

    if (char === '\\') {
      escaped = true;
      continue;
    }

    if (char === '"' || char === "'") {
      quote = char;
      continue;
    }

    if (char === '#' && (i === 0 || /[\s;&|()]/.test(input.charAt(i - 1)))) {
      const previous = i > 0 ? input.charAt(i - 1) : '';
      if (previous !== '$' && previous !== '\\') afterCommentMarker = true;
    }
  }

  return comments;
}

/**
 * Compute the maximum scan endpoint for characters inside outer quotes and
 * heredoc body lines. The hook deliberately keeps every `git` candidate: quoted
 * data may later be executed by a shell. Bounds only prevent a candidate's flag
 * scan from leaking into unrelated text after its enclosing quote or body line.
 */
function buildScanBoundaries(input) {
  const boundaries = new Int32Array(input.length);
  boundaries.fill(-1);

  const pendingHeredocs = [];
  let quote = null;
  let quoteStart = -1;
  let escaped = false;
  let comment = false;

  for (let i = 0; i < input.length; i++) {
    if ((i === 0 || input.charAt(i - 1) === '\n') && pendingHeredocs.length > 0) {
      const lineEnd = input.indexOf('\n', i);
      const physicalEnd = lineEnd === -1 ? input.length : lineEnd;
      const contentEnd = input.charAt(physicalEnd - 1) === '\r' ? physicalEnd - 1 : physicalEnd;
      const heredoc = pendingHeredocs[0];
      const line = input.slice(i, contentEnd);
      const comparableLine = heredoc.stripTabs ? line.replace(/^\t+/, '') : line;

      if (comparableLine === heredoc.delimiter) {
        pendingHeredocs.shift();
      } else {
        boundaries.fill(contentEnd, i, contentEnd);
      }

      i = physicalEnd;
      continue;
    }

    const char = input.charAt(i);

    if (comment) {
      if (char === '\n') comment = false;
      continue;
    }

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
        boundaries.fill(i, quoteStart + 1, i);
        quote = null;
        quoteStart = -1;
      }
      continue;
    }

    if (char === '\\') {
      escaped = true;
      continue;
    }

    if (char === '"' || char === "'") {
      quote = char;
      quoteStart = i;
      continue;
    }

    if (char === '#' && (i === 0 || /[\s;&|()]/.test(input.charAt(i - 1)))) {
      comment = true;
      continue;
    }

    if (char === '<' && input.charAt(i + 1) === '<' && input.charAt(i + 2) !== '<') {
      const heredocMatch = /^<<(-?)[ \t]*(?:'([^']+)'|"([^"]+)"|([^ \t\r\n;|&()<>]+))/.exec(input.slice(i));
      if (heredocMatch) {
        pendingHeredocs.push({
          delimiter: heredocMatch[2] || heredocMatch[3] || heredocMatch[4],
          stripTabs: heredocMatch[1] === '-',
        });
        i += heredocMatch[0].length - 1;
      }
    }
  }

  if (quote) boundaries.fill(input.length, quoteStart + 1);
  return boundaries;
}

/**
 * Return the enclosing quote or heredoc-line endpoint for a candidate.
 */
function getScanBoundary(boundaries, idx, fallback) {
  const boundary = boundaries[idx];
  return boundary >= 0 ? boundary : fallback;
}

/**
 * Parse the first non-global-option word after a `git` executable token.
 * Git chooses that word as its subcommand, so later words cannot change it.
 */
function findGitSubcommand(input, start, end) {
  let value = '';
  let tokenStart = -1;
  let quote = null;
  let escaped = false;
  let expectOptionValue = false;

  /**
   * Classify a completed word, returning a protected Git subcommand if found.
   */
  function classifyWord() {
    if (tokenStart === -1) return null;

    const completed = { value, start: tokenStart };
    value = '';
    tokenStart = -1;

    if (expectOptionValue) {
      expectOptionValue = false;
      return null;
    }

    if (completed.value.startsWith('-')) {
      if (completed.value === '-c' || completed.value === '-C' ||
          completed.value === '--work-tree' || completed.value === '--git-dir' ||
          completed.value === '--namespace' || completed.value === '--super-prefix') {
        expectOptionValue = true;
      }
      return null;
    }

    return {
      terminal: true,
      command: GIT_COMMANDS_WITH_NO_VERIFY.includes(completed.value) ? completed.value : null,
      start: completed.start,
    };
  }

  for (let i = start; i < end; i++) {
    const char = input.charAt(i);

    if (escaped) {
      if (tokenStart === -1) tokenStart = i - 1;
      value += char;
      escaped = false;
      continue;
    }

    if (quote) {
      if (char === quote) {
        quote = null;
      } else if (quote === '"' && char === '\\') {
        escaped = true;
      } else {
        if (tokenStart === -1) tokenStart = i;
        value += char;
      }
      continue;
    }

    if (char === '"' || char === "'") {
      if (tokenStart === -1) tokenStart = i;
      quote = char;
      continue;
    }

    if (char === '\\') {
      if (tokenStart === -1) tokenStart = i;
      escaped = true;
      continue;
    }

    if (/\s/.test(char) || char === ';' || char === '|' || char === '&') {
      const completed = classifyWord();
      if (completed?.terminal) return completed;
      if (char === ';' || char === '|' || char === '&' || char === '\n') return null;
      continue;
    }

    if (tokenStart === -1) tokenStart = i;
    value += char;
  }

  return classifyWord();
}


/**
 * Find the next contiguous raw `git` token starting from a position.
 */
function findRawGit(input, start) {
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
    if (VALID_BEFORE_GIT.includes(before)) return { idx, len, end: idx + len };
    pos = idx + 1;
  }
  return null;
}

/**
 * Find a shell word assembled through quoting or escapes that evaluates to
 * `git` or `git.exe`. Only words before `end` need inspection because a raw
 * candidate at that position is already known to be earlier.
 */
function findAssembledGit(input, start, end) {
  let value = '';
  let tokenStart = -1;
  let quote = null;
  let escaped = false;

  /**
   * Complete the current word and return it when it evaluates to Git.
   */
  function completeWord(wordEnd) {
    if (tokenStart === -1) return null;
    const normalized = value.toLowerCase();
    const candidate = normalized === 'git' || normalized === 'git.exe'
      ? { idx: tokenStart, len: wordEnd - tokenStart, end: wordEnd }
      : null;
    value = '';
    tokenStart = -1;
    return candidate;
  }

  for (let i = start; i < end; i++) {
    const char = input.charAt(i);

    if (escaped) {
      value += char;
      escaped = false;
      continue;
    }

    if (quote) {
      if (char === quote) {
        quote = null;
      } else if (quote === '"' && char === '\\') {
        escaped = true;
      } else {
        value += char;
      }
      continue;
    }

    if (char === '"' || char === "'") {
      if (tokenStart === -1) tokenStart = i;
      quote = char;
      continue;
    }

    if (char === '\\') {
      if (tokenStart === -1) tokenStart = i;
      escaped = true;
      continue;
    }

    if (/\s/.test(char) || char === ';' || char === '|' || char === '&') {
      const candidate = completeWord(i);
      if (candidate) return candidate;
      continue;
    }

    if (tokenStart === -1) tokenStart = i;
    value += char;
  }

  return completeWord(end);
}

/**
 * Find the next raw or shell-assembled Git executable token.
 */
function findGit(input, start) {
  const rawCandidate = findRawGit(input, start);
  const assembledCandidate = findAssembledGit(
    input,
    start,
    rawCandidate ? rawCandidate.idx : input.length
  );
  return assembledCandidate || rawCandidate;
}

/**
 * Normalize the shell word containing `idx`, including adjacent quoted and
 * escaped fragments, and return its raw endpoint.
 */
function assembleShellWordContaining(input, idx) {
  let wordStart = idx;
  while (wordStart > 0 && !/[\s;&|]/.test(input.charAt(wordStart - 1))) {
    wordStart--;
  }

  let value = '';
  let quote = null;
  let escaped = false;
  let wordEnd = input.length;

  for (let i = wordStart; i < input.length; i++) {
    const char = input.charAt(i);

    if (escaped) {
      value += char;
      escaped = false;
      continue;
    }

    if (quote) {
      if (char === quote) {
        quote = null;
      } else if (quote === '"' && char === '\\') {
        escaped = true;
      } else {
        value += char;
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

    if (/\s/.test(char) || char === ';' || char === '|' || char === '&') {
      wordEnd = i;
      break;
    }

    value += char;
  }

  return { value: value.toLowerCase(), end: wordEnd };
}

/**
 * Detect which git subcommand (commit, push, etc.) is being invoked.
 * Returns { command, offset } where offset is the position right after the
 * subcommand keyword, so callers can scope flag checks to only that portion.
 */
function detectGitCommand(input, boundaries, comments, start = 0) {
  while (start < input.length) {
    const git = findGit(input, start);
    if (!git) return null;

    if (comments[git.idx]) {
      start = git.end;
      continue;
    }

    const rawGitEnd = git.end;
    const enclosingEnd = getScanBoundary(boundaries, git.idx, input.length);
    const quotedExecutable = enclosingEnd === rawGitEnd;
    const assembledWord = quotedExecutable
      ? assembleShellWordContaining(input, git.idx)
      : null;
    const assembledExecutable = assembledWord &&
      (assembledWord.value === 'git' || assembledWord.value === 'git.exe');

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
        scanEnd,
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
  const boundaries = buildScanBoundaries(input);
  const comments = buildCommentMask(input);
  let start = 0;

  while (start < input.length) {
    const detected = detectGitCommand(input, boundaries, comments, start);
    if (!detected) return { blocked: false };

    const { command: gitCommand, offset } = detected;

    if (hasHooksPathOverride(input, detected)) {
      return {
        blocked: true,
        reason: `BLOCKED: Overriding core.hooksPath is not allowed with git ${gitCommand}. Git hooks must not be bypassed.`,
      };
    }

    if (hasNoVerifyFlag(input, gitCommand, offset, detected.scanEnd)) {
      return {
        blocked: true,
        reason: `BLOCKED: --no-verify flag is not allowed with git ${gitCommand}. Git hooks must not be bypassed.`,
      };
    }

    start = findCommandSegmentEnd(input, offset, detected.scanEnd) + 1;
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
