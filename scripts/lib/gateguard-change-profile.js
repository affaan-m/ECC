'use strict';

const { isSpace, isIdentChar, isLetter, shCodeLines, psCodeLines, batchCodeLines, normalizeShellLine } = require('./gateguard-code-lexer');
const { MAX_FILE_CHARS, lineEndAt, lineStartOf, cFamilyStartsFresh, pythonStartsFresh, shStartsFresh, psStartsFresh, batchStartsFresh, trivialInFile } = require('./gateguard-file-context');

// see docs/gateguard/change-profile.md#change-profile

const MAX_SIDE_BYTES = 64 * 1024;
const MAX_TOTAL_BYTES = 256 * 1024;
const MAX_EDITS = 64;

const UNKNOWN_PROFILE = Object.freeze({ known: false, language: null, touchesPublicSurface: true, touchesData: true, trivial: false });

const LANGUAGE_BY_EXT = new Map([
  ['.js', 'js'], ['.mjs', 'js'], ['.cjs', 'js'], ['.jsx', 'js'], ['.ts', 'js'], ['.tsx', 'js'], ['.mts', 'js'], ['.cts', 'js'],
  ['.py', 'python'], ['.pyi', 'python'],
  ['.go', 'go'],
  ['.rs', 'rust'],
  ['.java', 'java'],
  ['.kt', 'kotlin'], ['.kts', 'kotlin'],
  ['.cs', 'csharp'],
  ['.c', 'c'], ['.h', 'c'],
  ['.cc', 'cpp'], ['.cpp', 'cpp'], ['.cxx', 'cpp'], ['.hpp', 'cpp'], ['.hh', 'cpp'], ['.hxx', 'cpp'],
  ['.sh', 'shell'], ['.bash', 'shell'], ['.zsh', 'shell'],
  ['.ps1', 'powershell'], ['.psm1', 'powershell'],
  ['.bat', 'batch'], ['.cmd', 'batch']
]);

// --- Lexing ---
// see docs/gateguard/change-profile.md#trivial-edits

const C_FAMILY = { lineComment: '//', blockComment: true, quotes: '"\'', indentSensitive: false };

const C_CONTEXT = { ...C_FAMILY, startsFresh: cFamilyStartsFresh };

const LEX_SPECS = {
  js: { ...C_CONTEXT, flavor: 'js', forbiddenCode: '`/', jsx: true },
  go: { ...C_CONTEXT, flavor: 'go', forbiddenCode: '`' },
  rust: { ...C_CONTEXT, flavor: 'rust', quotes: '"', rustChars: true, rawPrefixes: 'r#', rustDocs: true },
  java: { ...C_CONTEXT, flavor: 'java', tripleQuotes: true },
  kotlin: { ...C_CONTEXT, flavor: 'kotlin', tripleQuotes: true, noDollarInStrings: true },
  csharp: { ...C_CONTEXT, flavor: 'csharp', tripleQuotes: true, rawPrefixes: '@$' },
  c: { ...C_CONTEXT, flavor: 'c', rawPrefixes: 'R' },
  cpp: { ...C_CONTEXT, flavor: 'c', rawPrefixes: 'R' },
  python: { lineComment: '#', blockComment: false, quotes: '"\'', indentSensitive: true, tripleQuotes: true, fStrings: true, startsFresh: pythonStartsFresh },
  shell: { lexer: shCodeLines, normalize: line => normalizeShellLine(line, '\\'), startsFresh: shStartsFresh },
  powershell: { lexer: psCodeLines, normalize: line => normalizeShellLine(line, '`'), startsFresh: psStartsFresh },
  batch: { lexer: batchCodeLines, normalize: line => line, startsFresh: batchStartsFresh }
};
const TS_EXTS = new Set(['.ts', '.mts', '.cts']);
const TS_SPEC = { ...LEX_SPECS.js, jsx: false };

