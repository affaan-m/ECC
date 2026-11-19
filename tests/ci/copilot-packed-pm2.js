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

const launcher = '.github/ecc/scripts/pm2/copilot-pm2.cjs';
const skill = '.github/skills/copilot-pm2/SKILL.md';
const config = '.github/ecc/pm2/ecosystem.config.cjs';

function run(command, args, cwd, env, { input, status = 0 } = {}) {
  const result = spawnSync(command, args, { cwd, env, input, encoding: 'utf8', timeout: 120000 });
  assert.ifError(result.error);
  assert.equal(result.status, status, `${command} ${args[0]}\n${result.stderr}\n${result.stdout}`);
  return result;
}

function installPackage(project, env, artifact) {
  fs.writeFileSync(path.join(project, 'package.json'), JSON.stringify({
    name: 'copilot-packed-pm2-fixture',
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

function verifyInstalledPm2(root, packageRoot, env) {
  const projects = ['PM2 project café', 'PM2 second project'].map(name => path.join(root, name));
  const cli = path.join(packageRoot, 'scripts', 'ecc.js');
  for (const [index, workspace] of projects.entries()) {
    fs.mkdirSync(workspace);
    fs.writeFileSync(path.join(workspace, 'package.json'), '{"type":"module","private":true}\n');
    fs.writeFileSync(path.join(workspace, 'server.js'), '/* service fixture */\n');
    const options = index ? ['--modules', 'copilot-pm2'] : ['--skills', 'copilot-pm2'];
    run(process.execPath, [cli, 'install', '--target', 'copilot', ...options, '--json'], workspace, env);
    assert.ok(fs.readFileSync(path.join(workspace, skill), 'utf8').includes(launcher));
    assert.equal(fs.existsSync(path.join(workspace, '.github/ecc/scripts/package.json')), false);
    assert.equal(fs.existsSync(path.join(workspace, '.github/hooks')), false);
  }
  const [workspace, other] = projects;
  const logicalNames = ['web', 'project', 'service-' + 'a'.repeat(40)];
  const services = logicalNames.map(name => ({ name, cwd: '.', command: process.execPath, args: ['server.js'] }));
  const spec = JSON.stringify({ services });
  const invoke = (cwd, args = ['--stdin'], input = spec, status = 0) => JSON.parse(
    run(process.execPath, [launcher, ...args], cwd, env, { input, status }).stdout
  );
  const first = invoke(workspace);
  assert.deepEqual(invoke(workspace), first, 'preview is deterministic');
  const alias = path.join(root, 'same PM2 directory');
  fs.symlinkSync(workspace, alias, process.platform === 'win32' ? 'junction' : 'dir');
  assert.deepEqual(invoke(alias), first, 'an alias resolves to the same canonical project identity');
  fs.rmSync(alias, { recursive: true });
  const second = invoke(other);
  assert.equal(first.dryRun, true);
  assert.equal(first.processesStarted, false);
  assert.equal(fs.existsSync(path.join(workspace, config)), false);
  assert.deepEqual(first.services.map(item => item.name), logicalNames);
  const firstIds = first.services.map(item => item.appId);
  const secondIds = second.services.map(item => item.appId);
  assert.equal(firstIds.every(id => !secondIds.includes(id)), true);
  assert.equal(firstIds.every(id => /^ecc-[a-f0-9]{20}-[a-z][a-z0-9-]+$/.test(id)), true);
  assert.equal(new Set(first.files.map(file => file.path)).size, first.files.length);
  assert.ok(first.files.some(file => file.path === '.github/skills/pm2-app-project-start/SKILL.md'));
  assert.equal(first.files.filter(file => file.path.startsWith('.github/skills/'))
    .every(file => file.path.split('/')[2].length <= 64), true);

  for (const operation of ['start', 'stop', 'restart', 'logs', 'status']) {
    const output = first.files.find(file => file.path === `.github/skills/pm2-project-${operation}/SKILL.md`).content;
    const commands = output.split('\n').filter(line => line.startsWith('pm2 '));
    const expected = firstIds.map(id => ({
      start: `pm2 start ${config} --only ${id}`,
      stop: `pm2 stop ${id}`,
      restart: `pm2 restart ${id}`,
      logs: `pm2 logs ${id} --nostream`,
      status: `pm2 describe ${id}`,
    })[operation]);
    assert.deepEqual(commands, expected);
    assert.match(output, /^disable-model-invocation: true$/m);
  }
  for (const [index, service] of first.services.entries()) {
    const id = firstIds[index];
    for (const operation of ['start', 'stop', 'restart']) {
      const planned = first.files.find(file => file.path === `.github/skills/pm2-app-${service.name}-${operation}/SKILL.md`);
      const commands = planned.content.split('\n').filter(line => line.startsWith('pm2 '));
      const expected = operation === 'start' ? `pm2 start ${config} --only ${id}` : `pm2 ${operation} ${id}`;
      assert.deepEqual(commands, [expected]);
    }
  }
  const proposedConfig = first.files.find(file => file.path === config).content;
  const serialized = proposedConfig.match(/^'use strict';\nmodule\.exports = (.*);\n$/s)[1];
  assert.deepEqual(JSON.parse(serialized).apps.map(app => app.name), firstIds);
  assert.equal(invoke(workspace, []).services[0].name, 'api');

  const collision = path.join(workspace, '.github/skills/pm2-project-status/SKILL.md');
  fs.mkdirSync(path.dirname(collision), { recursive: true });
  fs.writeFileSync(collision, 'user-authored fixture');
  assert.match(invoke(workspace, ['--stdin', '--apply'], spec, 1).error, /existing/i);
  assert.equal(fs.readFileSync(collision, 'utf8'), 'user-authored fixture');
  for (const item of first.files) {
    const destination = path.join(workspace, item.path);
    if (destination !== collision) assert.equal(fs.existsSync(destination), false);
  }
  fs.rmSync(collision);

  const linked = path.dirname(path.join(workspace, config));
  const referent = path.join(root, 'absent generated directory');
  fs.mkdirSync(referent);
  fs.symlinkSync(referent, linked, process.platform === 'win32' ? 'junction' : 'dir');
  fs.rmSync(referent, { recursive: true });
  assert.match(invoke(workspace, ['--stdin', '--apply'], spec, 1).error, /link/i);
  assert.equal(fs.existsSync(referent), false);
  assert.equal(fs.lstatSync(linked).isSymbolicLink(), true);
  fs.rmSync(linked, { recursive: true });

  const invalidCwd = JSON.stringify({ services: [{ ...services[0], cwd: '..' }] });
  assert.match(invoke(workspace, ['--stdin'], invalidCwd, 1).error, /workspace/i);
  const invalidCommand = JSON.stringify({ services: [{ ...services[0], command: 'node --version' }] });
  assert.match(invoke(workspace, ['--stdin'], invalidCommand, 1).error, /executable/i);

  const applied = invoke(workspace, ['--stdin', '--apply']);
  assert.equal(applied.dryRun, false);
  assert.equal(applied.processesStarted, false);
  assert.equal(fs.readFileSync(path.join(workspace, config), 'utf8'), proposedConfig);
  assert.match(invoke(workspace, ['--stdin', '--apply'], spec, 1).error, /existing/i);
  run(process.execPath, [cli, 'uninstall', '--target', 'copilot', '--json'], workspace, env);
  assert.equal(fs.existsSync(path.join(workspace, launcher)), false);
  assert.equal(fs.readFileSync(path.join(workspace, config), 'utf8'), proposedConfig);
}

function main() {
  const { packagePath, expectedSha256 } = parseEnvironment();
  assertDownloadedArtifact(packagePath, process.cwd());
  assertHash(hashFile(packagePath), expectedSha256);
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'ecc-copilot-pm2-'));
  try {
    const packageProject = path.join(root, 'packed package');
    const home = path.join(root, 'home');
    fs.mkdirSync(packageProject);
    fs.mkdirSync(home);
    const env = createLifecycleEnvironment(process.env, home);
    verifyInstalledPm2(root, installPackage(packageProject, env, packagePath), env);
    console.log('Packed Copilot PM2 generation verified');
  } finally {
    fs.rmSync(root, { recursive: true, force: true, maxRetries: 5, retryDelay: 100 });
  }
}

module.exports = { verifyInstalledPm2 };

if (require.main === module) main();
