/**
 * Tests for scripts/lib/github-coordination/store.js — branch coverage
 *
 * Run with: node tests/lib/github-coordination-store.test.js
 */

'use strict';

const assert = require('assert');

const {
  epicWorkItemId,
  upsertCoordinationWorkItem,
  openStore,
} = require('../../scripts/lib/github-coordination/store');

const { DEFAULT_SCHEMA_VERSION, DEFAULT_POLICY } = require('../../scripts/lib/github-coordination/policy');

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

function makeStore() {
  const calls = [];
  return {
    calls,
    upsertWorkItem(item) {
      calls.push(item);
      return item;
    },
  };
}

let passed = 0;
let failed = 0;

console.log('\n=== Testing github-coordination/store.js ===\n');

console.log('epicWorkItemId:');

if (test('produces a stable ID from repo and issue number', () => {
  assert.strictEqual(epicWorkItemId('acme/my-repo', 42), 'github-acme-my-repo-epic-42');
})) passed++; else failed++;

console.log('\nupsertCoordinationWorkItem — null store:');

if (test('returns null when store is null', () => {
  const result = upsertCoordinationWorkItem(null, 'r/r', { number: 1 }, {}, 'sync');
  assert.strictEqual(result, null);
})) passed++; else failed++;

if (test('returns null when store is undefined', () => {
  const result = upsertCoordinationWorkItem(undefined, 'r/r', { number: 1 }, {}, 'sync');
  assert.strictEqual(result, null);
})) passed++; else failed++;

console.log('\nupsertCoordinationWorkItem — with store:');

if (test('passes schemaVersion from state when present', () => {
  const store = makeStore();
  upsertCoordinationWorkItem(store, 'a/b', { number: 1, labels: [] }, { schemaVersion: 'v99', status: 'available' }, 'sync');
  assert.strictEqual(store.calls[0].metadata.schemaVersion, 'v99');
})) passed++; else failed++;

if (test('uses DEFAULT_SCHEMA_VERSION when state.schemaVersion is absent', () => {
  const store = makeStore();
  upsertCoordinationWorkItem(store, 'a/b', { number: 1, labels: [] }, { status: 'available' }, 'sync');
  assert.strictEqual(store.calls[0].metadata.schemaVersion, DEFAULT_SCHEMA_VERSION);
})) passed++; else failed++;

if (test('sets issueUrl from issue.url when present', () => {
  const store = makeStore();
  upsertCoordinationWorkItem(store, 'a/b', { number: 1, url: 'https://example.com/1', labels: [] }, { status: 'available' }, 'sync');
  assert.strictEqual(store.calls[0].metadata.issueUrl, 'https://example.com/1');
})) passed++; else failed++;

if (test('sets issueUrl to null when issue.url is absent', () => {
  const store = makeStore();
  upsertCoordinationWorkItem(store, 'a/b', { number: 1, labels: [] }, { status: 'available' }, 'sync');
  assert.strictEqual(store.calls[0].metadata.issueUrl, null);
})) passed++; else failed++;

if (test('sets issueTitle from issue.title when present', () => {
  const store = makeStore();
  upsertCoordinationWorkItem(store, 'a/b', { number: 1, title: 'My Epic', labels: [] }, { status: 'available' }, 'sync');
  assert.strictEqual(store.calls[0].metadata.issueTitle, 'My Epic');
})) passed++; else failed++;

if (test('sets issueTitle to null when issue.title is absent', () => {
  const store = makeStore();
  upsertCoordinationWorkItem(store, 'a/b', { number: 1, labels: [] }, { status: 'available' }, 'sync');
  assert.strictEqual(store.calls[0].metadata.issueTitle, null);
})) passed++; else failed++;

if (test('uses custom policy from options.policy', () => {
  const store = makeStore();
  const customPolicy = { schemaVersion: 'custom', labels: {}, review: {}, validation: {}, branchModel: {}, project: { enabled: true, fieldNames: {} } };
  upsertCoordinationWorkItem(store, 'a/b', { number: 1, labels: [] }, { status: 'available' }, 'sync', { policy: customPolicy });
  assert.strictEqual(store.calls[0].metadata.projectProjection.enabled, true);
})) passed++; else failed++;

if (test('falls back to DEFAULT_POLICY when options.policy is absent', () => {
  const store = makeStore();
  upsertCoordinationWorkItem(store, 'a/b', { number: 1, labels: [] }, { status: 'available' }, 'sync', {});
  assert.strictEqual(store.calls[0].metadata.projectProjection.enabled, DEFAULT_POLICY.project.enabled);
})) passed++; else failed++;

