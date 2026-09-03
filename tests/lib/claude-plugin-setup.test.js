'use strict';

const assert = require('assert');
const fs = require('fs');
const os = require('os');
const path = require('path');

const repoRoot = path.join(__dirname, '..', '..');
const fakeClaudeScript = path.join(repoRoot, 'tests', 'fixtures', 'fake-claude-plugin.js');
const {
  OFFICIAL_MARKETPLACE_URL,
  buildWindowsCommandLine,
  isOfficialMarketplace,
  runClaude,
  setupClaudePlugin,
} = require('../../scripts/lib/claude-plugin-setup');

let passed = 0;
let failed = 0;

function test(name, fn) {
  try {
    fn();
    console.log(`  ✓ ${name}`);
    passed += 1;
  } catch (error) {
    console.log(`  ✗ ${name}`);
    console.log(`    Error: ${error.message}`);
    failed += 1;
  }
}

function createFixture(initialState = {}) {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'ecc plugin setup '));
  const homeDir = path.join(root, 'home with spaces');
  const configDir = path.join(root, 'claude config with spaces');
  const projectRoot = path.join(root, 'project with spaces');
  const binDir = path.join(root, 'bin with spaces');
  const statePath = path.join(root, 'claude-state.json');
  const callsPath = path.join(root, 'claude-calls.jsonl');

  for (const dir of [homeDir, configDir, projectRoot, binDir]) {
    fs.mkdirSync(dir, { recursive: true });
  }
  fs.writeFileSync(statePath, `${JSON.stringify({
    plugins: [],
    marketplaces: [],
    failures: [],
    ...initialState,
  }, null, 2)}\n`);

  const launcher = path.join(binDir, process.platform === 'win32' ? 'claude.cmd' : 'claude');
  const launcherSource = process.platform === 'win32'
    ? `@echo off\r\n"${process.execPath}" "${fakeClaudeScript}" %*\r\n`
    : `#!/bin/sh\nexec "${process.execPath}" "${fakeClaudeScript}" "$@"\n`;
  fs.writeFileSync(launcher, launcherSource);
  if (process.platform !== 'win32') fs.chmodSync(launcher, 0o755);

  return {
    root,
    homeDir,
    configDir,
    projectRoot,
    binDir,
    statePath,
    callsPath,
    settingsPath: path.join(configDir, 'settings.json'),
  };
}

function cleanupFixture(fixture) {
  fs.rmSync(fixture.root, { recursive: true, force: true });
}

function withFixture(initialState, fn) {
  const fixture = createFixture(initialState);
  const previous = {
    cwd: process.cwd(),
    HOME: process.env.HOME,
    USERPROFILE: process.env.USERPROFILE,
    PATH: process.env.PATH,
    CLAUDE_CONFIG_DIR: process.env.CLAUDE_CONFIG_DIR,
    ECC_TEST_CLAUDE_STATE: process.env.ECC_TEST_CLAUDE_STATE,
    ECC_TEST_CLAUDE_CALLS: process.env.ECC_TEST_CLAUDE_CALLS,
  };
  try {
    process.chdir(fixture.projectRoot);
    process.env.HOME = fixture.homeDir;
    process.env.USERPROFILE = fixture.homeDir;
    process.env.PATH = `${fixture.binDir}${path.delimiter}${previous.PATH || ''}`;
    process.env.CLAUDE_CONFIG_DIR = fixture.configDir;
    process.env.ECC_TEST_CLAUDE_STATE = fixture.statePath;
    process.env.ECC_TEST_CLAUDE_CALLS = fixture.callsPath;
    return fn(fixture);
  } finally {
    process.chdir(previous.cwd);
    for (const [key, value] of Object.entries(previous)) {
      if (key === 'cwd') continue;
      if (value === undefined) delete process.env[key];
      else process.env[key] = value;
    }
    cleanupFixture(fixture);
  }
}

