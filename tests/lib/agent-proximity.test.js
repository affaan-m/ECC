'use strict';
/**
 * Tests for the agent-space distance metric + collision avoidance (Layer 4 v0).
 */

const assert = require('assert');

const { treeDistance, lineRangeOverlap, graphDistance, collisionRisk, advise, closureRate } = require('../../scripts/lib/agent-proximity/distance');
const { buildDependencyGraphFromSources, extractRelativeSpecifiers } = require('../../scripts/lib/agent-proximity/graph');
const { scanAirspace, embedAgents } = require('../../scripts/lib/agent-proximity');

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

function euclid(a, b) {
  return Math.sqrt(a.reduce((s, x, i) => s + (x - b[i]) ** 2, 0));
}

console.log('\n=== Testing agent-proximity ===\n');

// ── tree distance ──
test('treeDistance: identical path is 0', () => {
  assert.strictEqual(treeDistance('a/b/c.js', 'a/b/c.js'), 0);
});
test('treeDistance: siblings are closer than cousins', () => {
  const sib = treeDistance('src/api/users.js', 'src/api/posts.js');
  const cousin = treeDistance('src/api/users.js', 'src/db/schema.js');
  const disjoint = treeDistance('src/api/users.js', 'docs/guide.md');
  assert.ok(sib < cousin, `siblings ${sib} should be < cousins ${cousin}`);
  assert.ok(cousin < disjoint, `cousins ${cousin} should be < disjoint ${disjoint}`);
  assert.ok(sib >= 0 && disjoint <= 1);
});

// ── line overlap ──
test('lineRangeOverlap: full overlap when whole-file (no ranges)', () => {
  assert.strictEqual(lineRangeOverlap([], []), 1);
});
test('lineRangeOverlap: partial overlapping ranges (overlap coefficient)', () => {
  const r = lineRangeOverlap([[1, 10]], [[5, 14]]);
  // overlap lines 5..10 = 6; min size = 10 → 6/10
  assert.ok(Math.abs(r - 6 / 10) < 1e-9, `got ${r}`);
});
test('lineRangeOverlap: smaller edit fully inside the larger ⇒ 1', () => {
  // overlap coefficient catches "B's whole edit is inside A's region".
  assert.strictEqual(lineRangeOverlap([[1, 200]], [[40, 60]]), 1);
});
test('lineRangeOverlap: disjoint ranges are 0', () => {
  assert.strictEqual(lineRangeOverlap([[1, 5]], [[20, 25]]), 0);
});

// ── dependency graph + distance ──
test('builds a dependency graph from require/import sources', () => {
  const g = buildDependencyGraphFromSources({
    'src/a.js': "const b = require('./b');\nimport c from './sub/c.js';",
    'src/b.js': 'module.exports = {};',
    'src/sub/c.js': 'export default 1;'
  });
  assert.deepStrictEqual(new Set(g.adjacency['src/a.js']), new Set(['src/b.js', 'src/sub/c.js']));
  assert.deepStrictEqual(g.adjacency['src/b.js'], []);
});
test('extractRelativeSpecifiers ignores bare (node_modules) specifiers', () => {
  const specs = extractRelativeSpecifiers("require('fs'); require('./local'); import x from 'lodash';");
  assert.deepStrictEqual(specs, ['./local']);
});
test('graphDistance: direct edge is 1, two hops is 2, unreachable is Infinity', () => {
  const g = { adjacency: { 'a.js': ['b.js'], 'b.js': ['c.js'], 'c.js': [], 'z.js': [] } };
  assert.strictEqual(graphDistance(g, 'a.js', 'b.js'), 1);
  assert.strictEqual(graphDistance(g, 'a.js', 'c.js'), 2);
  assert.strictEqual(graphDistance(g, 'a.js', 'z.js'), Infinity);
});

// ── collision risk channels ──
test('collisionRisk: two agents editing the SAME file ⇒ high risk', () => {
  // Whole-file edits to the same file (no line info) ⇒ full overlap.
  const a = { agentId: 'a', files: [{ path: 'src/api/users.js' }] };
  const b = { agentId: 'b', files: [{ path: 'src/api/users.js' }] };
  const { risk, channels } = collisionRisk(a, b, {});
  assert.ok(risk > 0.5, `same-file risk ${risk} should be high`);
  assert.ok(channels.overlap > 0);
});
test('collisionRisk: same file but heavily-overlapping lines ⇒ still high', () => {
  const a = { agentId: 'a', files: [{ path: 'src/api/users.js', lines: [[1, 50]] }] };
  const b = { agentId: 'b', files: [{ path: 'src/api/users.js', lines: [[5, 55]] }] };
  assert.ok(collisionRisk(a, b, {}).risk > 0.5);
});
test('collisionRisk: unrelated far-apart files ⇒ low risk', () => {
  const a = { agentId: 'a', files: [{ path: 'src/api/users.js' }] };
  const b = { agentId: 'b', files: [{ path: 'docs/guide.md' }] };
  const { risk } = collisionRisk(a, b, {});
  assert.ok(risk < 0.35, `unrelated risk ${risk} should be low`);
});
test('collisionRisk: dependency edge raises risk even when tree-distant', () => {
  // a edits a deep util that b's distant file imports.
  const graph = { adjacency: { 'apps/web/page.js': ['packages/core/util.js'], 'packages/core/util.js': [] } };
  const a = { agentId: 'a', files: [{ path: 'packages/core/util.js' }] };
  const b = { agentId: 'b', files: [{ path: 'apps/web/page.js' }] };
  const coupled = collisionRisk(a, b, graph).risk;
  const uncoupled = collisionRisk(a, b, {}).risk; // same files, no graph
  assert.ok(coupled > uncoupled, `coupled ${coupled} should exceed uncoupled ${uncoupled}`);
  assert.ok(coupled > 0.3, `dependency-coupled risk ${coupled} should be elevated`);
});

