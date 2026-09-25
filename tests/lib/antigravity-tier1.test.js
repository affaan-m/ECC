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
const { getInstallTargetAdapter } = require('../../scripts/lib/install-targets/registry');
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
    assert.strictEqual(adapted.tool_name, 'Bash');
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
    assert.strictEqual(adaptedWrite.tool_name, 'Write');
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
    assert.strictEqual(adaptedReplace.tool_name, 'Edit');
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
    const config = buildAntigravityHooksConfig({ profile: 'standard', bridgeScript: path.resolve('scripts/hooks/antigravity-hook-bridge.js') });
    assert.ok(config['ecc-guard'], 'Should have ecc-guard hook entry');
    const guard = config['ecc-guard'];

    assert.ok(Array.isArray(guard.PreToolUse), 'PreToolUse should be an array');
    assert.ok(Array.isArray(guard.Stop), 'Stop should be an array');
    assert.ok(guard.PostToolUse.some(entry => entry.matcher.includes('multi_replace_file_content') && entry.hooks.some(hook => hook.command.includes('post:edit:accumulator'))));
    assert.ok(guard.Stop.find(hook => hook.command.includes('stop:format-typecheck')).timeout >= 270);

    const commandMatcher = guard.PreToolUse.find(entry => entry.matcher === 'run_command');
    assert.ok(commandMatcher, 'Should have run_command matcher in PreToolUse');
    assert.ok(
      commandMatcher.hooks.some(h => h.command.includes('pre:bash:dispatcher')),
      'Should invoke pre:bash:dispatcher on run_command'
    );

    const editMatcher = guard.PreToolUse.find(entry => entry.matcher === 'write_to_file|replace_file_content|multi_replace_file_content');
    assert.ok(editMatcher, 'Should have write_to_file|replace_file_content matcher');
    assert.ok(
      editMatcher.hooks.some(h => h.command.includes('pre:edit-write:gateguard-fact-force')),
      'Should invoke GateGuard on write operations'
    );
  });

  test('buildAntigravityMcpConfig generates valid stdio MCP configuration for ecc-memory', () => {
    const config = buildAntigravityMcpConfig({ memoryScript: path.resolve('scripts/memory-mcp.mjs') });
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

  test('generators reject missing, relative, and malformed executable paths', () => {
    for (const value of [undefined, '', 'relative/script.js', 7, '/tmp/bad\0path']) {
      assert.throws(() => buildAntigravityHooksConfig({ bridgeScript: value }), /absolute path/);
      assert.throws(() => buildAntigravityMcpConfig({ memoryScript: value }), /absolute path/);
    }
    assert.strictEqual(buildAntigravityPluginManifest().version, require('../../package.json').version);
  });

  test('hook commands preserve shell metacharacters in the installed path', () => {
    if (process.platform === 'win32') return;
    const dir = createTempDir("ecc space ' $HOME `echo x` ");
    try {
      const script = path.join(dir, 'bridge.js');
      fs.writeFileSync(script, 'process.stdout.write(JSON.stringify(process.argv.slice(2)))');
      const config = buildAntigravityHooksConfig({ bridgeScript: script });
      const command = config['ecc-guard'].PreToolUse[0].hooks[0].command;
      const run = spawnSync(command, { shell: true, encoding: 'utf8' });
      assert.strictEqual(run.status, 0, run.stderr);
      assert.deepStrictEqual(JSON.parse(run.stdout), ['--mode', 'pre-tool-use', '--hook', 'pre:bash:dispatcher']);
    } finally {
      cleanup(dir);
    }
  });

  for (const target of ['antigravity', 'antigravity-home']) {
    test(`${target} installed memory server starts outside the source checkout`, () => {
      const root = createTempDir('ecc-memory-install-');
      try {
        const projectRoot = path.join(root, 'project');
        fs.mkdirSync(projectRoot);
        fs.writeFileSync(path.join(projectRoot, 'package.json'), '{"type":"module"}');
        const { createManifestInstallPlan } = require('../../scripts/lib/install/plan');
        const { applyInstallPlan } = require('../../scripts/lib/install/apply');
        const plan = createManifestInstallPlan({ moduleIds: ['platform-configs'], target, homeDir: root, projectRoot });
        applyInstallPlan(plan);
        const config = JSON.parse(fs.readFileSync(path.join(plan.targetRoot, 'mcp_config.json'), 'utf8'));
        const server = config.mcpServers['ecc-memory'];
        assert.strictEqual(server.args[0], path.join(plan.targetRoot, 'scripts', 'memory-mcp.mjs'));
        const run = spawnSync(process.execPath, server.args, {
          cwd: root,
          env: { ...process.env, ...server.env, NODE_PATH: '' },
          input: JSON.stringify({ jsonrpc: '2.0', id: 1, method: 'initialize', params: { protocolVersion: '2025-11-25', capabilities: {}, clientInfo: { name: 'test', version: '1' } } }) + '\n',
          encoding: 'utf8',
          timeout: 10000,
        });
        assert.strictEqual(run.status, 0, run.stderr);
        assert.strictEqual(JSON.parse(run.stdout.trim()).id, 1);
      } finally {
        cleanup(root);
      }
    });
  }

  test('project hooks install and run with explicit consent in an ESM project', () => {
    const root = createTempDir('ecc-project-hooks-');
    try {
      fs.writeFileSync(path.join(root, 'package.json'), '{"type":"module"}');
      const { createManifestInstallPlan } = require('../../scripts/lib/install/plan');
      const { applyInstallPlan } = require('../../scripts/lib/install/apply');
      const { withHookConsent } = require('../../scripts/lib/install/hook-consent');
      const plan = withHookConsent(createManifestInstallPlan({ moduleIds: ['hooks-runtime'], target: 'antigravity', projectRoot: root }), 'enabled');
      applyInstallPlan(plan);
      const config = JSON.parse(fs.readFileSync(path.join(plan.targetRoot, 'hooks.json'), 'utf8'));
      const run = spawnSync(config['ecc-guard'].PreToolUse[0].hooks[0].command, {
        cwd: root,
        shell: true,
        env: { ...process.env, GATEGUARD_BASH_ROUTINE_DISABLED: '1' },
        input: JSON.stringify({ workspacePaths: [root], toolCall: { name: 'run_command', args: { CommandLine: 'pwd' } } }),
        encoding: 'utf8',
        timeout: 10000,
      });
      assert.strictEqual(run.status, 0, run.stderr);
      assert.strictEqual(JSON.parse(run.stdout).decision, 'allow', run.stdout);
    } finally {
      cleanup(root);
    }
  });

  test('memory runtime installs from npm-hoisted dependencies', () => {
    const root = createTempDir('ecc-hoisted-memory-');
    try {
      const sourceRoot = path.join(root, 'node_modules', 'ecc-universal');
      const repoRoot = path.resolve(__dirname, '../..');
      for (const relative of ['package.json', 'scripts/memory-mcp.mjs', 'scripts/lib/missing-dependency.js', 'scripts/lib/memory-vault.js', 'scripts/lib/memory-vault-format.js', 'scripts/lib/path-safety.js']) {
        const destination = path.join(sourceRoot, relative);
        fs.mkdirSync(path.dirname(destination), { recursive: true });
        fs.copyFileSync(path.join(repoRoot, relative), destination);
      }
      const ajvManifest = require('ajv/package.json');
      for (const name of ['ajv', ...Object.keys(ajvManifest.dependencies)]) {
        fs.cpSync(path.dirname(require.resolve(`${name}/package.json`)), path.join(root, 'node_modules', name), { recursive: true });
      }
      fs.cpSync(path.join(repoRoot, 'manifests'), path.join(sourceRoot, 'manifests'), { recursive: true });
      const projectRoot = path.join(root, 'app');
      const { createManifestInstallPlan } = require('../../scripts/lib/install/plan');
      const { applyInstallPlan } = require('../../scripts/lib/install/apply');
      const plan = createManifestInstallPlan({ sourceRoot, moduleIds: ['platform-configs'], target: 'antigravity', projectRoot });
      applyInstallPlan(plan);
      fs.rmSync(path.join(root, 'node_modules'), { recursive: true });
      const run = spawnSync(process.execPath, [path.join(plan.targetRoot, 'scripts/memory-mcp.mjs')], {
        cwd: root,
        env: { ...process.env, ECC_MEMORY_HARNESS: 'antigravity', NODE_PATH: '' },
        input: JSON.stringify({ jsonrpc: '2.0', id: 1, method: 'initialize', params: { protocolVersion: '2025-11-25', capabilities: {}, clientInfo: { name: 'test', version: '1' } } }) + '\n',
        encoding: 'utf8',
        timeout: 10000,
      });
      assert.strictEqual(run.status, 0, run.stderr);
      assert.strictEqual(JSON.parse(run.stdout.trim()).id, 1);
    } finally {
      cleanup(root);
    }
  });

  test('missing memory dependencies give installation instructions', () => {
    const root = createTempDir('ecc-missing-memory-dependency-');
    try {
      const ajvRoot = path.join(root, 'node_modules', 'ajv');
      fs.mkdirSync(ajvRoot, { recursive: true });
      fs.writeFileSync(path.join(ajvRoot, 'package.json'), JSON.stringify({ dependencies: { 'ecc-test-nonexistent-dependency': '1.0.0' } }));
      const { planAntigravityMemoryRuntime } = require('../../scripts/lib/antigravity-mcp');
      assert.throws(() => planAntigravityMemoryRuntime('platform-configs', root, path.join(root, 'target')), /Run npm install/);
    } finally {
      cleanup(root);
    }
  });

  test('Windows hook commands quote spaces and reject shell expansion characters', () => {
    const descriptor = Object.getOwnPropertyDescriptor(process, 'platform');
    try {
      Object.defineProperty(process, 'platform', { value: 'win32' });
      const bridgeScript = path.resolve('folder with spaces/bridge.js');
      const config = buildAntigravityHooksConfig({ bridgeScript });
      assert.ok(config['ecc-guard'].PreToolUse[0].hooks[0].command.startsWith(`node "${bridgeScript}" `));
      for (const character of ['"', '%', '!', '$', '`', '\r', '\n']) {
        assert.throws(() => buildAntigravityHooksConfig({ bridgeScript: bridgeScript + character }), /shell/);
      }
    } finally {
      Object.defineProperty(process, 'platform', descriptor);
    }
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
          op.destinationPath.startsWith(path.join(homeDir, '.gemini', 'config', 'workflows'))
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
          CommandLine: 'pwd',
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

  test('antigravity-hook-bridge returns deny for GateGuard write_to_file on first touch', () => {
    const bridgePath = path.join(__dirname, '..', '..', 'scripts', 'hooks', 'antigravity-hook-bridge.js');
    const root = createTempDir('ecc-bridge-deny-');
    try {
      const targetFile = path.join(root, 'index.js');
      const input = JSON.stringify({
        conversationId: path.basename(root),
        workspacePaths: [root],
        toolCall: {
          name: 'write_to_file',
          args: {
            TargetFile: targetFile,
            CodeContent: 'console.log("hello");',
          },
        },
      });

      const run = spawnSync(process.execPath, [bridgePath, '--mode', 'pre-tool-use', '--hook', 'pre:edit-write:gateguard-fact-force'], {
        input,
        encoding: 'utf8',
        env: {
          ...process.env,
          GATEGUARD_STATE_DIR: root,
          GATEGUARD_DISABLED: '0',
          GATEGUARD_EXEMPT_PATHS: '',
          GATEGUARD_EXEMPT_GLOBS: '',
        },
      });

      assert.strictEqual(run.status, 0);
      const output = JSON.parse(run.stdout);
      assert.strictEqual(output.decision, 'deny');
      assert.ok(output.reason);
    } finally {
      cleanup(root);
    }
  });

  test('antigravity-hook-bridge returns deny for oversized input in pre-tool-use', () => {
    const bridgePath = path.join(__dirname, '..', '..', 'scripts', 'hooks', 'antigravity-hook-bridge.js');
    const input = JSON.stringify({
      conversationId: 'test-oversized',
      workspacePaths: ['/tmp'],
      toolCall: {
        name: 'run_command',
        args: {
          CommandLine: 'echo ' + 'x'.repeat(100),
        },
      },
    });

    const run = spawnSync(process.execPath, [bridgePath, '--mode', 'pre-tool-use', '--hook', 'pre:bash:dispatcher'], {
      input,
      encoding: 'utf8',
      env: {
        ...process.env,
        ECC_HOOK_INPUT_MAX_BYTES: '10',
      },
    });

    assert.strictEqual(run.status, 0);
    const output = JSON.parse(run.stdout);
    assert.strictEqual(output.decision, 'deny');
    assert.match(output.reason, /completely|input/i);
  });

  test('antigravity-hook-bridge safely ignores non-JSON hook stdout and allows safe tool call', () => {
    const bridgePath = path.join(__dirname, '..', '..', 'scripts', 'hooks', 'antigravity-hook-bridge.js');
    const input = JSON.stringify({
      conversationId: 'test-conv',
      workspacePaths: ['/tmp'],
      toolCall: {
        name: 'run_command',
        args: {
          CommandLine: 'echo safe',
        },
      },
    });

    const run = spawnSync(process.execPath, [bridgePath, '--mode', 'pre-tool-use', '--hook', 'pre:write:doc-file-warning'], {
      input,
      encoding: 'utf8',
    });

    assert.strictEqual(run.status, 0);
    const output = JSON.parse(run.stdout);
    assert.strictEqual(output.decision, 'allow');
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

      applyInstallPlan(plan);
      const pluginDir = path.join(homeDir, '.gemini', 'config', 'plugins', 'ecc');

      assert.ok(fs.existsSync(path.join(pluginDir, 'plugin.json')), 'plugin.json should exist');
      assert.ok(fs.existsSync(path.join(pluginDir, 'hooks.json')), 'hooks.json should exist');
      assert.ok(fs.existsSync(path.join(pluginDir, 'mcp_config.json')), 'mcp_config.json should exist');
      assert.ok(fs.existsSync(path.join(pluginDir, 'ecc-install-state.json')), 'install-state should exist');
      assert.ok(fs.existsSync(path.join(pluginDir, 'rules', 'common-coding-style.md')), 'rules should exist');
      assert.ok(fs.existsSync(path.join(pluginDir, 'skills', 'tdd-workflow', 'SKILL.md')), 'skills should exist');
      assert.ok(fs.existsSync(path.join(pluginDir, 'scripts', 'hooks', 'antigravity-hook-bridge.js')), 'hook bridge should exist');
      assert.ok(fs.existsSync(path.join(homeDir, '.gemini', 'config', 'workflows', 'plan.md')), 'workflow plan.md should exist in global workflows dir');

      const pluginJson = JSON.parse(fs.readFileSync(path.join(pluginDir, 'plugin.json'), 'utf8'));
      assert.strictEqual(pluginJson.name, 'ecc');

      const hooksJson = JSON.parse(fs.readFileSync(path.join(pluginDir, 'hooks.json'), 'utf8'));
      assert.ok(hooksJson['ecc-guard']);
      assert.ok(Array.isArray(hooksJson['ecc-guard'].PreToolUse));
      assert.ok(Array.isArray(hooksJson['ecc-guard'].Stop));

      const mcpConfig = JSON.parse(fs.readFileSync(path.join(pluginDir, 'mcp_config.json'), 'utf8'));
      assert.ok(mcpConfig.mcpServers['ecc-memory']);
      const hookCommand = hooksJson['ecc-guard'].PreToolUse[0].hooks[0].command;
      assert.ok(hookCommand.includes(path.join(pluginDir, 'scripts', 'hooks', 'antigravity-hook-bridge.js')));
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
