#!/usr/bin/env node
/**
 * PreToolUse Hook: GateGuard Fact-Forcing Gate
 *
 * Forces Claude to investigate before editing files or running commands.
 * Instead of asking "are you sure?" (which LLMs always answer "yes"),
 * this hook demands concrete facts: importers, public API, data schemas.
 *
 * The act of investigation creates awareness that self-evaluation never did.
 *
 * Gates:
 *   - Edit/Write: list importers, affected API, verify data schemas, quote instruction
 *   - Bash/PowerShell (destructive): list targets, rollback plan, quote instruction
 *   - Bash/PowerShell (routine): quote current instruction (once per session)
 *
 * Compatible with run-with-flags.js via module.exports.run().
 * Cross-platform (Windows, macOS, Linux).
 *
 * Full package with config support: pip install gateguard-ai
 * Repo: https://github.com/zunoworks/gateguard
 */

'use strict';

const crypto = require('crypto');
const fs = require('fs');
const path = require('path');
const { extractCommandSubstitutions, extractSubshellGroups, extractBraceGroups } = require('../lib/shell-substitution');
const { classifyPowerShellDestructiveCommand } = require('../lib/powershell-destructive-command');
const { withStateFileLock } = require('../lib/gateguard-state-lock');
const { stripHeredocBodies } = require('./gateguard-heredoc');
const {
  isTrivialChange,
  riskTier,
  EVIDENCE_TTL_MS,
  evidenceLevel,
  validScopePass,
  grantScopePass,
  pruneEvidence,
  dedupeEvidence,
  pruneReadFiles,
  mergeTimestampMaps,
  restoreStateBackup,
  writeStateToDiskAtomic
} = require('./gateguard-evidence-ledger');

// Session state — scoped per session to avoid cross-session races.
const STATE_DIR = process.env.GATEGUARD_STATE_DIR || path.join(process.env.HOME || process.env.USERPROFILE || '/tmp', '.gateguard');
let activeStateFile = null;

// State expires after 30 minutes of inactivity
const SESSION_TIMEOUT_MS = EVIDENCE_TTL_MS;
const READ_HEARTBEAT_MS = 60 * 1000;

// Maximum checked entries to prevent unbounded growth
const MAX_CHECKED_ENTRIES = 500;
const MAX_SESSION_KEYS = 50;
const ROUTINE_BASH_SESSION_KEY = '__bash_session__';
const EDIT_WRITE_HOOK_ID = 'pre:edit-write:gateguard-fact-force';
const BASH_HOOK_ID = 'pre:bash:gateguard-fact-force';
const POWERSHELL_HOOK_ID = 'pre:powershell:gateguard-fact-force';
const EDIT_WRITE_NARROW_RECOVERY_HINT =
  'Narrow recovery: add a matching path glob to `GATEGUARD_EXEMPT_GLOBS` to skip first-touch Edit/Write checks without disabling destructive Bash checks.';
const ROUTINE_BASH_NARROW_RECOVERY_HINT =
  'Narrow recovery: set `GATEGUARD_BASH_ROUTINE_DISABLED=1`; destructive Bash checks remain active.';
const ROUTINE_POWERSHELL_NARROW_RECOVERY_HINT =
  'Narrow recovery: set `GATEGUARD_BASH_ROUTINE_DISABLED=1`; destructive Bash and PowerShell checks remain active.';
const ECC_DISABLE_VALUES = new Set(['0', 'false', 'off', 'disabled', 'disable']);
const ECC_ENABLE_VALUES = new Set(['1', 'true', 'on', 'enabled', 'enable', 'yes']);

function isEvidenceBypassEnabled() {
  const envVal = process.env.GATEGUARD_EVIDENCE_BYPASS;
  if (!envVal) return true;
  return !ECC_DISABLE_VALUES.has(String(envVal).trim().toLowerCase());
}

// SQL-keyword + dd phrases live in command bodies, not as flag-bearing
// arguments, so they are matched by regex. Quoted strings are
// stripped before this regex runs so a commit message mentioning
// "drop table" no longer triggers a false positive.
const DESTRUCTIVE_SQL_DD = /\b(drop\s+table|delete\s+from|truncate|dd\s+if=)\b/i;
const TERRAFORM_OPTIONS_WITH_VALUE = new Set(['-chdir', '-var', '-var-file', '-state', '-backup', '-state-out', '-plugin-dir', '-lock-timeout', '-parallelism']);
const KUBECTL_GLOBAL_OPTIONS_WITH_VALUE = new Set([
  '--as', '--as-group', '--as-uid', '--cache-dir', '--certificate-authority', '--client-certificate',
  '--client-key', '--cluster', '--context', '--kubeconfig', '--namespace', '-n', '--password',
  '--request-timeout', '-s', '--server', '--token', '--user', '--username', '--as-user-extra', '--kuberc',
  '--profile', '--profile-output', '--proxy-url', '--storage-driver-buffer-duration',
  '--storage-driver-db', '--storage-driver-host', '--storage-driver-password',
  '--storage-driver-table', '--storage-driver-user', '--tls-server-name', '-v', '--v', '--vmodule'
]);
const KUBECTL_DELETE_OPTIONS_WITH_VALUE = new Set([
  '--cascade', '--dry-run', '--field-selector', '-f', '--filename', '--grace-period', '-k', '--kustomize',
  '--label-selector', '-l', '--namespace', '-n', '--output', '-o', '--preconditions', '--raw',
  '--resource-version', '--selector', '--timeout', '--wait'
]);
const UNINSPECTABLE_KUBECTL_DELETE_OPTIONS = new Set(['-f', '--filename', '-k', '--kustomize', '--raw']);
const DANGEROUS_KUBECTL_RESOURCES = new Set([
  'namespace', 'namespaces', 'ns', 'node', 'nodes', 'all', 'pv', 'pvc',
  'persistentvolume', 'persistentvolumes', 'persistentvolumeclaim', 'persistentvolumeclaims'
]);

/**
 * Checks for destructive Infrastructure as Code commands, tolerating arbitrary
 * global CLI options (e.g. `terraform -chdir=... destroy`, `kubectl --context=... delete namespace ...`).
 * @param {string[]|string} tokensOrText Command tokens or command string.
 * @returns {boolean} True if destructive IaC command detected.
 */
function isDestructiveIaC(tokensOrText) {
  let tokens;
  if (Array.isArray(tokensOrText)) {
    tokens = tokensOrText;
  } else if (typeof tokensOrText === 'string') {
    tokens = tokenize(tokensOrText);
  } else {
    return false;
  }
  if (!tokens || tokens.length === 0) return false;

  const start = unwrapLeadWrappers(tokens);
  if (start >= tokens.length) return false;

  const exe = commandBasename(tokens[start]);
  if (exe !== 'terraform' && exe !== 'tofu' && exe !== 'kubectl') {
    return false;
  }

  const args = tokens.slice(start + 1);
  return exe === 'kubectl' ? isDestructiveKubectl(args) : isDestructiveTerraform(args);
}

/** Finds a CLI subcommand while consuming known global option values. */
function findSubcommand(args, optionsWithValue) {
  for (let i = 0; i < args.length; i += 1) {
    const arg = args[i];
    if (arg === '--') return i + 1 < args.length ? i + 1 : -1;
    if (arg.startsWith('-')) {
      const option = arg.split('=')[0].toLowerCase();
      if (optionsWithValue.has(option) && !arg.includes('=')) i += 1;
      continue;
    }
    return i;
  }
  return -1;
}

/** Detects Terraform/OpenTofu destroy subcommands and destroy plan flags. */
function isDestructiveTerraform(args) {
  const subcommandIndex = findSubcommand(args, TERRAFORM_OPTIONS_WITH_VALUE);
  if (subcommandIndex < 0) return false;
  const subcommand = args[subcommandIndex].toLowerCase();
  if (subcommand === 'destroy') return true;
  return ['plan', 'apply'].includes(subcommand)
    && args.slice(subcommandIndex + 1).some(isEnabledDestroyModeFlag);
}

/** Treats `-destroy` boolean assignments as enabled unless explicitly false. */
function isEnabledDestroyModeFlag(arg) {
  const [flag, value] = String(arg).toLowerCase().split('=', 2);
  const normalizedFlag = flag.startsWith('--') ? flag.slice(1) : flag;
  if (normalizedFlag !== '-destroy') return false;
  return value === undefined || !['false', '0', 'f'].includes(value);
}

/** Flags deletes whose target cannot be inspected statically. */
function isUninspectableKubectlDeleteOption(arg) {
  const option = arg.split('=')[0];
  return UNINSPECTABLE_KUBECTL_DELETE_OPTIONS.has(option) || /^-[fk].+/.test(arg);
}

