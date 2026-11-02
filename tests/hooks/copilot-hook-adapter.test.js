'use strict';

const assert = require('assert');
const fs = require('fs');
const os = require('os');
const path = require('path');
const { spawnSync } = require('child_process');
const adapterPath = path.resolve(__dirname, '../../scripts/hooks/copilot-hook-adapter.js');
const { normalizeInput, translateOutput, runHook } = require(adapterPath);
const MAX_INPUT_BYTES = 1024 * 1024;
let passed = 0;
let failed = 0;

function test(name, action) {
  try {
    action();
    passed += 1;
    console.log(`  PASS ${name}`);
  } catch (error) {
    failed += 1;
    console.error(`  FAIL ${name}: ${error.message}`);
  }
}

function withProject(action) {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'ecc copilot è-'));
  try { action(root); } finally { fs.rmSync(root, { recursive: true, force: true }); }
}

function payload(cwd, toolName, toolArgs) {
  return { cwd, sessionId: 'copilot-session', toolName, toolArgs };
}

function invoke(event, id, input, env = {}) {
  const result = spawnSync(process.execPath, [adapterPath, event, id], {
    input: typeof input === 'string' ? input : JSON.stringify(input),
    encoding: 'utf8',
    timeout: 15000,
    maxBuffer: 4 * MAX_INPUT_BYTES,
    env: {
      ...process.env,
      ECC_HOOKS_ENABLED: 'true',
      ECC_HOOK_PROFILE: 'standard',
      ECC_DISABLED_HOOKS: '',
      ...env,
    },
  });
  assert.ifError(result.error);
  return { exitCode: result.status, stdout: result.stdout, stderr: result.stderr };
}

function output(result) {
  assert.ok(result.stdout.trim(), 'adapter must return a JSON object');
  const value = JSON.parse(result.stdout);
  assert.ok(value && typeof value === 'object' && !Array.isArray(value));
  return value;
}

function denied(result) {
  const value = output(result);
  assert.strictEqual(value.permissionDecision, 'deny');
  assert.ok(typeof value.permissionDecisionReason === 'string' && value.permissionDecisionReason.trim());
}

console.log('\n=== Testing Copilot hook adapter ===\n');

test('normalizes native object arguments without mutating the original', () => {
  const input = payload(process.cwd(), 'edit', { path: 'src/demo.js', old_str: 'a', new_str: 'b' });
  const before = JSON.stringify(input);
  const actual = normalizeInput('preToolUse', input);
  assert.strictEqual(actual.hook_event_name, 'PreToolUse');
  assert.strictEqual(actual.session_id, 'copilot-session');
  assert.strictEqual(actual.tool_name, 'Edit');
  assert.strictEqual(actual.tool_input.file_path, path.join(process.cwd(), 'src/demo.js'));
  assert.strictEqual(actual.tool_input.new_str, 'b');
  assert.strictEqual(JSON.stringify(input), before);
});

test('normalizes JSON string toolArgs and shell commands', () => {
  const actual = normalizeInput('preToolUse', payload(process.cwd(), 'bash', JSON.stringify({ command: 'git status' })));
  assert.strictEqual(actual.tool_name, 'Bash');
  assert.strictEqual(actual.tool_input.command, 'git status');
});

test('accepts snake_case payloads', () => {
  const actual = normalizeInput('postToolUse', {
    cwd: process.cwd(), session_id: 'snake', tool_name: 'create', tool_input: { path: 'a.js', file_text: 'hello' },
  });
  assert.strictEqual(actual.hook_event_name, 'PostToolUse');
  assert.strictEqual(actual.session_id, 'snake');
  assert.strictEqual(actual.tool_name, 'Write');
  assert.strictEqual(actual.tool_input.file_path, path.join(process.cwd(), 'a.js'));
});

test('rejects malformed tool argument JSON and nonobject payloads', () => {
  for (const input of [null, [], 'not JSON', payload(process.cwd(), 'edit', '{'), payload(process.cwd(), 'edit', []), payload(process.cwd(), 'edit', null)]) {
    assert.throws(() => normalizeInput('preToolUse', input));
  }
});

test('omitted cwd defaults to the current project directory', () => {
  const actual = normalizeInput('preToolUse', { toolName: 'edit', toolArgs: { path: 'src/file.js' } });
  assert.strictEqual(actual.cwd, process.cwd());
  assert.strictEqual(actual.tool_input.file_path, path.join(process.cwd(), 'src/file.js'));
});

