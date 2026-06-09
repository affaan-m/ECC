'use strict';

const assert = require('assert');

const {
  normalizeRepo,
  extractCoordinationState,
  buildIssueStateFromAction,
  desiredLabelsForState,
  extractTasks,
  renderCoordinationState,
  DEFAULT_POLICY,
} = require('../../scripts/lib/github-coordination');

async function test(name, fn) {
  try {
    await fn();
    console.log(`  ✓ ${name}`);
    return true;
  } catch (error) {
    console.log(`  ✗ ${name}`);
    console.log(`    Error: ${error.message}`);
    return false;
  }
}

async function runTests() {
  console.log('\n=== Testing github-coordination ===\n');

  let passed = 0;
  let failed = 0;

  // normalizeRepo

  if (await test('normalizeRepo returns { owner, name } for "owner/repo"', () => {
    const result = normalizeRepo('acme/my-repo');
    assert.deepStrictEqual(result, { owner: 'acme', name: 'my-repo' });
  })) passed += 1; else failed += 1;

  if (await test('normalizeRepo throws on "owner/repo/extra"', () => {
    assert.throws(
      () => normalizeRepo('owner/repo/extra'),
      /Invalid repo format/
    );
  })) passed += 1; else failed += 1;

  if (await test('normalizeRepo throws on bare string with no slash', () => {
    assert.throws(
      () => normalizeRepo('justowner'),
      /Invalid repo format/
    );
  })) passed += 1; else failed += 1;

  // extractCoordinationState

  if (await test('extractCoordinationState returns null for body with no coordination section', () => {
    const result = extractCoordinationState('## Some issue\n\nJust text, no coordination block.');
    assert.strictEqual(result, null);
  })) passed += 1; else failed += 1;

  if (await test('extractCoordinationState returns parsed state from a proper coordination JSON block', () => {
    const state = { schemaVersion: 'ecc.github.coordination.v1', kind: 'epic', status: 'available' };
    const body = [
      '<!-- ecc-coordination:start -->',
      '```json',
      JSON.stringify(state, null, 2),
      '```',
      '<!-- ecc-coordination:end -->',
    ].join('\n');
    const result = extractCoordinationState(body);
    assert.ok(result !== null);
    assert.strictEqual(result.status, 'available');
    assert.strictEqual(result.kind, 'epic');
    assert.strictEqual(result.schemaVersion, 'ecc.github.coordination.v1');
  })) passed += 1; else failed += 1;

  if (await test('extractCoordinationState returns null when JSON block is malformed', () => {
    const body = [
      '<!-- ecc-coordination:start -->',
      '```json',
      '{ not valid json }',
      '```',
      '<!-- ecc-coordination:end -->',
    ].join('\n');
    const result = extractCoordinationState(body);
    assert.strictEqual(result, null);
  })) passed += 1; else failed += 1;

  // buildIssueStateFromAction

  if (await test('buildIssueStateFromAction with "claim" action sets status, owner, branch, lastAction, lastActionAt', () => {
    const issue = { number: 1, body: '', labels: [] };
    const currentState = {
      schemaVersion: DEFAULT_POLICY.schemaVersion,
      status: 'available',
      owner: null,
      branch: null,
      validation: 'pending',
      review: 'not-requested',
      dependencies: [],
      tasks: [],
    };
    const before = new Date();
    const result = buildIssueStateFromAction(issue, currentState, 'claim', {
      owner: 'alice',
      branch: 'feat/my-branch',
      status: 'claimed',
    });
    const after = new Date();

    assert.strictEqual(result.status, 'claimed');
    assert.strictEqual(result.owner, 'alice');
    assert.strictEqual(result.branch, 'feat/my-branch');
    assert.strictEqual(result.lastAction, 'claim');
    assert.ok(result.lastActionAt);
    const actionAt = new Date(result.lastActionAt);
    assert.ok(actionAt >= before && actionAt <= after);
  })) passed += 1; else failed += 1;

  if (await test('buildIssueStateFromAction with "unblock" action preserves owner from existing state', () => {
    const issue = { number: 2, body: '', labels: [] };
    const currentState = {
      schemaVersion: DEFAULT_POLICY.schemaVersion,
      status: 'blocked',
      owner: 'bob',
      branch: 'feat/blocked-branch',
      validation: 'pending',
      review: 'not-requested',
      dependencies: [],
      tasks: [],
    };
    const result = buildIssueStateFromAction(issue, currentState, 'unblock', {
      status: 'ready',
    });

    assert.strictEqual(result.status, 'ready');
    assert.strictEqual(result.owner, 'bob');
    assert.strictEqual(result.branch, 'feat/blocked-branch');
    assert.strictEqual(result.lastAction, 'unblock');
  })) passed += 1; else failed += 1;

  // desiredLabelsForState

  if (await test('desiredLabelsForState for status "available" includes "coordination:available"', () => {
    const labels = desiredLabelsForState({ status: 'available' });
    assert.ok(Array.isArray(labels));
    assert.ok(labels.includes('coordination:available'), `Expected coordination:available in [${labels.join(', ')}]`);
  })) passed += 1; else failed += 1;

  if (await test('desiredLabelsForState for status "claimed" includes "coordination:claimed" but not "coordination:available"', () => {
    const labels = desiredLabelsForState({ status: 'claimed' });
    assert.ok(labels.includes('coordination:claimed'), `Expected coordination:claimed in [${labels.join(', ')}]`);
    assert.ok(!labels.includes('coordination:available'), `Did not expect coordination:available in [${labels.join(', ')}]`);
  })) passed += 1; else failed += 1;

  // extractTasks

  if (await test('extractTasks returns empty array when body has no Tasks section', () => {
    const body = 'Some issue without any task list.';
    const tasks = extractTasks(body);
    assert.deepStrictEqual(tasks, []);
  })) passed += 1; else failed += 1;

  if (await test('extractTasks parses completed and open checkboxes under ## Tasks heading', () => {
    const body = [
      '## Tasks',
      '- [x] Done task',
      '- [ ] Open task',
      '- [x] Another done task',
    ].join('\n');
    const tasks = extractTasks(body);
    const completed = tasks.filter(t => t.done);
    const open = tasks.filter(t => !t.done);
    assert.strictEqual(tasks.length, 3);
    assert.strictEqual(completed.length, 2);
    assert.strictEqual(open.length, 1);
    assert.strictEqual(open[0].title, 'Open task');
  })) passed += 1; else failed += 1;

  if (await test('extractTasks stops parsing at next heading after task section', () => {
    const body = [
      '## Tasks',
      '- [x] First task',
      '## Notes',
      '- [ ] This is not a task',
    ].join('\n');
    const tasks = extractTasks(body);
    assert.strictEqual(tasks.length, 1);
    assert.strictEqual(tasks[0].title, 'First task');
  })) passed += 1; else failed += 1;

  // renderCoordinationState

  if (await test('renderCoordinationState returns a string containing the section marker', () => {
    const state = {
      schemaVersion: 'ecc.github.coordination.v1',
      kind: 'epic',
      status: 'available',
      owner: null,
      branch: null,
      validation: 'pending',
      review: 'not-requested',
      project: { state: 'backlog', fields: {} },
      dependencies: [],
      tasks: [],
      labels: [],
      lastAction: 'sync',
      lastActionAt: '2026-01-01T00:00:00.000Z',
      lastSyncAt: '2026-01-01T00:00:00.000Z',
      notes: null,
    };
    const rendered = renderCoordinationState(state);
    assert.ok(typeof rendered === 'string');
    assert.ok(rendered.includes('<!-- ecc-coordination:start -->'), 'Missing start marker');
    assert.ok(rendered.includes('<!-- ecc-coordination:end -->'), 'Missing end marker');
    assert.ok(rendered.includes('```json'), 'Missing json code fence');
  })) passed += 1; else failed += 1;

  if (await test('renderCoordinationState output round-trips through extractCoordinationState', () => {
    const state = {
      schemaVersion: 'ecc.github.coordination.v1',
      kind: 'epic',
      status: 'claimed',
      owner: 'carol',
      branch: 'feat/my-feature',
      validation: 'pending',
      review: 'requested',
      project: { state: 'in-progress', fields: {} },
      dependencies: [5, 6],
      tasks: [{ title: 'Write tests', done: false }],
      labels: ['coordination:claimed'],
      lastAction: 'claim',
      lastActionAt: '2026-01-01T00:00:00.000Z',
      lastSyncAt: '2026-01-01T00:00:00.000Z',
      notes: null,
    };
    const rendered = renderCoordinationState(state);
    const extracted = extractCoordinationState(rendered);
    assert.ok(extracted !== null);
    assert.strictEqual(extracted.status, 'claimed');
    assert.strictEqual(extracted.owner, 'carol');
    assert.deepStrictEqual(extracted.dependencies, [5, 6]);
  })) passed += 1; else failed += 1;

  console.log(`\nResults: Passed: ${passed}, Failed: ${failed}`);
  process.exit(failed > 0 ? 1 : 0);
}

runTests();
