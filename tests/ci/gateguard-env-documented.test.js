/**
 * Surface test for #2573: every GATEGUARD_* environment variable the hook
 * reads must be documented in the GateGuard skill doc.
 *
 * `GATEGUARD_BASH_ROUTINE_DISABLED` shipped with no documentation at all and
 * `GATEGUARD_EXEMPT_GLOBS` was mentioned only in a release note, so operators
 * had no discoverable way to narrow the gate short of disabling it outright.
 * This pins the surface: adding a knob to the hook without documenting it
 * fails here.
 *
 * The env reads are extracted from *code only* — comments, string literals,
 * template-literal text and regex literals are blanked out first, so a knob
 * named in a comment or an error message is never mistaken for a read. And
 * because a regex scanner cannot see every possible access form, the supported
 * forms are enforced as a convention rather than assumed: any other way of
 * reaching `process.env` fails the guard below with instructions, instead of
 * silently letting an undocumented knob through.
 *
 * Supported (and enforced) read forms:
 *   process.env.GATEGUARD_X
 *   process.env['GATEGUARD_X']   // or "GATEGUARD_X"
 *
 * Run with: node tests/ci/gateguard-env-documented.test.js
 */

'use strict';

const assert = require('assert');
const fs = require('fs');
const path = require('path');

const repoRoot = path.join(__dirname, '..', '..');
const hookPath = path.join(repoRoot, 'scripts', 'hooks', 'gateguard-fact-force.js');
const skillPath = path.join(repoRoot, 'skills', 'gateguard', 'SKILL.md');

let passed = 0;
let failed = 0;

function test(name, fn) {
  try {
    fn();
    console.log(`  \u2713 ${name}`);
    return true;
  } catch (err) {
    console.log(`  \u2717 ${name}`);
    console.log(`    Error: ${err.message}`);
    return false;
  }
}

/** A `/` here starts a regex literal, not a division. */
const REGEX_CAN_FOLLOW = new Set([
  '', '(', ',', '=', ':', '[', '!', '&', '|', '?', '{', '}', ';', '+', '-', '*', '%', '~', '^', '<', '>',
]);
const REGEX_CAN_FOLLOW_KEYWORD = new Set([
  'await', 'case', 'delete', 'do', 'else', 'in', 'instanceof', 'new', 'of',
  'return', 'throw', 'typeof', 'void', 'yield',
]);

function regexFollowsKeyword(source, slashIndex) {
  const match = source.slice(0, slashIndex).match(/([A-Za-z_$][\w$]*)\s*$/);
  return Boolean(match && REGEX_CAN_FOLLOW_KEYWORD.has(match[1]));
}

/**
 * Blank out comments and literal text, preserving length and line breaks so
 * offsets stay comparable with the raw source.
 *
 * Code inside a template literal's `${...}` is preserved — it is real code and
 * may contain an env read — while the surrounding literal text is blanked.
 */