function lexSpecFor(filePath, language) {
  if (language !== 'js') return LEX_SPECS[language];
  const base = baseName(filePath);
  return TS_EXTS.has(base.slice(base.lastIndexOf('.'))) ? TS_SPEC : LEX_SPECS.js;
}

// --- Public surface ---

function leadingWord(text, word) {
  return text.startsWith(word) && !isIdentChar(text[word.length]);
}

function containsWord(text, word) {
  for (let at = text.indexOf(word); at !== -1; at = text.indexOf(word, at + 1)) {
    if (!isIdentChar(text[at - 1]) && !isIdentChar(text[at + word.length])) return true;
  }
  return false;
}

function identifierAt(text, start) {
  let end = start;
  while (end < text.length && isIdentChar(text[end])) end++;
  return text.slice(start, end);
}

function skipSpaces(text, at) {
  while (at < text.length && isSpace(text[at])) at++;
  return at;
}

function isUpper(ch) {
  return ch !== undefined && ch >= 'A' && ch <= 'Z';
}

function jsLineIsSurface(line) {
  const t = line.slice(skipSpaces(line, 0));
  return leadingWord(t, 'export') || containsWord(t, 'exports') || leadingWord(t, 'public') || leadingWord(t, 'declare');
}

function pythonNameIsPublic(name) {
  if (!name) return false;
  return !name.startsWith('_') || (name.length > 4 && name.startsWith('__') && name.endsWith('__'));
}

function pythonLineIsSurface(line, index) {
  const start = skipSpaces(line, 0);
  const t = line.slice(start);
  if (t.includes('__all__')) return true;
  for (const keyword of ['def', 'class']) {
    if (leadingWord(t, keyword)) return pythonNameIsPublic(identifierAt(t, skipSpaces(t, keyword.length)));
  }
  if (leadingWord(t, 'async')) {
    const rest = t.slice(skipSpaces(t, 5));
    if (leadingWord(rest, 'def')) return pythonNameIsPublic(identifierAt(rest, skipSpaces(rest, 3)));
  }
  if (start !== 0) return false;
  const name = identifierAt(t, 0);
  const rest = skipSpaces(t, name.length);
  const after = t[rest];
  const assigned = (after === '=' && t[rest + 1] !== '=') || (after === ':' && skipSpaces(t, rest + 1) < t.length);
  if (!name || !isLetter(name[0]) || !assigned) return false;
  return index > 0 ? pythonNameIsPublic(name) : name === name.toUpperCase();
}

function goLineIsSurface(line) {
  const t = line.slice(skipSpaces(line, 0));
  if (isUpper(t[0])) return true;
  if (leadingWord(t, 'package')) return true;
  for (const keyword of ['type', 'var', 'const']) {
    if (leadingWord(t, keyword)) return isUpper(t[skipSpaces(t, keyword.length)]);
  }
  if (!leadingWord(t, 'func')) return false;
  let at = skipSpaces(t, 4);
  if (t[at] === '(') {
    const close = t.indexOf(')', at);
    if (close === -1) return true;
    at = skipSpaces(t, close + 1);
  }
  return isUpper(t[at]);
}

const RUST_SURFACE_ATTRIBUTES = ['#[macro_export', '#[derive', '#[repr', '#[no_mangle', '#[unsafe(no_mangle', '#[export_name', '#[unsafe(export_name'];

function rustLineIsSurface(line) {
  const t = line.slice(skipSpaces(line, 0));
  return leadingWord(t, 'pub') || leadingWord(t, 'impl') || leadingWord(t, 'trait') || leadingWord(t, 'extern') ||
    RUST_SURFACE_ATTRIBUTES.some(attribute => t.startsWith(attribute));
}

function shellFunctionName(t) {
  let end = 0;
  while (end < t.length && (isIdentChar(t[end]) || t[end] === '-' || t[end] === ':' || t[end] === '.')) end++;
  if (end === 0) return false;
  const open = skipSpaces(t, end);
  return t[open] === '(' && t[skipSpaces(t, open + 1)] === ')';
}

