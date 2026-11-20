'use strict';

const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { spawnSync } = require('node:child_process');
const { randomUUID } = require('node:crypto');
const { buildAntigravityCliHookCommand } = require('../../scripts/lib/antigravity-cli-bootstrap');
const root = path.resolve(__dirname, '../..');
const bridge = path.join(root, 'scripts/antigravity/hook-bridge.js');
const runtimeHome = fs.mkdtempSync(path.join(os.tmpdir(), 'ecc-agy-test-home-'));
let passed = 0;
let failed = 0;
function test(name, run) {
  try { run(); passed++; console.log(`PASS ${name}`); }
  catch (error) { failed++; console.log(`FAIL ${name}: ${error.stack}`); }
}
function workspace(run) {
  const temporary = fs.mkdtempSync(path.join(os.tmpdir(), 'ecc-agy-boundary-'));
  try { run(temporary); } finally { fs.rmSync(temporary, { recursive: true, force: true }); }
}
function result(command, args, input, cwd, extraEnv = {}, shell = false) {
  const child = spawnSync(command, args, {
    input, cwd, shell, encoding: 'utf8', timeout: 22000, maxBuffer: 2 * 1024 * 1024,
    env: {
      ...process.env, HOME: runtimeHome, USERPROFILE: runtimeHome,
      XDG_CONFIG_HOME: path.join(runtimeHome, 'config'), ECC_AGENT_DATA_HOME: path.join(runtimeHome, 'data'),
      ECC_HOOK_CONFIG: path.join(runtimeHome, 'hooks.json'), CLAUDE_SESSION_ID: randomUUID(),
      ECC_HOOKS_ENABLED: 'true', ECC_DRY_RUN: '0', ECC_HOOK_PROFILE: 'standard', ECC_DISABLED_HOOKS: '', ...extraEnv,
    },
  });
  assert.equal(child.status, 0, child.stderr);
  return JSON.parse(child.stdout);
}
function manifest(input, cwd, env = {}) {
  const raw = JSON.stringify(input);
  const generated = result(buildAntigravityCliHookCommand(), [], raw, cwd, env, true);
  // Exercise the original function as a module too: generated Node source has
  // no file identity for coverage and must keep the same boundary decisions.
  const loaded = result(process.execPath, [
    '-e', 'require(process.argv[1]).bootstrap()',
    path.join(root, 'scripts/lib/antigravity-cli-bootstrap.js'), '--hook', 'config-protection',
  ], raw, cwd, env);
  assert.deepEqual(loaded, generated, 'Module and published bootstrap must agree');
  return generated;
}
function sentinel(directory, marker) {
  const script = path.join(directory, 'scripts/antigravity/hook-bridge.js');
  fs.mkdirSync(path.dirname(script), { recursive: true });
  fs.writeFileSync(script, `require('fs').writeFileSync(${JSON.stringify(marker)}, 'executed'); module.exports={};`);
}

test('both published manifests use the same bounded first-party bootstrap', () => {
  for (const file of ['hooks/antigravity-hooks.json', '.antigravity-plugin/hooks.json']) {
    const manifest = JSON.parse(fs.readFileSync(path.join(root, file)));
    assert.equal(manifest['ecc-guardrails'].PreToolUse[0].hooks[0].command, buildAntigravityCliHookCommand());
  }
});

test('external canonical runtime preserves allow, deny and explicit bootstrap bypasses', () => workspace(temporary => {
  fs.writeFileSync(path.join(temporary, 'app.js'), 'export default 1;');
  fs.writeFileSync(path.join(temporary, 'eslint.config.js'), 'module.exports = [];');
  for (const [file, expected] of [['app.js', 'allow'], ['eslint.config.js', 'deny']]) {
    const payload = {
      workspacePaths: [temporary],
      toolCall: { name: 'edit_file', args: { Path: path.join(temporary, file) } },
    };
    assert.equal(manifest(payload, temporary, { ANTIGRAVITY_PLUGIN_ROOT: root }).decision, expected);
  }
  assert.equal(manifest({}, temporary, { ECC_HOOKS_ENABLED: 'false' }).decision, 'allow');
  assert.equal(manifest({}, temporary, { ECC_DRY_RUN: '1' }).decision, 'allow');
}));

test('nested cwd cannot authorize a bridge anywhere inside the declared outer workspace', () => workspace(temporary => {
  const nested = path.join(temporary, 'src'); fs.mkdirSync(nested);
  const candidate = path.join(temporary, 'plugin'); const marker = path.join(temporary, 'executed');
  sentinel(candidate, marker);
  assert.equal(manifest({ workspacePaths: [temporary] }, nested, { ANTIGRAVITY_PLUGIN_ROOT: candidate }).decision, 'deny');
  assert.equal(fs.existsSync(marker), false);
}));