function setupOptions(fixture, overrides = {}) {
  return {
    hooks: 'standard',
    homeDir: fixture.homeDir,
    configDir: fixture.configDir,
    projectRoot: fixture.projectRoot,
    ...overrides,
  };
}

function readCalls(fixture) {
  if (!fs.existsSync(fixture.callsPath)) return [];
  return fs.readFileSync(fixture.callsPath, 'utf8')
    .trim()
    .split(/\r?\n/)
    .filter(Boolean)
    .map(line => JSON.parse(line));
}

function mutationCalls(calls) {
  return calls.filter(argv => !(
    argv.join(' ') === 'plugin list --json'
    || argv.join(' ') === 'plugin marketplace list --json'
  ));
}

function assertThrowsContaining(fn, fragments) {
  assert.throws(fn, error => (
    fragments.every(fragment => error.message.toLowerCase().includes(fragment.toLowerCase()))
  ));
}

function officialMarketplace(scope = 'user') {
  return {
    name: 'ecc',
    source: 'github',
    repo: 'affaan-m/ECC',
    scope,
  };
}

function installedPlugin(scope = 'user', overrides = {}) {
  return {
    id: 'ecc@ecc',
    scope,
    enabled: true,
    version: '1.9.0',
    ...overrides,
  };
}

function writeManagedState(fixture, selectedModules, operations = []) {
  const statePath = path.join(fixture.configDir, 'ecc', 'install-state.json');
  fs.mkdirSync(path.dirname(statePath), { recursive: true });
  fs.writeFileSync(statePath, `${JSON.stringify({
    schemaVersion: 'ecc.install.v1',
    target: { target: 'claude' },
    resolution: { selectedModules, skippedModules: [] },
    operations,
  }, null, 2)}\n`);
}

console.log('\n=== Claude plugin setup library tests ===\n');

test('Windows command-line fallback preserves spaced paths and JSON arguments', () => {
  assert.strictEqual(
    buildWindowsCommandLine(
      'C:\\Program Files\\Claude\\claude.cmd',
      ['plugin', 'install', 'ecc@ecc', '--config', '{"hooks_enabled":false}']
    ),
    '"C:\\Program Files\\Claude\\claude.cmd" plugin install ecc@ecc --config "{""hooks_enabled"":false}"'
  );
  assert.throws(
    () => buildWindowsCommandLine('claude.cmd', ['plugin', 'install', 'bad&unsafe']),
    /unsafe/
  );
});

test('provider runner times out a hung Claude command with structured context', () => {
  const timeoutError = Object.assign(new Error('spawnSync timed out'), {
    code: 'ETIMEDOUT',
    killed: true,
    signal: 'SIGKILL',
  });
  const spawn = (command, args, options) => {
    assert.strictEqual(command, process.execPath);
    assert.deepStrictEqual(args, ['plugin', 'marketplace', 'update', 'ecc']);
    assert.strictEqual(options.timeout, 25);
    assert.strictEqual(options.killSignal, 'SIGKILL');
    return { error: timeoutError, signal: 'SIGKILL', status: null };
  };
  assert.throws(
    () => runClaude(
      ['plugin', 'marketplace', 'update', 'ecc'],
      {
        command: process.execPath,
        phase: 'marketplace',
        timeoutMs: 25,
      },
      { spawnSync: spawn }
    ),
    error => {
      assert.strictEqual(error.code, 'CLAUDE_COMMAND_FAILED');
      assert.strictEqual(error.phase, 'marketplace');
      assert.match(error.message, /timed out after 25 ms/i);
      return true;
    }
  );
});

test('marketplace provenance is validated according to its source type', () => {
  assert.strictEqual(isOfficialMarketplace(officialMarketplace()), true);
  assert.strictEqual(isOfficialMarketplace({
    name: 'ecc',
    source: 'git',
    url: 'https://github.com/affaan-m/ECC.git',
  }), true);
  for (const url of [
    'affaan-m/ECC',
    'http://github.com/affaan-m/ECC.git',
  ]) {
    assert.strictEqual(isOfficialMarketplace({
      name: 'ecc',
      source: 'git',
      url,
    }), false);
  }
});

