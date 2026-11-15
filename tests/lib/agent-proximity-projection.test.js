'use strict';
/**
 * Tests for scripts/lib/agent-proximity/projection.js: rolling z-score with
 * tail clipping, PCA and the 2D pair/agent projection.
 */

const assert = require('assert');

const { percentile, createProjectionWindow, normalizeSample, pca, projectPairs, PROJECTION_DEFAULTS, _internal } = require('../../scripts/lib/agent-proximity/projection');
const { scanAirspace } = require('../../scripts/lib/agent-proximity');

let passed = 0;
let failed = 0;
function test(name, fn) {
  try {
    fn();
    console.log(`  PASS ${name}`);
    passed += 1;
  } catch (e) {
    console.log(`  FAIL ${name}`);
    console.log(`    ${e.message}`);
    failed += 1;
  }
}

function close(a, b, eps = 1e-6) {
  return Math.abs(a - b) <= eps;
}

console.log('\n=== Testing agent-proximity projection ===\n');

test('percentile: interpolates, clamps and survives empty input', () => {
  assert.strictEqual(percentile([], 50), 0);
  assert.strictEqual(percentile([4], 97.5), 4);
  assert.strictEqual(percentile([1, 2, 3, 4, 5], 50), 3);
  assert.ok(close(percentile([1, 2, 3, 4, 5], 25), 2));
  assert.strictEqual(percentile([1, 2, 3], 0), 1);
  assert.strictEqual(percentile([1, 2, 3], 100), 3);
  assert.strictEqual(percentile([1, 2, 3], 250), 3, 'p above 100 clamps to the max');
  assert.strictEqual(percentile([3, NaN, 1], 100), 3, 'non-finite values are ignored');
});

test('window: rolls, keeps the newest samples and reports per-channel stats', () => {
  const w = createProjectionWindow({ windowSize: 4 });
  for (let i = 1; i <= 6; i += 1) w.push([i, 0, i * 2]);
  assert.strictEqual(w.length, 4);
  const stats = w.stats();
  assert.strictEqual(stats.samples, 4);
  assert.deepStrictEqual(stats.percentiles, PROJECTION_DEFAULTS.clipPercentiles);
  const tree = stats.channels[0];
  assert.strictEqual(tree.channel, 'tree');
  assert.ok(close(tree.mean, 4.5), 'mean of 3,4,5,6');
  assert.ok(tree.stddev > 0);
  assert.ok(tree.clipLow < 0 && tree.clipHigh > 0, 'clip bounds straddle zero in z units');
  assert.strictEqual(stats.channels[1].stddev, 0, 'constant channel has zero variance');
  w.reset();
  assert.strictEqual(w.length, 0);
});

test('normalizeSample: z-scores, clips the tails and maps back to [0, 1]', () => {
  const w = createProjectionWindow({ windowSize: 100 });
  for (let i = 0; i < 100; i += 1) w.push([i / 100, 0.5, 0]);
  const stats = w.stats();
  const low = normalizeSample([-5, 0.5, 0], stats);
  const high = normalizeSample([5, 0.5, 0], stats);
  const mid = normalizeSample([0.495, 0.5, 0], stats);
  assert.strictEqual(low[0], 0, 'far below the 2.5th percentile clips to 0');
  assert.strictEqual(high[0], 1, 'far above the 97.5th percentile clips to 1');
  assert.ok(mid[0] > 0.4 && mid[0] < 0.6, `median lands near 0.5, got ${mid[0]}`);
  assert.strictEqual(low[1], 0.5, 'zero-variance channel maps to 0.5');
  assert.strictEqual(low[2], 0.5, 'all-zero channel maps to 0.5');
  for (const v of [...low, ...high, ...mid]) assert.ok(v >= 0 && v <= 1);
});

test('pca: recovers the dominant axis and reports explained variance', () => {
  const rows = [];
  for (let i = 0; i < 40; i += 1) {
    const t = i / 39;
    rows.push([t, t * 0.5 + 0.001 * ((i % 3) - 1), 0.2]);
  }
  const out = pca(rows, 2);
  assert.strictEqual(out.scores.length, rows.length);
  assert.strictEqual(out.loadings.length, 2);
  const first = out.loadings[0];
  const norm = Math.sqrt(first.reduce((s, x) => s + x * x, 0));
  assert.ok(close(norm, 1, 1e-6), 'loadings are unit vectors');
  assert.ok(Math.abs(first[0]) > Math.abs(first[2]), 'first component follows the varying channels, not the constant one');
  assert.ok(out.explainedVariance[0] > 0.99, `first component explains almost everything, got ${out.explainedVariance[0]}`);
  assert.ok(out.explainedVariance[0] >= out.explainedVariance[1]);
  const total = out.explainedVariance.reduce((s, x) => s + x, 0);
  assert.ok(total <= 1 + 1e-9);
});

test('pca: degenerate inputs give zero scores instead of NaN', () => {
  assert.deepStrictEqual(pca([], 2).scores, []);
  assert.deepStrictEqual(pca([[1, 2, 3]], 2).scores, [[0, 0]]);
  const flat = pca([[0.3, 0.3, 0.3], [0.3, 0.3, 0.3], [0.3, 0.3, 0.3]], 2);
  assert.deepStrictEqual(flat.scores, [[0, 0], [0, 0], [0, 0]]);
  assert.deepStrictEqual(flat.explainedVariance, [0, 0]);
});

