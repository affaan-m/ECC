'use strict';

const assert = require('node:assert/strict');
const { test } = require('node:test');
const { dependencyRisk, graphDistance } = require('../../scripts/lib/agent-proximity/distance');
const { buildProximitySnapshot } = require('../../scripts/lib/control-pane/proximity');

function pairwiseRisk(a, b, graph, decay = 0.5) {
  let risk = 0;
  for (const first of a.files || []) {
    for (const second of b.files || []) {
      const distance = Math.min(
        graphDistance(graph, first.path, second.path),
        graphDistance(graph, second.path, first.path)
      );
      if (distance === Infinity || distance === 0) continue;
      risk = Math.max(risk, (first.weight ?? 1) * (second.weight ?? 1) * Math.pow(decay, distance - 1));
    }
  }
  return Number.isFinite(risk) ? Math.max(0, Math.min(1, risk)) : 0;
}

test('dashboard dependency scoring traverses each source once across a multi-file working set', () => {
  const groups = ['first', 'second'].map(group => Array.from({ length: 32 }, (_, index) => `${group}/file-${index}.js`));
  const adjacency = Object.fromEntries(groups.flatMap(files => files.map(file => [file, files.filter(other => other !== file)])));
  let reads = 0;
  const graph = { adjacency: new Proxy(adjacency, {
    get(target, name) {
      reads += 1;
      return Reflect.get(target, name);
    },
  }) };
  const sessions = groups.map((_, index) => ({ id: String(index), task: `Task ${index}` }));
  const snapshot = buildProximitySnapshot(sessions, {
    graph,
    workingSetFor: session => groups[Number(session.id)].map(path => ({ path })),
  });

  assert.strictEqual(snapshot.links.length, 1);
  assert.strictEqual(snapshot.links[0].channels.dependency, 0);
  assert.deepStrictEqual(snapshot.advisories, []);
  assert.ok(reads <= 2200, `expected source-level traversals, observed ${reads} adjacency reads`);
});

test('cached searches retain directed reachability, six-hop limits, weights, and normalized paths', () => {
  const adjacency = Object.fromEntries(Array.from({ length: 9 }, (_, index) => [
    `src/${index}.js`, index < 8 ? [`src/${index + 1}.js`] : [],
  ]));
  adjacency['src/4.js'].push('./src/1.js');
  const graph = { adjacency };
  const fixtures = [
    [{ files: [{ path: './src/0.js' }, { path: 'src\\0.js', weight: 0.25 }] }, { files: [{ path: 'src/6.js' }, { path: 'src/7.js' }] }],
    [{ files: [{ path: 'src/6.js', weight: 0.4 }, { path: 'src/8.js' }] }, { files: [{ path: 'src/0.js' }, { path: 'src/1.js', weight: 0.8 }] }],
    [{ files: [{ path: 'src/4.js' }, { path: 'missing.js' }] }, { files: [{ path: 'src/4.js' }, { path: 'src/8.js', weight: 0 }] }],
    [{ files: [{ path: 'src/0.js', weight: NaN }, { path: 'src/1.js' }] }, { files: [{ path: 'src/2.js' }, { path: 'src/8.js' }] }],
    [{ files: [] }, { files: [{ path: 'src/1.js' }, { path: 'src/8.js' }] }],
  ];
  for (const [a, b] of fixtures) {
    for (const decay of [0, 0.25, 0.5, 1]) {
      assert.strictEqual(dependencyRisk(a, b, graph, { depDecay: decay }), pairwiseRisk(a, b, graph, decay));
    }
  }
  assert.strictEqual(dependencyRisk(fixtures[0][0], fixtures[0][1], graph), Math.pow(0.5, 5));
});

test('singleton searches and later snapshots observe current dependency data', () => {
  const graph = { adjacency: { 'a.js': [], 'b.js': [], 'c.js': [] } };
  const a = { files: [{ path: 'a.js' }] };
  const b = { files: [{ path: 'b.js' }, { path: 'c.js' }] };
  assert.strictEqual(dependencyRisk(a, b, graph), 0);
  graph.adjacency['c.js'].push('a.js');
  assert.strictEqual(dependencyRisk(a, b, graph), 1);
  graph.adjacency['c.js'].length = 0;
  assert.strictEqual(dependencyRisk(a, b, graph), 0);

  let reads = 0;
  const counted = { adjacency: new Proxy({ 'a.js': ['b.js'], 'b.js': [] }, {
    get(target, key) { reads += 1; return Reflect.get(target, key); },
  }) };
  assert.strictEqual(dependencyRisk(a, { files: [{ path: 'b.js' }] }, counted), 1);
  assert.strictEqual(reads, 2);
});

test('multi-target scoring equals independent pairwise searches on deterministic graphs', () => {
  let state = 78391;
  const random = () => {
    state = (Math.imul(state, 1664525) + 1013904223) >>> 0;
    return state / 0x100000000;
  };
  for (let sample = 0; sample < 160; sample += 1) {
    const names = Array.from({ length: 18 }, (_, index) => `module/${index}.js`);
    const graph = { adjacency: Object.fromEntries(names.map(name => [
      name, names.filter(() => random() < 0.08),
    ])) };
    const workingSet = () => ({ files: Array.from({ length: 1 + Math.floor(random() * 9) }, () => ({
      path: names[Math.floor(random() * names.length)],
      weight: Math.floor(random() * 5) / 4,
    })) });
    const a = workingSet();
    const b = workingSet();
    const decay = random();
    assert.strictEqual(dependencyRisk(a, b, graph, { depDecay: decay }), pairwiseRisk(a, b, graph, decay), `sample ${sample}`);
  }
});
