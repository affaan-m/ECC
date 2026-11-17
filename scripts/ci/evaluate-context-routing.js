#!/usr/bin/env node
/**
 * Routing-quality gate over the routing prompt corpus from community PR #2945.
 *
 * Wrong implicit loads fail in both sets. Ranking is gated on the direct set
 * only; the paraphrased set is reported so it can improve without blocking.
 */

'use strict';

const fs = require('node:fs');
const path = require('node:path');
const { resolveTaskContext } = require('../lib/context-selection');
const { DEFAULT_REPO_ROOT } = require('../lib/context-profile-support');

const CORPUS = path.join(DEFAULT_REPO_ROOT, 'tests/fixtures/context-selection/routing-prompts.json');
const SCHEMA = 'ecc.routing-quality.v1';
const SETS = Object.freeze(['direct', 'paraphrased']);
const THRESHOLDS = Object.freeze({ 'direct.top3Rate': 0.88, 'direct.top1Rate': 0.80 });
const METRICS = Object.freeze(['top1Rate', 'top3Rate', 'admissionPrecision']);

const rate = (count, total) => (total ? Number((count / total).toFixed(3)) : null);

function score(rows) {
  const sets = {};
  const wrongLoads = [];
  for (const set of SETS) {
    const entries = rows.filter(entry => entry.set === set);
    let top1 = 0;
    let top3 = 0;
    let admitted = 0;
    let wrong = 0;
    for (const entry of entries) {
      if (entry.expected.includes(entry.candidateIds[0])) top1 += 1;
      if (entry.candidateIds.slice(0, 3).some(id => entry.expected.includes(id))) top3 += 1;
      if (!entry.selectedIds.length) continue;
      admitted += 1;
      if (entry.selectedIds.some(id => !entry.expected.includes(id))) {
        wrong += 1;
        wrongLoads.push({ set, query: entry.query, selectedIds: entry.selectedIds, expected: entry.expected });
      }
    }
    sets[set] = { prompts: entries.length, top1, top3, admitted, wrongLoads: wrong,
      top1Rate: rate(top1, entries.length), top3Rate: rate(top3, entries.length),
      admissionPrecision: rate(admitted - wrong, admitted) };
  }
  const breaches = [];
  for (const set of SETS) {
    if (sets[set].wrongLoads) breaches.push({ metric: `${set}.wrongLoads`, actual: sets[set].wrongLoads, required: 0 });
  }
  for (const [metric, required] of Object.entries(THRESHOLDS)) {
    const [set, key] = metric.split('.');
    const { prompts } = sets[set];
    // Gate on the unrounded ratio; the rounded rate is for display only.
    const ratio = prompts ? sets[set][key.replace(/Rate$/, '')] / prompts : null;
    if (ratio === null || ratio < required) breaches.push({ metric, actual: sets[set][key], required });
  }
  return { schemaVersion: SCHEMA, status: breaches.length ? 'fail' : 'pass',
    thresholds: { ...THRESHOLDS, wrongLoads: 0 }, sets, breaches, wrongLoads };
}

/** Reads the corpus and rejects a missing or empty set, or a malformed prompt, before any resolve. */
function readCorpus(corpusPath) {
  const corpus = JSON.parse(fs.readFileSync(corpusPath, 'utf8'));
  for (const set of SETS) {
    const prompts = corpus && corpus[set];
    const valid = Array.isArray(prompts) && prompts.length > 0 && prompts.every(prompt => prompt
      && typeof prompt.query === 'string' && Array.isArray(prompt.expected) && prompt.expected.length > 0);
    if (!valid) throw new Error(`routing corpus ${corpusPath}: "${set}" must be a non-empty array of { query, expected } prompts`);
  }
  return corpus;
}

/** One resolver pass over the corpus; every prompt is a fresh task in auto mode.
 * The registry digest comes from the resolver's own receipt, so the gate adds no registry load. */
