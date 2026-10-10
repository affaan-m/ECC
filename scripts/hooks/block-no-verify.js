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

const { createBudget, scanShell } = require('./lib/shell-scan');

const MAX_STDIN = 1024 * 1024;
let raw = '';

// Git config section and variable names are case-insensitive
// (subsection names are case-sensitive but core.hooksPath has none),
// so we normalize the candidate token to lowercase before matching.
// See https://git-scm.com/docs/git-config — "The variable names are
// case-insensitive."
function isHookRedirectConfigKey(key) {
  const normalized = key.toLowerCase();
  return normalized === 'core.hookspath' || normalized === 'include.path'
    || /^includeif\..*\.path$/.test(normalized);
}

function isHookRedirectSetting(setting) {
  return isHookRedirectConfigKey(setting.split('=', 1)[0]);
}

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
// Short options whose value is OPTIONAL and must be stuck to the flag
// (`-uno`, `-S<keyid>`). The rest of the cluster is that value, so an `n`
// after them is not the -n flag: `git commit -uno` means --untracked-files=no.
const COMMIT_SHORT_OPTIONS_WITH_OPTIONAL_VALUE = new Set(['u', 'S']);

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
 * git's option parser accepts any unambiguous prefix of a long option, so
 * `--no-veri` and `--no-verif` run as --no-verify. Shorter prefixes such as
 * `--no-ver` are ambiguous with --no-verbose and git rejects them itself, so
 * refusing every prefix from `--no-v` up blocks nothing that would have run.
 */
function isNoVerifyLongFlag(value) {
  return value.length >= '--no-v'.length && '--no-verify'.startsWith(value);
}

const PROTECTED_GIT_COMMANDS = new Set(['commit', 'push', 'merge', 'cherry-pick', 'rebase', 'am']);
const GIT_GLOBAL_VALUES = new Set(['-c', '-C', '--config-env', '--work-tree', '--git-dir', '--namespace', '--super-prefix']);
const SHELLS = new Set(['sh', 'bash', 'dash', 'zsh', 'ksh']);
const DATA_COMMANDS = new Set(['echo', 'printf', 'cat', 'tee', 'grep', 'head', 'tail', 'wc', 'sort', 'uniq', ':', 'true', 'false']);
const CONTROL_WORDS = new Set(['!', 'if', 'then', 'elif', 'while', 'until', 'do', 'else']);

function basename(value) {
  return value.replace(/\\/g, '/').split('/').pop();
}

function isGitExecutable(value) {
  const name = basename(value).toLowerCase();
  return name === 'git' || name === 'git.exe';
}

// Only literal values from this supplied shell task are tracked. No host
// environment, arbitrary expansion or external configuration is read.
function gitEnvironmentOverride(environment, budget) {
  const count = environment.get('GIT_CONFIG_COUNT') || '';
  budget.spend(count.length + environment.size + 1);
  // Git uses strtoul: leading ASCII whitespace/+ are accepted, trailing bytes
  // and counts above INT_MAX are rejected. Bound work by assignments we own.
  const configured = /^[ \t\r\n\v\f]*\+?[0-9]+(?![\s\S])/.test(count) ? Number(count) : 0;
  if (configured > 0 && configured <= 0x7fffffff && configured <= environment.size / 2) {
    let override = false;
    let complete = true;
    for (let i = 0; i < configured; i++) {
      budget.spend();
      const key = environment.get(`GIT_CONFIG_KEY_${i}`);
      if (key === undefined || !environment.has(`GIT_CONFIG_VALUE_${i}`)) { complete = false; break; }
      budget.spend(key.length + 1);
      override ||= isHookRedirectConfigKey(key);
    }
    if (complete && override) return true;
  }
  const parameters = environment.get('GIT_CONFIG_PARAMETERS');
  if (parameters) {
    budget.spend(parameters.length + 1);
    // Git's old 'key=value' and new 'key'='value' forms both use quote removal.
    // This inspects literal keys only; nested regions are never executed.
    for (const command of scanShell(parameters, budget).commands) {
      for (const word of command.words) {
        budget.spend(word.value.length + 1);
        if (isHookRedirectSetting(word.value)) return true;
      }
    }
  }
  return false;
}

