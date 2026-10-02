#!/usr/bin/env node
'use strict';
const { performance } = require('node:perf_hooks');
const { buildInventory } = require('../../scripts/lib/coordination-inventory');
const cases = require('./fixtures.json');
function matrix() { return { truePositive: 0, falsePositive: 0, trueNegative: 0, falseNegative: 0 }; }
function add(m, expected, actual) { m[expected ? actual ? 'truePositive' : 'falseNegative' : actual ? 'falsePositive' : 'trueNegative'] += 1; }
const baseline = matrix(); const candidate = matrix();
const started = performance.now();
const rows = cases.map(c => {
  const report = buildInventory(c.manifest, { now: '2026-09-08T06:30:00.000Z' });
  const [a,b] = c.manifest.tasks;
  const exactPath = a.repoId === b.repoId && a.paths.some(p => b.paths.includes(p));
  const warning = report.warnings.length > 0;
  add(baseline,c.needsReview,exactPath); add(candidate,c.needsReview,warning);
  return { id: c.id, needsReview: c.needsReview, exactPath, pathAndImport: warning };
});
process.stdout.write(`${JSON.stringify({ version:1, dataset:'eight-authored-synthetic-pairs-v1', rows, baseline, candidate,
  elapsedMs: performance.now()-started, conclusion:'Fixture detection only. Not a measured reduction in conflicts or validation of semantic/PCA proximity.' },null,2)}\n`);
