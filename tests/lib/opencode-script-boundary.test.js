'use strict';

const assert = require('assert');
const fs = require('fs');
const os = require('os');
const path = require('path');
const { spawnSync } = require('child_process');
const { createManifestInstallPlan, applyInstallPlan } = require('../../scripts/lib/install-executor');
const { withHookConsent } = require('../../scripts/lib/install/hook-consent');
const { repairInstalledStates, uninstallInstalledStates } = require('../../scripts/lib/install-lifecycle');
const { readInstallState } = require('../../scripts/lib/install-state');

const repo = path.resolve(__dirname, '../..');
const build = spawnSync(process.execPath, [path.join(repo, 'scripts/build-opencode.js')], { encoding: 'utf8' });
assert.strictEqual(build.status, 0, build.stderr || build.stdout);
let passed = 0;
let failed = 0;
function test(name, fn) {
  const dir = fs.realpathSync(fs.mkdtempSync(path.join(os.tmpdir(), 'ecc-opencode-boundary-')));
  const home = path.join(dir, 'home');
  const project = path.join(dir, 'project');
  fs.mkdirSync(home);
  fs.mkdirSync(project);
  const root = path.join(home, '.config/opencode');
  const scripts = path.join(root, 'scripts');
  const marker = path.join(scripts, 'package.json');
  const options = { repoRoot: repo, homeDir: home, projectRoot: project, env: {}, targets: ['opencode'] };
  const plan = () => withHookConsent(createManifestInstallPlan({
    sourceRoot: repo, homeDir: home, projectRoot: project, env: {}, target: 'opencode',
    moduleIds: ['platform-configs', 'hooks-runtime'],
  }), 'enabled');
  const write = (file, bytes) => { fs.mkdirSync(path.dirname(file), { recursive: true }); fs.writeFileSync(file, bytes); };
  const probe = file => {
    const result = spawnSync(process.execPath, ['--input-type=module', '-e',
      'const m=await import(requirePath); console.log(m.default ?? m.value);'.replace('requirePath', JSON.stringify(require('url').pathToFileURL(file).href))],
    { encoding: 'utf8', cwd: project });
    assert.strictEqual(result.status, 0, result.stderr);
    return result.stdout.trim();
  };
  try { fn({ home, project, root, scripts, marker, options, plan, write, probe }); passed++; console.log(`PASS ${name}`); }
  catch (error) { failed++; console.error(`FAIL ${name}: ${error.stack}`); }
  finally { fs.rmSync(dir, { recursive: true, force: true }); }
}

test('refuses unowned ESM scripts before copies or install-state writes', f => {
  f.write(path.join(f.root, 'package.json'), '{"type":"module"}\n');
  const sentinel = path.join(f.scripts, 'user.js');
  f.write(sentinel, 'export const value = 42;\n');
  assert.strictEqual(f.probe(sentinel), '42');
  const plan = f.plan();
  assert.throws(() => applyInstallPlan(plan), /unowned or edited JavaScript/);
  assert.ok(!fs.existsSync(f.marker));
  assert.ok(!fs.existsSync(plan.installStatePath));
  assert.ok(!fs.existsSync(path.join(f.root, 'plugins')));
  assert.strictEqual(f.probe(sentinel), '42');
});

test('preserves an unowned CommonJS boundary without repair or uninstall adoption', f => {
  const bytes = '{"type":"commonjs","user":"keep"}\n';
  f.write(f.marker, bytes);
  const sentinel = path.join(f.scripts, 'user.js');
  f.write(sentinel, 'module.exports = 43;\n');
  const plan = f.plan();
  applyInstallPlan(plan);
  const owned = () => readInstallState(plan.installStatePath).operations.some(operation => operation.destinationPath === f.marker);
  assert.strictEqual(owned(), false);
  assert.strictEqual(repairInstalledStates(f.options).summary.errorCount, 0);
  assert.strictEqual(owned(), false);
  assert.strictEqual(fs.readFileSync(f.marker, 'utf8'), bytes);
  assert.strictEqual(f.probe(sentinel), '43');
  assert.strictEqual(uninstallInstalledStates(f.options).summary.errorCount, 0);
  assert.strictEqual(fs.readFileSync(f.marker, 'utf8'), bytes);
  assert.strictEqual(f.probe(sentinel), '43');
});