test('unknown tool names never become shell tools', () => {
  const actual = normalizeInput('preToolUse', payload(process.cwd(), 'custom-tool', { command: 'git commit --no-verify' }));
  assert.strictEqual(actual.tool_name, 'custom-tool');
  assert.deepStrictEqual(output(invoke('preToolUse', 'pre:bash:block-no-verify', payload(process.cwd(), 'custom-tool', { command: 'git commit --no-verify' }))), {});
});

test('invalid cwd cannot redirect native hook execution', () => {
  for (const cwd of [42, [], {}, 'relative/path', 'bad\0path']) {
    assert.throws(() => normalizeInput('preToolUse', payload(cwd, 'edit', { path: 'a.js' })));
    denied(invoke('preToolUse', 'pre:config-protection', payload(cwd, 'edit', { path: 'a.js' })));
  }
});

test('config protection fails closed when a write target is missing', () => {
  for (const toolName of ['create', 'edit', 'create_file']) {
    denied(invoke('preToolUse', 'pre:config-protection', payload(process.cwd(), toolName, { content: 'missing target' })));
  }
});

test('mismatched event and hook ID cannot activate a canonical script', () => {
  const result = invoke('postToolUse', 'pre:config-protection', payload(process.cwd(), 'edit', { path: 'a.js' }));
  assert.notStrictEqual(result.exitCode, 0);
});

test('canonical pass-through never grants a permission', () => {
  const actual = translateOutput('preToolUse', { exitCode: 0, stdout: JSON.stringify({ tool_input: { command: 'git status' } }), stderr: '' });
  assert.deepStrictEqual(actual, {});
});

test('translates canonical nested deny', () => {
  const actual = translateOutput('preToolUse', { exitCode: 0, stdout: JSON.stringify({ hookSpecificOutput: { permissionDecision: 'deny', permissionDecisionReason: 'policy' } }), stderr: '' });
  assert.strictEqual(actual.permissionDecision, 'deny');
  assert.strictEqual(actual.permissionDecisionReason, 'policy');
});

test('nonzero pre-tool status wins over an allow verdict', () => {
  const actual = translateOutput('preToolUse', { exitCode: 2, stdout: JSON.stringify({ hookSpecificOutput: { permissionDecision: 'allow' } }), stderr: 'blocked' });
  assert.strictEqual(actual.permissionDecision, 'deny');
  assert.ok(actual.permissionDecisionReason);
});

test('pre-tool runtime errors deny rather than silently permit', () => {
  const actual = translateOutput('preToolUse', { exitCode: 1, stdout: '', stderr: 'runtime failed' });
  assert.strictEqual(actual.permissionDecision, 'deny');
});

test('post-tool warning is visible as additionalContext', () => {
  const actual = translateOutput('postToolUse', { exitCode: 0, stdout: '{}', stderr: '[Hook] WARNING: console.log' });
  assert.ok(actual.additionalContext.includes('console.log'));
  assert.ok(!Object.prototype.hasOwnProperty.call(actual, 'permissionDecision'));
});

test('canonical additional context is translated', () => {
  const actual = translateOutput('postToolUse', { exitCode: 0, stdout: JSON.stringify({ hookSpecificOutput: { additionalContext: 'check result' } }), stderr: '' });
  assert.strictEqual(actual.additionalContext, 'check result');
});

test('safe Bash commands preserve normal Copilot permissions', () => {
  const result = invoke('preToolUse', 'pre:bash:block-no-verify', payload(process.cwd(), 'bash', { command: 'git status' }));
  assert.strictEqual(result.exitCode, 0, result.stderr);
  assert.deepStrictEqual(output(result), {});
});

test('git no-verify is denied without executing the requested command', () => withProject(root => {
  const marker = path.join(root, 'should-not-exist');
  const command = `git commit --no-verify -m example; node -e "require('fs').writeFileSync('should-not-exist','bad')"`;
  denied(invoke('preToolUse', 'pre:bash:block-no-verify', payload(root, 'bash', { command })));
  assert.ok(!fs.existsSync(marker));
}));

test('Bash-specific policy does not claim PowerShell support', () => {
  const result = invoke('preToolUse', 'pre:bash:block-no-verify', payload(process.cwd(), 'powershell', { command: 'git commit --no-verify' }));
  assert.deepStrictEqual(output(result), {});
});

