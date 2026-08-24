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

// core.hooksPath is the direct spelling. `include.path` reaches the same place
// indirectly: git reads the named file and applies everything in it, so a config
// that sets core.hooksPath redirects the hooks just as well. Verified against
// git 2.51 in a repo whose pre-commit hook echoes a marker:
//
//   git -c include.path=evil.conf commit -m x   -> commit succeeds, marker absent
//   git --config-env=include.path=EVIL config --get core.hooksPath
//                                              -> prints the redirected path
//
// includeIf.<condition>.path is the same mechanism behind a condition. It is
// covered on that basis, NOT on a reproduction: on git 2.51 a conditional include
// passed on the command line never matched in testing (gitdir:**/ , an absolute
// gitdir, and gitdir/i all left core.hooksPath untouched), so it may well be inert
// there. Nothing legitimate passes it to `git commit`, so covering it costs
// nothing and closes the hole if that ever changes.
const GIT_INCLUDE_KEY_PREFIX = 'include.path=';
const GIT_INCLUDE_IF_KEY_PATTERN = /^includeif\..*\.path=/;

/**
 * True when a lowercased `key=value` config setting redirects where git looks
 * for hooks, whether directly or through an included file.
 */
// tokenizeShellWords strips quotes; it does not run the shell. So `$(printf commit)`
// arrives verbatim while the shell hands git a plain `commit`. Anything that can
// still change under expansion is opaque to this guard and must not be read as a
// literal. Deliberately narrow: only the subcommand slot and the KEY half of a
// config setting are treated this way, so `git commit -m "$(cat msg)"` and
// `git -c user.email=$EMAIL commit` stay allowed.
const SHELL_EXPANSION_PATTERN = /\$\(|`|\$\{|\$[A-Za-z_]/;

function hasShellExpansion(value) {
  return SHELL_EXPANSION_PATTERN.test(value);
}

/**
 * True when a `-c`/`--config-env` argument hides WHICH key it sets. The value
 * half may expand freely — it cannot turn user.name into core.hooksPath — but a
 * dynamic key half can be anything, including a hooks redirect.
 */
function hasOpaqueConfigKey(setting) {
  const equals = setting.indexOf('=');
  return hasShellExpansion(equals === -1 ? setting : setting.slice(0, equals));
}

function isHooksRedirectSetting(loweredSetting) {
  return loweredSetting.startsWith(GIT_CONFIG_KEY_PREFIX)
    || loweredSetting.startsWith(GIT_INCLUDE_KEY_PREFIX)
    || GIT_INCLUDE_IF_KEY_PATTERN.test(loweredSetting);
}

// Git global options that take their value as the NEXT token. If one of these
// is not listed, the value token looks like a bare word to the subcommand
// scanner, which then decides the `commit`/`push` after it cannot be the
// subcommand — and the whole guard goes blind for that command, including an
// explicit --no-verify.
//
// `--config-env=<name>=<envvar>` reads a config value out of the environment
// and is therefore a second spelling of `-c` for hooksPath purposes:
//   MYVAR=/dev/null git --config-env=core.hooksPath=MYVAR commit
// git accepts it in both the `=` and space-separated forms. It does NOT accept
// an abbreviation of the option itself (`--config-en=` is rejected), so exact
// matching is enough here.
const GIT_GLOBAL_OPTIONS_WITH_VALUE = new Set([
  '-c',
  '-C',
  '--config-env',
  '--work-tree',
  '--git-dir',
  '--namespace',
  '--super-prefix',
]);

// Global options that can set core.hooksPath, in their `<option> <key>=<value>`
// and `<option>=<key>=<value>` spellings.
const GIT_CONFIG_SETTING_OPTIONS = ['-c', '--config-env'];

// Stands in for a subcommand the shell will produce that we cannot read.
const DYNAMIC_COMMAND = '<shell expansion>';

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

/**
 * `-n` means --no-verify to `git commit` but "max count" to log/show/diff, so with
 * the subcommand hidden behind an expansion it is ambiguous. The count spellings
 * are safe to exempt, checked against git 2.51:
 *
 *   git log -n 5        ok          git commit -n 5   error: pathspec '5' did not match
 *   git log -n5         ok          git commit -n5    error: unknown switch `5'
 *
 * `-n<digits>` git commit rejects outright, so it can never be a bypass. `-n <digits>`
 * it reads as a pathspec, which fails unless a file with that exact numeric name
 * exists — the one residual case, and far narrower than blocking every `git $SUB -n 5`.
 * The unambiguous spellings are untouched: `git $SUB --no-verify` and `git $SUB -n -m x`
 * are still blocked.
 */
function isAmbiguousCountFlag(value, nextToken) {
  if (/^-n\d+$/.test(value)) {
    return true;
  }
  return value === '-n' && typeof nextToken === 'string' && /^\d+$/.test(nextToken);
}

function isCommitNoVerifyShortFlag(value) {
  if (!value.startsWith('-') || value.startsWith('--') || value === '-') {
    return false;
  }

  // Short options cluster, so -n need not lead: `git commit -an` is -a plus -n
  // and bypasses the hooks just as `-n` does. Anchoring on the first character
  // let -an, -sn and -vn through.
  //
  // Scanning stops at a value-taking option because that option swallows the
  // rest of the cluster as its inline value — the n in `-mn` is message text,
  // not a flag.
  const options = value.slice(1);
  for (let i = 0; i < options.length; i++) {
    const option = options.charAt(i);
    if (option === 'n') return true;
    if (COMMIT_SHORT_OPTIONS_WITH_VALUE.has(option)) return false;
  }

  return false;
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

    // The subcommand is the first non-flag token after "git". Tokenizing rather
    // than splitting raw text matters: a quoted global option keeps its quotes
    // under a plain split, so `git "-c" "core.hooksPath=/dev/null" commit` and
    // `git "--config-env=core.hooksPath=MYVAR" commit` read as a bare word in
    // subcommand position and the whole command escaped inspection. Verified
    // against git 2.51: the shell strips those quotes, so git sees the option.
    const segmentEnd = findCommandSegmentEnd(input, git.idx + git.len);
    const tokens = tokenizeShellWords(input, git.idx + git.len, segmentEnd);

    let bestCmd = null;
    let bestIdx = Infinity;
    let bestEnd = Infinity;
    let dynamicCommand = false;
    let expectFlagArg = false;

    for (const token of tokens) {
      if (expectFlagArg) { expectFlagArg = false; continue; }

      if (token.value.startsWith('-')) {
        // These git global flags take the next token as their argument, so that
        // token must not be mistaken for the subcommand position.
        if (GIT_GLOBAL_OPTIONS_WITH_VALUE.has(token.value)) {
          expectFlagArg = true;
        }
        continue;
      }

      // Whatever sits here occupies the subcommand slot; if it is not one we
      // guard, there is no guarded subcommand in this segment.
      if (hasShellExpansion(token.value) && !isInComment(input, token.start)) {
        // Unknown subcommand: keep inspecting rather than block outright, so
        // `git $CMD status` is fine and `git "$(printf commit)" --no-verify` is not.
        bestCmd = DYNAMIC_COMMAND;
        bestIdx = token.start;
        bestEnd = token.end;
        dynamicCommand = true;
      } else if (GIT_COMMANDS_WITH_NO_VERIFY.includes(token.value) && !isInComment(input, token.start)) {
        bestCmd = token.value;
        bestIdx = token.start;
        // token.end, not bestIdx + length: for a quoted subcommand the two differ
        // by the quote characters, and a short offset leaves the closing quote in
        // the flag scan's first token.
        bestEnd = token.end;
      }
      break;
    }

    if (bestCmd) {
      return {
        command: bestCmd,
        dynamicCommand,
        offset: bestEnd,
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
function hasNoVerifyFlag(input, command, offset, subcommandUnknown = false) {
  const segmentEnd = findCommandSegmentEnd(input, offset);
  const tokens = tokenizeShellWords(input, offset, segmentEnd);
  let skipNext = false;

  for (let i = 0; i < tokens.length; i++) {
    const token = tokens[i];
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
      // With the subcommand expanded by the shell we cannot know it is commit, and
      // `git $SUB -n 5` is an ordinary `git log -n 5`. Only the count spellings are
      // exempt; --no-verify and a bare -n still block.
      if (subcommandUnknown && isAmbiguousCountFlag(value, tokens[i + 1] && tokens[i + 1].value)) {
        continue;
      }
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

    // `<option> core.hooksPath=...` — the key/value is the next token.
    if (GIT_CONFIG_SETTING_OPTIONS.includes(value)) {
      const next = tokens[i + 1] && tokens[i + 1].value;
      if (typeof next === 'string') {
        if (isHooksRedirectSetting(next.toLowerCase())) {
          return true;
        }
        if (hasOpaqueConfigKey(next)) {
          return true;
        }
      }
      i++;
      continue;
    }

    // `-ccore.hooksPath=...` (short option, no space) and
    // `--config-env=core.hooksPath=...` (long option, inline value).
    if (lowered.startsWith('-c')) {
      if (isHooksRedirectSetting(lowered.slice(2)) || hasOpaqueConfigKey(value.slice(2))) {
        return true;
      }
    }

    if (lowered.startsWith('--config-env=')) {
      const inline = value.slice('--config-env='.length);
      if (isHooksRedirectSetting(inline.toLowerCase()) || hasOpaqueConfigKey(inline)) {
        return true;
      }
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
        reason: `BLOCKED: Redirecting git hooks (core.hooksPath, directly or through include.path) is not allowed with git ${gitCommand}. Git hooks must not be bypassed.`,
      };
    }

    // With the subcommand hidden behind an expansion we cannot know it is not
    // `commit`, so use the widest flag set (commit's, which includes -n).
    const flagScanCommand = detected.dynamicCommand ? 'commit' : gitCommand;

    if (hasNoVerifyFlag(input, flagScanCommand, offset, detected.dynamicCommand)) {
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
