'use strict';

// see docs/gateguard/design-notes.md#read-only-first-shell-command

const MAX_COMMAND_CHARS = 4096;

// --- character screen ---

const BASH_UNQUOTED_REJECT = new Set(['\\', '`', '$', '<', '>', '(', ')', '{', '}']);
const BASH_DOUBLE_QUOTED_REJECT = new Set(['\\', '`', '$']);
const BASH_SINGLE_QUOTED_REJECT = new Set(['\\']);
const PS_UNQUOTED_REJECT = new Set(['`', '$', '<', '>', '(', ')', '{', '}', '@', '[', ']']);
const PS_DOUBLE_QUOTED_REJECT = new Set(['`', '$']);
const PS_SINGLE_QUOTED_REJECT = new Set();

const DIALECTS = Object.freeze({
  Bash: { unquoted: BASH_UNQUOTED_REJECT, double: BASH_DOUBLE_QUOTED_REJECT, single: BASH_SINGLE_QUOTED_REJECT },
  PowerShell: { unquoted: PS_UNQUOTED_REJECT, double: PS_DOUBLE_QUOTED_REJECT, single: PS_SINGLE_QUOTED_REJECT }
});

function isPlainAscii(code) {
  return code === 0x09 || (code >= 0x20 && code < 0x7f);
}

function passesCharacterScreen(command, dialect) {
  let quote = null;
  for (let index = 0; index < command.length; index++) {
    const ch = command[index];
    if (!isPlainAscii(ch.charCodeAt(0))) return false;
    if (quote === "'") {
      if (dialect.single.has(ch)) return false;
      if (ch === "'") quote = null;
      continue;
    }
    if (quote === '"') {
      if (dialect.double.has(ch)) return false;
      if (ch === '"') quote = null;
      continue;
    }
    if (ch === "'" || ch === '"') {
      quote = ch;
      continue;
    }
    if (dialect.unquoted.has(ch)) return false;
    if (ch === '&') {
      if (command[index + 1] !== '&') return false;
      index++;
    }
  }
  return quote === null;
}

// --- per-command rules ---

const anyArgs = () => true;
const noArg = pattern => args => !args.some(arg => pattern.test(arg));

const FIND_ACTIONS = /^-(exec|ok|delete|fprint|fls)/;
const FD_EXEC = /^(--exec|-[^-]*[xX])/;
const RG_EXEC = /^(--(pre|hostname-bin|search-zip)|-[^-]*z)/;
const TREE_WRITE = /^(-[^-]*[oR]|--o)/;

const BASH_COMMANDS = new Map([
  ['ls', anyArgs],
  ['pwd', anyArgs],
  ['cat', anyArgs],
  ['head', anyArgs],
  ['tail', anyArgs],
  ['wc', anyArgs],
  ['grep', anyArgs],
  ['rg', noArg(RG_EXEC)],
  ['find', noArg(FIND_ACTIONS)],
  ['fd', noArg(FD_EXEC)],
  ['tree', noArg(TREE_WRITE)],
  ['git', isReadOnlyGit]
]);

const POWERSHELL_COMMANDS = new Map([
  ['get-childitem', anyArgs],
  ['gci', anyArgs],
  ['dir', anyArgs],
  ['ls', anyArgs],
  ['get-content', anyArgs],
  ['gc', anyArgs],
  ['cat', anyArgs],
  ['type', anyArgs],
  ['select-string', anyArgs],
  ['sls', anyArgs],
  ['get-location', anyArgs],
  ['gl', anyArgs],
  ['pwd', anyArgs],
  ['rg', noArg(RG_EXEC)],
  ['git', isReadOnlyGit]
]);

// --- git ---

const GIT_LOG_VALUE_FLAGS = /^--(max-count=\d+|since=.*|until=.*|author=.*|grep=.*|format=.*|pretty=.*|date=.*)$/;
const GIT_DIFF_VALUE_FLAGS = /^(-U\d+|--unified=\d+)$/;