test('existing config is protected using payload cwd and a relative native path', () => withProject(root => {
  fs.writeFileSync(path.join(root, 'eslint.config.js'), 'original');
  denied(invoke('preToolUse', 'pre:config-protection', payload(root, 'edit', { path: 'eslint.config.js', new_str: 'changed' })));
  assert.strictEqual(fs.readFileSync(path.join(root, 'eslint.config.js'), 'utf8'), 'original');
}));

test('conflicting native path aliases cannot bypass config protection', () => withProject(root => {
  fs.writeFileSync(path.join(root, 'eslint.config.js'), 'protected');
  for (const args of [
    { path: 'eslint.config.js', file_path: 'safe.js' },
    { path: 'eslint.config.js', file: 'safe.js' },
  ]) {
    denied(invoke('preToolUse', 'pre:config-protection', payload(root, 'edit', args)));
  }
}));

test('first-time config creation stays allowed', () => withProject(root => {
  const result = invoke('preToolUse', 'pre:config-protection', payload(root, 'create', { path: 'eslint.config.js', file_text: 'new' }));
  assert.deepStrictEqual(output(result), {});
  assert.ok(!fs.existsSync(path.join(root, 'eslint.config.js')));
}));

test('patch protection checks every file and move destination', () => withProject(root => {
  fs.writeFileSync(path.join(root, '.prettierrc'), '{}');
  for (const patch of [
    '*** Begin Patch\n*** Update File: ordinary.js\n@@\n-a\n+b\n*** Update File: .prettierrc\n@@\n-{}\n+{}\n*** End Patch',
    '*** Begin Patch\n*** Update File: ordinary.js\n*** Move to: .prettierrc\n@@\n-a\n+b\n*** End Patch',
  ]) {
    denied(invoke('preToolUse', 'pre:config-protection', payload(root, 'apply_patch', { patch })));
  }
}));

test('unrecognized patch shape cannot bypass config protection', () => withProject(root => {
  denied(invoke('preToolUse', 'pre:config-protection', payload(root, 'apply_patch', { unexpected: 'shape' })));
}));

test('ad-hoc documentation warning is surfaced', () => withProject(root => {
  const value = output(invoke('preToolUse', 'pre:write:doc-file-warning', payload(root, 'create', { path: 'NOTES.md', file_text: 'draft' })));
  assert.ok(value.additionalContext.includes('Ad-hoc'));
  assert.ok(!value.permissionDecision);
}));

test('console warning inspects native edit target in the project directory', () => withProject(root => {
  fs.writeFileSync(path.join(root, 'demo.js'), 'console.log("debug");\n');
  const result = invoke('postToolUse', 'post:edit:console-warn', payload(root, 'edit', { path: 'demo.js' }));
  assert.strictEqual(result.exitCode, 0, result.stderr);
  assert.ok(output(result).additionalContext.includes('console.log'));
}));

test('malformed pre-tool JSON denies', () => {
  denied(invoke('preToolUse', 'pre:config-protection', '{invalid'));
});

test('oversized pre-tool stdin denies and cannot execute a partial payload', () => {
  denied(invoke('preToolUse', 'pre:config-protection', ' '.repeat(MAX_INPUT_BYTES + 1)));
});

test('input limit counts UTF-8 bytes rather than JS characters', () => {
  const input = JSON.stringify(payload(process.cwd(), 'edit', { path: 'a.js', new_str: 'è'.repeat(600000) }));
  assert.ok(input.length < MAX_INPUT_BYTES);
  assert.ok(Buffer.byteLength(input) > MAX_INPUT_BYTES);
  denied(invoke('preToolUse', 'pre:config-protection', input));
});

test('disabled hooks leave normal permissions unchanged', () => {
  const input = payload(process.cwd(), 'bash', { command: 'git commit --no-verify' });
  for (const env of [
    { ECC_HOOKS_ENABLED: 'false' },
    { ECC_DISABLED_HOOKS: 'pre:bash:block-no-verify' },
    { ECC_HOOK_PROFILE: 'minimal' },
  ]) {
    assert.deepStrictEqual(output(invoke('preToolUse', 'pre:bash:block-no-verify', input, env)), {});
  }
});

