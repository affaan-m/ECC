'use strict';

// --- Search flags ---

const POWERSHELL_SEARCHES = new Set(['get-childitem', 'gci', 'select-string', 'sls']);

const VALUE_FLAGS = new Set([
  '-e', '-f', '-g', '-t', '-T', '-m', '-A', '-B', '-C',
  '--regexp', '--file', '--type', '--glob', '--iglob', '--include', '--exclude', '--exclude-dir', '--exclude-from',
  '--ignore-file', '--max-count', '--replace',
  '-name', '-iname', '-path', '-ipath', '-type', '-maxdepth', '-mindepth', '-newer', '-regex', '-size', '-user', '-group', '-perm'
]);

const LS_VALUE_FLAGS = new Set(['-I', '--ignore', '--hide']);

const TREE_VALUE_FLAGS = new Set(['-L', '-P', '-I', '-o']);

const FD_VALUE_FLAGS = new Set([...VALUE_FLAGS, '-E']);

const POWERSHELL_FILTER_PARAMS = new Set(['filter', 'include', 'exclude']);

const POWERSHELL_COMMON_PARAMS = [
  'verbose', 'debug', 'erroraction', 'warningaction', 'informationaction', 'progressaction',
  'errorvariable', 'warningvariable', 'informationvariable', 'outvariable', 'outbuffer', 'pipelinevariable'
];

const POWERSHELL_CHILDITEM_PARAMS = [
  'path', 'literalpath', 'filter', 'include', 'exclude', 'recurse', 'depth', 'force', 'name',
  'attributes', 'directory', 'file', 'hidden', 'readonly', 'system', 'followsymlink'
];

const POWERSHELL_SELECTSTRING_PARAMS = [
  'pattern', 'path', 'literalpath', 'inputobject', 'simplematch', 'casesensitive', 'quiet', 'list', 'noemphasis',
  'include', 'exclude', 'notmatch', 'allmatches', 'encoding', 'context', 'raw', 'culture'
];

const POWERSHELL_PARAM_ALIASES = new Set([
  's', 'ad', 'd', 'af', 'ah', 'h', 'ar', 'as', 'lp', 'pspath',
  'vb', 'db', 'ea', 'wa', 'infa', 'proga', 'ev', 'wv', 'iv', 'ov', 'ob', 'pv'
]);

function isInsideDir(targetKey, dirKey) {
  return targetKey.startsWith(dirKey.endsWith('/') ? dirKey : `${dirKey}/`);
}

function valueFlagsFor(kind) {
  if (kind === 'ls' || kind === 'git ls-files') return LS_VALUE_FLAGS;
  if (kind === 'tree') return TREE_VALUE_FLAGS;
  if (kind === 'fd') return FD_VALUE_FLAGS;
  return VALUE_FLAGS;
}

// --- Search filters ---
// see docs/gateguard/design-notes.md#search-filters

const MAX_FILTER_GLOB_CHARS = 256;
const MAX_BRACE_ALTERNATIVES = 32;
const MAX_FILTERS_PER_SEARCH = 32;
const FIND_NAME_FLAGS = new Set(['-name', '-iname', '-path', '-ipath', '-wholename', '-iwholename', '-regex', '-iregex']);
const FIND_BASENAME_FLAGS = new Set(['-name', '-iname']);
const OPAQUE_FILTER_FLAGS = new Set(['--exclude-from', '--ignore-file', '--exclude-per-directory']);
const EXCLUDE_LONG_FLAGS = new Set(['--exclude', '--exclude-dir', '--ignore', '--hide']);
const LS_ONLY_EXCLUDE_FLAGS = new Set(['--ignore', '--hide']);
const GIT_EXCLUDE_PATHSPEC = /^:(?:[!^]|\([^)]*\bexclude\b[^)]*\))/;

function splitTopLevelCommas(value) {
  const parts = [];
  let depth = 0;
  let current = '';
  for (const ch of String(value)) {
    if (ch === '{') depth += 1;
    else if (ch === '}' && depth > 0) depth -= 1;
    if (ch === ',' && depth === 0) {
      parts.push(current);
      current = '';
    } else {
      current += ch;
    }
  }
  parts.push(current);
  return parts.map(part => part.trim()).filter(Boolean);
}

function expandBraces(glob) {
  const open = glob.indexOf('{');
  if (open === -1) return [glob];
  let depth = 0;
  for (let i = open; i < glob.length; i++) {
    if (glob[i] === '{') depth += 1;
    else if (glob[i] === '}' && --depth === 0) {
      const head = glob.slice(0, open);
      const tail = glob.slice(i + 1);
      const results = [];
      for (const option of splitTopLevelCommas(glob.slice(open + 1, i)).concat(glob[open + 1] === ',' ? [''] : [])) {
        const expanded = expandBraces(`${head}${option}${tail}`);
        if (!expanded) return null;
        results.push(...expanded);
        if (results.length > MAX_BRACE_ALTERNATIVES) return null;
      }
      return results;
    }
  }
  return [glob];
}

