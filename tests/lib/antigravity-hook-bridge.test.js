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

    // Sentinel file must NOT have been created!
    assert.strictEqual(fs.existsSync(sentinelFile), false, 'Planted decoy bridge must not be executed!');
  } finally {
    fs.rmSync(tempDecoy, { recursive: true, force: true });
  }
});

console.log(`\nResults: Passed: ${passed}, Failed: ${failed}`);
if (failed > 0) {
  process.exit(1);
}
