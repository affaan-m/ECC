'use strict';

const assert = require('assert');
const fs = require('fs');
const os = require('os');
const path = require('path');
const { execFileSync, spawnSync } = require('child_process');
const { buildProximitySnapshot, parseDiffRanges } = require('../../scripts/lib/control-pane/proximity');
const { overlapRisk } = require('../../scripts/lib/agent-proximity/distance');

const original = Array.from({ length: 60 }, (_, index) => `const value${index + 1} = ${index + 1};`);
const text = lines => lines.join('\n') + '\n';

function git(cwd, ...args) {
  return execFileSync('git', ['-C', cwd, ...args], { encoding: 'utf8', stdio: 'pipe' });
}

function edited({ change, remove, prefix = 0 }, name, source = original) {
  const lines = source.filter(line => !remove || line !== original[remove - 1]).map(line => (
    change && line === original[change - 1] ? `const value${change} = '${name}';` : line
  ));
  return [...Array.from({ length: prefix }, (_, index) => `// ${name} inserted ${index}`), ...lines];
}

function fixture(first, second, callback, { advanceBase = false, baseLines = original, file = 'shared.js' } = {}) {
  const directory = fs.mkdtempSync(path.join(os.tmpdir(), 'ecc-proximity-base-lines-'));
  const repo = path.join(directory, 'repo');
  try {
    fs.mkdirSync(repo);
    git(repo, 'init', '-q', '-b', 'main');
    git(repo, 'config', 'user.name', 'proximity-test');
    git(repo, 'config', 'user.email', 'proximity-test@example.com');
    fs.writeFileSync(path.join(repo, file), text(baseLines));
    git(repo, 'add', '.');
    git(repo, 'commit', '-qm', 'base');
    const baseFile = path.join(directory, 'base.js');
    fs.writeFileSync(baseFile, text(baseLines));
    const sessions = [first, second].map((edits, index) => {
      let source = baseLines;
      if (index === 1 && advanceBase) {
        source = edited({ prefix: 10 }, 'upstream', baseLines);
        fs.writeFileSync(path.join(repo, file), text(source));
        git(repo, 'commit', '-qam', 'upstream inserts lines');
      }
      const id = `worker-${index}`;
      const worktree = path.join(directory, id);
      git(repo, 'worktree', 'add', '-q', '-b', id, worktree, 'main');
      fs.writeFileSync(path.join(worktree, file), text(edited(edits, id, source)));
      return { id, worktree: { path: worktree, base: 'main' } };
    });
    const snapshot = () => buildProximitySnapshot(sessions, { repoRoot: repo, graph: { adjacency: {} } });
    const mergeStatus = () => spawnSync('git', ['merge-file', '-p',
      path.join(sessions[0].worktree.path, file), baseFile,
      path.join(sessions[1].worktree.path, file)], { encoding: 'utf8' }).status;
    callback({ sessions, snapshot, mergeStatus, file });
  } finally { fs.rmSync(directory, { recursive: true, force: true }); }
}

let passed = 0;
let failed = 0;
function test(name, callback) {
  try { callback(); console.log(`  PASS ${name}`); passed += 1; }
  catch (error) { console.log(`  FAIL ${name}\n    ${error.stack || error}`); failed += 1; }
}

test('an insertion cannot hide two agents changing the same original line', () => {
  fixture({ prefix: 20, change: 40 }, { change: 40 }, ({ snapshot, mergeStatus }) => {
    assert.strictEqual(mergeStatus(), 1, 'the independent Git merge oracle sees conflicting edits');
    const result = snapshot();
    assert.strictEqual(result.links[0].channels.overlap, 1);
    assert.strictEqual(result.links[0].level, 'resolution');
  });
});

test('shifted line numbers cannot make distinct original edits overlap', () => {
  fixture({ prefix: 20, change: 20 }, { change: 40 }, ({ snapshot, mergeStatus }) => {
    assert.strictEqual(mergeStatus(), 0, 'Git merges these disjoint changes cleanly');
    const result = snapshot();
    assert.strictEqual(result.links[0].channels.overlap, 0);
    assert.strictEqual(result.links[0].level, 'clear');
  });
});

test('a line deletion keeps its precise base range instead of claiming the whole file', () => {
  fixture({ remove: 5 }, { change: 40 }, ({ snapshot, mergeStatus }) => {
    assert.strictEqual(mergeStatus(), 0);
    const result = snapshot();
    assert.strictEqual(result.links[0].channels.overlap, 0);
    assert.strictEqual(result.links[0].level, 'clear');
  });
});

test('deleting a line another agent edits still reports an overlap', () => {
  fixture({ remove: 40 }, { change: 40 }, ({ snapshot, mergeStatus }) => {
    assert.strictEqual(mergeStatus(), 1);
    assert.strictEqual(snapshot().links[0].channels.overlap, 1);
  });
});

test('concurrent insertions at the same base position retain overlap', () => {
  fixture({ prefix: 20 }, { prefix: 2 }, ({ snapshot, mergeStatus }) => {
    assert.strictEqual(mergeStatus(), 1);
    assert.strictEqual(snapshot().links[0].channels.overlap, 1);
  });
});

