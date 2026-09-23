'use strict';

const assert = require('assert');
const fs = require('fs');
const os = require('os');
const path = require('path');
const { spawnSync } = require('child_process');

const { adaptAntigravityInputToEcc } = require('../../scripts/hooks/antigravity-hook-bridge');
const { buildAntigravityHooksConfig } = require('../../scripts/lib/antigravity-hooks');
const { buildAntigravityMcpConfig } = require('../../scripts/lib/antigravity-mcp');
const { buildAntigravityPluginManifest } = require('../../scripts/lib/antigravity-plugin');
const { getInstallTargetAdapter, listInstallTargetAdapters } = require('../../scripts/lib/install-targets/registry');
const { resolveInstallPlan } = require('../../scripts/lib/install-manifests');
const { resolveEccRoot } = require('../../scripts/lib/resolve-ecc-root');

let passed = 0;
let failed = 0;

function test(name, fn) {
  try {
    fn();
    console.log(`  ✓ ${name}`);
    passed += 1;
    return true;
  } catch (error) {
    console.log(`  ✗ ${name}`);
    console.log(`    Error: ${error.message}`);
    failed += 1;
    return false;
  }
}

function createTempDir(prefix) {
  return fs.mkdtempSync(path.join(os.tmpdir(), prefix));
}

function cleanup(dirPath) {
  fs.rmSync(dirPath, { recursive: true, force: true });
}

