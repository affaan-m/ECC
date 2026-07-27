'use strict';

const assert = require('assert');
const fs = require('fs');
const os = require('os');
const path = require('path');

const repoRoot = path.join(__dirname, '..', '..');
const fakeClaudeScript = path.join(repoRoot, 'tests', 'fixtures', 'fake-claude-plugin.js');
const {
  OFFICIAL_MARKETPLACE_URL,
} = require('../../scripts/lib/claude-plugin-setup');
const {
  migrateClaudePluginScope,
} = require('../../scripts/lib/claude-scope-migration');

let passed = 0;
let failed = 0;

function test(name, fn) {
  try {
    fn();
    console.log(`  ✓ ${name}`);
    passed += 1;
  } catch (error) {
    console.log(`  ✗ ${name}`);
    console.log(`    Error: ${error.stack || error.message}`);
    failed += 1;
  }
}

function plugin(scope, overrides = {}) {
  return {
    id: 'ecc@ecc',
    scope,
    enabled: true,
    version: '1.9.0',
    ...overrides,
  };
}

function marketplace(scope = 'user') {
  return {
    name: 'ecc',
    source: 'github',
    repo: 'affaan-m/ECC',
    scope,
  };
}

function createFixture(initialState = {}) {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'ecc scope migration '));
  const homeDir = path.join(root, 'home with spaces');
  const configDir = path.join(root, 'config with spaces');
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
    fs.rmSync(fixture.root, { recursive: true, force: true });
  }
}

