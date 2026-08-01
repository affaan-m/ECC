'use strict';

const assert = require('assert');

const {
  CodexPluginSetupError,
  OFFICIAL_MARKETPLACE_REPO,
  normalizeGitHubRepository,
  parseMarketplaceInventory,
  parsePluginInventory,
  reconcileCodexPlugin,
  resolveMarketplaceRepository,
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
    resolveMarketplaceRepository: async () => 'affaan-m/ecc',
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
        normalizeGitHubRepository('git@github.com:affaan-m/ECC.git'),
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

      assert.strictEqual(repository, 'affaan-m/ecc');
      assert.strictEqual(fake.calls[0].options.shell, false);
      assert.strictEqual(fake.calls[0].options.cwd, '/workspace with spaces');
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
        assert.ok(!call.args.includes('--config'));
        assert.ok(!call.args.includes('-c'));
      }
    }],
    ['already installed and enabled is an idempotent no-op', async () => {
      const fake = createExecFile([
        { args: MARKETPLACE_LIST, stdout: marketplaceInventory(true) },
        { args: PLUGIN_LIST, stdout: pluginInventory(true) },
      ]);

      const result = await reconcileCodexPlugin({}, dependenciesFor(fake));

      assert.deepStrictEqual(result, {
        action: 'unchanged',
        marketplaceAction: 'unchanged',
        pluginId: 'ecc@ecc',
        restartRequired: false,
      });
      assert.deepStrictEqual(fake.calls.map(call => call.args), [
        MARKETPLACE_LIST,
        PLUGIN_LIST,
      ]);
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
        marketplaceAction: 'unchanged',
        pluginId: 'ecc@ecc',
        restartRequired: false,
      });
      assert.strictEqual(fake.calls.length, 2);
    }],
    ['upgrades an existing marketplace before installing a missing plugin', async () => {
      const fake = createExecFile([
        { args: MARKETPLACE_LIST, stdout: marketplaceInventory(true) },
        { args: PLUGIN_LIST, stdout: pluginInventory(false) },
        { args: MARKETPLACE_UPGRADE, stdout: '{"upgraded":true}' },
        { args: MARKETPLACE_LIST, stdout: marketplaceInventory(true) },
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
            return 'attacker/ecc';
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
      assert.strictEqual(normalizeGitHubRepository(null), null);
      assert.strictEqual(normalizeGitHubRepository('not a repository'), null);
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
