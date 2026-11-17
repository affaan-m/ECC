'use strict';
/**
 * Tests for scripts/lib/gateguard-search-evidence.js.
 *
 * Run with: node tests/lib/gateguard-search-evidence.test.js
 */

const assert = require('assert');
const fs = require('fs');
const os = require('os');
const path = require('path');

const hookPath = path.join(__dirname, '..', '..', 'scripts', 'hooks', 'gateguard-fact-force.js');
const { scanCurrentTurn } = require(path.join(__dirname, '..', '..', 'scripts', 'lib', 'gateguard-turn-scan.js'));

console.log('=== Testing gateguard-search-evidence.js ===\n');

let passed = 0;
let failed = 0;

function test(desc, fn) {
  try {
    fn();
    console.log(`  ✓ ${desc}`);
    passed++;
  } catch (e) {
    console.log(`  ✗ ${desc}: ${e.message}`);
    failed++;
  }
}

function loadHook() {
  const stateDir = fs.mkdtempSync(path.join(os.tmpdir(), 'gateguard-search-evidence-state-'));
  const savedStateDir = process.env.GATEGUARD_STATE_DIR;
  process.env.GATEGUARD_STATE_DIR = stateDir;
  try {
    return require(hookPath);
  } finally {
    if (savedStateDir === undefined) delete process.env.GATEGUARD_STATE_DIR;
    else process.env.GATEGUARD_STATE_DIR = savedStateDir;
    fs.rmSync(stateDir, { recursive: true, force: true });
  }
}

const root = '/proj-search';
const transcriptDir = fs.mkdtempSync(path.join(os.tmpdir(), 'gateguard-search-evidence-'));
let seq = 0;
let uuidSeq = 0;
const nextUuid = () => `uuid-${++uuidSeq}`;
const human = text => ({ type: 'user', uuid: nextUuid(), message: { role: 'user', content: text } });
const toolUse = (id, name, input) => ({
  type: 'assistant',
  uuid: nextUuid(),
  message: { id: `msg_${id}`, role: 'assistant', content: [{ type: 'tool_use', id, name, input }] }
});
const toolResult = id => ({
  type: 'user',
  uuid: nextUuid(),
  message: { role: 'user', content: [{ type: 'tool_result', tool_use_id: id, is_error: false, content: 'ok' }] }
});
const search = (id, name, input) => [toolUse(id, name, input), toolResult(id)];
const writeTranscript = records => {
  seq += 1;
  const file = path.join(transcriptDir, `t-${seq}.jsonl`);
  fs.writeFileSync(file, records.map(r => JSON.stringify(r)).join('\n') + '\n', 'utf8');
  return file;
};

test('credits by Glob literal-prefix directory and stem, folding case only for Windows paths', () => {
  const { findCreditingSearch } = loadHook();
  const boundary = human('go');
  const t = writeTranscript([human('old'), boundary, ...search('toolu_u1', 'Glob', { pattern: '**/*.md' }), toolUse('toolu_u2', 'Grep', { pattern: 'pending' })]);
  const scan = scanCurrentTurn(t);
  assert.strictEqual(scan.turnId, boundary.uuid, 'turnId is the boundary uuid');
  assert.deepStrictEqual(scan.searches.map(s => [s.name, s.callsAgo]), [['Glob', 2]]);
  assert.strictEqual(scanCurrentTurn(path.join(transcriptDir, 'missing.jsonl')), null);
  const data = { cwd: root };
  assert.strictEqual(findCreditingSearch(scan, `${root}/new-notes.md`, true, data), null, 'Glob **/*.md gives no dir credit');
  const docsScan = scanCurrentTurn(
    writeTranscript([human('go'), ...search('toolu_u3', 'Glob', { pattern: 'docs/*.md' }), toolUse('toolu_u4', 'Grep', { pattern: 'x' })])
  );
  assert.ok(findCreditingSearch(docsScan, `${root}/docs/new-notes.md`, true, data), 'Glob literal prefix names the dir');
  assert.strictEqual(findCreditingSearch(docsScan, `${root}/docs/sub/new-notes.md`, true, data), null, 'not a subdirectory');
  assert.strictEqual(findCreditingSearch(scan, `${root}/new-notes.md`, false, data), null, 'Edit needs a stem match');
  assert.strictEqual(findCreditingSearch(null, `${root}/x.md`, true, data), null);
  const winScan = { turnId: null, searches: [{ name: 'LS', input: { path: 'C:\\Proj\\Src' }, callsAgo: 1, messageId: 'msg_w' }] };
  assert.ok(findCreditingSearch(winScan, 'c:/proj/src/new_file.js', true, { cwd: 'C:\\proj' }), 'win32 dir match folds case');
  const posixScan = { turnId: null, searches: [{ name: 'LS', input: { path: '/Proj/Src' }, callsAgo: 1, messageId: 'msg_p' }] };
  assert.strictEqual(findCreditingSearch(posixScan, '/proj/src/new_file.js', true, { cwd: '/proj' }), null, 'posix is case-sensitive');
});

