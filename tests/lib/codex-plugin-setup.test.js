'use strict';

const assert = require('assert');
const fs = require('fs');
const path = require('path');

const {
  CodexPluginSetupError,
  OFFICIAL_MARKETPLACE_REPO,
  executeFile,
  normalizeGitHubGitOrigin,
  parseMarketplaceInventory,
  parseMarketplaceUpgradeResult,
  parsePluginInventory,
  reconcileCodexPlugin,
  resolveMarketplaceRepository,
  runCodexCommand,
} = require('../../scripts/lib/codex-plugin-setup');

const MARKETPLACE_LIST = ['plugin', 'marketplace', 'list', '--json'];
const PLUGIN_LIST = ['plugin', 'list', '--json'];
const MARKETPLACE_ADD = [
  'plugin', 'marketplace', 'add', OFFICIAL_MARKETPLACE_REPO, '--json',
];
const MARKETPLACE_UPGRADE = [
  'plugin', 'marketplace', 'upgrade', 'ecc', '--json',
];
const PLUGIN_ADD = ['plugin', 'add', 'ecc@ecc', '--json'];

function marketplaceInventory(installed = false) {
  return JSON.stringify({
    marketplaces: installed ? [{ name: 'ecc', root: '/cache/ecc' }] : [],
  });
}

function pluginInventory(installed = false, overrides = {}) {
  const ecc = {
    pluginId: 'ecc@ecc',
    name: 'ecc',
    marketplaceName: 'ecc',
    version: '2.0.0',
    installed: true,
    enabled: true,
    ...overrides,
  };
  return JSON.stringify({
    installed: installed ? [ecc] : [],
    available: [],
  });
}

function marketplaceUpgradeResult(overrides = {}) {
  return JSON.stringify({
    selectedMarketplaces: ['ecc'],
    upgradedRoots: ['/cache/ecc'],
    errors: [],
    ...overrides,
  });
}

function createExecFile(steps) {
  const calls = [];
  const execFile = (command, args, options, callback) => {
    calls.push({ command, args: [...args], options: { ...options } });
    const step = steps[calls.length - 1];
    if (!step) {
      callback(new Error(`Unexpected Codex invocation: ${args.join(' ')}`));
      return;
    }
    if (step.command) assert.strictEqual(command, step.command);
    assert.deepStrictEqual(args, step.args);
    callback(step.error || null, step.stdout || '', step.stderr || '');
  };
  return { calls, execFile };
}

function dependenciesFor(fake, overrides = {}) {
  return {
    execFile: fake.execFile,
    // Keep argv assertions independent of whether the host has a Codex shim on PATH.
    resolveCodexCommand: () => ({ command: 'codex', prefixArgs: [] }),
    resolveMarketplaceRepository: async () => 'https://github.com/affaan-m/ECC.git',
    ...overrides,
  };
}

async function expectSetupError(promise, code, messagePattern) {
  await assert.rejects(promise, error => {
    assert.ok(error instanceof CodexPluginSetupError);
    assert.strictEqual(error.code, code);
    assert.match(error.message, messagePattern);
    return true;
  });
}

async function test(name, fn) {
  try {
    await fn();
    console.log(`  \u2713 ${name}`);
    return true;
  } catch (error) {
    console.log(`  \u2717 ${name}`);
    console.log(`    Error: ${error.stack || error.message}`);
    return false;
  }
}

