'use strict';
const assert = require('assert');
const fs = require('fs');
const os = require('os');
const path = require('path');
const { extractCoordinationState, mergeIssueBody, renderCoordinationState } = require('../../scripts/lib/github-coordination/parsing');
const { getCoordinationState } = require('../../scripts/lib/github-coordination/state');
const actions = require('../../scripts/lib/github-coordination/actions');
let passed = 0;
let failed = 0;
function test(name, fn) {
  try { fn(); passed++; console.log(`PASS ${name}`); }
  catch (error) { failed++; console.error(`FAIL ${name}: ${error.message}`); }
}
const section = payload => '<!-- ecc-coordination:start -->\n```json\n' + payload + '\n```\n<!-- ecc-coordination:end -->';
test('absent state and an empty object retain their existing defaults', () => {
  assert.strictEqual(extractCoordinationState('ordinary issue'), null);
  assert.deepStrictEqual(extractCoordinationState(section('{}')), {});
  assert.strictEqual(getCoordinationState({ body: 'ordinary issue' }).status, 'available');
});
test('malformed JSON remains an error through the state reader', () => {
  assert.throws(() => getCoordinationState({ number: 12, body: section('{broken') }), /malformed coordination/i);
});
test('present non-object coordination JSON is rejected', () => {
  for (const payload of ['null', '[]', 'false', '42', '"text"']) {
    assert.throws(() => extractCoordinationState(section(payload)), /coordination.*object/i);
  }
});
test('incomplete and duplicated coordination boundaries cannot be overwritten', () => {
  for (const body of ['<!-- ecc-coordination:start -->', '<!-- ecc-coordination:end -->',
    '<!-- ecc-coordination:start -->\nmissing fence\n<!-- ecc-coordination:end -->',
    section('{}') + '\n' + section('{}')]) {
    assert.throws(() => extractCoordinationState(body), /coordination/i);
    assert.throws(() => mergeIssueBody({ body }, { status: 'claimed' }), /coordination/i);
  }
});
test('parse errors never echo the coordination body', () => {
  try { extractCoordinationState(section('TOP_SECRET_FIXTURE not JSON')); assert.fail('expected parse error'); }
  catch (error) { assert.ok(!error.message.includes('TOP_SECRET_FIXTURE')); }
});
test('inline legacy boundaries preserve ownership and surrounding prose', () => {
  const body = 'Before ' + section('{"owner":"existing","notes":"retain"}') + ' after';
  assert.strictEqual(extractCoordinationState(body).owner, 'existing');
  const merged = mergeIssueBody({ body }, { owner: 'existing', notes: 'retain', status: 'blocked' });
  assert.strictEqual(extractCoordinationState(merged).owner, 'existing');
  assert.strictEqual(extractCoordinationState(merged).notes, 'retain');
  assert.ok(merged.startsWith('Before '));
  assert.ok(merged.includes(' after'));
  assert.strictEqual((merged.match(/ecc-coordination:start/g) || []).length, 1);
});
test('unclosed example fences cannot hide recorded state', () => {
  const body = '````markdown\n' + section('{"owner":"existing"}');
  assert.throws(() => extractCoordinationState(body), /coordination/i);
  assert.throws(() => mergeIssueBody({ body }, { owner: 'other' }), /coordination/i);
});
test('literal markers in prose, fenced examples and JSON notes remain intact', () => {
  for (const policy of [{}, { sectionMarker: 'custom-marker' }]) {
    const marker = policy.sectionMarker || 'ecc-coordination';
    const notes = `Literal <!-- ${marker}:end --> and triple backticks ` + '```';
    const example = '````markdown\n' + renderCoordinationState({ notes: 'example' }, policy) + '\n````';
    const narrative = `Inline <!-- ${marker}:start --> example\n${example}\n`;
    assert.strictEqual(extractCoordinationState(narrative, policy), null);
    for (const newline of ['\n', '\r\n']) {
      const body = (narrative + renderCoordinationState({ notes, status: 'blocked' }, policy) + '\nAfter section\n').replace(/\n/g, newline);
      assert.strictEqual(extractCoordinationState(body, policy).notes, notes);
      const merged = mergeIssueBody({ body }, { notes, status: 'claimed' }, policy);
      assert.strictEqual(extractCoordinationState(merged, policy).status, 'claimed');
      assert.strictEqual(extractCoordinationState(merged, policy).notes, notes);
      assert.ok(merged.includes(example.replace(/\n/g, newline)));
      assert.ok(merged.endsWith('After section\n'));
    }
  }
});
test('every action refuses damaged state before GitHub or local snapshot writes', () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'ecc-coordination-damaged-'));
  const prior = process.env.ECC_GH_SHIM;
  try {
    const log = path.join(root, 'calls.jsonl');
    const shim = path.join(root, 'gh.js');
    const issue = { number: 12, title: 'Retain damaged state', body: section('{broken'),
      state: 'OPEN', labels: [], author: { login: 'owner' } };
    const healthy = { ...issue, number: 11, body: section('{"status":"blocked"}') };
    fs.writeFileSync(shim, `const fs=require('fs');const args=process.argv.slice(2);
fs.appendFileSync(${JSON.stringify(log)},JSON.stringify(args)+'\\n');
const issue=${JSON.stringify(issue)};process.stdout.write(JSON.stringify(args[1]==='list'?[${JSON.stringify(healthy)},issue]:issue));`);
    process.env.ECC_GH_SHIM = shim;
    const store = new Proxy({}, { get: () => () => { throw Error('must not write snapshots'); } });
    for (const action of ['Claim', 'Sync', 'Validate', 'Publish', 'Review', 'Unblock', 'Decompose']) {
      const args = ['Sync', 'Unblock'].includes(action) ? ['o/r', {}, { store }] : ['o/r', 12, {}, { store }];
      assert.throws(() => actions[`apply${action}`](...args), /malformed coordination/i, action);
    }
    const calls = fs.readFileSync(log, 'utf8').trim().split('\n').map(JSON.parse);
    assert.ok(calls.every(args => ['view', 'list'].includes(args[1])), 'only reads may occur');
  } finally {
    if (prior === undefined) delete process.env.ECC_GH_SHIM; else process.env.ECC_GH_SHIM = prior;
    fs.rmSync(root, { recursive: true, force: true });
  }
});
console.log(`Passed: ${passed}, Failed: ${failed}`);
process.exitCode = failed ? 1 : 0;