test('findClosestMiss reports a reason code for the nearest non-qualifying search', () => {
  const { findClosestMiss } = loadHook();
  const data = { cwd: root };
  const target = `${root}/src/widget_factory.py`;
  const scanOf = (searches, extra = {}) => ({ turnId: null, searches, batchIds: new Map(), newestMessageId: null, shellCommands: [], reads: [], ...extra });
  const s = (name, input, messageId = 'msg_1') => ({ name, input, callsAgo: 1, messageId });
  const reason = (scan, allowDir = false, file = target) => (findClosestMiss(scan, file, allowDir, data) || {}).reason || null;
  assert.strictEqual(reason(scanOf([s('Grep', { pattern: 'widget_factory', path: `${root}/docs` })])), 'out-of-scope');
  assert.strictEqual(reason(scanOf([s('Grep', { pattern: 'widget_factory', glob: '!*.py' })])), 'excluded');
  assert.strictEqual(reason(scanOf([s('Grep', { pattern: 'widget_factory', glob: '*.md' })])), 'excluded', 'include globs that miss');
  assert.strictEqual(reason(scanOf([s('Grep', { pattern: 'widget_factory' }, 'msg_b')], { newestMessageId: 'msg_b' })), 'same-batch');
  assert.strictEqual(reason(scanOf([s('Bash', { command: 'git diff | grep widget_factory' })])), 'stdin-only');
  assert.strictEqual(reason(scanOf([s('Bash', { command: 'cat src/widget_factory.py' })])), 'not-a-search');
  assert.strictEqual(reason(scanOf([], { reads: [{ name: 'Read', path: 'src/widget_factory.py', callsAgo: 1 }] })), 'not-a-search');
  assert.strictEqual(reason(scanOf([s('Grep', { pattern: 'index' })]), false, `${root}/src/index.py`), 'generic-stem');
  assert.strictEqual(reason(scanOf([s('Grep', { pattern: 'unrelated' })])), null);
  assert.strictEqual(reason(scanOf([s('Grep', { pattern: 'widget_factory' })])), null, 'a crediting search is not a miss');
  assert.strictEqual(reason(scanOf([s('LS', { path: `${root}/src` })]), true, `${root}/src/brand_new.py`), null, 'dir credit is not a miss');
  assert.strictEqual(
    reason(scanOf([s('Grep', { pattern: 'widget_factory', path: `${root}/docs` }), s('Grep', { pattern: 'widget_factory', glob: '!*.py' })])),
    'excluded',
    'excluded outranks out-of-scope'
  );
  const miss = findClosestMiss(scanOf([s('Grep', { pattern: 'widget_factory', path: `${root}/docs` })]), target, false, data);
  assert.deepStrictEqual(Object.keys(miss).sort(), ['detail', 'name', 'reason']);
  for (const bad of [null, {}, { searches: 'x' }, scanOf([null, { name: 'Grep' }]), scanOf([], { reads: [null, { path: 5 }] })]) {
    assert.strictEqual(findClosestMiss(bad, target, false, data), null);
  }
  assert.strictEqual(findClosestMiss(scanOf([s('Grep', { pattern: 'widget_factory', path: '/elsewhere' })]), '', false, data), null);
});

test('a test target is credited by its module stem once the test affix is stripped', () => {
  const { findCreditingSearch } = loadHook();
  const data = { cwd: root };
  const scanOf = searches => ({ turnId: null, searches, batchIds: new Map(), newestMessageId: null, shellCommands: [], reads: [] });
  const s = (name, input) => ({ name, input, callsAgo: 1, messageId: 'msg_1' });
  const credits = (search, file) => Boolean(findCreditingSearch(scanOf([search]), `${root}/${file}`, false, data));
  assert.ok(credits(s('Bash', { command: 'rg -n "tokenizer" src tests' }), 'tests/parser/tokenizer.test.js'), '.test');
  assert.ok(credits(s('Grep', { pattern: 'tokenizer', path: `${root}/tests` }), 'tests/parser/tokenizer.spec.ts'), '.spec');
  assert.ok(credits(s('Grep', { pattern: 'widget_factory' }), 'tests/test_widget_factory.py'), 'test_ prefix');
  assert.ok(credits(s('Grep', { pattern: 'widget_factory' }), 'pkg/widget_factory_test.py'), '_test.py suffix');
  assert.ok(credits(s('Grep', { pattern: 'codec' }), 'internal/codec/codec_test.go'), '_test.go suffix');
  assert.ok(credits(s('Grep', { pattern: 'tokenizer.test' }), 'tests/parser/tokenizer.test.js'), 'the full stem still names it');
});

