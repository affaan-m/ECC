'use strict';
// Hidden grader for forge-cli: drives run(argv, state) through the twelve
// contractual behaviors plus never-throw fuzzing and static hygiene. Prints
// ECC_EVAL_SCORE and always exits 0.
const fs = require('node:fs');
const path = require('node:path');

const checks = [];
const record = (name, ok) => checks.push({ name, ok: Boolean(ok) });

const root = process.cwd();
let run;
try { ({ run } = require(path.join(root, 'src', 'cli.js'))); } catch { /* scored below */ }

const USAGE = 'usage: snippet <add|get|list|remove|search|export|import>\n';
const ADD_USAGE = 'usage: add <name> [--tags t1,t2] <text...>\n';

if (typeof run !== 'function') {
  for (let i = 0; i < 26; i++) record(`check-${i + 1}`, false);
} else {
  const call = (argv, state) => {
    try {
      const result = run(argv, state);
      if (!result || typeof result.code !== 'number'
        || typeof result.stdout !== 'string' || typeof result.stderr !== 'string') return null;
      return result;
    } catch { return null; }
  };

  // Basic lifecycle.
  let s = {};
  let r = call(['add', 'hello', 'hello', 'world'], s);
  record('add-happy', r && r.code === 0 && r.stdout === 'created hello\n' && r.stderr === '');
  r = call(['add', 'hello', 'different', 'text'], s);
  const afterDup = call(['get', 'hello'], s);
  record('add-duplicate-rejected', r && r.code === 1 && r.stderr === "error: snippet 'hello' already exists\n"
    && afterDup && afterDup.stdout === 'hello world\n');
  const m1 = call(['add'], s);
  const m2 = call(['add', 'justname'], s);
  record('add-missing-args-usage', m1 && m1.code === 2 && m1.stderr === ADD_USAGE
    && m2 && m2.code === 2 && m2.stderr === ADD_USAGE);
  r = call(['add', 'Bad_Name', 'text'], s);
  record('invalid-name-rejected', r && r.code === 2 && r.stderr === "error: invalid snippet name 'Bad_Name'\n");
  r = call(['get', 'hello'], s);
  record('get-happy', r && r.code === 0 && r.stdout === 'hello world\n');
  r = call(['get', 'ghost'], s);
  record('get-unknown', r && r.code === 2 && r.stderr === "error: no snippet named 'ghost'\n");

  // Listing and tags.
  s = {};
  call(['add', 'bravo', 'second'], s);
  call(['add', 'alpha', '--tags', 'x,y', 'first'], s);
  call(['add', 'charlie', '--tags', 'y', 'third'], s);
  r = call(['list'], s);
  record('list-sorted', r && r.code === 0 && r.stdout === 'alpha\nbravo\ncharlie\n');
  r = call(['list'], {});
  record('list-empty', r && r.code === 0 && r.stdout === 'no snippets\n');
  r = call(['list', '--tag', 'y'], s);
  record('list-tag-filter', r && r.code === 0 && r.stdout === 'alpha\ncharlie\n');

  // Removal.
  r = call(['remove', 'bravo'], s);
  const gone = call(['get', 'bravo'], s);
  record('remove-happy', r && r.code === 0 && r.stdout === 'removed bravo\n' && gone && gone.code === 2);
  r = call(['remove', 'bravo'], s);
  record('remove-unknown', r && r.code === 2 && r.stderr === "error: no snippet named 'bravo'\n");

  // Search over name and text, case-insensitive, sorted.
  r = call(['search', 'FIRST'], s);
  record('search-text-case-insensitive', r && r.code === 0 && r.stdout === 'alpha\n');
  r = call(['search', 'char'], s);
  record('search-name-match', r && r.code === 0 && r.stdout === 'charlie\n');
  r = call(['search', 'zzz'], s);
  record('search-no-matches', r && r.code === 0 && r.stdout === 'no matches\n');

  // Export/import round-trip with stable ordering.
  r = call(['export'], s);
  let doc = null;
  try { doc = r && JSON.parse(r.stdout); } catch { /* wrong */ }
  record('export-json-sorted', doc && r.code === 0 && sameDoc(doc, {
    snippets: { alpha: { text: 'first', tags: ['x', 'y'] }, charlie: { text: 'third', tags: ['y'] } } })
    && r.stdout.indexOf('alpha') < r.stdout.indexOf('charlie'));
  const importedState = { snippets: { alpha: { text: 'preexisting', tags: [] } } };
  r = call(['import', JSON.stringify({ snippets: {
    alpha: { text: 'first', tags: ['x', 'y'] }, delta: { text: 'fourth', tags: ['z'] } } })], importedState);
  const delta = call(['get', 'delta'], importedState);
  const alpha = call(['get', 'alpha'], importedState);
  record('import-merge-skip-existing', r && r.code === 0 && r.stdout === 'imported 1, skipped 1\n'
    && delta && delta.stdout === 'fourth\n' && alpha && alpha.stdout === 'preexisting\n');
  const beforeExport = call(['export'], s);
  r = call(['import', '{not json'], s);
  const afterExport = call(['export'], s);
  record('import-malformed-atomic', r && r.code === 1 && r.stderr === 'error: invalid JSON\n'
    && beforeExport && afterExport && beforeExport.stdout === afterExport.stdout);

  // Usage fallbacks.
  r = call(['bogus'], {});
  record('unknown-command-usage', r && r.code === 2 && r.stderr === USAGE);
  r = call([], {});
  record('no-command-usage', r && r.code === 2 && r.stderr === USAGE);

  // Never-throw fuzzing on junk input.
  const fuzz = [['--help', 'x'], ['get'], ['add', 'x', 'y', '--tags'], ['import']];
  fuzz.forEach((argv, index) => {
    record(`fuzz-never-throws-${index + 1}`, call(argv, {}) !== null);
  });
}

function sameDoc(a, b) { return JSON.stringify(a) === JSON.stringify(b); }

// Static hygiene.
try {
  const pkg = JSON.parse(fs.readFileSync(path.join(root, 'package.json'), 'utf8'));
  record('no-external-dependencies', !pkg.dependencies && !pkg.devDependencies);
} catch { record('no-external-dependencies', false); }
try {
  const sources = [];
  const walk = directory => {
    for (const entry of fs.readdirSync(directory, { withFileTypes: true })) {
      const item = path.join(directory, entry.name);
      if (entry.isDirectory()) walk(item);
      else if (entry.name.endsWith('.js')) sources.push(fs.readFileSync(item, 'utf8'));
    }
  };
  walk(path.join(root, 'src'));
  record('no-leftover-todos', sources.every(source => !/TODO|FIXME/.test(source)));
} catch { record('no-leftover-todos', false); }

const okCount = checks.filter(c => c.ok).length;
for (const c of checks) console.log(`${c.ok ? 'ok' : 'not ok'} - ${c.name}`);
console.log(`ECC_EVAL_SCORE ${JSON.stringify({ score: okCount / checks.length, passed: okCount, total: checks.length })}`);
process.exit(0);
