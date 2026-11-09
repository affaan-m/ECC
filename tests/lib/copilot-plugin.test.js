'use strict';
const assert = require('assert');
const fs = require('fs');
const os = require('os');
const path = require('path');
const { spawnSync } = require('child_process');
const { buildPlugin, relocateSkill, verifyPlugin, previewMigration } = require('../../scripts/lib/copilot-plugin');
const { runPluginHook, isPluginEntrypoint } = require('../../scripts/lib/copilot-plugin-runtime');
const root = fs.mkdtempSync(path.join(os.tmpdir(), 'ecc plugin è-'));
let passed = 0;
function test(name, action) { action(); passed++; console.log(`PASS ${name}`); }
try {
  const output = path.join(root, 'artifact with spaces');
  test('artifact is generated from shared installer operations and keeps hooks disabled pending native gate', () => {
    const report = buildPlugin({ output, moduleIds: ['commands-core', 'hooks-runtime'] });
    assert.equal(report.nativeStatus, 'native-unverified');
    const manifest = JSON.parse(fs.readFileSync(path.join(output, 'plugin.json')));
    assert.equal(manifest.$schema, 'https://agent-plugins.org/schemas/1.0.0/plugin.schema.json');
    const hooks = JSON.parse(fs.readFileSync(path.join(output, 'com.github.copilot/hooks/hooks.json')));
    assert.equal(hooks.disableAllHooks, true);
    assert.ok(hooks.hooks.preToolUse.every(entry => entry.args[0].includes('${COPILOT_PLUGIN_ROOT}')));
    assert.ok(Object.values(hooks.hooks).flat().every(entry => isPluginEntrypoint(entry.args[1])));
    assert.ok(fs.existsSync(path.join(output, 'scripts/hooks/copilot-hook-adapter.js')));
    assert.ok(!fs.existsSync(path.join(output, '.github/ecc-install-state.json')));
    assert.ok(!fs.existsSync(path.join(output, '.git')));
    assert.ok(!fs.existsSync(path.join(output, 'node_modules')));
    assert.ok(report.files > 100);
  });
  test('skill runtime references resolve from the discovered skill source rather than project cwd or environment', () => {
    const result = relocateSkill('---\nname: sample\ndescription: sample\n---\nnode .github/ecc/scripts/copilot-memory.js doctor\n');
    assert.match(result, /"<ECC_PLUGIN_ROOT>\/scripts\/copilot-memory\.js"/);
    assert.match(result, /actual source path/);
    assert.doesNotMatch(result, /\.github\/ecc\//);
    assert.equal(relocateSkill('plain asset'), 'plain asset');
  });
  test('existing artifact output is never overwritten and requested project coexistence is rejected', () => {
    assert.throws(() => buildPlugin({ output, moduleIds: ['hooks-runtime'] }), /exists/);
    const project = path.join(root, 'coexist'); fs.mkdirSync(path.join(project, '.github'), { recursive: true });
    fs.writeFileSync(path.join(project, '.github/ecc-install-state.json'), '{}');
    assert.throws(() => buildPlugin({ output: path.join(root, 'other'), moduleIds: ['hooks-runtime'], projectRoot: project }), /coexist/);
    assert.equal(fs.existsSync(path.join(root, 'other')), false);
  });
  test('artifact verification detects changed, unlisted and linked files', () => {
    assert.equal(verifyPlugin(output).name, 'ecc-copilot');
    const extra = path.join(output, 'unlisted.json');
    fs.writeFileSync(extra, '{}');
    assert.throws(() => verifyPlugin(output), /Unlisted/);
    fs.unlinkSync(extra);
    const manifest = path.join(output, 'plugin.json');
    const original = fs.readFileSync(manifest);
    fs.appendFileSync(manifest, '\n');
    assert.throws(() => verifyPlugin(output), /digest/);
    fs.unlinkSync(manifest);
    const redirect = path.join(root, 'manifest-copy.json');
    fs.writeFileSync(redirect, original);
    fs.symlinkSync(redirect, manifest, 'file');
    assert.throws(() => verifyPlugin(output), /linked/i);
    fs.unlinkSync(manifest);
    fs.writeFileSync(manifest, original);
  });
  test('migration preview finds unowned skill collisions and never edits the project', () => {
    const project = path.join(root, 'migration preview');
    const artifact = JSON.parse(fs.readFileSync(path.join(output, 'ecc-artifact.json'), 'utf8'));
    const skill = artifact.entries.find(entry => /^skills\/[^/]+\/SKILL\.md$/.test(entry.path));
    const relative = `.github/${skill.path}`;
    fs.mkdirSync(path.dirname(path.join(project, relative)), { recursive: true });
    fs.writeFileSync(path.join(project, relative), 'owned by user');
    assert.deepEqual(previewMigration({ artifact: output, projectRoot: project }).collisions, [relative]);
    assert.equal(previewMigration({ artifact: output, projectRoot: project }).status, 'conflict');
    assert.equal(fs.readFileSync(path.join(project, relative), 'utf8'), 'owned by user');
    fs.unlinkSync(path.join(project, relative));
    assert.equal(previewMigration({ artifact: output, projectRoot: project }).status, 'clear');
  });
  test('bundled launcher denies unknown entrypoints and rejects project installer coexistence', () => {
    const project = path.join(root, 'project'); fs.mkdirSync(project);
    const payload = { cwd: project, sessionId: 'one', toolName: 'bash', toolArgs: { command: 'git status' } };
    assert.equal(runPluginHook({ pluginRoot: output, entry: '../outside.js', args: ['preToolUse'], raw: JSON.stringify(payload) }).output.permissionDecision, 'deny');
    fs.mkdirSync(path.join(project, '.github'));
    fs.writeFileSync(path.join(project, '.github/ecc-install-state.json'), '{}');
    const denied = runPluginHook({ pluginRoot: output, entry: 'scripts/hooks/copilot-hook-adapter.js', args: ['preToolUse', 'pre:copilot:guard'], raw: JSON.stringify(payload) });
    assert.equal(denied.output.permissionDecision, 'deny');
    assert.match(denied.output.permissionDecisionReason, /coexist/);
  });
  test('relocated artifact runtime executes a guard from a separate project with spaces', () => {
    const project = path.join(root, 'runtime project'); fs.mkdirSync(project);
    fs.writeFileSync(path.join(root, 'package.json'), '{"type":"module"}\n');
    const moved = path.join(root, 'moved artifact'); fs.renameSync(output, moved);
    const args = [path.join(moved, 'scripts/copilot-plugin-hook.js'), 'scripts/hooks/copilot-hook-adapter.js', 'preToolUse', 'pre:copilot:guard'];
    const result = spawnSync(process.execPath, args, { cwd: project, env: { ...process.env, ECC_HOOKS_ENABLED: 'true', ECC_HOOK_PROFILE: 'standard' },
      input: JSON.stringify({ cwd: project, sessionId: 'one', toolName: 'powershell', toolArgs: { command: 'Remove-Item -Recurse -Force .git' } }), encoding: 'utf8', timeout: 15000 });
    assert.equal(JSON.parse(result.stdout).permissionDecision, 'deny', result.stderr);
    assert.equal(result.status, 1);
  });
  test('artifact destination validation rejects relative source-contained linked and invalid selections', () => {
    assert.throws(() => buildPlugin({ output: 'relative' }), /absolute/);
    assert.throws(() => buildPlugin({ output: path.resolve(__dirname, '../../bad-artifact') }), /outside/);
    const dangling = path.join(root, 'dangling'); fs.symlinkSync(path.join(root, 'absent'), dangling, 'dir');
    assert.throws(() => buildPlugin({ output: dangling }), /exists/);
    const linked = path.join(root, 'linked'); fs.symlinkSync(root, linked, 'dir');
    assert.throws(() => buildPlugin({ output: path.join(linked, 'new') }), /redirect/);
    assert.throws(() => buildPlugin({ output: path.join(root, 'invalid-module'), moduleIds: ['not-a-module'] }));
    assert.equal(fs.existsSync(path.join(root, 'invalid-module')), false);
  });
  test('an alternate source checkout supplies its own launcher and never silently falls back', () => {
    const sourceRoot = path.join(root, 'alternate source');
    const repo = path.resolve(__dirname, '../..');
    for (const name of ['commands', 'manifests', 'package.json', 'scripts']) {
      fs.cpSync(path.join(repo, name), path.join(sourceRoot, name), { recursive: true });
    }
    const launcher = 'scripts/copilot-plugin-hook.js';
    const source = path.join(sourceRoot, launcher);
    fs.appendFileSync(source, '\n// Fixture launcher from the alternate checkout.\n');
    const alternative = path.join(root, 'alternate artifact');
    buildPlugin({ sourceRoot, output: alternative, moduleIds: ['commands-core'] });
    assert.deepEqual(fs.readFileSync(path.join(alternative, launcher)), fs.readFileSync(source));
    fs.unlinkSync(source);
    const incomplete = path.join(root, 'incomplete artifact');
    assert.throws(() => buildPlugin({ sourceRoot, output: incomplete, moduleIds: ['commands-core'] }), { code: 'ENOENT' });
    assert.equal(fs.existsSync(incomplete), false);
  });
  test('launcher failures malformed outputs and optional events preserve fail-closed pre-tool behavior', () => {
    const plugin = path.join(root, 'fake-plugin');
    const project = path.join(root, 'fake-project'); fs.mkdirSync(project);
    fs.mkdirSync(path.join(plugin, 'scripts/hooks'), { recursive: true });
    const entry = 'scripts/hooks/copilot-hook-adapter.js'; fs.writeFileSync(path.join(plugin, entry), 'fixture');
    const raw = JSON.stringify({ cwd: project });
    const base = { pluginRoot: plugin, entry, args: ['preToolUse'], raw };
    assert.equal(runPluginHook({ ...base, runner: () => ({ status: 0, stdout: '{"permissionDecision":"deny"}', stderr: 'diagnostic' }) }).diagnostic, 'diagnostic');
    for (const result of [{ error: { code: 'ETIMEDOUT' } }, { status: null, signal: 'SIGKILL' }, { status: 0, stdout: '{' }, { status: 0, stdout: '[]' }, { status: 0, stdout: 'null' }]) {
      assert.equal(runPluginHook({ ...base, runner: () => result }).output.permissionDecision, 'deny');
    }
    for (const extra of [{ raw: '{' }, { raw: JSON.stringify({ cwd: 'relative' }) }, { raw: 'x'.repeat(1024 * 1024 + 1) }, { args: undefined }, { args: [null] }]) {
      assert.notEqual(runPluginHook({ ...base, ...extra }).exitCode, undefined);
    }
    const hookify = path.join(plugin, 'scripts/copilot-hookify.js'); fs.writeFileSync(hookify, 'fixture');
    assert.deepEqual(runPluginHook({ ...base, entry: 'scripts/copilot-hookify.js', args: ['hook', 'agentStop'], runner: () => ({ status: 0, stdout: '{}', stderr: '' }) }).output, {});
    fs.mkdirSync(path.join(project, '.github')); fs.writeFileSync(path.join(project, '.github/hooks'), 'not a directory');
    assert.equal(runPluginHook({ ...base, args: ['agentStop'] }).exitCode, 0);
  });
  console.log(`Passed: ${passed}, Failed: 0`);
} finally { fs.rmSync(root, { recursive: true, force: true }); }
