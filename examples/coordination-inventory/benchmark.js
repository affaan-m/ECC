#!/usr/bin/env node
'use strict';
const { performance } = require('node:perf_hooks');
const { createHash } = require('node:crypto');
const { buildInventory } = require('../../scripts/lib/coordination-inventory');
const legacy = require('./manifest.json');
const declared = require('./goals.json');
const controls = require('./fixtures.json');
const now = '2026-09-08T06:30:00.000Z';
const parameters = { warmupBatches: 5, samples: 31, iterationsPerSample: 10 };
const atLimit = { ...legacy,
  goals: Array.from({ length: 64 }, (_, i) => ({ id: `g${i}`, taskId: 'a',
    kind: 'native', status: 'active', updatedAt: now })),
  sessions: Array.from({ length: 64 }, (_, i) => ({ id: `s${i}`, taskId: 'a',
    goalId: `g${i}`, status: 'open', updatedAt: now }))
};

function measure(name, manifest) {
  const batch = () => {
    for (let i = 0; i < parameters.iterationsPerSample; i += 1) buildInventory(manifest, { now });
  };
  for (let i = 0; i < parameters.warmupBatches; i += 1) batch();
  const samples = Array.from({ length: parameters.samples }, () => {
    const start = performance.now(); batch();
    return (performance.now() - start) / parameters.iterationsPerSample;
  }).sort((a, b) => a - b);
  const report = buildInventory(manifest, { now });
  const input = JSON.stringify(manifest);
  return { name, inputBytes: Buffer.byteLength(input),
    inputSha256: createHash('sha256').update(input).digest('hex'),
    medianMs: samples[Math.floor(samples.length / 2)],
    p95Ms: samples[Math.ceil(samples.length * 0.95) - 1], samplesMs: samples,
    warnings: report.warnings, activity: report.activity ?? null };
}

const rows = controls.map(control => {
  const [a, b] = control.manifest.tasks;
  return { id: control.id, needsReview: control.needsReview,
    exactPath: a.repoId === b.repoId && a.paths.some(p => b.paths.includes(p)),
    pathAndImport: buildInventory(control.manifest, { now }).warnings.length > 0 };
});
const matrix = detector => rows.reduce((result, row) => {
  const key = row.needsReview ? (row[detector] ? 'truePositive' : 'falseNegative')
    : (row[detector] ? 'falsePositive' : 'trueNegative');
  return { ...result, [key]: result[key] + 1 };
}, { truePositive: 0, falsePositive: 0, trueNegative: 0, falseNegative: 0 });
const report = {
  version: 1, mode: 'synthetic-local-characterization', node: process.version,
  platform: process.platform, parameters,
  workloads: [measure('legacy', legacy), measure('declared', declared), measure('declaration-limit', atLimit)],
  overlapControls: { dataset: 'eight-authored-synthetic-pairs-v1', rows,
    baseline: matrix('exactPath'), candidate: matrix('pathAndImport') },
  limits: ['Batch average buildInventory time excludes process startup and CLI I/O.',
    'Declaration-limit uses 64 goals and 64 sessions; it is not a maximum graph-work benchmark.',
    'Timing is machine-dependent; no production conflict reduction or 85% improvement claim.',
    'Declarations are caller input, not verified native goal or session execution.']
};
process.stdout.write(`${JSON.stringify(report, null, 2)}\n`);