function shellLineIsSurface(line) {
  const t = line.slice(skipSpaces(line, 0));
  if (leadingWord(t, 'export') || leadingWord(t, 'function')) return true;
  if (leadingWord(t, 'declare') || leadingWord(t, 'typeset')) {
    const flags = t.slice(skipSpaces(t, 7));
    return flags[0] === '-' && identifierAt(flags, 1).includes('x');
  }
  return shellFunctionName(t);
}

const POWERSHELL_SURFACE_WORDS = ['function', 'filter', 'workflow', 'class', 'enum', 'param', 'export-modulemember', '[cmdletbinding', '$global:'];

function powershellLineIsSurface(line) {
  const t = line.slice(skipSpaces(line, 0)).toLowerCase();
  return POWERSHELL_SURFACE_WORDS.some(word => t.startsWith(word) && (word.endsWith(':') || !isIdentChar(t[word.length])));
}

const SURFACE_BY_LANGUAGE = {
  js: jsLineIsSurface,
  python: pythonLineIsSurface,
  go: goLineIsSurface,
  rust: rustLineIsSurface,
  shell: shellLineIsSurface,
  powershell: powershellLineIsSurface
};

function baseName(filePath) {
  return String(filePath).replace(/\\/g, '/').split('/').pop().toLowerCase();
}

function wholeFileIsSurface(filePath, language) {
  const base = baseName(filePath);
  return (language === 'js' && (base.endsWith('.d.ts') || base.endsWith('.d.mts') || base.endsWith('.d.cts'))) ||
    (language === 'python' && base === '__init__.py');
}

function textTouchesSurface(text, lineIsSurface) {
  let index = 0;
  let start = 0;
  for (let i = 0; i <= text.length; i++) {
    if (i === text.length || text[i] === '\n' || text[i] === '\r') {
      if (lineIsSurface(text.slice(start, i), index)) return true;
      index++;
      start = i + 1;
    }
  }
  return false;
}

// --- Container members ---
// see docs/gateguard/change-profile.md#public-surface

const MAX_OPENER_SCAN = 4 * 1024 * 1024;
const JS_BODY_KINDS = ['function', 'async'];
const JS_MEMBER_KINDS = ['class', 'abstract'];
const JS_CONTAINER_KINDS = ['interface', 'enum', 'type', 'namespace', 'module', 'const', 'let', 'var', 'declare', '{'];
const RUST_CONTAINER_KINDS = ['enum', 'struct', 'union', 'trait', 'use'];

function indentOf(line) {
  return line.slice(0, skipSpaces(line, 0));
}

function lineAt(text, start) {
  const end = lineEndAt(text, start);
  return { text: text.slice(start, end), next: end + (text[end] === '\r' && text[end + 1] === '\n' ? 2 : 1) };
}

function isCommentLine(t) {
  return t.startsWith('//') || t.startsWith('/*') || t.startsWith('*') || t.startsWith('#') || t.startsWith('@');
}

function enclosingOpener(text, at, budget) {
  let end = lineStartOf(text, at);
  while (end > 0) {
    let last = end - 1;
    if (text[last] === '\n' && text[last - 1] === '\r') last--;
    const start = lineStartOf(text, last);
    budget.left -= end - start;
    if (budget.left < 0) return null;
    const line = text.slice(start, last);
    end = start;
    if (!line.trim() || isSpace(line[0])) continue;
    if ('}])'.includes(line[0])) return null;
    if (isCommentLine(line)) continue;
    return { line, start };
  }
  return null;
}