// ── TCAS advisories ──
test('advise: clear when far apart', () => {
  const a = { agentId: 'a', files: [{ path: 'src/api/users.js' }] };
  const b = { agentId: 'b', files: [{ path: 'docs/guide.md' }] };
  assert.strictEqual(advise(a, b, {}).level, 'clear');
});
test('advise: resolution on same-file, lower-priority agent steers', () => {
  // a has more committed work (3 weighted files) ⇒ holds; b steers.
  const a = {
    agentId: 'lead',
    files: [
      { path: 'src/api/users.js', lines: [[1, 80]], weight: 1 },
      { path: 'src/api/posts.js', weight: 1 },
      { path: 'src/api/auth.js', weight: 1 }
    ]
  };
  const b = { agentId: 'worker', files: [{ path: 'src/api/users.js', lines: [[1, 80]], weight: 1 }] };
  const v = advise(a, b, {});
  assert.strictEqual(v.level, 'resolution', `level was ${v.level} (risk ${v.risk})`);
  assert.strictEqual(v.transmit, true);
  assert.strictEqual(v.steer, 'worker', 'lower-priority worker steers');
  assert.strictEqual(v.hold, 'lead', 'higher-priority lead holds');
});
test('advise: deterministic — same inputs give same maneuver', () => {
  const a = { agentId: 'a', files: [{ path: 'x/y.js', lines: [[1, 20]] }] };
  const b = { agentId: 'b', files: [{ path: 'x/y.js', lines: [[1, 20]] }] };
  const v1 = advise(a, b, {});
  const v2 = advise(a, b, {});
  assert.deepStrictEqual({ s: v1.steer, h: v1.hold, l: v1.level }, { s: v2.steer, h: v2.hold, l: v2.level });
});

// ── closure rate ──
test('closureRate: positive when approaching', () => {
  assert.ok(closureRate(0.2, 0.5, 1000) > 0);
  assert.ok(closureRate(0.6, 0.3, 1000) < 0);
});

// ── embedding ──
test('embedAgents: tree-close agents embed closer than far ones', () => {
  const near1 = { agentId: 'n1', files: [{ path: 'src/api/users.js' }] };
  const near2 = { agentId: 'n2', files: [{ path: 'src/api/posts.js' }] };
  const far = { agentId: 'f', files: [{ path: 'docs/guide.md' }] };
  const { positions } = embedAgents([near1, near2, far], {});
  const pos = Object.fromEntries(positions.map(p => [p.agentId, p.position]));
  const dNear = euclid(pos.n1, pos.n2);
  const dFar = euclid(pos.n1, pos.f);
  assert.ok(dNear < dFar, `near pair ${dNear} should embed closer than far ${dFar}`);
});

// ── full scan ──
test('scanAirspace: surfaces only non-clear advisories, sorted by risk', () => {
  const agents = [
    { agentId: 'a', files: [{ path: 'src/api/users.js', lines: [[1, 50]] }] },
    { agentId: 'b', files: [{ path: 'src/api/users.js', lines: [[1, 50]] }] }, // collides with a
    { agentId: 'c', files: [{ path: 'docs/guide.md' }] } // clear of everyone
  ];
  const scan = scanAirspace(agents, {});
  assert.strictEqual(scan.counts.agents, 3);
  assert.ok(scan.advisories.length >= 1, 'a/b should produce an advisory');
  assert.strictEqual(scan.advisories[0].risk, Math.max(...scan.advisories.map(x => x.risk)));
  // c is clear of both ⇒ not in advisories
  assert.ok(!scan.advisories.some(adv => adv.a === 'c' || adv.b === 'c'));
  assert.strictEqual(scan.positions.length, 3);
});

console.log(`\nResults: Passed: ${passed}, Failed: ${failed}`);
if (failed > 0) process.exit(1);
