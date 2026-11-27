'use strict';

// Synthetic lexical retrieval only. Oracle topics are passed to measure(), never search().
const corpus = require('./corpus.json');
const tokens = text => new Set(text.toLowerCase().match(/[a-z]+/g) || []);

function search(query, sources, topK = 2) {
  const queryTokens = tokens(query);
  return sources.map(source => ({
    source,
    score: [...tokens(source.text)].filter(token => queryTokens.has(token)).length,
  })).filter(row => row.score > 0)
    .sort((a, b) => b.score - a.score || a.source.id.localeCompare(b.source.id))
    .slice(0, topK).map(row => row.source);
}

// Both candidate configurations use this complete query -> retrieval -> context path.
function assembleContext(document, sources, { mode, maxChunks = Infinity } = {}) {
  if (!['header', 'sections'].includes(mode)) throw new Error('unknown query mode');
  if (maxChunks !== Infinity && (!Number.isInteger(maxChunks) || maxChunks < 0)) {
    throw new Error('maxChunks must be a nonnegative integer or Infinity');
  }
  const queries = mode === 'header'
    ? [document.split(/\s+/).slice(0, 12).join(' ')]
    : document.split(/\n\s*\n/).filter(section => section.trim());
  const ranked = queries.flatMap(query => search(query, sources));
  const unique = [...new Map(ranked.map(source => [source.id, source])).values()];
  return unique.slice(0, maxChunks);
}

function measure(context, topics) {
  if (!topics.length || topics.some(topic => !topic.relevantIds.length)) {
    throw new Error('topics need nonempty relevance judgments');
  }
  const ids = new Set(context.map(source => source.id));
  const perTopicRecall = Object.fromEntries(topics.map(topic => [topic.id,
    topic.relevantIds.filter(id => ids.has(id)).length / topic.relevantIds.length]));
  const sourceMix = Object.fromEntries([...new Set(context.map(source => source.sourceType))]
    .map(type => [type, context.filter(source => source.sourceType === type).length]));
  return {
    perTopicRecall,
    macroRecall: Object.values(perTopicRecall).reduce((sum, value) => sum + value, 0) / topics.length,
    sourceMix,
  };
}

if (require.main === module) {
  for (const config of [{ mode: 'header' }, { mode: 'sections' }, { mode: 'sections', maxChunks: 3 }]) {
    const context = assembleContext(corpus.document, corpus.sources, config);
    console.log(JSON.stringify({ config, contextIds: context.map(source => source.id), ...measure(context, corpus.topics) }));
  }
}

module.exports = { search, assembleContext, measure, corpus };
