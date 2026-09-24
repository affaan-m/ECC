'use strict';

// Hybrid skill retrieval for ECC-029 auto selection.
//
// Two deterministic, dependency-free legs fused by reciprocal rank fusion:
//   1. BM25F-style weighted fields (name, description, owning module) over the
//      canonical registry metadata. Captures exact and token-overlap recall.
//   2. A hashed character n-gram vector leg over name + description. Adds
//      morphological tolerance (navigate/navigation, performance/faster is NOT
//      covered — true synonyms need the pinned-embedder upgrade path, which
//      must keep this interface and the registry embedding manifest).
//
// Everything runs in-process with no model weights and no network, so receipts
// and registry digests stay reproducible. Indexing 292 entries costs well
// under a millisecond, keeping the plan's in-process latency target.

const STOP_WORDS = new Set('a an and are for from help i in is it me my of on please the to with'.split(' '));

const K1 = 1.2;
const B = 0.75;
const RRF_K = 60;
const DENSE_DIM = 2048;
const FIELD_WEIGHTS = { name: 3.0, description: 2.0, module: 1.0 };
// A dense-leg hit this strong means morphology matched even without BM25
// tokens; below it, sparse hash collisions are more likely than intent.
const DENSE_ADMIT_COSINE = 0.35;

function tokenize(text) {
  return text.toLowerCase().split(/[^a-z0-9]+/).filter(word => word.length > 1 && !STOP_WORDS.has(word));
}

function normalizedName(text) { return text.toLowerCase().replace(/[^a-z0-9]+/g, ' ').trim(); }

// FNV-1a 32-bit: stable, platform-independent feature hashing.
function hash32(text) {
  let hash = 0x811c9dc5;
  for (let index = 0; index < text.length; index += 1) {
    hash ^= text.charCodeAt(index);
    hash = Math.imul(hash, 0x01000193) >>> 0;
  }
  return hash;
}

function addFeature(vector, feature, weight = 1) {
  vector[hash32(feature) % DENSE_DIM] += weight;
}

function denseVector(tokensForFields) {
  const vector = new Array(DENSE_DIM).fill(0);
  for (const tokens of tokensForFields) {
    const seen = new Map();
    for (const token of tokens) {
      seen.set(token, (seen.get(token) || 0) + 1);
      if (token.length >= 4) {
        for (let n = 3; n <= Math.min(4, token.length); n += 1) {
          for (let index = 0; index <= token.length - n; index += 1) {
            seen.set(`#${n}:${token.slice(index, index + n)}`, (seen.get(`#${n}:${token.slice(index, index + n)}`) || 0) + 0.5);
          }
        }
      }
    }
    for (const [feature, count] of seen) addFeature(vector, feature, 1 + Math.log(count));
  }
  let norm = 0;
  for (const value of vector) norm += value * value;
  norm = Math.sqrt(norm) || 1;
  return vector.map(value => value / norm);
}

function dot(left, right) {
  let total = 0;
  for (let index = 0; index < left.length; index += 1) total += left[index] * right[index];
  return total;
}

function fieldTokens(entry, field) {
  if (field === 'name') return tokenize(`${entry.id.slice('skill:'.length)} ${entry.name || ''}`);
  if (field === 'description') return tokenize(entry.description || '');
  return tokenize(`${entry.ownerModuleId || ''} ${entry.packId || ''}`);
}

/** Build a reusable retrieval index over registry-shaped entries. */
function buildRetrievalIndex(entries) {
  const documents = entries.map(entry => {
    const fields = {};
    let docLength = 0;
    const weighted = new Map();
    for (const field of Object.keys(FIELD_WEIGHTS)) {
      const tokens = fieldTokens(entry, field);
      fields[field] = tokens;
      for (const token of tokens) {
        const contribution = FIELD_WEIGHTS[field];
        weighted.set(token, (weighted.get(token) || 0) + contribution);
        docLength += contribution;
      }
    }
    return { entry, fields, weighted, docLength,
      dense: denseVector([fields.name, fields.description]),
      aliases: [...new Set([entry.id.slice('skill:'.length), entry.name].filter(Boolean).map(normalizedName))] };
  });
  const documentFrequency = new Map();
  for (const document of documents) {
    for (const term of document.weighted.keys()) {
      documentFrequency.set(term, (documentFrequency.get(term) || 0) + 1);
    }
  }
  const averageLength = documents.reduce((total, document) => total + document.docLength, 0) / (documents.length || 1);
  const idf = term => Math.log(1 + (documents.length - documentFrequency.get(term) + 0.5) / (documentFrequency.get(term) + 0.5));
  return { documents, documentFrequency, averageLength: averageLength || 1, idf, entryCount: documents.length };
}

