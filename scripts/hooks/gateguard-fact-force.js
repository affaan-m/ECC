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
 *   - Bash (destructive): list targets, rollback plan, quote instruction
 *   - Bash (routine): quote current instruction (once per session)
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

// Session state — scoped per session to avoid cross-session races.
const STATE_DIR = process.env.GATEGUARD_STATE_DIR || path.join(process.env.HOME || process.env.USERPROFILE || '/tmp', '.gateguard');
let activeStateFile = null;

// State expires after 30 minutes of inactivity
const SESSION_TIMEOUT_MS = 30 * 60 * 1000;
const READ_HEARTBEAT_MS = 60 * 1000;

// Maximum checked entries to prevent unbounded growth
const MAX_CHECKED_ENTRIES = 500;
const MAX_SESSION_KEYS = 50;
const ROUTINE_BASH_SESSION_KEY = '__bash_session__';
const EDIT_WRITE_HOOK_ID = 'pre:edit-write:gateguard-fact-force';
const BASH_HOOK_ID = 'pre:bash:gateguard-fact-force';
const ECC_DISABLE_VALUES = new Set(['0', 'false', 'off', 'disabled', 'disable']);
const ECC_ENABLE_VALUES = new Set(['1', 'true', 'on', 'enabled', 'enable', 'yes']);

