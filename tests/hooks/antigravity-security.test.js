/**
 * Contract tests for the native Antigravity security hook adapter.
 */

'use strict';

const assert = require('assert');
const fs = require('fs');
const os = require('os');
const path = require('path');
const { spawnSync } = require('child_process');

const repoRoot = path.join(__dirname, '..', '..');
const adapterPath = path.join(repoRoot, 'scripts', 'hooks', 'antigravity-security.js');

let passed = 0;
let failed = 0;

function test(name, fn) {
  try {
    fn();
    console.log(`  ✓ ${name}`);
    passed++;
  } catch (error) {
    console.log(`  ✗ ${name}`);
    console.log(`    Error: ${error.message}`);
    failed++;
  }
}

function runAdapter(input, env = {}) {
  return spawnSync(process.execPath, [adapterPath], {
    cwd: repoRoot,
    input: typeof input === 'string' ? input : JSON.stringify(input),
    encoding: 'utf8',
    env: {
      ...process.env,
      ECC_HOOK_PROFILE: 'standard',
      ECC_DISABLED_HOOKS: '',
      GATEGUARD_BASH_ROUTINE_DISABLED: '1',
      ...env,
    },
    timeout: 10_000,
    maxBuffer: 4 * 1024 * 1024,
  });
}

function commandInput(command, overrides = {}) {
  return {
    toolCall: {
      name: 'run_command',
      args: { CommandLine: command, Cwd: repoRoot },
    },
    conversationId: `antigravity-hook-${process.pid}`,
    workspacePaths: [repoRoot],
    ...overrides,
  };
}

console.log('\n=== Antigravity native security hook tests ===\n');

test('ships the documented native PreToolUse registration', () => {
  const config = JSON.parse(
    fs.readFileSync(path.join(repoRoot, 'scripts', 'hooks', 'antigravity-hooks.json'), 'utf8')
  );
  assert.deepStrictEqual(Object.keys(config), ['ecc-security-guard']);
  const registration = config['ecc-security-guard'].PreToolUse[0];
  assert.strictEqual(
    registration.matcher,
    'run_command|write_to_file|replace_file_content|multi_replace_file_content'
  );
  assert.deepStrictEqual(registration.hooks, [{
    type: 'command',
    command: 'node .agents/ecc-hooks/hooks/antigravity-security.js',
    timeout: 10,
  }]);
});

test('maps documented Antigravity command input to the ECC Bash contract', () => {
  const { transformPreToolUse } = require(adapterPath);
  assert.deepStrictEqual(transformPreToolUse(commandInput('npm test'), { platform: 'linux' }), {
    tool_name: 'Bash',
    tool_input: { command: 'npm test' },
    session_id: `antigravity-hook-${process.pid}`,
    cwd: repoRoot,
    _antigravity: { tool_name: 'run_command' },
  });
});

test('does not mutate the caller environment when loaded in-process', () => {
  const previous = process.env.ECC_PLUGIN_ROOT;
  try {
    delete process.env.ECC_PLUGIN_ROOT;
    delete require.cache[require.resolve(adapterPath)];
    require(adapterPath);
    assert.strictEqual(process.env.ECC_PLUGIN_ROOT, undefined);
  } finally {
    if (previous === undefined) delete process.env.ECC_PLUGIN_ROOT;
    else process.env.ECC_PLUGIN_ROOT = previous;
  }
});

test('maps documented Antigravity file-write inputs to ECC contracts', () => {
  const { transformPreToolUse } = require(adapterPath);
  const common = {
    conversationId: `antigravity-hook-${process.pid}`,
    workspacePaths: [repoRoot],
  };

  assert.deepStrictEqual(transformPreToolUse({
    ...common,
    toolCall: {
      name: 'write_to_file',
      args: { TargetFile: '/tmp/example', CodeContent: 'created' },
    },
  }).tool_input, { file_path: '/tmp/example', content: 'created' });
  assert.deepStrictEqual(transformPreToolUse({
    ...common,
    toolCall: {
      name: 'replace_file_content',
      args: {
        TargetFile: '/tmp/example',
        TargetContent: 'before',
        ReplacementContent: 'after',
      },
    },
  }).tool_input, {
    file_path: '/tmp/example',
    old_string: 'before',
    new_string: 'after',
  });
  assert.deepStrictEqual(transformPreToolUse({
    ...common,
    toolCall: {
      name: 'multi_replace_file_content',
      args: {
        TargetFile: '/tmp/example',
        ReplacementChunks: [{ TargetContent: 'one', ReplacementContent: 'two' }],
      },
    },
  }).tool_input, {
    file_path: '/tmp/example',
    edits: [{ file_path: '/tmp/example', old_string: 'one', new_string: 'two' }],
  });
});

