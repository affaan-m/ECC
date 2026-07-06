/**
 * Targeted branch coverage tests for uncovered paths in:
 *   scripts/lib/github-coordination/parsing.js
 *   scripts/lib/github-coordination/state.js
 *
 * Run with: node tests/lib/github-coordination-branches.test.js
 */

'use strict';

const assert = require('assert');

const {
  normalizeBodyForComparison,
  parseStringList,
  mergeIssueBody,
} = require('../../scripts/lib/github-coordination/parsing');

const {
  assertIssueClaimable,
  buildIssueStateFromAction,
  defaultCoordinationState,
  desiredLabelsForState,
  mapStateToWorkItemStatus,
  verifyDependenciesClosed,
} = require('../../scripts/lib/github-coordination/state');

function test(name, fn) {
  try {
    fn();
    console.log(`  ✓ ${name}`);
    return true;
  } catch (err) {
    console.log(`  ✗ ${name}`);
    console.log(`    Error: ${err.message}`);
    return false;
  }
}

let passed = 0;
let failed = 0;

console.log('\n=== parsing.js — uncovered branches ===\n');

console.log('normalizeBodyForComparison:');

if (test('handles null body (uses empty string fallback)', () => {
  const result = normalizeBodyForComparison(null);
  assert.strictEqual(result, '');
})) passed++; else failed++;

if (test('handles undefined body', () => {
  const result = normalizeBodyForComparison(undefined);
  assert.strictEqual(result, '');
})) passed++; else failed++;

if (test('normalizes lastSyncAt timestamps in body text', () => {
  const body = 'before "lastSyncAt": "2024-01-01T00:00:00.000Z", after';
  const result = normalizeBodyForComparison(body);
  assert.ok(result.includes('"lastSyncAt": NORMALIZED'));
  assert.ok(!result.includes('2024-01-01'));
})) passed++; else failed++;

console.log('\nparseStringList:');

if (test('returns empty array for null', () => {
  assert.deepStrictEqual(parseStringList(null), []);
})) passed++; else failed++;

if (test('returns empty array for undefined', () => {
  assert.deepStrictEqual(parseStringList(undefined), []);
})) passed++; else failed++;

if (test('returns empty array for empty string', () => {
  assert.deepStrictEqual(parseStringList(''), []);
})) passed++; else failed++;

if (test('splits a comma-separated string into trimmed parts', () => {
  assert.deepStrictEqual(parseStringList('a, b , c'), ['a', 'b', 'c']);
})) passed++; else failed++;

if (test('filters out empty parts from double-commas', () => {
  assert.deepStrictEqual(parseStringList('a,,b'), ['a', 'b']);
})) passed++; else failed++;

console.log('\nmergeIssueBody — empty body branch:');

if (test('returns rendered state when issue body is empty string', () => {
  const state = { status: 'available', schemaVersion: 'v1', kind: 'epic', owner: null, branch: null, validation: 'pending', review: 'not-requested', project: { state: 'backlog', fields: {} }, dependencies: [], tasks: [], labels: [], lastAction: 'sync' };
  const result = mergeIssueBody({ body: '' }, state);
  assert.ok(result.includes('ecc-coordination:start'));
})) passed++; else failed++;

if (test('returns rendered state when issue body is null', () => {
  const state = { status: 'available', schemaVersion: 'v1', kind: 'epic', owner: null, branch: null, validation: 'pending', review: 'not-requested', project: { state: 'backlog', fields: {} }, dependencies: [], tasks: [], labels: [], lastAction: 'sync' };
  const result = mergeIssueBody({ body: null }, state);
  assert.ok(result.includes('ecc-coordination:start'));
})) passed++; else failed++;

console.log('\n=== state.js — uncovered branches ===\n');

console.log('buildIssueStateFromAction — options absent (false branches):');

const baseIssue = { number: 1, labels: [], body: '' };
const baseState = {
  schemaVersion: 'v1', kind: 'epic', status: 'available', owner: null,
  branch: null, validation: 'pending', review: 'not-requested',
  project: { state: 'backlog', fields: {} }, dependencies: [], tasks: [],
  labels: [], lastAction: 'sync', lastActionAt: null, lastSyncAt: null, notes: null
};

if (test('buildIssueStateFromAction with no options — does not set owner/branch/etc', () => {
  const result = buildIssueStateFromAction(baseIssue, baseState, 'sync');
  assert.strictEqual(result.lastAction, 'sync');
  assert.strictEqual(result.owner, null);
  assert.strictEqual(result.branch, null);
})) passed++; else failed++;

if (test('buildIssueStateFromAction with empty options — all conditional branches skip', () => {
  const result = buildIssueStateFromAction(baseIssue, { ...baseState }, 'sync', {});
  assert.ok(typeof result.lastAction === 'string');
})) passed++; else failed++;

if (test('buildIssueStateFromAction — currentState.dependencies not array → re-extracted', () => {
  const issue = { number: 1, labels: [], body: 'Depends on #5 and #6' };
  const result = buildIssueStateFromAction(issue, { ...baseState, dependencies: 'not-array' }, 'sync');
  assert.ok(Array.isArray(result.dependencies));
})) passed++; else failed++;