test('managed disabled hooks ignore inherited Claude plugin enablement', () => withProject(root => {
  const config = path.join(root, 'setup.json');
  fs.writeFileSync(config, JSON.stringify({ hooks: { enabled: false } }));
  const env = Object.fromEntries(Object.entries(process.env).filter(([name]) => ![
    'ECC_HOOKS_ENABLED', 'ECC_HOOK_PROFILE', 'ECC_DISABLED_HOOKS', 'ECC_HOOK_CONFIG',
  ].includes(name)));
  const hookEnv = {
    ...env, ECC_HOOK_CONFIG: config,
    CLAUDE_PLUGIN_OPTION_HOOKS_ENABLED: 'true', CLAUDE_PLUGIN_OPTION_HOOK_PROFILE: 'strict',
  };
  const originalEnv = JSON.stringify(hookEnv);
  const result = runHook('preToolUse', 'pre:bash:block-no-verify', JSON.stringify(payload(root, 'bash', { command: 'git commit --no-verify' })), { env: hookEnv });
  assert.deepStrictEqual(output(result), {});
  assert.strictEqual(JSON.stringify(hookEnv), originalEnv, 'adapter must not mutate supplied env');
}));

test('managed minimal profile ignores inherited Claude plugin strict profile', () => withProject(root => {
  const config = path.join(root, 'setup.json');
  fs.writeFileSync(config, JSON.stringify({ hooks: { enabled: true, profile: 'minimal' } }));
  const env = Object.fromEntries(Object.entries(process.env).filter(([name]) => ![
    'ECC_HOOKS_ENABLED', 'ECC_HOOK_PROFILE', 'ECC_DISABLED_HOOKS', 'ECC_HOOK_CONFIG',
  ].includes(name)));
  const result = runHook('preToolUse', 'pre:bash:block-no-verify', JSON.stringify(payload(root, 'bash', { command: 'git commit --no-verify' })), {
    env: { ...env, ECC_HOOK_CONFIG: config, CLAUDE_PLUGIN_OPTION_HOOKS_ENABLED: 'true', CLAUDE_PLUGIN_OPTION_HOOK_PROFILE: 'strict' },
  });
  assert.deepStrictEqual(output(result), {});
}));

test('CLI missing event and policy ID returns one empty JSON object and a failure status', () => {
  const result = spawnSync(process.execPath, [adapterPath], {
    input: '{}', encoding: 'utf8', timeout: 15000,
  });
  assert.ifError(result.error);
  assert.notStrictEqual(result.status, 0);
  assert.deepStrictEqual(JSON.parse(result.stdout), {});
});

test('runHook rejects caller-selected scripts outside its fixed allowlist', () => {
  const result = runHook('preToolUse', '../../arbitrary.js', JSON.stringify(payload(process.cwd(), 'bash', { command: 'git status' })));
  denied(result);
});

test('unknown event cannot activate a canonical hook', () => {
  const result = invoke('madeUpEvent', 'pre:config-protection', payload(process.cwd(), 'edit', { path: 'a.js' }));
  assert.notStrictEqual(result.exitCode, 0);
});

test('nested path aliases and patch aliases must agree', () => withProject(root => {
  fs.writeFileSync(path.join(root, 'eslint.config.js'), 'original');
  for (const edits of [
    [{ path: 'eslint.config.js', file_path: 'safe.js' }],
    [{ path: 'eslint.config.js', file: 'safe.js' }],
  ]) {
    denied(invoke('preToolUse', 'pre:config-protection', payload(root, 'edit', { edits })));
  }
  const input = '*** Begin Patch\n*** Update File: eslint.config.js\n@@\n-a\n+b\n*** End Patch';
  const patch = '*** Begin Patch\n*** Update File: safe.js\n@@\n-a\n+b\n*** End Patch';
  denied(invoke('preToolUse', 'pre:config-protection', payload(root, 'apply_patch', { input, patch })));
}));

test('oversized edit batches cannot exceed the hook execution budget', () => withProject(root => {
  const patch = '*** Begin Patch\n' + Array.from({ length: 65 }, (_, index) => `*** Update File: demo${index}.js\n@@\n-a\n+b\n`).join('') + '*** End Patch';
  denied(invoke('preToolUse', 'pre:config-protection', payload(root, 'apply_patch', { patch })));
}));

console.log(`\nPassed: ${passed}\nFailed: ${failed}\n`);
process.exitCode = failed ? 1 : 0;