test('allows a read-only command with official decision JSON', () => {
  const result = runAdapter(commandInput('git status'));
  assert.strictEqual(result.status, 0, result.stderr);
  assert.deepStrictEqual(JSON.parse(result.stdout), { decision: 'ask' });
});

test('denies destructive PowerShell submitted through run_command', () => {
  const stateDir = fs.mkdtempSync(path.join(os.tmpdir(), 'ecc-antigravity-powershell-'));
  try {
    const result = runAdapter(commandInput('Remove-Item -Recurse -Force C:\\temp\\target'), {
      GATEGUARD_STATE_DIR: stateDir,
    });
    assert.strictEqual(result.status, 0, result.stderr);
    assert.strictEqual(JSON.parse(result.stdout).decision, 'deny');
  } finally {
    fs.rmSync(stateDir, { recursive: true, force: true });
  }
});

test('keeps benign Windows commands subject to native confirmation', () => {
  const { runPreToolUse, transformPreToolUse } = require(adapterPath);
  const input = commandInput('git status');
  assert.strictEqual(transformPreToolUse(input, { platform: 'win32' }).tool_name, 'PowerShell');
  assert.deepStrictEqual(runPreToolUse(input, { platform: 'win32' }), { decision: 'ask' });
});

test('accepts a command cwd contained by a declared workspace', () => {
  const { transformPreToolUse } = require(adapterPath);
  const nestedCwd = path.join(repoRoot, 'scripts');
  const input = commandInput('git status');
  input.toolCall.args.Cwd = nestedCwd;
  assert.strictEqual(
    transformPreToolUse(input, { platform: 'linux' }).cwd,
    fs.realpathSync(nestedCwd)
  );
});

test('fails closed when a supplied cwd escapes every declared workspace', () => {
  const { runPreToolUse } = require(adapterPath);
  const workspaceDir = fs.mkdtempSync(path.join(os.tmpdir(), 'ecc-antigravity-workspace-'));
  const outsideDir = fs.mkdtempSync(path.join(os.tmpdir(), 'ecc-antigravity-outside-'));
  try {
    const input = commandInput('git status', { workspacePaths: [workspaceDir] });
    input.toolCall.args.Cwd = outsideDir;
    const result = runPreToolUse(input);
    assert.strictEqual(result.decision, 'deny');
    assert.match(result.reason, /outside the declared workspace/i);
  } finally {
    fs.rmSync(workspaceDir, { recursive: true, force: true });
    fs.rmSync(outsideDir, { recursive: true, force: true });
  }
});

test('blocks git hook bypasses on Windows command execution', () => {
  const { runPreToolUse } = require(adapterPath);
  for (const command of ['git commit --no-verify -m test', 'git push --no-verify']) {
    const result = runPreToolUse(commandInput(command), { platform: 'win32' });
    assert.strictEqual(result.decision, 'deny');
    assert.match(result.reason, /hooks must not be bypassed/i);
  }
});

test('denies git hook bypasses without echoing the command', () => {
  const result = runAdapter(commandInput('git commit --no-verify -m do-not-reflect-this'));
  assert.strictEqual(result.status, 0, result.stderr);
  const output = JSON.parse(result.stdout);
  assert.strictEqual(output.decision, 'deny');
  assert.match(output.reason, /hooks must not be bypassed/i);
  assert.doesNotMatch(result.stdout, /do-not-reflect-this/);
});

test('denies destructive commands through GateGuard', () => {
  const stateDir = fs.mkdtempSync(path.join(os.tmpdir(), 'ecc-antigravity-gate-'));
  try {
    const result = runAdapter(commandInput('rm -rf /tmp/ecc-antigravity-target'), {
      GATEGUARD_STATE_DIR: stateDir,
    });
    assert.strictEqual(result.status, 0, result.stderr);
    assert.strictEqual(JSON.parse(result.stdout).decision, 'deny');
  } finally {
    fs.rmSync(stateDir, { recursive: true, force: true });
  }
});

