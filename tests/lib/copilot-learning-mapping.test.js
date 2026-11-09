'use strict';
const assert = require('assert');
const fs = require('fs');
const os = require('os');
const path = require('path');
const crypto = require('crypto');
const { spawnSync } = require('child_process');
const entry = path.resolve(__dirname, '../../scripts/copilot-learning.py');
let passed = 0;
let failed = 0;
function test(name, action) {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'ecc-learning-map-'));
  const project = path.join(root, 'project'); fs.mkdirSync(project);
  const config = path.join(root, 'private');
  const env = { ...process.env, HOME: root, USERPROFILE: root, COPILOT_HOME: config };
  const invoke = (args, cwd = project) => {
    const result = spawnSync(process.env.PYTHON || 'python3', [entry, 'identity', ...args], {
      cwd, env, encoding: 'utf8', timeout: 20000,
    });
    assert.ifError(result.error);
    return { ...result, output: JSON.parse(result.stdout) };
  };
  const git = (args, cwd = project) => {
    const result = spawnSync('git', ['-c', `core.hooksPath=${path.join(root, 'disabled-hooks')}`, '-c', 'commit.gpgsign=false',
      '-c', 'user.name=Fixture', '-c', 'user.email=fixture@example.invalid', ...args], {
      cwd, env, encoding: 'utf8', timeout: 10000,
    });
    assert.ifError(result.error); assert.strictEqual(result.status, 0, result.stderr);
    return result.stdout.trim();
  };
  try { action({ root, project, config, env, invoke, git }); passed++; console.log(`PASS ${name}`); }
  catch (error) { failed++; console.error(`FAIL ${name}: ${error.stack}`); }
  finally { fs.rmSync(root, { recursive: true, force: true }); }
}
test('non-git preview is read-only; apply writes one immutable explicit mapping', ({ project, config, invoke }) => {
  const preview = invoke([]); assert.strictEqual(preview.status, 0, preview.stdout);
  assert.strictEqual(preview.output.applied, false);
  assert.strictEqual(fs.existsSync(config), false);
  const expected = crypto.createHash('sha256').update(fs.realpathSync(project)).digest('hex');
  const mapping = preview.output.mapping;
  assert.strictEqual(mapping.schema, 'ecc.copilot.learning-mapping.v1');
  assert.strictEqual(mapping.observationProjectId, expected);
  assert.match(mapping.learningProjectId, /^[a-f0-9]{12}$/);
  const applied = invoke(['--apply']); assert.strictEqual(applied.status, 0, applied.stdout);
  assert.deepStrictEqual(applied.output.mapping, mapping);
  const file = path.join(config, 'ecc/learning-mappings', `${expected}.json`);
  const before = fs.readFileSync(file, 'utf8');
  assert.deepStrictEqual(JSON.parse(before), mapping);
  assert.strictEqual(invoke(['--apply']).status, 0);
  assert.strictEqual(fs.readFileSync(file, 'utf8'), before);
  assert.ok(!fs.existsSync(path.join(config, 'ecc/projects')), 'mapping must not collide with checkpoint scanner');
});
test('canonical remote normalization shares learning identity but preserves separate observation roots', ({ root, invoke, git }) => {
  git(['init']); git(['remote', 'add', 'origin', 'https://github.com/Example/Project.git']);
  const first = invoke(['--apply']); assert.strictEqual(first.status, 0, first.stdout);
  const other = path.join(root, 'other'); fs.mkdirSync(other);
  git(['init'], other); git(['remote', 'add', 'origin', 'git@github.com:Example/Project.git'], other);
  const second = invoke(['--apply'], other); assert.strictEqual(second.status, 0, second.stdout);
  assert.strictEqual(first.output.mapping.learningProjectId, second.output.mapping.learningProjectId);
  assert.notStrictEqual(first.output.mapping.observationProjectId, second.output.mapping.observationProjectId);
  git(['remote', 'set-url', 'origin', 'https://github.com/Example/Different.git']);
  const rejected = invoke(['--apply']); assert.notStrictEqual(rejected.status, 0);
  assert.strictEqual(rejected.output.ok, false);
});
test('canonical worktree identity is reused without changing observation workspace hashes', ({ root, project, invoke, git }) => {
  git(['init']); fs.writeFileSync(path.join(project, 'a.txt'), 'fixture');
  git(['add', 'a.txt']); git(['commit', '-m', 'fixture']);
  const worktree = path.join(root, 'worktree'); git(['worktree', 'add', '-b', 'fixture-worktree', worktree]);
  const first = invoke(['--apply']); const second = invoke(['--apply'], worktree);
  assert.strictEqual(first.status, 0, first.stdout); assert.strictEqual(second.status, 0, second.stdout);
  assert.strictEqual(first.output.mapping.learningProjectId, second.output.mapping.learningProjectId);
  assert.notStrictEqual(first.output.mapping.observationProjectId, second.output.mapping.observationProjectId);
});
test('malformed future extra-field and linked mapping records fail without rewrite', ({ config, invoke }) => {
  const result = invoke(['--apply']); assert.strictEqual(result.status, 0, result.stdout);
  const mapping = result.output.mapping;
  const file = path.join(config, 'ecc/learning-mappings', `${mapping.observationProjectId}.json`);
  for (const data of ['{broken', JSON.stringify({ ...mapping, schema: 'future' }), JSON.stringify({ ...mapping, raw: 'untrusted' })]) {
    fs.writeFileSync(file, data);
    assert.notStrictEqual(invoke(['--apply']).status, 0);
    assert.strictEqual(fs.readFileSync(file, 'utf8'), data);
  }
  fs.writeFileSync(file, JSON.stringify(mapping));
  fs.linkSync(file, file + '.linked');
  assert.notStrictEqual(invoke(['--apply']).status, 0);
});
test('canonical legacy identity migration preserves existing records rather than rehashing them independently', ({ config, invoke, git }) => {
  const remote = 'https://github.com/Example/Legacy.git';
  git(['init']); git(['remote', 'add', 'origin', remote]);
  const expected = invoke([]).output.mapping.learningProjectId;
  const legacy = crypto.createHash('sha256').update(remote).digest('hex').slice(0, 12);
  assert.notStrictEqual(legacy, expected);
  const projects = path.join(config, 'ecc/homunculus/projects');
  const legacyRecords = path.join(projects, legacy, 'instincts/personal');
  fs.mkdirSync(legacyRecords, { recursive: true });
  fs.writeFileSync(path.join(legacyRecords, 'kept.yaml'), '---\nid: kept\n---\nReviewed record.\n');
  const applied = invoke(['--apply']); assert.strictEqual(applied.status, 0, applied.stdout);
  assert.strictEqual(applied.output.mapping.learningProjectId, expected);
  assert.strictEqual(fs.readFileSync(path.join(projects, expected, 'instincts/personal/kept.yaml'), 'utf8'), '---\nid: kept\n---\nReviewed record.\n');
});
test('mapping directory links and existing learning writer locks are rejected without replacing mappings', ({ root, config, invoke }) => {
  const result = invoke(['--apply']); assert.strictEqual(result.status, 0, result.stdout);
  const directory = path.join(config, 'ecc/learning-mappings');
  const file = path.join(directory, `${result.output.mapping.observationProjectId}.json`);
  const before = fs.readFileSync(file, 'utf8');
  const lock = path.join(config, 'ecc/.learning.lock'); fs.mkdirSync(lock);
  assert.notStrictEqual(invoke(['--apply']).status, 0); assert.strictEqual(fs.readFileSync(file, 'utf8'), before);
  fs.rmdirSync(lock);
  const outside = path.join(root, 'outside'); fs.renameSync(directory, outside);
  fs.symlinkSync(outside, directory, process.platform === 'win32' ? 'junction' : 'dir');
  assert.notStrictEqual(invoke([]).status, 0);
  assert.strictEqual(fs.readFileSync(path.join(outside, path.basename(file)), 'utf8'), before);
});
console.log(`Passed: ${passed}, Failed: ${failed}`);
process.exitCode = failed ? 1 : 0;
