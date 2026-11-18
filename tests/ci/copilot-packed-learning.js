'use strict';

const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { pathToFileURL } = require('node:url');
const { spawnSync } = require('node:child_process');
const {
  parseEnvironment,
  assertDownloadedArtifact,
  hashFile,
  assertHash,
  createLifecycleEnvironment,
} = require('./packed-artifact-lifecycle');

function run(command, args, { cwd, env, input, status = 0 }) {
  const result = spawnSync(command, args, { cwd, env, input, encoding: 'utf8', timeout: 120000 });
  assert.ifError(result.error);
  assert.equal(result.status, status, `${command} ${args[0]}\n${result.stderr}\n${result.stdout}`);
  return result.stdout;
}

function installPackage(project, env, artifact) {
  fs.writeFileSync(path.join(project, 'package.json'), JSON.stringify({
    name: 'copilot-packed-learning-fixture',
    version: '1.0.0',
    private: true,
    dependencies: { 'ecc-universal': pathToFileURL(artifact).href },
  }));
  const options = { cwd: project, env };
  const args = ['install', '--ignore-scripts', '--no-audit', '--no-fund'];
  if (process.platform === 'win32') {
    run(env.ComSpec || 'cmd.exe', ['/d', '/s', '/c', `npm ${args.join(' ')}`], options);
  } else {
    run('npm', args, options);
  }
  return path.join(project, 'node_modules', 'ecc-universal');
}

function verifyInstalledLearning(project, packageRoot, env) {
  const python = process.env.ECC_TEST_PYTHON || (process.platform === 'win32' ? 'python' : 'python3');
  const cli = path.join(packageRoot, 'scripts', 'ecc.js');
  run(process.execPath, [cli, 'install', '--target', 'copilot', '--modules', 'workflow-quality', '--json'], { cwd: project, env });

  const github = path.join(project, '.github');
  const launcher = path.join(github, 'ecc', 'scripts', 'copilot-learning.py');
  const skill = path.join(github, 'skills', 'continuous-learning-v2', 'SKILL.md');
  assert.ok(fs.readFileSync(skill, 'utf8').includes('copilot-learning.py'), 'installed skill must use the Copilot launcher');
  assert.equal(fs.existsSync(path.join(github, 'hooks')), false);

  const invoke = (args, input, status) => JSON.parse(run(python, [launcher, ...args], {
    cwd: project, env, input, status,
  }));
  const instincts = ['verify-workflow', 'verify-fixture', 'verify-results'].map(id => [
    '---', `id: ${id}`, 'trigger: when checking workflow', 'confidence: 0.9',
    'domain: testing', '---', '## Action', 'Verify the workflow with an isolated fixture.', '',
  ].join('\n')).join('\n');
  assert.equal(invoke(['import', '--stdin'], instincts).ok, true);
  assert.doesNotMatch(invoke(['status']).output, /verify-workflow/);
  assert.equal(invoke(['import', '--stdin', '--apply'], instincts).ok, true);
  assert.match(invoke(['status']).output, /verify-workflow/);
  assert.match(invoke(['projects']).output, /clean Copilot project café/);
  assert.match(invoke(['export', '--scope', 'project']).output, /id: verify-workflow/);
  assert.equal(invoke(['export', '--output', 'reviewed.yaml']).ok, true);
  assert.equal(invoke(['export', '--output', 'reviewed.yaml'], undefined, 1).ok, false);
  assert.match(fs.readFileSync(path.join(project, 'reviewed.yaml'), 'utf8'), /id: verify-workflow/);
  assert.equal(fs.existsSync(env.CLV2_HOMUNCULUS_DIR), false);
  assert.equal(fs.existsSync(path.join(env.HOME, '.claude', 'homunculus')), false);
  const home = path.join(env.COPILOT_HOME, 'ecc', 'homunculus');
  const projects = path.join(home, 'projects');
  const [projectId] = fs.readdirSync(projects);
  assert.match(projectId, /^[a-f0-9]{12}$/);
  const learned = path.join(projects, projectId);
  const evolvedSkills = path.join(learned, 'evolved', 'skills');
  assert.equal(invoke(['evolve', '--generate']).ok, true);
  assert.deepEqual(fs.readdirSync(evolvedSkills), []);
  assert.equal(invoke(['evolve', '--generate', '--limit', '1', '--apply']).ok, true);
  assert.ok(fs.readdirSync(evolvedSkills).length > 0);

  const promoted = path.join(home, 'instincts', 'personal', 'verify-workflow.yaml');
  assert.equal(invoke(['promote', 'verify-workflow']).ok, true);
  assert.equal(fs.existsSync(promoted), false);
  assert.equal(invoke(['promote', 'verify-workflow', '--apply']).ok, true);
  assert.equal(fs.existsSync(promoted), true);

  const pending = path.join(learned, 'instincts', 'pending', 'old.yaml');
  fs.mkdirSync(path.dirname(pending), { recursive: true });
  fs.writeFileSync(pending, '---\nid: old\ncreated: 2020-01-01\n---\nOld candidate.\n');
  assert.equal(invoke(['prune']).ok, true);
  assert.equal(fs.existsSync(pending), true);
  assert.equal(invoke(['prune', '--apply']).ok, true);
  assert.equal(fs.existsSync(pending), false);

  const linked = path.join(home, 'linked');
  const userDir = path.join(project, 'user directory');
  fs.mkdirSync(userDir);
  fs.symlinkSync(userDir, linked, process.platform === 'win32' ? 'junction' : 'dir');
  assert.equal(invoke(['status'], undefined, 1).ok, false);
  assert.deepEqual(fs.readdirSync(userDir), []);

  run(process.execPath, [cli, 'uninstall', '--target', 'copilot', '--json'], { cwd: project, env });
  assert.equal(fs.existsSync(launcher), false);
  assert.equal(fs.existsSync(skill), false);
  assert.equal(fs.existsSync(path.join(project, 'reviewed.yaml')), true);
  assert.equal(fs.existsSync(promoted), true);
}

function main() {
  const { packagePath, expectedSha256 } = parseEnvironment();
  assertDownloadedArtifact(packagePath, process.cwd());
  assertHash(hashFile(packagePath), expectedSha256);
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'ecc-copilot-learning-'));
  try {
    const project = path.join(root, 'clean Copilot project café');
    fs.mkdirSync(project);
    const env = {
      ...createLifecycleEnvironment(process.env, root),
      COPILOT_HOME: path.join(root, 'copilot'),
      CLV2_HOMUNCULUS_DIR: path.join(root, 'unrelated learning'),
      CLAUDE_PROJECT_DIR: path.join(root, 'unrelated project'),
    };
    verifyInstalledLearning(project, installPackage(project, env, packagePath), env);
    console.log('Packed Copilot learning verified');
  } finally {
    fs.rmSync(root, { recursive: true, force: true, maxRetries: 5, retryDelay: 100 });
  }
}

module.exports = { verifyInstalledLearning };

if (require.main === module) main();