test('fails closed when GateGuard cannot persist security state', () => {
  const result = runAdapter(commandInput('rm -rf /tmp/ecc-antigravity-target'), {
    GATEGUARD_STATE_DIR: path.join(os.devNull, 'unwritable-state'),
  });
  assert.strictEqual(result.status, 0, result.stderr);
  assert.deepStrictEqual(JSON.parse(result.stdout), {
    decision: 'deny',
    reason: 'ECC security policy could not complete this tool check.',
  });
});

test('fails closed when a security check exits non-zero without diagnostics', () => {
  const { parseDenyReason } = require(adapterPath);
  assert.strictEqual(
    parseDenyReason({ exitCode: 2, stderr: '' }),
    'ECC security policy denied this tool call.'
  );
});

test('fails closed when a security check emits malformed JSON', () => {
  const { parseDenyReason } = require(adapterPath);
  assert.strictEqual(
    parseDenyReason({ exitCode: 0, stdout: '{not-json' }),
    'ECC security policy could not complete this tool check.'
  );
});

test('denies edits to an existing protected config', () => {
  const projectDir = fs.mkdtempSync(path.join(os.tmpdir(), 'ecc-antigravity-write-'));
  const configPath = path.join(projectDir, 'eslint.config.js');
  fs.writeFileSync(configPath, 'module.exports = {};\n');
  try {
    const result = runAdapter({
      toolCall: {
        name: 'replace_file_content',
        args: {
          TargetFile: configPath,
          TargetContent: 'module.exports = {};',
          ReplacementContent: 'unsafe',
        },
      },
      conversationId: `antigravity-hook-${process.pid}`,
      workspacePaths: [projectDir],
    }, { GATEGUARD_BASH_ROUTINE_DISABLED: '1' });
    assert.strictEqual(result.status, 0, result.stderr);
    const output = JSON.parse(result.stdout);
    assert.strictEqual(output.decision, 'deny');
    assert.match(output.reason, /Modifying eslint.config.js is not allowed/);
  } finally {
    fs.rmSync(projectDir, { recursive: true, force: true });
  }
});

test('fails closed when a supported tool omits its required argument', () => {
  for (const input of [
    {},
    { toolCall: {} },
    { toolCall: { name: 'run_command', args: {} } },
    { toolCall: { name: 'run_command', args: { CommandLine: '   ' } } },
    { toolCall: { name: 'write_to_file', args: {} } },
    { toolCall: { name: 'write_to_file', args: { TargetFile: '/tmp/example' } } },
    {
      toolCall: {
        name: 'replace_file_content',
        args: { TargetFile: '/tmp/example', TargetContent: 'old' },
      },
    },
    {
      toolCall: {
        name: 'multi_replace_file_content',
        args: { TargetFile: '/tmp/example', ReplacementChunks: [] },
      },
    },
  ]) {
    const result = runAdapter(input);
    assert.strictEqual(result.status, 0, result.stderr);
    assert.strictEqual(JSON.parse(result.stdout).decision, 'deny');
  }
});

test('honors global and per-hook disable controls', () => {
  const command = commandInput('git push --no-verify');
  for (const env of [
    { ECC_HOOKS_ENABLED: 'false' },
    { ECC_DISABLED_HOOKS: 'pre:bash:block-no-verify' },
  ]) {
    const result = runAdapter(command, env);
    assert.strictEqual(result.status, 0, result.stderr);
    assert.deepStrictEqual(JSON.parse(result.stdout), { decision: 'ask' });
  }
});

test('allows unsupported tools without interpreting their arguments', () => {
  const result = runAdapter({
    toolCall: { name: 'view_file', args: { AbsolutePath: '/tmp/example' } },
  });
  assert.strictEqual(result.status, 0, result.stderr);
  assert.deepStrictEqual(JSON.parse(result.stdout), { decision: 'ask' });
});

test('fails closed on malformed and oversized input without reflecting secrets', () => {
  for (const input of ['{not-json sk-secret-value', 'x'.repeat(1024 * 1024 + 1)]) {
    const result = runAdapter(input);
    assert.strictEqual(result.status, 0, result.stderr);
    const output = JSON.parse(result.stdout);
    assert.strictEqual(output.decision, 'deny');
    assert.doesNotMatch(result.stdout, /sk-secret-value/);
  }
});

console.log(`\nPassed: ${passed}`);
console.log(`Failed: ${failed}`);
process.exit(failed > 0 ? 1 : 0);
