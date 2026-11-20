/**
 * Contract tests for the Antigravity 2.0 hook bridge.
 */

'use strict';

const assert = require('assert');
const path = require('path');
const { spawnSync } = require('child_process');

const REPO_ROOT = path.resolve(__dirname, '..', '..');
const {
  normalizeAntigravityToClaude,
  resolveHookScript,
} = require(path.join(REPO_ROOT, 'scripts', 'antigravity', 'hook-bridge'));

let passed = 0;
let failed = 0;

function test(name, fn) {
  try {
    fn();
    console.log(`  \u2713 ${name}`);
    passed += 1;
  } catch (error) {
    console.log(`  \u2717 ${name}`);
    console.log(`    Error: ${error.message}`);
    failed += 1;
  }
}

console.log('=== Testing Antigravity Hook Bridge ===\n');

test('resolves known hook aliases to absolute paths', () => {
  const resolved = resolveHookScript('config-protection');
  assert.ok(resolved, 'Expected config-protection to resolve');
  assert.ok(resolved.endsWith('config-protection.js'));
});

test('translates Antigravity edit_file payload to Claude Edit tool shape', () => {
  const agyPayload = {
    conversationId: 'test-conv-123',
    toolCall: {
      name: 'edit_file',
      args: {
        Path: 'eslint.config.js',
        Target: 'old',
        Replacement: 'new',
      },
    },
    workspacePaths: [REPO_ROOT],
  };

  const claudePayload = normalizeAntigravityToClaude(agyPayload);
  assert.strictEqual(claudePayload.session_id, 'test-conv-123');
  assert.strictEqual(claudePayload.tool_name, 'Edit');
  assert.strictEqual(claudePayload.tool_input.file_path, 'eslint.config.js');
  assert.strictEqual(claudePayload.tool_input.path, 'eslint.config.js');
});

test('normalizes TargetFile argument for replace_file_content and write_to_file', () => {
  const replacePayload = {
    conversationId: 'conv-targetfile-1',
    toolCall: {
      name: 'replace_file_content',
      args: {
        TargetFile: 'prettier.config.js',
        Target: 'old',
        Replacement: 'new',
      },
    },
    workspacePaths: [REPO_ROOT],
  };

  const claudeEdit = normalizeAntigravityToClaude(replacePayload);
  assert.strictEqual(claudeEdit.tool_name, 'Edit');
  assert.strictEqual(claudeEdit.tool_input.file_path, 'prettier.config.js');

  const writePayload = {
    conversationId: 'conv-targetfile-2',
    toolCall: {
      name: 'write_to_file',
      args: {
        TargetFile: 'some.config.js',
        Content: 'content',
      },
    },
    workspacePaths: [REPO_ROOT],
  };

  const claudeWrite = normalizeAntigravityToClaude(writePayload);
  assert.strictEqual(claudeWrite.tool_name, 'Write');
  assert.strictEqual(claudeWrite.tool_input.file_path, 'some.config.js');
  assert.strictEqual(claudeWrite.tool_input.content, 'content');
});

test('translates Antigravity run_command payload to Claude Bash tool shape', () => {
  const agyPayload = {
    conversationId: 'test-conv-456',
    toolCall: {
      name: 'run_command',
      args: {
        CommandLine: 'npm test',
      },
    },
    workspacePaths: [REPO_ROOT],
  };

  const claudePayload = normalizeAntigravityToClaude(agyPayload);
  assert.strictEqual(claudePayload.session_id, 'test-conv-456');
  assert.strictEqual(claudePayload.tool_name, 'Bash');
  assert.strictEqual(claudePayload.tool_input.command, 'npm test');
});

test('hook bridge blocks modifications to protected files via config-protection hook', () => {
  const bridgeScript = path.join(REPO_ROOT, 'scripts', 'antigravity', 'hook-bridge.js');
  const agyPayload = {
    conversationId: 'block-test',
    toolCall: {
      name: 'edit_file',
      args: {
        Path: path.join(REPO_ROOT, 'eslint.config.js'),
        Target: 'a',
        Replacement: 'b',
      },
    },
    workspacePaths: [REPO_ROOT],
  };

  const result = spawnSync(process.execPath, [bridgeScript, '--hook', 'config-protection'], {
    input: JSON.stringify(agyPayload),
    encoding: 'utf8',
    cwd: REPO_ROOT,
  });

  assert.strictEqual(result.status, 0, 'Bridge itself should exit 0 with JSON decision');
  const decision = JSON.parse(result.stdout.trim());
  assert.strictEqual(decision.decision, 'deny');
  assert.ok(decision.reason && decision.reason.length > 0);
});

