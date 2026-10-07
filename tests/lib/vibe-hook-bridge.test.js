/**
 * Tests for scripts/hooks/vibe-hook-bridge.js
 */

const assert = require('assert');
const fs = require('fs');
const os = require('os');
const path = require('path');
const { spawnSync } = require('child_process');

const REPO_ROOT = path.join(__dirname, '..', '..');
const BRIDGE_SCRIPT = path.join(REPO_ROOT, 'scripts', 'hooks', 'vibe-hook-bridge.js');
const {
  buildClaudePayload,
  translateRunnerJson,
} = require('../../scripts/hooks/vibe-hook-bridge');

function test(name, fn) {
  try {
    fn();
    console.log(`  \u2713 ${name}`);
    return true;
  } catch (error) {
    console.log(`  \u2717 ${name}`);
    console.log(`    Error: ${error.message}`);
    return false;
  }
}

function runBridge(payloadJson, runnerScript, env = {}) {
  return spawnSync(process.execPath, [BRIDGE_SCRIPT, runnerScript], {
    input: payloadJson,
    encoding: 'utf8',
    env: { ...process.env, ...env },
    timeout: 30_000,
  });
}

function writeTempRunner(body) {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'ecc-vibe-bridge-'));
  const runner = path.join(dir, 'stub-runner.js');
  fs.writeFileSync(runner, body);
  return { dir, runner };
}