/** Detects risky Kubernetes deletes after consuming global and delete option values. */
function isDestructiveKubectl(args) {
  const subcommandIndex = findSubcommand(args, KUBECTL_GLOBAL_OPTIONS_WITH_VALUE);
  if (subcommandIndex < 0 || args[subcommandIndex].toLowerCase() !== 'delete') return false;

  const deleteArgs = args.slice(subcommandIndex + 1);
  const resources = [];
  let afterOptions = false;
  for (let i = 0; i < deleteArgs.length; i += 1) {
    const arg = deleteArgs[i].toLowerCase();
    if (afterOptions) {
      resources.push(arg);
      continue;
    }
    if (arg === '--') {
      afterOptions = true;
      continue;
    }
    if (arg === '--all') return true;
    if (isUninspectableKubectlDeleteOption(arg)) return true;
    if (arg.startsWith('-')) {
      const option = arg.split('=')[0];
      if (KUBECTL_DELETE_OPTIONS_WITH_VALUE.has(option) && !arg.includes('=')) i += 1;
      continue;
    }
    resources.push(arg);
  }
  return resources.some(isDangerousKubectlResource);
}

/** Returns whether a resource token or resource/name pair targets a risky type. */
function isDangerousKubectlResource(resourceArg) {
  return resourceArg.split(',').some(resource => DANGEROUS_KUBECTL_RESOURCES.has(resource.split('/')[0]));
}

// Operator-supplied additional destructive patterns. Lazily compiled from
// `GATEGUARD_BASH_EXTRA_DESTRUCTIVE` (regex source) on first use, then
// memoized keyed by the env-var value so a test or long-running process
// that flips the env between calls re-reads it without paying for a
// recompile on every invocation. A malformed regex is treated as
// "not configured" (the gate falls back to the built-in patterns) and
// the parse failure is logged once via `[gateguard-fact-force]` to
// stderr — hooks must never crash tool execution because of operator
// config errors.
let extraDestructiveCacheKey = null;
let extraDestructiveCacheRegex = null;
let extraDestructiveWarnLogged = false;
function getExtraDestructiveRegex() {
  const raw = process.env.GATEGUARD_BASH_EXTRA_DESTRUCTIVE || '';
  if (!raw) {
    extraDestructiveCacheKey = '';
    extraDestructiveCacheRegex = null;
    return null;
  }
  if (raw === extraDestructiveCacheKey) {
    return extraDestructiveCacheRegex;
  }
  // The env value just changed; reset the once-per-pattern warning gate
  // so a subsequent *different* invalid regex is also reported once. The
  // previous shape kept the flag sticky and silently swallowed the
  // second bad pattern in a long-running process.
  extraDestructiveCacheKey = raw;
  extraDestructiveWarnLogged = false;
  try {
    extraDestructiveCacheRegex = new RegExp(raw, 'i');
  } catch (err) {
    extraDestructiveCacheRegex = null;
    if (!extraDestructiveWarnLogged) {
      try {
        process.stderr.write(`[gateguard-fact-force] ignoring invalid GATEGUARD_BASH_EXTRA_DESTRUCTIVE regex: ${err.message}\n`);
      } catch (_) {
        /* stderr write failure is non-fatal */
      }
      extraDestructiveWarnLogged = true;
    }
  }
  return extraDestructiveCacheRegex;
}

// Operator-supplied path exemptions. Comma-separated globs (`GATEGUARD_EXEMPT_GLOBS`)
// matched against the normalized project-relative path (or full path for an
// explicitly absolute glob). First-touch
// fact-forcing is skipped for a matching Edit/Write/MultiEdit target — intended for
// low-import-value trees (tests, generated artifacts, scratch dirs) where "who imports
// this / what schema" carries no signal. Memoized on the env value; malformed
// patterns are dropped without granting exemptions. `*` matches within a path segment,
// `**` across segments, `?` a single char.
let exemptCacheKey = null;
let exemptCacheRegexes = null;
function getExemptMatchers() {
  const raw = process.env.GATEGUARD_EXEMPT_GLOBS || '';
  if (raw === exemptCacheKey) {
    return exemptCacheRegexes;
  }
  exemptCacheKey = raw;
  exemptCacheRegexes = raw
    .split(',')
    .map(s => normalizeForMatch(s.trim()))
    .filter(Boolean)
    .map(glob => {
      let source = '';
      for (let index = 0; index < glob.length; index++) {
        const char = glob[index];
        if (char === '*' && glob[index + 1] === '*') {
          index++;
          if (glob[index + 1] === '/') {
            source += '(?:.*/)?';
            index++;
          } else source += '.*';
        } else if (char === '*') source += '[^/]*';
        else if (char === '?') source += '[^/]';
        else source += char.replace(/[.+^${}()|[\]\\]/g, '\\$&');
      }
      try {
        return { regex: new RegExp(`^${source}$`), absolute: path.posix.isAbsolute(glob) || path.win32.isAbsolute(glob) };
      } catch (_) {
        return null;
      }
    })
    .filter(Boolean);
  return exemptCacheRegexes;
}

function isExemptPath(filePath, data) {
  const projectRoot = process.env.CLAUDE_PROJECT_DIR || data.cwd || process.cwd();
  if (typeof projectRoot !== 'string' || typeof filePath !== 'string') return false;
  const paths = /^[a-z]:[\\/]|^\\\\/i.test(projectRoot) ? path.win32 : path.posix;
  if (!paths.isAbsolute(projectRoot)) return false;
  const target = paths.resolve(projectRoot, filePath);
  const relative = paths.relative(projectRoot, target);
  const contained = relative !== '..' && !relative.startsWith(`..${paths.sep}`) && !paths.isAbsolute(relative);
  return getExemptMatchers().some(({ regex, absolute }) =>
    absolute ? regex.test(normalizeForMatch(target)) : contained && regex.test(normalizeForMatch(relative))
  );
}

function isRoutineBashGateDisabled() {
  return ECC_ENABLE_VALUES.has(normalizeEnvValue(process.env.GATEGUARD_BASH_ROUTINE_DISABLED));
}

/**
 * Strip the contents of single- and double-quoted strings so phrases
 * mentioned inside a commit message or echoed argument do not trigger
 * the destructive detector. Command substitutions are scanned separately
 * before this runs because they execute even inside double quotes.
 *
 * @param {string} input
 * @returns {string}
 */
function stripQuotedStrings(input) {
  return input.replace(/'(?:[^'\\]|\\.)*'/g, "''").replace(/"(?:[^"\\]|\\.)*"/g, '""');
}

/**
 * Promote subshell delimiters to top-level segment separators so the
 * destructive check applies inside `$(...)` and backtick subshells.
 * Without this, `echo y | $(rm -rf /tmp)` and ``echo y | `rm -rf /tmp` ``
 * slip past the segment splitter because the destructive command lives
 * inside a sub-expression. Run iteratively to handle a layer of nesting.
 *
 * @param {string} input
 * @returns {string}
 */