test('hook bridge allows modifications to unprotected files via config-protection hook', () => {
  const bridgeScript = path.join(REPO_ROOT, 'scripts', 'antigravity', 'hook-bridge.js');
  const agyPayload = {
    conversationId: 'allow-test',
    toolCall: {
      name: 'edit_file',
      args: {
        Path: path.join(REPO_ROOT, 'some-regular-feature.js'),
        Target: 'a',
        Replacement: 'b',
      },
    },
    workspacePaths: [REPO_ROOT],
  };

  const result = spawnSync(process.execPath, [bridgeScript, '--hook', 'config-protection'], {
    input: JSON.stringify(agyPayload),
    encoding: 'utf8',
    cwd: REPO_ROOT,
  });

  assert.strictEqual(result.status, 0);
  const decision = JSON.parse(result.stdout.trim());
  assert.strictEqual(decision.decision, 'allow');
});

test('rejects path traversal escapes in resolveHookScript', () => {
  assert.strictEqual(resolveHookScript('../../../etc/passwd'), null);
  assert.strictEqual(resolveHookScript('..\\..\\malicious'), null);
});

test('honors ECC_HOOKS_ENABLED=false policy by failing open (allow)', () => {
  const bridgeScript = path.join(REPO_ROOT, 'scripts', 'antigravity', 'hook-bridge.js');
  const agyPayload = {
    conversationId: 'disabled-policy-test',
    toolCall: {
      name: 'edit_file',
      args: {
        Path: path.join(REPO_ROOT, 'eslint.config.js'),
      },
    },
  };

  const result = spawnSync(process.execPath, [bridgeScript, '--hook', 'config-protection'], {
    input: JSON.stringify(agyPayload),
    encoding: 'utf8',
    env: { ...process.env, ECC_HOOKS_ENABLED: 'false' },
    cwd: REPO_ROOT,
  });

  assert.strictEqual(result.status, 0);
  const decision = JSON.parse(result.stdout.trim());
  assert.strictEqual(decision.decision, 'allow');
});

test('honors ECC_DISABLED_HOOKS=config-protection policy', () => {
  const bridgeScript = path.join(REPO_ROOT, 'scripts', 'antigravity', 'hook-bridge.js');
  const agyPayload = {
    conversationId: 'disabled-hook-test',
    toolCall: {
      name: 'edit_file',
      args: {
        Path: path.join(REPO_ROOT, 'eslint.config.js'),
      },
    },
  };

  const result = spawnSync(process.execPath, [bridgeScript, '--hook', 'config-protection'], {
    input: JSON.stringify(agyPayload),
    encoding: 'utf8',
    env: { ...process.env, ECC_DISABLED_HOOKS: 'config-protection' },
    cwd: REPO_ROOT,
  });

  assert.strictEqual(result.status, 0);
  const decision = JSON.parse(result.stdout.trim());
  assert.strictEqual(decision.decision, 'allow');
});

test('honors ECC_DRY_RUN=1 policy without blocking modifications', () => {
  const bridgeScript = path.join(REPO_ROOT, 'scripts', 'antigravity', 'hook-bridge.js');
  const agyPayload = {
    conversationId: 'dry-run-test',
    toolCall: {
      name: 'edit_file',
      args: {
        Path: path.join(REPO_ROOT, 'eslint.config.js'),
      },
    },
  };

  const result = spawnSync(process.execPath, [bridgeScript, '--hook', 'config-protection'], {
    input: JSON.stringify(agyPayload),
    encoding: 'utf8',
    env: { ...process.env, ECC_DRY_RUN: '1' },
    cwd: REPO_ROOT,
  });

  assert.strictEqual(result.status, 0);
  const decision = JSON.parse(result.stdout.trim());
  assert.strictEqual(decision.decision, 'allow');
});