test('fresh installs require an explicit scope and perform no mutation', () => {
  withFixture({}, fixture => {
    assertThrowsContaining(
      () => setupClaudePlugin(setupOptions(fixture)),
      ['scope', 'user', 'project', 'local']
    );
    assert.deepStrictEqual(mutationCalls(readCalls(fixture)), []);
    assert.ok(!fs.existsSync(fixture.settingsPath));
  });
});

test('an existing single-scope install defaults to its detected scope', () => {
  withFixture({
    plugins: [installedPlugin('project')],
    marketplaces: [officialMarketplace('project')],
  }, fixture => {
    const result = setupClaudePlugin(setupOptions(fixture, { hooks: 'minimal' }));
    assert.strictEqual(result.action, 'updated');
    assert.strictEqual(result.scope, 'project');
    assert.deepStrictEqual(readCalls(fixture), [
      ['plugin', 'list', '--json'],
      ['plugin', 'marketplace', 'list', '--json'],
      ['plugin', 'marketplace', 'update', 'ecc'],
      ['plugin', 'marketplace', 'list', '--json'],
      ['plugin', 'update', 'ecc@ecc', '--scope', 'project'],
      ['plugin', 'list', '--json'],
    ]);
    const settings = JSON.parse(fs.readFileSync(fixture.settingsPath, 'utf8'));
    assert.strictEqual(settings.includeCoAuthoredBy, false);
    assert.strictEqual(settings.pluginConfigs['ecc@ecc'].options.hook_profile, 'minimal');
  });
});

test('requesting another scope fails without the PR 2 move-scope operation', () => {
  withFixture({
    plugins: [installedPlugin('user')],
    marketplaces: [officialMarketplace('user')],
  }, fixture => {
    assertThrowsContaining(
      () => setupClaudePlugin(setupOptions(fixture, { scope: 'project' })),
      ['already installed', 'user', 'scope migration']
    );
    assert.deepStrictEqual(mutationCalls(readCalls(fixture)), []);
  });
});

test('fresh install follows the exact inventory, marketplace, install, and verification sequence', () => {
  withFixture({}, fixture => {
    const result = setupClaudePlugin(setupOptions(fixture, {
      scope: 'project',
      hooks: 'strict',
    }));
    assert.strictEqual(result.action, 'installed');
    assert.strictEqual(result.scope, 'project');
    assert.deepStrictEqual(readCalls(fixture), [
      ['plugin', 'list', '--json'],
      ['plugin', 'marketplace', 'list', '--json'],
      ['plugin', 'marketplace', 'add', OFFICIAL_MARKETPLACE_URL, '--scope', 'project'],
      ['plugin', 'marketplace', 'list', '--json'],
      [
        'plugin', 'install', 'ecc@ecc',
        '--scope', 'project',
        '--config', 'hooks_enabled=true',
        '--config', 'hook_profile=strict',
      ],
      ['plugin', 'list', '--json'],
    ]);
  });
});

test('fresh installs support all Claude scopes while hook preferences stay user-only', () => {
  for (const scope of ['user', 'project', 'local']) {
    withFixture({}, fixture => {
      setupClaudePlugin(setupOptions(fixture, { scope, hooks: 'minimal' }));
      const calls = readCalls(fixture);
      assert.ok(calls.some(argv => (
        argv[0] === 'plugin'
        && argv[1] === 'marketplace'
        && argv[2] === 'add'
        && argv.includes('--scope')
        && argv[argv.indexOf('--scope') + 1] === scope
      )));
      assert.ok(calls.some(argv => (
        argv[0] === 'plugin'
        && argv[1] === 'install'
        && argv[argv.indexOf('--scope') + 1] === scope
      )));
      assert.ok(fs.existsSync(fixture.settingsPath));
      assert.ok(!fs.existsSync(path.join(fixture.projectRoot, '.claude', 'settings.json')));
      assert.ok(!fs.existsSync(path.join(fixture.projectRoot, '.claude', 'settings.local.json')));
    });
  }
});

