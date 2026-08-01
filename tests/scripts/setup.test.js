'use strict';

const assert = require('assert');
const fs = require('fs');
const os = require('os');
const path = require('path');
const { spawnSync } = require('child_process');
const repoRoot = path.join(__dirname, '..', '..');
const setupScript = path.join(repoRoot, 'scripts', 'setup.js');
const eccScript = path.join(repoRoot, 'scripts', 'ecc.js');
const fakeClaudeScript = path.join(repoRoot, 'tests', 'fixtures', 'fake-claude-plugin.js');
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
function createFixture(state = {}) {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'ecc setup cli '));
  const homeDir = path.join(root, 'home');
  const configDir = path.join(root, 'config');
  const projectRoot = path.join(root, 'project');
  const binDir = path.join(root, 'bin');
  const statePath = path.join(root, 'state.json');
  const callsPath = path.join(root, 'calls.jsonl');
  for (const dir of [homeDir, configDir, projectRoot, binDir]) {
    fs.mkdirSync(dir, { recursive: true });
  }
  fs.writeFileSync(statePath, `${JSON.stringify({
    plugins: [],
    marketplaces: [],
    failures: [],
    ...state,
  }, null, 2)}\n`);
  const launcher = path.join(binDir, process.platform === 'win32' ? 'claude.cmd' : 'claude');
  const source = process.platform === 'win32'
    ? `@echo off\r\n"${process.execPath}" "${fakeClaudeScript}" %*\r\n`
    : `#!/bin/sh\nexec "${process.execPath}" "${fakeClaudeScript}" "$@"\n`;
  fs.writeFileSync(launcher, source);
  if (process.platform !== 'win32') fs.chmodSync(launcher, 0o755);
  return {
    root,
    homeDir,
    configDir,
    projectRoot,
    binDir,
    statePath,
    callsPath,
  };
}
function runSetup(fixture, args) {
  return spawnSync(process.execPath, [setupScript, ...args], {
    cwd: fixture.projectRoot,
    env: {
      ...process.env,
      HOME: fixture.homeDir,
      USERPROFILE: fixture.homeDir,
      CLAUDE_CONFIG_DIR: fixture.configDir,
      PATH: `${fixture.binDir}${path.delimiter}${process.env.PATH || ''}`,
      ECC_TEST_CLAUDE_STATE: fixture.statePath,
      ECC_TEST_CLAUDE_CALLS: fixture.callsPath,
    },
    encoding: 'utf8',
    timeout: 15000,
  });
}
function quoteShellArgument(value) {
  return `'${String(value).replace(/'/g, `'\\''`)}'`;
}
function runInteractiveEccSetup(fixture, options = {}) {
  if (process.platform === 'win32') {
    return null;
  }

  const args = options.args || ['--dry-run'];
  const answers = options.answers || ['3', '3'];
  const command = [
    process.execPath,
    eccScript,
    'setup',
    ...args,
  ];
  const scriptArgs = process.platform === 'darwin'
    ? ['-q', '-e', '/dev/null', ...command]
    : [
      '-q',
      '-e',
      '-c',
      command.map(quoteShellArgument).join(' '),
      '/dev/null',
    ];
  const pseudoTerminalCommand = ['script', ...scriptArgs]
    .map(quoteShellArgument)
    .join(' ');
  const answerCommands = answers
    .map(answer => `sleep 0.5; printf '%s\\n' ${quoteShellArgument(answer)}`)
    .join('; ');

  return spawnSync('sh', [
    '-c',
    `(${answerCommands}; sleep 0.1) | ${pseudoTerminalCommand}`,
  ], {
    cwd: fixture.projectRoot,
    env: {
      ...process.env,
      HOME: fixture.homeDir,
      USERPROFILE: fixture.homeDir,
      CLAUDE_CONFIG_DIR: fixture.configDir,
      PATH: `${fixture.binDir}${path.delimiter}${process.env.PATH || ''}`,
      ECC_TEST_CLAUDE_STATE: fixture.statePath,
      ECC_TEST_CLAUDE_CALLS: fixture.callsPath,
    },
    encoding: 'utf8',
    timeout: 15000,
  });
}
function readCalls(fixture) {
  if (!fs.existsSync(fixture.callsPath)) return [];
  return fs.readFileSync(fixture.callsPath, 'utf8')
    .trim()
    .split(/\r?\n/)
    .filter(Boolean)
    .map(line => JSON.parse(line));
}
function hasMutation(fixture) {
  return readCalls(fixture).some(argv => !(
    argv.join(' ') === 'plugin list --json'
    || argv.join(' ') === 'plugin marketplace list --json'
  ));
}

const SETUP_SPINNER_PATTERN = /[⠋⠙⠹⠸⠼⠴⠦⠧⠇⠏]\s+Applying ECC setup/;

function assertNoSetupSpinner(output) {
  assert.doesNotMatch(output, SETUP_SPINNER_PATTERN);
}

function assertSetupSpinnerLifecycle(output, outcomePattern) {
  const spinnerIndex = output.search(SETUP_SPINNER_PATTERN);
  const clearIndex = output.indexOf('\x1b[2K', spinnerIndex);
  const outcomeIndex = output.search(outcomePattern);
  assert.ok(spinnerIndex >= 0, 'confirmed interactive apply should start the setup spinner');
  assert.ok(clearIndex > spinnerIndex, 'setup spinner should clear its terminal line');
  assert.ok(outcomeIndex > clearIndex, 'setup spinner should clear before the final outcome');

  const visibleOutput = output
    // eslint-disable-next-line no-control-regex
    .replace(/\x1b\[[0-9;?]*[ -/]*[@-~]/g, '')
    .replace(/\r/g, '');
  assert.match(
    visibleOutput,
    /\[y\/N\] (?:y|yes)\n[⠋⠙⠹⠸⠼⠴⠦⠧⠇⠏]\s+Applying ECC setup/,
    'setup spinner should be the first visible status after confirmation'
  );

  assertNoSetupSpinner(output.slice(outcomeIndex));
}

function withFixture(state, fn) {
  const fixture = createFixture(state);
  try {
    fn(fixture);
  } finally {
    fs.rmSync(fixture.root, { recursive: true, force: true });
  }
}

console.log('\n=== ECC setup CLI tests ===\n');

test('fresh non-interactive plugin setup requires an explicit scope', () => {
  withFixture({}, fixture => {
    const result = runSetup(fixture, [
      '--mode', 'claude-plugin',
      '--hooks', 'standard',
      '--yes',
    ]);
    assert.strictEqual(result.status, 1);
    assert.match(result.stderr, /--scope/i);
    assert.strictEqual(hasMutation(fixture), false);
  });
});

test('an existing install without --scope updates its detected scope', () => {
  withFixture({
    plugins: [{ id: 'ecc@ecc', scope: 'project', enabled: true, version: '1.9.0' }],
    marketplaces: [{
      name: 'ecc',
      source: 'github',
      repo: 'affaan-m/ECC',
      scope: 'project',
    }],
  }, fixture => {
    const result = runSetup(fixture, [
      '--mode', 'claude-plugin',
      '--hooks', 'strict',
      '--yes',
      '--json',
    ]);
    assert.strictEqual(result.status, 0, result.stderr);
    const payload = JSON.parse(result.stdout);
    assert.strictEqual(payload.action, 'updated');
    assert.strictEqual(payload.scope, 'project');
    assertNoSetupSpinner(`${result.stdout}${result.stderr}`);
    assert.ok(readCalls(fixture).some(argv => (
      JSON.stringify(argv) === JSON.stringify([
        'plugin', 'update', 'ecc@ecc', '--scope', 'project',
      ])
    )));
  });
});

test('invalid plugin scopes and hook preferences are rejected before inventory', () => {
  withFixture({}, fixture => {
    for (const args of [
      ['--scope', 'global', '--hooks', 'standard'],
      ['--scope', 'user', '--hooks', 'aggressive'],
    ]) {
      const result = runSetup(fixture, [
        '--mode', 'claude-plugin',
        ...args,
        '--yes',
      ]);
      assert.strictEqual(result.status, 1);
      assert.match(result.stderr, /invalid/i);
    }
    assert.deepStrictEqual(readCalls(fixture), []);
  });
});

test('non-TTY mutation requires --yes', () => {
  withFixture({}, fixture => {
    const result = runSetup(fixture, [
      '--mode', 'claude-plugin',
      '--scope', 'user',
      '--hooks', 'standard',
    ]);
    assert.strictEqual(result.status, 1);
    assert.match(result.stderr, /--yes/i);
    assert.strictEqual(hasMutation(fixture), false);
  });
});

test('dry-run JSON emits JSON only and reads inventory without mutation', () => {
  withFixture({}, fixture => {
    const result = runSetup(fixture, [
      '--mode', 'claude-plugin',
      '--scope', 'local',
      '--hooks', 'minimal',
      '--dry-run',
      '--json',
    ]);
    assert.strictEqual(result.status, 0, result.stderr);
    const payload = JSON.parse(result.stdout);
    assert.strictEqual(result.stdout.trim(), JSON.stringify(payload, null, 2));
    assert.strictEqual(payload.action, 'would-install');
    assert.strictEqual(payload.scope, 'local');
    assertNoSetupSpinner(`${result.stdout}${result.stderr}`);
    assert.strictEqual(hasMutation(fixture), false);
  });
});

test('setup automatically migrates an existing install to the selected scope and hooks', () => {
  withFixture({
    plugins: [{ id: 'ecc@ecc', scope: 'local', enabled: true, version: '1.9.0' }],
    marketplaces: [{
      name: 'ecc',
      source: 'github',
      repo: 'affaan-m/ECC',
      scope: 'local',
    }],
  }, fixture => {
    const result = runSetup(fixture, [
      '--mode', 'claude-plugin',
      '--scope', 'user',
      '--hooks', 'minimal',
      '--yes',
      '--json',
    ]);
    assert.strictEqual(result.status, 0, result.stderr);
    const payload = JSON.parse(result.stdout);
    assert.strictEqual(payload.action, 'migrated');
    assert.strictEqual(payload.sourceScope, 'local');
    assert.strictEqual(payload.scope, 'user');
    assert.strictEqual(payload.hooks, 'minimal');
    const calls = readCalls(fixture);
    assert.ok(calls.some(argv => (
      argv.join(' ') === 'plugin install ecc@ecc --scope user'
        + ' --config hooks_enabled=true --config hook_profile=minimal'
    )));
    assert.ok(calls.some(argv => (
      argv.join(' ') === 'plugin uninstall ecc@ecc --scope local --keep-data'
    )));
    assert.ok(!calls.flat().includes('--prune'));
    const state = JSON.parse(fs.readFileSync(fixture.statePath, 'utf8'));
    assert.deepStrictEqual(state.plugins, [{
      id: 'ecc@ecc',
      scope: 'user',
      enabled: true,
      version: '2.0.0',
    }]);
    const settings = JSON.parse(
      fs.readFileSync(path.join(fixture.configDir, 'settings.json'), 'utf8')
    );
    assert.strictEqual(settings.pluginConfigs['ecc@ecc'].options.hooks_enabled, true);
    assert.strictEqual(settings.pluginConfigs['ecc@ecc'].options.hook_profile, 'minimal');
  });
});

test('setup resumes a safe two-scope migration without requiring --move-scope', () => {
  withFixture({
    plugins: [
      { id: 'ecc@ecc', scope: 'local', enabled: true, version: '1.9.0' },
      { id: 'ecc@ecc', scope: 'user', enabled: true, version: '2.0.0' },
    ],
    marketplaces: [{
      name: 'ecc',
      source: 'github',
      repo: 'affaan-m/ECC',
      scope: 'user',
    }],
  }, fixture => {
    const result = runSetup(fixture, [
      '--mode', 'claude-plugin',
      '--scope', 'user',
      '--hooks', 'minimal',
      '--yes',
      '--json',
    ]);
    assert.strictEqual(result.status, 0, result.stderr);
    const payload = JSON.parse(result.stdout);
    assert.strictEqual(payload.action, 'resumed');
    assert.strictEqual(payload.sourceScope, 'local');
    assert.strictEqual(payload.scope, 'user');
    assert.ok(readCalls(fixture).some(argv => (
      argv.join(' ') === 'plugin uninstall ecc@ecc --scope local --keep-data'
    )));
  });
});

test('all interrupted migration and hook combinations resume without reinstalling', () => {
  const scopes = ['user', 'project', 'local'];
  const hooks = ['off', 'minimal', 'standard', 'strict'];
  for (const sourceScope of scopes) {
    for (const destinationScope of scopes.filter(scope => scope !== sourceScope)) {
      for (const hookMode of hooks) {
        withFixture({
          plugins: [
            { id: 'ecc@ecc', scope: sourceScope, enabled: true, version: '1.9.0' },
            { id: 'ecc@ecc', scope: destinationScope, enabled: true, version: '2.0.0' },
          ],
          marketplaces: [{
            name: 'ecc',
            source: 'github',
            repo: 'affaan-m/ECC',
            scope: destinationScope,
          }],
        }, fixture => {
          const result = runSetup(fixture, [
            '--mode', 'claude-plugin',
            '--scope', destinationScope,
            '--hooks', hookMode,
            '--yes',
            '--json',
          ]);
          assert.strictEqual(result.status, 0, result.stderr);
          const payload = JSON.parse(result.stdout);
          assert.strictEqual(payload.action, 'resumed');
          assert.strictEqual(payload.sourceScope, sourceScope);
          assert.strictEqual(payload.scope, destinationScope);
          assert.strictEqual(payload.hooks, hookMode);

          const calls = readCalls(fixture);
          assert.ok(!calls.some(argv => argv[1] === 'install'));
          assert.ok(calls.some(argv => (
            argv.join(' ') === `plugin uninstall ecc@ecc --scope ${sourceScope} --keep-data`
          )));
          const state = JSON.parse(fs.readFileSync(fixture.statePath, 'utf8'));
          assert.deepStrictEqual(state.plugins, [{
            id: 'ecc@ecc',
            scope: destinationScope,
            enabled: true,
            version: '2.0.0',
          }]);
          const settings = JSON.parse(
            fs.readFileSync(path.join(fixture.configDir, 'settings.json'), 'utf8')
          );
          const stored = settings.pluginConfigs['ecc@ecc'].options;
          assert.strictEqual(stored.hooks_enabled, hookMode !== 'off');
          assert.strictEqual(
            stored.hook_profile,
            hookMode === 'off' ? 'standard' : hookMode
          );
        });
      }
    }
  }
});

test('--move-scope remains explicit about its destination', () => {
  withFixture({
    plugins: [{ id: 'ecc@ecc', scope: 'user', enabled: true, version: '1.9.0' }],
  }, fixture => {
    const result = runSetup(fixture, [
      '--mode', 'claude-plugin',
      '--move-scope',
      '--yes',
      '--json',
    ]);
    assert.strictEqual(result.status, 1);
    assert.match(result.stderr, /scope/i);
    assert.strictEqual(hasMutation(fixture), false);
  });
});

test('destination-only --move-scope is an idempotent first call', () => {
  withFixture({
    plugins: [{ id: 'ecc@ecc', scope: 'local', enabled: true, version: '2.0.0' }],
  }, fixture => {
    const result = runSetup(fixture, [
      '--mode', 'claude-plugin',
      '--scope', 'local',
      '--move-scope',
      '--yes',
      '--json',
    ]);
    assert.strictEqual(result.status, 0, result.stderr);
    const payload = JSON.parse(result.stdout);
    assert.strictEqual(payload.action, 'already-migrated');
    assert.strictEqual(payload.scope, 'local');
    assert.strictEqual(hasMutation(fixture), false);
  });
});

test('destination-only --move-scope applies explicit hook preferences', () => {
  withFixture({
    plugins: [{ id: 'ecc@ecc', scope: 'local', enabled: true, version: '2.0.0' }],
  }, fixture => {
    const result = runSetup(fixture, [
      '--mode', 'claude-plugin',
      '--scope', 'local',
      '--move-scope',
      '--hooks', 'strict',
      '--yes',
      '--json',
    ]);
    assert.strictEqual(result.status, 0, result.stderr);
    const payload = JSON.parse(result.stdout);
    assert.strictEqual(payload.action, 'already-migrated');
    assert.strictEqual(payload.preferencesUpdated, true);
    const settings = JSON.parse(
      fs.readFileSync(path.join(fixture.configDir, 'settings.json'), 'utf8')
    );
    assert.strictEqual(settings.pluginConfigs['ecc@ecc'].options.hooks_enabled, true);
    assert.strictEqual(settings.pluginConfigs['ecc@ecc'].options.hook_profile, 'strict');
  });
});

test('migration dry-run JSON exposes ordered actions without mutation', () => {
  withFixture({
    plugins: [{ id: 'ecc@ecc', scope: 'user', enabled: true, version: '1.9.0' }],
    marketplaces: [{
      name: 'ecc',
      source: 'github',
      repo: 'affaan-m/ECC',
      scope: 'user',
    }],
  }, fixture => {
    const result = runSetup(fixture, [
      '--mode', 'claude-plugin',
      '--scope', 'project',
      '--dry-run',
      '--json',
    ]);
    assert.strictEqual(result.status, 0, result.stderr);
    const payload = JSON.parse(result.stdout);
    assert.strictEqual(payload.action, 'would-migrate');
    assert.strictEqual(payload.dryRun, true);
    assert.deepStrictEqual(payload.plannedActions.slice(-4), [
      ['plugin', 'list', '--json'],
      ['plugin', 'list', '--json'],
      ['plugin', 'uninstall', 'ecc@ecc', '--scope', 'user', '--keep-data'],
      ['plugin', 'list', '--json'],
    ]);
    assert.strictEqual(hasMutation(fixture), false);
  });
});

test('migration JSON failures retain phase, scopes, and exact recovery', () => {
  withFixture({
    plugins: [{ id: 'ecc@ecc', scope: 'user', enabled: true, version: '1.9.0' }],
    marketplaces: [{
      name: 'ecc',
      source: 'github',
      repo: 'affaan-m/ECC',
      scope: 'user',
    }],
    failures: [{
      argv: ['plugin', 'uninstall', 'ecc@ecc', '--scope', 'user', '--keep-data'],
      status: 9,
      stderr: 'uninstall failed',
      times: 1,
    }],
  }, fixture => {
    const result = runSetup(fixture, [
      '--mode', 'claude-plugin',
      '--scope', 'project',
      '--move-scope',
      '--yes',
      '--json',
    ]);
    assert.strictEqual(result.status, 1);
    assert.strictEqual(result.stdout, '');
    const payload = JSON.parse(result.stderr);
    assert.strictEqual(payload.error.phase, 'source-uninstall');
    assert.deepStrictEqual([...payload.error.observedScopes].sort(), ['project', 'user']);
    assert.deepStrictEqual(payload.error.recovery, [
      'claude plugin uninstall ecc@ecc --scope user --keep-data',
      'ecc setup --mode claude-plugin --scope project --move-scope --yes',
    ]);
  });
});

test('help explains native scope names in user-facing language', () => {
  const result = spawnSync(process.execPath, [setupScript, '--help'], {
    cwd: repoRoot,
    encoding: 'utf8',
  });
  assert.strictEqual(result.status, 0, result.stderr);
  assert.match(result.stdout, /(?:user.{0,80}global|global.{0,80}user)/is);
  assert.match(result.stdout, /(?:project.{0,80}shared|shared.{0,80}project)/is);
  assert.match(result.stdout, /(?:local.{0,80}private|private.{0,80}local)/is);
  assert.match(result.stdout, /--hooks off\|minimal\|standard\|strict/);
  assert.match(result.stdout, /--move-scope/);
});

test('ecc setup delegates to the focused setup command', () => {
  const result = spawnSync(process.execPath, [eccScript, 'setup', '--help'], {
    cwd: repoRoot,
    encoding: 'utf8',
    timeout: 15000,
  });
  assert.strictEqual(result.status, 0, result.stderr);
  assert.match(result.stdout, /ECC (guided )?setup/i);
  assert.match(result.stdout, /claude-plugin/);
});

test('ecc setup preserves a real terminal for the interactive wizard', () => {
  if (process.platform === 'win32') return;

  withFixture({}, fixture => {
    const result = runInteractiveEccSetup(fixture);
    assert.strictEqual(result.status, 0, `${result.stdout}\n${result.stderr}`);
    assert.ifError(result.error);
    assert.match(result.stdout, /Where should Claude enable ecc@ecc\?/);
    assert.match(result.stdout, /How should ECC hooks run\?/);
    assert.doesNotMatch(result.stdout, /Interactive setup requires a terminal/);
    assertNoSetupSpinner(`${result.stdout}${result.stderr}`);
  });
});

test('confirmed interactive apply starts immediately and clears the spinner on success', () => {
  if (process.platform === 'win32') return;

  withFixture({}, fixture => {
    const result = runInteractiveEccSetup(fixture, {
      args: [],
      answers: ['2', '2', 'y'],
    });
    assert.ifError(result.error);
    assert.strictEqual(result.status, 0, `${result.stdout}\n${result.stderr}`);
    assertSetupSpinnerLifecycle(
      `${result.stdout}${result.stderr}`,
      /ECC installed ecc@ecc at project scope/
    );
  });
});

test('confirmed interactive apply clears and stops the spinner when apply throws', () => {
  if (process.platform === 'win32') return;

  withFixture({
    failures: [{
      argv: [
        'plugin', 'marketplace', 'add',
        'https://github.com/affaan-m/ECC',
        '--scope', 'user',
      ],
      status: 8,
      stderr: 'injected apply failure',
      times: 1,
    }],
  }, fixture => {
    const result = runInteractiveEccSetup(fixture, {
      args: [],
      answers: ['1', '3', 'yes'],
    });
    assert.ifError(result.error);
    assert.strictEqual(result.status, 1, `${result.stdout}\n${result.stderr}`);
    assertSetupSpinnerLifecycle(
      `${result.stdout}${result.stderr}`,
      /Error: Claude Code command failed: injected apply failure/
    );
  });
});

test('all interactive scope and hook choices install and persist the selected configuration', () => {
  if (process.platform === 'win32') return;

  const scopes = ['user', 'project', 'local'];
  const hooks = ['off', 'minimal', 'standard', 'strict'];
  for (const [scopeIndex, scope] of scopes.entries()) {
    for (const [hookIndex, hookMode] of hooks.entries()) {
      withFixture({}, fixture => {
        const result = runInteractiveEccSetup(fixture, {
          args: [],
          answers: [String(scopeIndex + 1), String(hookIndex + 1), 'y'],
        });
        assert.ifError(result.error);
        assert.strictEqual(result.status, 0, `${result.stdout}\n${result.stderr}`);
        assert.match(result.stdout, new RegExp(`ECC installed ecc@ecc at ${scope} scope`));
        assert.match(result.stdout, new RegExp(`Hook preference: ${hookMode}`));

        const state = JSON.parse(fs.readFileSync(fixture.statePath, 'utf8'));
        assert.deepStrictEqual(state.plugins, [{
          id: 'ecc@ecc',
          scope,
          enabled: true,
          version: '2.0.0',
        }]);
        const settings = JSON.parse(
          fs.readFileSync(path.join(fixture.configDir, 'settings.json'), 'utf8')
        );
        const stored = settings.pluginConfigs['ecc@ecc'].options;
        assert.strictEqual(stored.hooks_enabled, hookMode !== 'off');
        assert.strictEqual(stored.hook_profile, hookMode === 'off' ? 'standard' : hookMode);
      });
    }
  }
});

test('all interactive choices from an existing install update or migrate to the selected configuration', () => {
  if (process.platform === 'win32') return;

  const scopes = ['user', 'project', 'local'];
  const hooks = ['off', 'minimal', 'standard', 'strict'];
  for (const [sourceIndex, sourceScope] of scopes.entries()) {
    for (const [selectedIndex, selectedScope] of scopes.entries()) {
      for (const [hookIndex, hookMode] of hooks.entries()) {
        withFixture({
          plugins: [{ id: 'ecc@ecc', scope: sourceScope, enabled: true, version: '1.9.0' }],
          marketplaces: [{
            name: 'ecc',
            source: 'github',
            repo: 'affaan-m/ECC',
            scope: sourceScope,
          }],
        }, fixture => {
          const result = runInteractiveEccSetup(fixture, {
            args: [],
            answers: [String(selectedIndex + 1), String(hookIndex + 1), 'y'],
          });
          assert.ifError(result.error);
          assert.strictEqual(result.status, 0, `${result.stdout}\n${result.stderr}`);

          const expectedAction = sourceIndex === selectedIndex ? 'updated' : 'migrated';
          const expectedConfirmation = sourceIndex === selectedIndex ? 'Apply' : 'Migrate';
          assert.match(
            result.stdout,
            new RegExp(`${expectedConfirmation} claude-plugin setup at ${selectedScope} scope`)
          );
          assert.match(
            result.stdout,
            new RegExp(`ECC ${expectedAction} ecc@ecc at ${selectedScope} scope`)
          );
          assert.match(result.stdout, new RegExp(`Hook preference: ${hookMode}`));

          const state = JSON.parse(fs.readFileSync(fixture.statePath, 'utf8'));
          assert.deepStrictEqual(state.plugins, [{
            id: 'ecc@ecc',
            scope: selectedScope,
            enabled: true,
            version: '2.0.0',
          }]);
          const settings = JSON.parse(
            fs.readFileSync(path.join(fixture.configDir, 'settings.json'), 'utf8')
          );
          const stored = settings.pluginConfigs['ecc@ecc'].options;
          assert.strictEqual(stored.hooks_enabled, hookMode !== 'off');
          assert.strictEqual(stored.hook_profile, hookMode === 'off' ? 'standard' : hookMode);
        });
      }
    }
  }
});

test('interactive named choices install and persist the selected configuration', () => {
  if (process.platform === 'win32') return;

  withFixture({}, fixture => {
    const result = runInteractiveEccSetup(fixture, {
      args: [],
      answers: ['project', 'strict', 'yes'],
    });
    assert.ifError(result.error);
    assert.strictEqual(result.status, 0, `${result.stdout}\n${result.stderr}`);
    assert.match(result.stdout, /ECC installed ecc@ecc at project scope/);
    assert.match(result.stdout, /Hook preference: strict/);

    const state = JSON.parse(fs.readFileSync(fixture.statePath, 'utf8'));
    assert.deepStrictEqual(state.plugins, [{
      id: 'ecc@ecc',
      scope: 'project',
      enabled: true,
      version: '2.0.0',
    }]);
    const settings = JSON.parse(
      fs.readFileSync(path.join(fixture.configDir, 'settings.json'), 'utf8')
    );
    const stored = settings.pluginConfigs['ecc@ecc'].options;
    assert.strictEqual(stored.hooks_enabled, true);
    assert.strictEqual(stored.hook_profile, 'strict');
  });
});

test('invalid interactive choices explain the problem and allow a retry', () => {
  if (process.platform === 'win32') return;

  withFixture({}, fixture => {
    const result = runInteractiveEccSetup(fixture, {
      args: ['--dry-run'],
      answers: ['1.5', 'not-a-scope', '2', '2junk', '9', '2'],
    });
    assert.ifError(result.error);
    assert.strictEqual(result.status, 0, `${result.stdout}\n${result.stderr}`);
    assert.match(result.stdout, /Please choose 1, 2, or 3/);
    assert.match(result.stdout, /Please choose 1, 2, 3, or 4/);
    assert.match(result.stdout, /ECC would-install ecc@ecc at project scope/);
    assert.match(result.stdout, /Hook preference: minimal/);
    assert.strictEqual(hasMutation(fixture), false);
  });
});

test('interactive cancellation after non-default choices performs no mutation', () => {
  if (process.platform === 'win32') return;

  withFixture({}, fixture => {
    const result = runInteractiveEccSetup(fixture, {
      args: [],
      answers: ['2', '2', 'n'],
    });
    assert.ifError(result.error);
    assert.strictEqual(result.status, 0, `${result.stdout}\n${result.stderr}`);
    assert.match(result.stdout, /ECC cancelled ecc@ecc at project scope/);
    assertNoSetupSpinner(`${result.stdout}${result.stderr}`);
    assert.strictEqual(hasMutation(fixture), false);
    assert.ok(!fs.existsSync(path.join(fixture.configDir, 'settings.json')));
  });
});

test('closing interactive input cancels cleanly without mutation', () => {
  if (process.platform === 'win32') return;

  withFixture({}, fixture => {
    const result = runInteractiveEccSetup(fixture, {
      args: [],
      answers: ['2', '\u0004'],
    });
    assert.strictEqual(result.status, 0, `${result.stdout}\n${result.stderr}`);
    assert.ifError(result.error);
    assert.match(result.stdout, /cancelled/i);
    assert.match(result.stdout, /no changes/i);
    assert.strictEqual(hasMutation(fixture), false);
    assert.ok(!fs.existsSync(path.join(fixture.configDir, 'settings.json')));
  });
});

test('interactive mode flag still prompts for missing scope and hook choices', () => {
  if (process.platform === 'win32') return;

  withFixture({}, fixture => {
    const result = runInteractiveEccSetup(fixture, {
      args: ['--mode', 'claude-plugin', '--dry-run'],
      answers: ['3', '4'],
    });
    assert.ifError(result.error);
    assert.strictEqual(result.status, 0, `${result.stdout}\n${result.stderr}`);
    assert.match(result.stdout, /Where should Claude enable ecc@ecc\?/);
    assert.match(result.stdout, /How should ECC hooks run\?/);
    assert.match(result.stdout, /ECC would-install ecc@ecc at local scope/);
    assert.match(result.stdout, /Hook preference: strict/);
  });
});

test('interactive defaults preserve an existing install scope and hook preference', () => {
  if (process.platform === 'win32') return;

  withFixture({
    plugins: [{ id: 'ecc@ecc', scope: 'local', enabled: true, version: '1.9.0' }],
    marketplaces: [{
      name: 'ecc',
      source: 'github',
      repo: 'affaan-m/ECC',
      scope: 'local',
    }],
  }, fixture => {
    fs.writeFileSync(path.join(fixture.configDir, 'settings.json'), JSON.stringify({
      pluginConfigs: {
        'ecc@ecc': {
          options: { hooks_enabled: true, hook_profile: 'minimal' },
        },
      },
    }));
    const result = runInteractiveEccSetup(fixture, {
      args: ['--dry-run'],
      answers: ['', ''],
    });
    assert.ifError(result.error);
    assert.strictEqual(result.status, 0, `${result.stdout}\n${result.stderr}`);
    assert.match(result.stdout, /Choose \[3\]:/);
    assert.match(result.stdout, /Choose \[2\]:/);
    assert.match(result.stdout, /ECC would-update ecc@ecc at local scope/);
    assert.match(result.stdout, /Hook preference: minimal/);
    assert.strictEqual(hasMutation(fixture), false);
  });
});

test('partial migration requires an explicit destination and preserves stored hook defaults', () => {
  if (process.platform === 'win32') return;

  withFixture({
    plugins: [
      { id: 'ecc@ecc', scope: 'user', enabled: true, version: '1.9.0' },
      { id: 'ecc@ecc', scope: 'project', enabled: true, version: '2.0.0' },
    ],
    marketplaces: [{
      name: 'ecc',
      source: 'github',
      repo: 'affaan-m/ECC',
      scope: 'user',
    }],
  }, fixture => {
    fs.writeFileSync(path.join(fixture.configDir, 'settings.json'), JSON.stringify({
      pluginConfigs: {
        'ecc@ecc': {
          options: { hooks_enabled: true, hook_profile: 'minimal' },
        },
      },
    }));
    const result = runInteractiveEccSetup(fixture, {
      args: ['--dry-run'],
      answers: ['', 'project', ''],
    });
    assert.ifError(result.error);
    assert.strictEqual(result.status, 0, `${result.stdout}\n${result.stderr}`);
    assert.match(result.stdout, /Choose: /);
    assert.match(result.stdout, /Please choose 1, 2, or 3/);
    assert.match(result.stdout, /Choose \[2\]:/);
    assert.match(result.stdout, /ECC would-resume ecc@ecc at project scope/);
    assert.match(result.stdout, /Previous scope: user/);
    assert.match(result.stdout, /Hook preference: minimal/);
    assert.strictEqual(hasMutation(fixture), false);
  });
});

console.log(`\nResults: Passed: ${passed}, Failed: ${failed}`);
process.exit(failed > 0 ? 1 : 0);
