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

const { quotedRegionAt } = require('../lib/shell-quotes');

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

/**
 * Programs that execute a quoted argument as a shell command line, so a
 * `git` inside one of their quoted arguments is a command that must still
 * be checked (`sh -c "git commit --no-verify"`, `sudo`, `xargs`, `env`...).
 * For any other argv0 (`node cli.js 'git commit --no-verify'`,
 * `printf '%s' '...'`, `grep -n '...' docs.md`) a quoted string is data,
 * unless it is a runtime given an eval flag (see CODE_EVALUATORS).
 */
const COMMAND_WRAPPERS = new Set([
  'sh',
  'bash',
  'zsh',
  'dash',
  'ksh',
  'fish',
  'busybox',
  'eval',
  'exec',
  'command',
  'xargs',
  'sudo',
  'doas',
  'su',
  'env',
  'nice',
  'ionice',
  'nohup',
  'timeout',
  'time',
  'watch',
  'flock',
  'ssh',
  'script',
  'csh',
  'tcsh',
  'setsid',
  'stdbuf',
  'taskset',
  'chrt',
  'unshare',
  'chroot',
  'runuser',
  'npx',
  'bunx',
  'pnpx',
]);

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
// Short options whose value is OPTIONAL and must be stuck to the flag
// (`-uno`, `-S<keyid>`). The rest of the cluster is that value, so an `n`
// after them is not the -n flag: `git commit -uno` means --untracked-files=no.
const COMMIT_SHORT_OPTIONS_WITH_OPTIONAL_VALUE = new Set(['u', 'S']);

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

    // Whitespace ends a word; so do the unquoted substitution delimiters,
    // which can never be part of a word (`echo "$(git push --no-verify)"`,
    // "`git push --no-verify`" used to yield the token `--no-verify)` /
    // `--no-verify\``, hiding the flag).
    if (/[\s`()]/.test(char)) {
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
    if (COMMIT_SHORT_OPTIONS_WITH_OPTIONAL_VALUE.has(option)) return false;
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
 * Strip a leading path and a trailing `.exe` from a command word.
 */
function commandBasename(word) {
  return String(word || '')
    .replace(/^.*[\\/]/, '')
    .replace(/\.exe$/i, '')
    .toLowerCase();
}

/**
 * Runtimes that run a quoted argument as program source once they are given
 * an eval flag (`node -e`, `python3 -c`, `perl -E`, `deno eval`). That source
 * can spawn git itself, so it stays subject to the guard. The same runtime
 * without an eval flag receives a script argument, which is data
 * (`node cli.js 'git commit --no-verify'`).
 */
const CODE_EVALUATORS = new Set([
  'node',
  'nodejs',
  'bun',
  'deno',
  'python',
  'python2',
  'python3',
  'pythonw',
  'perl',
  'ruby',
  'php',
  'lua',
  'luajit',
  'rscript',
  'osascript',
  'tclsh',
  'groovy',
  'julia',
  'elixir',
  'erl',
]);

/** `-e`, `-E`, `--eval`, `-c`, `-p`, `--print`, `-r` and deno's `eval`. */
const EVAL_FLAG = /(?:^|\s)(?:-{1,2}(?:e|eval|c|command|p|print|r)|eval)(?:=|\s|$)/i;

/**
 * Whether the words between the program and its quoted argument turn that
 * argument into code.
 */
function evaluatesQuotedArgument(input, region, base) {
  if (!CODE_EVALUATORS.has(base)) return false;
  return EVAL_FLAG.test(input.slice(region.argv0Start, region.start));
}

/**
 * A `git` inside a quoted string is only a command when that string is
 * handed to something that executes it: a shell or process wrapper, or a
 * runtime given an eval flag. Otherwise it is an argument of an unrelated
 * program (a CLI under test, printf, grep, a script path, ...) and must not
 * be inspected for bypass flags. A double-quoted string that contains a
 * command substitution (`"$(git ...)"`, "`git ...`") runs git before any
 * program receives it, so it is never data.
 */
function isQuotedDataArgument(input, idx) {
  const region = quotedRegionAt(input, idx);
  if (region === null || region.argv0 === '') return false;
  if (region.substitution) return false;
  const base = commandBasename(region.argv0);
  if (base === 'git' || COMMAND_WRAPPERS.has(base)) return false;
  return !evaluatesQuotedArgument(input, region, base);
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
    if (VALID_BEFORE_GIT.includes(before) && !isQuotedDataArgument(input, idx)) {
      return { idx, len };
    }
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
 * git's option parser accepts any unambiguous prefix of a long option, so
 * `--no-veri` and `--no-verif` run as --no-verify. Shorter prefixes such as
 * `--no-ver` are ambiguous with --no-verbose and git rejects them itself, so
 * refusing every prefix from `--no-v` up blocks nothing that would have run.
 */
function isNoVerifyLongFlag(value) {
  return value.length >= '--no-v'.length && '--no-verify'.startsWith(value);
}

/**
 * A flag inside a code payload is followed by the punctuation that closes the
 * call (`execSync("git push --no-verify")`), and the word tokenizer keeps that
 * punctuation in the token. Trim it so the flag is comparable; a real flag
 * never ends in one of these characters.
 */
function flagToken(value) {
  return value.replace(/[)\]}'"`;,]+$/, '');
}

/**
 * Check if the input contains a --no-verify flag for a specific git command.
 * Only inspects the portion of the input starting at `offset` (the position
 * right after the detected subcommand keyword) so that flags belonging to
 * earlier commands in a chain are not falsely matched.
 */
function hasNoVerifyFlag(input, command, offset, limit = input.length) {
  const segmentEnd = Math.min(findCommandSegmentEnd(input, offset), limit);
  const tokens = tokenizeShellWords(input, offset, segmentEnd);
  let skipNext = false;

  for (const token of tokens) {
    const value = flagToken(token.value);

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

    if (isNoVerifyLongFlag(value)) return true;

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

    // A git command line inside a quoted string (`sh -c 'git push ...'`)
    // ends with that string: scanning past the closing quote would read the
    // rest of the outer statement in the wrong quote state, so `sh -c 'git
    // push --no-verify'; echo done` glued `; echo done` onto the flag token.
    const region = quotedRegionAt(input, detected.gitStart);
    const limit = region === null ? input.length : region.end;
    if (hasNoVerifyFlag(input, gitCommand, offset, limit)) {
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
