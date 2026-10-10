'use strict';

const assert = require('node:assert/strict');
const test = require('node:test');
const { buildRetrievalIndex, searchRetrieval } = require('../../scripts/lib/context-retrieval');
const { loadContextRegistry } = require('../../scripts/lib/context-pack-registry');
const { DEFAULT_REPO_ROOT } = require('../../scripts/lib/context-profile-support');

const entry = (id, name, description, ownerModuleId = 'workflow-quality') => ({ id, name, description, ownerModuleId, packId: ownerModuleId });

test('exact canonical name anchors the cited skill first', () => {
  const index = buildRetrievalIndex([
    entry('skill:feature', 'feature', 'Feature workflow for the win.'),
    entry('skill:other', 'other', ' Mentions feature workflows in prose only.'),
  ]);
  const ranked = searchRetrieval(index, 'Use the feature workflow for this change.');
  assert.equal(ranked[0].id, 'skill:feature');
  assert.equal(ranked[0].exact, true);
});

test('bm25 ranks multi-token description matches over single incidental matches', () => {
  const index = buildRetrievalIndex([
    entry('skill:a', 'a', 'Keyboard navigation and focus management for forms.'),
    entry('skill:b', 'b', 'General project governance and documentation maps.'),
    entry('skill:c', 'c', 'Benchmarking latency and page load speed.'),
  ]);
  const ranked = searchRetrieval(index, 'keyboard navigation in my settings form');
  assert.equal(ranked[0].id, 'skill:a');
});

test('a single incidental query token produces no candidates', () => {
  const index = buildRetrievalIndex([
    entry('skill:finance', 'finance', 'Invoicing, billing cycles, and capital reporting.'),
  ]);
  assert.deepEqual(searchRetrieval(index, 'capital of Japan'), []);
});

test('longer queries carry signal in one strong domain term', () => {
  const index = buildRetrievalIndex([
    entry('skill:rust-patterns', 'rust-patterns', 'Idiomatic Rust patterns for ownership and error handling.'),
    entry('skill:rails-patterns', 'rails-patterns', 'Rails service objects and background job conventions.'),
  ]);
  const ranked = searchRetrieval(index, 'diagnose a memory leak in a rust background worker service');
  assert.ok(ranked.some(candidate => candidate.id === 'skill:rust-patterns'));
});

test('hashed morphology leg connects query and description word forms', () => {
  const { internals } = require('../../scripts/lib/context-retrieval');
  const docVector = internals.denseVector([['keyboard', 'navigation', 'guidance']]);
  const queryVector = internals.denseVector([['keyboard', 'navigate']]);
  const cosine = internals.dot(docVector, queryVector);
  assert.ok(cosine >= internals.DENSE_ADMIT_COSINE,
    `expected morphology cosine >= ${internals.DENSE_ADMIT_COSINE}, got ${cosine}`);
  const index = buildRetrievalIndex([entry('skill:nav', 'nav', 'Keyboard navigation guidance only.')]);
  const ranked = searchRetrieval(index, 'keyboard navigate');
  assert.equal(ranked[0] && ranked[0].id, 'skill:nav');
});

const registry = loadContextRegistry({ repoRoot: DEFAULT_REPO_ROOT });
const registryIndex = buildRetrievalIndex(registry.entries);

const TOP1_PROBES = [
  ['security review this code', 'skill:security-review'],
  ['make keyboard navigation work in our React settings form', 'skill:frontend-a11y'],
  ['add a column to a huge table without downtime', 'skill:database-migrations'],
  ['set up CI/CD and docker deployment with health checks', 'skill:deployment-patterns'],
  ['monitor production URL after deploy for errors', 'skill:canary-watch'],
  ['write failing test first then implement the feature', 'skill:tdd-workflow'],
  ['keep my git history tidy before merging', 'skill:git-workflow'],
];

for (const [query, expected] of TOP1_PROBES) {
  test(`actual registry top-1: ${query}`, () => {
    const ranked = searchRetrieval(registryIndex, query, { limit: 5 });
    assert.equal(ranked[0] && ranked[0].id, expected,
      `expected ${expected}, got ${ranked.slice(0, 3).map(candidate => candidate.id).join(', ')}`);
  });
}

const TOP3_PROBES = [
  ['Review a PostgreSQL migration that adds an indexed nullable column without downtime', 'skill:database-migrations'],
  ['Diagnose a memory leak in a Rust background worker service', 'skill:rust-patterns'],
  ['Use Python patterns for this change.', 'skill:python-patterns'],
  ['speed up my slow web pages', 'skill:benchmark'],
];

for (const [query, expected] of TOP3_PROBES) {
  test(`actual registry top-3: ${query.slice(0, 60)}`, () => {
    const ranked = searchRetrieval(registryIndex, query, { limit: 5 });
    assert.ok(ranked.findIndex(candidate => candidate.id === expected) >= 0,
      `expected ${expected} in top 3, got ${ranked.slice(0, 3).map(candidate => candidate.id).join(', ')}`);
  });
}

test('actual registry: irrelevant factual questions return no candidates', () => {
  assert.deepEqual(searchRetrieval(registryIndex, 'What is the capital of Japan?'), []);
});

test('actual registry: every candidate carries matched terms and a fused score', () => {
  const ranked = searchRetrieval(registryIndex, 'security review this code', { limit: 3 });
  assert.ok(ranked.length > 0);
  for (const candidate of ranked) {
    assert.equal(typeof candidate.score, 'number');
    assert.ok(Array.isArray(candidate.matchedTerms));
    assert.equal(candidate.description, candidate.description.slice(0, 2048));
  }
});