test('same-scope repeat setup updates ECC and changes durable user hook preferences', () => {
  withFixture({
    plugins: [installedPlugin('local')],
    marketplaces: [officialMarketplace('local')],
  }, fixture => {
    fs.writeFileSync(fixture.settingsPath, `${JSON.stringify({
      theme: 'dark',
      pluginConfigs: {
        'another@market': { enabled: false },
        'ecc@ecc': {
          enabled: true,
          futureKey: { keep: true },
          options: { hooks_enabled: true, hook_profile: 'minimal', unknown: 'keep' },
        },
      },
    }, null, 2)}\n`);

    setupClaudePlugin(setupOptions(fixture, { scope: 'local', hooks: 'off' }));
    const settings = JSON.parse(fs.readFileSync(fixture.settingsPath, 'utf8'));
    assert.strictEqual(settings.theme, 'dark');
    assert.strictEqual(settings.includeCoAuthoredBy, false);
    assert.deepStrictEqual(settings.pluginConfigs['another@market'], { enabled: false });
    assert.deepStrictEqual(settings.pluginConfigs['ecc@ecc'].futureKey, { keep: true });
    assert.strictEqual(settings.pluginConfigs['ecc@ecc'].options.unknown, 'keep');
    assert.strictEqual(settings.pluginConfigs['ecc@ecc'].options.hooks_enabled, false);
    assert.strictEqual(settings.pluginConfigs['ecc@ecc'].options.hook_profile, 'standard');
    assert.ok(!fs.readdirSync(fixture.configDir).some(name => name.includes('.tmp')));
  });
});

test('repeat setup preserves the current hook preference when --hooks is omitted', () => {
  withFixture({
    plugins: [installedPlugin('user')],
    marketplaces: [officialMarketplace('user')],
  }, fixture => {
    fs.writeFileSync(fixture.settingsPath, `${JSON.stringify({
      pluginConfigs: {
        'ecc@ecc': {
          options: {
            hooks_enabled: false,
            hook_profile: 'strict',
          },
        },
      },
    }, null, 2)}\n`);

    const result = setupClaudePlugin(setupOptions(fixture, { hooks: undefined }));
    const settings = JSON.parse(fs.readFileSync(fixture.settingsPath, 'utf8'));
    assert.strictEqual(result.hooks, 'off');
    assert.strictEqual(settings.includeCoAuthoredBy, false);
    assert.strictEqual(settings.pluginConfigs['ecc@ecc'].options.hooks_enabled, false);
    assert.strictEqual(settings.pluginConfigs['ecc@ecc'].options.hook_profile, 'strict');
  });
});

test('setup preserves an explicit includeCoAuthoredBy opt-in', () => {
  withFixture({
    plugins: [installedPlugin('user')],
    marketplaces: [officialMarketplace('user')],
  }, fixture => {
    fs.writeFileSync(fixture.settingsPath, `${JSON.stringify({
      includeCoAuthoredBy: true,
      pluginConfigs: {
        'ecc@ecc': {
          options: {
            hooks_enabled: true,
            hook_profile: 'minimal',
          },
        },
      },
    }, null, 2)}\n`);

    setupClaudePlugin(setupOptions(fixture, { hooks: 'strict' }));
    const settings = JSON.parse(fs.readFileSync(fixture.settingsPath, 'utf8'));
    assert.strictEqual(settings.includeCoAuthoredBy, true);
    assert.strictEqual(settings.pluginConfigs['ecc@ecc'].options.hook_profile, 'strict');
  });
});