function checkGitWords(words, budget, start = 0, environmentOverride = false) {
  let index = start + 1;
  let override = environmentOverride;
  for (; index < words.length; index++) {
    const value = words[index].value;
    budget.spend(value.length + 1);
    if (!value.startsWith('-')) break;
    if (value === '--') { index++; break; }
    if (value === '-c' || value === '--config-env') {
      const setting = words[index + 1]?.value || '';
      budget.spend(setting.length + 1);
      override ||= isHookRedirectSetting(setting);
    } else if (value.startsWith('-c')) override ||= isHookRedirectSetting(value.slice(2));
    else if (value.startsWith('--config-env=')) override ||= isHookRedirectSetting(value.slice('--config-env='.length));
    if (GIT_GLOBAL_VALUES.has(value)) index++;
  }
  const command = words[index]?.value;
  budget.spend((command?.length || 0) + 1);
  if (!PROTECTED_GIT_COMMANDS.has(command)) return null;
  if (override) return `BLOCKED: Overriding core.hooksPath is not allowed with git ${command}. Git hooks must not be bypassed.`;
  let skipNext = false;
  for (index++; index < words.length; index++) {
    const value = words[index].value;
    budget.spend(value.length + 1);
    if (skipNext) { skipNext = false; continue; }
    if (value === '--') break;
    if (command === 'commit') {
      if (commitOptionConsumesNextValue(value)) { skipNext = true; continue; }
      if (commitOptionContainsInlineValue(value)) continue;
    }
    if (isNoVerifyLongFlag(value) || (command === 'commit' && isCommitNoVerifyShortFlag(value))) {
      return `BLOCKED: --no-verify flag is not allowed with git ${command}. Git hooks must not be bypassed.`;
    }
  }
  return null;
}

// Keep literal outcomes and the empty result of an unresolved expansion. The
// latter is a base for later visible += operands, not arbitrary evaluation.
function assignmentValues(prior, operand, append, dynamic, budget) {
  const base = prior === undefined ? '' : prior;
  budget.spend((append ? base.length : 0) + operand.length + 1);
  const values = new Set([append ? base + operand : operand]);
  if (dynamic) {
    if (prior !== undefined) values.add(prior);
    values.add(append ? base : '');
  }
  return [...values];
}

class UnsupportedEnvSplitEscape extends Error {}
class UnsupportedSedEscape extends Error {}

function validateEnvSplitEscapes(payload, budget) {
  let quote = null;
  for (let index = 0; index < payload.length; index++) {
    budget.spend();
    const character = payload[index];
    // env -S has its own escapes. Only literal single-quoted backslashes
    // (excluding env's \\ and \' escapes) agree with the shell scanner.
    if (character === '\\' && (quote !== "'" || payload[index + 1] === '\\' || payload[index + 1] === "'")) {
      throw new UnsupportedEnvSplitEscape();
    }
    if (character === "'" && quote !== '"') quote = quote === "'" ? null : "'";
    else if (character === '"' && quote !== "'") quote = quote === '"' ? null : '"';
  }
}