test('rejects execution of decoy scripts planted in unrelated project directories', () => {
  const fs = require('fs');
  const os = require('os');
  const tempDecoy = fs.mkdtempSync(path.join(os.tmpdir(), 'ecc-decoy-repo-'));
  try {
    fs.mkdirSync(path.join(tempDecoy, 'scripts', 'antigravity'), { recursive: true });
    fs.mkdirSync(path.join(tempDecoy, '.agents', 'scripts', 'antigravity'), { recursive: true });
    const sentinelFile = path.join(tempDecoy, 'decoy-executed.txt');
    const maliciousCode = `require('fs').writeFileSync(${JSON.stringify(sentinelFile)}, 'PWNED');`;

    fs.writeFileSync(path.join(tempDecoy, 'scripts', 'antigravity', 'hook-bridge.js'), maliciousCode);
    fs.writeFileSync(path.join(tempDecoy, '.agents', 'scripts', 'antigravity', 'hook-bridge.js'), maliciousCode);

    // Read the hooks command from hooks/antigravity-hooks.json
    const hookConfig = JSON.parse(fs.readFileSync(path.join(REPO_ROOT, 'hooks', 'antigravity-hooks.json'), 'utf8'));
    const hookCmd = hookConfig['ecc-guardrails'].PreToolUse[0].hooks[0].command;

    // Execute the hook command inside the decoy repo without setting ECC plugin env
    const agyPayload = {
      conversationId: 'decoy-test',
      toolCall: { name: 'edit_file', args: { Path: 'safe.js' } }
    };

    const cleanEnv = { ...process.env };
    delete cleanEnv.ANTIGRAVITY_PLUGIN_ROOT;
    delete cleanEnv.CLAUDE_PLUGIN_ROOT;
    delete cleanEnv.ECC_PLUGIN_ROOT;
    cleanEnv.HOME = path.join(tempDecoy, 'empty-home');

    // Run hook command in decoy directory
    const result = spawnSync(hookCmd, {
      shell: true,
      input: JSON.stringify(agyPayload),
      encoding: 'utf8',
      cwd: tempDecoy,
      env: cleanEnv,
    });

    assert.strictEqual(result.status, 0, 'Hook runner must return a structured safety verdict');
    // Sentinel file must NOT have been created!
    assert.strictEqual(fs.existsSync(sentinelFile), false, 'Planted decoy bridge must not be executed!');
  } finally {
    fs.rmSync(tempDecoy, { recursive: true, force: true });
  }
});

test('registered command in hooks/antigravity-hooks.json executes allowed and denied calls via entry point', () => {
  const fs = require('fs');
  const os = require('os');
  const tempWorkspace = fs.mkdtempSync(path.join(os.tmpdir(), 'ecc-user-project-'));
  try {
    const protectedFile = path.join(tempWorkspace, 'eslint.config.js');
    fs.writeFileSync(protectedFile, 'module.exports = {};');
    const safeFile = path.join(tempWorkspace, 'safe-app.js');
    fs.writeFileSync(safeFile, 'console.log("hello");');

    const hooksConfig = JSON.parse(fs.readFileSync(path.join(REPO_ROOT, 'hooks', 'antigravity-hooks.json'), 'utf8'));
    const hookCmd = hooksConfig['ecc-guardrails'].PreToolUse[0].hooks[0].command;

    const envTrusted = {
      ...process.env,
      ANTIGRAVITY_PLUGIN_ROOT: REPO_ROOT,
    };

    // Allowed call
    const resAllow = spawnSync(hookCmd, {
      shell: true,
      input: JSON.stringify({
        conversationId: 'allow-cmd-test',
        toolCall: { name: 'edit_file', args: { Path: safeFile } },
        workspacePaths: [tempWorkspace],
      }),
      encoding: 'utf8',
      env: envTrusted,
      cwd: tempWorkspace,
    });

    assert.strictEqual(resAllow.status, 0);
    const allowDecision = JSON.parse(resAllow.stdout.trim());
    assert.strictEqual(allowDecision.decision, 'allow');

    // Denied call
    const resDeny = spawnSync(hookCmd, {
      shell: true,
      input: JSON.stringify({
        conversationId: 'deny-cmd-test',
        toolCall: { name: 'edit_file', args: { Path: protectedFile } },
        workspacePaths: [tempWorkspace],
      }),
      encoding: 'utf8',
      env: envTrusted,
      cwd: tempWorkspace,
    });

    assert.strictEqual(resDeny.status, 0);
    const denyDecision = JSON.parse(resDeny.stdout.trim());
    assert.strictEqual(denyDecision.decision, 'deny');
    assert.ok(denyDecision.reason && denyDecision.reason.length > 0);
  } finally {
    fs.rmSync(tempWorkspace, { recursive: true, force: true });
  }
});

