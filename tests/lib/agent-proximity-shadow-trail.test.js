'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const {
  createShadowTrail, appendAcknowledgement, appendScopeRevision,
  appendReobservation, verifyShadowTrail, summarizeShadowTrail
} = require('../../scripts/lib/agent-proximity/shadow-trail');

const at = '2026-09-15T12:00:00.000Z';
const later = '2026-09-15T12:01:00.000Z';
const latest = '2026-09-15T12:02:00.000Z';
const baseRevision = 'a'.repeat(40);

function observation(agentId, overrides = {}) {
  return {
    agentId, taskId: `task-${agentId}`, repoId: 'ecc', baseRevision,
    scopeRevision: 1, footprint: 'complete', readPaths: [],
    writePaths: ['src/shared.js'], observedAt: '2026-09-15T11:59:00.000Z',
    expiresAt: '2026-09-15T12:05:00.000Z', ...overrides
  };
}
function start(a = observation('a'), b = observation('b'), options = {}) {
  return createShadowTrail({ trailId: 'shadow-1', observations: [a, b], at, ...options });
}
function bothAcknowledge(trail) {
  const first = appendAcknowledgement(trail, { id: 'ack-a', agentId: 'a', scopeRevision: 1, at: later });
  return appendAcknowledgement(first, { id: 'ack-b', agentId: 'b', scopeRevision: 1, at: later });
}

test('records a copy-on-append passive observation → advisory → ACK → scope revision → re-observation chain', () => {
  const initial = start();
  assert.equal(summarizeShadowTrail(initial).latestAdvisory.state, 'advisory');
  assert.equal(summarizeShadowTrail(initial).latestAdvisory.hazard, 'write-write');
  const acknowledged = bothAcknowledge(initial);
  assert.deepEqual(summarizeShadowTrail(acknowledged).latestAdvisoryAcknowledgedBy, ['a', 'b']);
  const revised = appendScopeRevision(acknowledged, {
    id: 'scope-b2', agentId: 'b', previousScopeRevision: 1,
    newScopeRevision: 2, newReadPaths: [], newWritePaths: ['docs/guide.md'],
    authorizationRef: 'declared-contract-42', at: later
  });
  const complete = appendReobservation(revised, {
    id: 'reobserve-1', at: latest,
    observations: [observation('a', { writePaths: ['src/shared.js'], observedAt: later }),
      observation('b', { scopeRevision: 2, writePaths: ['docs/guide.md'], observedAt: later })]
  });
  const summary = summarizeShadowTrail(complete);
  assert.equal(summary.mode, 'shadow-read-only');
  assert.equal(summary.latestAdvisory.state, 'no-advisory-in-scope');
  assert.equal(summary.outcome, 'unadjudicated');
  assert.equal(summary.scopeChange.authority, 'declared-only');
  assert.deepEqual(summary.historicalAcknowledgedBy, ['a', 'b']);
  assert.deepEqual(summary.latestAdvisoryAcknowledgedBy, []);
  assert.equal(verifyShadowTrail(JSON.parse(JSON.stringify(complete))), true);
  assert.equal(initial.receipts.length, 2);
  assert.equal(acknowledged.receipts.length, 4);
  assert.equal(complete.receipts.length, 7);
  for (let i = 1; i < complete.receipts.length; i += 1) {
    assert.equal(complete.receipts[i].previousHash, complete.receipts[i - 1].hash);
  }
  assert.ok(!JSON.stringify(complete).includes('CANARY_SECRET'));
});

test('read/read is quiet, write/read is a direct hazard, and dependency proximity reuses shipped scorer', () => {
  const quiet = start(observation('a', { readPaths: ['src/shared.js'], writePaths: [] }),
    observation('b', { readPaths: ['src/shared.js'], writePaths: [] }));
  assert.equal(summarizeShadowTrail(quiet).latestAdvisory.state, 'no-advisory-in-scope');
  const hazard = start(observation('a', { readPaths: ['src/shared.js'], writePaths: [] }),
    observation('b', { readPaths: [], writePaths: ['src/shared.js'] }));
  assert.equal(summarizeShadowTrail(hazard).latestAdvisory.hazard, 'write-read');
  const graph = { adjacency: { 'apps/web/page.js': ['packages/core/util.js'], 'packages/core/util.js': [] } };
  const coupled = start(observation('a', { writePaths: ['apps/web/page.js'] }),
    observation('b', { writePaths: ['packages/core/util.js'] }), { graph });
  assert.equal(summarizeShadowTrail(coupled).latestAdvisory.state, 'advisory');
  assert.equal(summarizeShadowTrail(coupled).latestAdvisory.hazard, null);
});

