'use strict';

const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const test = require('node:test');
const { withFixture } = require('./helpers/context-fixture');
const store = require('../../scripts/lib/context-profile-store');
const native = () => require('../../scripts/lib/context-profile-native');

function fixture(callback) {
  return withFixture(repoRoot => {
    const parent = fs.mkdtempSync(path.join(fs.realpathSync(os.tmpdir()), 'ecc-native-claude-test-'));
    const options = { stateRoot: path.join(parent, 'managed'), nativeRoot: path.join(parent, 'native'), claudePath: process.execPath };
    try {
      store.applyStore({ repoRoot, stateRoot: options.stateRoot, target: 'claude' });
      return callback(options, repoRoot, parent);
    } finally { fs.rmSync(parent, { recursive: true, force: true }); }
  });
}

function details(pluginDir, overrides) {
  const skills = fs.readdirSync(path.join(pluginDir, 'skills')).sort();
  const counts = { agents: 0, hooks: 0, mcp: 0, lsp: 0, ...overrides.counts };
  return ['ecc-context-carrier', '  Source: ecc-context-carrier@inline', '', 'Component inventory',
    `  Skills (${skills.length})  ${skills.join(', ')}`, `  Agents (${counts.agents})`, `  Hooks (${counts.hooks})`,
    `  MCP servers (${counts.mcp})`, `  LSP servers (${counts.lsp})`, '', 'Projected token cost',
    `  Always-on:   ${overrides.alwaysOn || '~1,398 tok'}   added to every session`, ''].join('\n');
}

function provider(overrides = {}) {
  const calls = [];
  const execute = (command, args, options) => {
    calls.push({ command, args, options });
    assert.equal(options.killSignal, 'SIGKILL');
    assert.equal(options.shell, false);
    for (const key of ['ANTHROPIC_API_KEY', 'OPENAI_API_KEY', 'NODE_OPTIONS', 'HTTP_PROXY', 'AWS_ACCESS_KEY_ID', 'CODEX_HOME']) {
      assert.equal(options.env[key], undefined);
    }
    assert.equal(options.env.CLAUDE_CONFIG_DIR, path.join(options.env.HOME, '.claude'));
    assert.equal(options.env.CLAUDE_CODE_DISABLE_NONESSENTIAL_TRAFFIC, '1');
    assert.equal(options.env.CLAUDE_CODE_DISABLE_OFFICIAL_MARKETPLACE_AUTOINSTALL, '1');
    assert.equal(options.cwd, path.join(path.dirname(options.env.HOME), 'project'));
    if (args[0] === '--version') return { status: 0, stdout: `${overrides.version || '2.1.292 (Claude Code)'}\n` };
    if (args[0] === 'plugin' && args[1] === 'validate') {
      const report = { success: true, manifest: { errors: [], warnings: [] }, contents: [] };
      return { status: 0, stdout: JSON.stringify(overrides.validate ? overrides.validate(report) : report) };
    }
    const pluginDir = args[1];
    if (overrides.tamper) overrides.tamper(pluginDir);
    if (args[3] === 'list') {
      const plugins = [{ id: 'ecc-context-carrier@inline', version: 'unknown', scope: 'session', enabled: true, installPath: pluginDir }];
      return { status: 0, stdout: JSON.stringify(overrides.list ? overrides.list(plugins) : plugins) };
    }
    if (args[3] === 'details') return { status: 0, stdout: details(pluginDir, overrides) };
    return { status: 1, stderr: 'unexpected command' };
  };
  return { execute, calls, ...overrides };
}

test('Claude preview is deterministic and never invokes the provider or creates a home', () => fixture(options => {
  const first = native().previewNativeProfile(options);
  assert.deepEqual(first, native().previewNativeProfile(options));
  assert.equal(first.target, 'claude');
  assert.equal(first.status, 'proposed');
  assert.deepEqual(first.supportedProviderVersions, ['>=2.1.292 <2.2.0']);
  assert.equal(fs.existsSync(options.nativeRoot), false);
}));

test('Claude prepare verifies session-only discovery and records the host token projection', () => fixture(options => {
  const dependency = provider();
  const result = native().prepareNativeProfile(options, dependency);
  assert.equal(result.status, 'ready');
  assert.equal(result.target, 'claude');
  assert.equal(result.providerVersion, '2.1.292');
  assert.equal(result.discovery, 'verified');
  assert.equal(result.codexHome, null);
  assert.equal(result.claudeConfigDir, path.join(result.home, '.claude'));
  assert.equal(result.pluginDir, path.join(path.dirname(result.home), 'plugin'));
  assert.equal(result.claudePath, process.execPath);
  assert.deepEqual(result.nativeObservation, { surface: 'plugin-always-on-listing',
    method: 'claude-plugin-details@2.1.292', tokens: 1398, approximate: true });
  assert.equal(result.selectedIds.length, 3);
  assert.match(fs.readFileSync(path.join(result.claudeConfigDir, 'CLAUDE.md'), 'utf8'), /grants no tools/);
  assert.equal(fs.existsSync(path.join(result.home, '.codex')), false);
  const pluginCalls = dependency.calls.filter(call => call.args.includes('--plugin-dir'));
  assert.deepEqual(pluginCalls.map(call => call.args.slice(2)), [['plugin', 'list', '--json'], ['plugin', 'details', 'ecc-context-carrier']]);
  assert.ok(pluginCalls.every(call => call.args[1] === result.pluginDir));
  assert.equal(native().getNativeProfileStatus(options).status, 'ready');
}));