function jsContainerKind(opener) {
  const t = opener.trimEnd();
  const bodyLike = t.includes('=>') || containsWord(t, 'function');
  if (containsWord(t, 'exports')) return !bodyLike && /[{[(]$/.test(t) ? 'all' : null;
  if (!leadingWord(t, 'export')) return null;
  let rest = t.slice(skipSpaces(t, 6));
  if (leadingWord(rest, 'default')) rest = rest.slice(skipSpaces(rest, 7));
  if (JS_BODY_KINDS.some(word => leadingWord(rest, word))) return null;
  if (JS_MEMBER_KINDS.some(word => leadingWord(rest, word))) return 'members';
  if (rest.startsWith('{')) return 'all';
  if (!JS_CONTAINER_KINDS.some(word => leadingWord(rest, word))) return null;
  return bodyLike ? null : 'all';
}

function containerKind(opener, language) {
  if (language === 'js') return jsContainerKind(opener);
  if (language === 'python') {
    if (opener.includes('__all__')) return 'all';
    return leadingWord(opener, 'class') && pythonNameIsPublic(identifierAt(opener, skipSpaces(opener, 5))) ? 'fields' : null;
  }
  if (language === 'rust' && leadingWord(opener, 'pub')) {
    const words = opener.split(/[^A-Za-z0-9_]+/);
    return RUST_CONTAINER_KINDS.some(word => words.includes(word)) ? 'members' : null;
  }
  return null;
}

function memberIndent(text, opener) {
  let at = lineAt(text, opener.start).next;
  while (at < text.length) {
    const line = lineAt(text, at);
    if (line.text.trim()) return indentOf(line.text);
    at = line.next;
  }
  return null;
}

function isMemberLine(line, indent, kind) {
  if (!indent || indentOf(line) !== indent) return false;
  const t = line.slice(indent.length);
  if (!t || '}])'.includes(t[0]) || isCommentLine(t)) return false;
  if (kind !== 'fields') return true;
  const name = identifierAt(t, 0);
  const after = t[skipSpaces(t, name.length)];
  return pythonNameIsPublic(name) && isLetter(name[0]) && (after === ':' || (after === '=' && t[skipSpaces(t, name.length) + 1] !== '='));
}

function containerTouchesSurface(pairs, fileText, language) {
  if (typeof fileText !== 'string' || fileText.length > MAX_FILE_CHARS) return false;
  const budget = { left: MAX_OPENER_SCAN };
  for (const [oldString, newString] of pairs) {
    const at = oldString ? fileText.indexOf(oldString) : -1;
    if (at === -1) continue;
    const opener = enclosingOpener(fileText, at, budget);
    if (budget.left < 0) return true;
    const kind = opener ? containerKind(opener.line, language) : null;
    if (!kind) continue;
    if (kind === 'all') return true;
    const indent = memberIndent(fileText, opener);
    const start = lineStartOf(fileText, at);
    const end = lineEndAt(fileText, at + oldString.length);
    const before = fileText.slice(start, end);
    const after = `${fileText.slice(start, at)}${newString}${fileText.slice(at + oldString.length, end)}`;
    if (`${before}\n${after}`.split(/\r\n|\r|\n/).some(line => isMemberLine(line, indent, kind))) return true;
  }
  return false;
}

// --- Data handling ---

const DATA_WORDS = new Set([
  'json', 'jsonl', 'ndjson', 'yaml', 'yml', 'csv', 'tsv', 'xml', 'toml', 'ini', 'parquet', 'avro', 'arrow', 'pickle', 'protobuf',
  'serde', 'serialize', 'serializer', 'serialise', 'deserialize', 'deserializer', 'deserialise', 'marshal', 'unmarshal',
  'schema', 'schemas', 'sql', 'sqlite', 'sqlite3', 'postgres', 'mysql', 'mongo', 'mongodb', 'database', 'db', 'cursor',
  'migration', 'migrations', 'orm', 'dataframe', 'pandas',
  'date', 'dates', 'datetime', 'timestamp', 'timestamps', 'strftime', 'strptime', 'isoformat', 'iso', 'iso8601', 'timezone',
  'tz', 'utc', 'epoch', 'dayjs', 'moment', 'luxon', 'instant',
  'fs', 'fopen', 'fread', 'fwrite', 'fgets', 'ioutil', 'bufio', 'pathlib', 'shutil', 'readfile', 'writefile', 'fstream',
  'ifstream', 'ofstream',
  'chrono', 'zoneinfo', 'pytz', 'tzinfo', 'temporal', 'base64', 'encoding', 'charset', 'codec', 'msgpack', 'bson', 'cbor',
  'xlsx', 'storage', 'cookie', 'cookies', 'redis', 'prisma', 'knex', 'sequelize', 'mongoose', 'typeorm', 'drizzle',
  'sqlalchemy', 'jdbc', 'firestore', 'dynamodb'
]);
const DATA_PAIRS = [
  ['read', 'file'], ['write', 'file'], ['append', 'file'], ['open', 'file'], ['read', 'text'], ['write', 'text'],
  ['read', 'bytes'], ['write', 'bytes'], ['read', 'to'], ['read', 'lines'], ['write', 'lines'], ['read', 'all'],
  ['file', 'reader'], ['file', 'writer'], ['file', 'stream'], ['read', 'csv'], ['to', 'csv'],
  ['time', 'now'], ['time', 'parse'], ['time', 'unix'], ['time', 'since'], ['time', 'format'], ['time', 'time'],
  ['time', 'duration'], ['time', 'zone'], ['time', 'stamp'], ['system', 'time']
];
const SQL_PAIRS = [['select', 'from'], ['insert', 'into'], ['delete', 'from'], ['create', 'table'], ['alter', 'table'], ['drop', 'table'], ['update', 'set']];

function* words(text) {
  let word = '';
  let prev = '';
  for (let i = 0; i <= text.length; i++) {
    const ch = text[i];
    const alnum = ch !== undefined && ((ch >= 'a' && ch <= 'z') || (ch >= 'A' && ch <= 'Z') || (ch >= '0' && ch <= '9'));
    const boundary = alnum && word && (
      (isUpper(ch) && !isUpper(prev) && !(prev >= '0' && prev <= '9')) ||
      (isUpper(ch) && isUpper(prev) && text[i + 1] >= 'a' && text[i + 1] <= 'z')
    );
    if (!alnum || boundary) {
      if (word) yield { word: word.toLowerCase(), call: !alnum && text[skipSpaces(text, i)] === '(' };
      word = alnum ? ch : '';
    } else {
      word += ch;
    }
    prev = ch;
  }
}

const SHELL_LANGUAGES = new Set(['shell', 'powershell', 'batch']);
const SHELL_DATA_WORDS = new Set(['curl', 'wget', 'jq', 'yq', 'xmllint', 'psql', 'tee', 'iwr', 'irm', 'clixml']);
const SHELL_DATA_PAIRS = [['out', 'file'], ['get', 'content'], ['set', 'content'], ['add', 'content'], ['web', 'request'], ['rest', 'method']];
const NULL_TARGETS = ['/dev/null', '/dev/stdout', '/dev/stderr', '$null', 'nul'];

function redirectTargetIsFile(text, at) {
  const start = skipSpaces(text, at);
  const ch = text[start];
  if (ch === undefined || ch === '\n' || ch === '\r' || ch === '&') return false;
  const rest = text.slice(start, start + 12).toLowerCase();
  return !NULL_TARGETS.some(target => rest.startsWith(target) && !isIdentChar(rest[target.length]) && rest[target.length] !== '.');
}

function shellRedirectsFile(text) {
  for (let i = 0; i < text.length; i++) {
    const ch = text[i];
    if (ch === '>') {
      const prev = text[i - 1];
      if (prev === '-' || prev === '=' || prev === '>') continue;
      let at = i + 1;
      if (text[at] === '>' || text[at] === '|') at++;
      if (text[at] === '=' || text[at] === '&') continue;
      if (redirectTargetIsFile(text, at)) return true;
    } else if (ch === '<') {
      const next = text[i + 1];
      if (text[i - 1] === '<' || next === '<' || next === '(' || next === '&' || next === '#' || next === '=') continue;
      if (redirectTargetIsFile(text, i + 1)) return true;
    }
  }
  return false;
}

function textTouchesData(text, language) {
  const shell = SHELL_LANGUAGES.has(language);
  if (shell && shellRedirectsFile(text)) return true;
  const seen = new Set();
  let previous = '';
  for (const { word, call } of words(text)) {
    if (DATA_WORDS.has(word)) return true;
    if (shell && (SHELL_DATA_WORDS.has(word) || SHELL_DATA_PAIRS.some(([a, b]) => previous === a && word === b))) return true;
    if (word === 'open' && call) return true;
    if (DATA_PAIRS.some(([a, b]) => previous === a && word === b)) return true;
    seen.add(word);
    previous = word;
  }
  return SQL_PAIRS.some(([a, b]) => seen.has(a) && seen.has(b));
}

// --- Profile ---

/** Language of a target by extension, or null when unsupported. */
function languageFor(filePath) {
  if (typeof filePath !== 'string' || !filePath) return null;
  const base = baseName(filePath);
  const dot = base.lastIndexOf('.');
  if (dot <= 0) return null;
  return LANGUAGE_BY_EXT.get(base.slice(dot)) || null;
}

function changeTexts(input) {
  if (input.tool === 'Write') {
    return typeof input.content === 'string' ? { sides: [input.content], pairs: [] } : null;
  }
  if (input.tool !== 'Edit' || !Array.isArray(input.edits) || input.edits.length === 0 || input.edits.length > MAX_EDITS) return null;
  const pairs = [];
  for (const entry of input.edits) {
    if (!entry || typeof entry !== 'object') return null;
    const oldString = entry.old_string;
    const newString = entry.new_string;
    if (typeof oldString !== 'string' || typeof newString !== 'string') return null;
    pairs.push([oldString, newString, entry.replace_all === true]);
  }
  return { sides: pairs.flatMap(([oldString, newString]) => [oldString, newString]), pairs };
}

function withinBounds(sides) {
  let total = 0;
  for (const side of sides) {
    if (side.length > MAX_SIDE_BYTES) return false;
    const bytes = Buffer.byteLength(side, 'utf8');
    if (bytes > MAX_SIDE_BYTES) return false;
    total += bytes;
    if (total > MAX_TOTAL_BYTES) return false;
  }
  return true;
}

/** Profile of one target's change from Edit/MultiEdit entries or Write content, judged against `fileText` when given; unknown on any doubt. */
function profileChange(input) {
  try {
    if (!input || typeof input !== 'object') return UNKNOWN_PROFILE;
    const language = languageFor(input.filePath);
    if (!language) return UNKNOWN_PROFILE;
    const texts = changeTexts(input);
    if (!texts || !withinBounds(texts.sides)) return UNKNOWN_PROFILE;
    const lineIsSurface = SURFACE_BY_LANGUAGE[language];
    const touchesPublicSurface = input.tool === 'Write' || !lineIsSurface || wholeFileIsSurface(input.filePath, language) ||
      texts.sides.some(side => textTouchesSurface(side, lineIsSurface)) || containerTouchesSurface(texts.pairs, input.fileText, language);
    const touchesData = texts.sides.some(side => textTouchesData(side, language));
    const trivial = input.tool === 'Edit' && trivialInFile(texts.pairs, input.fileText, lexSpecFor(input.filePath, language));
    return Object.freeze({ known: true, language, touchesPublicSurface, touchesData, trivial });
  } catch (_) {
    return UNKNOWN_PROFILE;
  }
}

module.exports = { MAX_SIDE_BYTES, MAX_TOTAL_BYTES, MAX_EDITS, UNKNOWN_PROFILE, languageFor, profileChange };
