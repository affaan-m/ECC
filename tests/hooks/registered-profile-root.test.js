'use strict';

const assert = require('node:assert/strict');
const { test } = require('node:test');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { spawnSync } = require('node:child_process');

const repoRoot = path.resolve(__dirname, '../..');
const hooks = JSON.parse(fs.readFileSync(path.join(repoRoot, 'hooks/hooks.json'), 'utf8')).hooks;
const bashCommand = hooks.PreToolUse.find(group => group.matcher === 'Bash').hooks[0].command;
const stopCommand = hooks.Stop.flatMap(group => group.hooks)
  .find(hook => hook.command.includes('stop:check-console-log')).command;

function fixture() {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'ecc-registered-profile-'));
  const home = path.join(root, 'home');
  const selected = path.join(root, 'selected');
  const decoy = path.join(home, '.claude', 'scripts', 'hooks');
  fs.mkdirSync(decoy, { recursive: true });
  for (const file of ['plugin-hook-bootstrap.js', 'lifecycle-hook-bootstrap.js']) {
    fs.writeFileSync(path.join(decoy, file), "process.stderr.write('DEFAULT_PROFILE_LOADED');process.exit(9);");
  }
  const env = {
    ...process.env, HOME: home, USERPROFILE: home, CLAUDE_CONFIG_DIR: selected,
    CLAUDE_PLUGIN_ROOT: '', ECC_PLUGIN_ROOT: '', ECC_HOOK_PROFILE: 'standard',
    ECC_HOOKS_ENABLED: undefined, ECC_HOOK_CONFIG: undefined, ECC_DISABLED_HOOKS: '',
    CLAUDE_PLUGIN_OPTION_HOOKS_ENABLED: 'true', CLAUDE_PLUGIN_OPTION_HOOK_PROFILE: 'standard',
  };
  return { root, home, selected, env };
}

function installRuntime(selected) {
  fs.cpSync(path.join(repoRoot, 'scripts'), path.join(selected, 'scripts'), { recursive: true });
  fs.mkdirSync(path.join(selected, 'skills', 'continuous-learning-v2'), { recursive: true });
}

function run(command, item, overrides = {}) {
  return spawnSync(command, {
    shell: true, cwd: item.root, encoding: 'utf8', timeout: 10000,
    env: { ...item.env, ...overrides },
    input: JSON.stringify({ hook_event_name: 'PreToolUse', session_id: 'profile-root-test',
      cwd: item.root, tool_name: 'Bash', tool_input: { command: 'git commit --no-verify -m probe' } }),
  });
}

test('registered Bash and lifecycle hooks use the selected config runtime without plugin root', () => {
  const item = fixture();
  try {
    installRuntime(item.selected);
    const bash = run(bashCommand, item);
    assert.equal(bash.status, 2, bash.stderr);
    assert.match(bash.stderr + bash.stdout, /no-verify/i);
    const stop = run(stopCommand, item);
    assert.equal(stop.status, 0, stop.stderr);
    assert.doesNotMatch(stop.stderr, /DEFAULT_PROFILE_LOADED/);
  } finally {
    fs.rmSync(item.root, { recursive: true, force: true });
  }
});

test('native plugin off option suppresses the actual selected-profile hook', () => {
  const item = fixture();
  try {
    installRuntime(item.selected);
    const result = run(bashCommand, item, { CLAUDE_PLUGIN_OPTION_HOOKS_ENABLED: 'false' });
    assert.equal(result.status, 0, result.stderr);
    assert.equal(result.stdout, '');
    assert.doesNotMatch(result.stderr, /DEFAULT_PROFILE_LOADED|no-verify/i);
  } finally {
    fs.rmSync(item.root, { recursive: true, force: true });
  }
});

test('missing selected runtime never borrows the default profile bootstrap', () => {
  const item = fixture();
  try {
    const result = run(stopCommand, item);
    assert.equal(result.status, 0, result.stderr);
    assert.doesNotMatch(result.stderr, /DEFAULT_PROFILE_LOADED/);
    assert.match(result.stderr, /bootstrap unavailable/);
  } finally {
    fs.rmSync(item.root, { recursive: true, force: true });
  }
});

test('explicit plugin root keeps precedence over the selected fallback', () => {
  const item = fixture();
  try {
    const result = run(bashCommand, item, { CLAUDE_PLUGIN_ROOT: repoRoot });
    assert.equal(result.status, 2, result.stderr);
    assert.match(result.stderr + result.stdout, /no-verify/i);
    assert.doesNotMatch(result.stderr, /DEFAULT_PROFILE_LOADED/);
  } finally {
    fs.rmSync(item.root, { recursive: true, force: true });
  }
});