test('refuses an existing user ESM package boundary without changing it', f => {
  const bytes = '{"type":"module","user":"keep"}\n';
  f.write(f.marker, bytes);
  const sentinel = path.join(f.scripts, 'user.js');
  f.write(sentinel, 'export const value = 44;\n');
  const plan = f.plan();
  assert.throws(() => applyInstallPlan(plan), /existing user module boundary/);
  assert.strictEqual(fs.readFileSync(f.marker, 'utf8'), bytes);
  assert.ok(!fs.existsSync(plan.installStatePath));
  assert.strictEqual(f.probe(sentinel), '44');
});

test('a nested user ESM scope remains unchanged across install and uninstall', f => {
  f.write(path.join(f.scripts, 'user/package.json'), '{"type":"module"}\n');
  const sentinel = path.join(f.scripts, 'user/index.js');
  f.write(sentinel, 'export const value = 45;\n');
  const explicitModule = path.join(f.scripts, 'user-module.mjs');
  f.write(explicitModule, 'export const value = 48;\n');
  applyInstallPlan(f.plan());
  assert.strictEqual(f.probe(sentinel), '45');
  assert.strictEqual(f.probe(explicitModule), '48');
  assert.strictEqual(uninstallInstalledStates(f.options).summary.errorCount, 0);
  assert.ok(!fs.existsSync(f.marker));
  assert.strictEqual(f.probe(sentinel), '45');
  assert.strictEqual(f.probe(explicitModule), '48');
});

test('partial uninstall retains an owned boundary while user JavaScript relies on it', f => {
  const plan = f.plan();
  applyInstallPlan(plan);
  const sentinel = path.join(f.scripts, 'user.js');
  f.write(sentinel, 'module.exports = 46;\n');
  const result = uninstallInstalledStates(f.options);
  assert.strictEqual(result.results[0].status, 'partial');
  assert.ok(result.results[0].retainedPaths.includes(f.marker));
  assert.strictEqual(f.probe(sentinel), '46');
  assert.ok(readInstallState(plan.installStatePath).operations.some(operation => operation.destinationPath === f.marker));
  fs.unlinkSync(sentinel);
  assert.strictEqual(uninstallInstalledStates(f.options).summary.errorCount, 0);
  assert.ok(!fs.existsSync(f.marker));
  assert.ok(!fs.existsSync(plan.installStatePath));
});

test('rechecks newly introduced user JavaScript before boundary publication', f => {
  const sentinel = path.join(f.scripts, 'user.js');
  const plan = f.plan();
  assert.throws(() => applyInstallPlan(plan, { beforeOperationWrite({ operation }) {
    if (operation.destinationPath === f.marker) f.write(sentinel, 'export const value = 47;\n');
  } }), /unowned or edited JavaScript/);
  assert.ok(!fs.existsSync(f.marker));
  assert.strictEqual(f.probe(sentinel), '47');
});

test('refuses a concurrent edit to a just-installed script before boundary publication', f => {
  const plan = f.plan();
  const sentinel = path.join(f.scripts, 'hooks/skill-run-tracker.js');
  assert.throws(() => applyInstallPlan(plan, { beforeOperationWrite({ operation }) {
    if (operation.destinationPath === f.marker) f.write(sentinel, 'export const value = 49;\n');
  } }), /unowned or edited JavaScript/);
  assert.ok(!fs.existsSync(f.marker));
  assert.strictEqual(f.probe(sentinel), '49');
});

test('repair restores a missing owned boundary and preserves runtime script ownership', f => {
  const plan = f.plan();
  applyInstallPlan(plan);
  fs.unlinkSync(f.marker);
  assert.strictEqual(repairInstalledStates(f.options).summary.errorCount, 0);
  assert.strictEqual(JSON.parse(fs.readFileSync(f.marker, 'utf8')).type, 'commonjs');
  assert.ok(readInstallState(plan.installStatePath).operations.some(operation => operation.destinationPath === f.marker));
});

console.log(`Passed: ${passed}`);
console.log(`Failed: ${failed}`);
process.exitCode = failed ? 1 : 0;