if (test('buildIssueStateFromAction — currentState.tasks not array → re-extracted', () => {
  const issue = { number: 1, labels: [], body: '## Tasks\n- [ ] Step 1\n- [x] Step 2' };
  const result = buildIssueStateFromAction(issue, { ...baseState, tasks: 'not-array' }, 'sync');
  assert.ok(Array.isArray(result.tasks));
})) passed++; else failed++;

console.log('\ndesiredLabelsForState — uncovered status/review/validation branches:');

if (test('includes published label for status "published"', () => {
  const labels = desiredLabelsForState({ status: 'published' });
  assert.ok(labels.includes('coordination:published'));
})) passed++; else failed++;

if (test('includes validated label for validation "passed"', () => {
  const labels = desiredLabelsForState({ status: 'available', validation: 'passed' });
  assert.ok(labels.includes('coordination:validated'));
})) passed++; else failed++;

if (test('includes review-requested label for review "requested"', () => {
  const labels = desiredLabelsForState({ status: 'available', review: 'requested' });
  assert.ok(labels.includes('coordination:review-requested'));
})) passed++; else failed++;

if (test('includes review-approved label for review "approved"', () => {
  const labels = desiredLabelsForState({ status: 'available', review: 'approved' });
  assert.ok(labels.includes('coordination:review-approved'));
})) passed++; else failed++;

if (test('includes review-changes-requested label for review "changes-requested"', () => {
  const labels = desiredLabelsForState({ status: 'available', review: 'changes-requested' });
  assert.ok(labels.includes('coordination:review-changes-requested'));
})) passed++; else failed++;

console.log('\nmapStateToWorkItemStatus — uncovered switch cases:');

if (test('"validated" → "in-progress"', () => {
  assert.strictEqual(mapStateToWorkItemStatus('validated'), 'in-progress');
})) passed++; else failed++;

if (test('"reviewing" → "in-progress"', () => {
  assert.strictEqual(mapStateToWorkItemStatus('reviewing'), 'in-progress');
})) passed++; else failed++;

if (test('"changes-requested" → "needs-review"', () => {
  assert.strictEqual(mapStateToWorkItemStatus('changes-requested'), 'needs-review');
})) passed++; else failed++;

if (test('"published" → "done"', () => {
  assert.strictEqual(mapStateToWorkItemStatus('published'), 'done');
})) passed++; else failed++;

if (test('"unknown-state" → "open" (default)', () => {
  assert.strictEqual(mapStateToWorkItemStatus('unknown-state'), 'open');
})) passed++; else failed++;

console.log('\nassertIssueClaimable:');

if (test('throws when issue is not open', () => {
  assert.throws(
    () => assertIssueClaimable({ number: 1, state: 'closed' }, { status: 'available' }),
    /is not open/
  );
})) passed++; else failed++;

if (test('throws when issue is already claimed', () => {
  assert.throws(
    () => assertIssueClaimable({ number: 1, state: 'open' }, { status: 'claimed', owner: 'alice' }),
    /already claimed/
  );
})) passed++; else failed++;

if (test('does not throw for open, unclaimed issue', () => {
  assert.doesNotThrow(() => {
    assertIssueClaimable({ number: 1, state: 'open' }, { status: 'available' });
  });
})) passed++; else failed++;

console.log('\nverifyDependenciesClosed:');

if (test('returns empty array when dependencyNumbers is not an array', () => {
  const result = verifyDependenciesClosed('r/r', null, {}, []);
  assert.deepStrictEqual(result, []);
})) passed++; else failed++;

if (test('returns empty array when dependencyNumbers is empty', () => {
  const result = verifyDependenciesClosed('r/r', [], {}, []);
  assert.deepStrictEqual(result, []);
})) passed++; else failed++;

if (test('returns closed issues when dependency is in closed state', () => {
  const issues = [{ number: 5, state: 'closed' }, { number: 6, state: 'open' }];
  const result = verifyDependenciesClosed('r/r', [5, 6], {}, issues);
  assert.deepStrictEqual(result, [5]);
})) passed++; else failed++;

if (test('skips (stderr warning) when dependency issue is not in allIssues list', () => {
  const issues = [{ number: 99, state: 'closed' }];
  const result = verifyDependenciesClosed('r/r', [5], {}, issues);
  assert.deepStrictEqual(result, []);
})) passed++; else failed++;

console.log('\ndefaultCoordinationState — edge branches:');

if (test('owner is null when issue has no author', () => {
  const result = defaultCoordinationState({ number: 1, labels: [] });
  assert.strictEqual(result.owner, null);
})) passed++; else failed++;

if (test('owner is null when issue.author has no login', () => {
  const result = defaultCoordinationState({ number: 1, labels: [], author: {} });
  assert.strictEqual(result.owner, null);
})) passed++; else failed++;

if (test('owner is set from issue.author.login', () => {
  const result = defaultCoordinationState({ number: 1, labels: [], author: { login: 'alice' } });
  assert.strictEqual(result.owner, 'alice');
})) passed++; else failed++;

if (test('handles null issue', () => {
  const result = defaultCoordinationState(null);
  assert.strictEqual(result.owner, null);
  assert.deepStrictEqual(result.dependencies, []);
  assert.deepStrictEqual(result.tasks, []);
})) passed++; else failed++;

console.log(`\n  Results: ${passed} passed, ${failed} failed`);
if (failed > 0) process.exit(1);