// Only explicit option grammars remove wrapper operands. Unknown launchers are
// opaque/conservative, never guessed from a name found among data arguments.
function executableWords(words, budget, inherited = new Map(), callerValues = inherited) {
  budget.spend(inherited.size + 1);
  const environments = [new Map(inherited)];
  const prefixAssignments = new Map();
  let local = true;
  let assignmentOnly = true;
  const dynamicAssignments = new Set();
  function result(values) { return { words: values, environments, prefixAssignments, local, assignmentOnly, dynamicAssignments }; }
  function suffix(start) {
    budget.spend(words.length - start);
    assignmentOnly = false;
    return result(words.slice(start));
  }
  function assignment(token) {
    const { value, dynamic } = token;
    const equals = value.indexOf('=');
    const append = !environmentAssignments && value[equals - 1] === '+';
    const key = value.slice(0, append ? equals - 1 : equals);
    if (/^GIT_CONFIG_(?:COUNT|PARAMETERS|(?:KEY|VALUE)_[0-9]+)$/.test(key)) {
      const operand = value.slice(equals + 1);
      const count = environments.length;
      budget.spend(count + 1);
      for (let n = 0; n < count; n++) {
        const environment = environments[n];
        // Shell prefix appends can see local values, even when not exported.
        // Repeated operands use the prior outcome in this same prefix.
        const prior = prefixAssignments.has(key) && environment.has(key)
          ? environment.get(key) : callerValues.get(key);
        const values = assignmentValues(prior, operand, append, dynamic, budget);
        for (const alternative of values.slice(1)) {
          budget.spend(environment.size + 1);
          const variant = new Map(environment);
          variant.set(key, alternative);
          environments.push(variant);
        }
        environment.set(key, values[0]);
      }
      // Retain ordered operations so same-shell states apply each append once.
      if (!prefixAssignments.has(key)) prefixAssignments.set(key, []);
      prefixAssignments.get(key).push({ value: operand, append, dynamic });
      if (dynamic) dynamicAssignments.add(key);
    }
  }
  function resetEnvironment(name) {
    budget.spend(environments.length + 1);
    for (const environment of environments) {
      if (name === undefined) environment.clear();
      else environment.delete(name);
    }
  }
  let i = 0;
  let assignments = true;
  let environmentAssignments = false;
  while (i < words.length) {
    const token = words[i];
    budget.spend(token.value.length + token.raw.length + 1);
    if (assignments && /^[A-Za-z_][A-Za-z0-9_]*\+?=/.test(environmentAssignments ? token.value : token.raw)) { assignment(token); i++; continue; }
    if (!token.quoted && CONTROL_WORDS.has(token.value)) { i++; continue; }
    const name = basename(token.value);
    if (name === 'command') {
      assignmentOnly = false;
      local &&= token.value === 'command';
      i++;
      while (words[i]?.value.startsWith('-')) {
        const flag = words[i++].value;
        budget.spend(flag.length + 1);
        if (flag === '--') break;
        if (/^-[pvV]+$/.test(flag) && /[vV]/.test(flag)) return result([]);
        if (!/^-p+$/.test(flag)) return suffix(i - 1);
      }
      assignments = false; continue;
    }
    if (name === 'exec') {
      assignmentOnly = false;
      local = false;
      i++;
      while (words[i]?.value.startsWith('-')) {
        const flag = words[i++].value;
        budget.spend(flag.length + 1);
        if (flag === '--') break;
        if (/^-[cl]*a$/.test(flag)) i++;
        else if (!/^-([cl]*a.+|[cl]+)$/.test(flag)) return suffix(i - 1);
        if (flag.slice(1).split('a', 1)[0].includes('c')) resetEnvironment();
      }
      assignments = false; continue;
    }
    if (name === 'env' || name === 'sudo' || name === 'doas') {
      assignmentOnly = false;
      local = false;
      const env = name === 'env';
      const values = env
        ? new Set(['-u', '--unset', '-C', '--chdir'])
        : new Set(['-u', '--user', '-g', '--group', '-h', '--host', '-p', '--prompt', '-C', '-T', '-R', '-D']);
      const flags = env ? new Set(['-i', '--ignore-environment', '-0', '--null']) : new Set(['-n', '-E', '-H', '-S', '-k', '-K', '-b']);
      i++;
      while (words[i]?.value.startsWith('-')) {
        const flag = words[i].value;
        budget.spend(flag.length + 1);
        if (flag === '--') { i++; break; }
        if (env && (flag === '-S' || flag === '--split-string'
          || flag.startsWith('--split-string=') || flag.startsWith('-S'))) {
          const separated = flag === '-S' || flag === '--split-string';
          const payload = separated ? words[i + 1]?.value || ''
            : flag.slice(flag.startsWith('--split-string=') ? '--split-string='.length : 2);
          budget.spend(payload.length + 1);
          validateEnvSplitEscapes(payload, budget);
          const scan = scanShell(payload, budget);
          // Only literal word splitting is understood here. Keep complex env
          // syntax opaque rather than pretending to execute it as a shell.
          if (scan.commands.length !== 1 || scan.commands[0].nested.length
            || scan.commands[0].redirects.length || scan.commands[0].words.some(word => word.dynamic)) return suffix(i - 1);
          // Pay for both slices and the expanded array before allocating them.
          budget.spend(2 * words.length + scan.commands[0].words.length);
          words = [...words.slice(0, i), ...scan.commands[0].words, ...words.slice(i + (separated ? 2 : 1))];
          continue;
        }
        if (env && (flag === '-i' || flag === '--ignore-environment')) resetEnvironment();
        if (env && (flag === '-u' || flag === '--unset')) resetEnvironment(words[i + 1]?.value || '');
        else if (env && flag.startsWith('--unset=')) resetEnvironment(flag.slice('--unset='.length));
        else if (env && flag.startsWith('-u')) resetEnvironment(flag.slice(2));
        if (values.has(flag)) i += 2;
        else if (flags.has(flag) || [...values].some(value => value.startsWith('--') ? flag.startsWith(`${value}=`) : flag.startsWith(value) && flag.length > value.length)) i++;
        else return suffix(i - 1); // Includes opaque env -S / sudo shell modes.
      }
      assignments = true; environmentAssignments = true; continue;
    }
    return suffix(i);
  }
  return result([]);
}

function shellRole(words, budget, shell) {
  let i = 1;
  let stdin = false;
  let code = false;
  while (i < words.length) {
    const option = words[i].value;
    budget.spend(option.length + 1);
    if (option === '--' || option === '-') { i++; break; }
    if (!/^[+-]/.test(option)) break;
    if (option === '--rcfile' || option === '--init-file') { i += 2; continue; }
    if (option.startsWith('--')) {
      if (!['--noprofile', '--norc', '--posix', '--restricted', '--verbose', '--login'].includes(option)) return { kind: 'opaque', stdin: true };
      i++; continue;
    }
    // Bash accepts either sign and consumes a separate operand for each o/O
    // even inside a cluster. The command string follows ALL option processing,
    // not necessarily the argv word immediately after the first c flag.
    let next = i + 1;
    for (let j = 1; j < option.length; j++) {
      budget.spend();
      const flag = option[j];
      // Named-option arity is unproved for sh/dash/ksh: keep the invocation
      // opaque instead of consuming a code flag as a guessed option operand.
      if ((flag === 'o' || flag === 'O') && shell !== 'bash' && shell !== 'zsh') return { kind: 'opaque', stdin: true };
      if (flag === 'c') code = true;
      else if (flag === 's') stdin = true;
      else if (shell === 'zsh' && flag === 'o') {
        // zsh consumes the rest of this argv word as the option name, or one
        // separate word if no suffix exists, then ends this option cluster.
        if (j + 1 === option.length && next < words.length) next++;
        break;
      } else if (shell === 'zsh' && (flag === 'O' || flag === 'b')) {
        // These are not Bash's operand grammar; unmodeled zsh modes stay opaque.
        return { kind: 'opaque', stdin: true };
      } else if (flag === 'o' || flag === 'O') { if (next < words.length) next++; }
      else if (!'abefhiklmnprtuvxBCEHPTD'.includes(flag)) return { kind: 'opaque', stdin: true };
    }
    i = next;
  }
  if (code) return { kind: 'shell', code: words[i]?.value, stdin: false };
  // A script filename and its positional arguments are not shell source text.
  return { kind: 'shell', stdin: stdin || i === words.length };
}