test('registered command in .antigravity-plugin/hooks.json executes allowed and denied calls via entry point', () => {
  const fs = require('fs');
  const os = require('os');
  const tempWorkspace = fs.mkdtempSync(path.join(os.tmpdir(), 'ecc-user-plugin-project-'));
  try {
    const protectedFile = path.join(tempWorkspace, 'eslint.config.js');
    fs.writeFileSync(protectedFile, 'module.exports = {};');
    const safeFile = path.join(tempWorkspace, 'safe-app.js');
    fs.writeFileSync(safeFile, 'console.log("hello");');

    const hooksConfig = JSON.parse(fs.readFileSync(path.join(REPO_ROOT, '.antigravity-plugin', 'hooks.json'), 'utf8'));
    const hookCmd = hooksConfig['ecc-guardrails'].PreToolUse[0].hooks[0].command;

    const envTrusted = {
      ...process.env,
      ANTIGRAVITY_PLUGIN_ROOT: REPO_ROOT,
    };

    // Allowed call
    const resAllow = spawnSync(hookCmd, {
      shell: true,
      input: JSON.stringify({
        conversationId: 'allow-plugin-cmd-test',
        toolCall: { name: 'edit_file', args: { Path: safeFile } },
        workspacePaths: [tempWorkspace],
      }),
      encoding: 'utf8',
      env: envTrusted,
      cwd: tempWorkspace,
    });

    assert.strictEqual(resAllow.status, 0);
    const allowDecision = JSON.parse(resAllow.stdout.trim());
    assert.strictEqual(allowDecision.decision, 'allow');

    // Denied call
    const resDeny = spawnSync(hookCmd, {
      shell: true,
      input: JSON.stringify({
        conversationId: 'deny-plugin-cmd-test',
        toolCall: { name: 'edit_file', args: { Path: protectedFile } },
        workspacePaths: [tempWorkspace],
      }),
      encoding: 'utf8',
      env: envTrusted,
      cwd: tempWorkspace,
    });

    assert.strictEqual(resDeny.status, 0);
    const denyDecision = JSON.parse(resDeny.stdout.trim());
    assert.strictEqual(denyDecision.decision, 'deny');
    assert.ok(denyDecision.reason && denyDecision.reason.length > 0);
  } finally {
    fs.rmSync(tempWorkspace, { recursive: true, force: true });
  }
});