for (const version of ['2.1.293 (Claude Code)', '2.1.1000 (Claude Code)']) {
  test(`Claude version gate admits later 2.1 patch "${version}" and records it exactly`, () => fixture(options => {
    const result = native().prepareNativeProfile(options, provider({ version }));
    assert.equal(result.providerVersion, version.split(' ')[0]);
    assert.equal(native().getNativeProfileStatus(options).providerVersion, version.split(' ')[0]);
  }));
}

for (const version of ['2.1.291 (Claude Code)', '2.1.292', '2.1.292 (Claude Code) extra', '2.2.0 (Claude Code)',
  '2.1.292-beta (Claude Code)', '3.1.292 (Claude Code)', '02.1.292 (Claude Code)']) {
  test(`Claude version gate rejects "${version}" before plugin calls`, () => fixture(options => {
    const dependency = provider({ version });
    assert.throws(() => native().prepareNativeProfile(options, dependency), /version/i);
    assert.equal(dependency.calls.some(call => call.args.includes('plugin')), false);
  }));
}

const corruptions = {
  'validation error': [{ validate: report => ({ ...report, success: false, manifest: { errors: [{ path: 'skills' }] } }) }, /plugin validation failed/],
  'extra plugin': [{ list: plugins => [...plugins, { id: 'other@market', scope: 'user', enabled: true, installPath: '/elsewhere' }] }, /plugin discovery mismatch/],
  'moved plugin': [{ list: plugins => [{ ...plugins[0], installPath: '/elsewhere' }] }, /plugin discovery mismatch/],
  'disabled plugin': [{ list: plugins => [{ ...plugins[0], enabled: false }] }, /plugin discovery mismatch/],
  'extra agent': [{ counts: { agents: 1 } }, /component discovery mismatch/],
  'extra hook': [{ counts: { hooks: 1 } }, /component discovery mismatch/],
  'extra MCP server': [{ counts: { mcp: 1 } }, /component discovery mismatch/],
  'unparseable token projection': [{ alwaysOn: 'unknown' }, /token projection/],
  'tampered plugin bytes': [{ tamper: pluginDir => fs.appendFileSync(path.join(pluginDir, 'skills/ecc-guide/SKILL.md'), 'tamper') },
    /file set or digest mismatch/],
};
for (const [label, [overrides, expected]] of Object.entries(corruptions)) {
  test(`Claude ${label} never commits a ready pointer`, () => fixture(options => {
    assert.throws(() => native().prepareNativeProfile(options, provider(overrides)), expected);
    assert.equal(fs.existsSync(path.join(options.nativeRoot, 'state.json')), false);
  }));
}

test('Claude details skill mismatch never commits a ready pointer', () => fixture(options => {
  const dependency = provider();
  const execute = dependency.execute;
  dependency.execute = (command, args, config) => {
    const result = execute(command, args, config);
    return args[3] === 'details' ? { ...result, stdout: result.stdout.replace(', ecc-guide', '') } : result;
  };
  assert.throws(() => native().prepareNativeProfile(options, dependency), /component discovery mismatch/);
  assert.equal(fs.existsSync(path.join(options.nativeRoot, 'state.json')), false);
}));

test('Claude plugin bytes and added user skills reject static readiness', () => fixture(options => {
  const prepared = native().prepareNativeProfile(options, provider());
  fs.mkdirSync(path.join(prepared.claudeConfigDir, 'skills/extra'), { recursive: true });
  fs.writeFileSync(path.join(prepared.claudeConfigDir, 'skills/extra/SKILL.md'), 'extra');
  assert.throws(() => native().getNativeProfileStatus(options), /changed/);
  fs.rmSync(path.join(prepared.claudeConfigDir, 'skills'), { recursive: true });
  assert.equal(native().getNativeProfileStatus(options).ready, true);
  fs.appendFileSync(path.join(prepared.pluginDir, 'skills/ecc-guide/SKILL.md'), 'tamper');
  assert.throws(() => native().getNativeProfileStatus(options), /changed/);
}));

test('Claude provider runtime state outside discovery controls keeps readiness', () => fixture(options => {
  const prepared = native().prepareNativeProfile(options, provider());
  fs.writeFileSync(path.join(prepared.claudeConfigDir, '.claude.json'), '{"numStartups":1}');
  fs.mkdirSync(path.join(prepared.claudeConfigDir, 'projects/session'), { recursive: true });
  assert.equal(native().getNativeProfileStatus(options).status, 'ready');
}));

