'use strict';

const assert = require('node:assert/strict');
const test = require('node:test');
const { buildRetrievalIndex, searchRetrieval, internals } = require('../../scripts/lib/context-retrieval');
const { loadContextRegistry } = require('../../scripts/lib/context-pack-registry');
const { DEFAULT_REPO_ROOT } = require('../../scripts/lib/context-profile-support');

test('short prompt scoring reads only a bounded subset of each registry vector', () => {
  const { entries } = loadContextRegistry({ repoRoot: DEFAULT_REPO_ROOT });
  const index = buildRetrievalIndex(entries);
  const query = 'keyboard navigation';
  const expected = searchRetrieval(index, query, { limit: entries.length });
  let vectorReads = 0;
  const observed = {
    ...index,
    documents: index.documents.map(document => ({
      ...document,
      dense: new Proxy(document.dense, {
        get(vector, key) {
          if (/^\d+$/.test(String(key))) vectorReads += 1;
          return Reflect.get(vector, key);
        }
      })
    }))
  };

  assert.deepEqual(searchRetrieval(observed, query, { limit: entries.length }), expected);
  assert.ok(vectorReads > 0);
  assert.ok(vectorReads < entries.length * internals.DENSE_DIM / 4,
    `short prompt read ${vectorReads} vector dimensions across ${entries.length} skills`);
});

test('precomputed vectors retain full dot-product admission and rounded cosine values', () => {
  const query = 'keyboard navigation';
  const queryDense = internals.denseVector([['keyboard', 'navigation']]);
  const dimensions = queryDense.flatMap((value, dimension) => value === 0 ? [] : [dimension]);
  const entries = [0, 0.2, 0.34999, 0.35, 0.35001, 0.8, 1, -1].map((scale, index) => ({
    id: `skill:record-${index}`, name: `record-${index}`, description: '',
    dense: [
      [dimensions[0], 100],
      ...dimensions.slice().reverse().map(dimension => [dimension, queryDense[dimension] * scale]),
      [2047, 0]
    ]
  }));
  const index = buildRetrievalIndex(entries);
  const expected = index.documents.map(document => ({
    id: document.entry.id,
    cosine: internals.dot(queryDense, document.dense)
  })).filter(item => item.cosine >= internals.DENSE_ADMIT_COSINE)
    .sort((left, right) => right.cosine - left.cosine || left.id.localeCompare(right.id));
  const actual = searchRetrieval(index, query, { limit: entries.length });
  assert.deepEqual(actual.map(item => item.id), expected.map(item => item.id));
  assert.deepEqual(actual.map(item => item.dense), expected.map(item => Math.round(item.cosine * 10000) / 10000));
  assert.ok(actual.every(item => item.bm25 === 0 && !item.exact));
});

test('zero query vectors return no candidates without reading document dimensions', () => {
  const index = buildRetrievalIndex([{ id: 'skill:sample', name: 'sample', description: 'Sample workflow.' }]);
  const observed = {
    ...index,
    documents: index.documents.map(document => ({
      ...document,
      dense: new Proxy(document.dense, { get() { throw new Error('Empty query scored a document'); } })
    }))
  };
  for (const query of ['', 'the and for', '!!!']) assert.deepEqual(searchRetrieval(observed, query), []);
});
