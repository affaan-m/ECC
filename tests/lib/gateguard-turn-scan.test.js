'use strict';
/**
 * Tests for scripts/lib/gateguard-turn-scan.js: turn boundaries, turn ids,
 * result pairing, error results, duplicate ids and same-batch exclusion.
 *
 * Run with: node tests/lib/gateguard-turn-scan.test.js
 */

const assert = require('assert');
const fs = require('fs');
const os = require('os');
const path = require('path');

const libPath = path.join(__dirname, '..', '..', 'scripts', 'lib', 'gateguard-turn-scan.js');
const hookPath = path.join(__dirname, '..', '..', 'scripts', 'hooks', 'gateguard-fact-force.js');
const {
  isErrorToolResult,
  isToolResultRecord,
  isCompactionBoundary,
  scanCurrentTurn,
  excludedBatchId,
  createTurnScanner,
  currentTurnId,
  transcriptPathFor
} = require(libPath);

console.log('=== Testing gateguard-turn-scan.js ===\n');

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

// Transcript fixtures in the shape Claude Code writes (one JSON record per line).
const transcriptDir = fs.mkdtempSync(path.join(os.tmpdir(), 'gateguard-turn-scan-'));
let seq = 0;
let uuidSeq = 0;
const nextUuid = () => `uuid-${++uuidSeq}`;
const human = (text, extra = {}) => ({ type: 'user', uuid: nextUuid(), message: { role: 'user', content: text }, ...extra });
const toolUse = (id, name, input, extra = {}) => ({
  type: 'assistant',
  uuid: nextUuid(),
  message: { id: `msg_${id}`, role: 'assistant', content: [{ type: 'tool_use', id, name, input }] },
  ...extra
});
const toolResult = (id, isError = false, extra = {}) => ({
  type: 'user',
  uuid: nextUuid(),
  message: { role: 'user', content: [{ type: 'tool_result', tool_use_id: id, is_error: isError, content: 'ok' }] },
  ...extra
});
const search = (id, name, input) => [toolUse(id, name, input), toolResult(id)];
// Like Claude Code, a fixture ends with the pending call's own assistant record by default.
const writeTranscript = (records, { pending = true } = {}) => {
  seq += 1;
  const file = path.join(transcriptDir, `t-${seq}.jsonl`);
  const all = records.slice();
  if (pending) {
    all.push({
      type: 'assistant',
      uuid: nextUuid(),
      message: { id: `msg_pending_${seq}`, role: 'assistant', content: [{ type: 'tool_use', id: `toolu_pending_${seq}`, name: 'Edit', input: {} }] }
    });
  }
  const lines = all.map(r => (typeof r === 'string' ? r : JSON.stringify(r)));
  fs.writeFileSync(file, lines.join('\n') + '\n', 'utf8');
  return file;
};
// ~400 KiB of tool traffic: pushes earlier records out of the 256 KiB tail.
const filler = prefix => {
  const records = [];
  for (let i = 0; i < 40; i++) {
    const id = `toolu_${prefix}${i}`;
    records.push(toolUse(id, 'Bash', { command: 'npm test' }));
    records.push({
      type: 'user',
      message: { role: 'user', content: [{ type: 'tool_result', tool_use_id: id, content: 'y'.repeat(10 * 1024) }] }
    });
  }
  return records;
};

// ── turn id ──
console.log('turn id:');

test('boundary in window with promptId -> turnId is the promptId', () => {
  const t = writeTranscript([
    human('old', { promptId: 'prompt-old' }),
    human('now', { promptId: 'prompt-now' }),
    ...search('toolu_pid1', 'Grep', { pattern: 'widget_factory' }).map(r => (r.type === 'user' ? { ...r, promptId: 'prompt-now' } : r))
  ]);
  assert.strictEqual(scanCurrentTurn(t).turnId, 'prompt-now');
  const overlong = human('x', { promptId: 'p'.repeat(129) });
  assert.strictEqual(scanCurrentTurn(writeTranscript([overlong])).turnId, overlong.uuid, 'overlong promptId ignored');
});