test('symmetricEigen: diagonalizes a known 3x3 matrix', () => {
  const eig = _internal.symmetricEigen([[2, 0, 0], [0, 3, 0], [0, 0, 1]]);
  assert.deepStrictEqual(eig.values.map(v => Math.round(v * 1e9) / 1e9), [3, 2, 1]);
  assert.ok(close(Math.abs(eig.vectors[0][1]), 1), 'top eigenvector points along the 3 axis');
});

test('projectPairs: raw mode without a window, one point per pair and per agent', () => {
  const links = [
    { a: 'a', b: 'b', risk: 1, level: 'resolution', channels: { tree: 1, overlap: 1, dependency: 0 } },
    { a: 'a', b: 'c', risk: 0, level: 'clear', channels: { tree: 0, overlap: 0, dependency: 0 } },
    { a: 'b', b: 'c', risk: 0.5, level: 'advisory', channels: { tree: 0.5, overlap: 0, dependency: 0.5 } }
  ];
  const out = projectPairs(links);
  assert.strictEqual(out.method, 'pca');
  assert.strictEqual(out.normalization, 'raw');
  assert.deepStrictEqual(out.channels, ['x_tree', 'x_overlap', 'x_dep']);
  assert.deepStrictEqual(out.weights, { x_tree: 0.25, x_overlap: 1, x_dep: 0.9 });
  assert.strictEqual(out.pairs.length, 3);
  assert.strictEqual(out.pairs[0].point.length, 2);
  assert.deepStrictEqual(out.pairs[0].channels, { x_tree: 1, x_overlap: 1, x_dep: 0 });
  assert.deepStrictEqual(out.pairs[0].normalized, out.pairs[0].channels, 'raw mode passes channel values through');
  assert.strictEqual(out.agents.length, 3);
  const a = out.agents.find(x => x.agentId === 'a');
  assert.strictEqual(a.pairs, 2);
  assert.strictEqual(a.maxRisk, 1);
  for (const agent of out.agents) for (const v of agent.point) assert.ok(Number.isFinite(v));
  assert.strictEqual(out.pca.loadings.length, 2);
  assert.ok(out.pca.explainedVariance[0] > 0);
});

test('projectPairs: switches to z-score mode once the window is warm and keeps values in [0, 1]', () => {
  const window = createProjectionWindow({ windowSize: 64 });
  const link = i => ({ a: `a${i}`, b: `b${i}`, risk: i / 10, level: 'clear', channels: { tree: i / 10, overlap: (10 - i) / 10, dependency: 0.3 } });
  const cold = projectPairs([link(1), link(2)], { window, minWindowForZscore: 8 });
  assert.strictEqual(cold.normalization, 'raw', 'two samples is below the warm-up size');
  assert.strictEqual(cold.window.samples, 2);
  const warm = projectPairs(Array.from({ length: 10 }, (_, i) => link(i)), { window, minWindowForZscore: 8 });
  assert.strictEqual(warm.normalization, 'zscore-clipped');
  assert.strictEqual(warm.window.samples, 12);
  assert.deepStrictEqual(warm.window.percentiles, [2.5, 97.5]);
  assert.strictEqual(warm.window.channels[0].channel, 'x_tree');
  for (const pair of warm.pairs) {
    for (const key of ['x_tree', 'x_overlap', 'x_dep']) {
      assert.ok(pair.normalized[key] >= 0 && pair.normalized[key] <= 1, `${key} normalized within [0, 1]`);
    }
  }
  const lowest = warm.pairs.find(p => p.a === 'a0');
  const highest = warm.pairs.find(p => p.a === 'a9');
  assert.ok(lowest.normalized.x_tree < highest.normalized.x_tree, 'ordering survives normalization');
  assert.strictEqual(warm.pairs[0].normalized.x_dep, 0.5, 'constant channel sits at 0.5');
});

test('projectPairs: ignores malformed links and empty input', () => {
  const out = projectPairs([null, { risk: 1 }, { a: 'x' }]);
  assert.deepStrictEqual(out.pairs, []);
  assert.deepStrictEqual(out.agents, []);
  assert.deepStrictEqual(projectPairs(undefined).pairs, []);
});

test('scanAirspace links carry the per-channel values the projection needs', () => {
  const agents = [
    { agentId: 'a', files: [{ path: 'src/api/users.js', lines: [[1, 50]] }] },
    { agentId: 'b', files: [{ path: 'src/api/users.js', lines: [[1, 50]] }] },
    { agentId: 'c', files: [{ path: 'docs/guide.md' }] }
  ];
  const scan = scanAirspace(agents, {});
  assert.strictEqual(scan.links.length, 3);
  for (const link of scan.links) {
    assert.ok(link.channels, 'link has channels');
    for (const key of ['tree', 'overlap', 'dependency']) assert.ok(Number.isFinite(link.channels[key]), `${key} is numeric`);
  }
  const ab = scan.links.find(l => (l.a === 'a' && l.b === 'b') || (l.a === 'b' && l.b === 'a'));
  assert.strictEqual(ab.channels.overlap, 1);
  const out = projectPairs(scan.links);
  assert.strictEqual(out.pairs.length, 3);
  assert.strictEqual(out.agents.length, 3);
});

console.log(`\nResults: Passed: ${passed}, Failed: ${failed}`);
if (failed > 0) process.exit(1);
