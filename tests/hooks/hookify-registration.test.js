/**
 * Hook registration and dispatcher integration tests for Hookify (#2561).
 */

'use strict';

const assert = require('assert');
const fs = require('fs');
const os = require('os');
const path = require('path');
const { spawnSync } = require('child_process');

const repoRoot = path.join(__dirname, '..', '..');
const runtimePath = path.join(repoRoot, 'scripts', 'hooks', 'hookify-runtime.js');
const hooksPath = path.join(repoRoot, 'hooks', 'hooks.json');
const dispatcherPath = path.join(repoRoot, 'scripts', 'hooks', 'posttooluse-dispatcher.js');
const { readHooksConfig } = require('../../scripts/lib/hooks-config');
const {
  REGISTERED_HOOK_MAX_STDIN_BYTES,
  createHookContextScanner,
} = require('../../scripts/hooks/hook-input-limits');

function readRegisteredHooks() {
  return readHooksConfig(hooksPath).hooks;
}

function test(name, fn) {
  try {
    fn();
    console.log('  \u2713 ' + name);
    return true;
  } catch (error) {
    console.log('  \u2717 ' + name);
    console.log('    Error: ' + error.message);
    return false;
  }
}

function createProject() {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'ecc-hookify-registration-'));
  fs.mkdirSync(path.join(root, '.claude'), { recursive: true });
  return root;
}

function writeRule(root, slug, frontmatter, message) {
  const file = path.join(root, '.claude', 'hookify.' + slug + '.local.md');
  fs.writeFileSync(file, '---\n' + frontmatter.trim() + '\n---\n' + message + '\n');
}

function runRegisteredEntry(root, entry, input, env = {}) {
  return spawnSync(entry.hooks[0].command, {
    cwd: root,
    input: JSON.stringify(input),
    encoding: 'utf8',
    shell: true,
    env: {
      ...process.env,
      CLAUDE_PLUGIN_ROOT: repoRoot,
      CLAUDE_PROJECT_DIR: root,
      ECC_HOOK_PROFILE: 'minimal',
      ...env,
    },
    timeout: 15000,
    maxBuffer: 16 * 1024 * 1024,
  });
}

console.log('\nHookify registration tests (#2561)');
console.log('\u2500'.repeat(50));

let passed = 0;
let failed = 0;

if (test('streaming context scanner keeps only root hook fields across chunks', () => {
  const scanner = createHookContextScanner();
  scanner.push('{"tool_input":{"tool_name":"Bash","content":"');
  scanner.push('x'.repeat(REGISTERED_HOOK_MAX_STDIN_BYTES + 1));
  scanner.push('"},"hook_event_name":"PostToolUse","tool_name":"Write",');
  scanner.push('"stop_hook_active":true}');
  assert.deepStrictEqual(scanner.context, {
    hookEventName: 'PostToolUse',
    toolName: 'Write',
    stopHookActive: true,
  });
})) passed++; else failed++;

if (test('registers all four events and keeps PostToolUse consolidated', () => {
  const hooks = readRegisteredHooks();
  assert.ok(hooks.PreToolUse.some(entry => entry.id === 'pre:hookify-runtime'));
  assert.ok(hooks.UserPromptSubmit.some(entry => entry.id === 'prompt:hookify-runtime'));
  assert.ok(hooks.Stop.some(entry => entry.id === 'stop:hookify-runtime'));
  assert.strictEqual(hooks.PostToolUse.length, 2, 'PostToolUse must remain consolidated');
  const dispatcher = require(dispatcherPath);
  assert.ok(dispatcher.SYNC_HOOKS.some(entry => entry.id === 'post:hookify-runtime'));
})) passed++; else failed++;

if (test('registered hook commands enforce rules across all four events', () => {
  const root = createProject();
  try {
    writeRule(root, 'all-events', 'name: all-events\nevent: all\naction: block\npattern: HOOKIFY_SENTINEL', 'Registered runtime matched.');
    const hooks = readRegisteredHooks();
    const entries = [
      [hooks.PreToolUse.find(entry => entry.id === 'pre:hookify-runtime'),
        { hook_event_name: 'PreToolUse', tool_name: 'Bash', tool_input: { command: 'echo HOOKIFY_SENTINEL' } },
        output => output.hookSpecificOutput?.permissionDecision === 'deny'],
      [hooks.UserPromptSubmit.find(entry => entry.id === 'prompt:hookify-runtime'),
        { hook_event_name: 'UserPromptSubmit', prompt: 'HOOKIFY_SENTINEL' },
        output => output.decision === 'block'],
      [hooks.PostToolUse.find(entry => entry.id === 'post:dispatcher:sync'),
        { hook_event_name: 'PostToolUse', tool_name: 'Read', tool_input: { file_path: 'HOOKIFY_SENTINEL' }, tool_response: {} },
        output => output.decision === 'block'],
      [hooks.Stop.find(entry => entry.id === 'stop:hookify-runtime'),
        { hook_event_name: 'Stop', stop_hook_active: false, last_assistant_message: 'HOOKIFY_SENTINEL' },
        output => output.decision === 'block'],
    ];
    for (const [entry, input, assertion] of entries) {
      const result = runRegisteredEntry(root, entry, input, { ECC_DISABLED_HOOKS: 'post:ecc-metrics-bridge' });
      assert.strictEqual(result.status, 0, result.stderr);
      const output = JSON.parse(result.stdout);
      assert.ok(assertion(output), entry.id + ' did not preserve the blocking decision');
      assert.match(JSON.stringify(output), /Registered runtime matched/);
    }
  } finally {
    fs.rmSync(root, { recursive: true, force: true });
  }
})) passed++; else failed++;