const GIT_SUBCOMMANDS = new Map([
  ['status', { positional: true, flags: ['--short', '-s', '--branch', '-b', '--porcelain', '--porcelain=v1', '--porcelain=v2', '-uno', '-unormal', '-uall'] }],
  [
    'log',
    {
      positional: true,
      flags: ['--oneline', '--stat', '--name-only', '--name-status', '--graph', '--decorate', '--all', '-p', '--patch', '--no-color', '--reverse', '--first-parent', '--no-merges', '--merges', '--follow', '--abbrev-commit', '-n'],
      pattern: value => /^-\d+$/.test(value) || GIT_LOG_VALUE_FLAGS.test(value)
    }
  ],
  [
    'diff',
    {
      positional: true,
      flags: ['--name-only', '--name-status', '--cached', '--staged', '--stat', '--numstat', '--shortstat', '--no-color', '-w', '--ignore-all-space', '--word-diff', '--merge-base', '--check'],
      pattern: value => GIT_DIFF_VALUE_FLAGS.test(value)
    }
  ],
  [
    'show',
    {
      positional: true,
      flags: ['--stat', '--name-only', '--name-status', '--oneline', '--no-color', '-p', '--patch', '--no-patch', '-s'],
      pattern: value => /^--(format|pretty)=/.test(value)
    }
  ],
  ['ls-files', { positional: true, flags: ['--others', '-o', '--exclude-standard', '--cached', '-c', '--modified', '-m', '--deleted', '-d', '--stage', '-s'] }],
  ['rev-parse', { positional: true, flags: ['--abbrev-ref', '--show-toplevel', '--git-dir', '--short', '--verify', '--is-inside-work-tree', '--show-prefix', '--symbolic-full-name'] }],
  ['branch', { positional: false, flags: ['--show-current', '-a', '--all', '-r', '--remotes', '--list', '-v', '-vv', '--no-color'] }]
]);

function isReadOnlyGit(args) {
  if (args.length === 0) return false;
  const rule = GIT_SUBCOMMANDS.get(args[0]);
  if (!rule) return false;
  let pathspec = false;
  for (const arg of args.slice(1)) {
    if (pathspec) continue;
    if (arg === '--') {
      if (!rule.positional) return false;
      pathspec = true;
      continue;
    }
    if (arg.startsWith('-')) {
      if (rule.flags.includes(arg) || (rule.pattern && rule.pattern(arg))) continue;
      return false;
    }
    if (!rule.positional) return false;
  }
  return true;
}

// --- entry ---

function createReadOnlyShell({ quoteAwareSegments }) {
  function segmentsFor(command, toolName) {
    return quoteAwareSegments(toolName === 'PowerShell' ? command.replace(/\\/g, '\\\\') : command);
  }

  function isReadOnlySegment(words, toolName) {
    const [name, ...args] = words;
    if (!name || /[=/\\*?[]/.test(name)) return false;
    const table = toolName === 'PowerShell' ? POWERSHELL_COMMANDS : BASH_COMMANDS;
    const rule = table.get(toolName === 'PowerShell' ? name.toLowerCase() : name);
    if (!rule) return false;
    if (toolName === 'PowerShell' && args.includes('--%')) return false;
    return rule(args);
  }

  /** True only when every segment of the command is allowlisted read-only introspection. */
  function isReadOnlyShellCommand(toolName, command) {
    try {
      const dialect = Object.hasOwn(DIALECTS, toolName) ? DIALECTS[toolName] : null;
      if (!dialect || typeof command !== 'string' || command.length > MAX_COMMAND_CHARS) return false;
      if (!passesCharacterScreen(command, dialect)) return false;
      const segments = segmentsFor(command, toolName);
      return segments.length > 0 && segments.every(words => isReadOnlySegment(words, toolName));
    } catch (_) {
      return false;
    }
  }

  return { isReadOnlyShellCommand };
}

module.exports = { createReadOnlyShell };