// --- GNU sed execution model -------------------------------------------------
// sed is a text transformer, not a shell: its script operand and file operands
// are data. Two constructs break that: the `e` command (with or without an
// operand, the operand or pattern space is run through the shell) and an `s`
// command carrying the `e` flag (the substituted pattern space is run through
// the shell). Scripts using them make sed a shell-equivalent receiver; every
// other invocation keeps its operands out of the executable scan. Anything the
// literal parser cannot confidently read falls back to today's opaque default.

// Skip an optional address (or range) before a command letter. Returns the
// index of the command letter, or -1 when an address starts but cannot be
// confidently consumed.
function skipSedAddress(script, i, budget) {
  const n = script.length;
  function one(i) {
    if (i >= n) return -1;
    const c = script[i];
    if (c === '$') return i + 1;
    if (/[0-9]/.test(c)) {
      let j = i;
      while (j < n && /[0-9]/.test(script[j])) { budget.spend(); j++; }
      return j;
    }
    const delimChar = c === '/' ? '/' : (c === '\\' ? script[i + 1] : null);
    if (delimChar) {
      let j = c === '/' ? i + 1 : i + 2;
      while (j < n) {
        budget.spend();
        if (script[j] === '\\') { j += 2; continue; }
        if (script[j] === delimChar) return j + 1;
        if (script[j] === '\n') return -1;
        j++;
      }
      return -1;
    }
    return -1;
  }
  const first = one(i);
  if (first === -1) return i; // no address; the command letter is at i
  let j = first;
  if (script[j] === ',') {
    const second = one(j + 1);
    if (second === -1) return -1;
    j = second;
  }
  if (script[j] === '!') j++;
  return j;
}

// Read one delimiter-bounded sed section (pattern, replacement or
// transliteration set) starting at script[start]. Returns the index of the
// closing delimiter, or -1 when the section cannot be confidently read.
function readSedDelimited(script, start, delim, budget) {
  let j = start;
  while (j < script.length) {
    budget.spend();
    if (script[j] === '\\') { j += 2; continue; }
    if (script[j] === delim) return j;
    if (script[j] === '\n') return -1;
    j++;
  }
  return -1;
}

// Parse one sed s-command (or y-command, which shares the shape but takes no
// flags) at script[i]. Returns { end, replacement, exec }, or null when the
// shape is not confidently literal.
function parseSedSubstitution(script, i, budget, transliterate = false) {
  const delim = script[i + 1];
  if (delim === undefined || /[a-zA-Z0-9\\\s]/.test(delim)) return null;
  const patternEnd = readSedDelimited(script, i + 2, delim, budget);
  if (patternEnd === -1) return null;
  const replacementEnd = readSedDelimited(script, patternEnd + 1, delim, budget);
  if (replacementEnd === -1) return null;
  const replacement = script.slice(patternEnd + 1, replacementEnd);
  let j = replacementEnd + 1;
  if (transliterate) return { end: j, replacement: '', exec: false };
  // GNU flag letters. `e` executes; `E` only selects extended regex and must
  // not be treated as execution. `w file` appends a filename operand (data).
  let exec = false;
  while (j < script.length && /[0-9gGpPiImMe]/.test(script[j])) {
    budget.spend();
    if (script[j] === 'e') exec = true;
    j++;
  }
  if (script[j] === 'w') {
    while (j < script.length && script[j] !== '\n') { budget.spend(); j++; }
  }
  return { end: j, replacement, exec };
}

// Exec-bearing fragments (the s///e replacement, the e command operand) are
// decoded by GNU sed before execution: \xHH, \oOOO, \dNNN, case operations and
// even unknown escapes like \g all rewrite the text. Decoding that surface
// faithfully is out of scope, so any backslash in an executed fragment keeps
// the hook from proving safety — the caller blocks, mirroring the env -S
// escape precedent rather than pretending to interpret sed.
function assertSedLiteral(text) {
  if (text.includes('\\')) throw new UnsupportedSedEscape();
}