/** Rank entries for a free-text query. Returns candidates sorted by fused score. */
function searchRetrieval(index, query, { limit = 5 } = {}) {
  const queryTokens = tokenize(query || '');
  const normalizedQuery = ` ${normalizedName(query || '')} `;
  if (!queryTokens.length) return [];
  const queryDense = denseVector([queryTokens]);
  const bm25 = new Map();
  const dense = new Map();
  for (const document of index.documents) {
    let score = 0;
    for (const term of new Set(queryTokens)) {
      const tf = document.weighted.get(term);
      if (!tf) continue;
      const denominator = tf + K1 * (1 - B + B * document.docLength / index.averageLength);
      score += index.idf(term) * (tf * (K1 + 1)) / denominator;
    }
    if (score > 0) bm25.set(document, score);
    const cosine = dot(queryDense, document.dense);
    if (cosine >= DENSE_ADMIT_COSINE) dense.set(document, cosine);
  }
  const bm25Ranked = [...bm25.entries()].sort((a, b) => b[1] - a[1] || (a[0].entry.id < b[0].entry.id ? -1 : 1));
  const denseRanked = [...dense.entries()].sort((a, b) => b[1] - a[1] || (a[0].entry.id < b[0].entry.id ? -1 : 1));
  // Query-coverage floor: a single incidental token (e.g. "capital" of
  // "capital of Japan") is not evidence of relevance. Short queries need two
  // matched terms; longer technical queries carry signal in one strong domain
  // term. Exact names and strong morphology matches anchor regardless.
  const uniqueTerms = new Set(queryTokens);
  const minimumCoverage = Math.min(2, uniqueTerms.size);
  const eligible = new Set();
  for (const [document] of bm25Ranked) {
    const matchedCount = [...uniqueTerms].filter(term => document.weighted.has(term)).length;
    if (matchedCount >= minimumCoverage || (matchedCount >= 1 && uniqueTerms.size >= 4)) eligible.add(document);
  }
  for (const [document, cosine] of denseRanked) if (cosine >= DENSE_ADMIT_COSINE) eligible.add(document);
  const fused = new Map();
  const addRank = (ranked, weight) => ranked.forEach(([document], rank) => {
    if (!eligible.has(document)) return;
    fused.set(document, (fused.get(document) || 0) + weight / (RRF_K + rank + 1));
  });
  addRank(bm25Ranked, 1);
  addRank(denseRanked, 0.8);
  // A complete canonical/native name in the query anchors that skill first,
  // matching the previous contract and how agents cite skills.
  const exactAnchors = index.documents.filter(document => document.aliases
    .some(alias => alias && normalizedQuery.includes(` ${alias} `)));
  for (const document of exactAnchors) fused.set(document, (fused.get(document) || 0) + 1);
  if (!fused.size) return [];
  return [...fused.entries()]
    .sort((a, b) => b[1] - a[1] || (a[0].entry.id < b[0].entry.id ? -1 : 1))
    .slice(0, limit)
    .map(([document, score]) => {
      const matched = [...new Set(queryTokens)].filter(term => document.weighted.has(term));
      const exact = exactAnchors.includes(document);
      return { id: document.entry.id, score: Math.round(score * 10000) / 10000, exact,
        dense: Math.round((dense.get(document) || 0) * 10000) / 10000,
        bm25: Math.round((bm25.get(document) || 0) * 10000) / 10000,
        matchedTerms: matched,
        description: document.entry.description.slice(0, 2048),
        descriptionTruncated: document.entry.description.length > 2048 };
    });
}

module.exports = { buildRetrievalIndex, searchRetrieval, tokenize,
  internals: { denseVector, dot, DENSE_ADMIT_COSINE, DENSE_DIM } };