if (test('registered Hookify IDs can be disabled independently', () => {
  const root = createProject();
  try {
    writeRule(root, 'disable', 'name: block-disabled\nevent: bash\naction: block\npattern: .*', 'Must not run.');
    const hooks = readRegisteredHooks();
    const entry = hooks.PreToolUse.find(item => item.id === 'pre:hookify-runtime');
    const result = runRegisteredEntry(root, entry, {
      hook_event_name: 'PreToolUse',
      tool_name: 'Bash',
      tool_input: { command: 'pwd' },
    }, { ECC_DISABLED_HOOKS: 'pre:hookify-runtime' });
    assert.strictEqual(result.status, 0, result.stderr);
    assert.strictEqual(result.stdout, '');
  } finally {
    fs.rmSync(root, { recursive: true, force: true });
  }
})) passed++; else failed++;

if (test('direct entrypoint emits valid JSON for a matched prompt rule', () => {
  const root = createProject();
  try {
    writeRule(root, 'prompt', 'name: warn-password\nevent: prompt\npattern: password', 'Do not paste credentials.');
    const result = spawnSync(process.execPath, [runtimePath], {
      cwd: root,
      input: JSON.stringify({ hook_event_name: 'UserPromptSubmit', prompt: 'Here is my password' }),
      encoding: 'utf8',
      env: { ...process.env, CLAUDE_PROJECT_DIR: root },
      timeout: 10000,
    });
    assert.strictEqual(result.status, 0, result.stderr);
    const output = JSON.parse(result.stdout);
    assert.strictEqual(output.hookSpecificOutput.hookEventName, 'UserPromptSubmit');
    assert.match(output.hookSpecificOutput.additionalContext, /Do not paste credentials/);
  } finally {
    fs.rmSync(root, { recursive: true, force: true });
  }
})) passed++; else failed++;

if (test('registered PreToolUse hook fails closed on oversized file input', () => {
  const root = createProject();
  try {
    writeRule(root, 'oversized-file', 'name: oversized-file\nevent: file\naction: block\npattern: BLOCK_ME', 'Oversized writes require review.');
    const hooks = readRegisteredHooks();
    const entry = hooks.PreToolUse.find(item => item.id === 'pre:hookify-runtime');
    const result = runRegisteredEntry(root, entry, {
      tool_input: {
        tool_name: 'Bash',
        file_path: 'large.txt',
        content: 'x'.repeat(REGISTERED_HOOK_MAX_STDIN_BYTES + 1),
      },
      hook_event_name: 'PreToolUse',
      tool_name: 'Write',
    });
    assert.strictEqual(result.status, 0, result.stderr);
    assert.strictEqual(JSON.parse(result.stdout).hookSpecificOutput.permissionDecision, 'deny');
  } finally {
    fs.rmSync(root, { recursive: true, force: true });
  }
})) passed++; else failed++;

if (test('registered stdin limit counts multibyte UTF-8 bytes', () => {
  const root = createProject();
  try {
    writeRule(root, 'unicode', 'name: unicode\nevent: file\naction: block\npattern: NEVER_MATCH', 'Oversized input must be reviewed.');
    const hooks = readRegisteredHooks();
    const entry = hooks.PreToolUse.find(item => item.id === 'pre:hookify-runtime');
    const result = runRegisteredEntry(root, entry, {
      hook_event_name: 'PreToolUse',
      tool_name: 'Write',
      tool_input: { content: '\u754c'.repeat(400000) },
    });
    assert.strictEqual(result.status, 0, result.stderr);
    assert.strictEqual(JSON.parse(result.stdout).hookSpecificOutput.permissionDecision, 'deny');
    assert.match(result.stderr, /stdin exceeded 1048576 bytes/);
  } finally {
    fs.rmSync(root, { recursive: true, force: true });
  }
})) passed++; else failed++;