function blankCommentsAndLiterals(source) {
  const out = [];
  const emit = (ch) => out.push(ch === '\n' ? '\n' : ' ');
  const keep = (ch) => out.push(ch);

  let i = 0;
  let prev = '';
  // Stack of open template literals. 0 = in literal text, >=1 = inside `${...}`
  // (the number tracks brace nesting within the expression).
  const templates = [];
  const inTemplateText = () => templates.length > 0 && templates[templates.length - 1] === 0;

  while (i < source.length) {
    const ch = source[i];
    const next = source[i + 1];

    // Template-literal TEXT is handled first: inside it, `//`, quotes and `/`
    // are literal characters, not comments, strings or regexes.
    if (inTemplateText()) {
      if (ch === '\\') { emit(ch); if (i + 1 < source.length) { emit(source[i + 1]); } i += 2; continue; }
      if (ch === '`') { templates.pop(); emit(ch); prev = '`'; i += 1; continue; }
      if (ch === '$' && next === '{') {
        templates[templates.length - 1] = 1;
        keep(ch); keep(next); prev = '{'; i += 2;
        continue;
      }
      emit(ch); i += 1;
      continue;
    }

    if (ch === '/' && next === '/') {
      while (i < source.length && source[i] !== '\n') { emit(source[i]); i += 1; }
      continue;
    }

    if (ch === '/' && next === '*') {
      emit(ch); emit(next); i += 2;
      while (i < source.length && !(source[i] === '*' && source[i + 1] === '/')) { emit(source[i]); i += 1; }
      if (i < source.length) { emit('*'); emit('/'); i += 2; }
      continue;
    }

    if (ch === '/' && (REGEX_CAN_FOLLOW.has(prev) || regexFollowsKeyword(source, i))) {
      emit(ch); i += 1;
      let inClass = false;
      while (i < source.length) {
        const r = source[i];
        if (r === '\\') { emit(r); if (i + 1 < source.length) { emit(source[i + 1]); } i += 2; continue; }
        if (r === '[') { inClass = true; }
        else if (r === ']') { inClass = false; }
        else if (r === '/' && !inClass) { emit(r); i += 1; break; }
        else if (r === '\n') { break; }
        emit(r); i += 1;
      }
      prev = '/';
      continue;
    }

    if (ch === '"' || ch === "'") {
      const quote = ch;
      emit(ch); i += 1;
      while (i < source.length) {
        const s = source[i];
        if (s === '\\') { emit(s); if (i + 1 < source.length) { emit(source[i + 1]); } i += 2; continue; }
        if (s === quote) { emit(s); i += 1; break; }
        if (s === '\n') { break; }
        emit(s); i += 1;
      }
      prev = quote;
      continue;
    }

    if (ch === '`') {
      templates.push(0);
      emit(ch); i += 1;
      continue;
    }

    if (templates.length > 0 && ch === '}') {
      const depth = templates[templates.length - 1];
      if (depth === 1) { templates[templates.length - 1] = 0; keep(ch); i += 1; prev = '}'; continue; }
      if (depth > 1) { templates[templates.length - 1] = depth - 1; }
    }
    if (templates.length > 0 && ch === '{' && templates[templates.length - 1] >= 1) {
      templates[templates.length - 1] += 1;
    }

    keep(ch);
    if (!/\s/.test(ch)) { prev = ch; }
    i += 1;
  }

  return out.join('');
}