test('records without promptId keep the uuid / hash / null turn id', () => {
  const boundary = human('now');
  assert.strictEqual(scanCurrentTurn(writeTranscript([boundary])).turnId, boundary.uuid);
  const noUuid = writeTranscript([{ type: 'user', message: { role: 'user', content: 'x' } }]);
  assert.ok(/^h:[0-9a-f]{16}$/.test(scanCurrentTurn(noUuid).turnId));
  const clipped = writeTranscript([human('long ago'), ...filler('nopid')]);
  assert.strictEqual(scanCurrentTurn(clipped).turnId, null, 'clipped window without promptId');
});

test('compaction summary and compact_boundary records start a turn', () => {
  const pre = [human('orig task'), ...search('toolu_c1', 'Grep', { pattern: 'payment' })];
  const summary = { type: 'user', uuid: nextUuid(), isCompactSummary: true, message: { role: 'user', content: 'Summary' } };
  const afterSummary = scanCurrentTurn(writeTranscript([...pre, summary], { pending: false }));
  assert.strictEqual(afterSummary.turnId, summary.uuid);
  assert.deepStrictEqual(afterSummary.searches, [], 'searches before compaction do not count');
  const marker = scanCurrentTurn(writeTranscript([...pre, { type: 'system', uuid: 'cb-1', subtype: 'compact_boundary' }], { pending: false }));
  assert.strictEqual(marker.turnId, 'cb-1');
  assert.deepStrictEqual(marker.searches, []);
  assert.strictEqual(isCompactionBoundary({ ...summary, isSidechain: true }), false, 'sidechain summaries are ignored');
});

test('meta and sidechain user records are not boundaries; tool_result records are not either', () => {
  const boundary = human('go');
  const t = writeTranscript(
    [
      boundary,
      ...search('toolu_m1', 'Grep', { pattern: 'alpha' }),
      human('meta note', { isMeta: true }),
      human('side prompt', { isSidechain: true })
    ],
    { pending: false }
  );
  const scan = scanCurrentTurn(t);
  assert.strictEqual(scan.turnId, boundary.uuid);
  assert.deepStrictEqual(scan.searches.map(s => s.name), ['Grep']);
  assert.strictEqual(isToolResultRecord(toolResult('x')), true);
  assert.strictEqual(isToolResultRecord(human('x')), false);
});

// ── which searches qualify ──
console.log('\nsearches:');

test('a search qualifies only with a paired, non-error, unique result', () => {
  const t = writeTranscript(
    [
      human('go'),
      ...search('toolu_ok', 'Grep', { pattern: 'ok' }),
      toolUse('toolu_noresult', 'Grep', { pattern: 'pending' }),
      toolUse('toolu_err', 'Grep', { pattern: 'err' }),
      toolResult('toolu_err', true),
      ...search('toolu_dup', 'Glob', { pattern: 'a/*' }),
      ...search('toolu_dup', 'Glob', { pattern: 'b/*' }),
      ...search('toolu_read', 'Read', { file_path: '/x.js' })
    ],
    { pending: false }
  );
  const scan = scanCurrentTurn(t);
  assert.deepStrictEqual(scan.searches.map(s => s.input.pattern), ['ok']);
});

test('error results are recognised without a boolean is_error', () => {
  assert.strictEqual(isErrorToolResult({ is_error: true }), true);
  assert.strictEqual(isErrorToolResult({ is_error: 'true' }), true);
  assert.strictEqual(isErrorToolResult({ content: '  <tool_use_error>denied</tool_use_error>' }), true);
  assert.strictEqual(isErrorToolResult({ content: [{ type: 'text', text: '<tool_use_error>x' }] }), true);
  assert.strictEqual(isErrorToolResult({ is_error: false, content: 'found 3 files' }), false);
});

test('callsAgo counts back from the newest call, skipping the pending call', () => {
  const t = writeTranscript([human('go'), ...search('toolu_a', 'Grep', { pattern: 'a' }), ...search('toolu_b', 'Bash', { command: 'ls' })]);
  const scan = scanCurrentTurn(t, `toolu_pending_${seq}`);
  assert.deepStrictEqual(scan.searches.map(s => [s.name, s.callsAgo]), [['Bash', 1], ['Grep', 2]]);
  assert.deepStrictEqual(scan.shellCommands, ['ls']);
});