test('different merge-base revisions do not claim precise disjointness', () => {
  fixture({ change: 40 }, { change: 40 }, ({ snapshot, mergeStatus }) => {
    assert.strictEqual(mergeStatus(), 1);
    const result = snapshot();
    assert.strictEqual(result.links[0].channels.overlap, 1);
    assert.strictEqual(result.links[0].level, 'resolution');
  }, { advanceBase: true });
});

test('deleted SQL comments cannot hide a later conflicting hunk', () => {
  const baseLines = original.map((_, index) => index === 3 ? '-- original SQL comment' : `SELECT ${index + 1};`);
  fixture({}, {}, ({ sessions, snapshot, mergeStatus, file }) => {
    sessions.forEach((session, index) => {
      const lines = [...baseLines];
      if (index === 0) {
        lines[0] = 'SELECT 100;';
        lines[3] = '-- changed SQL comment';
      }
      lines[39] = `SELECT '${session.id}';`;
      fs.writeFileSync(path.join(session.worktree.path, file), text(lines));
    });
    assert.strictEqual(mergeStatus(), 1);
    assert.strictEqual(snapshot().links[0].channels.overlap, 1);
    const diff = git(sessions[0].worktree.path, 'diff', '--unified=0', 'main', '--');
    for (const side of ['new', 'base']) {
      assert.deepStrictEqual([...parseDiffRanges(diff, { side })], [[file, [[1, 1], [4, 4], [40, 40]]]]);
    }
  }, { baseLines, file: 'shared.sql' });
});

test('added plus-prefixed content cannot invent a file header in either parsing mode', () => {
  fixture({ change: 40 }, { change: 40 }, ({ sessions, snapshot, mergeStatus, file }) => {
    const filename = path.join(sessions[0].worktree.path, file);
    const lines = fs.readFileSync(filename, 'utf8').trimEnd().split('\n');
    lines[0] = '// first edit';
    lines[3] = '++ b/phantom.js';
    fs.writeFileSync(filename, text(lines));
    assert.strictEqual(mergeStatus(), 1);
    assert.strictEqual(snapshot().links[0].channels.overlap, 1);
    const diff = git(sessions[0].worktree.path, 'diff', '--unified=0', 'main', '--');
    assert.deepStrictEqual([...parseDiffRanges(diff)], [[file, [[1, 1], [4, 4], [40, 40]]]]);
    assert.deepStrictEqual([...parseDiffRanges(diff, { side: 'base' })], [[file, [[1, 1], [4, 4], [40, 40]]]]);
  });
});

test('base-side parsing preserves the public new-side default and whole-file paths', () => {
  const diff = [
    'diff --git a/shared.js b/shared.js',
    '--- a/shared.js',
    '+++ b/shared.js',
    '@@ -0,0 +1,20 @@',
    '@@ -40 +60 @@',
    'diff --git a/old.js b/renamed.js',
    '--- a/old.js',
    '+++ b/renamed.js',
    '@@ -5 +5 @@',
    'diff --git a/new.js b/new.js',
    '--- /dev/null',
    '+++ b/new.js',
    '@@ -0,0 +1 @@',
    'diff --git a/deleted.js b/deleted.js',
    '--- a/deleted.js',
    '+++ /dev/null',
    '@@ -1,5 +0,0 @@'
  ].join('\n');
  assert.deepStrictEqual(parseDiffRanges(diff).get('shared.js'), [[1, 20], [60, 60]]);
  const ranges = parseDiffRanges(diff, { side: 'base' });
  assert.deepStrictEqual(ranges.get('shared.js'), [[0, 0], [40, 40]]);
  assert.deepStrictEqual(ranges.get('renamed.js'), []);
  assert.deepStrictEqual(ranges.get('new.js'), []);
  assert.strictEqual(ranges.has('deleted.js'), false, 'the filename probe supplies whole-file deletions');
});

test('unversioned callers keep comparable ranges; mixed references stay conservative', () => {
  const first = { files: [{ path: 'shared.js', lines: [[5, 5]], weight: 0.5 }] };
  const second = { files: [{ path: 'shared.js', lines: [[40, 40]], weight: 0.5 }] };
  assert.strictEqual(overlapRisk(first, second), 0);
  assert.strictEqual(overlapRisk({ ...first, baseRevision: 'same' }, { ...second, baseRevision: 'same' }), 0);
  assert.strictEqual(overlapRisk({ ...first, baseRevision: 'same' }, second), 0.25);
  assert.strictEqual(overlapRisk(first, { ...second, baseRevision: 'same' }), 0.25);
  assert.strictEqual(overlapRisk({ ...first, baseRevision: 'old' }, { ...second, baseRevision: 'new' }), 0.25);
  assert.strictEqual(overlapRisk({ ...first, baseRevision: 'old' }, {
    baseRevision: 'new', files: [{ path: 'other.js', lines: [[5, 5]] }]
  }), 0);
});

console.log(`\nResults: Passed: ${passed}, Failed: ${failed}`);
if (failed > 0) process.exitCode = 1;
