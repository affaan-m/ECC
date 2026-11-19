'use strict';

const assert = require('assert');
const { search, assembleContext, measure, corpus } = require('../fixtures/rag-production-evaluation/harness');

let passed = 0;
let failed = 0;
function test(name, fn) {
  try { fn(); passed++; console.log(`  ✓ ${name}`); }
  catch (error) { failed++; console.error(`  ✗ ${name}: ${error.message}`); }
}

test('short queries hit every labeled source while whole-document header retrieval misses late topics', () => {
  for (const topic of corpus.topics) {
    const ids = search(topic.query, corpus.sources).map(source => source.id);
    assert.ok(topic.relevantIds.every(id => ids.includes(id)));
  }
  const result = measure(assembleContext(corpus.document, corpus.sources, { mode: 'header' }), corpus.topics);
  assert.deepStrictEqual(result.perTopicRecall, { shipping: 1, invoicing: 0, cancellation: 0 });
  assert.strictEqual(result.macroRecall, 1 / 3);
  assert.deepStrictEqual(result.sourceMix, { policy: 1, template: 1 });
});

test('section retrieval covers later topics but the final context cap can remove that evidence', () => {
  const full = assembleContext(corpus.document, corpus.sources, { mode: 'sections' });
  assert.deepStrictEqual(measure(full, corpus.topics).perTopicRecall,
    { shipping: 1, invoicing: 1, cancellation: 1 });
  assert.deepStrictEqual(measure(full, corpus.topics).sourceMix, { policy: 3, template: 3 });
  const capped = assembleContext(corpus.document, corpus.sources, { mode: 'sections', maxChunks: 3 });
  const metrics = measure(capped, corpus.topics);
  assert.deepStrictEqual(metrics.perTopicRecall, { shipping: 1, invoicing: 1, cancellation: 0 });
  assert.strictEqual(metrics.macroRecall, 2 / 3);
  assert.deepStrictEqual(metrics.sourceMix, { policy: 2, template: 1 });
});

test('a representative single-topic input retains its relevant source through the same path', () => {
  const topic = corpus.topics[0];
  const context = assembleContext(topic.query, corpus.sources, { mode: 'header' });
  assert.strictEqual(measure(context, [topic]).macroRecall, 1);
});

test('retrieval does not depend on oracle labels or source-type metadata', () => {
  const altered = corpus.sources.map(source => ({ ...source, sourceType: 'unknown' }));
  for (const topic of corpus.topics) {
    assert.deepStrictEqual(search(topic.query, altered).map(source => source.id),
      search(topic.query, corpus.sources).map(source => source.id));
  }
  assert.strictEqual(measure([], corpus.topics).macroRecall, 0);
  assert.deepStrictEqual(measure([], corpus.topics).sourceMix, {});
});

test('fusion deduplicates repeated sections and invalid evaluation controls fail explicitly', () => {
  const once = assembleContext(corpus.document, corpus.sources, { mode: 'sections' });
  const twice = assembleContext(`${corpus.document}\n\n${corpus.document}`, corpus.sources, { mode: 'sections' });
  assert.deepStrictEqual(twice, once);
  assert.throws(() => assembleContext(corpus.document, corpus.sources, { mode: 'unknown' }), /mode/);
  assert.throws(() => measure(once, []), /topics/);
});

console.log(`\nPassed: ${passed}\nFailed: ${failed}`);
process.exitCode = failed ? 1 : 0;