test('the scan lists the turn Read calls newest first, skipping the pending call', () => {
  const t = writeTranscript([
    human('go'),
    toolUse('toolu_r1', 'Read', { file_path: 'src/a.js' }),
    toolResult('toolu_r1'),
    ...search('toolu_g', 'Grep', { pattern: 'a' }),
    toolUse('toolu_r2', 'Read', { file_path: 'src/b.js' }),
    toolResult('toolu_r2'),
    toolUse('toolu_r3', 'Read', { file_path: 42 })
  ]);
  const scan = scanCurrentTurn(t, `toolu_pending_${seq}`);
  assert.deepStrictEqual(scan.reads, [
    { name: 'Read', path: 'src/b.js', callsAgo: 2 },
    { name: 'Read', path: 'src/a.js', callsAgo: 4 }
  ]);
  assert.deepStrictEqual(scan.searches.map(s => s.name), ['Grep'], 'reads are never searches');
  const before = writeTranscript([toolUse('toolu_r0', 'Read', { file_path: 'x' }), toolResult('toolu_r0'), human('next')]);
  assert.deepStrictEqual(scanCurrentTurn(before).reads, [], 'reads before the turn are not listed');
});

test('no transcript, a directory, or a whole file without a boundary -> no searches', () => {
  assert.strictEqual(scanCurrentTurn(''), null);
  assert.strictEqual(scanCurrentTurn(path.join(transcriptDir, 'missing.jsonl')), null);
  assert.strictEqual(scanCurrentTurn(transcriptDir), null);
  const noBoundary = scanCurrentTurn(writeTranscript(search('toolu_nb', 'Grep', { pattern: 'x' }), { pending: false }));
  assert.deepStrictEqual(noBoundary.searches, []);
  assert.strictEqual(noBoundary.turnId, null);
});

test('boundary in window -> the boundary record\'s own promptId, not a newer record\'s', () => {
  const late = { ...toolResult('toolu_n3a'), promptId: 'P1' };
  const t = writeTranscript([human('one', { promptId: 'P1' }), human('two', { promptId: 'P2' }), toolUse('toolu_n3a', 'Bash', { command: 'true' }), late]);
  assert.strictEqual(scanCurrentTurn(t).turnId, 'P2', 'late tool_result stamped with the previous promptId');
  const noPid = human('two');
  const t2 = writeTranscript([noPid, toolUse('toolu_n3b', 'Bash', { command: 'true' }), { ...toolResult('toolu_n3b'), promptId: 'P9' }]);
  assert.strictEqual(scanCurrentTurn(t2).turnId, noPid.uuid, 'boundary without promptId falls back to its uuid');
});

test('clipped window without a boundary -> promptId only when all user records agree', () => {
  const stamp = (records, pid) => records.map(r => (r.type === 'user' ? { ...r, promptId: pid } : r));
  const agree = writeTranscript([
    human('long ago', { promptId: 'PA' }),
    ...stamp([...filler('agree'), ...search('toolu_agree', 'Grep', { pattern: 'payment' })], 'PA')
  ]);
  const agreeScan = scanCurrentTurn(agree);
  assert.strictEqual(agreeScan.turnId, 'PA');
  assert.ok(agreeScan.searches.some(s => s.name === 'Grep'), 'agreeing clipped window still credits');
  const mixed = filler('mixed');
  const disagree = writeTranscript([
    human('long ago', { promptId: 'PA' }),
    ...stamp(mixed.slice(0, 60), 'PA'),
    ...stamp([...mixed.slice(60), ...search('toolu_dis', 'Grep', { pattern: 'payment' })], 'PB')
  ]);
  const disagreeScan = scanCurrentTurn(disagree);
  assert.strictEqual(disagreeScan.turnId, null, 'two promptIds in the window');
  assert.deepStrictEqual(disagreeScan.searches, [], 'unattributable clipped window gives no credit');
  const metaNew = writeTranscript([
    human('long ago', { promptId: 'PA' }),
    ...stamp([...filler('meta'), ...search('toolu_meta', 'Grep', { pattern: 'payment' })], 'PA'),
    { type: 'user', uuid: nextUuid(), isMeta: true, promptId: 'PN', message: { role: 'user', content: '<command-message>' } }
  ]);
  const metaScan = scanCurrentTurn(metaNew);
  assert.strictEqual(metaScan.turnId, null, 'a meta record from another prompt also disagrees');
  assert.deepStrictEqual(metaScan.searches, [], 'previous-turn search behind an unrecognised turn start is not credited');
  const partial = writeTranscript([human('long ago', { promptId: 'PA' }), ...filler('partial').map((r, i) => (r.type === 'user' && i > 70 ? { ...r, promptId: 'PA' } : r))]);
  assert.strictEqual(scanCurrentTurn(partial).turnId, 'PA', 'records without a promptId do not disagree');
});