// The `e` command: with an operand, the operand runs through the shell; bare,
// the pattern space (input data) does.
function readSedExecute(script, i, budget) {
  let j = i + 1;
  while (j < script.length && (script[j] === ' ' || script[j] === '\t')) { budget.spend(); j++; }
  if (j < script.length && script[j] !== '\n' && script[j] !== ';') {
    let end = j;
    while (end < script.length && script[end] !== '\n') { budget.spend(); end++; }
    const operand = script.slice(j, end);
    // A trailing backslash is an escaped newline: GNU sed joins the next line
    // into this one operand, which the literal check below refuses.
    assertSedLiteral(operand);
    return { end, parts: [operand], stdinExec: true };
  }
  return { end: j, parts: [], stdinExec: true };
}

// Text, label and filename operands run to end of line; all are data.
function readSedLineOperand(script, i, budget) {
  let end = i + 1;
  while (end < script.length && script[end] !== '\n') { budget.spend(); end++; }
  return { end, parts: [], stdinExec: false };
}

function readSedCommand(script, i, budget) {
  const letter = script[i];
  if (letter === 's') {
    const sub = parseSedSubstitution(script, i, budget);
    if (!sub) return null;
    if (!sub.exec) return { end: sub.end, parts: [], stdinExec: false };
    // The executed text also carries matched input data (&, backrefs), so a
    // piping producer must be treated as a shell source too.
    assertSedLiteral(sub.replacement);
    return { end: sub.end, parts: sub.replacement ? [sub.replacement] : [], stdinExec: true };
  }
  if (letter === 'y') {
    const sub = parseSedSubstitution(script, i, budget, true);
    return sub ? { end: sub.end, parts: [], stdinExec: false } : null;
  }
  if (letter === 'e') return readSedExecute(script, i, budget);
  if ('acirwWb:tTqQ'.includes(letter)) return readSedLineOperand(script, i, budget);
  if ('dDgGhHlnNpPxFzv='.includes(letter)) return { end: i + 1, parts: [], stdinExec: false };
  return null; // unmodeled command letter: keep the opaque default
}

// Returns { parts, stdinExec } where parts are literal script fragments sed
// will hand to the shell, or null when the script cannot be confidently read.
function sedExecParts(script, budget) {
  if (script.includes('\u0000')) return null; // expansion residue: not literal
  const parts = [];
  let stdinExec = false;
  let i = 0;
  while (i < script.length) {
    budget.spend();
    const c = script[i];
    if (c === ' ' || c === '\t' || c === '\n' || c === ';' || c === '{' || c === '}') { i++; continue; }
    if (c === '#') {
      while (i < script.length && script[i] !== '\n') { budget.spend(); i++; }
      continue;
    }
    if (c === '\\') return null; // escape in command position: unmodeled
    const addressed = skipSedAddress(script, i, budget);
    if (addressed === -1) return null;
    if (addressed >= script.length) break;
    const step = readSedCommand(script, addressed, budget);
    if (!step || step.end <= addressed) return null;
    parts.push(...step.parts);
    stdinExec ||= step.stdinExec;
    i = step.end;
  }
  return { parts, stdinExec };
}

// Model sed's argv: which operands are scripts, which are file names (data).
// GNU sed collects -e/--expression scripts from ANY argv position — a later -e
// after positional operands still executes — so options are parsed through the
// whole argv. When any script option is given, every positional is a file;
// otherwise the first positional is the script (verified against GNU sed 4.9).
// Returns the script strings, or null when the invocation shape is unmodeled —
// the caller then keeps today's opaque default instead of guessing.
function sedScriptParts(words, budget) {
  const scripts = [];
  const positionals = [];
  let i = 1;
  while (i < words.length) {
    const raw = words[i].value;
    budget.spend(raw.length + 1);
    if (raw === '--') break; // remaining operands are files (data)
    if (raw === '--expression') {
      if (!words[i + 1]) return null;
      scripts.push(words[i + 1].value); i += 2; continue;
    }
    if (raw.startsWith('--expression=')) { scripts.push(raw.slice('--expression='.length)); i++; continue; }
    if (raw.startsWith('--')) {
      if (['--quiet', '--silent', '--null-data', '--zero-terminated', '--posix', '--regexp-extended', '--sandbox', '--separate', '--unbuffered', '--follow-symlinks'].includes(raw)) { i++; continue; }
      return null; // --file=, --in-place variants, unknown long options
    }
    if (raw.startsWith('-') && raw.length > 1) {
      if (raw === '-e') {
        if (!words[i + 1]) return null;
        scripts.push(words[i + 1].value); i += 2; continue;
      }
      if (raw === '-f') return null; // script comes from a file we cannot read
      if (/^-l[0-9]+$/.test(raw)) { i++; continue; }
      if (/^-[nsEruzb]+$/.test(raw)) { i++; continue; }
      return null; // -i suffix ambiguity, unknown/attached short options
    }
    positionals.push(raw); i++; // operands: first becomes the script only when no script option was given
  }
  if (!scripts.length) {
    if (!positionals.length) return null; // no script operand at all
    scripts.push(positionals[0]);
  }
  // With any -e/--expression present, every positional is a file: data,
  // deliberately left uninspected.
  return scripts;
}