function evaluate({ repoRoot = DEFAULT_REPO_ROOT, corpusPath = CORPUS } = {}) {
  const corpus = readCorpus(corpusPath);
  const rows = [];
  let registryDigest = null;
  for (const set of SETS) {
    for (const [index, { query, expected }] of corpus[set].entries()) {
      const result = resolveTaskContext({ repoRoot, selectionMode: 'auto', load: false,
        task: { sessionId: 'routing-eval', taskId: `${set}-${index}`, revision: 1, phase: 'evaluate', query } });
      registryDigest = registryDigest || result.receipt.registryDigest;
      rows.push({ set, query, expected, candidateIds: result.candidates.map(candidate => candidate.id), selectedIds: result.selectedIds });
    }
  }
  return { ...score(rows), registryDigest, node: process.version };
}

function baselineDelta(current, previous) {
  const lines = [];
  for (const set of SETS) {
    for (const key of METRICS) {
      const now = current.sets[set][key];
      const before = previous.sets?.[set]?.[key];
      if (typeof now !== 'number' || typeof before !== 'number') {
        lines.push(`${set}.${key}: ${before ?? 'n/a'} -> ${now ?? 'n/a'}`);
        continue;
      }
      const change = now - before;
      lines.push(`${set}.${key}: ${before.toFixed(3)} -> ${now.toFixed(3)} (${change < 0 ? '-' : '+'}${Math.abs(change).toFixed(3)})`);
    }
  }
  return lines;
}

function summary(result) {
  const { direct, paraphrased } = result.sets;
  return `Routing quality ${result.status}: direct top-1 ${direct.top1}/${direct.prompts}, top-3 ${direct.top3}/${direct.prompts}, `
    + `${direct.admitted} implicit loads; paraphrased top-3 ${paraphrased.top3}/${paraphrased.prompts} (reported, not gated); `
    + `${result.wrongLoads.length} wrong loads.`;
}

/** Reads a previous receipt before the corpus run, so a bad path or file fails fast. */
function readBaseline(io, file) {
  if (!file) return null;
  const previous = JSON.parse(io.readFile(file));
  const isReceipt = previous !== null && typeof previous === 'object' && !Array.isArray(previous)
    && previous.schemaVersion === SCHEMA
    && SETS.every(set => previous.sets && previous.sets[set] !== null && typeof previous.sets[set] === 'object');
  if (!isReceipt) throw new Error(`${file} is not an ${SCHEMA} receipt`);
  return previous;
}

function main(args = process.argv.slice(2), dependencies = {}) {
  const io = { evaluate, log: console.log, error: console.error, readFile: file => fs.readFileSync(file, 'utf8'), ...dependencies };
  try {
    let json = false;
    let baseline = null;
    for (let index = 0; index < args.length; index++) {
      if (args[index] === '--json') json = true;
      else if (args[index] === '--baseline' && args[index + 1] && !args[index + 1].startsWith('--')) baseline = args[++index];
      else throw new Error(args[index] === '--baseline' ? '--baseline requires a receipt path' : `Unknown argument: ${args[index]}`);
    }
    const previous = readBaseline(io, baseline);
    const result = io.evaluate();
    if (json) io.log(JSON.stringify(result, null, 2));
    else {
      io.log(summary(result));
      for (const breach of result.breaches) io.error(`Gate breached: ${breach.metric} is ${breach.actual}, requires ${breach.metric.endsWith('wrongLoads') ? '0' : `>= ${breach.required}`}`);
      for (const wrong of result.wrongLoads) io.error(`Wrong load (${wrong.set}): "${wrong.query}" -> ${wrong.selectedIds.join(', ')}`);
    }
    // With --json the delta goes to stderr so stdout stays a single JSON document.
    if (previous) for (const line of baselineDelta(result, previous)) (json ? io.error : io.log)(line);
    return result.status === 'pass' ? 0 : 1;
  } catch (error) {
    io.error(`Routing quality evaluation failed: ${error.message}`);
    return 1;
  }
}

if (require.main === module) process.exitCode = main();
module.exports = { THRESHOLDS, baselineDelta, evaluate, main, score };