const DOTTED_READ = /process\.env\.(GATEGUARD_[A-Z0-9_]+)/g;
const QUOTED_KEY = /^(['"])(GATEGUARD_[A-Z0-9_]+)\1$/;
const PLAIN_QUOTED_KEY = /^(['"])[A-Za-z0-9_]+\1$/;

function matchAll(source, pattern) {
  return [...source.matchAll(pattern)].map(m => m[1]);
}

/**
 * Keys used in `process.env[...]`, located in code but read from the raw source.
 *
 * Blanking replaces literal *text* with spaces, which would erase the key
 * itself — so the bracket positions are found in the blanked code (proving the
 * access is real code, not a comment or a doc string) and the key is then read
 * back out of the raw source at the same offset. `blankCommentsAndLiterals`
 * preserves length, which is what makes the offsets interchangeable.
 */
function bracketedEnvKeys(source) {
  const code = blankCommentsAndLiterals(source);
  return [...code.matchAll(/process\.env\s*\[/g)]
    .map((m) => {
      const at = source.slice(m.index).match(/^process\.env\s*\[\s*([^\]]*?)\s*\]/);
      return at ? at[1] : null;
    })
    .filter(key => key !== null);
}

/** GATEGUARD_* env reads present in real code (comments and literals excluded). */
function readGateguardEnvNames(source) {
  const code = blankCommentsAndLiterals(source);
  const bracketed = bracketedEnvKeys(source)
    .map(key => (key.match(QUOTED_KEY) || [])[2])
    .filter(Boolean);
  return new Set([...matchAll(code, DOTTED_READ), ...bracketed]);
}

/**
 * Access forms this parser cannot follow. Each would let a GATEGUARD_* read
 * escape the documentation check, so they are rejected outright.
 */
const UNSUPPORTED_ACCESS = [
  { label: 'destructuring from process.env', pattern: /\}\s*=\s*process\.env\b/ },
  { label: 'process.env aliased to a binding', pattern: /(?:const|let|var)\s+[A-Za-z_$][\w$]*\s*=\s*process\.env\s*(?:[;,)\]]|$)/m },
  { label: 'spread of process.env', pattern: /\.\.\.\s*process\.env\b/ },
  { label: 'enumeration of process.env', pattern: /Object\.(?:keys|values|entries|assign|fromEntries)\(\s*process\.env\b/ },
  { label: 'Reflect access on process.env', pattern: /Reflect\.(?:get|has|set|deleteProperty|defineProperty|getOwnPropertyDescriptor|ownKeys)\(\s*process\.env\b/ },
];

/** `process.env[...]` whose key is not a plain quoted string. */
function findComputedEnvAccess(source) {
  return bracketedEnvKeys(source).filter(key => !PLAIN_QUOTED_KEY.test(key));
}

function findUnsupportedAccess(source) {
  const code = blankCommentsAndLiterals(source);
  const structural = UNSUPPORTED_ACCESS.filter(rule => rule.pattern.test(code)).map(rule => rule.label);
  const computed = findComputedEnvAccess(source).map(key => `computed process.env[${key}]`);
  return [...structural, ...computed];
}

console.log('\nGateGuard env-var documentation surface\n');

if (test('hook and skill doc both exist', () => {
  assert.ok(fs.existsSync(hookPath), `missing ${hookPath}`);
  assert.ok(fs.existsSync(skillPath), `missing ${skillPath}`);
})) passed++; else failed++;

const hookSource = fs.existsSync(hookPath) ? fs.readFileSync(hookPath, 'utf8') : '';
const skillDoc = fs.existsSync(skillPath) ? fs.readFileSync(skillPath, 'utf8') : '';
const envNames = readGateguardEnvNames(hookSource);

if (test('hook reads at least one GATEGUARD_* variable', () => {
  assert.ok(envNames.size > 0, 'no GATEGUARD_* env reads found - has the hook moved?');
})) passed++; else failed++;

if (test('every GATEGUARD_* variable the hook reads is documented', () => {
  const undocumented = [...envNames].filter(name => !skillDoc.includes(name)).sort();
  assert.deepStrictEqual(
    undocumented,
    [],
    `undocumented in skills/gateguard/SKILL.md: ${undocumented.join(', ')}`
  );
})) passed++; else failed++;

if (test('the documented knobs are the ones the hook actually reads', () => {
  // Guards the reverse drift: a doc naming a knob the hook no longer reads.
  // Compared against the parsed env reads, not raw source — a name surviving
  // only in a comment or error string must not satisfy this.
  const documented = [...new Set(skillDoc.match(/GATEGUARD_[A-Z0-9_]+/g) || [])];
  const stale = documented.filter(name => !envNames.has(name)).sort();
  assert.deepStrictEqual(stale, [], `documented but unread by the hook: ${stale.join(', ')}`);
})) passed++; else failed++;

if (test('the hook reaches process.env only through the supported literal forms', () => {
  const unsupported = findUnsupportedAccess(hookSource).sort();
  assert.deepStrictEqual(
    unsupported,
    [],
    'the hook uses an env access form this test cannot follow, so an undocumented '
    + 'GATEGUARD_* knob could bypass the check. Either keep to '
    + "`process.env.GATEGUARD_X` / `process.env['GATEGUARD_X']`, or teach "
    + `readGateguardEnvNames the new form. Found: ${unsupported.join(', ')}`
  );
})) passed++; else failed++;

// --- parser self-checks: the convention above is only worth as much as these ---

if (test('blanking preserves offsets and line count', () => {
  const blanked = blankCommentsAndLiterals(hookSource);
  assert.strictEqual(blanked.length, hookSource.length, 'blanking changed the source length');
  assert.strictEqual(
    blanked.split('\n').length,
    hookSource.split('\n').length,
    'blanking changed the line count'
  );
})) passed++; else failed++;

if (test('env reads are read from code, not from comments, strings or regexes', () => {
  const fixture = [
    "const a = process.env.GATEGUARD_REAL_ONE;",
    "const b = process.env['GATEGUARD_REAL_TWO'];",
    '// process.env.GATEGUARD_IN_LINE_COMMENT is only mentioned here',
    '/* process.env.GATEGUARD_IN_BLOCK_COMMENT */',
    "const msg = 'process.env.GATEGUARD_IN_STRING';",
    'const tpl = `process.env.GATEGUARD_IN_TEMPLATE ${process.env.GATEGUARD_REAL_THREE}`;',
    'const re = /process\\.env\\.GATEGUARD_IN_REGEX\\/\\//;',
  ].join('\n');
  const found = [...readGateguardEnvNames(fixture)].sort();
  assert.deepStrictEqual(found, ['GATEGUARD_REAL_ONE', 'GATEGUARD_REAL_THREE', 'GATEGUARD_REAL_TWO']);
})) passed++; else failed++;

if (test('a regex literal containing a slash does not swallow the code after it', () => {
  const fixture = 'const re = /a\\/\\/b/;\nconst x = process.env.GATEGUARD_AFTER_REGEX;';
  assert.deepStrictEqual([...readGateguardEnvNames(fixture)], ['GATEGUARD_AFTER_REGEX']);
})) passed++; else failed++;

if (test('a regex literal after a statement keyword is ignored', () => {
  const fixture = 'function matches() { return /process\\.env\\.GATEGUARD_IN_RETURN_REGEX/; }';
  assert.deepStrictEqual([...readGateguardEnvNames(fixture)], []);
})) passed++; else failed++;

if (test('the access guard rejects every form the parser cannot follow', () => {
  const cases = [
    ['destructuring', 'const { GATEGUARD_HIDDEN } = process.env;'],
    ['alias', 'const env = process.env;\nconst v = env.GATEGUARD_HIDDEN;'],
    ['computed template', 'const v = process.env[`GATEGUARD_${suffix}`];'],
    ['computed variable', 'const v = process.env[name];'],
    ['spread', 'const all = { ...process.env };'],
    ['enumeration', 'const ks = Object.keys(process.env);'],
    ['Reflect.get', "const v = Reflect.get(process.env, 'GATEGUARD_HIDDEN');"],
    ['Reflect.has', "const v = Reflect.has(process.env, 'GATEGUARD_HIDDEN');"],
    ['Reflect.ownKeys', 'const ks = Reflect.ownKeys(process.env);'],
  ];
  const missed = cases.filter(([, code]) => findUnsupportedAccess(code).length === 0).map(([label]) => label);
  assert.deepStrictEqual(missed, [], `access guard missed: ${missed.join(', ')}`);
})) passed++; else failed++;

if (test('the access guard accepts the supported forms and ignores commented ones', () => {
  const ok = [
    'const v = process.env.GATEGUARD_STATE_DIR;',
    "const v = process.env['GATEGUARD_STATE_DIR'];",
    'const v = process.env["GATEGUARD_STATE_DIR"];',
    '// const { GATEGUARD_HIDDEN } = process.env;',
    "const doc = 'const { GATEGUARD_HIDDEN } = process.env;';",
  ];
  const wrong = ok.filter(code => findUnsupportedAccess(code).length > 0);
  assert.deepStrictEqual(wrong, [], `false positives from the access guard: ${wrong.join(' | ')}`);
})) passed++; else failed++;

console.log(`\nPassed: ${passed}`);
console.log(`Failed: ${failed}\n`);

if (failed > 0) {
  process.exit(1);
}
