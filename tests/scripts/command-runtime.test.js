// Actual commands-only install lifecycle and module-scope regression coverage.
'use strict';
const assert = require('assert');
const fs = require('fs');
const os = require('os');
const path = require('path');
const { spawnSync } = require('child_process');
const { pathToFileURL } = require('url');
const { createManifestInstallPlan, applyInstallPlan, previewInstallPlan } = require('../../scripts/lib/install-executor');
const { withHookConsent } = require('../../scripts/lib/install/hook-consent');
const { repairInstalledStates } = require('../../scripts/lib/install-lifecycle');
const repo = path.resolve(__dirname, '../..');
let passed = 0;
let failed = 0;
function snapshot(root) {
  if (!fs.existsSync(root)) return {};
  return Object.fromEntries(fs.readdirSync(root, { recursive: true, withFileTypes: true })
    .map(entry => { const file = path.join(entry.parentPath || entry.path, entry.name);
      const value = entry.isDirectory() ? '[directory]' : entry.isSymbolicLink()
        ? `[symlink:${fs.readlinkSync(file)}]` : require('crypto').createHash('sha256').update(fs.readFileSync(file)).digest('hex');
      return [path.relative(root, file), value]; }).sort());
}
function test(name, fn, target = 'claude-project') {
  const dir = fs.realpathSync(fs.mkdtempSync(path.join(os.tmpdir(), 'ecc-command-runtime-')));
  const home = path.join(dir, 'home');
  const project = path.join(dir, 'project');
  fs.mkdirSync(home); fs.mkdirSync(project);
  const root = target === 'claude' ? path.join(home, '.claude') : path.join(project, '.claude');
  const scripts = path.join(root, 'scripts');
  const marker = path.join(scripts, 'package.json');
  const write = (file, bytes) => { fs.mkdirSync(path.dirname(file), { recursive: true }); fs.writeFileSync(file, bytes); };
  const env = { ...process.env, HOME: home, USERPROFILE: home, CLAUDE_CONFIG_DIR: path.join(home, '.claude') };
  const run = (file, args) => spawnSync(process.execPath, [file, ...args], {
    cwd: project, env, encoding: 'utf8', timeout: 30000, maxBuffer: 8 * 1024 * 1024 });
  const install = () => run(path.join(repo, 'scripts/install-apply.js'), ['--target', target, '--modules', 'commands-core', '--no-hooks', '--json']);
  const uninstall = () => run(path.join(repo, 'scripts/uninstall.js'), ['--target', target, '--json']);
  const plan = () => withHookConsent(createManifestInstallPlan({ sourceRoot: repo, homeDir: home,
    projectRoot: project, env: {}, target, moduleIds: ['commands-core'] }), 'declined');
  const statePath = path.join(root, 'ecc/install-state.json');
  const state = () => JSON.parse(fs.readFileSync(statePath, 'utf8'));
  const ok = result => assert.strictEqual(result.status, 0, result.stderr || result.stdout);
  const health = () => {
    const file = path.join(scripts, 'skills-health.js');
    const help = run(file, ['--help']); ok(help); assert.match(help.stdout, /Usage:/);
    const result = run(file, ['--json', '--home', home, '--skills-root', path.join(dir, 'none'),
      '--learned-root', path.join(dir, 'none2'), '--imported-root', path.join(dir, 'none3')]);
    ok(result); assert.deepStrictEqual(JSON.parse(result.stdout).skills, []);
  };
  const probe = file => {
    const result = run('--input-type=module', ['-e', `const m=await import(${JSON.stringify(pathToFileURL(file).href)}); console.log(m.default ?? m.value);`]);
    ok(result); return result.stdout.trim();
  };
  const noPayload = () => {
    for (const file of ['.mcp.json', 'hooks/hooks.json', 'scripts/hooks']) {
      assert.ok(!fs.existsSync(path.join(root, file)), `Unexpected ${file}`);
    }
    const settings = path.join(root, 'settings.json');
    if (fs.existsSync(settings)) assert.ok(!JSON.parse(fs.readFileSync(settings, 'utf8')).hooks);
    assert.ok(!state().operations.some(op => ['hooks-runtime', 'mcp-configs'].includes(op.moduleId)));
  };
  try { fn({ dir, home, project, root, scripts, marker, write, install, uninstall, plan,
    state, statePath, ok, health, probe, noPayload, run, target }); passed++; console.log(`PASS ${name}`); }
  catch (error) { failed++; console.error(`FAIL ${name}: ${error.stack}`); }
  finally { fs.rmSync(dir, { recursive: true, force: true }); }
}
for (const target of ['claude-project', 'claude']) {
  test(`${target}: fresh ESM commands-only CLI, receipt, reinstall, uninstall`, f => {
    const projectBytes = '{ "type": "module", "user": "project" }\n';
    const rootBytes = '{ "type": "module", "user": "claude" }\n';
    f.write(path.join(f.project, 'package.json'), projectBytes);
    f.write(path.join(f.root, 'package.json'), rootBytes);
    f.ok(f.install()); f.health(); f.noPayload();
    assert.deepStrictEqual(JSON.parse(fs.readFileSync(f.marker, 'utf8')), { type: 'commonjs' });
    const owned = f.state().operations.filter(op => op.destinationPath === f.marker);
    assert.strictEqual(owned.length, 1); assert.strictEqual(owned[0].ownership, 'managed');
    assert.strictEqual(owned[0].moduleId, 'commands-core');
    assert.ok(f.state().operations.some(op => op.moduleId === 'shared-script-utils' && op.destinationPath.endsWith('utils.js')));
    assert.ok(!fs.existsSync(path.join(f.scripts, 'lib/package.json')));
    f.ok(f.install()); f.health(); f.noPayload();
    assert.strictEqual(f.state().operations.filter(op => op.destinationPath === f.marker).length, 1);
    f.ok(f.uninstall()); assert.ok(!fs.existsSync(f.marker)); assert.ok(!fs.existsSync(f.statePath));
    assert.strictEqual(fs.readFileSync(path.join(f.project, 'package.json'), 'utf8'), projectBytes);
    assert.strictEqual(fs.readFileSync(path.join(f.root, 'package.json'), 'utf8'), rootBytes);
  }, target);
}
for (const [scope, bytes] of [
  ['package.json', '{"type":"module"}\n'], ['package.json', '{broken'],
  ['lib/package.json', '{"type":"module"}\n'], ['lib/package.json', '{broken'],
  ['lib/skill-evolution/package.json', '{"type":"module"}\n'],
  ['lib/astra-review/package.json', '{"type":"module"}\n'],
  ['ci/package.json', '{"type":"module"}\n'],
  ['lib/package.json', '[]'], ['lib/package.json', '{"type":"unexpected"}'],
]) {
  test(`refuses incompatible ${scope} ${bytes} before writes`, f => {
    f.write(path.join(f.project, 'package.json'), '{"type":"module"}\n');
    f.write(path.join(f.scripts, scope), bytes);
    const before = snapshot(f.dir);
    const result = f.install(); assert.notStrictEqual(result.status, 0, 'Install falsely reported success');
    assert.deepStrictEqual(snapshot(f.dir), before);
    assert.throws(() => previewInstallPlan(f.plan())); assert.deepStrictEqual(snapshot(f.dir), before);
  });
}
for (const userFile of ['user.js', 'lib/user.js', 'lib/skill-evolution/user.js', 'ci/user.js', 'lib/utils.js',
  'user.ts', 'lib/user.ts', 'ci/user.ts', 'user.jsx', 'user.tsx']) {
  test(`refuses unowned script ${userFile} without scope mutation`, f => {
    f.write(path.join(f.project, 'package.json'), '{"type":"module"}\n');
    const file = path.join(f.scripts, userFile); f.write(file, 'export const value = 42;\n');
    if (userFile.endsWith('.js')) assert.strictEqual(f.probe(file), '42'); const before = snapshot(f.dir);
    const result = f.install(); assert.notStrictEqual(result.status, 0);
    assert.match(result.stderr + result.stdout, /unowned or edited JavaScript/);
    assert.deepStrictEqual(snapshot(f.dir), before); if (userFile.endsWith('.js')) assert.strictEqual(f.probe(file), '42');
  });
}
for (const bytes of ['{ "type": "commonjs", "user": true }\n', '{"user":true}\n']) {
  test('compatible scripts metadata remains unchanged and unowned', f => {
    f.write(f.marker, bytes); const file = path.join(f.scripts, 'user.js'); f.write(file, 'module.exports = 43;\n');
    f.ok(f.install()); f.health();
    assert.ok(!f.state().operations.some(op => op.destinationPath === f.marker));
    f.ok(f.install()); f.health(); f.ok(f.uninstall());
    assert.strictEqual(fs.readFileSync(f.marker, 'utf8'), bytes); assert.strictEqual(f.probe(file), '43');
  });
}
test('unrelated nested ESM package keeps interpretation and bytes', f => {
  f.write(path.join(f.project, 'package.json'), '{"type":"module"}\n');
  const nested = path.join(f.scripts, 'user/package.json'); const bytes = '{"type":"module"}\n';
  const file = path.join(f.scripts, 'user/index.js'); f.write(nested, bytes); f.write(file, 'export const value = 44;\n');
  f.ok(f.install()); f.health(); assert.strictEqual(f.probe(file), '44');
  f.ok(f.uninstall()); assert.strictEqual(fs.readFileSync(nested, 'utf8'), bytes); assert.strictEqual(f.probe(file), '44');
});
test('compatible nested helper scope remains unchanged and unowned', f => {
  const file = path.join(f.scripts, 'lib/package.json'); const bytes = '{"type":"commonjs","keep":true}\n';
  f.write(file, bytes); f.ok(f.install()); f.health(); f.ok(f.uninstall());
  assert.strictEqual(fs.readFileSync(file, 'utf8'), bytes);
});
test('edited owned JS rejects missing-marker reinstall before any writes', f => {
  f.ok(f.install()); fs.unlinkSync(f.marker);
  f.write(path.join(f.scripts, 'lib/utils.js'), 'export const value = 45;\n');
  const before = snapshot(f.dir); const result = f.install(); assert.notStrictEqual(result.status, 0);
  assert.match(result.stderr + result.stdout, /unowned or edited JavaScript/); assert.deepStrictEqual(snapshot(f.dir), before);
});
test('missing owned marker restores safely on reinstall', f => {
  f.ok(f.install()); fs.unlinkSync(f.marker); f.ok(f.install()); f.health(); f.ok(f.uninstall());
});
test('repair restores missing owned marker', f => {
  f.ok(f.install()); fs.unlinkSync(f.marker);
  const result = repairInstalledStates({ repoRoot: repo, homeDir: f.home, projectRoot: f.project, env: {}, targets: [f.target] });
  assert.strictEqual(result.summary.errorCount, 0); f.health(); f.ok(f.uninstall());
});
test('publication rechecks newly introduced unowned JS', f => {
  assert.throws(() => applyInstallPlan(f.plan(), { beforeOperationWrite({ operation }) {
    if (operation.destinationPath === f.marker) f.write(path.join(f.scripts, 'user.js'), 'export const value = 46;\n');
  } }), /unowned or edited JavaScript/);
  assert.ok(!fs.existsSync(f.marker));
});
test('publication rechecks nested helper package conflict', f => {
  assert.throws(() => applyInstallPlan(f.plan(), { beforeOperationWrite({ operation }) {
    if (operation.destinationPath === f.marker) f.write(path.join(f.scripts, 'lib/package.json'), '{"type":"module"}\n');
  } }), /module boundary/);
  assert.ok(!fs.existsSync(f.marker));
});
for (const extension of ['js', 'ts', 'jsx', 'tsx']) {
test(`uninstall retains owned boundary for newly added user ${extension} until it is removed`, f => {
  f.write(path.join(f.project, 'package.json'), '{"type":"module"}\n');
  f.ok(f.install()); const file = path.join(f.scripts, `user.${extension}`); f.write(file, 'module.exports = 47;\n');
  const partial = JSON.parse(f.uninstall().stdout);
  assert.strictEqual(partial.results[0].status, 'partial');
  assert.strictEqual(partial.summary.errorCount, 0);
  assert.ok(partial.results[0].retainedPaths.includes(f.marker));
  assert.ok(fs.existsSync(f.marker)); if (extension === 'js') assert.strictEqual(f.probe(file), '47');
  fs.unlinkSync(file); f.ok(f.uninstall()); assert.ok(!fs.existsSync(f.marker)); assert.ok(!fs.existsSync(f.statePath));
});
}
for (const scope of ['lib/package.json', 'lib/skill-evolution/package.json', 'ci/package.json']) {
  test(`existing CommonJS parent still rejects incompatible selected ${scope}`, f => {
    f.write(f.marker, '{"type":"commonjs","user":true}\n');
    f.write(path.join(f.scripts, scope), '{"type":"module"}\n'); const before = snapshot(f.dir);
    assert.notStrictEqual(f.install().status, 0); assert.deepStrictEqual(snapshot(f.dir), before);
  });
}
test('edited owned CommonJS package bytes are preserved by rejection', f => {
  f.ok(f.install()); f.write(f.marker, '{"type":"commonjs","userAdded":true}\n');
  const before = snapshot(f.dir); const result = f.install(); assert.notStrictEqual(result.status, 0);
  assert.match(result.stderr + result.stdout, /edited.*module boundary/); assert.deepStrictEqual(snapshot(f.dir), before);
});
for (const scope of ['package.json', 'lib/package.json']) {
  test(`symlinked ${scope} refuses before mutation`, f => {
    const file = path.join(f.scripts, scope); const outside = path.join(f.dir, 'user-package.json');
    f.write(outside, '{"type":"commonjs"}\n'); fs.mkdirSync(path.dirname(file), { recursive: true });
    fs.symlinkSync(outside, file); const before = snapshot(f.dir);
    assert.notStrictEqual(f.install().status, 0); assert.deepStrictEqual(snapshot(f.dir), before);
  });
}
for (const scope of ['package.json', 'lib/package.json']) {
  test(`non-file ${scope} refuses before mutation`, f => {
    fs.mkdirSync(path.join(f.scripts, scope), { recursive: true }); const before = snapshot(f.dir);
    assert.notStrictEqual(f.install().status, 0); assert.deepStrictEqual(snapshot(f.dir), before);
  });
}
for (const extension of ['mjs', 'cjs', 'mts', 'cts']) {
  test(`explicit user ${extension} format remains independent of installed boundary`, f => {
    f.write(path.join(f.project, 'package.json'), '{"type":"module"}\n');
    const file = path.join(f.scripts, `user.${extension}`);
    const bytes = extension.startsWith('m') ? 'export const value = 48;\n' : 'module.exports = 48;\n';
    f.write(file, bytes); f.ok(f.install()); f.health();
    assert.strictEqual(fs.readFileSync(file, 'utf8'), bytes);
    f.ok(f.uninstall()); assert.ok(!fs.existsSync(f.marker));
    assert.strictEqual(fs.readFileSync(file, 'utf8'), bytes);
  });
}
console.log(`Passed: ${passed}`); console.log(`Failed: ${failed}`); process.exitCode = failed ? 1 : 0;
