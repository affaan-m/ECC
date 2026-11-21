'use strict';

const assert = require('node:assert/strict');
const { spawnSync } = require('node:child_process');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { pathToFileURL } = require('node:url');
const {
  assertDownloadedArtifact,
  assertHash,
  createLifecycleEnvironment,
  hashFile,
  parseEnvironment,
} = require('./packed-artifact-lifecycle');

const launcher = '.github/ecc/scripts/memory/copilot-memory.cjs';
const skill = '.github/skills/unified-memory/SKILL.md';

function run(command, args, cwd, env, { input, status = 0 } = {}) {
  const result = spawnSync(command, args, { cwd, env, input, encoding: 'utf8', timeout: 120000 });
  assert.ifError(result.error);
  assert.equal(result.status, status, `${command} ${args[0]}\n${result.stderr}\n${result.stdout}`);
  return result;
}

function installPackage(project, env, artifact) {
  fs.writeFileSync(path.join(project, 'package.json'), JSON.stringify({
    name: 'copilot-packed-memory-fixture',
    version: '1.0.0',
    private: true,
    dependencies: { 'ecc-universal': pathToFileURL(artifact).href },
  }));
  const args = ['install', '--ignore-scripts', '--no-audit', '--no-fund'];
  if (process.platform === 'win32') {
    run(env.ComSpec || 'cmd.exe', ['/d', '/s', '/c', `npm ${args.join(' ')}`], project, env);
  } else {
    run('npm', args, project, env);
  }
  return path.join(project, 'node_modules', 'ecc-universal');
}