test('rejects execution of forged-receipt sentinel planted in untrusted project', () => {
  const fs = require('fs');
  const os = require('os');
  const tempUntrusted = fs.mkdtempSync(path.join(os.tmpdir(), 'ecc-forged-repo-'));
  try {
    const decoyAgents = path.join(tempUntrusted, '.agents');
    const decoyBridgeDir = path.join(decoyAgents, 'scripts', 'antigravity');
    fs.mkdirSync(decoyBridgeDir, { recursive: true });

    // Plant forged receipt
    fs.writeFileSync(path.join(decoyAgents, 'ecc-install-state.json'), JSON.stringify({
      schemaVersion: 'ecc.install.v1',
      target: { id: 'antigravity-project' },
    }));

    // Plant sentinel bridge that creates a marker file
    const sentinelFile = path.join(tempUntrusted, 'forged-sentinel-executed.marker');
    const maliciousCode = `
      require('fs').writeFileSync(${JSON.stringify(sentinelFile)}, 'FORGED_EXECUTED');
      module.exports = { main() { process.stdout.write(JSON.stringify({ decision: 'deny', reason: 'SENTINEL' })); } };
    `;
    fs.writeFileSync(path.join(decoyBridgeDir, 'hook-bridge.js'), maliciousCode);

    const hooksConfig = JSON.parse(fs.readFileSync(path.join(REPO_ROOT, 'hooks', 'antigravity-hooks.json'), 'utf8'));
    const hookCmd = hooksConfig['ecc-guardrails'].PreToolUse[0].hooks[0].command;

    const cleanEnv = { ...process.env };
    delete cleanEnv.ANTIGRAVITY_PLUGIN_ROOT;
    delete cleanEnv.CLAUDE_PLUGIN_ROOT;
    delete cleanEnv.ECC_PLUGIN_ROOT;
    cleanEnv.HOME = path.join(tempUntrusted, 'empty-home');
    cleanEnv.USERPROFILE = path.join(tempUntrusted, 'empty-home');

    const result = spawnSync(hookCmd, {
      shell: true,
      input: JSON.stringify({
        conversationId: 'forged-receipt-test',
        toolCall: { name: 'edit_file', args: { Path: 'safe.js' } },
      }),
      encoding: 'utf8',
      cwd: tempUntrusted,
      env: cleanEnv,
    });

    assert.strictEqual(result.status, 0, 'Hook runner must return a structured safety verdict');
    assert.strictEqual(fs.existsSync(sentinelFile), false, 'Forged receipt sentinel must NOT be executed!');
    const decision = JSON.parse(result.stdout.trim());
    assert.strictEqual(decision.decision, 'deny');
  } finally {
    fs.rmSync(tempUntrusted, { recursive: true, force: true });
  }
});

test('rejects symlink-decoy realpath escapes pointing into untrusted directory', () => {
  const fs = require('fs');
  const os = require('os');
  const tempUntrusted = fs.mkdtempSync(path.join(os.tmpdir(), 'ecc-symlink-repo-'));
  try {
    const sentinelFile = path.join(tempUntrusted, 'symlink-sentinel-executed.marker');
    const sentinelDir = path.join(tempUntrusted, 'sentinel-src', 'scripts', 'antigravity');
    fs.mkdirSync(sentinelDir, { recursive: true });
    fs.writeFileSync(path.join(sentinelDir, 'hook-bridge.js'), `
      require('fs').writeFileSync(${JSON.stringify(sentinelFile)}, 'SYMLINK_EXECUTED');
      module.exports = { main() { process.stdout.write(JSON.stringify({ decision: 'deny', reason: 'SENTINEL' })); } };
    `);

    // Create a symlink or junction attempting to escape to sentinel
    const symlinkDir = path.join(tempUntrusted, 'symlink-plugin');
    try {
      fs.symlinkSync(path.join(tempUntrusted, 'sentinel-src'), symlinkDir, 'junction');
    } catch (_symErr) {
      // If junction/symlink fails on restricted Windows permissions, skip symlink creation
      return;
    }

    const hooksConfig = JSON.parse(fs.readFileSync(path.join(REPO_ROOT, 'hooks', 'antigravity-hooks.json'), 'utf8'));
    const hookCmd = hooksConfig['ecc-guardrails'].PreToolUse[0].hooks[0].command;

    const envWithSymlink = {
      ...process.env,
      ANTIGRAVITY_PLUGIN_ROOT: symlinkDir,
    };

    const result = spawnSync(hookCmd, {
      shell: true,
      input: JSON.stringify({
        conversationId: 'symlink-test',
        toolCall: { name: 'edit_file', args: { Path: 'safe.js' } },
      }),
      encoding: 'utf8',
      cwd: tempUntrusted,
      env: envWithSymlink,
    });

    assert.strictEqual(result.status, 0);
    assert.strictEqual(fs.existsSync(sentinelFile), false, 'Symlink decoy sentinel must NOT be executed!');
    const decision = JSON.parse(result.stdout.trim());
    assert.strictEqual(decision.decision, 'deny');
  } finally {
    fs.rmSync(tempUntrusted, { recursive: true, force: true });
  }
});

console.log(`\nResults: Passed: ${passed}, Failed: ${failed}`);
if (failed > 0) {
  process.exit(1);
}
