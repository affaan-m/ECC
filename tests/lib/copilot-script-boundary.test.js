'use strict';

const assert = require('assert');
const fs = require('fs');
const os = require('os');
const path = require('path');
const { spawnSync } = require('child_process');
const { createManifestInstallPlan, applyInstallPlan } = require('../../scripts/lib/install-executor');
const { repairInstalledStates, uninstallInstalledStates } = require('../../scripts/lib/install-lifecycle');
const { readInstallState } = require('../../scripts/lib/install-state');

const repo = path.resolve(__dirname, '../..');
let passed = 0;
let failed = 0;

function test(name, fn) {
  const project = fs.realpathSync(fs.mkdtempSync(path.join(os.tmpdir(), 'ecc-copilot-boundary-')));
  const home = path.join(project, 'home');
  const root = path.join(project, '.github');
  const scripts = path.join(root, 'ecc', 'scripts');
  const marker = path.join(scripts, 'package.json');
  const env = { ...process.env, HOME: home, USERPROFILE: home, ECC_AGENT_DATA_HOME: path.join(project, 'data') };
  const options = { repoRoot: repo, homeDir: home, projectRoot: project, env, targets: ['copilot'] };
  const plan = () => createManifestInstallPlan({
    sourceRoot: repo, homeDir: home, projectRoot: project, env, target: 'copilot', moduleIds: ['workflow-quality'],
  });
  const write = (file, bytes) => { fs.mkdirSync(path.dirname(file), { recursive: true }); fs.writeFileSync(file, bytes); };
  const probe = file => {
    const result = spawnSync(process.execPath, [file], { cwd: project, env, encoding: 'utf8', timeout: 15000 });
    assert.ifError(result.error);
    assert.strictEqual(result.status, 0, result.stderr);
    return result.stdout.trim();
  };
  write(path.join(project, 'package.json'), '{"type":"module"}\n');
  try {
    fn({ project, root, scripts, marker, env, options, plan, write, probe });
    passed++;
    console.log(`PASS ${name}`);
  } catch (error) {
    failed++;
    console.error(`FAIL ${name}: ${error.stack}`);
  } finally {
    fs.rmSync(project, { recursive: true, force: true });
  }
}

test('refuses unowned ESM scripts before copies or install-state writes', f => {
  const sentinel = path.join(f.scripts, 'custom.js');
  const source = 'import { basename } from "node:path"; console.log(basename(import.meta.url));\n';
  f.write(sentinel, source);
  assert.strictEqual(f.probe(sentinel), 'custom.js');
  const plan = f.plan();
  assert.throws(() => applyInstallPlan(plan), /unowned or edited JavaScript/);
  assert.ok(!fs.existsSync(f.marker));
  assert.ok(!fs.existsSync(plan.installStatePath));
  assert.ok(!fs.existsSync(path.join(f.root, 'skills')));
  assert.ok(!fs.existsSync(path.join(f.scripts, 'setup-package-manager.js')));
  assert.strictEqual(fs.readFileSync(sentinel, 'utf8'), source);
  assert.strictEqual(f.probe(sentinel), 'custom.js');
});

test('the install CLI reports a scope conflict and leaves the user ESM script runnable', f => {
  const sentinel = path.join(f.scripts, 'custom.js');
  const source = 'export const value = 42; console.log(value);\n';
  f.write(sentinel, source);
  assert.strictEqual(f.probe(sentinel), '42');
  const result = spawnSync(process.execPath, [path.join(repo, 'scripts/install-apply.js'),
    '--target', 'copilot', '--modules', 'commands-core,workflow-quality', '--json'],
  { cwd: f.project, env: f.env, encoding: 'utf8', timeout: 15000 });
  assert.ifError(result.error);
  assert.notStrictEqual(result.status, 0, 'install must report the conflict');
  assert.match(result.stderr + result.stdout, /would change module scope/);
  assert.ok(!fs.existsSync(f.marker));
  assert.ok(!fs.existsSync(f.plan().installStatePath));
  assert.strictEqual(fs.readFileSync(sentinel, 'utf8'), source);
  assert.strictEqual(f.probe(sentinel), '42');
});

