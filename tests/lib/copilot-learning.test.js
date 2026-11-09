'use strict';
const assert = require('assert');
const fs = require('fs');
const os = require('os');
const path = require('path');
const { spawnSync } = require('child_process');
const repo = path.resolve(__dirname, '../..');
let passed = 0;
let failed = 0;
const fixture = ['one', 'two', 'three'].map(id => `---\nid: ${id}\ntrigger: when testing new components\nconfidence: 0.9\ndomain: workflow\n---\n## Action\nUse focused tests for ${id}.\n`).join('\n');
function test(name, action) {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'ecc-copilot-learning-'));
  const project = path.join(root, 'workspace'); fs.mkdirSync(project);
  const env = { ...process.env, HOME: root, USERPROFILE: root, COPILOT_HOME: path.join(root, 'copilot'), CLAUDE_PROJECT_DIR: '/foreign', CLV2_HOMUNCULUS_DIR: path.join(root, 'foreign') };
  const invoke = (args, input = '', entry = path.join(repo, 'scripts/copilot-learning.py')) => {
    const result = spawnSync(process.env.PYTHON || 'python3', [entry, ...args], { cwd: project, env, input, encoding: 'utf8', timeout: 20000 });
    assert.ifError(result.error);
    return { ...result, output: JSON.parse(result.stdout) };
  };
  try { action({ root, project, env, invoke }); passed++; console.log(`  PASS ${name}`); }
  catch (error) { failed++; console.error(`  FAIL ${name}: ${error.stack}`); }
  finally { fs.rmSync(root, { recursive: true, force: true }); }
}
test('all seven workflows expose an actual managed runtime', () => {
  const helper = require('../../scripts/lib/install/copilot-learning');
  assert.strictEqual(helper.LEARNING_COMMANDS.length, 7);
  assert.ok(helper.RUNTIME_PATHS.includes('scripts/copilot-learning.py'));
  assert.ok(helper.RUNTIME_PATHS.includes('skills/continuous-learning-v2/scripts/instinct-cli.py'));
  for (const name of helper.LEARNING_COMMANDS) assert.match(helper.getNativeBody(name), /copilot-learning\.py/);
  assert.strictEqual(helper.getNativeBody('unknown'), undefined);
});
test('import previews then applies to isolated Copilot store, status/export/projects work', ({ root, project, invoke }) => {
  assert.strictEqual(invoke(['import', '--stdin'], fixture).status, 0);
  const empty = invoke(['status']); assert.strictEqual(empty.status, 0);
  assert.doesNotMatch(empty.output.output, /one \[/);
  const imported = invoke(['import', '--stdin', '--apply'], fixture);
  assert.strictEqual(imported.status, 0, imported.stdout);
  assert.match(imported.output.output, /Import complete/);
  assert.match(invoke(['status']).output.output, /one/);
  assert.match(invoke(['export', '--scope', 'project']).output.output, /id: two/);
  assert.strictEqual(invoke(['export', '--scope', 'project', '--output', 'instincts.yaml']).status, 0);
  assert.match(fs.readFileSync(path.join(project, 'instincts.yaml'), 'utf8'), /id: three/);
  assert.notStrictEqual(invoke(['export', '--output', 'instincts.yaml']).status, 0, 'export cannot silently overwrite');
  assert.match(invoke(['projects']).output.output, /workspace/);
  assert.ok(!fs.existsSync(path.join(root, 'foreign')));
  assert.ok(!fs.existsSync(path.join(root, '.claude')));
});
test('evolution generates review-only candidates; promotion and pruning require apply', ({ root, invoke }) => {
  invoke(['import', '--stdin', '--apply'], fixture);
  const evolved = invoke(['evolve', '--generate', '--limit', '1', '--apply']);
  assert.strictEqual(evolved.status, 0, evolved.stdout);
  assert.match(evolved.output.output, /Generated/);
  const home = path.join(root, 'copilot/ecc/homunculus');
  const projects = path.join(home, 'projects');
  const pid = fs.readdirSync(projects)[0];
  assert.ok(fs.readdirSync(path.join(projects, pid, 'evolved/skills')).length > 0);
  assert.strictEqual(invoke(['promote', 'one']).status, 0);
  assert.ok(!fs.existsSync(path.join(home, 'instincts/personal/one.yaml')));
  assert.strictEqual(invoke(['promote', 'one', '--apply']).status, 0);
  assert.ok(fs.existsSync(path.join(home, 'instincts/personal/one.yaml')));
  const pending = path.join(projects, pid, 'instincts/pending'); fs.mkdirSync(pending);
  const old = path.join(pending, 'old.yaml'); fs.writeFileSync(old, '---\nid: old\ncreated: 2020-01-01\n---\nOld candidate.');
  assert.strictEqual(invoke(['prune']).status, 0); assert.ok(fs.existsSync(old));
  assert.strictEqual(invoke(['prune', '--apply']).status, 0); assert.ok(!fs.existsSync(old));
});
test('runtime works from copied installed closure without repository node dependencies', ({ project, invoke }) => {
  const helper = require('../../scripts/lib/install/copilot-learning');
  for (const relative of helper.RUNTIME_PATHS) {
    const target = path.join(project, '.github/ecc', relative);
    fs.mkdirSync(path.dirname(target), { recursive: true }); fs.copyFileSync(path.join(repo, relative), target);
  }
  const entry = path.join(project, '.github/ecc/scripts/copilot-learning.py');
  assert.strictEqual(invoke(['import', '--stdin', '--apply'], fixture, entry).status, 0);
  assert.match(invoke(['status'], '', entry).output.output, /one/);
});
test('malformed, secret-bearing and unsafe identities are rejected before import', ({ root, invoke }) => {
  for (const value of ['{invalid}', fixture.replace('id: one', 'id: ../escape'), fixture.replace('id: one', 'id: con'), fixture + '\npassword=private', 'x'.repeat(262145)]) {
    const result = invoke(['import', '--stdin', '--apply'], value);
    assert.notStrictEqual(result.status, 0, value.slice(0, 60));
    assert.ok(!result.stdout.includes('password=private'));
  }
  assert.notStrictEqual(invoke(['import', 'https://example.test/instincts.yaml', '--apply']).status, 0);
  assert.ok(!fs.existsSync(path.join(root, 'escape')));
});
test('static symlink directories and hardlinks cannot redirect learning storage', ({ root, invoke }) => {
  const config = path.join(root, 'copilot'); fs.mkdirSync(config);
  const outside = path.join(root, 'outside'); fs.mkdirSync(outside);
  fs.symlinkSync(outside, path.join(config, 'ecc'));
  assert.notStrictEqual(invoke(['status']).status, 0); assert.deepStrictEqual(fs.readdirSync(outside), []);
  fs.unlinkSync(path.join(config, 'ecc'));
  invoke(['import', '--stdin', '--apply'], fixture);
  const file = path.join(config, 'ecc/homunculus/projects.json');
  fs.linkSync(file, path.join(root, 'linked-registry'));
  assert.notStrictEqual(invoke(['status']).status, 0);
});
console.log(`\nPassed: ${passed}, Failed: ${failed}`);
process.exitCode = failed ? 1 : 0;