function explodeSubshells(input) {
  let out = input;
  for (let i = 0; i < 4; i += 1) {
    const before = out;
    out = out.replace(/\$\(([^()`]*)\)/g, ';$1;');
    out = out.replace(/`([^`]*)`/g, ';$1;');
    if (out === before) break;
  }
  return out;
}

/**
 * Split a command line into top-level segments at unquoted shell
 * separators (`;`, `|`, `&`, `&&`, `||`) and across subshells
 * (`$(...)` / backticks). Quoted strings are stripped first so
 * separators inside quotes are not split on. Per-segment comments
 * are also stripped.
 *
 * @param {string} input
 * @returns {string[]}
 */
function splitCommandSegments(input) {
  const stripped = explodeSubshells(stripQuotedStrings(input));
  return stripped
    .split(/[;|&]+/)
    .map(segment => segment.replace(/(^|\s)#.*/, '$1').trim())
    .filter(Boolean);
}

/**
 * Tokenize a single command segment by whitespace. Quoted strings
 * are already collapsed to empty quotes by `stripQuotedStrings`, so
 * naive whitespace splitting is sufficient.
 *
 * @param {string} segment
 * @returns {string[]}
 */
function tokenize(segment) {
  return segment.split(/\s+/).filter(Boolean);
}

/**
 * Tokenize a short allowlisted shell command while preserving quoted
 * arguments. This is intentionally smaller than a full shell parser: the
 * caller rejects shell control characters before invoking it, so this only
 * needs to keep spaces inside quotes together for read-only git commands.
 *
 * @param {string} input
 * @returns {string[] | null}
 */
function tokenizeAllowlistedShellWords(input) {
  const tokens = [];
  let current = '';
  let quote = null;
  let escaped = false;

  for (const char of String(input || '')) {
    if (escaped) {
      current += char;
      escaped = false;
      continue;
    }

    if (char === '\\') {
      escaped = true;
      continue;
    }

    if (quote) {
      if (char === quote) {
        quote = null;
      } else {
        current += char;
      }
      continue;
    }

    if (char === '"' || char === "'") {
      quote = char;
      continue;
    }

    if (/\s/.test(char)) {
      if (current) {
        tokens.push(current);
        current = '';
      }
      continue;
    }

    current += char;
  }

  if (escaped) current += '\\';
  if (quote) return null;
  if (current) tokens.push(current);
  return tokens;
}

const SHELL_SEGMENT_SEPARATORS = new Set([';', '|', '&', '\n', '\r']);

/**
 * Quote-aware split of a command line into segments, with quotes removed from
 * the resulting words. Splits only on UNQUOTED `;`, `|`, `&`, and newlines so:
 *  - a quoted command word (`'rm'`, `"rm"`) normalizes to `rm` (the shell
 *    treats quotes around a command name as transparent), and
 *  - a newline behaves as a command separator (the shell runs each line),
 * neither of which `stripQuotedStrings` + naive splitting handles — both were
 * destructive-classifier bypasses (GHSA-4v57-ph3x-gf55).
 *
 * @param {string} input
 * @returns {string[][]} array of dequoted token arrays, one per segment
 */
function quoteAwareSegments(input) {
  const segments = [];
  let words = [];
  let current = '';
  let hasWord = false;
  let quote = null;
  let escaped = false;

  const flushWord = () => {
    if (hasWord) words.push(current);
    current = '';
    hasWord = false;
  };
  const flushSegment = () => {
    flushWord();
    if (words.length) segments.push(words);
    words = [];
  };

  for (const ch of String(input || '')) {
    if (escaped) {
      current += ch;
      hasWord = true;
      escaped = false;
      continue;
    }
    if (ch === '\\') {
      escaped = true;
      hasWord = true;
      continue;
    }
    if (quote) {
      if (ch === quote) quote = null;
      else current += ch;
      hasWord = true;
      continue;
    }
    if (ch === '"' || ch === "'") {
      quote = ch;
      hasWord = true; // entering a quote starts a word, even if its content is empty
      continue;
    }
    if (SHELL_SEGMENT_SEPARATORS.has(ch)) {
      flushSegment();
      continue;
    }
    if (/\s/.test(ch)) {
      flushWord();
      continue;
    }
    current += ch;
    hasWord = true;
  }
  flushSegment();
  return segments;
}

const SHELL_WRAPPERS = new Set(['sh', 'bash', 'zsh', 'dash', 'ksh']);

/**
 * SQL clients whose `-c`/`-e`/positional arguments carry SQL statements.
 * Quoted SQL (e.g. `psql -c "drop table users"`) is invisible to the
 * quote-stripping SQL regex, so it is re-checked here against dequoted
 * tokens where quoted content is preserved (issue #3024). Restricted to
 * known clients so `git commit -m "drop table"` and `echo "drop table"`
 * stay allowed.
 */
const SQL_CLIENT_COMMANDS = new Set([
  'psql',
  'postgres',
  'mysql',
  'mariadb',
  'sqlite3',
  'sqlite',
  'sqlcmd',
  'isql',
  'pgcli',
  'mycli',
  'duckdb',
  'bq',
]);

/**
 * Strip SQL string literals so phrases inside query data do not trigger
 * the destructive detector (e.g. `SELECT 'drop table' ...` is a read).
 * Handles single-quoted literals with '' escapes, double-quoted
 * identifiers, and dollar-quoted blocks ($$...$$ and $tag$...$tag$).
 *
 * @param {string} input
 * @returns {string}
 */
function stripSqlLiterals(input) {
  return String(input || '')
    .replace(/'(?:[^']|'')*'/g, "''")
    .replace(/"(?:[^"\\]|\\.)*"/g, '""')
    .replace(/(\$[A-Za-z_][A-Za-z0-9_]*\$|\$\$)[\s\S]*?\1/g, '$$$$');
}

const SUDO_VALUE_FLAGS = new Set([
  '-u',
  '--user',
  '-g',
  '--group',
  '-U',
  '--other-user',
  '-p',
  '--prompt',
  '-C',
  '--close-from',
  '-D',
  '--chdir',
  '-h',
  '--host',
  '-r',
  '--role',
  '-t',
  '--type',
  '-T',
  '--command-timeout',
]);

const TIME_VALUE_FLAGS = new Set(['-f', '--format', '-o', '--output']);
const FIND_EXEC_OPERATORS = new Set(['-exec', '-execdir', '-ok', '-okdir']);
const FIND_EXEC_TERMINATORS = new Set([';', '\\;', '+']);

/**
 * Advance past `sudo`/`doas`/`env` wrappers including their flags and
 * `VAR=value` assignments, so `sudo -u postgres psql ...` and
 * `env PGUSER=postgres psql ...` still resolve to the real command.
 *
 * @param {string[]} tokens dequoted tokens for one segment
 * @returns {number} index of the real command token
 */
function unwrapLeadWrappers(tokens) {
  let index = 0;
  for (let guard = 0; guard < 4; guard += 1) {
    if (index >= tokens.length) return index;
    const base = commandBasename(tokens[index]);
    if (base === 'sudo' || base === 'doas') {
      index += 1;
      while (index < tokens.length) {
        const flag = tokens[index];
        if (flag === '--') {
          index += 1;
          break;
        }
        if (flag === '-' || !flag.startsWith('-')) break;
        if (SUDO_VALUE_FLAGS.has(flag)) {
          index += 2;
          continue;
        }
        if (/^--[^=]+=.*$/.test(flag)) {
          index += 1;
          continue;
        }
        index += 1;
      }
      continue;
    }
    if (base === 'env') {
      index += 1;
      while (index < tokens.length) {
        const arg = tokens[index];
        if (arg === '--' || arg === '-' || arg === '-i' || arg === '--ignore-environment') {
          index += 1;
          continue;
        }
        if (arg === '-u' || arg === '--unset') {
          index += 2;
          continue;
        }
        if (arg === '-C' || arg === '--chdir') {
          index += 2;
          continue;
        }
        if (/^--unset=.*$/.test(arg) || /^--chdir=.*$/.test(arg) || /^--argv0=.*$/.test(arg)) {
          index += 1;
          continue;
        }
        if (arg.startsWith('-') && !/^[A-Za-z_][A-Za-z0-9_]*=/.test(arg)) {
          index += 1;
          continue;
        }
        if (/^[A-Za-z_][A-Za-z0-9_]*=/.test(arg)) {
          index += 1;
          continue;
        }
        break;
      }
      continue;
    }
    if (base === 'command') {
      index += 1;
      if (tokens[index] === '-p') index += 1;
      if (tokens[index] === '--') index += 1;
      if (tokens[index] && tokens[index].startsWith('-')) return tokens.length;
      continue;
    }
    if (base === 'time') {
      index += 1;
      while (index < tokens.length) {
        const flag = tokens[index];
        if (flag === '--') {
          index += 1;
          break;
        }
        if (TIME_VALUE_FLAGS.has(flag) || /^(?:-f|--format|-o|--output)=/.test(flag)) {
          index += TIME_VALUE_FLAGS.has(flag) ? 2 : 1;
          continue;
        }
        if (flag.startsWith('-')) {
          index += 1;
          continue;
        }
        break;
      }
      continue;
    }
    if (base === 'exec') {
      index += 1;
      while (index < tokens.length) {
        const flag = tokens[index];
        if (flag === '--') {
          index += 1;
          break;
        }
        if (flag === '-a' || flag === '--argv0') {
          index += 2;
          continue;
        }
        if (/^--argv0=/.test(flag)) {
          index += 1;
          continue;
        }
        if (flag.startsWith('-')) {
          index += 1;
          continue;
        }
        break;
      }
      continue;
    }
    break;
  }
  return index;
}

/**
 * Detect destructive SQL passed as (possibly quoted) arguments to a known
 * SQL client. Operates on dequoted tokens from `quoteAwareSegments`, so
 * `psql -c "drop table users"` joins back to matchable text.
 *
 * @param {string[]} tokens dequoted tokens for one segment
 * @returns {boolean}
 */
function isDestructiveSqlClient(tokens) {
  if (!tokens || tokens.length === 0) return false;
  const start = unwrapLeadWrappers(tokens);
  if (start >= tokens.length) return false;
  if (!SQL_CLIENT_COMMANDS.has(commandBasename(tokens[start]))) return false;
  return DESTRUCTIVE_SQL_DD.test(stripSqlLiterals(tokens.slice(start).join(' ')));
}

/** Finds the command string argument for a shell `-c` option, including
 * bundled short options such as `-lc` and `-xc`. */
function findShellCommandArgument(tokens, start) {
  for (let index = start + 1; index < tokens.length; index += 1) {
    const arg = tokens[index];
    if (arg === '--') return -1;
    if (arg === '-c' || /^-[^-]*c/.test(arg)) return index + 1;
    if (arg === '--rcfile' || arg === '--init-file' || arg === '-o' || arg === '-O') {
      index += 1;
    }
  }
  return -1;
}

/**
 * Quote-aware destructive check: catches quoted command words, newline
 * separators, quoted `find -exec`, and `sh -c`/`bash -c` wrappers that evade
 * the quote-stripping path (GHSA-4v57-ph3x-gf55).
 *
 * @param {string} raw
 * @param {number} [depth] recursion guard for shell -c wrappers
 * @returns {boolean}
 */
function isDestructiveQuoteAware(raw, depth = 0) {
  if (depth > 4) return false;
  for (const tokens of quoteAwareSegments(raw)) {
    if (tokens.length === 0) continue;
    if (isDestructiveRm(tokens)) return true;
    if (isDestructiveGit(tokens)) return true;
    if (isDestructiveSqlClient(tokens)) return true;
    if (isDestructiveFindDelete(tokens)) return true;
    if (isDestructiveFindExecTokens(tokens)) return true;
    if (isDestructiveIaC(tokens)) return true;
    const wi = unwrapLeadWrappers(tokens);
    const base = wi < tokens.length ? commandBasename(tokens[wi]) : '';
    if (SHELL_WRAPPERS.has(base)) {
      const ci = findShellCommandArgument(tokens, wi);
      if (ci !== -1 && tokens[ci] && isDestructiveQuoteAware(tokens[ci], depth + 1)) {
        return true;
      }
    }
  }
  return false;
}

/**
 * Strip a leading path and trailing `.exe` from a command token so
 * `/usr/bin/git`, `git.exe`, and `GIT` all normalize to `git`.
 *
 * @param {string} token
 * @returns {string}
 */
function commandBasename(token) {
  if (!token) return '';
  return token
    .replace(/^.*[\\/]/, '')
    .replace(/\.exe$/i, '')
    .toLowerCase();
}

/**
 * Detect `rm` invocations that recursively force-delete files. Handles
 * combined (`-rf`, `-fr`, `-Rf`) and split (`-r -f`) flag forms.
 *
 * @param {string[]} tokens
 * @returns {boolean}
 */
function isDestructiveRm(tokens) {
  if (tokens.length === 0 || commandBasename(tokens[0]) !== 'rm') return false;
  let hasR = false;
  let hasF = false;
  for (const t of tokens.slice(1)) {
    if (t === '--recursive') {
      hasR = true;
      continue;
    }
    if (t === '--force') {
      hasF = true;
      continue;
    }
    if (!t.startsWith('-') || t.startsWith('--')) continue;
    const body = t.slice(1);
    if (/[rR]/.test(body)) hasR = true;
    if (/f/.test(body)) hasF = true;
  }
  return hasR && hasF;
}

/**
 * Locate the git subcommand within a token list, skipping over git's
 * global options like `-c key=value`, `-C <path>`, `--git-dir=...`,
 * `--work-tree=...`, `--namespace=...`, `--super-prefix=...`.
 *
 * @param {string[]} tokens
 * @returns {{ command: string, rest: string[] } | null}
 */
function findGitSubcommand(tokens) {
  if (tokens.length === 0 || commandBasename(tokens[0]) !== 'git') return null;
  const valueConsumingShort = new Set(['-c', '-C']);
  const valueConsumingLong = new Set(['--git-dir', '--work-tree', '--namespace', '--super-prefix']);
  let i = 1;
  while (i < tokens.length) {
    const t = tokens[i];
    if (valueConsumingShort.has(t) || valueConsumingLong.has(t)) {
      i += 2;
      continue;
    }
    if (t.startsWith('--git-dir=') || t.startsWith('--work-tree=') || t.startsWith('--namespace=') || t.startsWith('--super-prefix=')) {
      i += 1;
      continue;
    }
    if (t.startsWith('-')) {
      // Unknown global option — skip without consuming a value.
      i += 1;
      continue;
    }
    return { command: t.toLowerCase(), rest: tokens.slice(i + 1) };
  }
  return null;
}

/**
 * Branch names treated as shared history: a forced update of one of
 * these rewrites commits other clones build on, even when the push is
 * lease-checked.
 */
const SHARED_GIT_BRANCHES = new Set(['main', 'master', 'develop', 'trunk']);

/**
 * Decide whether the positional arguments of a `git push` name a shared
 * branch as the destination of a refspec. The first positional token is
 * the remote (unless the remote came from `--repo`); every later
 * positional token is a refspec whose destination is the part after
 * `:` (or the whole token when there is no `:`). A leading `+` force
 * marker is stripped. When no refspec is given the target is the
 * current branch, which the hook cannot know, so this returns false.
 *
 * @param {string[]} rest tokens after `push`
 * @returns {boolean}
 */
function pushTargetsSharedBranch(rest) {
  const valueConsuming = new Set(['-o', '--push-option', '--receive-pack', '--exec']);
  const positional = [];
  let remoteViaFlag = false;
  for (let i = 0; i < rest.length; i++) {
    const t = rest[i];
    if (t === '--repo') {
      remoteViaFlag = true;
      i += 1;
      continue;
    }
    if (t.startsWith('--repo=')) {
      remoteViaFlag = true;
      continue;
    }
    if (valueConsuming.has(t)) {
      i += 1;
      continue;
    }
    if (t.startsWith('-')) continue;
    positional.push(t);
  }
  // Unless the remote came from --repo, positional[0] is the remote and
  // the rest are refspecs.
  const refspecs = remoteViaFlag ? positional : positional.slice(1);
  for (const refspec of refspecs) {
    const cleaned = refspec.startsWith('+') ? refspec.slice(1) : refspec;
    const dst = cleaned.includes(':') ? cleaned.slice(cleaned.indexOf(':') + 1) : cleaned;
    const branch = dst.startsWith('refs/heads/') ? dst.slice('refs/heads/'.length) : dst;
    if (SHARED_GIT_BRANCHES.has(branch)) return true;
  }
  return false;
}

/**
 * Detect destructive `git` invocations: `reset --hard`, `checkout --`,
 * `clean -f...`, `push --force` (`--force-with-lease` only to a shared
 * branch), `commit --amend`, `rm -rf`, `branch -D`, `stash drop` /
 * `stash clear`, `reflog expire` / `reflog delete`, `update-ref -d`,
 * and `restore` against the worktree.
 *
 * @param {string[]} tokens
 * @returns {boolean}
 */
function isDestructiveGit(tokens) {
  const sub = findGitSubcommand(tokens);
  if (!sub) return false;
  const { command, rest } = sub;

  if (command === 'reset') {
    return rest.includes('--hard');
  }

  if (command === 'checkout') {
    // `git checkout -- <path>`, `git checkout .`, and the force forms
    // (`--force` / `-f`) all discard uncommitted working-tree changes,
    // mirroring the `switch` handler below.
    return rest.some(t => {
      if (t === '--' || t === '.' || t === '--force') return true;
      if (!t.startsWith('-') || t.startsWith('--')) return false;
      return t.slice(1).includes('f');
    });
  }

  if (command === 'clean') {
    // `git clean -f`, `-fd`, `-fdx`, `-df`, `--force`
    return rest.some(t => {
      if (t === '--force') return true;
      if (!t.startsWith('-') || t.startsWith('--')) return false;
      return t.slice(1).includes('f');
    });
  }

  if (command === 'push') {
    // Only `--force-with-lease` qualifies as a safety-checked force.
    // `--force-if-includes` is a no-op when used WITHOUT
    // `--force-with-lease` (per git-scm.com/docs/git-push), and when
    // combined with a bare `--force` the bare force is still in effect.
    // So `--force --force-if-includes` must be treated as destructive.
    //
    // A `+` refspec prefix (e.g. `git push origin +main`,
    // `+refs/heads/main:refs/heads/main`) also forces a non-fast-forward
    // update of that ref and is destructive on its own.
    let withLease = false;
    let bareForce = false;
    let plusRefspecForce = false;
    for (const t of rest) {
      if (t === '--force-with-lease' || t.startsWith('--force-with-lease=')) {
        withLease = true;
        continue;
      }
      if (t === '--force' || t.startsWith('--force=')) {
        bareForce = true;
        continue;
      }
      if (t.startsWith('-') && !t.startsWith('--') && t.slice(1).includes('f')) {
        bareForce = true;
        continue;
      }
      // Refspec prefix: `+<src>[:<dst>]`. Match tokens like `+main`,
      // `+refs/heads/main`, `+HEAD:branch`, `+:branch`. Exclude bare
      // `+` and numeric-only `+123` which are not refspecs.
      if (t.startsWith('+') && t.length > 1 && /^\+(?:[a-zA-Z_/.:]|HEAD)/.test(t)) {
        plusRefspecForce = true;
      }
    }
    if (bareForce || (plusRefspecForce && !withLease)) return true;
    // A lease-checked force still rewrites a shared branch's history.
    return withLease && pushTargetsSharedBranch(rest);
  }

  if (command === 'commit') {
    return rest.includes('--amend');
  }

  if (command === 'rm') {
    // `git rm -r` / `-rf` / `-r -f` — destructive within the index too.
    let hasR = false;
    for (const t of rest) {
      if (!t.startsWith('-') || t.startsWith('--')) continue;
      if (/[rR]/.test(t.slice(1))) hasR = true;
    }
    return hasR;
  }

  if (command === 'switch') {
    // `git switch` can discard local working-tree changes in three forms:
    //   --discard-changes           explicit discard
    //   --force / -f                ignore conflicts and overwrite
    //   -C <branch>                 force-create (overwrites existing branch)
    return rest.some(t => {
      if (t === '--discard-changes' || t === '--force') return true;
      if (!t.startsWith('-') || t.startsWith('--')) return false;
      // Short combined form: -f, -fC, -Cf, -C
      const body = t.slice(1);
      return /[fC]/.test(body);
    });
  }

  if (command === 'branch') {
    // `git branch -D` (long spelling: `--delete --force`) deletes a
    // branch even when it is unmerged, orphaning its commits. Plain
    // `-d` refuses when unmerged, so it is safe to leave ungated.
    let del = false;
    let force = false;
    for (const t of rest) {
      if (t === '--delete') { del = true; continue; }
      if (t === '--force') { force = true; continue; }
      if (!t.startsWith('-') || t.startsWith('--')) continue;
      const body = t.slice(1);
      if (body.includes('D')) return true;
      if (body.includes('d')) del = true;
      if (body.includes('f')) force = true;
    }
    return del && force;
  }

  if (command === 'stash') {
    // `drop` destroys one stash entry, `clear` the entire stash.
    // `list`, `show`, `pop` and `apply` keep the entries recoverable.
    return rest[0] === 'drop' || rest[0] === 'clear';
  }

  if (command === 'reflog') {
    // `expire` and `delete` remove the recovery net that makes every
    // other gated git command recoverable.
    return rest[0] === 'expire' || rest[0] === 'delete';
  }

  if (command === 'update-ref') {
    // `git update-ref -d <ref>` deletes a ref directly.
    return rest.includes('-d') || rest.includes('--delete');
  }

  if (command === 'restore') {
    // `git restore <path>` overwrites the working tree from the index
    // by default, the modern spelling of gated `git checkout -- <path>`.
    // Only `--staged` alone is non-destructive (it leaves the file on
    // disk untouched); `--worktree` (the default target) is destructive.
    const has = (long, short) => rest.some(t =>
      t === long || (t.startsWith('-') && !t.startsWith('--') && t.slice(1).includes(short)));
    const staged = has('--staged', 'S');
    const worktree = has('--worktree', 'W');
    return worktree || !staged;
  }

  return false;
}

/**
 * Decide whether a bash command line contains a destructive action
 * the fact-forcing gate should challenge. Combines SQL-keyword
 * detection (regex on quote-stripped input) with per-segment shell
 * tokenization for shell commands.
 *
 * @param {string} command
 * @returns {boolean}
 */
/**
 * Walk every executable body reachable from a raw command line and
 * return them as a flat list. Bodies that bash will execute live in
 * three different syntactic constructs, each handled by a sibling
 * extractor in `scripts/lib/shell-substitution.js`:
 *   - `$(...)` and backticks via `extractCommandSubstitutions`
 *   - plain `(...)` subshells   via `extractSubshellGroups`
 *   - `{ ...; }` brace groups   via `extractBraceGroups`
 *
 * Each extractor recurses into its own syntax. The BFS here adds
 * cross-syntax discovery — e.g. a `(...)` inside a `$(...)` body, or
 * a `{ ...; }` inside a `(...)` body — by feeding every harvested
 * body back through all three extractors. A `seen` set bounds the
 * cost to O(unique bodies).
 *
 * @param {string} raw
 * @returns {string[]}
 */
function collectExecutableBodies(raw) {
  const bodies = [raw];
  const queue = [raw];
  const seen = new Set();

  while (queue.length) {
    const current = queue.shift();
    if (seen.has(current)) continue;
    seen.add(current);

    for (const body of extractCommandSubstitutions(current)) {
      if (seen.has(body)) continue;
      bodies.push(body);
      queue.push(body);
    }
    for (const body of extractSubshellGroups(current)) {
      if (seen.has(body)) continue;
      bodies.push(body);
      queue.push(body);
    }
    for (const body of extractBraceGroups(current)) {
      if (seen.has(body)) continue;
      bodies.push(body);
      queue.push(body);
    }
  }

  return bodies;
}

/** Detects destructive commands inside one `find` execution clause. */
function isDestructiveFindExecCommand(execTokens) {
  if (!Array.isArray(execTokens) || execTokens.length === 0) return false;
  const start = unwrapLeadWrappers(execTokens);
  if (start >= execTokens.length) return false;

  const baseCmd = commandBasename(execTokens[start]);
  if (baseCmd === 'rmdir' || baseCmd === 'unlink' || baseCmd === 'rm') return true;

  if (baseCmd === 'git') {
    const sub = findGitSubcommand(execTokens.slice(start));
    if (sub && sub.command === 'reset' && sub.rest.includes('--hard')) return true;
  }

  if (SHELL_WRAPPERS.has(baseCmd)) {
    const commandIndex = findShellCommandArgument(execTokens, start);
    if (commandIndex !== -1 && execTokens[commandIndex]
      && isDestructiveQuoteAware(execTokens[commandIndex], 1)) {
      return true;
    }
  }

  return false;
}

/** Detects destructive commands in all `find -exec/-execdir/-ok` clauses. */
function isDestructiveFindExecTokens(tokens) {
  if (!Array.isArray(tokens)) return false;
  const start = unwrapLeadWrappers(tokens);
  if (start >= tokens.length || commandBasename(tokens[start] || '') !== 'find') return false;

  for (let index = start + 1; index < tokens.length; index += 1) {
    if (!FIND_EXEC_OPERATORS.has(tokens[index])) continue;
    const execTokens = [];
    for (index += 1; index < tokens.length; index += 1) {
      const token = tokens[index];
      if (FIND_EXEC_TERMINATORS.has(token)) break;
      execTokens.push(token);
    }
    if (isDestructiveFindExecCommand(execTokens)) return true;
  }
  return false;
}

/** Detects destructive commands inside a raw `find` command segment. */
function isDestructiveFindExec(command) {
  return quoteAwareSegments(String(command || '')).some(isDestructiveFindExecTokens);
}

function isDestructiveBash(command) {
  // The SQL/dd phrases live in command bodies, not as flag-bearing
  // arguments, so we still match them by regex — but on the input
  // after quoting AND subshell delimiters are normalized so phrases
  // inside `$(...)` or backticks are also caught.
  const raw = String(command || '');
  const executable = stripHeredocBodies(raw);
  const flattened = explodeSubshells(stripQuotedStrings(executable));
  if (DESTRUCTIVE_SQL_DD.test(flattened)) return true;

  // Operator-supplied additional destructive patterns. Same scope as the
  // built-in SQL/dd regex: matched against the quote-stripped, subshell-
  // exploded command so a phrase inside `$(...)` or backticks is caught.
  const extra = getExtraDestructiveRegex();
  if (extra && extra.test(flattened)) return true;

  // Check for destructive find -exec patterns on raw body segments (before quote-stripping)
  // so that quoted exec binaries and compound-command prefixes are both handled correctly.
  // splitCommandSegments strips quotes before splitting, so passing its output to
  // isDestructiveFindExec would turn `find . -exec 'rm' {} \;` into `find . -exec  {} \;`
  // — the binary name disappears and the check returns false.  Using raw body text avoids
  // that false-negative while also catching `&&`, `;`, `|`, and `||` compound forms.
  const bodies = collectExecutableBodies(executable);
  for (const body of bodies) {
    for (const rawSeg of body
      .split(/[;|&]+/)
      .map(s => s.trim())
      .filter(Boolean)) {
      if (isDestructiveFindExec(rawSeg)) return true;
    }
  }

  const segments = bodies.flatMap(splitCommandSegments);
  for (const segment of segments) {
    const stripped = stripQuotedStrings(segment);
    if (DESTRUCTIVE_SQL_DD.test(stripped)) return true;
    if (extra && extra.test(stripped)) return true;
    const tokens = tokenize(segment);
    if (isDestructiveFindDelete(tokens)) return true;
    if (isDestructiveRm(tokens)) return true;
    if (isDestructiveGit(tokens)) return true;
    if (isDestructiveIaC(tokens)) return true;
  }

  // Quote-aware pass: closes the quoted-command-word, newline-separator,
  // quoted-find-exec, and sh/bash -c bypasses (GHSA-4v57-ph3x-gf55).
  if (isDestructiveQuoteAware(executable)) return true;

  return false;
}

/** Detects `find ... -delete`, which mutates matched paths directly. */
function isDestructiveFindDelete(tokens) {
  if (!Array.isArray(tokens)) return false;
  const start = unwrapLeadWrappers(tokens);
  if (start >= tokens.length || commandBasename(tokens[start] || '') !== 'find') return false;
  for (let index = start + 1; index < tokens.length; index += 1) {
    if (FIND_EXEC_OPERATORS.has(tokens[index])) {
      for (index += 1; index < tokens.length; index += 1) {
        if (FIND_EXEC_TERMINATORS.has(tokens[index])) break;
      }
      continue;
    }
    if (tokens[index].toLowerCase() === '-delete') return true;
  }
  return false;
}

/**
 * Return the stable, non-sensitive rule IDs that drive the destructive gate.
 * PowerShell also passes through the existing Bash-compatible classifier so
 * shell-agnostic git, SQL, and operator-configured rules retain coverage.
 * Governance consumes this exact decision for PowerShell approval evidence.
 *
 * @param {string} toolName
 * @param {string} command
 * @returns {string[]}
 */
function classifyDestructiveCommand(toolName, command) {
  const normalizedTool = String(toolName || '').toLowerCase();
  if (normalizedTool !== 'bash' && normalizedTool !== 'powershell') return [];

  const findings = [
    ...(isDestructiveBash(command) ? ['gateguard.bash-compatible-destructive'] : []),
    ...(normalizedTool === 'powershell' ? classifyPowerShellDestructiveCommand(command) : []),
  ];
  return [...new Set(findings)];
}

// --- State management (per-session, atomic writes, bounded) ---

function normalizeEnvValue(value) {
  return String(value || '')
    .trim()
    .toLowerCase();
}

function isGateGuardDisabled() {
  if (normalizeEnvValue(process.env.GATEGUARD_DISABLED) === '1') {
    return true;
  }

  return ECC_DISABLE_VALUES.has(normalizeEnvValue(process.env.ECC_GATEGUARD));
}

function sanitizeSessionKey(value) {
  const raw = String(value || '').trim();
  if (!raw) {
    return '';
  }

  const sanitized = raw.replace(/[^a-zA-Z0-9_-]/g, '_');
  if (sanitized && sanitized.length <= 64) {
    return sanitized;
  }

  return hashSessionKey('sid', raw);
}

function hashSessionKey(prefix, value) {
  return `${prefix}-${crypto.createHash('sha256').update(String(value)).digest('hex').slice(0, 24)}`;
}

function resolveSessionKey(data) {
  const directCandidates = [data && data.session_id, data && data.sessionId, data && data.session && data.session.id, process.env.CLAUDE_SESSION_ID, process.env.ECC_SESSION_ID];

  for (const candidate of directCandidates) {
    const sanitized = sanitizeSessionKey(candidate);
    if (sanitized) {
      return sanitized;
    }
  }

  const transcriptPath = (data && (data.transcript_path || data.transcriptPath)) || process.env.CLAUDE_TRANSCRIPT_PATH;
  if (transcriptPath && String(transcriptPath).trim()) {
    return hashSessionKey('tx', path.resolve(String(transcriptPath).trim()));
  }

  const projectFingerprint = process.env.CLAUDE_PROJECT_DIR || process.cwd();
  return hashSessionKey('proj', path.resolve(projectFingerprint));
}

function getStateFile(data) {
  if (!activeStateFile) {
    const sessionKey = resolveSessionKey(data);
    activeStateFile = path.join(STATE_DIR, `state-${sessionKey}.json`);
  }
  return activeStateFile;
}

function loadState() {
  const stateFile = getStateFile();
  const lockFile = `${stateFile}.lock`;
  const emptyState = () => ({ checked: [], last_active: Date.now() });
  try {
    return withStateFileLock(lockFile, () => {
      return loadStateUnlocked(stateFile, emptyState);
    });
  } catch (_) {
    /* ignore */
  }
  return emptyState();
}

function loadStateUnlocked(stateFile, emptyState = () => ({ checked: [], last_active: Date.now() })) {
  restoreStateBackup(stateFile);
  if (!fs.existsSync(stateFile)) return emptyState();
  try {
    const state = JSON.parse(fs.readFileSync(stateFile, 'utf8'));
    if (Date.now() - (state.last_active || 0) > SESSION_TIMEOUT_MS) {
      fs.unlinkSync(stateFile);
      return emptyState();
    }
    return state;
  } catch (_) {
    /* ignore malformed or transient disk state */
    return emptyState();
  }
}

function pruneCheckedEntries(checked) {
  if (checked.length <= MAX_CHECKED_ENTRIES) {
    return checked;
  }

  const preserved = checked.includes(ROUTINE_BASH_SESSION_KEY) ? [ROUTINE_BASH_SESSION_KEY] : [];
  const sessionKeys = checked.filter(k => k.startsWith('__') && k !== ROUTINE_BASH_SESSION_KEY);
  const fileKeys = checked.filter(k => !k.startsWith('__'));
  const remainingSessionSlots = Math.max(MAX_SESSION_KEYS - preserved.length, 0);
  const cappedSession = sessionKeys.slice(-remainingSessionSlots);
  const remainingFileSlots = Math.max(MAX_CHECKED_ENTRIES - preserved.length - cappedSession.length, 0);
  const cappedFiles = fileKeys.slice(-remainingFileSlots);
  return [...preserved, ...cappedSession, ...cappedFiles];
}

function saveState(state) {
  const stateFile = getStateFile();
  try {
    return withStateFileLock(`${stateFile}.lock`, () => saveStateUnlocked(state, stateFile));
  } catch (err) {
    process.stderr.write(`[GateGuard] State persistence failed: ${err.message}\n`);
    return false;
  }
}

function saveStateUnlocked(state, stateFile) {
  fs.mkdirSync(STATE_DIR, { recursive: true });
  restoreStateBackup(stateFile);
  let diskState = {};
  try {
    if (fs.existsSync(stateFile)) diskState = JSON.parse(fs.readFileSync(stateFile, 'utf8'));
  } catch (_) {
    /* Ignore malformed state and retain the in-memory snapshot. */
  }

  const now = Date.now();
  const readFiles = normalizeReadFiles(diskState.read_files);
  const memoryReadFiles = normalizeReadFiles(state.read_files);
  const scopePasses = mergeTimestampMaps(diskState.scope_passes, state.scope_passes);
  const mergedEvidence = dedupeEvidence([
    ...(Array.isArray(diskState.evidence) ? diskState.evidence : []),
    ...(Array.isArray(state.evidence) ? state.evidence : [])
  ]);
  const finalState = {
    checked: pruneCheckedEntries(Array.from(new Set([
      ...(Array.isArray(diskState.checked) ? diskState.checked : []),
      ...(Array.isArray(state.checked) ? state.checked : [])
    ]))),
    last_active: Math.max(Number(diskState.last_active) || 0, Number(state.last_active) || 0, now),
    fact_force_denials: Math.max(getDenialCount(diskState), getDenialCount(state)),
    evidence: pruneEvidence(mergedEvidence, now),
    read_files: pruneReadFiles(mergeTimestampMaps(readFiles, memoryReadFiles), now),
    scope_passes: scopePasses
  };

  writeStateToDiskAtomic(stateFile, finalState);
  return true;
}

function normalizeReadFiles(readFiles) {
  if (Array.isArray(readFiles)) {
    const now = Date.now();
    const entries = readFiles.filter(file => typeof file === 'string' && path.isAbsolute(file));
    return Object.fromEntries(entries.map(file => [file.replace(/\\/g, '/'), now]));
  }
  if (!readFiles || typeof readFiles !== 'object') return {};
  return Object.fromEntries(Object.entries(readFiles)
    .filter(([file, timestamp]) => path.isAbsolute(file) && typeof timestamp === 'number')
    .map(([file, timestamp]) => [file.replace(/\\/g, '/'), timestamp]));
}

function markChecked(key) {
  const state = loadState();
  if (!state.checked.includes(key)) {
    state.checked.push(key);
    return saveState(state);
  }
  return true;
}

// --- Fact-force denial dampening (#2142) ---
//
// In long sessions the near-identical four-fact deny blocks accumulate in
// the context window and measurably raise the odds of the model dropping
// into a degenerate repetition loop. Emit the full four-fact block only for
// the first GATEGUARD_FACT_FORCE_FULL_DENIALS denials per session (default
// 3); afterwards emit a condensed single-line denial that carries the
// denial ordinal, so consecutive denials are structurally different and
// never textually identical. True retries of an already-gated target are
// unaffected (they were always allowed). Destructive shell and routine shell
// gates are not denial-dampened.

const DEFAULT_FULL_DENIALS = 3;

function getFullDenialBudget() {
  const raw = Number.parseInt(process.env.GATEGUARD_FACT_FORCE_FULL_DENIALS || '', 10);
  if (Number.isInteger(raw) && raw >= 0) {
    return raw;
  }
  return DEFAULT_FULL_DENIALS;
}

function getDenialCount(state) {
  const n = Number(state && state.fact_force_denials);
  return Number.isFinite(n) && n >= 0 ? Math.floor(n) : 0;
}

/**
 * Record a first-touch target AND count the fact-force denial in the same
 * state write. Returns the new denial ordinal (1-based) plus whether the
 * write persisted.
 */
function markCheckedAndCountDenial(key) {
  const stateFile = getStateFile();
  const emptyState = () => ({ checked: [], last_active: Date.now() });
  try {
    return withStateFileLock(`${stateFile}.lock`, () => {
      const state = loadStateUnlocked(stateFile, emptyState);
      const checked = Array.isArray(state.checked) ? state.checked : [];
      const updated = {
        ...state,
        checked: checked.includes(key) ? checked : [...checked, key],
        fact_force_denials: getDenialCount(state) + 1,
        last_active: Date.now()
      };
      return { ok: saveStateUnlocked(updated, stateFile), denials: updated.fact_force_denials };
    });
  } catch (err) {
    process.stderr.write(`[GateGuard] State persistence failed: ${err.message}\n`);
    return { ok: false, denials: 0 };
  }
}

function isChecked(key) {
  const state = loadState();
  const found = state.checked.includes(key);
  if (found && Date.now() - (state.last_active || 0) > READ_HEARTBEAT_MS) {
    saveState(state);
  }
  return found;
}

// Prune stale session files older than 1 hour
(function pruneStaleFiles() {
  try {
    const files = fs.readdirSync(STATE_DIR);
    const now = Date.now();
    for (const f of files) {
      const isStateFile = f.startsWith('state-') && (f.endsWith('.json') || f.includes('.json.tmp.'));
      if (!isStateFile) continue;
      const fp = path.join(STATE_DIR, f);
      try {
        const stat = fs.statSync(fp);
        if (now - stat.mtimeMs > SESSION_TIMEOUT_MS * 2) {
          if (f.endsWith('.json')) {
            withStateFileLock(`${fp}.lock`, () => {
              if (fs.existsSync(fp) && Date.now() - fs.statSync(fp).mtimeMs > SESSION_TIMEOUT_MS * 2) {
                fs.unlinkSync(fp);
              }
            });
          } else {
            fs.unlinkSync(fp);
          }
        }
      } catch (_) {
        // Ignore files that disappear between readdir/stat/unlink.
      }
    }
  } catch (_) {
    /* ignore */
  }
})();

// --- Sanitize file path against injection ---

// Unicode policy for sanitizePath, mirroring the repo-wide dangerous set in
// scripts/ci/check-unicode-safety.js. Named so the ranges stay auditable and
// drift against the CI policy is visible in one place.
const ASCII_CONTROL_MAX = 0x1f;
const ASCII_DELETE = 0x7f;
const C1_CONTROLS = [0x80, 0x9f]; // Unicode C1 control block (U+0080..U+009F)
const BIDI_MARKS = [0x200e, 0x200f]; // LRM/RLM
const BIDI_EMBEDDINGS = [0x202a, 0x202e]; // LRE..PDF
const BIDI_ISOLATES = [0x2066, 0x2069]; // LRI..PDI
const ZERO_WIDTHS = [0x200b, 0x200d]; // ZWSP..ZWJ
const WORD_JOINER = 0x2060;
const BYTE_ORDER_MARK = 0xfeff;
const VARIATION_SELECTORS = [0xfe00, 0xfe0f];
const VARIATION_SUPPLEMENTS = [0xe0100, 0xe01ef]; // MONGOLIAN..TAGS (VS17..VS256)
const TAG_BLOCK = [0xe0000, 0xe007f]; // ASCII-smuggling tag characters
const MONGOLIAN_VOWEL_SEPARATOR = 0x180e;
const HANGUL_CHOSEONG_FILLER = 0x115f;
const HANGUL_JUNGSEONG_FILLER = 0x1160;
const HANGUL_FILLER = 0x3164;
const INVISIBLE_MATH_OPERATORS = [0x2061, 0x2064]; // FUNCTION APPLICATION..INVISIBLE PLUS
const LINE_SEPARATOR = 0x2028;
const PARAGRAPH_SEPARATOR = 0x2029;
const SANITIZED_PATH_MAX_LENGTH = 500;

function inRange(code, [lo, hi]) {
  return code >= lo && code <= hi;
}

function sanitizePath(filePath) {
  // Strip control chars (including null), bidi overrides, separators,
  // and the dangerous invisible characters defined by the constants
  // above (mirroring scripts/ci/check-unicode-safety.js), so a denial
  // message cannot carry content a human reviewer cannot see.
  let sanitized = '';
  for (const char of String(filePath || '')) {
    const code = char.codePointAt(0);
    const isAsciiControl =
      code <= ASCII_CONTROL_MAX || code === ASCII_DELETE || inRange(code, C1_CONTROLS);
    const isBidiOverride =
      inRange(code, BIDI_MARKS) || inRange(code, BIDI_EMBEDDINGS) || inRange(code, BIDI_ISOLATES);
    const isUnicodeSeparator = code === LINE_SEPARATOR || code === PARAGRAPH_SEPARATOR;
    const isDangerousInvisible =
      inRange(code, ZERO_WIDTHS) ||
      code === WORD_JOINER ||
      code === BYTE_ORDER_MARK ||
      inRange(code, VARIATION_SELECTORS) ||
      inRange(code, VARIATION_SUPPLEMENTS) ||
      inRange(code, TAG_BLOCK) ||
      code === MONGOLIAN_VOWEL_SEPARATOR ||
      code === HANGUL_CHOSEONG_FILLER ||
      code === HANGUL_JUNGSEONG_FILLER ||
      code === HANGUL_FILLER ||
      inRange(code, INVISIBLE_MATH_OPERATORS);
    sanitized += isAsciiControl || isBidiOverride || isUnicodeSeparator || isDangerousInvisible ? ' ' : char;
  }
  return sanitized.trim().slice(0, SANITIZED_PATH_MAX_LENGTH);
}

function normalizeForMatch(value) {
  return String(value || '')
    .replace(/\\/g, '/')
    .toLowerCase();
}

function isClaudeSettingsPath(filePath) {
  const normalized = normalizeForMatch(filePath);
  return /(^|\/)\.claude\/settings(?:\.[^/]+)?\.json$/.test(normalized);
}

function isReadOnlyGitIntrospection(command) {
  const trimmed = String(command || '').trim();
  if (!trimmed || /[\r\n;&|><`$()]/.test(trimmed)) {
    return false;
  }

  const segments = splitCommandSegments(trimmed);
  if (segments.length !== 1) {
    return false;
  }

  const tokens = tokenizeAllowlistedShellWords(trimmed);
  if (!tokens) {
    return false;
  }
  if (commandBasename(tokens[0]) !== 'git' || tokens.length < 2) {
    return false;
  }

  const subcommand = tokens[1].toLowerCase();
  const args = tokens.slice(2);

  if (subcommand === 'status') {
    return args.every(arg => ['--porcelain', '--short', '--branch'].includes(arg));
  }

  if (subcommand === 'diff') {
    const allowedDiffArgs = new Set(['--name-only', '--name-status', '--cached', '--staged', '--stat']);
    // git diff without arguments is read-only introspection
    if (args.length === 0) return true;
    return args.length <= 2 && args.every(arg => allowedDiffArgs.has(arg));
  }

  if (subcommand === 'log') {
    return args.every(arg => arg === '--oneline' || /^--max-count=\d+$/.test(arg));
  }

  if (subcommand === 'show') {
    // Permite: git show <ref>, git show --stat, git show --name-only,
    // git show <ref> --stat, git show <ref> --name-only
    if (args.length === 0) return false;
    if (args.length === 1) {
      const arg = args[0];
      if (arg === '--stat' || arg === '--name-only') return true;
      // ref
      return !arg.startsWith('--') && /^[a-zA-Z0-9._:/ -]+$/.test(arg);
    }
    if (args.length === 2) {
      const [first, second] = args;
      // ref + flag
      if (!first.startsWith('--') && /^[a-zA-Z0-9._:/ -]+$/.test(first) && (second === '--stat' || second === '--name-only')) {
        return true;
      }
      return false;
    }
    return false;
  }

  if (subcommand === 'branch') {
    return args.length === 1 && args[0] === '--show-current';
  }

  if (subcommand === 'rev-parse') {
    return args.length === 2 && args[0] === '--abbrev-ref' && /^head$/i.test(args[1]);
  }

  return false;
}

// --- Gate messages ---

/**
 * Batch-consistency warning (#3136). A first-touch denial marks the file
 * checked so the retry passes; a parallel batch of edits to one
 * not-yet-touched file therefore partially applies (first call denied,
 * siblings allowed). Hooks see calls one at a time and cannot lock a
 * batch, so the denial must say this out loud: name the file and tell
 * the agent that siblings may already have been applied.
 */
function batchSiblingWarning(safePath) {
  return (
    `If this call was sent in a parallel batch, other edits to ${safePath} from that batch ` +
    'may already have been applied. Re-read the file before building on them.'
  );
}

function editGateMsg(filePath) {
  const safe = sanitizePath(filePath);
  return [
    '[Fact-Forcing Gate]',
    '',
    `Before editing ${safe}, present these facts:`,
    '',
    '1. List ALL files that import/require this file (search the tree — Glob/Grep, or find/grep via Bash)',
    '2. List the public functions/classes affected by this change',
    '3. If this file reads/writes data files, show field names, structure, and date format (use redacted or synthetic values, not raw production data)',
    "4. Quote the user's current instruction verbatim",
    '',
    batchSiblingWarning(safe),
    '',
    'Present the facts, then retry the same operation.'
  ].join('\n');
}

function writeGateMsg(filePath) {
  const safe = sanitizePath(filePath);
  return [
    '[Fact-Forcing Gate]',
    '',
    `Before creating ${safe}, present these facts:`,
    '',
    '1. Name the file(s) and line(s) that will call this new file',
    '2. Confirm no existing file serves the same purpose (search the tree — Glob/Grep, or find/grep via Bash)',
    '3. If this file reads/writes data files, show field names, structure, and date format (use redacted or synthetic values, not raw production data)',
    "4. Quote the user's current instruction verbatim",
    '',
    batchSiblingWarning(safe),
    '',
    'Present the facts, then retry the same operation.'
  ].join('\n');
}

/**
 * Condensed single-line denial used after the full-block budget is spent
 * (#2142). Carries the denial ordinal so consecutive denials differ
 * textually, and a one-line recovery hint instead of the multi-line block.
 */
function condensedGateMsg(action, filePath, ordinal) {
  const safe = sanitizePath(filePath);
  return (
    `[Fact-Forcing Gate] (denial #${ordinal} this session) First ${action} of ${safe}: ` +
    "briefly state importers/callers, affected API, data schemas if any, and the user's verbatim instruction, then retry. " +
    `${batchSiblingWarning(safe)} ` +
    '(Use GATEGUARD_EXEMPT_GLOBS for path-scoped exemptions; ECC_GATEGUARD=off disables this gate.)'
  );
}

function destructiveBashMsg() {
  return [
    '[Fact-Forcing Gate]',
    '',
    'Destructive command detected. Before running, present:',
    '',
    '1. List all files/data this command will modify or delete',
    '2. Write a one-line rollback procedure',
    "3. Quote the user's current instruction verbatim",
    '',
    'Present the facts, then retry the same operation.'
  ].join('\n');
}

function routineShellMsg(toolName) {
  const shellName = toolName === 'PowerShell' ? 'PowerShell' : 'Bash';
  return [
    '[Fact-Forcing Gate]',
    '',
    `Before the first ${shellName} command this session, present these facts:`,
    '',
    '1. The current user request in one sentence',
    '2. What this specific command verifies or produces',
    '',
    'Present the facts, then retry the same operation.'
  ].join('\n');
}

function withRecoveryHint(message, hookIds = [EDIT_WRITE_HOOK_ID], narrowRecoveryHint = '') {
  const disableTargets = hookIds.map(hookId => `\`${hookId}\``).join(' or ');
  const recoveryLines = narrowRecoveryHint ? [narrowRecoveryHint, ''] : [];
  return [
    message,
    '',
    ...recoveryLines,
    `Recovery: if GateGuard is blocking setup or repair work, run this session with \`ECC_GATEGUARD=off\` or add ${disableTargets} to \`ECC_DISABLED_HOOKS\`.`
  ].join('\n');
}

function isSubagentInvocation(data) {
  if (!data || typeof data !== 'object') {
    return false;
  }

  const candidates = [data.agent_id, data.agentId, data.parent_tool_use_id, data.parentToolUseId];

  return candidates.some(candidate => typeof candidate === 'string' && candidate.trim());
}

// --- Deny helper ---

function denyResult(reason, options = {}) {
  const includeRecoveryHint = options.includeRecoveryHint !== false;
  const hookIds = Array.isArray(options.hookIds) && options.hookIds.length > 0 ? options.hookIds : [EDIT_WRITE_HOOK_ID];
  const narrowRecoveryHint = typeof options.narrowRecoveryHint === 'string' ? options.narrowRecoveryHint : '';
  return {
    stdout: JSON.stringify({
      hookSpecificOutput: {
        hookEventName: 'PreToolUse',
        permissionDecision: 'deny',
        permissionDecisionReason: includeRecoveryHint
          ? withRecoveryHint(reason, hookIds, narrowRecoveryHint)
          : reason
      }
    }),
    exitCode: 0
  };
}

function allowWithStateWarning() {
  return {
    stderr: '[Fact-Forcing Gate] GateGuard state could not be persisted; allowing this operation to avoid a permanent retry loop. Check GATEGUARD_STATE_DIR or filesystem permissions.',
    exitCode: 0
  };
}

/**
 * Evaluates whether an edit/write operation qualifies for zero-friction evidence auto-pass.
 * @param {string} filePath File path being edited.
 * @param {string} tier Risk tier ('normal', 'elevated', 'high').
 * @param {Object} state Session state object.
 * @param {number} now Current timestamp.
 * @returns {boolean} True if the edit qualifies for auto-pass.
 */
function evaluateAutoPass(filePath, tier, state, now) {
  if (!isEvidenceBypassEnabled()) return false;
  if (tier === 'high' || tier === 'elevated') return false;
  const level = evidenceLevel(filePath, state, now);
  if (level === 'deep') return true;
  if (level === 'touched' && validScopePass(filePath, state, now)) return true;
  return false;
}

/**
 * Records an auto-pass grant in session state immutably and persists it.
 * @param {string} filePath File path granted auto-pass.
 * @param {string} tier Risk tier.
 * @param {Object} state Session state object.
 * @param {number} now Current timestamp.
 * @returns {Object} Updated session state object.
 */
function recordAutoPass(filePath, tier, state, now) {
  let nextState = tier === 'normal' ? grantScopePass(state, filePath, now) : Object.assign({}, state);
  const checked = Array.isArray(nextState.checked) ? nextState.checked : [];
  if (!checked.includes(filePath)) {
    nextState = Object.assign({}, nextState, { checked: [...checked, filePath] });
  }
  saveState(nextState);
  return nextState;
}

// --- Core logic (exported for run-with-flags.js) ---

function run(rawInput) {
  let data;
  try {
    data = typeof rawInput === 'string' ? JSON.parse(rawInput) : rawInput;
  } catch (_) {
    return rawInput; // allow on parse error
  }

  if (isGateGuardDisabled()) {
    return rawInput;
  }

  activeStateFile = null;
  getStateFile(data);

  const rawToolName = data.tool_name || '';
  const toolInput = data.tool_input || {};
  // Normalize: case-insensitive matching via lookup map
  const TOOL_MAP = { edit: 'Edit', write: 'Write', multiedit: 'MultiEdit', bash: 'Bash', powershell: 'PowerShell' };
  const toolName = TOOL_MAP[rawToolName.toLowerCase()] || rawToolName;
  const inSubagent = isSubagentInvocation(data);

  if (toolName === 'Edit' || toolName === 'Write') {
    const filePath = toolInput.file_path || '';
    if (!filePath || isClaudeSettingsPath(filePath) || isExemptPath(filePath, data)) {
      return rawInput; // allow
    }

    if (inSubagent) {
      return rawInput; // parent session already passed the first-touch file gate
    }

    const tier = riskTier(toolName, toolInput, filePath);

    // High and elevated risk targets NEVER bypass via trivial change
    if (tier === 'normal' && isTrivialChange(toolName, toolInput, filePath)) {
      return rawInput; // allow comment/whitespace-only edits
    }

    if (!isChecked(filePath)) {
      const state = loadState();
      const now = Date.now();

      if (evaluateAutoPass(filePath, tier, state, now)) {
        recordAutoPass(filePath, tier, state, now);
        return rawInput; // allow
      }

      const { ok, denials } = markCheckedAndCountDenial(filePath);
      if (!ok) {
        return allowWithStateWarning();
      }
      if (denials > getFullDenialBudget()) {
        const action = toolName === 'Edit' ? 'edit' : 'creation';
        return denyResult(condensedGateMsg(action, filePath, denials), { includeRecoveryHint: false });
      }
      return denyResult(toolName === 'Edit' ? editGateMsg(filePath) : writeGateMsg(filePath), {
        narrowRecoveryHint: EDIT_WRITE_NARROW_RECOVERY_HINT
      });
    }

    return rawInput; // allow
  }

  if (toolName === 'MultiEdit') {
    if (inSubagent) {
      return rawInput; // parent session already passed the first-touch file gate
    }

    const edits = toolInput.edits || [];
    for (const edit of edits) {
      const filePath = edit.file_path || '';
      if (!filePath || isClaudeSettingsPath(filePath) || isExemptPath(filePath, data) || isChecked(filePath)) {
        continue;
      }

      const tier = riskTier('Edit', edit, filePath);

      // High and elevated risk targets NEVER bypass via trivial change
      if (tier === 'normal' && isTrivialChange('Edit', edit, filePath)) {
        continue;
      }

      let state = loadState();
      const now = Date.now();

      if (evaluateAutoPass(filePath, tier, state, now)) {
        state = recordAutoPass(filePath, tier, state, now);
        continue;
      }

      const { ok, denials } = markCheckedAndCountDenial(filePath);
      if (!ok) {
        return allowWithStateWarning();
      }
      if (denials > getFullDenialBudget()) {
        return denyResult(condensedGateMsg('edit', filePath, denials), { includeRecoveryHint: false });
      }
      return denyResult(editGateMsg(filePath), {
        narrowRecoveryHint: EDIT_WRITE_NARROW_RECOVERY_HINT
      });
    }
    return rawInput; // allow
  }

  if (toolName === 'Bash' || toolName === 'PowerShell') {
    const command = toolInput.command || '';
    if (isReadOnlyGitIntrospection(command)) {
      return rawInput;
    }

    if (classifyDestructiveCommand(toolName, command).length > 0) {
      // Gate destructive commands on first attempt; allow retry after facts presented
      const key = '__destructive__' + crypto.createHash('sha256').update(command).digest('hex').slice(0, 16);
      if (!isChecked(key)) {
        if (!markChecked(key)) {
          return allowWithStateWarning();
        }
        return denyResult(destructiveBashMsg(), { includeRecoveryHint: false });
      }
      return rawInput; // allow retry after facts presented
    }

    // Operator opt-out: skip the routine shell gate entirely. The destructive
    // gate above still fires. This is the documented escape hatch for hosts
    // (Cursor, OpenCode, etc.) where the once-per-session routine gate is
    // friction without signal.
    if (isRoutineBashGateDisabled()) {
      return rawInput; // routine gate opted out via env
    }

    if (!isChecked(ROUTINE_BASH_SESSION_KEY)) {
      if (!markChecked(ROUTINE_BASH_SESSION_KEY)) {
        return allowWithStateWarning();
      }
      const hookId = toolName === 'PowerShell' ? POWERSHELL_HOOK_ID : BASH_HOOK_ID;
      const narrowRecoveryHint = toolName === 'PowerShell'
        ? ROUTINE_POWERSHELL_NARROW_RECOVERY_HINT
        : ROUTINE_BASH_NARROW_RECOVERY_HINT;
      return denyResult(routineShellMsg(toolName), {
        hookIds: [hookId],
        narrowRecoveryHint
      });
    }

    return rawInput; // allow
  }

  return rawInput; // allow
}

module.exports = { classifyDestructiveCommand, run };