function globTokens(glob) {
  const tokens = [];
  for (let i = 0; i < glob.length; i++) {
    const ch = glob[i];
    if (ch === '*' && glob[i + 1] === '*') {
      const dirs = glob[i + 2] === '/';
      tokens.push({ type: dirs ? 'dirs' : 'deep' });
      i += dirs ? 2 : 1;
    } else if (ch === '*') {
      tokens.push({ type: 'star' });
    } else if (ch === '?') {
      tokens.push({ type: 'one' });
    } else if (ch === '[') {
      const parsed = bracketClass(glob, i);
      if (!parsed) return null;
      tokens.push(parsed.token);
      i = parsed.end;
    } else {
      tokens.push({ type: 'lit', ch });
    }
  }
  return tokens;
}

function bracketClass(glob, open) {
  let i = open + 1;
  const negated = glob[i] === '!' || glob[i] === '^';
  if (negated) i += 1;
  const ranges = [];
  for (let first = true; i < glob.length && (first || glob[i] !== ']'); first = false) {
    if (glob[i + 1] === '-' && i + 2 < glob.length && glob[i + 2] !== ']') {
      ranges.push([glob[i], glob[i + 2]]);
      i += 3;
    } else {
      ranges.push([glob[i], glob[i]]);
      i += 1;
    }
  }
  if (i >= glob.length) return null;
  return { token: { type: 'class', negated, ranges }, end: i };
}

function classMatches(token, ch) {
  if (ch === '/') return false;
  const forms = [ch, ch.toLowerCase(), ch.toUpperCase()];
  const member = token.ranges.some(([lo, hi]) => forms.some(form => form >= lo && form <= hi));
  return member !== token.negated;
}

// see docs/gateguard/design-notes.md#glob-matching-without-regexp
function wildcardMatch(glob, text) {
  const tokens = globTokens(glob);
  if (!tokens) return null;
  const n = text.length;
  let next = new Array(n + 1).fill(false);
  next[n] = true;
  for (let t = tokens.length - 1; t >= 0; t--) {
    const token = tokens[t];
    const row = new Array(n + 1).fill(false);
    let afterSlash = false;
    for (let j = n; j >= 0; j--) {
      if (token.type === 'lit') row[j] = j < n && text[j] === token.ch && next[j + 1];
      else if (token.type === 'one') row[j] = j < n && text[j] !== '/' && next[j + 1];
      else if (token.type === 'class') row[j] = j < n && classMatches(token, text[j]) && next[j + 1];
      else if (token.type === 'star') row[j] = next[j] || (j < n && text[j] !== '/' && row[j + 1]);
      else if (token.type === 'deep') row[j] = next[j] || (j < n && row[j + 1]);
      else {
        if (j < n && text[j] === '/' && next[j + 1]) afterSlash = true;
        row[j] = next[j] || afterSlash;
      }
    }
    next = row;
  }
  return next[0];
}

function normalizeFilterGlob(glob) {
  return String(glob).toLowerCase().replace(/\\/g, '/').replace(/^(?:\.\/)+/, '').replace(/^\/+/, '').replace(/\/+$/, '');
}

function globMatches(glob, text, malformed) {
  if (glob.length > MAX_FILTER_GLOB_CHARS) return null;
  const alternatives = expandBraces(glob);
  if (!alternatives) return null;
  return alternatives.some(alternative => {
    const matched = wildcardMatch(alternative, text);
    return matched === null ? malformed : matched;
  });
}

function targetSegments(ctx) {
  return ctx.targetKey.toLowerCase().split('/').filter(Boolean);
}

function exclusionCoversTarget(exclusion, segments, stem) {
  const glob = normalizeFilterGlob(exclusion);
  if (!glob) return true;
  if (stem !== null && stem.test(glob)) return true;
  for (let start = 0; start < segments.length; start++) {
    for (let end = start + 1; end <= segments.length; end++) {
      const matched = globMatches(glob, segments.slice(start, end).join('/'), true);
      if (matched !== false) return true;
    }
  }
  return false;
}

function filtersAdmitTarget(item, ctx, stem) {
  if (item.opaque) return false;
  const exclusions = Array.isArray(item.exclusions) ? item.exclusions : [];
  if (exclusions.length === 0) return true;
  if (exclusions.length > MAX_FILTERS_PER_SEARCH) return false;
  const segments = targetSegments(ctx);
  return !exclusions.some(exclusion => exclusionCoversTarget(exclusion, segments, stem));
}