test('stripped test stems keep the generic, length, word-boundary and scope rules', () => {
  const { findCreditingSearch, findClosestMiss } = loadHook();
  const data = { cwd: root };
  const scanOf = searches => ({ turnId: null, searches, batchIds: new Map(), newestMessageId: null, shellCommands: [], reads: [] });
  const s = (name, input) => ({ name, input, callsAgo: 1, messageId: 'msg_1' });
  const credits = (search, file) => Boolean(findCreditingSearch(scanOf([search]), `${root}/${file}`, false, data));
  assert.strictEqual(credits(s('Grep', { pattern: 'index' }), 'tests/index.test.js'), false, 'index is generic');
  assert.strictEqual(credits(s('Grep', { pattern: 'app' }), 'src/app.spec.ts'), false, 'app is generic');
  assert.strictEqual(credits(s('Grep', { pattern: 'util' }), 'tests/test_util.py'), false, 'util is generic');
  assert.strictEqual(credits(s('Grep', { pattern: 'main' }), 'cmd/main_test.go'), false, 'main is generic');
  assert.strictEqual(credits(s('Grep', { pattern: 'abc' }), 'tests/abc.test.js'), false, 'too short');
  assert.strictEqual(credits(s('Grep', { pattern: 'tokenizers' }), 'tests/tokenizer.test.js'), false, 'word boundary');
  assert.strictEqual(credits(s('Grep', { pattern: 'tokenizer', path: `${root}/src` }), 'tests/tokenizer.test.js'), false, 'scope');
  assert.strictEqual(credits(s('Grep', { pattern: 'tokenizer', glob: '!*.test.js' }), 'tests/tokenizer.test.js'), false, 'excluded');
  assert.strictEqual(credits(s('Grep', { pattern: 'x', glob: '!tokenizer*' }), 'tests/tokenizer.test.js'), false, 'exclusion names the stem');
  assert.strictEqual(credits(s('Grep', { pattern: 'widget' }), 'tests/widget.test.test.js'), false, 'one affix only');
  assert.strictEqual(credits(s('Grep', { pattern: 'helpers' }), 'src/test_helpers.js'), false, 'test_ prefix only for Python');
  assert.strictEqual(credits(s('Grep', { pattern: 'widget' }), 'src/widget_test.js'), false, '_test suffix only for Python and Go');
  assert.strictEqual(credits(s('Grep', { pattern: 'tokenizer' }), 'skills/tokenizer.test.md'), false, 'instruction targets keep the full stem');
  const miss = findClosestMiss(scanOf([s('Grep', { pattern: 'index' })]), `${root}/tests/index.test.js`, false, data);
  assert.strictEqual(miss && miss.reason, 'generic-stem');
});

const filterScan = searches => ({ turnId: null, searches, batchIds: new Map(), newestMessageId: null, shellCommands: [], reads: [] });
const filterSearch = (name, input) => ({ name, input, callsAgo: 1, messageId: 'msg_1' });
const label = ([name, input]) => `${name} ${JSON.stringify(input)}`;

test('a type, extension or path pattern that misses the target stops its stem from crediting', () => {
  const { findCreditingSearch, findClosestMiss } = loadHook();
  const data = { cwd: root };
  const target = `${root}/src/parser/tokenizer.js`;
  const missing = [
    ['Bash', { command: 'rg -t py tokenizer src' }],
    ['Bash', { command: 'rg -T js tokenizer src' }],
    ['Bash', { command: 'rg --type-not js tokenizer src' }],
    ['Bash', { command: 'fd -e py tokenizer src' }],
    ['Grep', { pattern: 'tokenizer', type: 'py' }],
    ['Glob', { pattern: '**/tokenizer.py' }],
    ['Bash', { command: 'rg tokenizer src/*.py' }],
    ['Bash', { command: 'grep -rn tokenizer src/**/*.py' }],
    ['Bash', { command: "git grep tokenizer -- '*.py'" }],
    ['Bash', { command: "git ls-files '*tokenizer.py'" }]
  ];
  for (const search of missing) {
    const scan = filterScan([filterSearch(...search)]);
    assert.strictEqual(findCreditingSearch(scan, target, false, data), null, label(search));
    assert.strictEqual((findClosestMiss(scan, target, false, data) || {}).reason, 'excluded', label(search));
  }
  const covering = [
    ['Bash', { command: 'rg -t js tokenizer src' }],
    ['Bash', { command: 'fd -e js tokenizer src' }],
    ['Grep', { pattern: 'tokenizer', type: 'js' }],
    ['Glob', { pattern: '**/tokenizer*' }],
    ['Glob', { pattern: 'src/**/*tokenizer*' }],
    ['Bash', { command: 'rg tokenizer src/*' }],
    ['Bash', { command: 'rg tokenizer lib/*.py src' }],
    ['Bash', { command: "git grep tokenizer -- '*.js'" }],
    ['Bash', { command: "git grep tokenizer -- 'src/*.js'" }]
  ];
  for (const search of covering) {
    assert.ok(findCreditingSearch(filterScan([filterSearch(...search)]), target, false, data), label(search));
  }
});