function runTests() {
  console.log('\n=== Testing the Vibe hook bridge ===\n');

  let passed = 0;
  let failed = 0;

  if (test('maps Vibe events and tool names to the Claude Code protocol', () => {
    const payload = buildClaudePayload({
      hook_event_name: 'pre_tool',
      tool_name: 'bash',
      tool_input: { command: 'git status' },
      session_id: 's1',
      cwd: '/repo',
    });
    assert.strictEqual(payload.hook_event_name, 'PreToolUse');
    assert.strictEqual(payload.tool_name, 'Bash');
    assert.strictEqual(payload.tool_input.command, 'git status');
    assert.strictEqual(payload.cwd, '/repo');
  })) passed++; else failed++;

  if (test('aliases file_path from path for file tools', () => {
    const payload = buildClaudePayload({
      hook_event_name: 'pre_tool',
      tool_name: 'write_file',
      tool_input: { path: '/repo/README.md', content: 'hello' },
    });
    assert.strictEqual(payload.tool_name, 'Write');
    assert.strictEqual(payload.tool_input.file_path, '/repo/README.md');
    assert.strictEqual(payload.tool_input.path, '/repo/README.md');
  })) passed++; else failed++;

  if (test('passes unknown tool names through unchanged', () => {
    const payload = buildClaudePayload({
      hook_event_name: 'pre_tool',
      tool_name: 'custom_thing',
      tool_input: {},
    });
    assert.strictEqual(payload.tool_name, 'custom_thing');
  })) passed++; else failed++;

  if (test('translates Claude Code deny decisions to Vibe denials', () => {
    let emitted = null;
    const originalWrite = process.stdout.write;
    const originalExit = Object.getOwnPropertyDescriptor(process, 'exitCode');
    process.stdout.write = chunk => { emitted = chunk; };
    try {
      const handled = translateRunnerJson({
        hookSpecificOutput: {
          hookEventName: 'PreToolUse',
          permissionDecision: 'deny',
          permissionDecisionReason: 'destructive command',
        },
      }, 'pre_tool');
      assert.strictEqual(handled, true);
      const vibeJson = JSON.parse(emitted);
      assert.strictEqual(vibeJson.decision, 'deny');
      assert.strictEqual(vibeJson.reason, 'destructive command');
    } finally {
      process.stdout.write = originalWrite;
      if (originalExit) Object.defineProperty(process, 'exitCode', originalExit);
    }
  })) passed++; else failed++;

  if (test('translates additional context to a post_tool hook_specific_output', () => {
    let emitted = null;
    const originalWrite = process.stdout.write;
    process.stdout.write = chunk => { emitted = chunk; };
    try {
      const handled = translateRunnerJson({
        hookSpecificOutput: { additionalContext: 'log audit note' },
      }, 'post_tool');
      assert.strictEqual(handled, true);
      const vibeJson = JSON.parse(emitted);
      assert.strictEqual(vibeJson.decision, 'allow');
      assert.strictEqual(vibeJson.hook_specific_output.additional_context, 'log audit note');
    } finally {
      process.stdout.write = originalWrite;
    }
  })) passed++; else failed++;

  if (test('returns unhandled for JSON with no Vibe-relevant fields', () => {
    const handled = translateRunnerJson({ hookSpecificOutput: { hookEventName: 'PreToolUse' } }, 'pre_tool');
    assert.strictEqual(handled, false);
  })) passed++; else failed++;

  if (test('converts runner exit 2 into a structured Vibe deny', () => {
    const { dir, runner } = writeTempRunner(
      "process.stderr.write('blocked: --no-verify is not allowed\\n'); process.exit(2);\n"
    );
    try {
      const result = runBridge(
        JSON.stringify({ hook_event_name: 'pre_tool', tool_name: 'bash', tool_input: { command: 'git push --no-verify' }, cwd: dir }),
        runner,
        { PLUGIN_ROOT: dir }
      );
      assert.strictEqual(result.status, 0, `bridge should exit 0, stderr: ${result.stderr}`);
      const vibeJson = JSON.parse(result.stdout);
      assert.strictEqual(vibeJson.decision, 'deny');
      assert.match(vibeJson.reason, /--no-verify/);
    } finally {
      fs.rmSync(dir, { recursive: true, force: true });
    }
  })) passed++; else failed++;

  if (test('passes runner exit 0 additional context through as a system message', () => {
    const { dir, runner } = writeTempRunner(
      "process.stdout.write(JSON.stringify({ hookSpecificOutput: { hookEventName: 'PreToolUse', additionalContext: 'doc file warning' } }));\n"
    );
    try {
      const result = runBridge(
        JSON.stringify({ hook_event_name: 'pre_tool', tool_name: 'write_file', tool_input: { path: 'README.md' }, cwd: dir }),
        runner,
        { PLUGIN_ROOT: dir }
      );
      assert.strictEqual(result.status, 0);
      const vibeJson = JSON.parse(result.stdout);
      assert.strictEqual(vibeJson.decision, 'allow');
      assert.strictEqual(vibeJson.system_message, 'doc file warning');
    } finally {
      fs.rmSync(dir, { recursive: true, force: true });
    }
  })) passed++; else failed++;

  if (test('surfaces runner crashes through the fail-open path', () => {
    const { dir, runner } = writeTempRunner("throw new Error('boom');\n");
    try {
      const result = runBridge(
        JSON.stringify({ hook_event_name: 'pre_tool', tool_name: 'bash', tool_input: {}, cwd: dir }),
        runner,
        { PLUGIN_ROOT: dir }
      );
      assert.strictEqual(result.status, 1, 'non-block failures must use the Vibe failure path');
      assert.strictEqual(result.stdout, '', 'failure path must not emit control JSON');
    } finally {
      fs.rmSync(dir, { recursive: true, force: true });
    }
  })) passed++; else failed++;

  if (test('denies when the real pre-bash dispatcher sees --no-verify', () => {
    // End-to-end against the shipped runner: the bridge resolves the runner
    // relative to PLUGIN_ROOT, exactly like a Vibe plugin hook does.
    const pluginRoot = path.join(REPO_ROOT, 'vibe', 'core');
    const result = runBridge(
      JSON.stringify({
        hook_event_name: 'pre_tool',
        tool_name: 'bash',
        tool_input: { command: 'git commit --no-verify -m test' },
        cwd: pluginRoot,
      }),
      'scripts/hooks/pre-bash-dispatcher.js',
      { PLUGIN_ROOT: pluginRoot }
    );
    assert.strictEqual(result.status, 0, `stderr: ${result.stderr}`);
    const vibeJson = JSON.parse(result.stdout);
    assert.strictEqual(vibeJson.decision, 'deny');
    assert.match(vibeJson.reason, /--no-verify|no-verify|verify/i);
  })) passed++; else failed++;

  console.log(`\nResults: Passed: ${passed}, Failed: ${failed}`);
  process.exit(failed > 0 ? 1 : 0);
}

runTests();
