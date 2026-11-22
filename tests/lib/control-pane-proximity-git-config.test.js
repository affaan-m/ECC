'use strict';

const assert = require('assert');
const fs = require('fs');
const os = require('os');
const path = require('path');
const { execFileSync } = require('child_process');
const { buildProximitySnapshot, sessionsToAgents } = require('../../scripts/lib/control-pane/proximity');

function git(cwd, ...args) {
  return execFileSync('git', ['-C', cwd, ...args], { encoding: 'utf8', stdio: 'pipe' });
}

function fixture(callback, { first = [5], second = [40], attributes = '' } = {}) {
  const directory = fs.mkdtempSync(path.join(os.tmpdir(), 'ecc-proximity-git-config-'));
  const repo = path.join(directory, 'repo');
  try {
    fs.mkdirSync(repo);
    git(repo, 'init', '-q', '-b', 'main');
    git(repo, 'config', 'user.name', 'proximity-test');
    git(repo, 'config', 'user.email', 'proximity-test@example.com');
    const original = Array.from({ length: 60 }, (_, index) => `const value${index + 1} = ${index + 1};`);
    fs.writeFileSync(path.join(repo, 'shared.js'), original.join('\n') + '\n');
    if (attributes) fs.writeFileSync(path.join(repo, '.gitattributes'), attributes);
    git(repo, 'add', '.');
    git(repo, 'commit', '-qm', 'base');
    const sessions = [first, second].map((lines, index) => {
      const id = `worker-${index}`;
      const worktree = path.join(directory, id);
      git(repo, 'worktree', 'add', '-q', '-b', id, worktree, 'main');
      const edited = [...original];
      for (const line of lines) edited[line - 1] = `const value${line} = '${id}';`;
      fs.writeFileSync(path.join(worktree, 'shared.js'), edited.join('\n') + '\n');
      return { id, worktree: { path: worktree, base: 'main' } };
    });
    callback({ repo, directory, sessions });
  } finally { fs.rmSync(directory, { recursive: true, force: true }); }
}

function assertDisjoint({ repo, sessions }, firstLines = [[5, 5]], secondLines = [[40, 40]]) {
  const agents = sessionsToAgents(sessions);
  assert.deepStrictEqual(agents[0].files, [{ weight: 1, path: 'shared.js', lines: firstLines }]);
  assert.deepStrictEqual(agents[1].files, [{ weight: 1, path: 'shared.js', lines: secondLines }]);
  const snapshot = buildProximitySnapshot(sessions, { repoRoot: repo, graph: { adjacency: {} } });
  assert.strictEqual(snapshot.links[0].channels.overlap, 0);
  assert.strictEqual(snapshot.links[0].level, 'clear');
  assert.deepStrictEqual(snapshot.triggers, []);
}

let passed = 0;
let failed = 0;
function test(name, callback) {
  try { callback(); console.log(`  PASS ${name}`); passed += 1; }
  catch (error) { console.log(`  FAIL ${name}\n    ${error.stack || error}`); failed += 1; }
}

test('ordinary Git output keeps disjoint working-tree edits clear', () => fixture(assertDisjoint));

for (const [key, value] of [['color.ui', 'always'], ['diff.noprefix', 'true'], ['diff.mnemonicPrefix', 'true']]) {
  test(`${key} cannot turn disjoint edits into a whole-file collision`, () => fixture(context => {
    git(context.repo, 'config', key, value);
    assertDisjoint(context);
    assert.strictEqual(git(context.repo, 'config', '--get', key).trim(), value, 'user config is unchanged');
  }));
}

test('configured inter-hunk context cannot count untouched lines as edited', () => fixture(context => {
  git(context.repo, 'config', 'diff.interHunkContext', '50');
  assertDisjoint(context, [[5, 5], [45, 45]], [[25, 25]]);
}, { first: [5, 45], second: [25] }));

for (const converter of ['external', 'textconv']) {
  test(`${converter} display helpers do not replace the source line ranges`, () => fixture(context => {
    const helper = path.join(context.directory, 'display-helper.cjs');
    const marker = path.join(context.directory, 'display-helper-ran');
    fs.writeFileSync(helper, `
const fs = require('fs');
fs.writeFileSync(${JSON.stringify(marker)}, 'ran');
${converter === 'textconv'
    ? "process.stdout.write(fs.readFileSync(process.argv.at(-1), 'utf8').replace(/\\n/g, ' ') + '\\n');"
    : "process.stdout.write('custom human-facing diff output\\n');"}
`);
    const command = `${JSON.stringify(process.execPath)} ${JSON.stringify(helper)}`;
    git(context.repo, 'config', converter === 'external' ? 'diff.external' : 'diff.ecc-test.textconv', command);
    assertDisjoint(context);
    assert.strictEqual(fs.existsSync(marker), false, 'proximity must inspect source, not run a display helper');
  }, { attributes: converter === 'textconv' ? 'shared.js diff=ecc-test\n' : '' }));
}

test('overlapping edits still produce a resolution with custom presentation settings', () => fixture(context => {
  git(context.repo, 'config', 'color.ui', 'always');
  git(context.repo, 'config', 'diff.noprefix', 'true');
  const snapshot = buildProximitySnapshot(context.sessions, { repoRoot: context.repo, graph: { adjacency: {} } });
  assert.strictEqual(snapshot.links[0].channels.overlap, 1);
  assert.strictEqual(snapshot.links[0].level, 'resolution');
  assert.strictEqual(snapshot.triggers.length, 2);
}, { first: [5], second: [5] }));

console.log(`\nResults: Passed: ${passed}, Failed: ${failed}`);
if (failed > 0) process.exitCode = 1;