function commandRole(words, budget) {
  if (!words.length) return { kind: 'data' };
  budget.spend(words[0].value.length + 1);
  const name = basename(words[0].value);
  if (isGitExecutable(words[0].value)) return { kind: 'git' };
  if (SHELLS.has(name)) return shellRole(words, budget, name);
  if (name === 'eval') {
    for (const word of words) budget.spend(word.value.length + 3);
    return { kind: 'shell', code: words.slice(words[1]?.value === '--' ? 2 : 1).map(word => word.value).join(' '), stdin: false };
  }
  if (name === 'sed') {
    const scripts = sedScriptParts(words, budget);
    if (!scripts) return { kind: 'opaque', stdin: true };
    const parts = [];
    let stdinExec = false;
    for (const script of scripts) {
      const parsed = sedExecParts(script, budget);
      if (!parsed) return { kind: 'opaque', stdin: true };
      parts.push(...parsed.parts);
      stdinExec ||= parsed.stdinExec;
    }
    if (parts.length || stdinExec) return { kind: 'sedExec', stdin: true, parts };
    // Pure text transformation: script and file operands are data. This is the
    // specific false positive the #3051 tests pin: file names that merely
    // contain "git ..." never execute.
    return { kind: 'data' };
  }
  if (DATA_COMMANDS.has(name)) return { kind: 'data' };
  return { kind: 'opaque', stdin: true };
}

// Literal producers only. Unmodeled transformations remain conservative rather
// than executing a formatter, interpreter, shell or user-supplied command.
function pipelineSources(command, budget) {
  const sources = [];
  for (let current = command; current; current = current.pipeFrom) {
    budget.spend(current.words.length + 1);
    const { words } = executableWords(current.words, budget);
    for (const word of words) budget.spend(word.value.length + 3);
    const name = basename(words[0]?.value || '');
    if (name === 'echo') sources.push({ text: words.slice(1).filter(word => !/^-[neE]+$/.test(word.value)).map(word => word.value).join(' ') });
    if (name === 'printf') {
      const format = words[1]?.value || '';
      if (format !== '-v') sources.push({ text: (format === '%s' || format === '%s\\n') ? words.slice(2).map(word => word.value).join('\n') : words.slice(1).map(word => word.value).join(' ') });
    }
    if (!DATA_COMMANDS.has(name)) {
      // Foreign transformations can introduce literal bypasses into executable
      // stdin. Treat their punctuation as delimiters, not as proved shell syntax.
      // This deliberately may refuse a transformation that removes a bypass; it
      // does not evaluate sed/interpreters or detect arbitrary generated source.
      const text = words.map(word => word.value).join(' ');
      budget.spend(2 * text.length + 1);
      sources.push({ text: text.replace(/[^\w$=.+-]/g, ' '), opaque: true });
    }
    for (const redirect of current.redirects) {
      if (redirect.operator === '<<<') sources.push({ text: redirect.word.value });
      else if (redirect.operator === '<<' || redirect.operator === '<<-') sources.push({ text: redirect.body });
    }
  }
  return sources;
}

const GIT_ENV_NAME = /^GIT_CONFIG_(?:COUNT|PARAMETERS|(?:KEY|VALUE)_[0-9]+)$/;
const DECLARATIONS = new Set(['export', 'declare', 'typeset', 'readonly', 'unset']);

function shellState(environment, budget) {
  budget.spend(2 * environment.size + 1);
  return { variables: new Map(environment), exported: new Set(environment.keys()), readonly: new Set() };
}

function copyShellState(state, budget) {
  budget.spend(state.variables.size + state.exported.size + state.readonly.size + 1);
  return { variables: new Map(state.variables), exported: new Set(state.exported), readonly: new Set(state.readonly) };
}

function copyShellContext(context, budget) {
  budget.spend(context.states.length + 1);
  return { states: context.states.map(state => copyShellState(state, budget)) };
}

function exportedEnvironment(state, budget) {
  const environment = new Map();
  budget.spend(state.exported.size + 1);
  for (const name of state.exported) {
    if (state.variables.has(name)) environment.set(name, state.variables.get(name));
  }
  return environment;
}

