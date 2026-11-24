'use strict';

const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { spawnSync } = require('node:child_process');
const { test } = require('node:test');
const { treeRisk, treeDistance, collisionRisk } = require('../../scripts/lib/agent-proximity/distance');

function reference(a, b) {
  let distance = 1;
  for (const left of a.files || []) {
    for (const right of b.files || []) distance = Math.min(distance, treeDistance(left.path, right.path));
  }
  return 1 - distance;
}

function observedAgent(count, branch) {
  let reads = 0;
  const files = Array.from({ length: count }, (_, index) => ({
    get path() { reads++; return `src/shared/${branch}/feature-${index}/file.js`; }
  }));
  return { files, reads: () => reads };
}

for (const [left, right] of [[64, 64], [8, 256], [256, 8]]) {
  test(`tree proximity reads each path a bounded number of times for ${left} by ${right} files`, () => {
    const a = observedAgent(left, 'left');
    const b = observedAgent(right, 'right');
    assert.equal(treeRisk(a, b), 1 - 6 / 10);
    const reads = a.reads() + b.reads();
    assert.ok(reads <= 2 * (left + right), `${reads} path reads for ${left + right} files`);
  });
}

test('empty working sets retain zero risk without reading the other set', () => {
  const a = observedAgent(10, 'left');
  assert.equal(treeRisk(a, {}), 0);
  assert.equal(treeRisk({}, a), 0);
  assert.equal(a.reads(), 0);
});

test('normalization, root segments, duplicates and prefix paths retain exact scores', () => {
  const cases = [
    ['', '/', './', null, undefined, 0],
    ['src/a.js', 'src/a.js', 'src', 'src/a.js/'],
    ['src\\dir\\a.js', './src/dir/b.js', 'src//dir/c.js'],
    ['/src/dir/a.js', 'src/dir/a.js', 'other/deep/path/index.js'],
    ['__proto__/constructor/file', '__proto__/prototype/file', 'toString/value'],
    ['src/组件/猫.js', 'src/组件/狗.js', 'src/other/\u{1f600}.js'],
    ['root/one', 'root/one/two/three/four', 'root/another/short'],
    ['a', 'a/b', 'a/b/c', 'a/b/c/d', 'a/x/y/z']
  ].map(paths => ({ files: paths.map(path => ({ path })) }));
  for (const a of cases) {
    for (const b of cases) {
      assert.equal(treeRisk(a, b), reference(a, b));
      assert.equal(treeRisk(b, a), reference(a, b));
    }
  }
});

test('the shortest path sharing a prefix matters, including a shorter shallower candidate', () => {
  for (let depth = 1; depth <= 20; depth++) {
    const a = { files: [{ path: 'root/' + Array(depth).fill('segment').join('/') }] };
    const b = { files: [
      { path: 'root/short' },
      { path: 'root/' + Array(depth + 2).fill('segment').join('/') + '/different' },
      { path: 'root/segment' }
    ] };
    assert.equal(treeRisk(a, b), reference(a, b));
    assert.equal(treeRisk(a, { files: [...b.files].reverse() }), reference(a, b));
  }
});

test('seeded mixed working sets preserve the pairwise formula without rounding changes', () => {
  let state = 123456789;
  const random = max => {
    state = (Math.imul(state, 1664525) + 1013904223) >>> 0;
    return state % max;
  };
  const words = ['src', 'shared', 'api', 'web', 'lib', '组件', '__proto__', 'a.js'];
  const agent = () => ({ files: Array.from({ length: random(18) }, () => ({
    path: Array.from({ length: random(12) }, () => words[random(words.length)]).join(random(2) ? '/' : '\\')
  })) });
  for (let index = 0; index < 500; index++) {
    const a = agent();
    const b = agent();
    assert.equal(treeRisk(a, b), reference(a, b), `case ${index}`);
    assert.equal(collisionRisk(a, b, {}).channels.tree, reference(a, b), `collision case ${index}`);
  }
});

test('scoring does not mutate caller file lists or records', () => {
  const a = Object.freeze({ files: Object.freeze([Object.freeze({ path: 'src/a.js' }), Object.freeze({ path: 'src/dir/b.js' })]) });
  const b = Object.freeze({ files: Object.freeze([Object.freeze({ path: 'src/dir/c.js' })]) });
  assert.equal(treeRisk(a, b), reference(a, b));
});

test('public coordination inventory bounds path splitting for a multi-worker manifest', t => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'ecc-tree-proximity-'));
  t.after(() => fs.rmSync(root, { recursive: true, force: true }));
  const manifest = { version: 1, repositories: [{ id: 'app', sources: {} }], tasks: Array.from({ length: 8 }, (_, worker) => ({
    id: `worker-${worker}`, repoId: 'app', paths: Array.from({ length: 32 }, (_, file) => `src/shared/tree-work/worker-${worker}/file-${file}.js`)
  })) };
  const input = path.join(root, 'manifest.json');
  const preload = path.join(root, 'observe.cjs');
  const observation = path.join(root, 'observation.json');
  fs.writeFileSync(input, JSON.stringify(manifest));
  fs.writeFileSync(preload, `const fs = require('node:fs');
const split = String.prototype.split;
let count = 0;
String.prototype.split = function (...args) {
  if (args[0] === '/' && String(this).startsWith('src/shared/tree-work/')) count++;
  return Reflect.apply(split, this, args);
};
process.on('exit', () => fs.writeFileSync(process.env.ECC_TREE_OBSERVATION, JSON.stringify({ count })));
`);
  const child = spawnSync(process.execPath, ['--require', preload,
    path.resolve(__dirname, '../../scripts/coordination-inventory.js'), '--manifest', input, '--now', '2026-11-24T00:00:00.000Z'], {
    cwd: root, encoding: 'utf8', timeout: 15000, env: { ...process.env, ECC_TREE_OBSERVATION: observation }
  });
  assert.ifError(child.error);
  assert.equal(child.status, 0, child.stderr);
  const report = JSON.parse(child.stdout);
  assert.equal(report.tasks.length, 8);
  assert.deepEqual(report.warnings, []);
  assert.equal(report.observedAt, '2026-11-24T00:00:00.000Z');
  const { count } = JSON.parse(fs.readFileSync(observation, 'utf8'));
  assert.ok(count <= 8 * 32 * 12, `${count} path splits for 256 declared paths`);
});