test('a search confined to the target file name is a lookup, not a search', () => {
  const { findCreditingSearch, findClosestMiss } = loadHook();
  const data = { cwd: root };
  const target = `${root}/src/parser/tokenizer.js`;
  const lookups = [
    ['Glob', { pattern: '**/tokenizer.js' }],
    ['Glob', { pattern: 'src/**/tokenizer.js' }],
    ['Grep', { pattern: 'tokenizer', glob: 'tokenizer.js' }],
    ['Grep', { pattern: 'tokenizer', glob: '**/tokenizer.js' }],
    ['Bash', { command: 'find src -name tokenizer.js' }],
    ['Bash', { command: 'rg -g tokenizer.js tokenizer src' }],
    ['Bash', { command: 'rg -t js -g tokenizer.js tokenizer src' }],
    ['Grep', { pattern: 'tokenizer', type: 'js', glob: 'tokenizer.js' }],
    ['Bash', { command: 'rg --files -g tokenizer.js src' }],
    ['Bash', { command: 'rg tokenizer src/**/tokenizer.js' }]
  ];
  for (const search of lookups) {
    const scan = filterScan([filterSearch(...search)]);
    assert.strictEqual(findCreditingSearch(scan, target, false, data), null, label(search));
    assert.strictEqual((findClosestMiss(scan, target, false, data) || {}).reason, 'lookup', label(search));
  }
  const searches = [
    ['Glob', { pattern: '**/tokenizer.*' }],
    ['Bash', { command: "find src -name 'tokenizer.*'" }],
    ['Bash', { command: "rg -g tokenizer.js -g '*.ts' tokenizer src" }]
  ];
  for (const search of searches) {
    assert.ok(findCreditingSearch(filterScan([filterSearch(...search)]), target, false, data), label(search));
  }
  const testTarget = `${root}/tests/parser/tokenizer.test.js`;
  const lookupOfModule = filterScan([filterSearch('Glob', { pattern: '**/tokenizer.js' })]);
  assert.strictEqual(findCreditingSearch(lookupOfModule, testTarget, false, data), null, 'a Glob of the module never listed its test');
  assert.strictEqual((findClosestMiss(lookupOfModule, testTarget, false, data) || {}).reason, 'excluded');
});

test('PowerShell single-quoted backslash filters preserve inclusion and exclusion scope', () => {
  const { findCreditingSearch, findClosestMiss } = loadHook();
  const target = String.raw`C:\repo\src\lexer\handler.py`;
  const data = { cwd: String.raw`C:\repo` };
  for (const command of [String.raw`rg -g 'src\lexer\*.py' handler .`, String.raw`rg handler src\lexer`]) {
    assert.ok(findCreditingSearch(filterScan([filterSearch('PowerShell', { command })]), target, false, data), command);
  }
  const command = String.raw`rg -g '!src\lexer\*.py' handler .`;
  const scan = filterScan([filterSearch('PowerShell', { command })]);
  assert.equal(findCreditingSearch(scan, target, false, data), null);
  assert.equal(findClosestMiss(scan, target, false, data).reason, 'excluded');
  const ambiguous = String.raw`rg -g 'src''\lexer\*.py' handler .`;
  assert.equal(findCreditingSearch(filterScan([filterSearch('PowerShell', { command: ambiguous })]), target, false, data), null,
    'unsupported PowerShell literal-apostrophe syntax must never credit a different path');
});

fs.rmSync(transcriptDir, { recursive: true, force: true });

console.log(`\nResults: Passed: ${passed}, Failed: ${failed}`);
process.exit(failed > 0 ? 1 : 0);
