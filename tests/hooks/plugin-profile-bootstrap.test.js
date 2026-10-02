'use strict';

const assert = require('assert');
const fs = require('fs');
const os = require('os');
const path = require('path');
const { spawnSync } = require('child_process');
const { resolveEccRoot, INLINE_RESOLVE } = require('../../scripts/lib/resolve-ecc-root');

const repo = path.resolve(__dirname, '../..');
const registry = JSON.parse(fs.readFileSync(path.join(repo, 'hooks/hooks.json'), 'utf8'));
const commands = Object.values(registry.hooks).flatMap(entries => entries.flatMap(entry => entry.hooks.map(hook => hook.command)));
let failed = 0;
let passed = 0;

function fixture(fn) {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'ecc-plugin-profile-'));
  try { fn(root); } finally { fs.rmSync(root, { recursive: true, force: true }); }
}

function write(root, relative, content) {
  const target = path.join(root, relative);
  fs.mkdirSync(path.dirname(target), { recursive: true });
  fs.writeFileSync(target, content);
}

function environment(home, config, extra = {}) {
  return { ...process.env, HOME: home, USERPROFILE: home, CLAUDE_CONFIG_DIR: config,
    CLAUDE_PLUGIN_ROOT: '', ECC_PLUGIN_ROOT: '', ECC_HOOKS_ENABLED: '',
    CLAUDE_PLUGIN_OPTION_HOOKS_ENABLED: '', ...extra };
}

function inline(command, env) {
  const match = command.match(/^node -e "([^"]*)"/);
  assert.ok(match, 'registered hook should retain its inline Node entry');
  return spawnSync(process.execPath, ['-e', match[1], 'node', 'scripts/hooks/session-start-bootstrap.js'],
    { env, input: '{}', encoding: 'utf8', timeout: 10000 });
}

function test(name, fn) {
  try { fixture(fn); passed++; console.log(`PASS ${name}`); }
  catch (error) { failed++; console.error(`FAIL ${name}: ${error.message}`); }
}

test('resolver honors the active config directory instead of a competing default profile', root => {
  const config = path.join(root, 'profile with spaces');
  for (const directory of [config, path.join(root, '.claude')]) {
    write(directory, 'scripts/lib/utils.js', '');
    fs.mkdirSync(path.join(directory, 'skills/continuous-learning-v2'), { recursive: true });
  }
  const previous = process.env.CLAUDE_CONFIG_DIR;
  try {
    process.env.CLAUDE_CONFIG_DIR = config;
    assert.strictEqual(resolveEccRoot({ homeDir: root, envRoot: '' }), config);
    assert.strictEqual(resolveEccRoot({ homeDir: root, envRoot: '/explicit-plugin-root' }), '/explicit-plugin-root');
  } finally {
    if (previous === undefined) delete process.env.CLAUDE_CONFIG_DIR;
    else process.env.CLAUDE_CONFIG_DIR = previous;
  }
});

test('registered SessionStart discovers a plugin cache inside the active profile', root => {
  const config = path.join(root, 'profile with spaces');
  const cache = path.join(config, 'plugins/cache/ecc/example/2.2.2');
  write(cache, 'scripts/lib/resolve-ecc-root.js', fs.readFileSync(path.join(repo, 'scripts/lib/resolve-ecc-root.js')));
  write(cache, 'scripts/lib/utils.js', '');
  fs.mkdirSync(path.join(cache, 'skills/continuous-learning-v2'), { recursive: true });
  write(cache, 'scripts/hooks/plugin-hook-bootstrap.js', "process.stdout.write('active-profile');");
  const result = inline(registry.hooks.SessionStart[0].hooks[0].command, environment(root, config));
  assert.strictEqual(result.status, 0, result.stderr);
  assert.strictEqual(result.stdout, 'active-profile');
  const overridden = inline(registry.hooks.SessionStart[0].hooks[0].command, environment(root, config, {
    ECC_HOOKS_ENABLED: 'true', CLAUDE_PLUGIN_OPTION_HOOKS_ENABLED: 'false',
  }));
  assert.strictEqual(overridden.status, 0, overridden.stderr);
  assert.strictEqual(overridden.stdout, 'active-profile', 'explicit ECC flag keeps its established precedence');
});

test('every registered hook stops before root lookup when plugin automation is disabled', root => {
  for (const command of commands) {
    const result = inline(command, environment(root, path.join(root, 'missing-profile'), {
      ECC_HOOKS_ENABLED: undefined, CLAUDE_PLUGIN_OPTION_HOOKS_ENABLED: 'false',
    }));
    assert.strictEqual(result.status, 0, result.stderr);
    assert.strictEqual(result.stdout, '');
    assert.strictEqual(result.stderr, '');
  }
});

test('older cached resolvers cannot switch away from the active profile', root => {
  const config = path.join(root, 'active profile');
  const cache = path.join(config, 'plugins/cache/ecc/example/old');
  const defaultProfile = path.join(root, '.claude');
  for (const directory of [cache, defaultProfile]) {
    write(directory, 'scripts/lib/utils.js', '');
    fs.mkdirSync(path.join(directory, 'skills/continuous-learning-v2'), { recursive: true });
  }
  write(cache, 'scripts/lib/resolve-ecc-root.js',
    "exports.resolveEccRoot=()=>require('path').join(require('os').homedir(),'.claude');");
  const probe = () => spawnSync(process.execPath, ['-e', `process.stdout.write(String(${INLINE_RESOLVE}))`], {
    env: environment(root, config), encoding: 'utf8', timeout: 10000,
  });
  const complete = probe();
  assert.strictEqual(complete.status, 0, complete.stderr);
  assert.strictEqual(complete.stdout, cache);
  fs.rmSync(path.join(cache, 'skills/continuous-learning-v2'), { recursive: true });
  const partial = probe();
  assert.strictEqual(partial.status, 0, partial.stderr);
  assert.strictEqual(partial.stdout, config);
});

test('Codex disabled hooks do not require a plugin root', root => {
  const codex = JSON.parse(fs.readFileSync(path.join(repo, 'hooks/codex-hooks.json'), 'utf8'));
  const result = inline(codex.hooks.SessionStart[0].hooks[0].command, environment(root, root, {
    PLUGIN_ROOT: undefined, ECC_HOOKS_ENABLED: 'false',
  }));
  assert.strictEqual(result.status, 0, result.stderr);
  assert.strictEqual(result.stdout, '');
  assert.strictEqual(result.stderr, '');
});

test('direct bootstrap honors the global flag before spawning a target', root => {
  write(root, 'probe.js', "process.stdout.write('must-not-run');");
  const result = spawnSync(process.execPath, [path.join(repo, 'scripts/hooks/plugin-hook-bootstrap.js'), 'node', 'probe.js'], {
    env: environment(root, root, { CLAUDE_PLUGIN_ROOT: root, ECC_HOOKS_ENABLED: 'false' }),
    input: '{}', encoding: 'utf8', timeout: 10000,
  });
  assert.strictEqual(result.status, 0, result.stderr);
  assert.strictEqual(result.stdout, '');
});

console.log(`Passed: ${passed}, Failed: ${failed}`);
process.exitCode = failed ? 1 : 0;