// Literal declaration operands are data, not executable source. A value and
// its export attribute are separate: an assignment-only command does not start
// exporting a previously local variable. No host shell state is consulted.
function updateShellState(state, normalized, budget) {
  const { words, prefixAssignments, local, assignmentOnly, dynamicAssignments } = normalized;
  const states = [state];
  const result = (handled, changed, uncertain = false) => ({ handled, changed, uncertain, states });
  if (!local) return result(false, false);
  function assign(name, value, dynamic = false, append = false) {
    const count = states.length;
    budget.spend(count + 1);
    for (let n = 0; n < count; n++) {
      const current = states[n];
      if (current.readonly.has(name)) continue;
      const values = assignmentValues(current.variables.get(name), value, append, dynamic, budget);
      for (const alternative of values.slice(1)) {
        const variant = copyShellState(current, budget);
        variant.variables.set(name, alternative);
        states.push(variant);
      }
      current.variables.set(name, values[0]);
    }
  }
  function assignPrefixes() {
    budget.spend(prefixAssignments.size + 1);
    for (const [key, operations] of prefixAssignments) {
      budget.spend(operations.length + 1);
      for (const operation of operations) assign(key, operation.value, operation.dynamic, operation.append);
    }
  }
  if (assignmentOnly) {
    assignPrefixes();
    return result(true, prefixAssignments.size > 0, dynamicAssignments.size > 0);
  }
  // Exact builtin names only: /some/path/export is an external executable.
  const name = words[0]?.value;
  if (!DECLARATIONS.has(name)) return result(false, false);
  let exported = name === 'export' ? true : null;
  let readonly = name === 'readonly';
  let passive = false;
  let uncertain = dynamicAssignments.size > 0;
  let i = 1;
  for (; i < words.length; i++) {
    const flag = words[i].value;
    budget.spend(flag.length + 1);
    if (flag === '--') { i++; break; }
    if (!/^[+-]/.test(flag)) break;
    if (name === 'export' && /^-[npf]+$/.test(flag)) {
      if (flag.includes('n')) exported = false;
      passive ||= flag.includes('f');
    } else if ((name === 'declare' || name === 'typeset') && /^[+-][xrgpf]+$/.test(flag)) {
      if (flag.includes('x')) exported = flag[0] === '-';
      if (flag[0] === '-' && flag.includes('r')) readonly = true;
      passive ||= /[pf]/.test(flag);
    } else if (name === 'readonly' && /^-[pf]+$/.test(flag)) passive ||= flag.includes('f');
    else if (name === 'unset' && /^-[vf]+$/.test(flag)) passive ||= flag.includes('f');
    else uncertain = true;
  }
  if (passive && !uncertain) return result(true, false);
  let changed = prefixAssignments.size > 0;
  assignPrefixes();
  for (; i < words.length; i++) {
    const value = words[i].value;
    budget.spend(2 * value.length + 1);
    const equals = value.indexOf('=');
    const append = equals > 0 && value[equals - 1] === '+';
    const key = equals < 0 ? value : value.slice(0, append ? equals - 1 : equals);
    if (!GIT_ENV_NAME.test(key)) continue;
    changed = true;
    if (name !== 'unset' && equals >= 0) assign(key, value.slice(equals + 1), words[i].dynamic, append);
    budget.spend(states.length + 1);
    for (const current of states) {
      if (name === 'unset') {
        if (equals < 0 && !current.readonly.has(key)) {
          current.variables.delete(key); current.exported.delete(key);
        }
      } else {
        if (exported === true || uncertain) current.exported.add(key);
        else if (exported === false) current.exported.delete(key);
        if (readonly || uncertain) current.readonly.add(key);
      }
    }
  }
  // Unsupported attributes may transform values or reject the declaration.
  // Retain old and conservative literal states; never use them to prove reset.
  return result(true, changed, uncertain);
}