const MALFORMED_RECORDS = [
  '{"type":"assistant"}',
  '{"type":"assistant","message":null}',
  '{"type":"assistant","message":"str"}',
  '{"type":"assistant","message":{"content":"str"}}',
  '{"type":"assistant","message":{"content":[null,5,"x",{"type":"tool_use"}]}}',
  '{"type":"user","message":{"content":[{"type":"tool_result","tool_use_id":"q","content":{"toString":1}}]}}',
  '{"type":"user","message":{"content":[{"type":"tool_result","tool_use_id":"q","content":[null,{"type":"text","text":5}]}]}}',
  'null',
  '5',
  '"str"',
  '[]'
];
const MALFORMED_INPUTS = [
  undefined,
  null,
  0,
  1,
  '',
  'x',
  [],
  {},
  { message: null },
  { message: 'str' },
  { type: 'assistant' },
  { type: 'user', message: { content: {} } },
  { cwd: 5 },
  { tool_use_id: 5 },
  { batchIds: null, newestMessageId: 5 },
  { searches: null },
  new Proxy({}, {
    get() {
      throw new Error('trap');
    }
  })
];

test('every exported function tolerates malformed inputs without throwing', () => {
  const lib = require(libPath);
  const fns = Object.entries(lib).filter(([, fn]) => typeof fn === 'function');
  assert.ok(fns.length >= 9, `exported functions: ${fns.map(([name]) => name).join(', ')}`);
  for (const [name, fn] of fns) {
    MALFORMED_INPUTS.forEach((a, i) => {
      MALFORMED_INPUTS.forEach((b, j) => {
        try {
          const result = fn(a, b);
          if (typeof result === 'function') result();
        } catch (e) {
          assert.fail(`${name}(MALFORMED_INPUTS[${i}], MALFORMED_INPUTS[${j}]) threw: ${e.message}`);
        }
      });
    });
  }
});

test('scanCurrentTurn skips each malformed record and keeps the rest of the turn', () => {
  for (const bad of MALFORMED_RECORDS) {
    const t = writeTranscript([human('go', { promptId: 'PM' }), ...search('toolu_m1', 'Grep', { pattern: 'payment' }), bad]);
    let scan;
    assert.doesNotThrow(() => {
      scan = scanCurrentTurn(t, `toolu_pending_${seq}`);
    }, bad);
    assert.ok(scan, `${bad}: scan result`);
    assert.strictEqual(scan.turnId, 'PM', `${bad}: turn id`);
    assert.deepStrictEqual(scan.searches.map(s => s.name), ['Grep'], `${bad}: search kept`);
  }
  for (const bad of ['{"type":"user"}', '{"type":"user","message":null}', '{"type":"user","message":{"content":{}}}']) {
    const t = writeTranscript([human('go', { promptId: 'PM' }), ...search('toolu_m2', 'Grep', { pattern: 'payment' }), bad]);
    const scan = scanCurrentTurn(t, `toolu_pending_${seq}`);
    assert.ok(scan && /^h:/.test(scan.turnId), `${bad}: boundary turn id`);
    assert.deepStrictEqual(scan.searches, [], `${bad}: searches before it do not count`);
  }
});

// ── same-batch exclusion ──
console.log('\nsame batch:');

test('excludedBatchId: the pending call message when located, else the newest message', () => {
  const t = writeTranscript([human('go'), ...search('toolu_s1', 'Grep', { pattern: 'a' })]);
  const pendingId = `toolu_pending_${seq}`;
  const scan = scanCurrentTurn(t, pendingId);
  assert.strictEqual(excludedBatchId(scan, { tool_use_id: pendingId }), `msg_pending_${seq}`);
  assert.strictEqual(excludedBatchId(scan, {}), scan.newestMessageId);
  assert.strictEqual(excludedBatchId(scan, { tool_use_id: 'toolu_unknown' }), `msg_pending_${seq}`, 'unknown id: newest message');
});

