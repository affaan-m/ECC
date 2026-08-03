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
function detectGitCommand(input) {
  let start = 0;
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
      return { command: bestCmd, offset: bestIdx + bestCmd.length };
    }

    start = git.idx + git.len;
  }
  return null;
}

/**
 * Flags whose FOLLOWING token git consumes as a value rather than a flag.
 *
 * Only options whose value is mandatory belong here. An optional-value option
 * such as -S or -u does not swallow the next token, so listing one would let
 * `git commit -S -n` slip through.
 */
const VALUE_TAKING_FLAGS = new Set([
  '-m', '--message',
  '-F', '--file',
  '-c', '--reedit-message',
  '-C', '--reuse-message',
  '-t', '--template',
  '--author',
  '--date',
  '--cleanup',
  '--trailer',
  '--fixup',
  '--squash',
  '--pathspec-from-file',
]);

/**
 * Split a command string into shell-like tokens.
 *
 * Quote-aware by design: without it, text inside a quoted argument cannot be
 * told apart from a real flag, so `git commit -m "head -n 5"` — a message that
 * merely mentions a flag — was blocked as if the flag had been passed. Quoted
 * spans collapse into one token, exactly as the shell hands them to git.
 *
 * Each token carries a `segment` index that increments at every unquoted shell
 * operator, letting callers tell git's own arguments (segment 0) from a later
 * command's in a pipe or chain.
 */
function tokenizeCommand(input) {
  const tokens = [];
  let current = '';
  let started = false;
  let quote = null;
  let segment = 0;

  const flush = () => {
    if (started) {
      tokens.push({ value: current, segment });
      current = '';
      started = false;
    }
  };

  for (let i = 0; i < input.length; i++) {
    const ch = input[i];

    if (quote) {
      if (quote === '"' && ch === '\\' && i + 1 < input.length) { current += input[++i]; continue; }
      if (ch === quote) { quote = null; continue; }
      current += ch;
      continue;
    }

    if (ch === '"' || ch === "'") { quote = ch; started = true; continue; }
    if (ch === '\\' && i + 1 < input.length) { current += input[++i]; started = true; continue; }
    if (/\s/.test(ch)) { flush(); continue; }
    if (ch === '|' || ch === ';' || ch === '&' || ch === '>' || ch === '<') { flush(); segment++; continue; }

    current += ch;
    started = true;
  }

  flush();
  return tokens;
}

/**
 * Check if a bypass flag is passed to a specific git command.
 * Only inspects the portion of the input starting at `offset` (the position
 * right after the detected subcommand keyword) so that flags belonging to
 * earlier commands in a chain are not falsely matched.
 */
function hasNoVerifyFlag(input, command, offset) {
  const tokens = tokenizeCommand(input.slice(offset));
  let expectValue = false;

  for (const { value, segment } of tokens) {
    // A value token is data, never a flag — `-m "--no-verify"` is a message.
    if (expectValue) { expectValue = false; continue; }
    if (VALUE_TAKING_FLAGS.has(value)) { expectValue = true; continue; }

    // Long form is unambiguous wherever it lands, including later in a chain
    // (`git commit -m x && git push --no-verify`), so it is not scoped. Quoting
    // does not exempt it: `git commit "--no-verify"` still reaches git as a flag.
    if (value === '--no-verify') return true;

    // For commit, -n is shorthand for --no-verify. Unlike the long form, -n is a
    // common flag on other tools, so it only counts inside git's own argument
    // list. Without that scope an innocent `git commit -m x | head -n 5` reads
    // head's -n as git's; `tail -n`, `grep -n` and `sort -n` hit the same trap.
    // Short flags cluster, so -an carries -n too.
    if (command === 'commit' && segment === 0 && /^-[a-zA-Z]*n[a-zA-Z]*$/.test(value)) return true;
  }

  return false;
}

/**
 * Check if the input contains a -c core.hooksPath= override.
 * Token-based for the same reason as above: a commit message that quotes the
 * setting is not an attempt to override it.
 */
function hasHooksPathOverride(input) {
  const tokens = tokenizeCommand(input);

  for (let i = 0; i < tokens.length; i++) {
    const { value } = tokens[i];
    if (/^core\.hooksPath\s*=/.test(value)) {
      if (i > 0 && tokens[i - 1].value === '-c') return true;
      continue;
    }
    // Attached form: -ccore.hooksPath=...
    if (/^-c["']?core\.hooksPath\s*=/.test(value)) return true;
  }

  return false;
}

/**
 * Check a command string for git hook bypass attempts.
 */
function checkCommand(input) {
  const detected = detectGitCommand(input);
  if (!detected) return { blocked: false };

  const { command: gitCommand, offset } = detected;

  if (hasNoVerifyFlag(input, gitCommand, offset)) {
    return {
      blocked: true,
      reason: `BLOCKED: --no-verify flag is not allowed with git ${gitCommand}. Git hooks must not be bypassed.`,
    };
  }

  if (hasHooksPathOverride(input)) {
    return {
      blocked: true,
      reason: `BLOCKED: Overriding core.hooksPath is not allowed with git ${gitCommand}. Git hooks must not be bypassed.`,
    };
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