function scopeRelativeSegments(item, ctx) {
  const scopes = item.scopes || (item.scope ? [item.scope] : []);
  const relatives = [];
  for (const parts of scopes) {
    const scope = ctx.resolveDir(...parts);
    if (isInsideDir(ctx.targetKey, scope)) relatives.push(ctx.targetKey.slice(scope.replace(/\/+$/, '').length + 1).toLowerCase().split('/'));
  }
  return relatives;
}

function includeAdmitsTarget(include, item, ctx) {
  const glob = normalizeFilterGlob(include);
  const unanchored = glob.replace(/^(?:\*\*\/)+/, '');
  if (!unanchored) return false;
  if (isBasenameGlob(unanchored)) {
    const segments = targetSegments(ctx);
    return globMatches(unanchored, segments[segments.length - 1] || '', false) === true;
  }
  if (!item.pathIncludes) return false;
  return scopeRelativeSegments(item, ctx).some(segments => {
    const starts = unanchored === glob ? [0] : segments.map((_, start) => start);
    return starts.some(start => globMatches(unanchored, segments.slice(start).join('/'), false) === true);
  });
}

// see docs/gateguard/design-notes.md#include-filters
function includesAdmitTarget(item, ctx) {
  const includes = Array.isArray(item.includes) ? item.includes : [];
  if (includes.length === 0) return true;
  if (includes.length > MAX_FILTERS_PER_SEARCH) return false;
  return includes.some(include => includeAdmitsTarget(include, item, ctx));
}

function isBasenameGlob(glob) {
  return !/[\\/]/.test(String(glob).replace(/^(?:\*\*[\\/])+/, ''));
}

function grepToolFilters(glob) {
  const filters = { positives: [], includes: [], exclusions: [], opaque: false };
  if (typeof glob !== 'string' || !glob) return filters;
  for (const part of splitTopLevelCommas(glob)) {
    if (part.startsWith('!')) filters.exclusions.push(part.slice(1));
    else {
      filters.positives.push(part);
      filters.includes.push(part);
    }
  }
  return filters;
}

function shellSearchFilters(kind, args) {
  const filters = { exclusions: [], includes: [], opaque: false, dropped: new Set() };
  if (kind === 'find') return findSearchFilters(args, filters);
  if (POWERSHELL_SEARCHES.has(kind)) return powershellSearchFilters(kind, args, filters);
  for (let i = 0; i < args.length; i++) {
    const arg = args[i];
    if (/^\d*[<>]/.test(arg)) break;
    const consumed = applyShellFilterArg(kind, args, i, filters);
    i += consumed;
  }
  return filters;
}

function applyShellFilterArg(kind, args, i, filters) {
  const arg = args[i];
  const exclude = (value, indexes, separator) => {
    for (const glob of separator ? String(value).split(separator) : [value]) {
      if (glob) filters.exclusions.push(glob);
    }
    indexes.forEach(index => filters.dropped.add(index));
  };
  const include = value => {
    if (value) filters.includes.push(value);
  };
  if (kind.startsWith('git ') && GIT_EXCLUDE_PATHSPEC.test(arg)) {
    exclude(arg.replace(GIT_EXCLUDE_PATHSPEC, ''), [i]);
    return 0;
  }
  if (arg.startsWith('--')) {
    const eq = arg.indexOf('=');
    const name = eq > 0 ? arg.slice(0, eq) : arg;
    const hasNext = eq <= 0 && i + 1 < args.length;
    const value = eq > 0 ? arg.slice(eq + 1) : hasNext ? args[i + 1] : '';
    const indexes = eq > 0 || !hasNext ? [i] : [i, i + 1];
    const consumed = indexes.length - 1;
    if (OPAQUE_FILTER_FLAGS.has(name)) {
      filters.opaque = true;
      return consumed;
    }
    if (name === '--glob' || name === '--iglob') {
      if (value.startsWith('!')) exclude(value.slice(1), indexes);
      else include(value);
      return consumed;
    }
    if (name === '--include') {
      include(value);
      return consumed;
    }
    if (EXCLUDE_LONG_FLAGS.has(name) && (kind === 'ls' || !LS_ONLY_EXCLUDE_FLAGS.has(name))) {
      exclude(value, indexes);
      return consumed;
    }
    return 0;
  }
  if (!/^-[A-Za-z]/.test(arg)) return 0;
  const letters = shortFilterLetters(kind);
  const valueFlags = valueFlagsFor(kind);
  for (let k = 1; k < arg.length; k++) {
    const letter = arg[k];
    if (!letters.has(letter)) {
      if (valueFlags.has(`-${letter}`)) return k === arg.length - 1 ? 1 : 0;
      continue;
    }
    const attached = arg.slice(k + 1);
    const value = attached || args[i + 1] || '';
    const indexes = attached || i + 1 >= args.length ? [i] : [i, i + 1];
    const consumed = indexes.length - 1;
    applyShortFilter(kind, letter, value, indexes, { filters, exclude, include });
    return consumed;
  }
  return 0;
}

