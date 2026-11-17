'use strict';

const assert = require('node:assert/strict');
const { createHash } = require('node:crypto');
const { spawnSync } = require('node:child_process');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { createLifecycleEnvironment } = require('./packed-artifact-lifecycle');

const root = path.resolve(__dirname, '..', '..');
// First upstream Copilot installer with a shipped CommonJS helper boundary.
const baselineRef = 'c68afd7c355eb5b70834bfb44227d2f2e9070e8b';

function run(command, args, cwd, env) {
  const result = spawnSync(command, args, {
    cwd, env, encoding: 'utf8', timeout: 120000, maxBuffer: 8 * 1024 * 1024,
  });
  if (result.error) throw result.error;
  assert.equal(result.status, 0, `${args[0]} failed: ${result.stderr || result.stdout}`);
  return result.stdout;
}

function packageRevision(revision, directory, env) {
  assert.match(revision, /^[a-f0-9]{40}$/);
  fs.mkdirSync(directory);
  const source = path.join(directory, 'source');
  fs.mkdirSync(source);
  // Write the Git archive from the checkout and extract using relative paths,
  // which work with both GNU tar and Windows bsdtar.
  run('git', ['archive', '--format=tar', '-o', path.join(source, 'revision.tar'), revision], root, env);
  run('tar', ['-xf', 'revision.tar'], source, env);
  fs.unlinkSync(path.join(source, 'revision.tar'));

  const npmCli = process.env.npm_execpath;
  const npmArgs = ['pack', '--ignore-scripts', '--json', '--pack-destination', directory];
  const npm = npmCli || path.join(path.dirname(process.execPath), 'node_modules', 'npm', 'bin', 'npm-cli.js');
  const output = npmCli || process.platform === 'win32'
    ? run(process.execPath, [npm, ...npmArgs], source, env)
    : run('npm', npmArgs, source, env);
  const [{ filename }] = JSON.parse(output);
  assert.match(filename, /^ecc-universal-[\da-z.+-]+\.tgz$/i);
  run('tar', ['-xzf', filename], directory, env);
  fs.rmSync(source, { recursive: true, force: true });
  return path.join(directory, 'package');
}

function exercise(baseline, candidate, project, env, expected) {
  fs.mkdirSync(project);
  const projectPackage = '{"type":"module"}\n';
  const packageFile = path.join(project, 'package.json');
  const skill = path.join(project, '.github', 'skills', 'tdd-workflow', 'SKILL.md');
  const agent = path.join(project, '.github', 'agents', 'planner.md');
  const userAgent = path.join(project, '.github', 'agents', 'architect.md');
  const state = path.join(project, '.github', 'ecc-install-state.json');
  const hook = path.join(project, '.github', 'hooks', 'ecc.json');
  const detector = path.join(project, '.github', 'ecc', 'scripts', 'setup-package-manager.js');
  const detect = () => run(process.execPath, [detector, '--detect'], project, { ...env, NODE_PATH: '' });
  fs.mkdirSync(path.dirname(userAgent), { recursive: true });
  fs.writeFileSync(packageFile, projectPackage);
  fs.writeFileSync(path.join(project, 'pnpm-lock.yaml'), 'lockfileVersion: 9\n');
  fs.writeFileSync(userAgent, 'User-owned agent\n');

  const cli = (source, operation, args = []) => JSON.parse(run(process.execPath,
    [path.join(source, 'scripts', 'ecc.js'), operation, '--target', 'copilot', '--json', ...args], project, env));
  const install = source => {
    cli(source, 'install', ['--modules', 'agents-core,workflow-quality', '--no-hooks']);
    assert.ok(fs.existsSync(state));
    assert.equal(fs.readFileSync(userAgent, 'utf8'), 'User-owned agent\n');
    assert.equal(fs.existsSync(hook), false);
    assert.match(detect(), /^\s*Package Manager: pnpm\r?$/m);
    assert.match(fs.readFileSync(skill, 'utf8'), /node \.github\/ecc\/scripts\/setup-package-manager\.js --detect/);
    assert.match(fs.readFileSync(agent, 'utf8'), /^---\nname: planner\r?\n/);
    assert.doesNotMatch(fs.readFileSync(agent, 'utf8').split(/^---\r?$/m)[1], /^(?:model|tools|color):/m);
  };

  if (baseline) install(baseline);
  install(candidate);
  const managed = JSON.parse(fs.readFileSync(state, 'utf8')).operations
    .filter(operation => operation.kind === 'copy-file').map(operation => operation.destinationPath);
  assert.ok(managed.includes(skill) && managed.includes(agent) && managed.includes(detector));
  const installed = Object.fromEntries(managed.map(file => [
    path.relative(project, file), createHash('sha256').update(fs.readFileSync(file)).digest('hex'),
  ]));
  if (expected) assert.deepEqual(installed, expected, 'Upgraded files must match a clean candidate install');

  const original = fs.readFileSync(agent);
  fs.unlinkSync(agent);
  fs.unlinkSync(detector);
  assert.equal(cli(candidate, 'repair').summary.errorCount, 0);
  assert.deepEqual(fs.readFileSync(agent), original);
  assert.match(detect(), /^\s*Package Manager: pnpm\r?$/m);
  assert.equal(fs.readFileSync(userAgent, 'utf8'), 'User-owned agent\n');

  assert.equal(cli(candidate, 'uninstall').summary.errorCount, 0);
  for (const file of [state, ...managed]) assert.equal(fs.existsSync(file), false, file);
  assert.equal(fs.readFileSync(userAgent, 'utf8'), 'User-owned agent\n');
  assert.equal(fs.readFileSync(packageFile, 'utf8'), projectPackage);
  return installed;
}

function main() {
  const temporary = fs.realpathSync(fs.mkdtempSync(path.join(os.tmpdir(), 'ecc copilot packed ')));
  try {
    const home = path.join(temporary, 'home');
    fs.mkdirSync(home);
    const env = {
      ...createLifecycleEnvironment(process.env, home),
      // Reuse dependencies from the workflow's locked install. All ECC code
      // and payload files under test come from the extracted archives.
      NODE_PATH: path.resolve(require.resolve('js-yaml/package.json'), '..', '..'),
    };
    const candidateRef = process.env.ECC_COPILOT_FIXTURE_REF || run('git', ['rev-parse', 'HEAD'], root, env).trim();
    const baseline = packageRevision(baselineRef, path.join(temporary, 'baseline'), env);
    const candidate = packageRevision(candidateRef, path.join(temporary, 'candidate'), env);
    const installed = exercise(null, candidate, path.join(temporary, 'clean project'), env);
    exercise(baseline, candidate, path.join(temporary, 'upgrade project with spaces'), env, installed);
    console.log(JSON.stringify({
      revision: candidateRef,
      baseline: baselineRef,
      platform: process.platform,
      node: process.version,
      passed: ['packed install', 'packed upgrade', 'repair', 'uninstall', 'user-owned agent preservation'],
    }));
  } finally {
    fs.rmSync(temporary, { recursive: true, force: true, maxRetries: 10, retryDelay: 100 });
  }
}

main();