// ── scanner wrapper ──
console.log('\nscanner:');

test('createTurnScanner reads the transcript once and currentTurnId guards the shape', () => {
  const boundary = human('go');
  const t = writeTranscript([boundary]);
  const saved = process.env.CLAUDE_TRANSCRIPT_PATH;
  try {
    process.env.CLAUDE_TRANSCRIPT_PATH = '';
    const getScan = createTurnScanner({ transcript_path: t });
    const first = getScan();
    fs.writeFileSync(t, JSON.stringify(human('changed')) + '\n', 'utf8');
    assert.strictEqual(getScan(), first, 'cached for the rest of run()');
    assert.strictEqual(currentTurnId(first), boundary.uuid);
    assert.strictEqual(currentTurnId(null), null);
    assert.strictEqual(currentTurnId({ turnId: '' }), null);
    assert.strictEqual(transcriptPathFor({ transcriptPath: '/x.jsonl' }), '/x.jsonl');
    assert.strictEqual(createTurnScanner({})(), null, 'no transcript: null scan');
  } finally {
    if (saved === undefined) delete process.env.CLAUDE_TRANSCRIPT_PATH;
    else process.env.CLAUDE_TRANSCRIPT_PATH = saved;
  }
});

test('the hook re-exports scanCurrentTurn', () => {
  // The hook prunes stale state files on load: point it at a scratch dir.
  const stateDir = fs.mkdtempSync(path.join(os.tmpdir(), 'gateguard-turn-scan-state-'));
  const savedStateDir = process.env.GATEGUARD_STATE_DIR;
  process.env.GATEGUARD_STATE_DIR = stateDir;
  try {
    assert.strictEqual(require(hookPath).scanCurrentTurn, scanCurrentTurn);
  } finally {
    if (savedStateDir === undefined) delete process.env.GATEGUARD_STATE_DIR;
    else process.env.GATEGUARD_STATE_DIR = savedStateDir;
    fs.rmSync(stateDir, { recursive: true, force: true });
  }
});

test('searchesMayNameTarget finds the stem in any search input', () => {
  const { searchesMayNameTarget } = require(libPath);
  const scanOf = (...inputs) => ({ searches: inputs.map(input => ({ name: 'Bash', input })) });
  assert.strictEqual(searchesMayNameTarget(scanOf({ command: 'rg widget .' }), 'src/widget.py'), true);
  assert.strictEqual(searchesMayNameTarget(scanOf({ command: 'rg other .' }, { pattern: 'x', glob: '*.md' }), 'src/widget.py'), false);
  assert.strictEqual(searchesMayNameTarget(scanOf({ command: "rg wid''get ." }), 'src/widget.py'), true, 'quotes cannot split the stem');
  assert.strictEqual(searchesMayNameTarget(scanOf({ command: 'rg "wid\\get" .' }), 'src/widget.py'), true, 'backslashes cannot split the stem');
  assert.strictEqual(searchesMayNameTarget(scanOf({ command: 'rg WIDGET .' }), 'src/widget.py'), true, 'case-insensitive');
  assert.strictEqual(searchesMayNameTarget(scanOf({ pattern: 'widget' }), 'tests/test_widget.py'), true, 'test prefix stripped');
  assert.strictEqual(searchesMayNameTarget(scanOf({ pattern: 'widget' }), 'src/widget.test.js'), true, 'test suffix stripped');
  assert.strictEqual(searchesMayNameTarget(scanOf({ pattern: 'widget' }), 'pkg/widget_test.go'), true, 'go test suffix stripped');
  assert.strictEqual(searchesMayNameTarget({ searches: [] }, 'src/widget.py'), false);
  assert.strictEqual(searchesMayNameTarget(null, 'src/widget.py'), false);
  assert.strictEqual(searchesMayNameTarget(scanOf({ command: 'ls' }), 'dir/'), true, 'no stem: never skipped');
});

fs.rmSync(transcriptDir, { recursive: true, force: true });

console.log(`\nResults: Passed: ${passed}, Failed: ${failed}`);
process.exit(failed > 0 ? 1 : 0);