async function runTests() {
  console.log('\n=== Codex native plugin setup library tests ===\n');
  let passed = 0;
  let failed = 0;

  const cases = [
    ['parses current Codex marketplace and plugin JSON inventory shapes', () => {
      assert.deepStrictEqual(
        parseMarketplaceInventory(marketplaceInventory(true)),
        [{ name: 'ecc', root: '/cache/ecc' }]
      );
      assert.strictEqual(
        parsePluginInventory(pluginInventory(true)).installed[0].pluginId,
        'ecc@ecc'
      );
      assert.strictEqual(
        normalizeGitHubGitOrigin('git@github.com:affaan-m/ECC.git'),
        'affaan-m/ecc'
      );
    }],
    ['resolves marketplace provenance with execFile and exact Git argv', async () => {
      const fake = createExecFile([{
        command: 'git',
        args: ['-C', '/cache/ecc', 'remote', 'get-url', 'origin'],
        stdout: 'https://github.com/affaan-m/ECC.git\n',
      }]);

      const repository = await resolveMarketplaceRepository(
        { name: 'ecc', root: '/cache/ecc' },
        { cwd: '/workspace with spaces' },
        { execFile: fake.execFile }
      );

      assert.strictEqual(repository, 'https://github.com/affaan-m/ECC.git');
      assert.strictEqual(fake.calls[0].options.shell, false);
      assert.strictEqual(fake.calls[0].options.cwd, '/workspace with spaces');
      assert.ok(fake.calls[0].options.timeout > 0);
      assert.strictEqual(fake.calls[0].options.killSignal, 'SIGKILL');
    }],
    ['preserves the original execFile error and attaches callback output', async () => {
      const original = new Error('provider failed');
      const execFile = (command, args, options, callback) => {
        callback(original, 'partial stdout', 'partial stderr');
      };

      await assert.rejects(
        executeFile(execFile, 'codex', ['plugin', 'list'], {}),
        error => {
          assert.strictEqual(error, original);
          assert.strictEqual(error.stdout, 'partial stdout');
          assert.strictEqual(error.stderr, 'partial stderr');
          assert.match(error.stack, /provider failed/);
          return true;
        }
      );
    }],
    ['maps provider and provenance timeouts to distinct structured errors', async () => {
      const providerTimeout = Object.assign(new Error('timed out'), {
        code: 'ETIMEDOUT',
        killed: true,
        signal: 'SIGKILL',
      });
      const provider = createExecFile([{ args: MARKETPLACE_LIST, error: providerTimeout }]);
      await expectSetupError(
        reconcileCodexPlugin({}, dependenciesFor(provider)),
        'CODEX_COMMAND_TIMEOUT',
        /timed out/i
      );

      const provenanceTimeout = Object.assign(new Error('timed out'), {
        code: 'ETIMEDOUT',
        killed: true,
        signal: 'SIGKILL',
      });
      const provenance = createExecFile([{
        command: 'git',
        args: ['-C', '/cache/ecc', 'remote', 'get-url', 'origin'],
        error: provenanceTimeout,
      }]);
      await expectSetupError(
        resolveMarketplaceRepository(
          { name: 'ecc', root: '/cache/ecc' },
          {},
          { execFile: provenance.execFile }
        ),
        'MARKETPLACE_PROVENANCE_TIMEOUT',
        /timed out/i
      );
      assert.ok(provenance.calls[0].options.timeout > 0);
      assert.strictEqual(provenance.calls[0].options.killSignal, 'SIGKILL');
    }],
    ['rejects unverifiable Git provenance without using a shell', async () => {
      const gitFailure = Object.assign(new Error('no origin'), {
        stderr: 'fatal: No such remote origin',
      });
      const fake = createExecFile([{
        command: 'git',
        args: ['-C', '/cache/ecc', 'remote', 'get-url', 'origin'],
        error: gitFailure,
      }]);

      await expectSetupError(
        resolveMarketplaceRepository(
          { name: 'ecc', root: '/cache/ecc' },
          {},
          { execFile: fake.execFile }
        ),
        'MARKETPLACE_COLLISION',
        /provenance could not be verified/i
      );
      assert.strictEqual(fake.calls[0].options.shell, false);
    }],
    ['fresh install uses exact native Codex argv and verifies both mutations', async () => {
      const fake = createExecFile([
        { args: MARKETPLACE_LIST, stdout: marketplaceInventory(false) },
        { args: PLUGIN_LIST, stdout: pluginInventory(false) },
        { args: MARKETPLACE_ADD, stdout: '{"alreadyAdded":false}' },
        { args: MARKETPLACE_LIST, stdout: marketplaceInventory(true) },
        { args: PLUGIN_ADD, stdout: '{"pluginId":"ecc@ecc"}' },
        { args: PLUGIN_LIST, stdout: pluginInventory(true) },
      ]);

      const result = await reconcileCodexPlugin(
        { cwd: '/workspace with spaces' },
        dependenciesFor(fake)
      );

      assert.deepStrictEqual(result, {
        action: 'installed',
        marketplaceAction: 'added',
        pluginId: 'ecc@ecc',
        restartRequired: true,
      });
      assert.deepStrictEqual(fake.calls.map(call => call.args), [
        MARKETPLACE_LIST,
        PLUGIN_LIST,
        MARKETPLACE_ADD,
        MARKETPLACE_LIST,
        PLUGIN_ADD,
        PLUGIN_LIST,
      ]);
      for (const call of fake.calls) {
        assert.strictEqual(call.command, 'codex');
        assert.strictEqual(call.options.cwd, '/workspace with spaces');
        assert.strictEqual(call.options.shell, false);
        assert.ok(call.options.timeout > 0);
        assert.strictEqual(call.options.killSignal, 'SIGKILL');
        assert.ok(!call.args.includes('--config'));
        assert.ok(!call.args.includes('-c'));
      }
    }],
    ['already installed and enabled is refreshed and strongly verified', async () => {
      const fake = createExecFile([
        { args: MARKETPLACE_LIST, stdout: marketplaceInventory(true) },
        { args: PLUGIN_LIST, stdout: pluginInventory(true) },
        { args: MARKETPLACE_UPGRADE, stdout: marketplaceUpgradeResult() },
        { args: MARKETPLACE_LIST, stdout: marketplaceInventory(true) },
        { args: PLUGIN_LIST, stdout: pluginInventory(true) },
      ]);

      const result = await reconcileCodexPlugin({}, dependenciesFor(fake));

      assert.deepStrictEqual(result, {
        action: 'updated',
        marketplaceAction: 'upgraded',
        pluginId: 'ecc@ecc',
        restartRequired: true,
      });
      assert.deepStrictEqual(fake.calls.map(call => call.args), [
        MARKETPLACE_LIST,
        PLUGIN_LIST,
        MARKETPLACE_UPGRADE,
        MARKETPLACE_LIST,
        PLUGIN_LIST,
      ]);
    }],
    ['fails closed when native refresh does not confirm the marketplace root', async () => {
      const fake = createExecFile([
        { args: MARKETPLACE_LIST, stdout: marketplaceInventory(true) },
        { args: PLUGIN_LIST, stdout: pluginInventory(true) },
        {
          args: MARKETPLACE_UPGRADE,
          stdout: marketplaceUpgradeResult({ upgradedRoots: [] }),
        },
      ]);

      await assert.rejects(
        reconcileCodexPlugin({}, dependenciesFor(fake)),
        error => {
          assert.strictEqual(error.code, 'MARKETPLACE_REFRESH_FAILED');
          assert.strictEqual(error.phase, 'marketplace-upgrade');
          assert.deepStrictEqual(error.argv, MARKETPLACE_UPGRADE);
          assert.match(error.message, /did not confirm.*refreshed/i);
          return true;
        }
      );
      assert.strictEqual(fake.calls.length, 3);
    }],
    ['accepts the provider root across Windows separator and case differences', () => {
      const result = parseMarketplaceUpgradeResult(
        marketplaceUpgradeResult({
          upgradedRoots: ['c:/users/hira/.codex/marketplaces/ecc'],
        }),
        { name: 'ecc', root: 'C:\\Users\\Hira\\.codex\\marketplaces\\ecc' }
      );

      assert.deepStrictEqual(result.selectedMarketplaces, ['ecc']);
    }],
    ['rejects ambiguous native refresh results for a targeted upgrade', () => {
      assert.throws(
        () => parseMarketplaceUpgradeResult(
          marketplaceUpgradeResult({
            selectedMarketplaces: ['ecc', 'other'],
            upgradedRoots: ['/cache/ecc', '/cache/other'],
          }),
          { name: 'ecc', root: '/cache/ecc' }
        ),
        error => (
          error.code === 'MARKETPLACE_REFRESH_FAILED'
          && error.phase === 'marketplace-upgrade'
        )
      );
      assert.throws(
        () => parseMarketplaceUpgradeResult(
          marketplaceUpgradeResult({ errors: [{ message: 'dirty checkout' }] }),
          { name: 'ecc', root: '/cache/ecc' }
        ),
        error => error.code === 'MARKETPLACE_REFRESH_FAILED'
      );
    }],
    ['fails closed when post-refresh marketplace provenance changes', async () => {
      const fake = createExecFile([
        { args: MARKETPLACE_LIST, stdout: marketplaceInventory(true) },
        { args: PLUGIN_LIST, stdout: pluginInventory(true) },
        { args: MARKETPLACE_UPGRADE, stdout: marketplaceUpgradeResult() },
        { args: MARKETPLACE_LIST, stdout: marketplaceInventory(true) },
      ]);
      let provenanceChecks = 0;

      await expectSetupError(
        reconcileCodexPlugin({}, dependenciesFor(fake, {
          resolveMarketplaceRepository: async () => {
            provenanceChecks += 1;
            return provenanceChecks === 1
              ? 'https://github.com/affaan-m/ECC.git'
              : 'https://github.com/attacker/ecc.git';
          },
        })),
        'MARKETPLACE_COLLISION',
        /not the official/i
      );
      assert.strictEqual(provenanceChecks, 2);
      assert.strictEqual(fake.calls.length, 4);
    }],
    ['fails closed on malformed post-refresh plugin inventory', async () => {
      const fake = createExecFile([
        { args: MARKETPLACE_LIST, stdout: marketplaceInventory(true) },
        { args: PLUGIN_LIST, stdout: pluginInventory(true) },
        { args: MARKETPLACE_UPGRADE, stdout: marketplaceUpgradeResult() },
        { args: MARKETPLACE_LIST, stdout: marketplaceInventory(true) },
        { args: PLUGIN_LIST, stdout: '{not json' },
      ]);

      await assert.rejects(
        reconcileCodexPlugin({}, dependenciesFor(fake)),
        error => {
          assert.strictEqual(error.code, 'INVALID_PLUGIN_INVENTORY');
          assert.strictEqual(error.phase, 'plugin-verification');
          return true;
        }
      );
      assert.strictEqual(fake.calls.length, 5);
    }],
    ['dry-run fresh install is inventory-only planning', async () => {
      const fake = createExecFile([
        { args: MARKETPLACE_LIST, stdout: marketplaceInventory(false) },
        { args: PLUGIN_LIST, stdout: pluginInventory(false) },
      ]);

      const result = await reconcileCodexPlugin(
        { dryRun: true },
        dependenciesFor(fake)
      );

      assert.deepStrictEqual(result, {
        action: 'would-install',
        dryRun: true,
        marketplaceAction: 'would-add',
        pluginId: 'ecc@ecc',
        restartRequired: true,
      });
      assert.deepStrictEqual(fake.calls.map(call => call.args), [
        MARKETPLACE_LIST,
        PLUGIN_LIST,
      ]);
    }],
    ['dry-run repair is inventory-only update planning', async () => {
      const fake = createExecFile([
        { args: MARKETPLACE_LIST, stdout: marketplaceInventory(false) },
        { args: PLUGIN_LIST, stdout: pluginInventory(true, { enabled: false }) },
      ]);

      const result = await reconcileCodexPlugin(
        { dryRun: true },
        dependenciesFor(fake)
      );

      assert.deepStrictEqual(result, {
        action: 'would-update',
        dryRun: true,
        marketplaceAction: 'would-add',
        pluginId: 'ecc@ecc',
        restartRequired: true,
      });
      assert.strictEqual(fake.calls.length, 2);
    }],
    ['dry-run keeps reconciled state unchanged without mutation', async () => {
      const fake = createExecFile([
        { args: MARKETPLACE_LIST, stdout: marketplaceInventory(true) },
        { args: PLUGIN_LIST, stdout: pluginInventory(true) },
      ]);

      const result = await reconcileCodexPlugin(
        { dryRun: true },
        dependenciesFor(fake)
      );

      assert.deepStrictEqual(result, {
        action: 'unchanged',
        dryRun: true,
        marketplaceAction: 'would-upgrade',
        pluginId: 'ecc@ecc',
        restartRequired: false,
      });
      assert.strictEqual(fake.calls.length, 2);
    }],
    ['upgrades an existing marketplace before installing a missing plugin', async () => {
      const fake = createExecFile([
        { args: MARKETPLACE_LIST, stdout: marketplaceInventory(true) },
        { args: PLUGIN_LIST, stdout: pluginInventory(false) },
        { args: MARKETPLACE_UPGRADE, stdout: marketplaceUpgradeResult() },
        { args: MARKETPLACE_LIST, stdout: marketplaceInventory(true) },
        { args: PLUGIN_LIST, stdout: pluginInventory(false) },
        { args: PLUGIN_ADD, stdout: '{"pluginId":"ecc@ecc"}' },
        { args: PLUGIN_LIST, stdout: pluginInventory(true) },
      ]);

      const result = await reconcileCodexPlugin({}, dependenciesFor(fake));

      assert.strictEqual(result.action, 'installed');
      assert.strictEqual(result.marketplaceAction, 'upgraded');
      assert.deepStrictEqual(fake.calls.map(call => call.args), [
        MARKETPLACE_LIST,
        PLUGIN_LIST,
        MARKETPLACE_UPGRADE,
        MARKETPLACE_LIST,
        PLUGIN_LIST,
        PLUGIN_ADD,
        PLUGIN_LIST,
      ]);
    }],
    ['fails closed when the ecc marketplace has untrusted provenance', async () => {
      const fake = createExecFile([
        { args: MARKETPLACE_LIST, stdout: marketplaceInventory(true) },
        { args: PLUGIN_LIST, stdout: pluginInventory(false) },
      ]);

      await expectSetupError(
        reconcileCodexPlugin({}, dependenciesFor(fake, {
          resolveMarketplaceRepository: async marketplace => {
            assert.strictEqual(marketplace.root, '/cache/ecc');
            return 'https://github.com/attacker/ecc.git';
          },
        })),
        'MARKETPLACE_COLLISION',
        /refusing.*ecc.*marketplace/i
      );
      assert.deepStrictEqual(fake.calls.map(call => call.args), [
        MARKETPLACE_LIST,
        PLUGIN_LIST,
      ]);
    }],
    ['rejects relative and insecure Git origins before marketplace mutation', async () => {
      for (const origin of [
        'affaan-m/ecc',
        'http://github.com/affaan-m/ECC.git',
      ]) {
        const fake = createExecFile([
          { args: MARKETPLACE_LIST, stdout: marketplaceInventory(true) },
          { args: PLUGIN_LIST, stdout: pluginInventory(false) },
        ]);
        await expectSetupError(
          reconcileCodexPlugin({}, dependenciesFor(fake, {
            resolveMarketplaceRepository: async () => origin,
          })),
          'MARKETPLACE_COLLISION',
          /not the official/i
        );
        assert.deepStrictEqual(fake.calls.map(call => call.args), [
          MARKETPLACE_LIST,
          PLUGIN_LIST,
        ]);
      }
    }],
    ['reports a missing Codex CLI without attempting another command', async () => {
      const missing = Object.assign(new Error('spawn codex ENOENT'), { code: 'ENOENT' });
      const fake = createExecFile([{ args: MARKETPLACE_LIST, error: missing }]);

      await expectSetupError(
        reconcileCodexPlugin({}, dependenciesFor(fake)),
        'CODEX_NOT_FOUND',
        /not installed|not on path/i
      );
      assert.strictEqual(fake.calls.length, 1);
    }],
    ['runs the resolved Codex launcher with its prefix args (npm codex.cmd shim on Windows)', async () => {
      const entry = 'C:\\npm\\node_modules\\@openai\\codex\\bin\\codex.js';
      const env = { Path: 'C:\\Windows;C:\\npm' };
      const resolverCalls = [];
      const fake = createExecFile([
        { command: 'C:\\node\\node.exe', args: [entry, ...PLUGIN_LIST], stdout: '{}' },
      ]);

      const result = await runCodexCommand(PLUGIN_LIST, { env }, {
        execFile: fake.execFile,
        resolveCodexCommand: deps => {
          resolverCalls.push(deps);
          return { command: 'C:\\node\\node.exe', prefixArgs: [entry] };
        },
      });

      assert.strictEqual(result.stdout, '{}');
      assert.strictEqual(fake.calls.length, 1);
      assert.strictEqual(resolverCalls.length, 1);
      assert.strictEqual(resolverCalls[0].env, env);
    }],
    ['default resolver launches the npm codex.cmd shim entry point through node on Windows', async () => {
      const shimDir = 'C:\\npm';
      const entry = path.win32.join(shimDir, 'node_modules', '@openai', 'codex', 'bin', 'codex.js');
      const present = new Set([path.win32.join(shimDir, 'codex.cmd'), entry]);
      const fake = createExecFile([
        { command: process.execPath, args: [entry, ...PLUGIN_LIST], stdout: '{}' },
      ]);
      const platform = Object.getOwnPropertyDescriptor(process, 'platform');
      const existsSync = fs.existsSync;
      Object.defineProperty(process, 'platform', { ...platform, value: 'win32' });
      fs.existsSync = file => present.has(file);
      try {
        await runCodexCommand(PLUGIN_LIST, { env: { Path: `C:\\Windows;${shimDir}` } }, {
          execFile: fake.execFile,
        });
      } finally {
        fs.existsSync = existsSync;
        Object.defineProperty(process, 'platform', platform);
      }
      assert.strictEqual(fake.calls.length, 1);
    }],
    ['reports only Codex argv when a prefixed launcher fails', async () => {
      const entry = 'C:\\npm\\node_modules\\@openai\\codex\\bin\\codex.js';
      const crashed = Object.assign(new Error('Command failed'), { code: 1, stderr: 'boom' });
      const fake = createExecFile([
        { command: 'C:\\node\\node.exe', args: [entry, ...PLUGIN_LIST], error: crashed },
      ]);

      await assert.rejects(
        runCodexCommand(PLUGIN_LIST, {}, {
          execFile: fake.execFile,
          resolveCodexCommand: () => ({ command: 'C:\\node\\node.exe', prefixArgs: [entry] }),
        }),
        error => {
          assert.strictEqual(error.code, 'CODEX_COMMAND_FAILED');
          assert.deepStrictEqual(error.argv, PLUGIN_LIST);
          return true;
        }
      );
    }],
    ['uses an explicit Codex command as-is and reports Codex argv without launcher prefixes', async () => {
      const missing = Object.assign(new Error('spawn ENOENT'), { code: 'ENOENT' });
      const fake = createExecFile([
        { command: 'C:\\custom\\codex.exe', args: PLUGIN_LIST, error: missing },
      ]);

      await assert.rejects(
        runCodexCommand(PLUGIN_LIST, { command: 'C:\\custom\\codex.exe' }, {
          execFile: fake.execFile,
          resolveCodexCommand: () => {
            throw new Error('resolver must not run for an explicit command');
          },
        }),
        error => {
          assert.strictEqual(error.code, 'CODEX_NOT_FOUND');
          assert.deepStrictEqual(error.argv, PLUGIN_LIST);
          return true;
        }
      );
    }],
    ['rejects malformed marketplace and plugin JSON inventories', async () => {
      assert.throws(
        () => parseMarketplaceInventory('{not json'),
        error => error.code === 'INVALID_MARKETPLACE_INVENTORY'
      );
      assert.throws(
        () => parsePluginInventory('{"installed":{}}'),
        error => error.code === 'INVALID_PLUGIN_INVENTORY'
      );
      assert.throws(
        () => parseMarketplaceInventory(JSON.stringify({
          marketplaces: [
            { name: 'ecc', root: '/one' },
            { name: 'ecc', root: '/two' },
          ],
        })),
        error => error.code === 'INVALID_MARKETPLACE_INVENTORY'
      );
      assert.throws(
        () => parseMarketplaceInventory('{"marketplaces":[{"name":"ecc","root":""}]}'),
        error => error.code === 'INVALID_MARKETPLACE_INVENTORY'
      );
      assert.throws(
        () => parsePluginInventory('{"installed":[],"available":[{}]}'),
        error => error.code === 'INVALID_PLUGIN_INVENTORY'
      );
      assert.throws(
        () => parsePluginInventory(JSON.stringify({
          installed: [
            { pluginId: 'ecc@ecc', installed: true, enabled: true },
            { pluginId: 'ecc@ecc', installed: true, enabled: true },
          ],
          available: [],
        })),
        error => error.code === 'INVALID_PLUGIN_INVENTORY'
      );
      assert.strictEqual(normalizeGitHubGitOrigin(null), null);
      assert.strictEqual(normalizeGitHubGitOrigin('not a repository'), null);
      assert.strictEqual(normalizeGitHubGitOrigin('affaan-m/ECC'), null);
      assert.strictEqual(
        normalizeGitHubGitOrigin('http://github.com/affaan-m/ECC.git'),
        null
      );
    }],
    ['surfaces mutation command failures with phase and exact argv', async () => {
      const commandFailure = Object.assign(new Error('upgrade failed'), {
        code: 1,
        stderr: 'network unavailable',
      });
      const fake = createExecFile([
        { args: MARKETPLACE_LIST, stdout: marketplaceInventory(true) },
        { args: PLUGIN_LIST, stdout: pluginInventory(false) },
        { args: MARKETPLACE_UPGRADE, error: commandFailure },
      ]);

      await assert.rejects(
        reconcileCodexPlugin({}, dependenciesFor(fake)),
        error => {
          assert.strictEqual(error.code, 'CODEX_COMMAND_FAILED');
          assert.strictEqual(error.phase, 'marketplace-upgrade');
          assert.deepStrictEqual(error.argv, MARKETPLACE_UPGRADE);
          assert.match(error.message, /network unavailable/);
          return true;
        }
      );
    }],
    ['fails when post-install verification does not find enabled ECC', async () => {
      const fake = createExecFile([
        { args: MARKETPLACE_LIST, stdout: marketplaceInventory(false) },
        { args: PLUGIN_LIST, stdout: pluginInventory(false) },
        { args: MARKETPLACE_ADD, stdout: '{"alreadyAdded":false}' },
        { args: MARKETPLACE_LIST, stdout: marketplaceInventory(true) },
        { args: PLUGIN_ADD, stdout: '{"pluginId":"ecc@ecc"}' },
        { args: PLUGIN_LIST, stdout: pluginInventory(false) },
      ]);

      await expectSetupError(
        reconcileCodexPlugin({}, dependenciesFor(fake)),
        'PLUGIN_VERIFICATION_FAILED',
        /verify.*ecc@ecc/i
      );
    }],
    ['fails when marketplace verification cannot observe ECC', async () => {
      const fake = createExecFile([
        { args: MARKETPLACE_LIST, stdout: marketplaceInventory(false) },
        { args: PLUGIN_LIST, stdout: pluginInventory(false) },
        { args: MARKETPLACE_ADD, stdout: '{"alreadyAdded":false}' },
        { args: MARKETPLACE_LIST, stdout: marketplaceInventory(false) },
      ]);

      await expectSetupError(
        reconcileCodexPlugin({}, dependenciesFor(fake)),
        'MARKETPLACE_VERIFICATION_FAILED',
        /verify.*ecc marketplace/i
      );
      assert.strictEqual(fake.calls.length, 4);
    }],
  ];

  for (const [name, fn] of cases) {
    if (await test(name, fn)) passed += 1;
    else failed += 1;
  }

  console.log(`\nPassed: ${passed}`);
  console.log(`Failed: ${failed}`);
  if (failed > 0) process.exit(1);
}

runTests().catch(error => {
  console.error(error);
  process.exit(1);
});
