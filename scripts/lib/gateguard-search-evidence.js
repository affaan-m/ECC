'use strict';

const fs = require('fs');
const path = require('path');
const { WINDOWS_PATH_PATTERN, classifyTargetFor } = require('./gateguard-target-class');
const { excludedBatchId } = require('./gateguard-turn-scan');
const {
  POWERSHELL_SEARCHES,
  isInsideDir,
  valueFlagsFor,
  powershellFilterArg,
  grepToolFilters,
  shellSearchFilters,
  filtersAdmitTarget,
  includesAdmitTarget
} = require('./gateguard-search-filters');

// --- Search commands and flags ---

const SHELL_SEARCH_COMMANDS = new Set([
  'rg',
  'grep',
  'egrep',
  'fgrep',
  'git',
  'find',
  'fd',
  'ls',
  'tree',
  'get-childitem',
  'gci',
  'select-string',
  'sls'
]);
const GIT_SEARCH_SUBCOMMANDS = new Set(['grep', 'ls-files']);
const DIRECTORY_CHANGE_COMMANDS = new Set(['cd', 'pushd', 'popd', 'chdir', 'set-location', 'sl', 'push-location', 'pop-location']);
const PATTERN_FIRST_SEARCHES = new Set(['grep', 'egrep', 'fgrep', 'rg', 'git grep', 'select-string', 'sls', 'fd']);
const RECURSIVE_BY_DEFAULT = new Set(['rg', 'git grep', 'git ls-files', 'find', 'fd', 'tree']);
const GREP_FAMILY = new Set(['grep', 'egrep', 'fgrep']);
const PATTERN_VALUE_FLAGS = new Set(['-e', '-f', '--regexp', '--file']);
const PATTERN_FLAG_SEARCHES = new Set(['grep', 'egrep', 'fgrep', 'rg', 'git grep']);
const POWERSHELL_VALUE_FLAGS = new Set(['-path', '-literalpath', '-depth', '-pattern']);
const POWERSHELL_PATH_FLAGS = new Set(['-path', '-literalpath']);
const GENERIC_STEMS = new Set([
  'index',
  'main',
  'init',
  '__init__',
  'utils',
  'util',
  'types',
  'readme',
  'test',
  'tests',
  'config',
  'mod',
  'lib',
  'setup',
  'app',
  'spec',
  'helpers',
  'common'
]);
const MIN_STEM_LENGTH = 4;
const MAX_SEARCH_COMMAND_CHARS = 8192;
// see docs/gateguard/design-notes.md#ambiguous-shell-is-not-evidence
const AMBIGUOUS_SHELL_PATTERN = /`|\$\(|[<>]\(|<</;
const GLOB_CHARS_PATTERN = /[*?[{]/;

// see docs/gateguard/design-notes.md#test-stems
function bareStem(filePath, data) {
  const base = (String(filePath).split(/[\\/]/).pop() || '').toLowerCase();
  const ext = path.posix.extname(base);
  const stem = ext ? base.slice(0, -ext.length) : base;
  if (classifyTargetFor(filePath, data) !== 'test') return stem;
  if (stem.endsWith('.test') || stem.endsWith('.spec')) return stem.slice(0, -5);
  if (ext === '.py' && stem.startsWith('test_')) return stem.slice(5);
  if ((ext === '.py' || ext === '.go') && stem.endsWith('_test')) return stem.slice(0, -5);
  return stem;
}

function eligibleStem(filePath, data) {
  const stem = bareStem(filePath, data);
  return stem.length >= MIN_STEM_LENGTH && !GENERIC_STEMS.has(stem) ? stem : null;
}

// see docs/gateguard/design-notes.md#search-prefilter
function inputMayMention(input, word) {
  if (!input || typeof input !== 'object') return false;
  let text = '';
  for (const value of Object.values(input)) {
    if (typeof value === 'string') text += `\n${value}`;
  }
  return text.toLowerCase().replace(/["'\\]/g, '').includes(word);
}

// see docs/gateguard/design-notes.md#stem-matching
function stemMatcher(stem) {
  if (!stem) return null;
  return { test: text => containsWord(String(text), stem) };
}

function isStemWordChar(ch) {
  return ch !== undefined && ((ch >= 'a' && ch <= 'z') || (ch >= '0' && ch <= '9'));
}

function containsWord(text, word) {
  for (let at = text.indexOf(word); at !== -1; at = text.indexOf(word, at + 1)) {
    if (!isStemWordChar(text[at - 1]) && !isStemWordChar(text[at + word.length])) return true;
  }
  return false;
}

function dirContext(targetPath, data) {
  const base = (data && typeof data.cwd === 'string' && data.cwd) || process.env.CLAUDE_PROJECT_DIR || process.cwd();
  const isWin = WINDOWS_PATH_PATTERN.test(base) || WINDOWS_PATH_PATTERN.test(targetPath);
  const paths = isWin ? path.win32 : path.posix;
  if (!paths.isAbsolute(base)) return null;
  const resolveNative = (...parts) => paths.resolve(base, ...parts);
  const resolveDir = (...parts) => {
    const dir = resolveNative(...parts).replace(/\\/g, '/');
    return isWin ? dir.toLowerCase() : dir;
  };
  const targetKey = resolveDir(targetPath);
  return { resolveDir, resolveNative, targetKey, targetDir: path.posix.dirname(targetKey) };
}

function isDirectoryNow(nativePath) {
  try {
    return fs.statSync(nativePath).isDirectory();
  } catch (_) {
    return false;
  }
}

function globLiteralPrefix(pattern) {
  const segments = pattern.split(/[\\/]/);
  const firstGlob = segments.findIndex(segment => GLOB_CHARS_PATTERN.test(segment));
  const literal = firstGlob === -1 ? segments.slice(0, -1) : segments.slice(0, firstGlob);
  const joined = literal.join('/');
  return joined || (literal.length > 0 && pattern.startsWith('/') ? '/' : '');
}

function stringsOf(...values) {
  return values.filter(value => typeof value === 'string' && value);
}

function baseAfterDirectoryChange(base, lead, tokens) {
  if (!['cd', 'chdir', 'set-location', 'sl'].includes(lead) || tokens.length !== 2) return null;
  const dir = tokens[1];
  if (!dir || /^[-$~]/.test(dir) || GLOB_CHARS_PATTERN.test(dir)) return null;
  if (isAbsoluteShellPath(dir)) return [dir];
  return base === null ? null : base.concat(dir);
}

function isAbsoluteShellPath(arg) {
  return path.posix.isAbsolute(arg) || WINDOWS_PATH_PATTERN.test(arg);
}

function operandScopePath(arg) {
  if (!GLOB_CHARS_PATTERN.test(arg)) return arg;
  const segments = arg.split(/[\\/]/);
  const literal = segments.slice(0, segments.findIndex(segment => GLOB_CHARS_PATTERN.test(segment)));
  if (literal.length === 0) return '.';
  return literal.join('/') || '/';
}

function shellSearchScopes(parsed, base) {
  if (parsed.operands.length === 0) return base === null ? [] : [base];
  const scopes = [];
  for (const operand of parsed.operands) {
    if (!operand || operand === '-' || /^[$~]/.test(operand)) continue;
    const scoped = operandScopePath(operand);
    if (isAbsoluteShellPath(scoped)) scopes.push([scoped]);
    else if (base !== null) scopes.push(base.concat(scoped));
  }
  return scopes;
}

function isRecursiveFlag(kind, arg) {
  const lower = arg.toLowerCase();
  if (POWERSHELL_SEARCHES.has(kind)) return (kind === 'get-childitem' || kind === 'gci') && lower.startsWith('-rec');
  if (arg === '--recursive' || arg === '--dereference-recursive') return GREP_FAMILY.has(kind) || kind === 'ls';
  if (!/^-[a-zA-Z]+$/.test(arg)) return false;
  if (GREP_FAMILY.has(kind)) return /[rR]/.test(arg);
  return kind === 'ls' && arg.includes('R');
}

function flagEffect(kind, args, i) {
  const arg = args[i];
  if (POWERSHELL_SEARCHES.has(kind)) {
    const lower = arg.toLowerCase();
    const filter = powershellFilterArg(kind, args, i);
    const consumes = filter ? filter.end - i : POWERSHELL_VALUE_FLAGS.has(lower) ? 1 : 0;
    return { consumes, patternFlag: lower === '-pattern', pathFlag: POWERSHELL_PATH_FLAGS.has(lower) };
  }
  const values = valueFlagsFor(kind);
  const takesValue = flag => values.has(flag) || (kind === 'rg' && (flag === '-r' || flag === '--replace'));
  const isPatternFlag = flag => PATTERN_FLAG_SEARCHES.has(kind) && PATTERN_VALUE_FLAGS.has(flag);
  const name = arg.split('=')[0];
  if (arg.startsWith('--') || kind === 'find' || takesValue(arg)) {
    return { consumes: !arg.includes('=') && takesValue(name) ? 1 : 0, patternFlag: isPatternFlag(name), pathFlag: false };
  }
  for (let i = 1; i < arg.length; i++) {
    const flag = `-${arg[i]}`;
    if (takesValue(flag)) return { consumes: i === arg.length - 1 ? 1 : 0, patternFlag: isPatternFlag(flag), pathFlag: false };
  }
  return { consumes: 0, patternFlag: false, pathFlag: false };
}

function parseSearchArgs(kind, args) {
  const positionals = [];
  const pathValues = [];
  let recursive = RECURSIVE_BY_DEFAULT.has(kind);
  let patternGiven = false;
  let expressionStarted = false;
  let inputRedirect = false;
  for (let i = 0; i < args.length; i++) {
    const arg = args[i];
    if (/^\d*[<>]/.test(arg)) {
      inputRedirect = /^\d*</.test(arg);
      break;
    }
    if (arg.includes('<')) {
      inputRedirect = true;
      break;
    }
    if (arg.length > 1 && arg.startsWith('-')) {
      expressionStarted = true;
      if (isRecursiveFlag(kind, arg)) recursive = true;
      const effect = flagEffect(kind, args, i);
      if (effect.patternFlag) patternGiven = true;
      if (effect.pathFlag && i + 1 < args.length) pathValues.push(args[i + 1]);
      i += effect.consumes;
      continue;
    }
    if (kind === 'find' && (expressionStarted || arg === '(' || arg === '!')) {
      expressionStarted = true;
      continue;
    }
    positionals.push(arg);
  }
  const dirOperands = PATTERN_FIRST_SEARCHES.has(kind) && !patternGiven ? positionals.slice(1) : positionals;
  const operands = dirOperands.concat(pathValues);
  return { operands, dirOperands, recursive, stdin: inputRedirect && operands.length === 0 };
}

function shellDirCandidate(arg) {
  if (!arg || /^[$~]/.test(arg)) return '';
  const dir = arg.replace(/(?:[\\/]\*\*|[\\/]\*|[\\/])+$/, '');
  if (!dir || dir === '.' || GLOB_CHARS_PATTERN.test(dir)) return '';
  return dir;
}

function evidenceInScope(item, ctx) {
  if (item.scopes) {
    const covers = parts => {
      const scope = ctx.resolveDir(...parts);
      return scope === ctx.targetKey || isInsideDir(ctx.targetKey, scope);
    };
    if (!item.scopes.some(covers)) return false;
  }
  if (item.scope) {
    const scope = ctx.resolveDir(...item.scope);
    if (scope === ctx.targetKey || !isInsideDir(ctx.targetKey, scope)) return false;
    if (item.scopeExact && ctx.targetDir !== scope) return false;
  }
  // see docs/gateguard/design-notes.md#search-scope
  if (item.operands && item.operands.length > 0 && item.operands.every(parts => ctx.resolveDir(...parts) === ctx.targetKey)) {
    return false;
  }
  return true;
}

function evidenceNamesDir(item, ctx) {
  return item.dirs.some(
    parts => ctx.resolveDir(...parts) === ctx.targetDir && (!item.dirsMustExist || isDirectoryNow(ctx.resolveNative(...parts)))
  );
}

// --- Prior-search credit ---

const MIN_GENERIC_MISS_STEM = 3;
const MISS_RANK = Object.freeze({ 'same-batch': 0, excluded: 1, 'out-of-scope': 2, 'stdin-only': 3, 'not-a-search': 4, 'generic-stem': 5 });

/** Build the prior-search matcher around the hook's shell segmenter. */
function createSearchEvidence({ quoteAwareSegments, commandBasename, SHELL_SEGMENT_SEPARATORS }) {
  function searchEvidence(search, shellDirsTrusted, misses) {
    const input = search.input;
    if (search.name === 'Glob') {
      if (typeof input.pattern !== 'string' || !input.pattern) return [];
      const explicit = typeof input.path === 'string' && input.path ? input.path : '';
      const prefix = globLiteralPrefix(input.pattern);
      const scope = [explicit || '.', prefix || '.'];
      if (!GLOB_CHARS_PATTERN.test(input.pattern)) {
        const lookup = [explicit || '.', input.pattern];
        return [{ texts: [input.pattern], dirs: [], scope, scopeExact: true, operands: [lookup], detail: input.pattern }];
      }
      const dirs = prefix || explicit ? [scope] : [];
      return [{ texts: [input.pattern], dirs, scope, detail: input.pattern }];
    }
    if (search.name === 'Grep') {
      if (typeof input.pattern !== 'string' || !input.pattern) return [];
      const explicit = typeof input.path === 'string' && input.path ? input.path : '';
      const detail = typeof input.glob === 'string' && input.glob ? `${input.pattern} --glob ${input.glob}` : input.pattern;
      const filters = grepToolFilters(input.glob);
      return [{
        texts: stringsOf(input.pattern, ...filters.positives),
        dirs: explicit ? [[explicit]] : [],
        scope: [explicit || '.'],
        detail,
        pathIncludes: true,
        ...filters
      }];
    }
    if (search.name === 'LS') {
      return stringsOf(input.path).map(dir => ({ texts: [], dirs: [[dir]], scope: [dir], detail: dir }));
    }
    return shellSearchEvidence(input.command, shellDirsTrusted, misses);
  }

  function segmentPipeFlags(input) {
    const flags = [];
    let quote = null;
    let escaped = false;
    let hasContent = false;
    let piped = false;
    for (const ch of String(input || '')) {
      if (escaped) {
        escaped = false;
      } else if (ch === '\\') {
        escaped = true;
        hasContent = true;
      } else if (quote) {
        if (ch === quote) quote = null;
      } else if (ch === '"' || ch === "'") {
        quote = ch;
        hasContent = true;
      } else if (SHELL_SEGMENT_SEPARATORS.has(ch)) {
        if (hasContent) {
          flags.push(piped);
          piped = false;
          hasContent = false;
        }
        piped = piped || ch === '|';
      } else if (!/\s/.test(ch)) {
        hasContent = true;
      }
    }
    if (hasContent) flags.push(piped);
    return flags;
  }

  function shellSearchEvidence(command, dirsTrusted, misses) {
    if (typeof command !== 'string' || !command || command.length > MAX_SEARCH_COMMAND_CHARS) return [];
    if (AMBIGUOUS_SHELL_PATTERN.test(command)) return [];
    const pipeFlags = segmentPipeFlags(command);
    const evidence = [];
    let trusted = dirsTrusted;
    // see docs/gateguard/design-notes.md#directory-changes
    let base = dirsTrusted ? [] : null;
    quoteAwareSegments(command).forEach((tokens, index) => {
      const lead = commandBasename(tokens[0]);
      if (DIRECTORY_CHANGE_COMMANDS.has(lead)) {
        trusted = false;
        base = baseAfterDirectoryChange(base, lead, tokens);
        return;
      }
      const miss = reason => {
        if (misses) misses.push({ texts: [tokens.join(' ')], detail: tokens.join(' '), reason });
      };
      if (!SHELL_SEARCH_COMMANDS.has(lead) || (lead === 'git' && !GIT_SEARCH_SUBCOMMANDS.has(tokens[1]))) {
        miss('not-a-search');
        return;
      }
      const kind = lead === 'git' ? `git ${tokens[1]}` : lead;
      const args = tokens.slice(lead === 'git' ? 2 : 1);
      const parsed = parseSearchArgs(kind, args);
      // see docs/gateguard/design-notes.md#stdin-is-not-a-tree-search
      if (parsed.stdin || (parsed.operands.length === 0 && (!parsed.recursive || pipeFlags[index] !== false))) {
        miss('stdin-only');
        return;
      }
      const scopes = shellSearchScopes(parsed, base);
      if (scopes.length === 0) return;
      const filters = shellSearchFilters(kind, args);
      // see docs/gateguard/design-notes.md#search-filters
      const stemText = tokens.slice(0, tokens.length - args.length).concat(args.filter((_, i) => !filters.dropped.has(i))).join(' ');
      const dirs = trusted ? parsed.dirOperands.map(shellDirCandidate).filter(Boolean).map(dir => [dir]) : [];
      evidence.push({
        texts: [stemText],
        dirs,
        dirsMustExist: true,
        scopes,
        operands: parsed.operands.map(op => [op]),
        detail: tokens.join(' '),
        exclusions: filters.exclusions,
        includes: filters.includes,
        pathIncludes: kind === 'rg',
        opaque: filters.opaque
      });
    });
    return evidence;
  }

  const evidenceCache = new WeakMap();
  const trustCache = new WeakMap();

  function cachedEvidence(search, shellDirsTrusted) {
    if (!search || typeof search !== 'object') return { items: [], misses: [] };
    let byTrust = evidenceCache.get(search);
    if (!byTrust) {
      byTrust = new Map();
      evidenceCache.set(search, byTrust);
    }
    let entry = byTrust.get(shellDirsTrusted);
    if (!entry) {
      const misses = [];
      entry = { items: searchEvidence(search, shellDirsTrusted, misses), misses };
      byTrust.set(shellDirsTrusted, entry);
    }
    return entry;
  }

  function shellDirsTrustedFor(scan) {
    if (!trustCache.has(scan)) trustCache.set(scan, !turnChangesDirectory(scan.shellCommands));
    return trustCache.get(scan);
  }

  function turnChangesDirectory(shellCommands) {
    if (!Array.isArray(shellCommands)) return false;
    return shellCommands.some(command => {
      if (typeof command !== 'string') return false;
      if (command.length > MAX_SEARCH_COMMAND_CHARS) return true;
      return quoteAwareSegments(command).some(tokens => DIRECTORY_CHANGE_COMMANDS.has(commandBasename(tokens[0])));
    });
  }

  /** First completed search of the current turn that credits the target, else null. */
  function findCreditingSearch(scan, targetPath, allowDirMatch, data) {
    try {
      if (!scan || !Array.isArray(scan.searches) || scan.searches.length === 0) return null;
      if (typeof targetPath !== 'string' || !targetPath) return null;
      const ctx = dirContext(targetPath, data);
      if (!ctx) return null;
      const eligible = eligibleStem(targetPath, data);
      if (eligible === null && !allowDirMatch) return null;
      const stem = stemMatcher(eligible);
      // see docs/gateguard/design-notes.md#same-batch-searches
      const excluded = excludedBatchId(scan, data);
      let shellDirsTrusted = null;
      for (const search of scan.searches) {
        if (typeof search.messageId !== 'string' || !search.messageId || search.messageId === excluded) continue;
        if (!allowDirMatch && !inputMayMention(search.input, eligible)) continue;
        if (shellDirsTrusted === null) shellDirsTrusted = shellDirsTrustedFor(scan);
        for (const item of cachedEvidence(search, shellDirsTrusted).items) {
          if (!evidenceInScope(item, ctx) || !filtersAdmitTarget(item, ctx, stem)) continue;
          const byStem = stem !== null && includesAdmitTarget(item, ctx) && item.texts.some(text => stem.test(text.toLowerCase()));
          const byDir = Boolean(allowDirMatch) && evidenceNamesDir(item, ctx);
          if (byStem || byDir) {
            return { name: search.name, detail: item.detail, callsAgo: search.callsAgo };
          }
        }
      }
      return null;
    } catch (_) {
      return null;
    }
  }

  // --- Closest non-qualifying search ---
  // see docs/gateguard/design-notes.md#closest-search-that-did-not-count

  function mentionsTarget(texts, stem, rawStem) {
    const matcher = stem || rawStem;
    return Boolean(matcher) && texts.some(text => typeof text === 'string' && matcher.test(text.toLowerCase()));
  }

  function itemMiss(item, ctx, stem, rawStem, allowDirMatch, sameBatch) {
    if (stem === null) return mentionsTarget(item.texts, null, rawStem) ? 'generic-stem' : null;
    const byDir = Boolean(allowDirMatch) && evidenceNamesDir(item, ctx);
    const mentioned = mentionsTarget(item.texts, stem, null);
    if (!mentioned && !byDir) return null;
    const inScope = evidenceInScope(item, ctx);
    const admitted = filtersAdmitTarget(item, ctx, stem);
    const included = includesAdmitTarget(item, ctx);
    if (inScope && admitted && (byDir || included)) return sameBatch ? 'same-batch' : null;
    if (!inScope) return 'out-of-scope';
    return 'excluded';
  }

  /** Closest search of the current turn that did not credit the target, with a reason code, else null. */
  function findClosestMiss(scan, targetPath, allowDirMatch, data) {
    try {
      if (!scan || !Array.isArray(scan.searches) || typeof targetPath !== 'string' || !targetPath) return null;
      const ctx = dirContext(targetPath, data);
      if (!ctx) return null;
      const eligible = eligibleStem(targetPath, data);
      const stem = stemMatcher(eligible);
      const bare = bareStem(targetPath, data);
      const rawStem = eligible === null && bare.length >= MIN_GENERIC_MISS_STEM ? stemMatcher(bare) : null;
      const excluded = excludedBatchId(scan, data);
      let shellDirsTrusted = null;
      let best = null;
      const consider = (name, detail, reason) => {
        if (reason && (best === null || MISS_RANK[reason] < MISS_RANK[best.reason])) best = { name, detail, reason };
      };
      for (const search of scan.searches) {
        if (!search || typeof search.messageId !== 'string' || !search.messageId) continue;
        if (!allowDirMatch && (!bare || !inputMayMention(search.input, bare))) continue;
        if (shellDirsTrusted === null) shellDirsTrusted = shellDirsTrustedFor(scan);
        const { items, misses } = cachedEvidence(search, shellDirsTrusted);
        for (const item of items) {
          consider(search.name, item.detail, itemMiss(item, ctx, stem, rawStem, allowDirMatch, search.messageId === excluded));
        }
        for (const miss of misses) {
          if (mentionsTarget(miss.texts, stem, rawStem)) consider(search.name, miss.detail, stem === null ? 'generic-stem' : miss.reason);
        }
      }
      for (const read of Array.isArray(scan.reads) ? scan.reads : []) {
        if (!read || typeof read.path !== 'string' || !read.path) continue;
        const readsTarget = ctx.resolveDir(read.path) === ctx.targetKey || mentionsTarget([read.path], stem, null);
        if (readsTarget) consider('Read', read.path, 'not-a-search');
      }
      return best;
    } catch (_) {
      return null;
    }
  }

  return { findCreditingSearch, findClosestMiss };
}

module.exports = { createSearchEvidence };