function runTests() {
  console.log('\n=== Testing Antigravity Tier 1 Parity ===\n');

  test('adaptAntigravityInputToEcc normalizes run_command tool calls', () => {
    const rawInput = {
      conversationId: 'conv-1234',
      workspacePaths: ['/workspace/app'],
      stepIdx: 5,
      toolCall: {
        name: 'run_command',
        args: {
          CommandLine: 'npm test',
          Cwd: '/workspace/app',
        },
      },
    };

    const adapted = adaptAntigravityInputToEcc(rawInput);
    assert.strictEqual(adapted.tool_name, 'run_command');
    assert.strictEqual(adapted.tool_input.command, 'npm test');
    assert.strictEqual(adapted.tool_input.CommandLine, 'npm test');
    assert.strictEqual(adapted.conversation_id, 'conv-1234');
    assert.deepStrictEqual(adapted.workspace_paths, ['/workspace/app']);
  });

  test('adaptAntigravityInputToEcc normalizes write_to_file and replace_file_content tool calls', () => {
    const writeInput = {
      toolCall: {
        name: 'write_to_file',
        args: {
          TargetFile: '/workspace/app/src/index.js',
          CodeContent: 'console.log("hello");',
        },
      },
    };
    const adaptedWrite = adaptAntigravityInputToEcc(writeInput);
    assert.strictEqual(adaptedWrite.tool_name, 'write_to_file');
    assert.strictEqual(adaptedWrite.tool_input.file_path, '/workspace/app/src/index.js');

    const replaceInput = {
      toolCall: {
        name: 'replace_file_content',
        args: {
          TargetFile: '/workspace/app/src/index.js',
          TargetContent: 'hello',
          ReplacementContent: 'world',
        },
      },
    };
    const adaptedReplace = adaptAntigravityInputToEcc(replaceInput);
    assert.strictEqual(adaptedReplace.tool_name, 'replace_file_content');
    assert.strictEqual(adaptedReplace.tool_input.file_path, '/workspace/app/src/index.js');
  });

  test('adaptAntigravityInputToEcc handles malformed or empty payloads safely', () => {
    const emptyAdapted = adaptAntigravityInputToEcc(null);
    assert.strictEqual(emptyAdapted.tool_name, '');
    assert.deepStrictEqual(emptyAdapted.tool_input, {});

    const emptyObjAdapted = adaptAntigravityInputToEcc({});
    assert.strictEqual(emptyObjAdapted.tool_name, '');
    assert.deepStrictEqual(emptyObjAdapted.tool_input, { command: '', file_path: '' });
  });

  test('buildAntigravityHooksConfig generates valid Antigravity hooks specification', () => {
    const config = buildAntigravityHooksConfig({ profile: 'standard' });
    assert.ok(config['ecc-guard'], 'Should have ecc-guard hook entry');
    const guard = config['ecc-guard'];

    assert.ok(Array.isArray(guard.PreToolUse), 'PreToolUse should be an array');
    assert.ok(Array.isArray(guard.Stop), 'Stop should be an array');

    const commandMatcher = guard.PreToolUse.find(entry => entry.matcher === 'run_command');
    assert.ok(commandMatcher, 'Should have run_command matcher in PreToolUse');
    assert.ok(
      commandMatcher.hooks.some(h => h.command.includes('pre:bash:dispatcher')),
      'Should invoke pre:bash:dispatcher on run_command'
    );

    const editMatcher = guard.PreToolUse.find(entry => entry.matcher === 'write_to_file|replace_file_content');
    assert.ok(editMatcher, 'Should have write_to_file|replace_file_content matcher');
    assert.ok(
      editMatcher.hooks.some(h => h.command.includes('pre:edit-write:gateguard-fact-force')),
      'Should invoke GateGuard on write operations'
    );
  });

  test('buildAntigravityMcpConfig generates valid stdio MCP configuration for ecc-memory', () => {
    const config = buildAntigravityMcpConfig();
    assert.ok(config.mcpServers, 'Should declare mcpServers');
    assert.ok(config.mcpServers['ecc-memory'], 'Should declare ecc-memory server');
    const memoryServer = config.mcpServers['ecc-memory'];
    assert.strictEqual(memoryServer.command, 'node');
    assert.strictEqual(memoryServer.env.ECC_MEMORY_HARNESS, 'antigravity');
  });

  test('buildAntigravityPluginManifest generates valid Antigravity plugin manifest', () => {
    const manifest = buildAntigravityPluginManifest({ version: '2.2.2' });
    assert.strictEqual(manifest.name, 'ecc');
    assert.strictEqual(manifest.version, '2.2.2');
    assert.ok(manifest.description.includes('Antigravity'));
  });

  test('antigravity-home adapter resolves root to ~/.gemini/config/plugins/ecc', () => {
    const homeDir = '/home/testuser';
    const adapter = getInstallTargetAdapter('antigravity-home');
    assert.strictEqual(adapter.id, 'antigravity-home');
    assert.strictEqual(adapter.kind, 'home');
    assert.strictEqual(
      adapter.resolveRoot({ homeDir }),
      path.join(homeDir, '.gemini', 'config', 'plugins', 'ecc')
    );
  });

  test('antigravity-home plans complete native plugin structure for core profile', () => {
    const homeDir = createTempDir('antigravity-home-test-');
    const projectRoot = createTempDir('antigravity-proj-test-');

    try {
      const plan = resolveInstallPlan({
        profileId: 'core',
        target: 'antigravity-home',
        homeDir,
        projectRoot,
        enableHooks: true,
      });

      assert.strictEqual(plan.targetAdapterId, 'antigravity-home');
      assert.strictEqual(
        plan.targetRoot,
        path.join(homeDir, '.gemini', 'config', 'plugins', 'ecc')
      );

      const targetRoot = plan.targetRoot;

      // Check plugin.json
      assert.ok(
        plan.operations.some(op => (
          op.destinationPath === path.join(targetRoot, 'plugin.json')
          && op.kind === 'merge-json'
        )),
        'Should plan plugin.json merge'
      );

      // Check mcp_config.json
      assert.ok(
        plan.operations.some(op => (
          op.destinationPath === path.join(targetRoot, 'mcp_config.json')
          && op.kind === 'merge-json'
        )),
        'Should plan mcp_config.json merge'
      );

      // Check hooks.json
      assert.ok(
        plan.operations.some(op => (
          op.destinationPath === path.join(targetRoot, 'hooks.json')
          && op.kind === 'merge-json'
        )),
        'Should plan hooks.json merge'
      );

      // Check rules
      assert.ok(
        plan.operations.some(op => (
          op.destinationPath.startsWith(path.join(targetRoot, 'rules'))
        )),
        'Should plan rules into plugin rules directory'
      );

      // Check workflows
      assert.ok(
        plan.operations.some(op => (
          op.destinationPath.startsWith(path.join(targetRoot, 'workflows'))
        )),
        'Should plan workflows'
      );
    } finally {
      cleanup(homeDir);
      cleanup(projectRoot);
    }
  });

  test('antigravity-hook-bridge handles allow decision for safe command', () => {
    const bridgePath = path.join(__dirname, '..', '..', 'scripts', 'hooks', 'antigravity-hook-bridge.js');
    const input = JSON.stringify({
      conversationId: 'test-conv',
      workspacePaths: ['/tmp'],
      toolCall: {
        name: 'run_command',
        args: {
          CommandLine: 'echo "hello from safe command"',
        },
      },
    });

    const run = spawnSync(process.execPath, [bridgePath, '--mode', 'pre-tool-use', '--hook', 'pre:bash:dispatcher'], {
      input,
      encoding: 'utf8',
    });

    assert.strictEqual(run.status, 0);
    const output = JSON.parse(run.stdout);
    assert.strictEqual(output.decision, 'allow');
  });

  test('antigravity-hook-bridge returns deny for blocked git push --no-verify', () => {
    const bridgePath = path.join(__dirname, '..', '..', 'scripts', 'hooks', 'antigravity-hook-bridge.js');
    const input = JSON.stringify({
      conversationId: 'test-conv',
      workspacePaths: ['/tmp'],
      toolCall: {
        name: 'run_command',
        args: {
          CommandLine: 'git push origin main --no-verify',
        },
      },
    });

    const run = spawnSync(process.execPath, [bridgePath, '--mode', 'pre-tool-use', '--hook', 'pre:bash:dispatcher'], {
      input,
      encoding: 'utf8',
    });

    assert.strictEqual(run.status, 0);
    const output = JSON.parse(run.stdout);
    assert.strictEqual(output.decision, 'deny');
    assert.match(output.reason, /no-verify/i);
  });

  test('antigravity-project plans mcp_config.json when platform configs are selected', () => {
    const projectRoot = createTempDir('antigravity-proj-mcp-');
    try {
      const plan = resolveInstallPlan({
        moduleIds: ['platform-configs'],
        target: 'antigravity',
        projectRoot,
      });

      assert.strictEqual(plan.targetAdapterId, 'antigravity-project');
      const targetRoot = path.join(projectRoot, '.agents');

      assert.ok(
        plan.operations.some(op => op.destinationPath === path.join(targetRoot, 'mcp_config.json') && op.kind === 'merge-json'),
        'Should plan mcp_config.json in project .agents'
      );
    } finally {
      cleanup(projectRoot);
    }
  });

  test('antigravity-home end-to-end install applies complete plugin directory and install state', () => {
    const homeDir = createTempDir('antigravity-home-e2e-');
    const projectDir = createTempDir('antigravity-proj-e2e-');

    try {
      const { createManifestInstallPlan } = require('../../scripts/lib/install/plan');
      const { applyInstallPlan } = require('../../scripts/lib/install/apply');
      const { withHookConsent } = require('../../scripts/lib/install/hook-consent');
      const plan = withHookConsent(createManifestInstallPlan({
        profileId: 'core',
        target: 'antigravity-home',
        homeDir,
        projectRoot: projectDir,
      }), 'enabled');

      const result = applyInstallPlan(plan);
      const pluginDir = path.join(homeDir, '.gemini', 'config', 'plugins', 'ecc');

      assert.ok(fs.existsSync(path.join(pluginDir, 'plugin.json')), 'plugin.json should exist');
      assert.ok(fs.existsSync(path.join(pluginDir, 'hooks.json')), 'hooks.json should exist');
      assert.ok(fs.existsSync(path.join(pluginDir, 'mcp_config.json')), 'mcp_config.json should exist');
      assert.ok(fs.existsSync(path.join(pluginDir, 'ecc-install-state.json')), 'install-state should exist');
      assert.ok(fs.existsSync(path.join(pluginDir, 'rules', 'common-coding-style.md')), 'rules should exist');
      assert.ok(fs.existsSync(path.join(pluginDir, 'skills', 'tdd-workflow', 'SKILL.md')), 'skills should exist');
      assert.ok(fs.existsSync(path.join(pluginDir, 'scripts', 'hooks', 'antigravity-hook-bridge.js')), 'hook bridge should exist');

      const pluginJson = JSON.parse(fs.readFileSync(path.join(pluginDir, 'plugin.json'), 'utf8'));
      assert.strictEqual(pluginJson.name, 'ecc');

      const hooksJson = JSON.parse(fs.readFileSync(path.join(pluginDir, 'hooks.json'), 'utf8'));
      assert.ok(hooksJson['ecc-guard']);
      assert.ok(Array.isArray(hooksJson['ecc-guard'].PreToolUse));
      assert.ok(Array.isArray(hooksJson['ecc-guard'].Stop));

      const mcpConfig = JSON.parse(fs.readFileSync(path.join(pluginDir, 'mcp_config.json'), 'utf8'));
      assert.ok(mcpConfig.mcpServers['ecc-memory']);
    } finally {
      cleanup(homeDir);
      cleanup(projectDir);
    }
  });

  test('resolveEccRoot recognizes Antigravity global plugin install', () => {
    const tempHome = createTempDir('ecc-root-test-');
    try {
      const pluginDir = path.join(tempHome, '.gemini', 'config', 'plugins', 'ecc');
      fs.mkdirSync(path.join(pluginDir, 'scripts', 'lib'), { recursive: true });
      fs.mkdirSync(path.join(pluginDir, 'skills', 'continuous-learning-v2'), { recursive: true });
      fs.writeFileSync(path.join(pluginDir, 'scripts', 'lib', 'utils.js'), '// utils');

      const resolved = resolveEccRoot({ homeDir: tempHome });
      assert.strictEqual(resolved, pluginDir);
    } finally {
      cleanup(tempHome);
    }
  });

  console.log(`\nResults: Passed: ${passed}, Failed: ${failed}\n`);
  if (failed > 0) {
    process.exit(1);
  }
}

runTests();