function checkCommand(input) {
  const budget = createBudget(input.length);
  const pending = [{ text: input, opaque: false, context: { states: [shellState(new Map(), budget)] } }];
  function enqueue(text, opaque = false, context = { states: [shellState(new Map(), budget)] }) {
    if (!text) return;
    budget.spend(text.length + 1);
    pending.push({ text, opaque, context });
  }
  function inspectOpaque(words, text, environment) {
    for (let index = 0; index < words.length; index++) {
      const word = words[index];
      budget.spend(word.value.length + 1);
      if (isGitExecutable(word.value)) {
        const reason = checkGitWords(words, budget, index, gitEnvironmentOverride(environment, budget));
        if (reason) return reason;
      }
      if (word.value !== text && /git/i.test(word.value) && /[\s'"()]/.test(word.value)) enqueue(word.value, true, { states: [shellState(environment, budget)] });
    }
    return null;
  }
  try {
    while (pending.length) {
      const task = pending.pop();
      if (task.mergeInto) {
        budget.spend(task.context.states.length + 1);
        task.mergeInto.states.push(...task.context.states);
        continue;
      }
      if (!task.command) {
        const scan = scanShell(task.text, budget);
        const contexts = new Map([[scan.rootScope, task.context]]);
        budget.spend(scan.commands.length + 1);
        for (let i = scan.commands.length - 1; i >= 0; i--) pending.push({ ...task, command: scan.commands[i], contexts });
        continue;
      }
      const { command, contexts } = task;
      if (command.scopeExit) {
        const closing = command.scopeExit;
        const exited = contexts.get(closing);
        const enclosing = contexts.get(closing.parent);
        if (closing.pipelineLast && exited && enclosing) {
          budget.spend(exited.states.length + 1);
          enclosing.states.push(...exited.states);
        }
        continue;
      }
      const missing = [];
      for (let scope = command.scope; !contexts.has(scope); scope = scope.parent) { budget.spend(); missing.push(scope); }
      while (missing.length) {
        const scope = missing.pop();
        const parent = contexts.get(scope.parent);
        contexts.set(scope, scope.isolated ? copyShellContext(parent, budget) : parent);
      }
      const parent = contexts.get(command.scope);
      const isolated = command.pipeFrom || command.pipeTo || command.background;
      const context = task.commandContext || (isolated ? copyShellContext(parent, budget) : parent);
      if (!task.nestedDone && command.nested.length) {
        pending.push({ ...task, nestedDone: true, commandContext: context });
        budget.spend(command.nested.length + 1);
        for (let i = command.nested.length - 1; i >= 0; i--) enqueue(command.nested[i], false, copyShellContext(context, budget));
        continue;
      }
      let conditional = false;
      for (let scope = command.scope; scope; scope = scope.parent) { budget.spend(); conditional ||= scope.conditional; }
      const alternatives = [];
      const childEnvironments = [];
      let sameShellCode = null;
      let changed = false;
      budget.spend(context.states.length + 1);
      for (const state of context.states) {
        const normalized = executableWords(command.words, budget, exportedEnvironment(state, budget), state.variables);
        const { words, environments } = normalized;
        const next = copyShellState(state, budget);
        const evalPrefix = normalized.local && words[0]?.value === 'eval' && normalized.prefixAssignments.size > 0;
        const mutation = updateShellState(next, evalPrefix ? { ...normalized, assignmentOnly: true } : normalized, budget);
        if (evalPrefix) {
          alternatives.push(state);
          budget.spend(mutation.states.length * (normalized.prefixAssignments.size + 1));
          for (const variant of mutation.states) for (const name of normalized.prefixAssignments.keys()) variant.exported.add(name);
        }
        budget.spend(mutation.states.length + 1);
        alternatives.push(...mutation.states);
        if (mutation.changed && (conditional || mutation.uncertain)) alternatives.push(state);
        changed ||= mutation.changed;
        if (mutation.handled && !evalPrefix) continue;
        const role = commandRole(words, budget);
        budget.spend(environments.length + 1);
        for (const environment of environments) {
          const reason = task.opaque || role.kind === 'opaque'
            ? inspectOpaque(command.words, task.text, environment)
            : role.kind === 'git' ? checkGitWords(words, budget, 0, gitEnvironmentOverride(environment, budget)) : null;
          if (reason) return { blocked: true, reason };
          if (role.code) {
            if (normalized.local && words[0]?.value === 'eval') {
              sameShellCode = role.code;
            }
            else childEnvironments.push({ code: role.code, opaque: false, environment });
          }
          if (role.kind === 'sedExec') {
            // Fragments sed will hand to the shell are scanned as real shell
            // source, not as opaque text — this closes the GNU sed `e` gap.
            for (const part of role.parts) {
              budget.spend(part.length + 1);
              childEnvironments.push({ code: part, opaque: false, environment });
            }
          }
          if (role.stdin) {
            for (const redirect of command.redirects) {
              if (redirect.operator === '<<<') childEnvironments.push({ code: redirect.word.value, opaque: role.kind === 'opaque', environment });
              else if (redirect.operator === '<<' || redirect.operator === '<<-') childEnvironments.push({ code: redirect.body, opaque: role.kind === 'opaque', environment });
            }
            if (command.pipeFrom) {
              for (const source of pipelineSources(command.pipeFrom, budget)) childEnvironments.push({ code: source.text, opaque: source.opaque || role.kind === 'opaque', environment });
            }
          }
        }
      }
      context.states = alternatives;
      // Bash lastpipe and zsh can execute a final pipeline builtin in the
      // parent shell. Preserve that possible state as well as isolation; this
      // is deliberately conservative when the host shell/options are unknown.
      if (command.pipeFrom && !command.pipeTo && !command.background && (changed || sameShellCode)) pending.push({ mergeInto: parent, context });
      for (const child of childEnvironments) enqueue(child.code, child.opaque, { states: [shellState(child.environment, budget)] });
      if (sameShellCode) {
        // A conditional eval may not run. Its nested scans have fresh lexical
        // roots, so preserve the skipped branch across all delayed updates.
        const evaluated = conditional ? copyShellContext(context, budget) : context;
        if (conditional) pending.push({ mergeInto: context, context: evaluated });
        enqueue(sameShellCode, false, evaluated);
      }
    }
  } catch (error) {
    if (error instanceof UnsupportedEnvSplitEscape) {
      return { blocked: true, reason: 'BLOCKED: Unsupported env split-string escape; hook-bypass safety could not be established.' };
    }
    if (error instanceof UnsupportedSedEscape) {
      return { blocked: true, reason: 'BLOCKED: Unsupported sed script escape; hook-bypass safety could not be established.' };
    }
    if (!(error instanceof RangeError)) throw error;
    return { blocked: true, reason: 'BLOCKED: Shell analysis work budget exceeded; hook-bypass safety could not be established.' };
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