test('secondary workspace roots and symlink aliases cannot authorize imports', () => workspace(temporary => {
  const first = path.join(temporary, 'first'); const second = path.join(temporary, 'second');
  fs.mkdirSync(first); fs.mkdirSync(second);
  const candidate = path.join(second, 'plugin'); const marker = path.join(temporary, 'executed');
  sentinel(candidate, marker);
  assert.equal(manifest({ workspacePaths: [first, second] }, first, { ANTIGRAVITY_PLUGIN_ROOT: candidate }).decision, 'deny');
  assert.equal(fs.existsSync(marker), false);
  const alias = path.join(temporary, 'alias');
  try { fs.symlinkSync(candidate, alias, process.platform === 'win32' ? 'junction' : 'dir'); }
  catch (error) { if (process.platform === 'win32' && error.code === 'EPERM') return; throw error; }
  assert.equal(manifest({ workspacePaths: [first, second] }, first, { ANTIGRAVITY_PLUGIN_ROOT: alias }).decision, 'deny');
  assert.equal(fs.existsSync(marker), false);
}));

test('a workspace-owned root alias cannot grant authority to an outside target', () => workspace(temporary => {
  const directory = path.join(temporary, 'workspace'); fs.mkdirSync(directory);
  const candidate = path.join(temporary, 'external'); const marker = path.join(temporary, 'executed');
  sentinel(candidate, marker);
  const alias = path.join(directory, 'plugin');
  try { fs.symlinkSync(candidate, alias, process.platform === 'win32' ? 'junction' : 'dir'); }
  catch (error) { if (process.platform === 'win32' && error.code === 'EPERM') return; throw error; }
  assert.equal(manifest({ workspacePaths: [directory] }, directory, { ANTIGRAVITY_PLUGIN_ROOT: alias }).decision, 'deny');
  const ancestor = path.join(temporary, 'access');
  fs.symlinkSync(directory, ancestor, process.platform === 'win32' ? 'junction' : 'dir');
  assert.equal(manifest({ workspacePaths: [directory] }, directory, { ANTIGRAVITY_PLUGIN_ROOT: path.join(ancestor, 'plugin') }).decision, 'deny');
  assert.equal(fs.existsSync(marker), false);
}));

test('enclosing Git roots and linked-worktree common directories remain excluded', () => workspace(temporary => {
  const repository = path.join(temporary, 'repository'); const nested = path.join(repository, 'src');
  const git = path.join(repository, '.git'); const linked = path.join(temporary, 'linked');
  fs.mkdirSync(nested, { recursive: true }); fs.mkdirSync(git); fs.mkdirSync(linked);
  const metadata = path.join(git, 'worktrees', 'linked'); fs.mkdirSync(metadata, { recursive: true });
  fs.writeFileSync(path.join(metadata, 'commondir'), '../..');
  fs.writeFileSync(path.join(linked, '.git'), `gitdir: ${metadata}`);
  const marker = path.join(temporary, 'executed'); sentinel(linked, marker);
  assert.equal(manifest({ workspacePaths: [nested] }, nested, { ANTIGRAVITY_PLUGIN_ROOT: linked }).decision, 'deny');
  assert.equal(manifest({}, nested, { ANTIGRAVITY_PLUGIN_ROOT: linked }).decision, 'deny');
  const other = path.join(temporary, 'other'); fs.mkdirSync(other);
  assert.equal(manifest({ workspacePaths: [other, nested] }, other, { ANTIGRAVITY_PLUGIN_ROOT: linked }).decision, 'deny');
  assert.equal(fs.existsSync(marker), false);
}));

test('invalid workspace metadata fails closed before loading candidate code', () => workspace(temporary => {
  const candidate = path.join(temporary, 'plugin'); const marker = path.join(temporary, 'executed');
  sentinel(candidate, marker);
  for (const workspacePaths of [null, [], [3], ['relative'], Array(33).fill(temporary), [path.join(temporary, 'missing')]]) {
    assert.equal(manifest({ workspacePaths }, temporary, { ANTIGRAVITY_PLUGIN_ROOT: candidate }).decision, 'deny');
  }
  assert.equal(fs.existsSync(marker), false);
}));

test('a Git identity pointing to a regular file cannot establish an import boundary', () => workspace(temporary => {
  const directory = path.join(temporary, 'workspace'); fs.mkdirSync(directory);
  const invalidGit = path.join(temporary, 'regular-file'); fs.writeFileSync(invalidGit, 'not a Git directory');
  fs.writeFileSync(path.join(directory, '.git'), `gitdir: ${invalidGit}`);
  const candidate = path.join(temporary, 'external'); const marker = path.join(temporary, 'executed');
  sentinel(candidate, marker);
  assert.equal(manifest({ workspacePaths: [directory] }, directory, { ANTIGRAVITY_PLUGIN_ROOT: candidate }).decision, 'deny');
  assert.equal(fs.existsSync(marker), false);
}));

