/**
 * Integration tests for hook scripts
 *
 * Tests hook behavior in realistic scenarios with proper input/output handling.
 *
 * Run with: node tests/integration/hooks.test.js
 */

const assert = require('assert');
const path = require('path');
const fs = require('fs');
const { spawn } = require('child_process');

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

/**
 * Run a hook script with simulated Claude Code input
 * @param {string} scriptPath - Path to the hook script
 * @param {object} input - Hook input object (will be JSON stringified)
 * @param {object} env - Environment variables
 * @returns {Promise<{code: number, stdout: string, stderr: string}>}
 */
function runHookWithInput(scriptPath, input = {}, env = {}, timeoutMs = 10000) {
  return new Promise((resolve, reject) => {
    const proc = spawn('node', [scriptPath], {
      env: { ...process.env, ...env },
      stdio: ['pipe', 'pipe', 'pipe']
    });

    let stdout = '';
    let stderr = '';

    proc.stdout.on('data', data => stdout += data);
    proc.stderr.on('data', data => stderr += data);

    // Ignore EPIPE errors (process may exit before we finish writing)
    proc.stdin.on('error', (err) => {
      if (err.code !== 'EPIPE') {
        reject(err);
      }
    });

    // Send JSON input on stdin (simulating Claude Code hook invocation)
    if (input && Object.keys(input).length > 0) {
      proc.stdin.write(JSON.stringify(input));
    }
    proc.stdin.end();

    const timer = setTimeout(() => {
      proc.kill('SIGKILL');
      reject(new Error(`Hook timed out after ${timeoutMs}ms`));
    }, timeoutMs);

    proc.on('close', code => {
      clearTimeout(timer);
      resolve({ code, stdout, stderr });
    });

    proc.on('error', err => {
      clearTimeout(timer);
      reject(err);
    });
  });
}

/**
 * Run an inline hook command (bun -e "..." or python3 -c "..." or node -e "...")
 * @param {string} command - The inline command
 * @param {object} input - Hook input object
 * @param {object} env - Environment variables
 */
function runInlineHook(command, input = {}, env = {}, timeoutMs = 10000) {
  return new Promise((resolve, reject) => {
    // Parse command: "bun -e '...'", "uv run python3 -c '...'",
    // "python3 -c '...'", or "node -e '...'"
    let runner, flag, code;
    const bunMatch = command.match(/^bun -e "(.+)"$/s);
    const nodeMatch = command.match(/^node -e "(.+)"$/s);
    const uvPythonMatch = command.match(/^uv run python3 -c "(.+)"$/s);
    const pythonMatch = command.match(/^python3 -c "(.+)"$/s);

    if (bunMatch) {
      // bun -e can also run as node -e for testing
      runner = 'node'; flag = '-e'; code = bunMatch[1];
    } else if (nodeMatch) {
      runner = 'node'; flag = '-e'; code = nodeMatch[1];
    } else if (uvPythonMatch) {
      runner = 'python3'; flag = '-c'; code = uvPythonMatch[1];
    } else if (pythonMatch) {
      runner = 'python3'; flag = '-c'; code = pythonMatch[1];
    } else {
      reject(new Error(`Unsupported inline hook command format: ${command.substring(0, 80)}...`));
      return;
    }

    const proc = spawn(runner, [flag, code], {
      env: { ...process.env, ...env },
      stdio: ['pipe', 'pipe', 'pipe']
    });

    let stdout = '';
    let stderr = '';
    let timer;

    proc.stdout.on('data', data => stdout += data);
    proc.stderr.on('data', data => stderr += data);

    // Ignore EPIPE errors (process may exit before we finish writing)
    proc.stdin.on('error', (err) => {
      if (err.code !== 'EPIPE') {
        if (timer) clearTimeout(timer);
        reject(err);
      }
    });

    if (input && Object.keys(input).length > 0) {
      proc.stdin.write(JSON.stringify(input));
    }
    proc.stdin.end();

    timer = setTimeout(() => {
      proc.kill('SIGKILL');
      reject(new Error(`Inline hook timed out after ${timeoutMs}ms`));
    }, timeoutMs);

    proc.on('close', code => {
      clearTimeout(timer);
      resolve({ code, stdout, stderr });
    });

    proc.on('error', err => {
      clearTimeout(timer);
      reject(err);
    });
  });
}