test('setup preserves an explicit attribution opt-in', () => {
  withFixture({
    plugins: [installedPlugin('user')],
    marketplaces: [officialMarketplace('user')],
  }, fixture => {
    // `attribution` wins over `includeCoAuthoredBy` in Claude Code, so ECC must not
    // add a deprecated key that would silently lose to the user's own setting.
    fs.writeFileSync(fixture.settingsPath, `${JSON.stringify({
      attribution: { commit: 'Signed-off-by: Someone <someone@example.com>' },
      pluginConfigs: {
        'ecc@ecc': {
          options: {
            hooks_enabled: true,
            hook_profile: 'minimal',
          },
        },
      },
    }, null, 2)}\n`);

    setupClaudePlugin(setupOptions(fixture, { hooks: 'strict' }));
    const settings = JSON.parse(fs.readFileSync(fixture.settingsPath, 'utf8'));
    assert.strictEqual(settings.includeCoAuthoredBy, undefined);
    assert.deepStrictEqual(settings.attribution, { commit: 'Signed-off-by: Someone <someone@example.com>' });
    assert.strictEqual(settings.pluginConfigs['ecc@ecc'].options.hook_profile, 'strict');
  });
});

test('malformed user settings fail preflight without provider mutation or corruption', () => {
  withFixture({}, fixture => {
    const malformed = '{"theme":';
    fs.writeFileSync(fixture.settingsPath, malformed);
    assertThrowsContaining(
      () => setupClaudePlugin(setupOptions(fixture, { scope: 'user' })),
      ['settings', 'invalid']
    );
    assert.deepStrictEqual(mutationCalls(readCalls(fixture)), []);
    assert.strictEqual(fs.readFileSync(fixture.settingsPath, 'utf8'), malformed);
  });
});

test('legacy plugin inventory fails closed before marketplace or plugin mutation', () => {
  withFixture({
    plugins: [{
      id: 'everything-claude-code@everything-claude-code',
      scope: 'user',
      enabled: true,
    }],
  }, fixture => {
    assertThrowsContaining(
      () => setupClaudePlugin(setupOptions(fixture, { scope: 'user' })),
      ['legacy', 'uninstall']
    );
    assert.deepStrictEqual(mutationCalls(readCalls(fixture)), []);
  });
});

test('skills-directory ECC plugins fail closed before marketplace or plugin mutation', () => {
  withFixture({
    plugins: [{
      id: 'ecc@skills-dir',
      scope: 'user',
      enabled: true,
    }],
  }, fixture => {
    assertThrowsContaining(
      () => setupClaudePlugin(setupOptions(fixture, { scope: 'user' })),
      ['ecc@skills-dir', 'duplicate', 'uninstall']
    );
    assert.deepStrictEqual(mutationCalls(readCalls(fixture)), []);
  });
});

test('manual plugin layouts fail closed before provider mutation', () => {
  withFixture({}, fixture => {
    const manualManifest = path.join(
      fixture.configDir,
      'plugins',
      'ecc',
      '.claude-plugin',
      'plugin.json'
    );
    fs.mkdirSync(path.dirname(manualManifest), { recursive: true });
    fs.writeFileSync(manualManifest, JSON.stringify({ name: 'ecc' }));
    assertThrowsContaining(
      () => setupClaudePlugin(setupOptions(fixture, { scope: 'user' })),
      ['manual', 'ecc']
    );
    assert.deepStrictEqual(mutationCalls(readCalls(fixture)), []);
  });
});

test('duplicate ECC plugin scopes fail closed before mutation', () => {
  withFixture({
    plugins: [installedPlugin('user'), installedPlugin('project')],
  }, fixture => {
    assertThrowsContaining(
      () => setupClaudePlugin(setupOptions(fixture, { scope: 'user' })),
      ['multiple', 'scope']
    );
    assert.deepStrictEqual(mutationCalls(readCalls(fixture)), []);
  });
});

test('malformed plugin JSON and malformed plugin entries fail closed', () => {
  for (const pluginListResponses of [['{not-json'], [[{ id: 'ecc@ecc', enabled: true }]]]) {
    withFixture({ pluginListResponses }, fixture => {
      assertThrowsContaining(
        () => setupClaudePlugin(setupOptions(fixture, { scope: 'user' })),
        ['plugin', 'inventory']
      );
      assert.deepStrictEqual(mutationCalls(readCalls(fixture)), []);
    });
  }
});