test('known overlap cannot be clear, while incomplete, stale and incomparable critical data remain unknown', () => {
  const partialHazard = start(observation('a', { footprint: 'incomplete' }), observation('b'));
  assert.equal(summarizeShadowTrail(partialHazard).latestAdvisory.state, 'unknown');
  assert.equal(summarizeShadowTrail(partialHazard).latestAdvisory.hazard, 'write-write');
  const partialQuiet = start(observation('a', { footprint: 'incomplete', writePaths: [] }),
    observation('b', { writePaths: ['docs/guide.md'] }));
  assert.equal(summarizeShadowTrail(partialQuiet).latestAdvisory.state, 'unknown');
  const stale = start(observation('a', { expiresAt: '2026-09-15T11:59:30.000Z' }), observation('b'));
  assert.equal(summarizeShadowTrail(stale).latestAdvisory.state, 'unknown');
  const foreignBase = start(observation('a'), observation('b', { baseRevision: 'b'.repeat(40) }));
  assert.equal(summarizeShadowTrail(foreignBase).latestAdvisory.state, 'unknown');
});

test('stale or crossed ACK, unacknowledged scope change and mismatched re-observation fail closed', () => {
  const initial = start();
  assert.throws(() => appendAcknowledgement(initial, { id: 'bad-ack', agentId: 'a', scopeRevision: 2, at: later }), /Invalid shadow/);
  assert.throws(() => appendAcknowledgement(initial, { id: 'bad-ack', agentId: 'c', scopeRevision: 1, at: later }), /Invalid shadow/);
  assert.throws(() => appendScopeRevision(initial, { id: 'premature', agentId: 'b', previousScopeRevision: 1,
    newScopeRevision: 2, newReadPaths: [], newWritePaths: ['docs/guide.md'],
    authorizationRef: 'evidence-1', at: later }), /Invalid shadow/);
  const ack = bothAcknowledge(initial);
  assert.throws(() => appendAcknowledgement(ack, { id: 'third-ack', agentId: 'a', scopeRevision: 1, at: later }), /Invalid shadow/);
  const revised = appendScopeRevision(ack, { id: 'scope-b2', agentId: 'b', previousScopeRevision: 1,
    newScopeRevision: 2, newReadPaths: [], newWritePaths: ['docs/guide.md'],
    authorizationRef: 'evidence-1', at: later });
  assert.throws(() => appendReobservation(revised, { id: 'wrong-scope', at: latest,
    observations: [observation('a'), observation('b')] }), /Invalid shadow/);
  assert.throws(() => appendReobservation(revised, { id: 'foreign-task', at: latest,
    observations: [observation('a'), observation('b', { scopeRevision: 2, taskId: 'other-task' })] }), /Invalid shadow/);
  assert.throws(() => appendReobservation(revised, { id: 'different-declaration', at: latest,
    observations: [observation('a'), observation('b', { scopeRevision: 2,
      writePaths: ['src/not-declared.js'], observedAt: later })] }), /Invalid shadow/);
  assert.throws(() => appendReobservation(revised, { id: 'changed-other-agent', at: latest,
    observations: [observation('a', { writePaths: ['src/changed-without-revision.js'], observedAt: later }),
      observation('b', { scopeRevision: 2, writePaths: ['docs/guide.md'], observedAt: later })] }), /Invalid shadow/);
});

test('unknown critical footprints cannot be used as an acknowledged clear-scoped resolution', () => {
  const unknown = start(observation('a', { footprint: 'incomplete', writePaths: [] }), observation('b'));
  assert.throws(() => appendAcknowledgement(unknown, { id: 'ack-unknown', agentId: 'a',
    scopeRevision: 1, at: later }), /Invalid shadow/);
});

test('receipt hashes bind the trail identity and reject cross-trail relabeling', () => {
  const relabeled = JSON.parse(JSON.stringify(start()));
  relabeled.trailId = 'different-shadow-trail';
  assert.throws(() => verifyShadowTrail(relabeled), /Invalid shadow/);
});

test('a persisted receipt with reordered path bytes is noncanonical and rejected', () => {
  const trail = start(observation('a', { writePaths: ['src/a.js', 'src/b.js'] }),
    observation('b', { writePaths: ['src/b.js'] }));
  const reordered = JSON.parse(JSON.stringify(trail));
  reordered.receipts[0].payload.observations[0].writePaths.reverse();
  assert.throws(() => verifyShadowTrail(reordered), /Invalid shadow/);
});

test('dependency graph insertion order canonicalizes to the same receipt content', () => {
  const a = start(observation('a'), observation('b'), { graph: { adjacency: {
    'src/z.js': ['src/a.js'], 'src/a.js': []
  } } });
  const b = start(observation('a'), observation('b'), { graph: { adjacency: {
    'src/a.js': [], 'src/z.js': ['src/a.js']
  } } });
  assert.equal(a.receipts[0].hash, b.receipts[0].hash);
});