function migrationOptions(fixture, scope, overrides = {}) {
  return {
    homeDir: fixture.homeDir,
    configDir: fixture.configDir,
    projectRoot: fixture.projectRoot,
    scope,
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

function readState(fixture) {
  return JSON.parse(fs.readFileSync(fixture.statePath, 'utf8'));
}

function mutationCalls(fixture) {
  return readCalls(fixture).filter(argv => !(
    argv.join(' ') === 'plugin list --json'
    || argv.join(' ') === 'plugin marketplace list --json'
  ));
}

function captureError(fn) {
  try {
    fn();
  } catch (error) {
    return error;
  }
  assert.fail('Expected operation to throw');
}

function installArgv(scope, hooks = 'standard', profileOverride) {
  const enabled = hooks !== 'off';
  const profile = profileOverride || (hooks === 'off' ? 'standard' : hooks);
  return [
    'plugin', 'install', 'ecc@ecc',
    '--scope', scope,
    '--config', `hooks_enabled=${enabled}`,
    '--config', `hook_profile=${profile}`,
  ];
}

function uninstallArgv(scope) {
  return ['plugin', 'uninstall', 'ecc@ecc', '--scope', scope, '--keep-data'];
}

function expectedMigrationCalls(sourceScope, destinationScope, hooks = 'standard') {
  return [
    ['plugin', 'list', '--json'],
    ['plugin', 'marketplace', 'list', '--json'],
    ['plugin', 'marketplace', 'update', 'ecc'],
    ['plugin', 'marketplace', 'list', '--json'],
    installArgv(destinationScope, hooks),
    ['plugin', 'list', '--json'],
    ['plugin', 'list', '--json'],
    uninstallArgv(sourceScope),
    ['plugin', 'list', '--json'],
  ];
}

console.log('\n=== Claude plugin scope migration tests ===\n');

test('all six directed scope pairs migrate destination-first with exact verification order', () => {
  const scopes = ['user', 'project', 'local'];
  for (const sourceScope of scopes) {
    for (const destinationScope of scopes.filter(scope => scope !== sourceScope)) {
      withFixture({
        plugins: [plugin(sourceScope)],
        marketplaces: [marketplace(sourceScope)],
      }, fixture => {
        const result = migrateClaudePluginScope(
          migrationOptions(fixture, destinationScope)
        );
        assert.deepStrictEqual(result, {
          action: 'migrated',
          hooks: 'standard',
          pluginId: 'ecc@ecc',
          sourceScope,
          scope: destinationScope,
        });
        assert.deepStrictEqual(
          readCalls(fixture),
          expectedMigrationCalls(sourceScope, destinationScope)
        );
        assert.deepStrictEqual(readState(fixture).plugins, [
          plugin(destinationScope, { version: '2.0.0' }),
        ]);
        assert.deepStrictEqual(readState(fixture).marketplaces, [
          marketplace(sourceScope),
        ]);
      });
    }
  }
});

test('a missing marketplace is added at the destination before plugin installation', () => {
  withFixture({ plugins: [plugin('user')] }, fixture => {
    migrateClaudePluginScope(migrationOptions(fixture, 'project'));
    const calls = readCalls(fixture);
    const marketplaceAdd = [
      'plugin', 'marketplace', 'add',
      OFFICIAL_MARKETPLACE_URL,
      '--scope', 'project',
    ];
    const addIndex = calls.findIndex(argv => (
      JSON.stringify(argv) === JSON.stringify(marketplaceAdd)
    ));
    const installIndex = calls.findIndex(argv => argv[1] === 'install');
    assert.ok(addIndex >= 0);
    assert.ok(installIndex >= 0);
    assert.ok(addIndex < installIndex);
  });
});

test('an interrupted source-plus-destination state resumes cleanup without reinstalling', () => {
  withFixture({
    plugins: [plugin('user'), plugin('project', { version: '2.0.0' })],
    marketplaces: [marketplace('user')],
  }, fixture => {
    const result = migrateClaudePluginScope(migrationOptions(fixture, 'project'));
    assert.strictEqual(result.action, 'resumed');
    assert.strictEqual(result.sourceScope, 'user');
    assert.strictEqual(result.scope, 'project');
    assert.deepStrictEqual(readCalls(fixture), [
      ['plugin', 'list', '--json'],
      ['plugin', 'marketplace', 'list', '--json'],
      ['plugin', 'list', '--json'],
      ['plugin', 'list', '--json'],
      uninstallArgv('user'),
      ['plugin', 'list', '--json'],
    ]);
    assert.deepStrictEqual(readState(fixture).plugins, [
      plugin('project', { version: '2.0.0' }),
    ]);
  });
});

test('resume verifies an enabled destination before removing the source', () => {
  withFixture({
    plugins: [plugin('user'), plugin('project', { enabled: false })],
    marketplaces: [marketplace('user')],
  }, fixture => {
    const error = captureError(() => (
      migrateClaudePluginScope(migrationOptions(fixture, 'project'))
    ));
    assert.strictEqual(error.phase, 'destination-verification');
    assert.ok(!readCalls(fixture).some(argv => argv[1] === 'uninstall'));
    assert.deepStrictEqual(
      readState(fixture).plugins.map(entry => entry.scope).sort(),
      ['project', 'user']
    );
  });
});

test('destination-only state is idempotently already migrated, including same-scope input', () => {
  for (const scope of ['user', 'project', 'local']) {
    withFixture({ plugins: [plugin(scope)] }, fixture => {
      const result = migrateClaudePluginScope(migrationOptions(fixture, scope));
      assert.strictEqual(result.action, 'already-migrated');
      assert.strictEqual(result.sourceScope, null);
      assert.strictEqual(result.scope, scope);
      assert.deepStrictEqual(readCalls(fixture), [
        ['plugin', 'list', '--json'],
        ['plugin', 'marketplace', 'list', '--json'],
      ]);
      assert.deepStrictEqual(mutationCalls(fixture), []);
    });
  }
});

test('destination-only migration honors explicit hook preferences and reports dry-run writes', () => {
  withFixture({ plugins: [plugin('local')] }, fixture => {
    fs.writeFileSync(fixture.settingsPath, JSON.stringify({
      pluginConfigs: {
        'ecc@ecc': {
          options: { hooks_enabled: false, hook_profile: 'minimal' },
        },
      },
    }));
    const result = migrateClaudePluginScope(migrationOptions(fixture, 'local', {
      hooks: 'strict',
    }));
    assert.strictEqual(result.action, 'already-migrated');
    assert.strictEqual(result.preferencesUpdated, true);
    const settings = JSON.parse(fs.readFileSync(fixture.settingsPath, 'utf8'));
    assert.strictEqual(settings.pluginConfigs['ecc@ecc'].options.hooks_enabled, true);
    assert.strictEqual(settings.pluginConfigs['ecc@ecc'].options.hook_profile, 'strict');
  });

  withFixture({ plugins: [plugin('local')] }, fixture => {
    const result = migrateClaudePluginScope(migrationOptions(fixture, 'local', {
      dryRun: true,
      hooks: 'off',
    }));
    assert.strictEqual(result.action, 'already-migrated');
    assert.strictEqual(result.dryRun, true);
    assert.strictEqual(result.preferencesUpdated, false);
    assert.deepStrictEqual(result.plannedActions, [{
      action: 'write-hook-preferences',
      hooks_enabled: false,
      hook_profile: 'standard',
    }]);
    assert.ok(!fs.existsSync(fixture.settingsPath));
  });
});

test('destination-only state must be enabled before it is considered migrated', () => {
  withFixture({ plugins: [plugin('project', { enabled: false })] }, fixture => {
    const error = captureError(() => (
      migrateClaudePluginScope(migrationOptions(fixture, 'project'))
    ));
    assert.strictEqual(error.code, 'DESTINATION_VERIFICATION_FAILED');
    assert.strictEqual(error.phase, 'destination-verification');
    assert.deepStrictEqual(error.observedScopes, ['project']);
    assert.deepStrictEqual(mutationCalls(fixture), []);
  });
});

test('zero installs, ambiguous non-destination scopes, and invalid inventories fail closed', () => {
  const cases = [
    { state: {}, scope: 'project', code: 'PLUGIN_NOT_INSTALLED' },
    {
      state: { plugins: [plugin('user'), plugin('local')] },
      scope: 'project',
      code: 'AMBIGUOUS_PLUGIN_SCOPES',
    },
    {
      state: { plugins: [plugin('user'), plugin('project'), plugin('local')] },
      scope: 'project',
      code: 'AMBIGUOUS_PLUGIN_SCOPES',
    },
    {
      state: { pluginListResponses: ['{not-json'] },
      scope: 'project',
      code: 'INVALID_PLUGIN_INVENTORY',
    },
    {
      state: { pluginListResponses: [[{ id: 'ecc@ecc', enabled: true }]] },
      scope: 'project',
      code: 'INVALID_PLUGIN_INVENTORY',
    },
    {
      state: {
        plugins: [plugin('user')],
        marketplaceListResponses: ['{not-json'],
      },
      scope: 'project',
      code: 'INVALID_MARKETPLACE_INVENTORY',
    },
  ];
  for (const { state, scope, code } of cases) {
    withFixture(state, fixture => {
      const error = captureError(() => (
        migrateClaudePluginScope(migrationOptions(fixture, scope))
      ));
      assert.strictEqual(error.code, code);
      assert.deepStrictEqual(mutationCalls(fixture), []);
    });
  }
});

test('marketplace collisions fail closed in migration dry-run and resume cleanup', () => {
  const collision = {
    name: 'ecc',
    source: 'github',
    repo: 'attacker/ecc',
    scope: 'user',
  };
  const cases = [
    {
      state: {
        plugins: [plugin('user')],
        marketplaces: [collision],
      },
      options: { dryRun: true },
    },
    {
      state: {
        plugins: [plugin('user'), plugin('project')],
        marketplaces: [collision],
      },
      options: {},
    },
    {
      state: {
        plugins: [plugin('project')],
        marketplaces: [collision],
      },
      options: { hooks: 'strict' },
    },
  ];
  for (const { state, options } of cases) {
    withFixture(state, fixture => {
      const error = captureError(() => (
        migrateClaudePluginScope(migrationOptions(fixture, 'project', options))
      ));
      assert.strictEqual(error.code, 'MARKETPLACE_COLLISION');
      assert.deepStrictEqual(mutationCalls(fixture), []);
      assert.ok(!readCalls(fixture).some(argv => argv[1] === 'uninstall'));
      assert.deepStrictEqual(
        readState(fixture).plugins.map(entry => entry.scope).sort(),
        state.plugins.map(entry => entry.scope).sort()
      );
      assert.ok(!fs.existsSync(fixture.settingsPath));
    });
  }
});

test('destination marketplace, install, and verification failures never uninstall the source', () => {
  const destinationInstall = installArgv('project');
  const cases = [
    {
      state: {
        plugins: [plugin('user')],
        marketplaces: [marketplace('user')],
        failures: [{
          argv: ['plugin', 'marketplace', 'update', 'ecc'],
          status: 7,
          stderr: 'marketplace failed',
          times: 1,
        }],
      },
    },
    {
      state: {
        plugins: [plugin('user')],
        marketplaces: [marketplace('user')],
        failures: [{
          argv: destinationInstall,
          status: 8,
          stderr: 'install failed',
          times: 1,
        }],
      },
    },
    {
      state: {
        plugins: [plugin('user')],
        marketplaces: [marketplace('user')],
        pluginListResponses: [[plugin('user')], [plugin('user')]],
      },
    },
  ];
  for (const { state } of cases) {
    withFixture(state, fixture => {
      captureError(() => (
        migrateClaudePluginScope(migrationOptions(fixture, 'project'))
      ));
      assert.ok(!readCalls(fixture).some(argv => argv[1] === 'uninstall'));
      assert.ok(readState(fixture).plugins.some(entry => entry.scope === 'user'));
    });
  }
});

test('a concurrent non-destination install aborts before source cleanup', () => {
  withFixture({
    plugins: [plugin('user')],
    marketplaces: [marketplace('user')],
    pluginListResponses: [
      [plugin('user')],
      [plugin('user'), plugin('project')],
      [plugin('user'), plugin('project'), plugin('local')],
    ],
  }, fixture => {
    const error = captureError(() => (
      migrateClaudePluginScope(migrationOptions(fixture, 'project'))
    ));
    assert.strictEqual(error.phase, 'concurrency-check');
    assert.deepStrictEqual([...error.observedScopes].sort(), ['local', 'project', 'user']);
    assert.ok(!readCalls(fixture).some(argv => argv[1] === 'uninstall'));
  });
});

test('source uninstall failure reports both scopes and exact forward recovery', () => {
  withFixture({
    plugins: [plugin('user')],
    marketplaces: [marketplace('user')],
    failures: [{
      argv: uninstallArgv('user'),
      status: 9,
      stderr: 'uninstall failed',
      times: 1,
    }],
  }, fixture => {
    const error = captureError(() => (
      migrateClaudePluginScope(migrationOptions(fixture, 'project'))
    ));
    assert.strictEqual(error.phase, 'source-uninstall');
    assert.deepStrictEqual([...error.observedScopes].sort(), ['project', 'user']);
    assert.deepStrictEqual(error.recovery, [
      'claude plugin uninstall ecc@ecc --scope user --keep-data',
      'ecc setup --mode claude-plugin --scope project --move-scope --yes',
    ]);
    assert.ok(!readCalls(fixture).flat().includes('--prune'));
    assert.deepStrictEqual(
      readState(fixture).plugins.map(entry => entry.scope).sort(),
      ['project', 'user']
    );
  });
});

test('final verification failure is structured and leaves a resumable destination state', () => {
  withFixture({
    plugins: [plugin('user')],
    marketplaces: [marketplace('user')],
    pluginListResponses: [
      [plugin('user')],
      [plugin('user'), plugin('project')],
      [plugin('user'), plugin('project')],
      [],
    ],
  }, fixture => {
    const error = captureError(() => (
      migrateClaudePluginScope(migrationOptions(fixture, 'project'))
    ));
    assert.strictEqual(error.phase, 'final-verification');
    assert.deepStrictEqual(error.observedScopes, []);
    assert.deepStrictEqual(error.recovery, [
      'ecc setup --mode claude-plugin --scope project --move-scope --yes',
    ]);
    assert.deepStrictEqual(readState(fixture).plugins.map(entry => entry.scope), ['project']);
  });
});

test('dry-run returns exact ordered actions and performs no mutation', () => {
  withFixture({
    plugins: [plugin('user')],
    marketplaces: [marketplace('user')],
  }, fixture => {
    const before = fs.readFileSync(fixture.statePath, 'utf8');
    const result = migrateClaudePluginScope(migrationOptions(fixture, 'project', {
      dryRun: true,
    }));
    assert.strictEqual(result.action, 'would-migrate');
    assert.strictEqual(result.dryRun, true);
    assert.deepStrictEqual(result.plannedActions, [
      ['plugin', 'marketplace', 'update', 'ecc'],
      installArgv('project'),
      ['plugin', 'list', '--json'],
      ['plugin', 'list', '--json'],
      uninstallArgv('user'),
      ['plugin', 'list', '--json'],
    ]);
    assert.deepStrictEqual(mutationCalls(fixture), []);
    assert.strictEqual(fs.readFileSync(fixture.statePath, 'utf8'), before);
  });

  withFixture({
    plugins: [plugin('user'), plugin('project')],
    marketplaces: [marketplace('user')],
  }, fixture => {
    const result = migrateClaudePluginScope(migrationOptions(fixture, 'project', {
      dryRun: true,
    }));
    assert.strictEqual(result.action, 'would-resume');
    assert.strictEqual(result.sourceScope, 'user');
    assert.deepStrictEqual(result.plannedActions, [
      ['plugin', 'list', '--json'],
      ['plugin', 'list', '--json'],
      uninstallArgv('user'),
      ['plugin', 'list', '--json'],
    ]);
    assert.deepStrictEqual(mutationCalls(fixture), []);
  });
});

test('migration preserves hook preferences unless --hooks is explicit', () => {
  withFixture({
    plugins: [plugin('user')],
    marketplaces: [marketplace('user')],
  }, fixture => {
    const original = {
      theme: 'dark',
      pluginConfigs: {
        'another@market': { enabled: false },
        'ecc@ecc': {
          futureKey: { keep: true },
          options: {
            hooks_enabled: false,
            hook_profile: 'strict',
            unknown: 'keep',
          },
        },
      },
    };
    fs.writeFileSync(fixture.settingsPath, `${JSON.stringify(original, null, 2)}\n`);
    const result = migrateClaudePluginScope(migrationOptions(fixture, 'project'));
    assert.strictEqual(result.hooks, 'off');
    assert.deepStrictEqual(
      JSON.parse(fs.readFileSync(fixture.settingsPath, 'utf8')),
      original
    );
    assert.ok(readCalls(fixture).some(argv => (
      JSON.stringify(argv) === JSON.stringify(installArgv('project', 'off', 'strict'))
    )));
  });

  withFixture({
    plugins: [plugin('user')],
    marketplaces: [marketplace('user')],
  }, fixture => {
    fs.writeFileSync(fixture.settingsPath, JSON.stringify({
      theme: 'dark',
      pluginConfigs: {
        'ecc@ecc': {
          futureKey: true,
          options: { hooks_enabled: false, hook_profile: 'minimal', unknown: 'keep' },
        },
      },
    }));
    migrateClaudePluginScope(migrationOptions(fixture, 'project', { hooks: 'strict' }));
    const settings = JSON.parse(fs.readFileSync(fixture.settingsPath, 'utf8'));
    assert.strictEqual(settings.theme, 'dark');
    assert.strictEqual(settings.pluginConfigs['ecc@ecc'].futureKey, true);
    assert.strictEqual(settings.pluginConfigs['ecc@ecc'].options.unknown, 'keep');
    assert.strictEqual(settings.pluginConfigs['ecc@ecc'].options.hooks_enabled, true);
    assert.strictEqual(settings.pluginConfigs['ecc@ecc'].options.hook_profile, 'strict');
  });
});

console.log(`\nResults: Passed: ${passed}, Failed: ${failed}`);
process.exit(failed > 0 ? 1 : 0);