// Test suite
async function runTests() {
  console.log('\n=== Hook Integration Tests ===\n');

  let passed = 0;
  let failed = 0;

  const scriptsDir = path.join(__dirname, '..', '..', 'scripts', 'node', 'hooks');

  // Load hook definitions from split files
  const commonHooksPath = path.join(__dirname, '..', '..', 'hooks', 'common', 'hooks.json');
  const projectHooksPath = path.join(__dirname, '..', '..', 'hooks', 'node', 'project-hooks.json');
  const commonHooks = JSON.parse(fs.readFileSync(commonHooksPath, 'utf8'));
  const projectHooks = JSON.parse(fs.readFileSync(projectHooksPath, 'utf8'));

  // ==========================================
  // Input Format Tests
  // ==========================================
  console.log('Hook Input Format Handling:');

  if (await asyncTest('hooks handle empty stdin gracefully', async () => {
    const result = await runHookWithInput(path.join(scriptsDir, 'session-start.js'), {});
    assert.strictEqual(result.code, 0, `Should exit 0, got ${result.code}`);
  })) passed++; else failed++;

  if (await asyncTest('hooks handle malformed JSON input', async () => {
    const proc = spawn('node', [path.join(scriptsDir, 'session-start.js')], {
      stdio: ['pipe', 'pipe', 'pipe']
    });

    let code = null;
    proc.stdin.write('{ invalid json }');
    proc.stdin.end();

    await new Promise((resolve) => {
      proc.on('close', (c) => {
        code = c;
        resolve();
      });
    });

    // Hook should not crash on malformed input (exit 0)
    assert.strictEqual(code, 0, 'Should handle malformed JSON gracefully');
  })) passed++; else failed++;

  if (await asyncTest('hooks parse valid tool_input correctly', async () => {
    // Test parsing with a simple inline node script
    const proc = spawn('node', ['-e', "const fs=require('fs');let d='';process.stdin.on('data',c=>d+=c);process.stdin.on('end',()=>{const i=JSON.parse(d);const p=i.tool_input?.file_path||'';console.log('Path:',p)})"], {
      stdio: ['pipe', 'pipe', 'pipe']
    });

    let stdout = '';
    proc.stdout.on('data', data => stdout += data);

    proc.stdin.write(JSON.stringify({
      tool_input: { file_path: '/test/path.js' }
    }));
    proc.stdin.end();

    await new Promise(resolve => proc.on('close', resolve));

    assert.ok(stdout.includes('/test/path.js'), 'Should extract file_path from input');
  })) passed++; else failed++;

  // ==========================================
  // Output Format Tests
  // ==========================================
  console.log('\nHook Output Format:');

  if (await asyncTest('hooks output messages to stderr (not stdout)', async () => {
    const result = await runHookWithInput(path.join(scriptsDir, 'session-start.js'), {});
    // Session-start should write info to stderr
    assert.ok(result.stderr.length > 0, 'Should have stderr output');
    assert.ok(result.stderr.includes('[SessionStart]'), 'Should have [SessionStart] prefix');
  })) passed++; else failed++;

  if (await asyncTest('PreCompact hook logs to stderr', async () => {
    const result = await runHookWithInput(path.join(scriptsDir, 'pre-compact.js'), {});
    assert.ok(result.stderr.includes('[PreCompact]'), 'Should output to stderr with prefix');
  })) passed++; else failed++;

  if (await asyncTest('blocking hooks output BLOCKED message', async () => {
    // Test the dev server blocking hook from project-hooks.json.
    // Clear multiplexer env vars so the test is deterministic even when
    // the test runner itself is inside zellij/tmux.
    const blockingHook = projectHooks.hooks.PreToolUse[0];
    const result = await runInlineHook(blockingHook.hooks[0].command, {}, { ZELLIJ: '', TMUX: '' });

    assert.ok(result.stderr.includes('BLOCKED'), 'Blocking hook should output BLOCKED');
    // Claude Code only blocks a PreToolUse tool call on exit code 2;
    // exit 1 is a non-blocking error.
    assert.strictEqual(result.code, 2, 'Blocking hook should exit with code 2');
  })) passed++; else failed++;

  if (await asyncTest('dev server blocker passes inside a multiplexer', async () => {
    const blockingHook = projectHooks.hooks.PreToolUse[0];
    const result = await runInlineHook(blockingHook.hooks[0].command, {}, { ZELLIJ: '0' });

    assert.strictEqual(result.code, 0, 'Should not block inside zellij');
    assert.ok(!result.stderr.includes('BLOCKED'), 'Should not warn inside zellij');
  })) passed++; else failed++;

  // ==========================================
  // Exit Code Tests
  // ==========================================
  console.log('\nHook Exit Codes:');

  if (await asyncTest('non-blocking hooks exit with code 0', async () => {
    const result = await runHookWithInput(path.join(scriptsDir, 'session-end.js'), {});
    assert.strictEqual(result.code, 0, 'Non-blocking hook should exit 0');
  })) passed++; else failed++;

  if (await asyncTest('blocking hooks exit with code 2', async () => {
    // Only exit code 2 actually blocks the tool call in Claude Code.
    // Multiplexer env vars cleared for determinism.
    const blockingHook = projectHooks.hooks.PreToolUse[0];
    const result = await runInlineHook(blockingHook.hooks[0].command, {}, { ZELLIJ: '', TMUX: '' });

    assert.strictEqual(result.code, 2, 'Blocking hook should exit 2');
  })) passed++; else failed++;

  // ==========================================
  // Realistic Scenario Tests
  // ==========================================
  console.log('\nRealistic Scenarios:');

  if (await asyncTest('PostToolUse PR hook extracts PR URL', async () => {
    // Find the PR logging hook in common hooks
    const prHook = commonHooks.hooks.PostToolUse.find(h =>
      h.description && h.description.includes('PR URL')
    );

    assert.ok(prHook, 'PR hook should exist in common/hooks.json');

    const result = await runInlineHook(prHook.hooks[0].command, {
      tool_input: { command: 'gh pr create --title "Test"' },
      tool_output: { output: 'Creating pull request...\nhttps://github.com/owner/repo/pull/123' }
    });

    assert.ok(
      result.stderr.includes('PR created') || result.stderr.includes('github.com'),
      'Should extract and log PR URL'
    );
  })) passed++; else failed++;

  // ==========================================
  // Error Handling Tests
  // ==========================================
  console.log('\nError Handling:');

  if (await asyncTest('hooks do not crash on unexpected input structure', async () => {
    const result = await runHookWithInput(
      path.join(scriptsDir, 'session-end.js'),
      { unexpected: { nested: { deeply: 'value' } } }
    );

    assert.strictEqual(result.code, 0, 'Should handle unexpected input structure');
  })) passed++; else failed++;

  if (await asyncTest('hooks handle null and missing values in input', async () => {
    const result = await runHookWithInput(
      path.join(scriptsDir, 'session-start.js'),
      { tool_input: null }
    );

    assert.strictEqual(result.code, 0, 'Should handle null/missing values gracefully');
  })) passed++; else failed++;

  if (await asyncTest('hooks handle very large input without hanging', async () => {
    const largeInput = {
      tool_input: { file_path: '/test.js' },
      tool_output: { output: 'x'.repeat(100000) }
    };

    const startTime = Date.now();
    const result = await runHookWithInput(
      path.join(scriptsDir, 'session-start.js'),
      largeInput
    );
    const elapsed = Date.now() - startTime;

    assert.strictEqual(result.code, 0, 'Should complete successfully');
    assert.ok(elapsed < 5000, `Should complete in <5s, took ${elapsed}ms`);
  })) passed++; else failed++;

  // Summary
  console.log('\n=== Test Results ===');
  console.log(`Passed: ${passed}`);
  console.log(`Failed: ${failed}`);
  console.log(`Total:  ${passed + failed}\n`);

  process.exit(failed > 0 ? 1 : 0);
}

runTests();