if (test('oversized registered Write ignores an unrelated bash-only block rule', () => {
  const root = createProject();
  try {
    writeRule(
      root,
      'bash-only',
      'name: bash-only\nevent: bash\naction: block\npattern: .*',
      'Bash only.'
    );
    const hooks = readRegisteredHooks();
    const entry = hooks.PreToolUse.find(item => item.id === 'pre:hookify-runtime');
    const result = runRegisteredEntry(root, entry, {
      hook_event_name: 'PreToolUse',
      tool_name: 'Write',
      tool_input: {
        file_path: 'large.txt',
        content: 'x'.repeat(REGISTERED_HOOK_MAX_STDIN_BYTES + 1),
      },
    });
    assert.strictEqual(result.status, 0, result.stderr);
    assert.strictEqual(result.stdout, '');
  } finally {
    fs.rmSync(root, { recursive: true, force: true });
  }
})) passed++; else failed++;

if (test('oversized registered PostToolUse keeps its tool type after truncation', () => {
  const root = createProject();
  try {
    writeRule(
      root,
      'bash-only',
      'name: bash-only\nevent: bash\naction: block\npattern: .*',
      'Bash only.'
    );
    const hooks = readRegisteredHooks();
    const entry = hooks.PostToolUse.find(item => item.id === 'post:dispatcher:sync');
    const result = runRegisteredEntry(root, entry, {
      tool_input: {
        tool_name: 'Bash',
        content: 'x'.repeat(REGISTERED_HOOK_MAX_STDIN_BYTES + 1),
      },
      hook_event_name: 'PostToolUse',
      tool_name: 'Write',
    }, { ECC_DISABLED_HOOKS: 'post:ecc-metrics-bridge' });
    assert.strictEqual(result.status, 0, result.stderr);
    assert.strictEqual(result.stdout, '');
  } finally {
    fs.rmSync(root, { recursive: true, force: true });
  }
})) passed++; else failed++;

if (test('oversized recursive Stop remains non-blocking', () => {
  const root = createProject();
  try {
    writeRule(
      root,
      'stop',
      'name: stop\nevent: stop\naction: block\npattern: .*',
      'Stop once.'
    );
    const hooks = readRegisteredHooks();
    const entry = hooks.Stop.find(item => item.id === 'stop:hookify-runtime');
    const result = runRegisteredEntry(root, entry, {
      last_assistant_message: 'x'.repeat(REGISTERED_HOOK_MAX_STDIN_BYTES + 1),
      hook_event_name: 'Stop',
      stop_hook_active: true,
    });
    assert.strictEqual(result.status, 0, result.stderr);
    assert.strictEqual(result.stdout, '');
  } finally {
    fs.rmSync(root, { recursive: true, force: true });
  }
})) passed++; else failed++;

if (test('PostToolUse dispatcher preserves Hookify block decisions over sibling output', () => {
  const dispatcher = require(dispatcherPath);
  const raw = JSON.stringify({ hook_event_name: 'PostToolUse', tool_name: 'Write' });
  const result = dispatcher.runHooks(raw, [
    { id: 'post:test:block', matcher: '*', profiles: 'standard,strict', run: () => ({ stdout: JSON.stringify({ decision: 'block', reason: 'Keep the block.' }) }) },
    { id: 'post:test:warning', matcher: '*', profiles: 'standard,strict', run: () => ({ additionalContext: 'Secondary warning.' }) },
    { id: 'post:test:failure', matcher: '*', profiles: 'standard,strict', run: () => ({ exitCode: 7 }) },
  ], { toolName: 'Write', env: { ECC_HOOK_PROFILE: 'standard' } });
  const output = JSON.parse(result.stdout);
  assert.strictEqual(output.decision, 'block');
  assert.match(output.reason, /Keep the block/);
  assert.match(output.hookSpecificOutput.additionalContext, /Secondary warning/);
  assert.strictEqual(result.exitCode, 0);
  assert.match(result.stderr, /post:test:failure exited with code 7/);

  const withRawOutput = dispatcher.mergeHookStdout([
    { id: 'post:test:block', stdout: JSON.stringify({ decision: 'block', reason: 'Keep the block.' }) },
    { id: 'post:test:raw', stdout: 'unstructured output' },
  ]);
  assert.strictEqual(JSON.parse(withRawOutput.stdout).decision, 'block');
  assert.match(withRawOutput.warning, /post:test:raw/);
})) passed++; else failed++;

console.log('\nPassed: ' + passed);
console.log('Failed: ' + failed);
process.exit(failed > 0 ? 1 : 0);