test('malformed marketplace JSON and marketplace name collisions fail closed', () => {
  const cases = [
    {
      initial: { marketplaceListResponses: ['{not-json'] },
      fragments: ['marketplace', 'inventory'],
    },
    {
      initial: {
        marketplaces: [{
          name: 'ecc',
          source: 'git',
          url: 'https://github.com/example/not-ecc.git',
          scope: 'user',
        }],
      },
      fragments: ['marketplace', 'collision'],
    },
    {
      initial: { marketplaces: [{ name: 'ecc' }] },
      fragments: ['marketplace', 'invalid'],
    },
  ];
  for (const { initial, fragments } of cases) {
    withFixture(initial, fixture => {
      assertThrowsContaining(
        () => setupClaudePlugin(setupOptions(fixture, { scope: 'user' })),
        fragments
      );
      assert.deepStrictEqual(mutationCalls(readCalls(fixture)), []);
    });
  }
});

test('managed rules-only state is allowed but overlapping managed content is rejected', () => {
  withFixture({}, fixture => {
    writeManagedState(fixture, ['rules-core']);
    assert.strictEqual(
      setupClaudePlugin(setupOptions(fixture, { scope: 'user' })).action,
      'installed'
    );
  });
  withFixture({}, fixture => {
    writeManagedState(fixture, ['rules-core', 'hooks-core']);
    assertThrowsContaining(
      () => setupClaudePlugin(setupOptions(fixture, { scope: 'user' })),
      ['managed', 'overlap']
    );
    assert.deepStrictEqual(mutationCalls(readCalls(fixture)), []);
  });
});

test('managed overlap detection resolves symlink aliases before classifying paths', () => {
  if (process.platform === 'win32') return;

  withFixture({}, fixture => {
    const aliasPath = path.join(fixture.configDir, 'alias');
    fs.symlinkSync(fixture.configDir, aliasPath, 'dir');
    writeManagedState(fixture, ['rules-core'], [{
      destinationPath: path.join(aliasPath, 'hooks', 'hooks.json'),
    }]);
    assertThrowsContaining(
      () => setupClaudePlugin(setupOptions(fixture, { scope: 'user' })),
      ['managed', 'overlap']
    );
    assert.deepStrictEqual(mutationCalls(readCalls(fixture)), []);
  });
});

test('dry-run reads inventory only and never writes settings', () => {
  withFixture({}, fixture => {
    const result = setupClaudePlugin(setupOptions(fixture, {
      scope: 'local',
      hooks: 'strict',
      dryRun: true,
    }));
    assert.strictEqual(result.action, 'would-install');
    assert.strictEqual(result.dryRun, true);
    assert.deepStrictEqual(mutationCalls(readCalls(fixture)), []);
    assert.ok(!fs.existsSync(fixture.settingsPath));
  });
});