// SQL-keyword + dd patterns stay as a single regex — they are stable
// phrases without shell-flag ordering concerns. Quoted strings are
// stripped before this regex runs so a commit message mentioning
// "drop table" no longer triggers a false positive.
const DESTRUCTIVE_SQL_DD = /\b(drop\s+table|delete\s+from|truncate|dd\s+if=)\b/i;

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
    if (isDestructiveFindExec(tokens.join(' '))) return true;
    const base = commandBasename(tokens[0]);
    if (SHELL_WRAPPERS.has(base)) {
      const ci = tokens.indexOf('-c');
      if (ci !== -1 && tokens[ci + 1] && isDestructiveQuoteAware(tokens[ci + 1], depth + 1)) {
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
 * Detect destructive `git` invocations: `reset --hard`, `checkout --`,
 * `clean -f...`, `push --force` (but not `--force-with-lease`),
 * `commit --amend`, `rm -rf`.
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
    return bareForce || (plusRefspecForce && !withLease);
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

/**
 * Detect destructive commands inside `find ... -exec` invocations.
 * Handles `-exec rm {} \;`, `-exec rm -rf {} \;`, `-exec rmdir {} \;`,
 * `-exec unlink {} \;`, `-exec git reset --hard {} \;`.
 *
 * @param {string} command
 * @returns {boolean}
 */
function isDestructiveFindExec(command) {
  const raw = String(command || '');
  const trimmed = raw.trim();
  if (!trimmed) {
    return false;
  }

  // Tokenize the whole command line
  const tokens = tokenize(trimmed);
  if (!tokens || tokens.length === 0) {
    return false;
  }

  // Must start with `find`
  if (commandBasename(tokens[0]) !== 'find') {
    return false;
  }

  // Find the `-exec` token
  const execIndex = tokens.indexOf('-exec');
  if (execIndex === -1) {
    return false;
  }

  // Collect tokens after `-exec` until we hit a terminator (`;`, `\;`, or `+`)
  const execTokens = [];
  for (let i = execIndex + 1; i < tokens.length; i++) {
    const token = tokens[i];
    if (token === ';' || token === '\\;' || token === '+') {
      break;
    }
    execTokens.push(token);
  }

  if (execTokens.length === 0) {
    return false;
  }

  const baseCmd = commandBasename(execTokens[0]);

  // Directly destructive commands inside -exec
  if (baseCmd === 'rmdir' || baseCmd === 'unlink') {
    return true;
  }

  // `rm` with any flags (including none) inside -exec is destructive
  if (baseCmd === 'rm') {
    return true;
  }

  // `git reset --hard` inside -exec
  if (baseCmd === 'git') {
    const sub = findGitSubcommand(execTokens);
    if (sub && sub.command === 'reset' && sub.rest.includes('--hard')) {
      return true;
    }
  }

  return false;
}

function isDestructiveBash(command) {
  // The SQL/dd phrases live in command bodies, not as flag-bearing
  // arguments, so we still match them by regex — but on the input
  // after quoting AND subshell delimiters are normalized so phrases
  // inside `$(...)` or backticks are also caught.
  const raw = String(command || '');
  const flattened = explodeSubshells(stripQuotedStrings(raw));
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
  const bodies = collectExecutableBodies(raw);
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
    if (isDestructiveRm(tokens)) return true;
    if (isDestructiveGit(tokens)) return true;
  }

  // Quote-aware pass: closes the quoted-command-word, newline-separator,
  // quoted-find-exec, and sh/bash -c bypasses (GHSA-4v57-ph3x-gf55).
  if (isDestructiveQuoteAware(raw)) return true;

  return false;
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
  try {
    if (fs.existsSync(stateFile)) {
      const state = JSON.parse(fs.readFileSync(stateFile, 'utf8'));
      const lastActive = state.last_active || 0;
      if (Date.now() - lastActive > SESSION_TIMEOUT_MS) {
        try {
          fs.unlinkSync(stateFile);
        } catch (_) {
          /* ignore */
        }
        return { checked: [], last_active: Date.now() };
      }
      return state;
    }
  } catch (_) {
    /* ignore */
  }
  return { checked: [], last_active: Date.now() };
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
  let tmpFile = null;
  try {
    fs.mkdirSync(STATE_DIR, { recursive: true });

    let mergedChecked = Array.isArray(state.checked) ? state.checked : [];
    let mergedLastActive = typeof state.last_active === 'number' ? state.last_active : 0;
    let mergedDenials = getDenialCount(state);

    try {
      if (fs.existsSync(stateFile)) {
        const diskState = JSON.parse(fs.readFileSync(stateFile, 'utf8'));
        if (Array.isArray(diskState.checked)) {
          mergedChecked = Array.from(new Set([...diskState.checked, ...mergedChecked]));
        }
        if (typeof diskState.last_active === 'number') {
          mergedLastActive = Math.max(mergedLastActive, diskState.last_active);
        }
        mergedDenials = Math.max(mergedDenials, getDenialCount(diskState));
      }
    } catch (_) {
      /* ignore malformed or transient disk state */
    }

    const finalState = {
      checked: pruneCheckedEntries(mergedChecked),
      last_active: Math.max(mergedLastActive, Date.now()),
      fact_force_denials: mergedDenials
    };

    // Atomic write: temp file + rename prevents partial reads
    tmpFile = `${stateFile}.tmp.${process.pid}.${crypto.randomBytes(4).toString('hex')}`;
    fs.writeFileSync(tmpFile, JSON.stringify(finalState, null, 2), 'utf8');
    try {
      fs.renameSync(tmpFile, stateFile);
    } catch (error) {
      if (error && (error.code === 'EEXIST' || error.code === 'EPERM')) {
        try {
          fs.unlinkSync(stateFile);
        } catch (_) {
          /* ignore */
        }
        fs.renameSync(tmpFile, stateFile);
      } else {
        throw error;
      }
    }
    tmpFile = null;
    return true;
  } catch (_) {
    if (tmpFile) {
      try {
        fs.unlinkSync(tmpFile);
      } catch (_) {
        /* ignore */
      }
    }
    return false;
  }
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
// unaffected (they were always allowed). Destructive-Bash and routine-Bash
// gates are unchanged.

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
  const state = loadState();
  if (!state.checked.includes(key)) {
    state.checked.push(key);
  }
  const denials = getDenialCount(state) + 1;
  state.fact_force_denials = denials;
  return { ok: saveState(state), denials };
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
          fs.unlinkSync(fp);
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

function sanitizePath(filePath) {
  // Strip control chars (including null), bidi overrides, and newlines
  let sanitized = '';
  for (const char of String(filePath || '')) {
    const code = char.codePointAt(0);
    const isAsciiControl = code <= 0x1f || code === 0x7f;
    const isBidiOverride = (code >= 0x200e && code <= 0x200f) || (code >= 0x202a && code <= 0x202e) || (code >= 0x2066 && code <= 0x2069);
    sanitized += isAsciiControl || isBidiOverride ? ' ' : char;
  }
  return sanitized.trim().slice(0, 500);
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
    '(ECC_GATEGUARD=off disables this gate.)'
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

function routineBashMsg() {
  return [
    '[Fact-Forcing Gate]',
    '',
    'Before the first Bash command this session, present these facts:',
    '',
    '1. The current user request in one sentence',
    '2. What this specific command verifies or produces',
    '',
    'Present the facts, then retry the same operation.'
  ].join('\n');
}

function withRecoveryHint(message, hookIds = [EDIT_WRITE_HOOK_ID]) {
  const disableTargets = hookIds.map(hookId => `\`${hookId}\``).join(' or ');
  return [message, '', `Recovery: if GateGuard is blocking setup or repair work, run this session with \`ECC_GATEGUARD=off\` or add ${disableTargets} to \`ECC_DISABLED_HOOKS\`.`].join('\n');
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
  return {
    stdout: JSON.stringify({
      hookSpecificOutput: {
        hookEventName: 'PreToolUse',
        permissionDecision: 'deny',
        permissionDecisionReason: includeRecoveryHint ? withRecoveryHint(reason, hookIds) : reason
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
  const TOOL_MAP = { edit: 'Edit', write: 'Write', multiedit: 'MultiEdit', bash: 'Bash' };
  const toolName = TOOL_MAP[rawToolName.toLowerCase()] || rawToolName;
  const inSubagent = isSubagentInvocation(data);

  if (toolName === 'Edit' || toolName === 'Write') {
    const filePath = toolInput.file_path || '';
    if (!filePath || isClaudeSettingsPath(filePath)) {
      return rawInput; // allow
    }

    if (inSubagent) {
      return rawInput; // parent session already passed the first-touch file gate
    }

    if (!isChecked(filePath)) {
      const { ok, denials } = markCheckedAndCountDenial(filePath);
      if (!ok) {
        return allowWithStateWarning();
      }
      if (denials > getFullDenialBudget()) {
        const action = toolName === 'Edit' ? 'edit' : 'creation';
        return denyResult(condensedGateMsg(action, filePath, denials), { includeRecoveryHint: false });
      }
      return denyResult(toolName === 'Edit' ? editGateMsg(filePath) : writeGateMsg(filePath));
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
      if (filePath && !isClaudeSettingsPath(filePath) && !isChecked(filePath)) {
        const { ok, denials } = markCheckedAndCountDenial(filePath);
        if (!ok) {
          return allowWithStateWarning();
        }
        if (denials > getFullDenialBudget()) {
          return denyResult(condensedGateMsg('edit', filePath, denials), { includeRecoveryHint: false });
        }
        return denyResult(editGateMsg(filePath));
      }
    }
    return rawInput; // allow
  }

  if (toolName === 'Bash') {
    const command = toolInput.command || '';
    if (isReadOnlyGitIntrospection(command)) {
      return rawInput;
    }

    if (isDestructiveBash(command)) {
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

    // Operator opt-out: skip the routine-bash gate entirely. The destructive
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
      return denyResult(routineBashMsg(), { hookIds: [BASH_HOOK_ID] });
    }

    return rawInput; // allow
  }

  return rawInput; // allow
}

module.exports = { run };