function verifyInstalledMemory(root, packageRoot, env) {
  const workspace = path.join(root, 'Memory project café');
  const foreign = path.join(root, 'Another project');
  for (const dir of [workspace, foreign]) fs.mkdirSync(path.join(dir, '.git'), { recursive: true });
  const manifest = path.join(workspace, 'package.json');
  const manifestContent = '{"type":"module","private":true}\n';
  fs.writeFileSync(manifest, manifestContent);

  const canonical = path.join(packageRoot, 'scripts', 'memory.js');
  const seed = (cwd, scope, target, title, body, extras = []) => JSON.parse(run(process.execPath,
    [canonical, 'save', '--title', title, '--scope', scope, '--target', target, '--stdin', '--json', ...extras],
    cwd, env, { input: body }).stdout).memory.id;
  const projectId = seed(workspace, 'project', 'copilot', 'Review fixture', 'Workspace body');
  const teamId = seed(workspace, 'team', 'all', 'Review team', 'Team body', ['--link', projectId]);
  const recipientId = seed(workspace, 'project', 'codex', 'Review another recipient', 'Recipient body protected',
    ['--link', projectId]);
  const userId = seed(workspace, 'user', 'copilot', 'Review private user', 'User body protected');
  const foreignId = seed(foreign, 'team', 'copilot', 'Review different workspace', 'Foreign body protected');

  const canonicalDoctor = JSON.parse(run(process.execPath, [canonical, 'doctor', '--scope', 'project', '--scope', 'team',
    '--target-harness', 'copilot', '--json'], workspace, env).stdout);
  assert.equal(canonicalDoctor.memoryCount, 2, 'canonical doctor filters the recipient');

  const cli = path.join(packageRoot, 'scripts', 'ecc.js');
  run(process.execPath, [cli, 'install', '--target', 'copilot', '--skills', 'unified-memory', '--json'], workspace, env);
  assert.ok(fs.readFileSync(path.join(workspace, skill), 'utf8').includes(launcher));
  assert.equal(fs.readFileSync(manifest, 'utf8'), manifestContent);
  assert.equal(fs.existsSync(path.join(workspace, '.github/ecc/scripts/memory/package.json')), false);
  assert.equal(fs.existsSync(path.join(workspace, '.github/hooks')), false);

  const invoke = (args, status = 0, overrides = {}) => run(process.execPath, [launcher, ...args], workspace, {
    ...env,
    ECC_COPILOT_MEMORY_RUNTIME: packageRoot,
    ECC_MEMORY_PROJECT_ROOT: path.join(foreign, '.ecc', 'memory'),
    ECC_MEMORY_ALLOW_USER_SCOPE: '1',
    ...overrides,
  }, { status });
  const lookup = (...args) => JSON.parse(invoke(args).stdout);
  const error = (args, expectedCode, overrides) => {
    const result = invoke(args, 1, overrides);
    const payload = JSON.parse(result.stdout);
    assert.equal(payload.code, expectedCode);
    assert.equal(result.stderr, '');
    assert.doesNotMatch(result.stdout, /protected|Another project|debug fixture/);
  };

  const doctor = lookup('doctor');
  assert.equal(doctor.status, 'ready');
  assert.equal(doctor.report.memoryCount, 2);
  const search = lookup('search', 'review');
  assert.equal(search.status, 'found');
  assert.deepEqual(search.results.map(entry => entry.memory.id).sort(), [projectId, teamId].sort());
  assert.equal(search.results.every(entry => !Object.hasOwn(entry.memory, 'body')), true);
  const read = lookup('read', projectId);
  assert.equal(read.memory.body, 'Workspace body');
  assert.equal(read.memory.trust, 'unreviewed');
  assert.deepEqual(read.backlinks.map(item => item.id), [teamId]);
  assert.equal(Object.hasOwn(read, 'path'), false);
  for (const id of [recipientId, userId, foreignId, 'mem_absent']) {
    error(['read', id], 'ECC_COPILOT_MEMORY_NOT_FOUND');
  }

  const literalOption = lookup('search', '--scope');
  assert.equal(literalOption.results.some(entry => entry.memory.id === userId), false);
  error(['search', 'review', '--scope', 'user'], 'ECC_COPILOT_MEMORY_INVALID_ARGUMENTS');
  error(['save'], 'ECC_COPILOT_MEMORY_INVALID_ARGUMENTS');
  error(['doctor'], 'ECC_COPILOT_MEMORY_UNAVAILABLE', { ECC_COPILOT_MEMORY_RUNTIME: undefined });
  error(['doctor'], 'ECC_COPILOT_MEMORY_UNAVAILABLE', { ECC_COPILOT_MEMORY_RUNTIME: 'relative' });

  const fixtureRuntime = path.join(root, 'test runtime');
  fs.mkdirSync(path.join(fixtureRuntime, 'scripts'), { recursive: true });
  fs.writeFileSync(path.join(fixtureRuntime, 'package.json'),
    '{"name":"ecc-universal","version":"2.2.3","bin":{"ecc":"scripts/ecc.js"}}\n');
  const fixtureScript = path.join(fixtureRuntime, 'scripts', 'memory.js');
  fs.writeFileSync(fixtureScript, "process.stderr.write('private debug fixture\\n'); process.exitCode = 1;\n");
  error(['read', projectId], 'ECC_COPILOT_MEMORY_FAILED', { ECC_COPILOT_MEMORY_RUNTIME: fixtureRuntime });
  fs.writeFileSync(fixtureScript,
    "console.log(JSON.stringify({schemaVersion:'ecc.memory.doctor.v1',ok:true,memoryCount:999}));\n");
  error(['doctor'], 'ECC_COPILOT_MEMORY_UNAVAILABLE', { ECC_COPILOT_MEMORY_RUNTIME: fixtureRuntime });

  const broken = path.join(workspace, '.ecc', 'memory', 'team', 'notes', 'private-broken-fixture.md');
  fs.writeFileSync(broken, 'private debug fixture\n');
  const incomplete = lookup('search', 'review');
  assert.equal(incomplete.status, 'incomplete');
  assert.equal(incomplete.diagnostics.invalidFileCount, 1);
  assert.doesNotMatch(JSON.stringify(incomplete), /private-broken-fixture|private debug fixture/);
  error(['read', projectId], 'ECC_COPILOT_MEMORY_INCOMPLETE');
  assert.equal(fs.readFileSync(broken, 'utf8'), 'private debug fixture\n');

  run(process.execPath, [cli, 'uninstall', '--target', 'copilot', '--json'], workspace, env);
  assert.equal(fs.existsSync(path.join(workspace, launcher)), false);
  assert.equal(fs.existsSync(broken), true);
}

function main() {
  const { packagePath, expectedSha256 } = parseEnvironment();
  assertDownloadedArtifact(packagePath, process.cwd());
  assertHash(hashFile(packagePath), expectedSha256);
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'ecc-copilot-memory-'));
  try {
    const packageProject = path.join(root, 'packed package');
    const home = path.join(root, 'home');
    fs.mkdirSync(packageProject);
    fs.mkdirSync(home);
    const env = createLifecycleEnvironment(process.env, home);
    verifyInstalledMemory(root, installPackage(packageProject, env, packagePath), env);
    console.log('Packed Copilot Memory Vault recall verified');
  } finally {
    fs.rmSync(root, { recursive: true, force: true, maxRetries: 5, retryDelay: 100 });
  }
}

module.exports = { verifyInstalledMemory };

if (require.main === module) main();