function shortFilterLetters(kind) {
  if (kind === 'rg') return new Set(['g']);
  if (kind === 'fd') return new Set(['E']);
  if (kind === 'ls') return new Set(['I']);
  if (kind === 'tree') return new Set(['I', 'P']);
  if (kind === 'git ls-files') return new Set(['x', 'X']);
  return new Set();
}

function applyShortFilter(kind, letter, value, indexes, { filters, exclude, include }) {
  if (kind === 'rg') {
    if (value.startsWith('!')) exclude(value.slice(1), indexes);
    else include(value);
  } else if (kind === 'tree' && letter === 'P') {
    value.split('|').forEach(include);
  } else if (kind === 'git ls-files' && letter === 'X') {
    filters.opaque = true;
  } else {
    exclude(value, indexes, kind === 'tree' ? '|' : '');
  }
}

function findSearchFilters(args, filters) {
  let negateNext = false;
  let negatedDepth = 0;
  let depth = 0;
  for (let i = 0; i < args.length; i++) {
    const arg = args[i];
    if (/^\d*[<>]/.test(arg)) break;
    if (arg === '-not' || arg === '!') {
      negateNext = true;
      filters.dropped.add(i);
      continue;
    }
    if (arg === '(') {
      depth += 1;
      if (negateNext && negatedDepth === 0) negatedDepth = depth;
      negateNext = false;
      continue;
    }
    if (arg === ')') {
      if (negatedDepth === depth) negatedDepth = 0;
      depth = Math.max(depth - 1, 0);
      continue;
    }
    if (FIND_NAME_FLAGS.has(arg) && i + 1 < args.length) {
      const value = args[i + 1];
      if (negateNext || negatedDepth > 0 || args[i + 2] === '-prune') {
        filters.exclusions.push(value);
        filters.dropped.add(i);
        filters.dropped.add(i + 1);
      } else if (FIND_BASENAME_FLAGS.has(arg)) {
        filters.includes.push(value);
      }
      i += 1;
    }
    negateNext = false;
  }
  return filters;
}

function powershellParam(kind, arg) {
  const colon = arg.indexOf(':');
  const spelled = (colon === -1 ? arg.slice(1) : arg.slice(1, colon)).toLowerCase();
  const inline = colon === -1 ? null : arg.slice(colon + 1);
  const own = kind === 'get-childitem' || kind === 'gci' ? POWERSHELL_CHILDITEM_PARAMS : POWERSHELL_SELECTSTRING_PARAMS;
  const params = own.concat(POWERSHELL_COMMON_PARAMS);
  if (!spelled) return { name: null, inline };
  if (params.includes(spelled) || POWERSHELL_PARAM_ALIASES.has(spelled)) return { name: spelled, inline };
  const matches = params.filter(param => param.startsWith(spelled));
  return { name: matches.length === 1 ? matches[0] : null, inline };
}

function powershellFilterArg(kind, args, i) {
  if (!/^-[A-Za-z]/.test(args[i])) return null;
  const { name, inline } = powershellParam(kind, args[i]);
  if (!POWERSHELL_FILTER_PARAMS.has(name)) return null;
  const first = inline ? i : i + 1;
  if (first >= args.length) return { name, globs: [], end: i };
  let end = first;
  while (end + 1 < args.length && (args[end].endsWith(',') || args[end + 1].startsWith(','))) end += 1;
  const parts = [inline || args[first]].concat(args.slice(first + 1, end + 1));
  return { name, globs: splitTopLevelCommas(parts.join(',')), end };
}

function powershellSearchFilters(kind, args, filters) {
  for (let i = 0; i < args.length; i++) {
    const filter = powershellFilterArg(kind, args, i);
    if (filter) {
      if (filter.name === 'exclude') {
        filters.exclusions.push(...filter.globs);
        for (let k = i; k <= filter.end; k++) filters.dropped.add(k);
      } else {
        filter.globs.filter(Boolean).forEach(glob => filters.includes.push(glob));
      }
      i = filter.end;
    } else if (/^-[A-Za-z]/.test(args[i]) && powershellParam(kind, args[i]).name === null) {
      // see docs/gateguard/design-notes.md#powershell-parameter-binding
      filters.dropped.add(i);
      if (!args[i].includes(':') && i + 1 < args.length && !args[i + 1].startsWith('-')) filters.dropped.add(i + 1);
    }
  }
  return filters;
}

module.exports = {
  POWERSHELL_SEARCHES,
  isInsideDir,
  valueFlagsFor,
  powershellFilterArg,
  grepToolFilters,
  shellSearchFilters,
  filtersAdmitTarget,
  includesAdmitTarget
};