test('dry-run snapshots local-scope inventory into isolated Claude and project roots', () => {
  withFixture({}, fixture => {
    const projectConfigDir = path.join(fixture.projectRoot, '.claude');
    const projectSettingsPath = path.join(projectConfigDir, 'settings.local.json');
    const providerStatePath = path.join(fixture.configDir, '.claude.json');
    const pluginsDir = path.join(fixture.configDir, 'plugins');
    const installedPluginsPath = path.join(pluginsDir, 'installed_plugins.json');
    const marketplacesPath = path.join(pluginsDir, 'known_marketplaces.json');
    fs.mkdirSync(projectConfigDir, { recursive: true });
    fs.mkdirSync(pluginsDir, { recursive: true });
    fs.writeFileSync(projectSettingsPath, '{"enabledPlugins":{"ecc@ecc":true}}\n');
    fs.writeFileSync(providerStatePath, '{"projects":{}}\n');
    fs.writeFileSync(installedPluginsPath, `${JSON.stringify({
      version: 2,
      plugins: {
        'ecc@ecc': [{
          scope: 'local',
          enabled: true,
          installPath: path.join(
            fs.realpathSync(fixture.configDir),
            'plugins',
            'cache',
            'ecc'
          ),
          projectPath: fs.realpathSync(fixture.projectRoot),
          version: '2.2.0',
        }],
      },
    }, null, 2)}\n`);
    fs.writeFileSync(marketplacesPath, `${JSON.stringify({
      ecc: {
        source: { source: 'github', repo: 'affaan-m/ECC' },
      },
    }, null, 2)}\n`);

    const runClaude = (args, runOptions) => {
      assert.notStrictEqual(runOptions.cwd, fixture.projectRoot);
      assert.notStrictEqual(runOptions.env.HOME, fixture.homeDir);
      assert.notStrictEqual(runOptions.env.CLAUDE_CONFIG_DIR, fixture.configDir);
      assert.ok(
        runOptions.env.XDG_DATA_HOME.startsWith(path.dirname(runOptions.env.HOME))
      );
      const shadowSettingsPath = path.join(
        runOptions.cwd,
        '.claude',
        'settings.local.json'
      );
      assert.strictEqual(fs.lstatSync(shadowSettingsPath).isFile(), true);
      const shadowInstalled = JSON.parse(fs.readFileSync(
        path.join(runOptions.env.CLAUDE_CONFIG_DIR, 'plugins', 'installed_plugins.json'),
        'utf8'
      ));
      assert.strictEqual(
        shadowInstalled.plugins['ecc@ecc'][0].projectPath,
        runOptions.cwd
      );
      assert.ok(
        shadowInstalled.plugins['ecc@ecc'][0].installPath
          .startsWith(runOptions.env.CLAUDE_CONFIG_DIR)
      );
      fs.writeFileSync(shadowSettingsPath, '{"providerRead":true}\n');
      fs.mkdirSync(runOptions.env.XDG_DATA_HOME, { recursive: true });
      fs.writeFileSync(
        path.join(runOptions.env.XDG_DATA_HOME, 'claude-provider-read.json'),
        '{"providerRead":true}\n'
      );
      if (args.join(' ') === 'plugin list --json') {
        return { stdout: JSON.stringify([installedPlugin('local')]) };
      }
      return { stdout: JSON.stringify([officialMarketplace('local')]) };
    };

    const result = setupClaudePlugin(
      setupOptions(fixture, { scope: 'local', dryRun: true }),
      {
        runClaude,
        spawnSync: () => ({ status: 0, stdout: 'git version 2.0.0\n' }),
      }
    );
    assert.strictEqual(result.action, 'would-update');
    assert.strictEqual(result.scope, 'local');
    assert.strictEqual(
      fs.readFileSync(projectSettingsPath, 'utf8'),
      '{"enabledPlugins":{"ecc@ecc":true}}\n'
    );
    assert.strictEqual(fs.readFileSync(providerStatePath, 'utf8'), '{"projects":{}}\n');
  });
});

test('missing Git reports an actionable prerequisite during dry-run before provider inventory', () => {
  withFixture({}, fixture => {
    const missingGit = Object.assign(new Error('spawnSync git ENOENT'), {
      code: 'ENOENT',
    });
    assert.throws(
      () => setupClaudePlugin(
        setupOptions(fixture, { scope: 'user', dryRun: true }),
        { spawnSync: () => ({ error: missingGit, status: null }) }
      ),
      error => {
        assert.strictEqual(error.code, 'GIT_NOT_FOUND');
        assert.strictEqual(error.phase, 'preflight');
        assert.match(error.message, /Git is required for Claude marketplace setup/i);
        assert.match(error.message, /install Git/i);
        assert.doesNotMatch(error.message, /ERR_STREAM_PREMATURE_CLOSE/i);
        return true;
      }
    );
    assert.deepStrictEqual(readCalls(fixture), []);
    assert.ok(!fs.existsSync(fixture.settingsPath));
  });
});

