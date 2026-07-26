/**
 * Tests for hook scripts
 *
 * Run with: node tests/hooks/hooks.test.js
 */

const assert = require('assert');
const path = require('path');
const fs = require('fs');
const os = require('os');
const { spawn } = require('child_process');

// Test helper
function test(name, fn) {
  try {
    fn();
    console.log(`  ✓ ${name}`);
    return true;
  } catch (err) {
    console.log(`  ✗ ${name}`);
    console.log(`    Error: ${err.message}`);
    return false;
  }
}

// Async test helper
async function asyncTest(name, fn) {
  try {
    await fn();
    console.log(`  ✓ ${name}`);
    return true;
  } catch (err) {
    console.log(`  ✗ ${name}`);
    console.log(`    Error: ${err.message}`);
    return false;
  }
}

// Run a script and capture output
function runScript(scriptPath, input = '', env = {}) {
  return new Promise((resolve, reject) => {
    const proc = spawn('node', [scriptPath], {
      env: { ...process.env, ...env },
      stdio: ['pipe', 'pipe', 'pipe']
    });

    let stdout = '';
    let stderr = '';

    proc.stdout.on('data', data => stdout += data);
    proc.stderr.on('data', data => stderr += data);

    if (input) {
      proc.stdin.write(input);
    }
    proc.stdin.end();

    proc.on('close', code => {
      resolve({ code, stdout, stderr });
    });

    proc.on('error', reject);
  });
}