test('append results keep independent copies of earlier receipt payloads', () => {
  const initial = start();
  const appended = appendAcknowledgement(initial, {
    id: 'copy-ack', agentId: 'a', scopeRevision: 1, at: later
  });
  initial.receipts[0].payload.observations[0].writePaths[0] = 'src/changed.js';
  assert.throws(() => verifyShadowTrail(initial), /Invalid shadow/);
  assert.equal(verifyShadowTrail(appended), true);
});

test('verification rejects nested serialization hooks, sparse and accessor arrays before execution', () => {
  const original = start();
  let callbackRuns = 0;
  const hooked = JSON.parse(JSON.stringify(original));
  hooked.receipts[0].payload.observations[0].writePaths.toJSON = () => {
    callbackRuns += 1;
    return ['src/shared.js'];
  };
  assert.throws(() => verifyShadowTrail(hooked), /Invalid shadow/);
  assert.equal(callbackRuns, 0);

  const accessor = JSON.parse(JSON.stringify(original));
  Object.defineProperty(accessor.receipts[0].payload.observations, '0', {
    enumerable: true, get() { callbackRuns += 1; return observation('a'); }
  });
  assert.throws(() => verifyShadowTrail(accessor), /Invalid shadow/);
  assert.equal(callbackRuns, 0);

  const sparse = JSON.parse(JSON.stringify(original));
  delete sparse.receipts[0].payload.observations[0].writePaths[0];
  assert.throws(() => verifyShadowTrail(sparse), /Invalid shadow/);
});

test('hash fields reject coercible objects without invoking their conversion hooks', () => {
  const trail = JSON.parse(JSON.stringify(start()));
  let callbackRuns = 0;
  trail.receipts[0].hash = { toString() { callbackRuns += 1; return '0'.repeat(64); } };
  assert.throws(() => verifyShadowTrail(trail), /Invalid shadow/);
  assert.equal(callbackRuns, 0);
});

test('receipt verification never invokes inherited JSON serialization hooks', () => {
  const persisted = JSON.parse(JSON.stringify(start()));
  let callbackRuns = 0;
  Object.defineProperty(Array.prototype, 'toJSON', { configurable: true,
    value() { callbackRuns += 1; return []; } });
  try {
    assert.equal(verifyShadowTrail(persisted), true);
    assert.equal(callbackRuns, 0);
  } finally {
    delete Array.prototype.toJSON;
  }
});

test('exotic verification failures are generic and do not echo private text', () => {
  const trail = start();
  const receipts = new Proxy(trail.receipts, {
    getPrototypeOf() { throw new Error('CANARY_SECRET'); }
  });
  assert.throws(() => verifyShadowTrail({ ...trail, receipts }), error =>
    /Invalid shadow/.test(error.message) && !error.message.includes('CANARY_SECRET'));
});

test('scope revision requires both acknowledged observations to remain current', () => {
  const initial = start(observation('a'), observation('b', {
    expiresAt: '2026-09-15T12:01:30.000Z'
  }));
  const acknowledged = bothAcknowledge(initial);
  assert.throws(() => appendScopeRevision(acknowledged, {
    id: 'scope-after-peer-expiry', agentId: 'a', previousScopeRevision: 1,
    newScopeRevision: 2, newReadPaths: [], newWritePaths: ['docs/guide.md'],
    authorizationRef: 'declared-contract-42', at: latest
  }), /Invalid shadow/);
});

test('tampering, duplicate IDs, unknown fields and unbounded input cannot be accepted or echoed', () => {
  const initial = start();
  const tampered = JSON.parse(JSON.stringify(initial));
  tampered.receipts[0].payload.observations[0].writePaths = ['CANARY_SECRET'];
  assert.throws(() => verifyShadowTrail(tampered), /Invalid shadow/);
  const poisoned = observation('a', { summary: 'CANARY_SECRET' });
  assert.throws(() => start(poisoned, observation('b')), error =>
    /Invalid shadow/.test(error.message) && !error.message.includes('CANARY_SECRET'));
  assert.throws(() => start(observation('a', { writePaths: ['../escape'] }), observation('b')), /Invalid shadow/);
  assert.throws(() => start(observation('a', { writePaths: Array(33).fill('src/a.js') }), observation('b')), /Invalid shadow/);
  assert.throws(() => start(observation('a'), observation('b'), { graph: { adjacency: { '__proto__': ['src/a.js'] } } }), /Invalid shadow/);
  assert.throws(() => appendAcknowledgement(initial, { id: initial.receipts[0].id, agentId: 'a',
    scopeRevision: 1, at: later }), /Invalid shadow/);
});