test('provider failures stop later operations and leave settings untouched', () => {
  const marketplaceArgv = [
    'plugin', 'marketplace', 'add',
    OFFICIAL_MARKETPLACE_URL,
    '--scope', 'user',
  ];
  const installArgv = [
    'plugin', 'install', 'ecc@ecc',
    '--scope', 'user',
    '--config', 'hooks_enabled=true',
    '--config', 'hook_profile=standard',
  ];
  withFixture({
    failures: [{
      argv: installArgv,
      status: 7,
      stderr: 'install exploded',
      times: 1,
    }],
  }, fixture => {
    fs.writeFileSync(fixture.settingsPath, '{"theme":"dark"}\n');
    assertThrowsContaining(
      () => setupClaudePlugin(setupOptions(fixture, { scope: 'user' })),
      ['install exploded']
    );
    const calls = readCalls(fixture);
    assert.deepStrictEqual(calls.at(-1), installArgv);
    assert.strictEqual(fs.readFileSync(fixture.settingsPath, 'utf8'), '{"theme":"dark"}\n');
  });
  withFixture({
    failures: [{
      argv: marketplaceArgv,
      status: 8,
      stderr: 'marketplace exploded',
      times: 1,
    }],
  }, fixture => {
    assertThrowsContaining(
      () => setupClaudePlugin(setupOptions(fixture, { scope: 'user' })),
      ['marketplace exploded']
    );
    const calls = readCalls(fixture);
    assert.deepStrictEqual(calls.at(-1), marketplaceArgv);
    assert.ok(!calls.some(argv => argv[1] === 'install'));
    assert.ok(!fs.existsSync(fixture.settingsPath));
  });
});

test('post-install verification rejects absent, wrong-scope, disabled, and duplicate results', () => {
  const invalidVerificationResults = [
    [],
    [installedPlugin('project')],
    [installedPlugin('user', { enabled: false })],
    [installedPlugin('user'), installedPlugin('project')],
  ];
  for (const verification of invalidVerificationResults) {
    withFixture({
      pluginListResponses: [[], verification],
    }, fixture => {
      assertThrowsContaining(
        () => setupClaudePlugin(setupOptions(fixture, { scope: 'user' })),
        ['verify', 'ecc@ecc']
      );
      assert.ok(!fs.existsSync(fixture.settingsPath));
    });
  }
});

test('marketplace verification failure prevents plugin installation', () => {
  withFixture({
    marketplaceListResponses: [[], []],
  }, fixture => {
    assertThrowsContaining(
      () => setupClaudePlugin(setupOptions(fixture, { scope: 'user' })),
      ['verify', 'marketplace']
    );
    assert.ok(!readCalls(fixture).some(argv => argv[1] === 'install'));
    assert.ok(!fs.existsSync(fixture.settingsPath));
  });
});

test('CLAUDE_CONFIG_DIR and paths containing spaces are honored', () => {
  withFixture({}, fixture => {
    const result = setupClaudePlugin(setupOptions(fixture, {
      scope: 'project',
      hooks: 'minimal',
    }));
    assert.strictEqual(path.resolve(result.settingsPath), path.resolve(fixture.settingsPath));
    assert.ok(result.settingsPath.includes(' '));
    assert.ok(fs.existsSync(fixture.settingsPath));
  });
});

test('missing Claude executable reports an actionable recovery', () => {
  withFixture({}, fixture => {
    process.env.PATH = fixture.binDir;
    fs.rmSync(path.join(fixture.binDir, process.platform === 'win32' ? 'claude.cmd' : 'claude'));
    assertThrowsContaining(
      () => setupClaudePlugin(setupOptions(fixture, { scope: 'user' })),
      ['claude', 'install']
    );
    assert.ok(!fs.existsSync(fixture.settingsPath));
  });
});

console.log(`\nResults: Passed: ${passed}, Failed: ${failed}`);
process.exit(failed > 0 ? 1 : 0);