// Test suite
async function runTests() {
  console.log('\n=== Testing Hook Scripts ===\n');

  let passed = 0;
  let failed = 0;

  const scriptsDir = path.join(__dirname, '..', '..', 'scripts', 'node', 'hooks');

  // session-start.js tests
  console.log('session-start.js:');

  if (await asyncTest('runs without error', async () => {
    const result = await runScript(path.join(scriptsDir, 'session-start.js'));
    assert.strictEqual(result.code, 0, `Exit code should be 0, got ${result.code}`);
  })) passed++; else failed++;

  if (await asyncTest('outputs session info to stderr', async () => {
    const result = await runScript(path.join(scriptsDir, 'session-start.js'));
    assert.ok(
      result.stderr.includes('[SessionStart]') ||
      result.stderr.includes('Package manager'),
      'Should output session info'
    );
  })) passed++; else failed++;

  // session-end.js tests
  console.log('\nsession-end.js:');

  if (await asyncTest('runs without error', async () => {
    const result = await runScript(path.join(scriptsDir, 'session-end.js'));
    assert.strictEqual(result.code, 0, `Exit code should be 0, got ${result.code}`);
  })) passed++; else failed++;

  if (await asyncTest('creates or updates session file', async () => {
    // Run the script
    await runScript(path.join(scriptsDir, 'session-end.js'));

    // Check if session file was created
    const sessionsDir = path.join(os.homedir(), '.claude', 'sessions');
    const now = new Date();
    const today = `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, '0')}-${String(now.getDate()).padStart(2, '0')}`;

    // Get the expected session ID (project name fallback)
    const utils = require('../../scripts/node/lib/utils');
    const expectedId = utils.getSessionIdShort();
    const sessionFile = path.join(sessionsDir, `${today}-${expectedId}-session.tmp`);

    assert.ok(fs.existsSync(sessionFile), `Session file should exist: ${sessionFile}`);
  })) passed++; else failed++;

  if (await asyncTest('includes session ID in filename', async () => {
    const testSessionId = 'test-session-abc12345';
    const expectedShortId = 'abc12345'; // Last 8 chars

    // Run with custom session ID
    await runScript(path.join(scriptsDir, 'session-end.js'), '', {
      CLAUDE_SESSION_ID: testSessionId
    });

    // Check if session file was created with session ID
    const sessionsDir = path.join(os.homedir(), '.claude', 'sessions');
    const now = new Date();
    const today = `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, '0')}-${String(now.getDate()).padStart(2, '0')}`;
    const sessionFile = path.join(sessionsDir, `${today}-${expectedShortId}-session.tmp`);

    assert.ok(fs.existsSync(sessionFile), `Session file should exist: ${sessionFile}`);
  })) passed++; else failed++;

  // pre-compact.js tests
  console.log('\npre-compact.js:');

  if (await asyncTest('runs without error', async () => {
    const result = await runScript(path.join(scriptsDir, 'pre-compact.js'));
    assert.strictEqual(result.code, 0, `Exit code should be 0, got ${result.code}`);
  })) passed++; else failed++;

  if (await asyncTest('outputs PreCompact message', async () => {
    const result = await runScript(path.join(scriptsDir, 'pre-compact.js'));
    assert.ok(result.stderr.includes('[PreCompact]'), 'Should output PreCompact message');
  })) passed++; else failed++;

  if (await asyncTest('creates compaction log', async () => {
    await runScript(path.join(scriptsDir, 'pre-compact.js'));
    const logFile = path.join(os.homedir(), '.claude', 'sessions', 'compaction-log.txt');
    assert.ok(fs.existsSync(logFile), 'Compaction log should exist');
  })) passed++; else failed++;

  // hooks JSON validation (common + node global hooks)
  console.log('\ncommon/hooks.json Validation:');

  const commonHooksPath = path.join(__dirname, '..', '..', 'hooks', 'common', 'hooks.json');

  if (test('common/hooks.json is valid JSON', () => {
    const content = fs.readFileSync(commonHooksPath, 'utf8');
    JSON.parse(content); // Will throw if invalid
  })) passed++; else failed++;

  if (test('common/hooks.json has PreToolUse and PostToolUse hooks', () => {
    const hooks = JSON.parse(fs.readFileSync(commonHooksPath, 'utf8'));
    assert.ok(hooks.hooks.PreToolUse, 'Should have PreToolUse hooks');
    assert.ok(hooks.hooks.PostToolUse, 'Should have PostToolUse hooks');
  })) passed++; else failed++;

  console.log('\nnode/global-hooks.json Validation:');

  const nodeHooksPath = path.join(__dirname, '..', '..', 'hooks', 'node', 'global-hooks.json');

  if (test('node/global-hooks.json is valid JSON', () => {
    const content = fs.readFileSync(nodeHooksPath, 'utf8');
    JSON.parse(content); // Will throw if invalid
  })) passed++; else failed++;

  if (test('node/global-hooks.json has required event types', () => {
    const hooks = JSON.parse(fs.readFileSync(nodeHooksPath, 'utf8'));
    assert.ok(hooks.hooks.SessionStart, 'Should have SessionStart hooks');
    assert.ok(hooks.hooks.SessionEnd, 'Should have SessionEnd hooks');
    assert.ok(hooks.hooks.PreCompact, 'Should have PreCompact hooks');
  })) passed++; else failed++;

  if (test('node/global-hooks.json commands use bun with safety wrapper', () => {
    const hooks = JSON.parse(fs.readFileSync(nodeHooksPath, 'utf8'));

    const checkHooks = (hookArray) => {
      for (const entry of hookArray) {
        for (const hook of entry.hooks) {
          if (hook.type === 'command') {
            assert.ok(
              hook.command.includes('bun') || hook.command.startsWith('command -v bun'),
              `Hook command should use bun: ${hook.command.substring(0, 50)}...`
            );
          }
        }
      }
    };

    for (const [, hookArray] of Object.entries(hooks.hooks)) {
      checkHooks(hookArray);
    }
  })) passed++; else failed++;

  if (test('node/global-hooks.json script references use CLAUDE_PLUGIN_ROOT variable', () => {
    const hooks = JSON.parse(fs.readFileSync(nodeHooksPath, 'utf8'));

    const checkHooks = (hookArray) => {
      for (const entry of hookArray) {
        for (const hook of entry.hooks) {
          if (hook.type === 'command' && hook.command.includes('scripts/node/hooks/')) {
            const hasPluginRoot = hook.command.includes('${CLAUDE_PLUGIN_ROOT}');
            assert.ok(
              hasPluginRoot,
              `Script paths should use CLAUDE_PLUGIN_ROOT: ${hook.command.substring(0, 80)}...`
            );
          }
        }
      }
    };

    for (const [, hookArray] of Object.entries(hooks.hooks)) {
      checkHooks(hookArray);
    }
  })) passed++; else failed++;

  // plugin.json validation
  console.log('\nplugin.json Validation:');

  if (test('plugin.json does NOT have explicit hooks declaration', () => {
    const pluginPath = path.join(__dirname, '..', '..', '.claude-plugin', 'plugin.json');
    const plugin = JSON.parse(fs.readFileSync(pluginPath, 'utf8'));

    assert.ok(
      !plugin.hooks,
      'plugin.json should NOT have "hooks" field - Claude Code auto-loads hooks/hooks.json'
    );
  })) passed++; else failed++;

  if (test('plugin.json component paths match nested repository layout', () => {
    const rootDir = path.join(__dirname, '..', '..');
    const pluginPath = path.join(rootDir, '.claude-plugin', 'plugin.json');
    const plugin = JSON.parse(fs.readFileSync(pluginPath, 'utf8'));

    assert.deepStrictEqual(plugin.commands, ['./commands/']);
    assert.deepStrictEqual(plugin.skills, ['./skills/']);

    for (const agentPath of plugin.agents) {
      assert.ok(
        fs.existsSync(path.join(rootDir, agentPath)),
        `Agent path should exist: ${agentPath}`
      );
      assert.ok(
        agentPath.split('/').length > 3,
        `Agent path should use nested language/common layout: ${agentPath}`
      );
    }
  })) passed++; else failed++;

  // Summary
  console.log('\n=== Test Results ===');
  console.log(`Passed: ${passed}`);
  console.log(`Failed: ${failed}`);
  console.log(`Total:  ${passed + failed}\n`);

  process.exit(failed > 0 ? 1 : 0);
}

runTests();