test('Claude provider homes are never accepted as the native root', () => fixture(options => {
  const dependency = provider();
  const previous = process.env.CLAUDE_CONFIG_DIR;
  const configured = path.join(path.dirname(options.nativeRoot), 'configured-claude');
  process.env.CLAUDE_CONFIG_DIR = configured;
  try {
    for (const root of [path.join(os.homedir(), '.claude'), configured]) {
      assert.throws(() => native().prepareNativeProfile({ ...options, nativeRoot: root }, dependency), /dedicated/);
    }
  } finally {
    if (previous === undefined) delete process.env.CLAUDE_CONFIG_DIR; else process.env.CLAUDE_CONFIG_DIR = previous;
  }
  assert.equal(dependency.calls.length, 0);
}));

test('a Codex generation becomes stale when the managed store targets Claude', () => fixture((options, repoRoot) => {
  store.applyStore({ repoRoot, stateRoot: options.stateRoot, target: 'codex' });
  const codex = provider();
  codex.execute = (_command, args) => args[0] === '--version' ? { status: 0, stdout: 'codex-cli 0.154.0' } : { status: 0, stdout: '{}' };
  codex.discover = (_command, config) => {
    const base = path.dirname(config.env.HOME);
    const name = JSON.parse(fs.readFileSync(path.join(base, 'marketplace/.agents/plugins/marketplace.json'))).name;
    const cache = path.join(config.env.CODEX_HOME, 'plugins/cache', name, 'ecc-context-carrier/local');
    fs.mkdirSync(path.dirname(cache), { recursive: true });
    fs.cpSync(path.join(base, 'marketplace/carrier'), cache, { recursive: true });
    return { data: [{ cwd: config.cwd, errors: [], skills: fs.readdirSync(path.join(cache, 'skills')).map(skill => ({
      name: `ecc-context-carrier:${skill}`, pluginId: `ecc-context-carrier@${name}`, enabled: true, scope: 'user',
      path: path.join(cache, 'skills', skill, 'SKILL.md') })) }] };
  };
  const first = native().prepareNativeProfile({ ...options, codexPath: process.execPath, claudePath: undefined }, codex);
  assert.equal(first.target, 'codex');
  store.applyStore({ repoRoot, stateRoot: options.stateRoot, target: 'claude' });
  assert.equal(native().getNativeProfileStatus(options).status, 'stale');
  const second = native().prepareNativeProfile(options, provider());
  assert.equal(second.target, 'claude');
  assert.equal(second.revision, first.revision + 1);
}));

test('Claude task launch loads the verified plugin directory in the isolated home', () => fixture(options => {
  const prepared = native().prepareNativeProfile(options, provider());
  const { launchTaskContext } = require('../../scripts/lib/context-profile-launch');
  let called = false;
  launchTaskContext({ task: { sessionId: 's', taskId: 't', revision: 1, phase: 'p', query: 'hello', noWorkflow: true },
    target: 'claude', nativeEnvironment: { home: prepared.home, claudeConfigDir: prepared.claudeConfigDir,
      claudePath: prepared.claudePath, pluginDir: prepared.pluginDir, executableDigest: prepared.executableDigest },
    execute(command, args, config) {
      called = true;
      assert.equal(command, prepared.claudePath);
      assert.deepEqual(args, ['--plugin-dir', prepared.pluginDir, '--print']);
      assert.equal(config.env.CLAUDE_CONFIG_DIR, prepared.claudeConfigDir);
      assert.equal(config.env.CLAUDE_CODE_DISABLE_OFFICIAL_MARKETPLACE_AUTOINSTALL, '1');
      assert.equal(config.env.CODEX_HOME, undefined);
      return { status: 0, stdout: 'ok' };
    } });
  assert.equal(called, true);
}));

test('Claude interactive start launches the pinned binary with the verified plugin directory', () => {
  const parent = fs.mkdtempSync(path.join(fs.realpathSync(os.tmpdir()), 'ecc-native-claude-start-'));
  const options = { stateRoot: path.join(parent, 'managed'), nativeRoot: path.join(parent, 'native') };
  try {
    store.applyStore({ stateRoot: options.stateRoot, target: 'claude' });
    const prepared = native().prepareNativeProfile({ ...options, claudePath: process.execPath }, provider());
    const { startInteractiveProfile } = require('../../scripts/lib/context-profile-interactive');
    let call;
    const result = startInteractiveProfile(options,
      { execute: (command, args, config) => { call = { command, args, config }; return { status: 0 }; } });
    assert.equal(call.command, prepared.claudePath);
    assert.deepEqual(call.args, ['--plugin-dir', prepared.pluginDir]);
    assert.equal(call.config.env.CLAUDE_CONFIG_DIR, prepared.claudeConfigDir);
    assert.equal(call.config.env.CLAUDE_CODE_DISABLE_OFFICIAL_MARKETPLACE_AUTOINSTALL, '1');
    assert.equal(call.config.env.CODEX_HOME, undefined);
    assert.equal(call.config.stdio, 'inherit');
    assert.equal(result.status, 'exited');
    assert.match(result.bootstrapDigest, /^[a-f0-9]{64}$/);
  } finally { fs.rmSync(parent, { recursive: true, force: true }); }
});
