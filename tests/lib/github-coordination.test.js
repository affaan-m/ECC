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

async function runGroup(group, descriptors, counters) {
  for (const { name, fn } of descriptors.filter(d => d.group === group)) {
    if (await test(name, fn)) counters.passed += 1;
    else counters.failed += 1;
  }
}

const DESCRIPTORS = [
  // normalizeRepo
  {
    group: 'normalizeRepo',
    name: 'normalizeRepo returns { owner, name } for "owner/repo"',
    fn: () => {
      const result = normalizeRepo('acme/my-repo');
      assert.deepStrictEqual(result, { owner: 'acme', name: 'my-repo' });
    },
  },
  {
    group: 'normalizeRepo',
    name: 'normalizeRepo throws on "owner/repo/extra"',
    fn: () => {
      assert.throws(() => normalizeRepo('owner/repo/extra'), /Invalid repo format/);
    },
  },
  {
    group: 'normalizeRepo',
    name: 'normalizeRepo throws on bare string with no slash',
    fn: () => {
      assert.throws(() => normalizeRepo('justowner'), /Invalid repo format/);
    },
  },
  {
    group: 'normalizeRepo',
    name: 'normalizeRepo throws on empty string',
    fn: () => {
      assert.throws(() => normalizeRepo(''), /Invalid repo format/);
    },
  },
  {
    group: 'normalizeRepo',
    name: 'normalizeRepo throws on whitespace-only string',
    fn: () => {
      assert.throws(() => normalizeRepo('   '), /Invalid repo format/);
    },
  },

  // extractCoordinationState
  {
    group: 'extractCoordinationState',
    name: 'extractCoordinationState returns null for body with no coordination section',
    fn: () => {
      const result = extractCoordinationState('## Some issue\n\nJust text, no coordination block.');
      assert.strictEqual(result, null);
    },
  },
  {
    group: 'extractCoordinationState',
    name: 'extractCoordinationState returns parsed state from a proper coordination JSON block',
    fn: () => {
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
    },
  },
  {
    group: 'extractCoordinationState',
    name: 'extractCoordinationState throws SyntaxError when JSON block is malformed',
    fn: () => {
      const body = [
        '<!-- ecc-coordination:start -->',
        '```json',
        '{ not valid json }',
        '```',
        '<!-- ecc-coordination:end -->',
      ].join('\n');
      assert.throws(() => extractCoordinationState(body), SyntaxError);
    },
  },

  // buildIssueStateFromAction
  {
    group: 'buildIssueStateFromAction',
    name: 'buildIssueStateFromAction with "claim" action sets status, owner, branch, lastAction, lastActionAt',
    fn: () => {
      const issue = { number: 1, body: '', labels: [] };
      const currentState = {
        schemaVersion: DEFAULT_POLICY.schemaVersion,
        status: 'available', owner: null, branch: null,
        validation: 'pending', review: 'not-requested', dependencies: [], tasks: [],
      };
      const before = new Date();
      const result = buildIssueStateFromAction(issue, currentState, 'claim', {
        owner: 'alice', branch: 'feat/my-branch', status: 'claimed',
      });
      const after = new Date();

      assert.strictEqual(result.status, 'claimed');
      assert.strictEqual(result.owner, 'alice');
      assert.strictEqual(result.branch, 'feat/my-branch');
      assert.strictEqual(result.lastAction, 'claim');
      assert.ok(result.lastActionAt);
      const actionAt = new Date(result.lastActionAt);
      assert.ok(actionAt >= before && actionAt <= after);
    },
  },
  {
    group: 'buildIssueStateFromAction',
    name: 'buildIssueStateFromAction with "unblock" action preserves owner from existing state',
    fn: () => {
      const issue = { number: 2, body: '', labels: [] };
      const currentState = {
        schemaVersion: DEFAULT_POLICY.schemaVersion,
        status: 'blocked', owner: 'bob', branch: 'feat/blocked-branch',
        validation: 'pending', review: 'not-requested', dependencies: [], tasks: [],
      };
      const result = buildIssueStateFromAction(issue, currentState, 'unblock', { status: 'ready' });

      assert.strictEqual(result.status, 'ready');
      assert.strictEqual(result.owner, 'bob');
      assert.strictEqual(result.branch, 'feat/blocked-branch');
      assert.strictEqual(result.lastAction, 'unblock');
    },
  },
  {
    group: 'buildIssueStateFromAction',
    name: 'buildIssueStateFromAction with "validate" action sets status "validated" and validation "passed"',
    fn: () => {
      const issue = { number: 3, body: '', labels: [] };
      const currentState = {
        schemaVersion: DEFAULT_POLICY.schemaVersion,
        status: 'claimed', owner: 'carol', branch: 'feat/new',
        validation: 'pending', review: 'not-requested', dependencies: [], tasks: [],
      };
      const result = buildIssueStateFromAction(issue, currentState, 'validate', {
        status: 'validated', validation: 'passed',
      });

      assert.strictEqual(result.status, 'validated');
      assert.strictEqual(result.validation, 'passed');
      assert.strictEqual(result.lastAction, 'validate');
      assert.strictEqual(result.owner, 'carol');
    },
  },

  // desiredLabelsForState
  {
    group: 'desiredLabelsForState',
    name: 'desiredLabelsForState for status "available" includes "coordination:available"',
    fn: () => {
      const labels = desiredLabelsForState({ status: 'available' });
      assert.ok(Array.isArray(labels));
      assert.ok(labels.includes('coordination:available'), `Expected coordination:available in [${labels.join(', ')}]`);
    },
  },
  {
    group: 'desiredLabelsForState',
    name: 'desiredLabelsForState for status "claimed" includes "coordination:claimed" but not "coordination:available"',
    fn: () => {
      const labels = desiredLabelsForState({ status: 'claimed' });
      assert.ok(labels.includes('coordination:claimed'), `Expected coordination:claimed in [${labels.join(', ')}]`);
      assert.ok(!labels.includes('coordination:available'), `Did not expect coordination:available in [${labels.join(', ')}]`);
    },
  },
  {
    group: 'desiredLabelsForState',
    name: 'desiredLabelsForState for status "blocked" includes "coordination:blocked"',
    fn: () => {
      const labels = desiredLabelsForState({ status: 'blocked' });
      assert.ok(labels.includes('coordination:blocked'), `Expected coordination:blocked in [${labels.join(', ')}]`);
      assert.ok(!labels.includes('coordination:available'), `Did not expect coordination:available in [${labels.join(', ')}]`);
    },
  },
  {
    group: 'desiredLabelsForState',
    name: 'desiredLabelsForState for status "ready" includes "coordination:ready"',
    fn: () => {
      const labels = desiredLabelsForState({ status: 'ready' });
      assert.ok(labels.includes('coordination:ready'), `Expected coordination:ready in [${labels.join(', ')}]`);
    },
  },

  // extractTasks
  {
    group: 'extractTasks',
    name: 'extractTasks returns empty array when body has no Tasks section',
    fn: () => {
      const tasks = extractTasks('Some issue without any task list.');
      assert.deepStrictEqual(tasks, []);
    },
  },
  {
    group: 'extractTasks',
    name: 'extractTasks parses completed and open checkboxes under ## Tasks heading',
    fn: () => {
      const body = ['## Tasks', '- [x] Done task', '- [ ] Open task', '- [x] Another done task'].join('\n');
      const tasks = extractTasks(body);
      const completed = tasks.filter(t => t.done);
      const open = tasks.filter(t => !t.done);
      assert.strictEqual(tasks.length, 3);
      assert.strictEqual(completed.length, 2);
      assert.strictEqual(open.length, 1);
      assert.strictEqual(open[0].title, 'Open task');
    },
  },
  {
    group: 'extractTasks',
    name: 'extractTasks stops parsing at next heading after task section',
    fn: () => {
      const body = ['## Tasks', '- [x] First task', '## Notes', '- [ ] This is not a task'].join('\n');
      const tasks = extractTasks(body);
      assert.strictEqual(tasks.length, 1);
      assert.strictEqual(tasks[0].title, 'First task');
    },
  },

  // renderCoordinationState
  {
    group: 'renderCoordinationState',
    name: 'renderCoordinationState returns a string containing the section marker',
    fn: () => {
      const state = {
        schemaVersion: 'ecc.github.coordination.v1', kind: 'epic', status: 'available',
        owner: null, branch: null, validation: 'pending', review: 'not-requested',
        project: { state: 'backlog', fields: {} }, dependencies: [], tasks: [], labels: [],
        lastAction: 'sync', lastActionAt: '2026-01-01T00:00:00.000Z',
        lastSyncAt: '2026-01-01T00:00:00.000Z', notes: null,
      };
      const rendered = renderCoordinationState(state);
      assert.ok(typeof rendered === 'string');
      assert.ok(rendered.includes('<!-- ecc-coordination:start -->'), 'Missing start marker');
      assert.ok(rendered.includes('<!-- ecc-coordination:end -->'), 'Missing end marker');
      assert.ok(rendered.includes('```json'), 'Missing json code fence');
    },
  },
  {
    group: 'renderCoordinationState',
    name: 'renderCoordinationState output round-trips through extractCoordinationState',
    fn: () => {
      const state = {
        schemaVersion: 'ecc.github.coordination.v1', kind: 'epic', status: 'claimed',
        owner: 'carol', branch: 'feat/my-feature', validation: 'pending', review: 'requested',
        project: { state: 'in-progress', fields: {} }, dependencies: [5, 6],
        tasks: [{ title: 'Write tests', done: false }], labels: ['coordination:claimed'],
        lastAction: 'claim', lastActionAt: '2026-01-01T00:00:00.000Z',
        lastSyncAt: '2026-01-01T00:00:00.000Z', notes: null,
      };
      const rendered = renderCoordinationState(state);
      const extracted = extractCoordinationState(rendered);
      assert.ok(extracted !== null);
      assert.strictEqual(extracted.status, 'claimed');
      assert.strictEqual(extracted.owner, 'carol');
      assert.deepStrictEqual(extracted.dependencies, [5, 6]);
    },
  },
];

async function runTests() {
  console.log('\n=== Testing github-coordination ===\n');

  const counters = { passed: 0, failed: 0 };
  const groups = [...new Set(DESCRIPTORS.map(d => d.group))];

  for (const group of groups) {
    await runGroup(group, DESCRIPTORS, counters);
  }

  console.log(`\nResults: Passed: ${counters.passed}, Failed: ${counters.failed}`);
  process.exit(counters.failed > 0 ? 1 : 0);
}

runTests();