test('active bridge denies malformed, null, array, oversized and unknown-hook input', () => {
  for (const raw of ['{', 'null', '[]', '3', 'x'.repeat(1024 * 1024 + 1)]) {
    assert.equal(result(process.execPath, [bridge, '--hook', 'config-protection'], raw, root).decision, 'deny');
  }
  assert.equal(result(process.execPath, [bridge, '--hook', 'not-a-hook'], '{}', root).decision, 'deny');
});

test('oversized native envelopes cannot import even an external candidate', () => workspace(temporary => {
  const directory = path.join(temporary, 'workspace'); fs.mkdirSync(directory);
  const candidate = path.join(temporary, 'external'); const marker = path.join(temporary, 'executed');
  sentinel(candidate, marker);
  const payload = { workspacePaths: [directory], padding: 'x'.repeat(1024 * 1024) };
  assert.equal(manifest(payload, directory, { ANTIGRAVITY_PLUGIN_ROOT: candidate }).decision, 'deny');
  assert.equal(fs.existsSync(marker), false);
}));

test('canonical exit-zero nested permission denials remain denials', () => {
  const payload = { toolCall: { name: 'run_command', args: { CommandLine: 'git push --force origin main' } } };
  assert.equal(result(process.execPath, [bridge, '--hook', 'gateguard-fact-force'], JSON.stringify(payload), root).decision, 'deny');
});

test('canonical minimal-profile Bash guards stay active and explicit opt-outs stay explicit', () => {
  const payload = JSON.stringify({ toolCall: { name: 'run_command', args: { CommandLine: 'git commit --no-verify' } } });
  assert.equal(result(process.execPath, [bridge, '--hook', 'block-no-verify'], payload, root, { ECC_HOOK_PROFILE: 'minimal' }).decision, 'deny');
  assert.equal(result(process.execPath, [bridge, '--hook', 'block-no-verify'], payload, root, { ECC_DISABLED_HOOKS: 'block-no-verify' }).decision, 'allow');
  assert.equal(result(process.execPath, [bridge, '--hook', 'config-protection'], '{', root, { ECC_HOOKS_ENABLED: 'false' }).decision, 'allow');
  assert.equal(result(process.execPath, [bridge, '--hook', 'config-protection'], '{', root, { ECC_DRY_RUN: '1' }).decision, 'allow');
});

test('canonical child errors, signals, unknown verdicts and timeout fail closed', () => workspace(temporary => {
  const directory = path.join(temporary, 'scripts');
  fs.mkdirSync(path.join(directory, 'antigravity'), { recursive: true });
  fs.mkdirSync(path.join(directory, 'hooks')); fs.mkdirSync(path.join(directory, 'lib'));
  fs.copyFileSync(bridge, path.join(directory, 'antigravity/hook-bridge.js'));
  fs.copyFileSync(path.join(root, 'scripts/hooks/hook-input.js'), path.join(directory, 'hooks/hook-input.js'));
  fs.writeFileSync(path.join(directory, 'lib/hook-flags.js'), 'module.exports={areHooksEnabled:()=>true,isDryRun:()=>false,getDisabledHookIds:()=>new Set()};');
  const canonical = path.join(directory, 'hooks/antigravity-hook-bridge.js');
  const payload = JSON.stringify({ toolCall: { name: 'edit_file', args: { Path: 'app.js' } } });
  fs.writeFileSync(canonical, 'console.log(JSON.stringify({decision:"allow"}))');
  assert.equal(result(process.execPath, [path.join(directory, 'antigravity/hook-bridge.js'), '--hook', 'config-protection'], payload, temporary).decision, 'allow');
  for (const source of ['process.exit(1)', 'process.kill(process.pid,"SIGTERM")', 'console.log("{}")', 'process.stdout.write("x".repeat(2*1024*1024))', 'setInterval(()=>{},1000)']) {
    fs.writeFileSync(canonical, source);
    const started = Date.now();
    assert.equal(result(process.execPath, [path.join(directory, 'antigravity/hook-bridge.js'), '--hook', 'config-protection'], payload, temporary).decision, 'deny');
    if (source.startsWith('setInterval')) assert.ok(Date.now() - started >= 14000, 'The actual canonical child timeout must run');
  }
}));

console.log(`Passed: ${passed}`);
console.log(`Failed: ${failed}`);
fs.rmSync(runtimeHome, { recursive: true, force: true });
process.exitCode = failed ? 1 : 0;