for (const relative of ['package.json', 'lib/package.json']) {
  test(`refuses an existing ESM boundary at ${relative} before installing managed helpers`, f => {
    const boundary = path.join(f.scripts, relative);
    const bytes = '{"type":"module","private":true}\n';
    f.write(boundary, bytes);
    const plan = f.plan();
    assert.throws(() => applyInstallPlan(plan), /existing user module boundary/);
    assert.strictEqual(fs.readFileSync(boundary, 'utf8'), bytes);
    assert.ok(!fs.existsSync(plan.installStatePath));
    assert.ok(!fs.existsSync(path.join(f.scripts, 'setup-package-manager.js')));
    assert.ok(!fs.existsSync(path.join(f.scripts, 'lib', 'package-manager.js')));
  });
}

test('a nested user ESM scope remains unchanged across install and uninstall', f => {
  f.write(path.join(f.scripts, 'user', 'package.json'), '{"type":"module"}\n');
  const sentinel = path.join(f.scripts, 'user', 'custom.js');
  f.write(sentinel, 'export const value = 43; console.log(value);\n');
  applyInstallPlan(f.plan());
  assert.strictEqual(f.probe(sentinel), '43');
  assert.strictEqual(uninstallInstalledStates(f.options).summary.errorCount, 0);
  assert.ok(!fs.existsSync(f.marker));
  assert.strictEqual(f.probe(sentinel), '43');
});

test('uninstall retains the boundary while a user CommonJS script relies on it', f => {
  const plan = f.plan();
  applyInstallPlan(plan);
  const sentinel = path.join(f.scripts, 'custom.js');
  const source = 'const path = require("node:path"); console.log(path.basename(__filename));\n';
  f.write(sentinel, source);
  assert.strictEqual(f.probe(sentinel), 'custom.js');
  const result = uninstallInstalledStates(f.options);
  assert.strictEqual(result.summary.errorCount, 0, JSON.stringify(result));
  assert.strictEqual(result.results[0].status, 'partial');
  assert.ok(result.results[0].retainedPaths.includes(f.marker));
  assert.strictEqual(fs.readFileSync(sentinel, 'utf8'), source);
  assert.strictEqual(f.probe(sentinel), 'custom.js');
  assert.ok(!fs.existsSync(path.join(f.scripts, 'setup-package-manager.js')));
  assert.ok(readInstallState(plan.installStatePath).operations.some(operation => operation.destinationPath === f.marker));
  fs.unlinkSync(sentinel);
  assert.strictEqual(uninstallInstalledStates(f.options).summary.errorCount, 0);
  assert.ok(!fs.existsSync(f.marker));
  assert.ok(!fs.existsSync(plan.installStatePath));
});

test('repair refuses to restore a missing boundary over newly added user ESM scripts', f => {
  const plan = f.plan();
  applyInstallPlan(plan);
  fs.unlinkSync(f.marker);
  const sentinel = path.join(f.scripts, 'custom.js');
  const source = 'export const value = 44; console.log(value);\n';
  f.write(sentinel, source);
  assert.strictEqual(f.probe(sentinel), '44');
  const state = fs.readFileSync(plan.installStatePath, 'utf8');
  const result = repairInstalledStates(f.options);
  assert.ok(result.summary.errorCount > 0, JSON.stringify(result));
  assert.match(JSON.stringify(result), /would change module scope/);
  assert.ok(!fs.existsSync(f.marker));
  assert.strictEqual(fs.readFileSync(plan.installStatePath, 'utf8'), state);
  assert.strictEqual(fs.readFileSync(sentinel, 'utf8'), source);
  assert.strictEqual(f.probe(sentinel), '44');
});

console.log(`Passed: ${passed}`);
console.log(`Failed: ${failed}`);
process.exitCode = failed ? 1 : 0;