if (test('sets priority high when state.status is blocked', () => {
  const store = makeStore();
  upsertCoordinationWorkItem(store, 'a/b', { number: 1, labels: [] }, { status: 'blocked' }, 'sync');
  assert.strictEqual(store.calls[0].priority, 'high');
})) passed++; else failed++;

if (test('sets priority normal when state.status is not blocked', () => {
  const store = makeStore();
  upsertCoordinationWorkItem(store, 'a/b', { number: 1, labels: [] }, { status: 'available' }, 'sync');
  assert.strictEqual(store.calls[0].priority, 'normal');
})) passed++; else failed++;

if (test('sets url from issue.url in upsertWorkItem call', () => {
  const store = makeStore();
  upsertCoordinationWorkItem(store, 'a/b', { number: 1, url: 'https://gh/1', labels: [] }, { status: 'available' }, 'sync');
  assert.strictEqual(store.calls[0].url, 'https://gh/1');
})) passed++; else failed++;

if (test('sets url to null when issue.url absent in upsertWorkItem call', () => {
  const store = makeStore();
  upsertCoordinationWorkItem(store, 'a/b', { number: 1, labels: [] }, { status: 'available' }, 'sync');
  assert.strictEqual(store.calls[0].url, null);
})) passed++; else failed++;

if (test('uses state.owner when present', () => {
  const store = makeStore();
  upsertCoordinationWorkItem(store, 'a/b', { number: 1, labels: [] }, { status: 'available', owner: 'alice' }, 'sync');
  assert.strictEqual(store.calls[0].owner, 'alice');
})) passed++; else failed++;

if (test('falls back to issue.author.login when state.owner absent', () => {
  const store = makeStore();
  upsertCoordinationWorkItem(store, 'a/b', { number: 1, labels: [], author: { login: 'bob' } }, { status: 'available' }, 'sync');
  assert.strictEqual(store.calls[0].owner, 'bob');
})) passed++; else failed++;

if (test('sets owner to null when neither state.owner nor author.login present', () => {
  const store = makeStore();
  upsertCoordinationWorkItem(store, 'a/b', { number: 1, labels: [] }, { status: 'available' }, 'sync');
  assert.strictEqual(store.calls[0].owner, null);
})) passed++; else failed++;

if (test('uses options.repoRoot when present', () => {
  const store = makeStore();
  upsertCoordinationWorkItem(store, 'a/b', { number: 1, labels: [] }, { status: 'available' }, 'sync', { repoRoot: '/my/repo' });
  assert.strictEqual(store.calls[0].repoRoot, '/my/repo');
})) passed++; else failed++;

if (test('falls back to process.cwd() when options.repoRoot absent', () => {
  const store = makeStore();
  upsertCoordinationWorkItem(store, 'a/b', { number: 1, labels: [] }, { status: 'available' }, 'sync');
  assert.strictEqual(store.calls[0].repoRoot, process.cwd());
})) passed++; else failed++;

if (test('uses options.sessionId when present', () => {
  const store = makeStore();
  upsertCoordinationWorkItem(store, 'a/b', { number: 1, labels: [] }, { status: 'available' }, 'sync', { sessionId: 'sess-1' });
  assert.strictEqual(store.calls[0].sessionId, 'sess-1');
})) passed++; else failed++;

if (test('sets sessionId to null when options.sessionId absent', () => {
  const store = makeStore();
  upsertCoordinationWorkItem(store, 'a/b', { number: 1, labels: [] }, { status: 'available' }, 'sync');
  assert.strictEqual(store.calls[0].sessionId, null);
})) passed++; else failed++;

console.log('\nopenStore — dbPath: false:');

async function runAsyncTests() {
  let asyncPassed = 0;
  let asyncFailed = 0;

  try {
    const result = await openStore({ dbPath: false });
    assert.strictEqual(result, null);
    console.log('  ✓ returns null when dbPath is false');
    asyncPassed++;
  } catch (err) {
    console.log('  ✗ returns null when dbPath is false');
    console.log(`    Error: ${err.message}`);
    asyncFailed++;
  }

  const totalPassed = passed + asyncPassed;
  const totalFailed = failed + asyncFailed;
  console.log(`\n  Results: ${totalPassed} passed, ${totalFailed} failed`);
  if (totalFailed > 0) process.exit(1);
}

runAsyncTests().catch(err => {
  console.error(`Unexpected async test failure: ${err.message}`);
  process.exit(1);
});
