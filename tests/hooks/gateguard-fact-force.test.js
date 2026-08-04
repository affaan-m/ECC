/**
 * Tests for scripts/hooks/gateguard-fact-force.js via run-with-flags.js
 */

const assert = require('assert');
const fs = require('fs');
const path = require('path');
const { spawnSync } = require('child_process');

const runner = path.join(__dirname, '..', '..', 'scripts', 'hooks', 'run-with-flags.js');
const hookScript = path.join(__dirname, '..', '..', 'scripts', 'hooks', 'gateguard-fact-force.js');
const externalStateDir = process.env.GATEGUARD_STATE_DIR;
const tmpRoot = process.env.TMPDIR || process.env.TEMP || process.env.TMP || '/tmp';
const baseStateDir = externalStateDir || tmpRoot;
const stateDir = fs.mkdtempSync(path.join(baseStateDir, 'gateguard-test-'));
// Use a fixed session ID so test process and spawned hook process share the same state file
const TEST_SESSION_ID = 'gateguard-test-session';
const stateFile = path.join(stateDir, `state-${TEST_SESSION_ID}.json`);
const READ_HEARTBEAT_MS = 60 * 1000;

function test(name, fn) {
  try {
    fn();
    console.log(`  ✓ ${name}`);
    return true;
  } catch (error) {
    console.log(`  ✗ ${name}`);
    console.log(`    Error: ${error.message}`);
    return false;
  }
}

function clearState() {
  try {
    if (fs.existsSync(stateDir)) {
      fs.rmSync(stateDir, { recursive: true, force: true });
    }
    fs.mkdirSync(stateDir, { recursive: true });
  } catch (err) {
    console.error(`  [clearState] failed to remove state files in ${stateDir}: ${err.message}`);
  }
}

function writeExpiredState() {
  try {
    fs.mkdirSync(stateDir, { recursive: true });
    const expired = {
      checked: ['some_file.js', '__bash_session__'],
      last_active: Date.now() - 31 * 60 * 1000 // 31 minutes ago
    };
    fs.writeFileSync(stateFile, JSON.stringify(expired), 'utf8');
  } catch (_) {
    /* ignore */
  }
}

function writeState(state) {
  fs.mkdirSync(stateDir, { recursive: true });
  fs.writeFileSync(stateFile, JSON.stringify(state), 'utf8');
}

function runHook(input, env = {}) {
  const rawInput = typeof input === 'string' ? input : JSON.stringify(input);
  const result = spawnSync('node', [runner, 'pre:edit-write:gateguard-fact-force', 'scripts/hooks/gateguard-fact-force.js', 'standard,strict'], {
    input: rawInput,
    encoding: 'utf8',
    env: {
      ...process.env,
      ECC_HOOK_PROFILE: 'standard',
      GATEGUARD_STATE_DIR: stateDir,
      CLAUDE_SESSION_ID: TEST_SESSION_ID,
      ...env
    },
    timeout: 15000,
    stdio: ['pipe', 'pipe', 'pipe']
  });

  return {
    code: Number.isInteger(result.status) ? result.status : 1,
    stdout: result.stdout || '',
    stderr: result.stderr || ''
  };
}

function runBashHook(input, env = {}) {
  const rawInput = typeof input === 'string' ? input : JSON.stringify(input);
  const result = spawnSync('node', [runner, 'pre:bash:gateguard-fact-force', 'scripts/hooks/gateguard-fact-force.js', 'standard,strict'], {
    input: rawInput,
    encoding: 'utf8',
    env: {
      ...process.env,
      ECC_HOOK_PROFILE: 'standard',
      GATEGUARD_STATE_DIR: stateDir,
      CLAUDE_SESSION_ID: TEST_SESSION_ID,
      ...env
    },
    timeout: 15000,
    stdio: ['pipe', 'pipe', 'pipe']
  });

  return {
    code: Number.isInteger(result.status) ? result.status : 1,
    stdout: result.stdout || '',
    stderr: result.stderr || ''
  };
}

function parseOutput(stdout) {
  try {
    return JSON.parse(stdout);
  } catch (_) {
    return null;
  }
}

function loadDirectHook(env = {}) {
  delete require.cache[require.resolve(hookScript)];
  Object.assign(process.env, {
    GATEGUARD_STATE_DIR: stateDir,
    CLAUDE_SESSION_ID: TEST_SESSION_ID,
    ...env
  });
  return require(hookScript);
}

function runTests() {
  console.log('\n=== Testing gateguard-fact-force ===\n');

  let passed = 0;
  let failed = 0;

  // --- Test 1: denies first Edit per file ---
  clearState();
  if (
    test('denies first Edit per file with fact-forcing message', () => {
      const input = {
        tool_name: 'Edit',
        tool_input: { file_path: '/src/app.js', old_string: 'foo', new_string: 'bar' }
      };
      const result = runHook(input);
      assert.strictEqual(result.code, 0, 'exit code should be 0');
      const output = parseOutput(result.stdout);
      assert.ok(output, 'should produce JSON output');
      assert.strictEqual(output.hookSpecificOutput.permissionDecision, 'deny');
      assert.ok(output.hookSpecificOutput.permissionDecisionReason.includes('Fact-Forcing Gate'));
      assert.ok(output.hookSpecificOutput.permissionDecisionReason.includes('import/require'));
      assert.ok(output.hookSpecificOutput.permissionDecisionReason.includes('/src/app.js'));
    })
  )
    passed++;
  else failed++;

  // --- Test 2: allows second Edit on same file ---
  if (
    test('allows second Edit on same file (gate already passed)', () => {
      const input = {
        tool_name: 'Edit',
        tool_input: { file_path: '/src/app.js', old_string: 'foo', new_string: 'bar' }
      };
      const result = runHook(input);
      assert.strictEqual(result.code, 0, 'exit code should be 0');
      const output = parseOutput(result.stdout);
      assert.ok(output, 'should produce valid JSON output');
      // When allowed, the hook passes through the raw input (no hookSpecificOutput)
      // OR if hookSpecificOutput exists, it must not be deny
      if (output.hookSpecificOutput) {
        assert.notStrictEqual(output.hookSpecificOutput.permissionDecision, 'deny', 'should not deny second edit on same file');
      } else {
        // Pass-through: output matches original input (allow)
        assert.strictEqual(output.tool_name, 'Edit', 'pass-through should preserve input');
      }
    })
  )
    passed++;
  else failed++;

  // --- Test 3: denies first Write per file ---
  clearState();
  if (
    test('denies first Write per file with fact-forcing message', () => {
      const input = {
        tool_name: 'Write',
        tool_input: { file_path: '/src/new-file.js', content: 'console.log("hello")' }
      };
      const result = runHook(input);
      assert.strictEqual(result.code, 0, 'exit code should be 0');
      const output = parseOutput(result.stdout);
      assert.ok(output, 'should produce JSON output');
      assert.strictEqual(output.hookSpecificOutput.permissionDecision, 'deny');
      assert.ok(output.hookSpecificOutput.permissionDecisionReason.includes('creating'));
      assert.ok(output.hookSpecificOutput.permissionDecisionReason.includes('call this new file'));
    })
  )
    passed++;
  else failed++;

  // --- Test 3b: fails open when retry state cannot be persisted ---
  clearState();
  if (
    test('fails open with warning when state path cannot be persisted', () => {
      const invalidStateDir = path.join(stateDir, 'not-a-directory');
      fs.writeFileSync(invalidStateDir, 'not a directory', 'utf8');

      const input = {
        tool_name: 'Write',
        tool_input: { file_path: '/src/state-failure.js', content: 'module.exports = {};' }
      };
      const result = runHook(input, { GATEGUARD_STATE_DIR: invalidStateDir });
      assert.strictEqual(result.code, 0, 'exit code should be 0');
      const output = parseOutput(result.stdout);
      assert.ok(output, 'should produce valid JSON output');
      if (output.hookSpecificOutput) {
        assert.notStrictEqual(output.hookSpecificOutput.permissionDecision, 'deny', 'unpersistable state must not deny a retry that can never be recorded');
      } else {
        assert.strictEqual(output.tool_name, 'Write', 'pass-through should preserve input');
      }
      assert.ok(result.stderr.includes('GateGuard state could not be persisted'), 'should warn that state persistence failed');
    })
  )
    passed++;
  else failed++;

  // --- Test 4: denies destructive Bash, allows retry ---
  clearState();
  if (
    test('denies destructive Bash commands, allows retry after facts presented', () => {
      const input = {
        tool_name: 'Bash',
        tool_input: { command: 'rm -rf /important/data' }
      };

      // First call: should deny
      const result1 = runBashHook(input);
      assert.strictEqual(result1.code, 0, 'first call exit code should be 0');
      const output1 = parseOutput(result1.stdout);
      assert.ok(output1, 'first call should produce JSON output');
      assert.strictEqual(output1.hookSpecificOutput.permissionDecision, 'deny');
      assert.ok(output1.hookSpecificOutput.permissionDecisionReason.includes('Destructive'));
      assert.ok(output1.hookSpecificOutput.permissionDecisionReason.includes('rollback'));

      // Second call (retry after facts presented): should allow
      const result2 = runBashHook(input);
      assert.strictEqual(result2.code, 0, 'second call exit code should be 0');
      const output2 = parseOutput(result2.stdout);
      assert.ok(output2, 'second call should produce valid JSON output');
      if (output2.hookSpecificOutput) {
        assert.notStrictEqual(output2.hookSpecificOutput.permissionDecision, 'deny', 'should not deny destructive bash retry after facts presented');
      } else {
        assert.strictEqual(output2.tool_name, 'Bash', 'pass-through should preserve input');
      }
    })
  )
    passed++;
  else failed++;

  // --- Test 5: denies first routine Bash, allows second ---
  clearState();
  if (
    test('allows safe git push --force-with-lease without destructive gate', () => {
      writeState({
        checked: ['__bash_session__'],
        last_active: Date.now()
      });

      const input = {
        tool_name: 'Bash',
        tool_input: { command: 'git push --force-with-lease origin feature-branch' }
      };
      const result = runBashHook(input);
      assert.strictEqual(result.code, 0, 'exit code should be 0');
      const output = parseOutput(result.stdout);
      assert.ok(output, 'should produce valid JSON output');
      if (output.hookSpecificOutput) {
        assert.notStrictEqual(output.hookSpecificOutput.permissionDecision, 'deny', 'safe lease-protected force push should not be denied');
      } else {
        assert.strictEqual(output.tool_name, 'Bash', 'pass-through should preserve input');
      }
    })
  )
    passed++;
  else failed++;

  // --- Test 6: gates amend as destructive Bash ---
  clearState();
  if (
    test('denies git commit --amend as destructive Bash', () => {
      const input = {
        tool_name: 'Bash',
        tool_input: { command: 'git commit --amend --no-edit' }
      };
      const result = runBashHook(input);
      assert.strictEqual(result.code, 0, 'exit code should be 0');
      const output = parseOutput(result.stdout);
      assert.ok(output, 'should produce JSON output');
      assert.strictEqual(output.hookSpecificOutput.permissionDecision, 'deny');
      assert.ok(output.hookSpecificOutput.permissionDecisionReason.includes('Destructive'));
      assert.ok(output.hookSpecificOutput.permissionDecisionReason.includes('rollback'));
    })
  )
    passed++;
  else failed++;

  // --- Test 7: still gates plain force push as destructive Bash ---
  clearState();
  if (
    test('denies plain git push --force as destructive Bash', () => {
      const input = {
        tool_name: 'Bash',
        tool_input: { command: 'git push --force origin feature-branch' }
      };
      const result = runBashHook(input);
      assert.strictEqual(result.code, 0, 'exit code should be 0');
      const output = parseOutput(result.stdout);
      assert.ok(output, 'should produce JSON output');
      assert.strictEqual(output.hookSpecificOutput.permissionDecision, 'deny');
      assert.ok(output.hookSpecificOutput.permissionDecisionReason.includes('Destructive'));
      assert.ok(output.hookSpecificOutput.permissionDecisionReason.includes('rollback'));
    })
  )
    passed++;
  else failed++;

  /**
   * Test 7b: `git checkout -f <branch>` (force checkout) discards uncommitted
   * working-tree changes, so it must be gated as destructive Bash.
   */
  clearState();
  if (
    test('denies git checkout -f as destructive Bash', () => {
      const input = {
        tool_name: 'Bash',
        tool_input: { command: 'git checkout -f main' }
      };
      const result = runBashHook(input);
      assert.strictEqual(result.code, 0, 'exit code should be 0');
      const output = parseOutput(result.stdout);
      assert.ok(output, 'should produce JSON output');
      assert.strictEqual(output.hookSpecificOutput.permissionDecision, 'deny');
      assert.ok(output.hookSpecificOutput.permissionDecisionReason.includes('Destructive'));
      assert.ok(output.hookSpecificOutput.permissionDecisionReason.includes('rollback'));
    })
  )
    passed++;
  else failed++;

  // --- Test 8: denies first routine Bash, allows second ---
  clearState();
  if (
    test('denies first routine Bash, allows second', () => {
      const input = {
        tool_name: 'Bash',
        tool_input: { command: 'ls -la' }
      };

      // First call: should deny
      const result1 = runBashHook(input);
      assert.strictEqual(result1.code, 0, 'first call exit code should be 0');
      const output1 = parseOutput(result1.stdout);
      assert.ok(output1, 'first call should produce JSON output');
      assert.strictEqual(output1.hookSpecificOutput.permissionDecision, 'deny');

      // Second call: should allow
      const result2 = runBashHook(input);
      assert.strictEqual(result2.code, 0, 'second call exit code should be 0');
      const output2 = parseOutput(result2.stdout);
      assert.ok(output2, 'second call should produce valid JSON output');
      if (output2.hookSpecificOutput) {
        assert.notStrictEqual(output2.hookSpecificOutput.permissionDecision, 'deny', 'should not deny second routine bash');
      } else {
        assert.strictEqual(output2.tool_name, 'Bash', 'pass-through should preserve input');
      }
    })
  )
    passed++;
  else failed++;

  // --- Test 6: session state resets after timeout ---
  if (
    test('session state resets after 30-minute timeout', () => {
      writeExpiredState();
      const input = {
        tool_name: 'Edit',
        tool_input: { file_path: 'some_file.js', old_string: 'a', new_string: 'b' }
      };
      const result = runHook(input);
      assert.strictEqual(result.code, 0, 'exit code should be 0');
      const output = parseOutput(result.stdout);
      assert.ok(output, 'should produce JSON output after expired state');
      assert.strictEqual(output.hookSpecificOutput.permissionDecision, 'deny', 'should deny again after session timeout (state was reset)');
    })
  )
    passed++;
  else failed++;

  // --- Test 7: allows unknown tool names ---
  clearState();
  if (
    test('allows unknown tool names through', () => {
      const input = {
        tool_name: 'Read',
        tool_input: { file_path: '/src/app.js' }
      };
      const result = runHook(input);
      assert.strictEqual(result.code, 0, 'exit code should be 0');
      const output = parseOutput(result.stdout);
      assert.ok(output, 'should produce valid JSON output');
      if (output.hookSpecificOutput) {
        assert.notStrictEqual(output.hookSpecificOutput.permissionDecision, 'deny', 'should not deny unknown tool');
      } else {
        assert.strictEqual(output.tool_name, 'Read', 'pass-through should preserve input');
      }
    })
  )
    passed++;
  else failed++;

  // --- Test 8: sanitizes file paths with newlines ---
  clearState();
  if (
    test('sanitizes file paths containing newlines', () => {
      const input = {
        tool_name: 'Edit',
        tool_input: { file_path: '/src/app.js\ninjected content', old_string: 'a', new_string: 'b' }
      };
      const result = runHook(input);
      assert.strictEqual(result.code, 0, 'exit code should be 0');
      const output = parseOutput(result.stdout);
      assert.ok(output, 'should produce JSON output');
      assert.strictEqual(output.hookSpecificOutput.permissionDecision, 'deny');
      const reason = output.hookSpecificOutput.permissionDecisionReason;
      // The file path portion of the reason must not contain any raw newlines
      // (sanitizePath replaces \n and \r with spaces)
      const pathLine = reason.split('\n').find(l => l.includes('/src/app.js'));
      assert.ok(pathLine, 'reason should mention the file path');
      assert.ok(!pathLine.includes('\n'), 'file path line must not contain raw newlines');
      assert.ok(!reason.includes('/src/app.js\n'), 'newline after file path should be sanitized');
      assert.ok(!reason.includes('\ninjected'), 'injected content must not appear on its own line');
    })
  )
    passed++;
  else failed++;

  // --- Test 9: respects ECC_DISABLED_HOOKS ---
  clearState();
  if (
    test('respects ECC_DISABLED_HOOKS (skips when disabled)', () => {
      const input = {
        tool_name: 'Edit',
        tool_input: { file_path: '/src/disabled.js', old_string: 'a', new_string: 'b' }
      };
      const result = runHook(input, {
        ECC_DISABLED_HOOKS: 'pre:edit-write:gateguard-fact-force'
      });

      assert.strictEqual(result.code, 0, 'exit code should be 0');
      const output = parseOutput(result.stdout);
      assert.ok(output, 'should produce valid JSON output');
      if (output.hookSpecificOutput) {
        assert.notStrictEqual(output.hookSpecificOutput.permissionDecision, 'deny', 'should not deny when hook is disabled');
      } else {
        // When disabled, hook passes through raw input
        assert.strictEqual(output.tool_name, 'Edit', 'pass-through should preserve input');
      }
    })
  )
    passed++;
  else failed++;

  // --- Test 10: respects direct GateGuard env disable for recovery sessions ---
  clearState();
  if (
    test('respects ECC_GATEGUARD=off without writing gate state', () => {
      const input = {
        tool_name: 'Write',
        tool_input: { file_path: '/src/env-disabled.js', content: 'export const ok = true;' }
      };
      const result = runHook(input, { ECC_GATEGUARD: 'off' });
      const output = parseOutput(result.stdout);

      assert.ok(output, 'should produce valid JSON output');
      assert.strictEqual(output.tool_name, 'Write', 'disabled gate should pass through raw input');
      assert.ok(!output.hookSpecificOutput, 'disabled gate should not deny the operation');
      assert.ok(!fs.existsSync(stateFile), 'disabled gate should not create or mutate gate state');
    })
  )
    passed++;
  else failed++;

  // --- Test 11: respects legacy GATEGUARD_DISABLED env disable ---
  clearState();
  if (
    test('respects GATEGUARD_DISABLED=1 for Bash recovery', () => {
      const input = {
        tool_name: 'Bash',
        tool_input: { command: 'npm test' }
      };
      const result = runBashHook(input, { GATEGUARD_DISABLED: '1' });
      const output = parseOutput(result.stdout);

      assert.ok(output, 'should produce valid JSON output');
      assert.strictEqual(output.tool_name, 'Bash', 'disabled gate should pass Bash through raw input');
      assert.ok(!output.hookSpecificOutput, 'disabled gate should not deny Bash');
      assert.ok(!fs.existsSync(stateFile), 'disabled gate should not create or mutate gate state');
    })
  )
    passed++;
  else failed++;

  // --- Test 12: legacy GATEGUARD_DISABLED compatibility is scoped to =1 ---
  clearState();
  if (
    test('does not treat GATEGUARD_DISABLED=true as a disable flag', () => {
      const input = {
        tool_name: 'Bash',
        tool_input: { command: 'npm test' }
      };
      const result = runBashHook(input, { GATEGUARD_DISABLED: 'true' });
      const output = parseOutput(result.stdout);

      assert.strictEqual(output.hookSpecificOutput.permissionDecision, 'deny');
      assert.ok(output.hookSpecificOutput.permissionDecisionReason.includes('current user request'));
    })
  )
    passed++;
  else failed++;

  // --- Test 13: denial messages show an escape hatch ---
  clearState();
  if (
    test('denial messages include direct recovery escape hatch', () => {
      const input = {
        tool_name: 'Write',
        tool_input: { file_path: '/src/recovery-hint.js', content: 'export const ok = true;' }
      };
      const result = runHook(input);
      const output = parseOutput(result.stdout);

      assert.strictEqual(output.hookSpecificOutput.permissionDecision, 'deny');
      assert.ok(output.hookSpecificOutput.permissionDecisionReason.includes('ECC_GATEGUARD=off'), 'denial reason should show the direct recovery env toggle');
      assert.ok(output.hookSpecificOutput.permissionDecisionReason.includes('ECC_DISABLED_HOOKS'), 'denial reason should mention the existing hook-id disable control');
    })
  )
    passed++;
  else failed++;

  // --- Test 14: routine Bash denial messages show the Bash hook escape hatch ---
  clearState();
  if (
    test('routine Bash denials include Bash hook disable id', () => {
      const input = {
        tool_name: 'Bash',
        tool_input: { command: 'npm test' }
      };
      const result = runBashHook(input);
      const output = parseOutput(result.stdout);
      const reason = output.hookSpecificOutput.permissionDecisionReason;

      assert.strictEqual(output.hookSpecificOutput.permissionDecision, 'deny');
      assert.ok(reason.includes('pre:bash:gateguard-fact-force'), 'routine Bash denial should show the Bash hook ID');
      assert.ok(!reason.includes('pre:edit-write:gateguard-fact-force'), 'routine Bash denial should not show the Edit/Write hook ID as the targeted disable');
    })
  )
    passed++;
  else failed++;

  // --- Test 15: destructive Bash denials do not advertise the recovery escape hatch ---
  clearState();
  if (
    test('destructive Bash denials omit recovery escape hatch', () => {
      const input = {
        tool_name: 'Bash',
        tool_input: { command: 'rm -rf /tmp/demo' }
      };
      const result = runBashHook(input);
      const output = parseOutput(result.stdout);

      assert.strictEqual(output.hookSpecificOutput.permissionDecision, 'deny');
      assert.ok(output.hookSpecificOutput.permissionDecisionReason.includes('Destructive command detected'));
      assert.ok(!output.hookSpecificOutput.permissionDecisionReason.includes('ECC_GATEGUARD=off'), 'destructive gate should not advertise disabling GateGuard');
    })
  )
    passed++;
  else failed++;

  // --- Test 16: MultiEdit gates first unchecked file ---
  clearState();
  if (
    test('denies first MultiEdit with unchecked file', () => {
      const input = {
        tool_name: 'MultiEdit',
        tool_input: {
          edits: [
            { file_path: '/src/multi-a.js', old_string: 'a', new_string: 'b' },
            { file_path: '/src/multi-b.js', old_string: 'c', new_string: 'd' }
          ]
        }
      };
      const result = runHook(input);
      assert.strictEqual(result.code, 0, 'exit code should be 0');
      const output = parseOutput(result.stdout);
      assert.ok(output, 'should produce JSON output');
      assert.strictEqual(output.hookSpecificOutput.permissionDecision, 'deny');
      assert.ok(output.hookSpecificOutput.permissionDecisionReason.includes('Fact-Forcing Gate'));
      assert.ok(output.hookSpecificOutput.permissionDecisionReason.includes('/src/multi-a.js'));
    })
  )
    passed++;
  else failed++;

  // --- Test 11: MultiEdit allows after all files gated ---
  if (
    test('allows MultiEdit after all files gated', () => {
      // multi-a.js was gated in test 10; gate multi-b.js
      const input2 = {
        tool_name: 'MultiEdit',
        tool_input: { edits: [{ file_path: '/src/multi-b.js', old_string: 'c', new_string: 'd' }] }
      };
      runHook(input2); // gates multi-b.js

      // Now both files are gated — retry should allow
      const input3 = {
        tool_name: 'MultiEdit',
        tool_input: {
          edits: [
            { file_path: '/src/multi-a.js', old_string: 'a', new_string: 'b' },
            { file_path: '/src/multi-b.js', old_string: 'c', new_string: 'd' }
          ]
        }
      };
      const result3 = runHook(input3);
      const output3 = parseOutput(result3.stdout);
      assert.ok(output3, 'should produce valid JSON');
      if (output3.hookSpecificOutput) {
        assert.notStrictEqual(output3.hookSpecificOutput.permissionDecision, 'deny', 'should allow MultiEdit after all files gated');
      }
    })
  )
    passed++;
  else failed++;

  // --- Test 12: hot-path reads do not rewrite state within heartbeat ---
  clearState();
  if (
    test('does not rewrite state on hot-path reads within heartbeat window', () => {
      const recentlyActive = Date.now() - (READ_HEARTBEAT_MS - 10 * 1000);
      writeState({
        checked: ['/src/keep-alive.js'],
        last_active: recentlyActive
      });

      const beforeStat = fs.statSync(stateFile);
      const before = JSON.parse(fs.readFileSync(stateFile, 'utf8'));
      assert.strictEqual(before.last_active, recentlyActive, 'seed state should use the expected timestamp');

      const result = runHook({
        tool_name: 'Edit',
        tool_input: { file_path: '/src/keep-alive.js', old_string: 'a', new_string: 'b' }
      });
      const output = parseOutput(result.stdout);
      assert.ok(output, 'should produce valid JSON output');
      if (output.hookSpecificOutput) {
        assert.notStrictEqual(output.hookSpecificOutput.permissionDecision, 'deny', 'already-checked file should still be allowed');
      }

      const afterStat = fs.statSync(stateFile);
      const after = JSON.parse(fs.readFileSync(stateFile, 'utf8'));
      assert.strictEqual(after.last_active, recentlyActive, 'read should not touch last_active within heartbeat');
      assert.strictEqual(afterStat.mtimeMs, beforeStat.mtimeMs, 'read should not rewrite the state file within heartbeat');
    })
  )
    passed++;
  else failed++;

  // --- Test 13: reads refresh stale active state after heartbeat ---
  clearState();
  if (
    test('refreshes last_active after heartbeat elapses', () => {
      const staleButActive = Date.now() - (READ_HEARTBEAT_MS + 5 * 1000);
      writeState({
        checked: ['/src/keep-alive.js'],
        last_active: staleButActive
      });

      const result = runHook({
        tool_name: 'Edit',
        tool_input: { file_path: '/src/keep-alive.js', old_string: 'a', new_string: 'b' }
      });
      const output = parseOutput(result.stdout);
      assert.ok(output, 'should produce valid JSON output');
      if (output.hookSpecificOutput) {
        assert.notStrictEqual(output.hookSpecificOutput.permissionDecision, 'deny', 'already-checked file should still be allowed');
      }

      const after = JSON.parse(fs.readFileSync(stateFile, 'utf8'));
      assert.ok(after.last_active > staleButActive, 'read should refresh last_active after heartbeat');
    })
  )
    passed++;
  else failed++;

  // --- Test 14: pruning preserves routine bash gate marker ---
  clearState();
  if (
    test('preserves __bash_session__ when pruning oversized state', () => {
      const checked = ['__bash_session__'];
      for (let i = 0; i < 80; i++) checked.push(`__destructive__${i}`);
      for (let i = 0; i < 700; i++) checked.push(`/src/file-${i}.js`);
      writeState({ checked, last_active: Date.now() });

      runHook({
        tool_name: 'Edit',
        tool_input: { file_path: '/src/newly-gated.js', old_string: 'a', new_string: 'b' }
      });

      const result = runBashHook({
        tool_name: 'Bash',
        tool_input: { command: 'pwd' }
      });
      const output = parseOutput(result.stdout);
      assert.ok(output, 'should produce valid JSON output');
      if (output.hookSpecificOutput) {
        assert.notStrictEqual(output.hookSpecificOutput.permissionDecision, 'deny', 'routine bash marker should survive pruning');
      }

      const persisted = JSON.parse(fs.readFileSync(stateFile, 'utf8'));
      assert.ok(persisted.checked.includes('__bash_session__'), 'pruned state should retain __bash_session__');
      assert.ok(persisted.checked.length <= 500, 'pruned state should still honor the checked-entry cap');
    })
  )
    passed++;
  else failed++;

  // --- Test 15: raw input session IDs provide stable retry state without env vars ---
  clearState();
  if (
    test('uses raw input session_id when hook env vars are missing', () => {
      const input = {
        session_id: 'raw-session-1234',
        tool_name: 'Bash',
        tool_input: { command: 'ls -la' }
      };

      const first = runBashHook(input, {
        CLAUDE_SESSION_ID: '',
        ECC_SESSION_ID: ''
      });
      const firstOutput = parseOutput(first.stdout);
      assert.strictEqual(firstOutput.hookSpecificOutput.permissionDecision, 'deny');

      const second = runBashHook(input, {
        CLAUDE_SESSION_ID: '',
        ECC_SESSION_ID: ''
      });
      const secondOutput = parseOutput(second.stdout);
      if (secondOutput.hookSpecificOutput) {
        assert.notStrictEqual(secondOutput.hookSpecificOutput.permissionDecision, 'deny', 'retry should be allowed when raw session_id is stable');
      } else {
        assert.strictEqual(secondOutput.tool_name, 'Bash');
      }
    })
  )
    passed++;
  else failed++;

  // --- Test 16: allows Claude settings edits so the hook can be disabled safely ---
  clearState();
  if (
    test('allows edits to .claude/settings.json without gating', () => {
      const input = {
        tool_name: 'Edit',
        tool_input: { file_path: '/workspace/app/.claude/settings.json', old_string: '{}', new_string: '{"hooks":[]}' }
      };
      const result = runHook(input);
      const output = parseOutput(result.stdout);
      assert.ok(output, 'should produce valid JSON output');
      if (output.hookSpecificOutput) {
        assert.notStrictEqual(output.hookSpecificOutput.permissionDecision, 'deny', 'settings edits must not be blocked by gateguard');
      } else {
        assert.strictEqual(output.tool_name, 'Edit');
      }
    })
  )
    passed++;
  else failed++;

  // --- Test 17: allows read-only git introspection without first-bash gating ---
  clearState();
  if (
    test('allows read-only git status without first-bash gating', () => {
      const input = {
        tool_name: 'Bash',
        tool_input: { command: 'git status --short' }
      };
      const result = runBashHook(input);
      const output = parseOutput(result.stdout);
      assert.ok(output, 'should produce valid JSON output');
      if (output.hookSpecificOutput) {
        assert.notStrictEqual(output.hookSpecificOutput.permissionDecision, 'deny', 'read-only git introspection should not be blocked');
      } else {
        assert.strictEqual(output.tool_name, 'Bash');
      }
    })
  )
    passed++;
  else failed++;

  // --- Test 18: rejects mutating git commands that only share a prefix ---
  clearState();
  if (
    test('does not treat mutating git commands as read-only introspection', () => {
      const input = {
        tool_name: 'Bash',
        tool_input: { command: 'git status && rm -rf /tmp/demo' }
      };
      const result = runBashHook(input);
      const output = parseOutput(result.stdout);
      assert.ok(output, 'should produce valid JSON output');
      assert.strictEqual(output.hookSpecificOutput.permissionDecision, 'deny');
      assert.ok(output.hookSpecificOutput.permissionDecisionReason.includes('current instruction'));
    })
  )
    passed++;
  else failed++;

  // --- Test 19: long raw session IDs hash instead of collapsing to project fallback ---
  clearState();
  if (
    test('uses a stable hash for long raw session ids', () => {
      const longSessionId = `session-${'x'.repeat(120)}`;
      const input = {
        session_id: longSessionId,
        tool_name: 'Bash',
        tool_input: { command: 'ls -la' }
      };

      const first = runBashHook(input, {
        CLAUDE_SESSION_ID: '',
        ECC_SESSION_ID: ''
      });
      const firstOutput = parseOutput(first.stdout);
      assert.strictEqual(firstOutput.hookSpecificOutput.permissionDecision, 'deny');

      const stateFiles = fs.readdirSync(stateDir).filter(entry => entry.startsWith('state-') && entry.endsWith('.json'));
      assert.strictEqual(stateFiles.length, 1, 'long raw session id should still produce a dedicated state file');
      assert.ok(/state-sid-[a-f0-9]{24}\.json$/.test(stateFiles[0]), 'long raw session ids should hash to a bounded sid-* key');

      const second = runBashHook(input, {
        CLAUDE_SESSION_ID: '',
        ECC_SESSION_ID: ''
      });
      const secondOutput = parseOutput(second.stdout);
      if (secondOutput.hookSpecificOutput) {
        assert.notStrictEqual(secondOutput.hookSpecificOutput.permissionDecision, 'deny', 'retry should be allowed when long raw session_id is stable');
      } else {
        assert.strictEqual(secondOutput.tool_name, 'Bash');
      }
    })
  )
    passed++;
  else failed++;

  // --- Test 20: malformed JSON passes through unchanged ---
  clearState();
  if (
    test('passes malformed JSON input through unchanged', () => {
      const rawInput = '{ not valid json';
      const result = runHook(rawInput);

      assert.strictEqual(result.code, 0, 'exit code should be 0');
      assert.strictEqual(result.stdout, rawInput, 'malformed JSON should pass through unchanged');
    })
  )
    passed++;
  else failed++;

  // --- Test 21: read-only git allowlist covers supported subcommands ---
  clearState();
  if (
    test('allows read-only git introspection subcommands without first-bash gating', () => {
      const commands = [
        'git status --porcelain --branch',
        'git diff',
        'git diff --name-only',
        'git log --oneline --max-count=1',
        'git show HEAD:README.md',
        'git show HEAD:"docs/install guide.md"',
        '/usr/bin/git status --short',
        'git branch --show-current',
        'git rev-parse --abbrev-ref HEAD'
      ];

      for (const command of commands) {
        const result = runBashHook({
          tool_name: 'Bash',
          tool_input: { command }
        });
        const output = parseOutput(result.stdout);
        assert.ok(output, `should produce JSON output for ${command}`);
        if (output.hookSpecificOutput) {
          assert.notStrictEqual(output.hookSpecificOutput.permissionDecision, 'deny', `${command} should not be denied`);
        } else {
          assert.strictEqual(output.tool_name, 'Bash', `${command} should pass through`);
        }
      }
    })
  )
    passed++;
  else failed++;

  // --- Test 22: unsupported git commands still flow through routine Bash gate ---
  clearState();
  if (
    test('gates non-allowlisted git commands as routine Bash', () => {
      const result = runBashHook({
        tool_name: 'Bash',
        tool_input: { command: 'git remote -v' }
      });
      const output = parseOutput(result.stdout);
      assert.ok(output, 'should produce JSON output');
      assert.strictEqual(output.hookSpecificOutput.permissionDecision, 'deny');
      assert.ok(output.hookSpecificOutput.permissionDecisionReason.includes('current user request'));
    })
  )
    passed++;
  else failed++;

  // --- Test 23: quoted shell separators are not read-only git bypasses
  clearState();
  if (
    test('does not treat quoted shell separators as read-only git introspection', () => {
      const result = runBashHook({
        tool_name: 'Bash',
        tool_input: { command: 'git show HEAD:"docs/a;b.md"' }
      });
      const output = parseOutput(result.stdout);
      assert.ok(output, 'should produce valid JSON output');
      assert.strictEqual(output.hookSpecificOutput.permissionDecision, 'deny');
      assert.ok(output.hookSpecificOutput.permissionDecisionReason.includes('current user request'));
    })
  )
    passed++;
  else failed++;

  // --- Test 24: module-load pruning removes old state files only ---
  clearState();
  if (
    test('prunes stale state files while keeping fresh state files', () => {
      const staleFile = path.join(stateDir, 'state-stale-session.json');
      const freshFile = path.join(stateDir, 'state-fresh-session.json');
      fs.writeFileSync(staleFile, JSON.stringify({ checked: [], last_active: Date.now() }), 'utf8');
      fs.writeFileSync(freshFile, JSON.stringify({ checked: [], last_active: Date.now() }), 'utf8');

      const staleTime = new Date(Date.now() - 61 * 60 * 1000);
      fs.utimesSync(staleFile, staleTime, staleTime);

      const result = runHook({
        tool_name: 'Read',
        tool_input: { file_path: '/src/app.js' }
      });
      const output = parseOutput(result.stdout);
      assert.ok(output, 'should produce valid JSON output');

      assert.ok(!fs.existsSync(staleFile), 'stale state file should be pruned at module load');
      assert.ok(fs.existsSync(freshFile), 'fresh state file should not be pruned');
    })
  )
    passed++;
  else failed++;

  // --- Test 24: transcript path fallback provides a stable session key ---
  clearState();
  if (
    test('uses transcript_path fallback when session ids are absent', () => {
      const input = {
        transcript_path: path.join(stateDir, 'session.jsonl'),
        tool_name: 'Bash',
        tool_input: { command: 'pwd' }
      };

      const first = runBashHook(input, {
        CLAUDE_SESSION_ID: '',
        ECC_SESSION_ID: '',
        CLAUDE_TRANSCRIPT_PATH: ''
      });
      const firstOutput = parseOutput(first.stdout);
      assert.strictEqual(firstOutput.hookSpecificOutput.permissionDecision, 'deny');

      const stateFiles = fs.readdirSync(stateDir).filter(entry => entry.startsWith('state-') && entry.endsWith('.json'));
      assert.strictEqual(stateFiles.length, 1, 'transcript path should produce one state file');
      assert.ok(/state-tx-[a-f0-9]{24}\.json$/.test(stateFiles[0]), 'transcript path should hash to a tx-* key');

      const second = runBashHook(input, {
        CLAUDE_SESSION_ID: '',
        ECC_SESSION_ID: '',
        CLAUDE_TRANSCRIPT_PATH: ''
      });
      const secondOutput = parseOutput(second.stdout);
      if (secondOutput.hookSpecificOutput) {
        assert.notStrictEqual(secondOutput.hookSpecificOutput.permissionDecision, 'deny', 'retry should be allowed when transcript_path is stable');
      } else {
        assert.strictEqual(secondOutput.tool_name, 'Bash');
      }
    })
  )
    passed++;
  else failed++;

  // --- Test 25: project directory fallback provides a stable session key ---
  clearState();
  if (
    test('uses project directory fallback when no session or transcript id exists', () => {
      const input = {
        tool_name: 'Bash',
        tool_input: { command: 'pwd' }
      };
      const fallbackEnv = {
        CLAUDE_SESSION_ID: '',
        ECC_SESSION_ID: '',
        CLAUDE_TRANSCRIPT_PATH: '',
        CLAUDE_PROJECT_DIR: path.join(stateDir, 'project-root')
      };

      const first = runBashHook(input, fallbackEnv);
      const firstOutput = parseOutput(first.stdout);
      assert.strictEqual(firstOutput.hookSpecificOutput.permissionDecision, 'deny');

      const stateFiles = fs.readdirSync(stateDir).filter(entry => entry.startsWith('state-') && entry.endsWith('.json'));
      assert.strictEqual(stateFiles.length, 1, 'project fallback should produce one state file');
      assert.ok(/state-proj-[a-f0-9]{24}\.json$/.test(stateFiles[0]), 'project fallback should hash to a proj-* key');

      const second = runBashHook(input, fallbackEnv);
      const secondOutput = parseOutput(second.stdout);
      if (secondOutput.hookSpecificOutput) {
        assert.notStrictEqual(secondOutput.hookSpecificOutput.permissionDecision, 'deny', 'retry should be allowed when project fallback is stable');
      } else {
        assert.strictEqual(secondOutput.tool_name, 'Bash');
      }
    })
  )
    passed++;
  else failed++;

  // --- Test 26: direct run() accepts object input and default fields ---
  clearState();
  if (
    test('direct run handles object input and missing optional fields', () => {
      const hook = loadDirectHook();

      const readInput = { tool_name: 'Read', tool_input: { file_path: '/src/app.js' } };
      assert.strictEqual(hook.run(readInput), readInput, 'object input should pass through unchanged');

      const editWithoutInput = { tool_name: 'Edit' };
      assert.strictEqual(hook.run(editWithoutInput), editWithoutInput, 'missing tool_input should allow Edit');

      const multiWithoutEdits = { tool_name: 'MultiEdit', tool_input: {} };
      assert.strictEqual(hook.run(multiWithoutEdits), multiWithoutEdits, 'missing edits array should allow MultiEdit');

      const bashWithoutCommand = { tool_name: 'Bash', tool_input: {} };
      const bashResult = hook.run(bashWithoutCommand);
      const bashOutput = JSON.parse(bashResult.stdout);
      assert.strictEqual(bashOutput.hookSpecificOutput.permissionDecision, 'deny', 'missing Bash command should still use routine Bash gate');
    })
  )
    passed++;
  else failed++;

  // --- Test 27: bidi controls are stripped from file paths ---
  clearState();
  if (
    test('sanitizes bidi override characters in gated file paths', () => {
      const bidiOverride = String.fromCharCode(0x202e);
      const input = {
        tool_name: 'Edit',
        tool_input: { file_path: `/src/${bidiOverride}evil.js`, old_string: 'a', new_string: 'b' }
      };

      const result = runHook(input);
      const output = parseOutput(result.stdout);
      assert.ok(output, 'should produce JSON output');
      const reason = output.hookSpecificOutput.permissionDecisionReason;
      assert.ok(!reason.includes(bidiOverride), 'bidi override must not appear in denial reason');
      assert.ok(reason.includes('evil.js'), 'sanitized path should retain visible filename text');
    })
  )
    passed++;
  else failed++;

  // --- Test 28: saveState preserves concurrent disk updates ---
  clearState();
  if (
    test('merges state written by another process during save', () => {
      const hook = loadDirectHook();
      const originalMkdirSync = fs.mkdirSync;
      let injected = false;

      fs.mkdirSync = function patchedMkdirSync(target) {
        const result = originalMkdirSync.apply(fs, arguments);
        if (!injected && path.resolve(String(target)) === path.resolve(stateDir)) {
          injected = true;
          fs.writeFileSync(
            stateFile,
            JSON.stringify({
              checked: ['/src/concurrent.js'],
              last_active: Date.now()
            }),
            'utf8'
          );
        }
        return result;
      };

      try {
        const result = hook.run({
          tool_name: 'Edit',
          tool_input: { file_path: '/src/new-edit.js', old_string: 'a', new_string: 'b' }
        });
        const output = parseOutput(result.stdout);
        assert.strictEqual(output.hookSpecificOutput.permissionDecision, 'deny', 'first edit should still be gated');
      } finally {
        fs.mkdirSync = originalMkdirSync;
      }

      const persisted = JSON.parse(fs.readFileSync(stateFile, 'utf8'));
      assert.ok(persisted.checked.includes('/src/concurrent.js'), 'concurrent disk entry should be preserved');
      assert.ok(persisted.checked.includes('/src/new-edit.js'), 'new in-memory entry should be persisted');
    })
  )
    passed++;
  else failed++;

  // --- Test 29: stale temp files from interrupted writes are pruned ---
  clearState();
  if (
    test('prunes stale state temp files at module load', () => {
      fs.mkdirSync(stateDir, { recursive: true });
      const staleTmp = path.join(stateDir, `${path.basename(stateFile)}.tmp.1234.abcd`);
      const freshState = path.join(stateDir, 'state-fresh-session.json');
      fs.writeFileSync(staleTmp, '{}', 'utf8');
      fs.writeFileSync(freshState, '{}', 'utf8');
      const staleTime = new Date(Date.now() - 61 * 60 * 1000);
      fs.utimesSync(staleTmp, staleTime, staleTime);

      loadDirectHook();

      assert.ok(!fs.existsSync(staleTmp), 'stale temp state file should be pruned');
      assert.ok(fs.existsSync(freshState), 'fresh state file should remain');
    })
  )
    passed++;
  else failed++;

  function runFreshSessionEdit(filePath, extra = {}) {
    return runHook(
      {
        tool_name: 'Edit',
        tool_input: { file_path: filePath, old_string: 'a', new_string: 'b' },
        session_id: 'subagent-fresh-session',
        ...extra
      },
      { CLAUDE_SESSION_ID: '', ECC_SESSION_ID: '' }
    );
  }

  function runFreshSessionBash(command, extra = {}) {
    return runBashHook(
      {
        tool_name: 'Bash',
        tool_input: { command },
        session_id: 'subagent-fresh-session',
        ...extra
      },
      { CLAUDE_SESSION_ID: '', ECC_SESSION_ID: '' }
    );
  }

  // --- Test 30: top-level Edit denies; subagent Edit allows ---
  clearState();
  if (
    test('A/B: same Edit denies at top level and allows with agent_id', () => {
      const topLevel = runFreshSessionEdit('/src/subagent-edit.js');
      const topOut = parseOutput(topLevel.stdout);
      assert.ok(topOut, 'top-level edit should produce JSON output');
      assert.strictEqual(topOut.hookSpecificOutput.permissionDecision, 'deny');

      clearState();
      const subagent = runFreshSessionEdit('/src/subagent-edit.js', { agent_id: 'agent-abc-123' });
      const subOut = parseOutput(subagent.stdout);
      assert.ok(subOut, 'subagent edit should produce JSON output');
      assert.ok(!subOut.hookSpecificOutput || subOut.hookSpecificOutput.permissionDecision !== 'deny', 'subagent edit should bypass the first-touch file gate');
    })
  )
    passed++;
  else failed++;

  // --- Test 31: top-level Write denies; subagent Write allows ---
  clearState();
  if (
    test('A/B: same Write denies at top level and allows with agent_id', () => {
      const topLevel = runHook(
        {
          tool_name: 'Write',
          tool_input: { file_path: '/src/subagent-write.js', content: 'module.exports = {};' },
          session_id: 'subagent-fresh-session'
        },
        { CLAUDE_SESSION_ID: '', ECC_SESSION_ID: '' }
      );
      const topOut = parseOutput(topLevel.stdout);
      assert.ok(topOut, 'top-level write should produce JSON output');
      assert.strictEqual(topOut.hookSpecificOutput.permissionDecision, 'deny');

      clearState();
      const subagent = runHook(
        {
          tool_name: 'Write',
          tool_input: { file_path: '/src/subagent-write.js', content: 'module.exports = {};' },
          session_id: 'subagent-fresh-session',
          agent_id: 'agent-abc-123'
        },
        { CLAUDE_SESSION_ID: '', ECC_SESSION_ID: '' }
      );
      const subOut = parseOutput(subagent.stdout);
      assert.ok(subOut, 'subagent write should produce JSON output');
      assert.ok(!subOut.hookSpecificOutput || subOut.hookSpecificOutput.permissionDecision !== 'deny', 'subagent write should bypass the first-touch file gate');
    })
  )
    passed++;
  else failed++;

  // --- Test 32: top-level MultiEdit denies; subagent MultiEdit allows ---
  clearState();
  if (
    test('A/B: same MultiEdit denies at top level and allows with agent_id', () => {
      const edits = [
        { file_path: '/src/subagent-multi-a.js', old_string: 'a', new_string: 'b' },
        { file_path: '/src/subagent-multi-b.js', old_string: 'c', new_string: 'd' }
      ];

      const topLevel = runHook(
        {
          tool_name: 'MultiEdit',
          tool_input: { edits },
          session_id: 'subagent-fresh-session'
        },
        { CLAUDE_SESSION_ID: '', ECC_SESSION_ID: '' }
      );
      const topOut = parseOutput(topLevel.stdout);
      assert.ok(topOut, 'top-level MultiEdit should produce JSON output');
      assert.strictEqual(topOut.hookSpecificOutput.permissionDecision, 'deny');

      clearState();
      const subagent = runHook(
        {
          tool_name: 'MultiEdit',
          tool_input: { edits },
          session_id: 'subagent-fresh-session',
          agent_id: 'agent-abc-123'
        },
        { CLAUDE_SESSION_ID: '', ECC_SESSION_ID: '' }
      );
      const subOut = parseOutput(subagent.stdout);
      assert.ok(subOut, 'subagent MultiEdit should produce JSON output');
      assert.ok(!subOut.hookSpecificOutput || subOut.hookSpecificOutput.permissionDecision !== 'deny', 'subagent MultiEdit should bypass the first-touch file gate');
    })
  )
    passed++;
  else failed++;

  // --- Test 33: Bash stays gated inside subagents ---
  clearState();
  if (
    test('routine Bash remains gated in subagent context', () => {
      const result = runFreshSessionBash('pwd', { agent_id: 'agent-abc-123' });
      const output = parseOutput(result.stdout);
      assert.ok(output, 'subagent Bash should produce JSON output');
      assert.strictEqual(output.hookSpecificOutput.permissionDecision, 'deny');
      assert.ok(output.hookSpecificOutput.permissionDecisionReason.includes('current user request'));
    })
  )
    passed++;
  else failed++;

  // --- Test 34: destructive Bash stays gated inside subagents ---
  clearState();
  if (
    test('destructive Bash remains gated in subagent context', () => {
      const result = runFreshSessionBash('rm -rf /tmp/demo-path', { agent_id: 'agent-abc-123' });
      const output = parseOutput(result.stdout);
      assert.ok(output, 'subagent destructive Bash should produce JSON output');
      assert.strictEqual(output.hookSpecificOutput.permissionDecision, 'deny');
      assert.ok(output.hookSpecificOutput.permissionDecisionReason.includes('Destructive command detected'));
    })
  )
    passed++;
  else failed++;

  // --- Test 35: parent tool IDs also mark subagent context ---
  clearState();
  if (
    test('parent_tool_use_id and parentToolUseId mark subagent file edits', () => {
      const snake = runFreshSessionEdit('/src/subagent-parent-snake.js', { parent_tool_use_id: 'toolu_parent_01' });
      const snakeOut = parseOutput(snake.stdout);
      assert.ok(snakeOut, 'snake-case parent marker should produce JSON output');
      assert.ok(!snakeOut.hookSpecificOutput || snakeOut.hookSpecificOutput.permissionDecision !== 'deny', 'parent_tool_use_id should bypass the first-touch file gate');

      clearState();
      const camel = runFreshSessionEdit('/src/subagent-parent-camel.js', { parentToolUseId: 'toolu_parent_02' });
      const camelOut = parseOutput(camel.stdout);
      assert.ok(camelOut, 'camel-case parent marker should produce JSON output');
      assert.ok(!camelOut.hookSpecificOutput || camelOut.hookSpecificOutput.permissionDecision !== 'deny', 'parentToolUseId should bypass the first-touch file gate');
    })
  )
    passed++;
  else failed++;

  // --- Test 36: only non-empty string markers count ---
  clearState();
  if (
    test('empty and non-string subagent markers do not bypass file gates', () => {
      const cases = [
        ['empty', { agent_id: '' }],
        ['whitespace', { agent_id: '   ' }],
        ['numeric', { agent_id: 12345 }],
        ['null', { agent_id: null }]
      ];

      for (const [name, extra] of cases) {
        clearState();
        const result = runFreshSessionEdit(`/src/subagent-marker-${name}.js`, extra);
        const output = parseOutput(result.stdout);
        assert.ok(output, `${name} marker should produce JSON output`);
        assert.strictEqual(output.hookSpecificOutput.permissionDecision, 'deny', `${name} marker should not bypass the first-touch file gate`);
      }
    })
  )
    passed++;
  else failed++;

  // --- Test 37: two sequential subagent Edits on different files pass ---
  clearState();
  if (
    test('two sequential subagent Edits on different files both pass', () => {
      const first = runFreshSessionEdit('/src/subagent-seq-a.js', { agent_id: 'agent-seq' });
      const firstOut = parseOutput(first.stdout);
      assert.ok(firstOut, 'first subagent edit should produce JSON output');
      assert.ok(!firstOut.hookSpecificOutput || firstOut.hookSpecificOutput.permissionDecision !== 'deny', 'first subagent edit should pass');

      const second = runFreshSessionEdit('/src/subagent-seq-b.js', { agent_id: 'agent-seq' });
      const secondOut = parseOutput(second.stdout);
      assert.ok(secondOut, 'second subagent edit should produce JSON output');
      assert.ok(!secondOut.hookSpecificOutput || secondOut.hookSpecificOutput.permissionDecision !== 'deny', 'second subagent edit should pass even on a new file');
    })
  )
    passed++;
  else failed++;

  // --- Shell-words tokenizer: bypasses the old regex missed ---

  function expectDestructiveDeny(command, label) {
    clearState();
    const input = { tool_name: 'Bash', tool_input: { command } };
    const result = runBashHook(input);
    assert.strictEqual(result.code, 0, `${label}: exit code should be 0`);
    const output = parseOutput(result.stdout);
    assert.ok(output, `${label}: should produce JSON output`);
    assert.strictEqual(output.hookSpecificOutput.permissionDecision, 'deny', `${label}: should deny`);
    assert.ok(output.hookSpecificOutput.permissionDecisionReason.includes('Destructive'), `${label}: reason should mention "Destructive"`);
  }

  function expectAllow(command, label) {
    clearState();
    writeState({ checked: ['__bash_session__'], last_active: Date.now() });
    const input = { tool_name: 'Bash', tool_input: { command } };
    const result = runBashHook(input);
    assert.strictEqual(result.code, 0, `${label}: exit code should be 0`);
    const output = parseOutput(result.stdout);
    assert.ok(output, `${label}: should produce JSON output`);
    if (output.hookSpecificOutput) {
      assert.notStrictEqual(output.hookSpecificOutput.permissionDecision, 'deny', `${label}: should not deny`);
    } else {
      assert.strictEqual(output.tool_name, 'Bash', `${label}: pass-through should preserve input`);
    }
  }

  if (
    test('denies short-form git push -f as destructive', () => {
      expectDestructiveDeny('git push -f origin main', 'git push -f');
    })
  )
    passed++;
  else failed++;

  if (
    test('denies git reset --hard even with intervening -c global option', () => {
      expectDestructiveDeny('git -c core.foo=bar reset --hard', 'git -c ... reset --hard');
    })
  )
    passed++;
  else failed++;

  if (
    test('denies rm -fr (reverse flag order)', () => {
      expectDestructiveDeny('rm -fr /tmp/junk', 'rm -fr');
    })
  )
    passed++;
  else failed++;

  if (
    test('denies rm -r -f (split flag form)', () => {
      expectDestructiveDeny('rm -r -f /tmp/junk', 'rm -r -f');
    })
  )
    passed++;
  else failed++;

  if (
    test('denies rm --recursive --force (long flag form)', () => {
      expectDestructiveDeny('rm --recursive --force /tmp/junk', 'rm --recursive --force');
    })
  )
    passed++;
  else failed++;

  if (
    test('denies git reset HEAD --hard (with intervening ref)', () => {
      expectDestructiveDeny('git reset HEAD --hard', 'git reset HEAD --hard');
    })
  )
    passed++;
  else failed++;

  if (
    test('denies git clean -fd (combined force+dirs flag)', () => {
      expectDestructiveDeny('git clean -fd', 'git clean -fd');
    })
  )
    passed++;
  else failed++;

  if (
    test('denies destructive command in second chained segment', () => {
      expectDestructiveDeny('echo y | rm -rf /tmp/junk', 'echo y | rm -rf');
    })
  )
    passed++;
  else failed++;

  if (
    test('denies destructive command inside command substitution', () => {
      expectDestructiveDeny('echo $(rm -rf /tmp/junk)', 'rm -rf inside $()');
    })
  )
    passed++;
  else failed++;

  if (
    test('denies destructive command inside backticks', () => {
      expectDestructiveDeny('echo `git push -f origin main`', 'git push -f inside backticks');
    })
  )
    passed++;
  else failed++;

  if (
    test('allows destructive phrase quoted inside a commit message', () => {
      expectAllow('git commit -m "fix: rm -rf race in worker"', 'rm -rf in -m');
    })
  )
    passed++;
  else failed++;

  if (
    test('allows SQL phrase quoted inside a commit message', () => {
      expectAllow('git commit -m "docs: explain when drop table is safe"', 'drop table in -m');
    })
  )
    passed++;
  else failed++;

  if (
    test('allows git push --force-if-includes as a safety-checked variant', () => {
      expectAllow('git push --force-with-lease --force-if-includes origin main', 'git push --force-if-includes');
    })
  )
    passed++;
  else failed++;

  // --- Review-round-2 findings ---

  if (
    test('denies git push --force even with --force-if-includes present', () => {
      expectDestructiveDeny('git push --force --force-if-includes origin main', 'git push --force --force-if-includes');
    })
  )
    passed++;
  else failed++;

  if (
    test('denies git push when bare --force is mixed with lease flags', () => {
      expectDestructiveDeny('git push --force-with-lease --force origin main', 'git push --force-with-lease --force');
    })
  )
    passed++;
  else failed++;

  if (
    test('denies git push with +refspec prefix (bare branch)', () => {
      expectDestructiveDeny('git push origin +main', 'git push origin +main');
    })
  )
    passed++;
  else failed++;

  if (
    test('denies git push with +refspec prefix (full ref)', () => {
      expectDestructiveDeny('git push origin +refs/heads/main:refs/heads/main', 'git push origin +refs/heads/main:refs/heads/main');
    })
  )
    passed++;
  else failed++;

  if (
    test('denies git switch --discard-changes', () => {
      expectDestructiveDeny('git switch --discard-changes feature', 'git switch --discard-changes');
    })
  )
    passed++;
  else failed++;

  if (
    test('denies git switch --force', () => {
      expectDestructiveDeny('git switch --force main', 'git switch --force');
    })
  )
    passed++;
  else failed++;

  if (
    test('denies git switch -f short form', () => {
      expectDestructiveDeny('git switch -f main', 'git switch -f');
    })
  )
    passed++;
  else failed++;

  if (
    test('denies git switch -C force-create', () => {
      expectDestructiveDeny('git switch -C feature', 'git switch -C');
    })
  )
    passed++;
  else failed++;

  if (
    test('still allows plain git switch', () => {
      expectAllow('git switch feature', 'git switch feature');
    })
  )
    passed++;
  else failed++;

  if (
    test('denies rm -rf nested inside a backtick subshell', () => {
      expectDestructiveDeny('echo y | `rm -rf /tmp/junk`', 'backtick subshell');
    })
  )
    passed++;
  else failed++;

  if (
    test('denies rm -rf nested inside a $(...) subshell', () => {
      expectDestructiveDeny('echo y | $(rm -rf /tmp/junk)', 'dollar-paren subshell');
    })
  )
    passed++;
  else failed++;

  if (
    test('denies rm -rf inside double-quoted command substitution', () => {
      expectDestructiveDeny('echo "$(rm -rf /tmp/junk)"', 'double-quoted dollar-paren subshell');
    })
  )
    passed++;
  else failed++;

  // --- Subshell + brace-group bypass coverage ---
  // Destructive commands inside `(...)` and `{ ...; }` execute the
  // same way they do at the top level, so the destructive classifier
  // must see inside those bodies too. Nested parens `((...))` are
  // arithmetic-evaluation syntax in bash (not a nested subshell), but
  // our parser depth-tracks them conservatively — i.e. the inner
  // tokens are still scanned for destructive intent. That's safety
  // over precision and the right default for this gate.

  if (
    test('denies rm -rf inside plain (...) subshell group', () => {
      expectDestructiveDeny('(rm -rf /tmp/junk)', 'plain subshell group');
    })
  )
    passed++;
  else failed++;

  if (
    test('denies rm -rf inside ((...)) — arithmetic eval, treated conservatively', () => {
      expectDestructiveDeny('((rm -rf /tmp/junk))', 'arithmetic-eval parens');
    })
  )
    passed++;
  else failed++;

  if (
    test('denies rm -rf inside { ...; } brace group', () => {
      expectDestructiveDeny('{ rm -rf /tmp/junk; }', 'brace group');
    })
  )
    passed++;
  else failed++;

  if (
    test('denies git push --force inside plain (...) subshell group', () => {
      expectDestructiveDeny('(git push --force origin main)', 'git-force in subshell');
    })
  )
    passed++;
  else failed++;

  if (
    test('denies git push --force inside { ...; } brace group', () => {
      expectDestructiveDeny('{ git push --force origin main; }', 'git-force in brace group');
    })
  )
    passed++;
  else failed++;

  if (
    test('denies rm -rf nested across () and {} (cross-syntax)', () => {
      expectDestructiveDeny('(echo y; { rm -rf /tmp/junk; })', '() containing {} cross-syntax');
    })
  )
    passed++;
  else failed++;

  if (
    test('denies rm -rf nested across $() and () (cross-syntax)', () => {
      expectDestructiveDeny('$(echo y; (rm -rf /tmp/junk))', '$() containing () cross-syntax');
    })
  )
    passed++;
  else failed++;

  // Negative cases — literals and non-destructive commands must NOT
  // be promoted to destructive by the new grouping-body walker.

  if (
    test('allows literal (rm -rf ...) inside single quotes', () => {
      expectAllow("git commit -m '(rm -rf /tmp/junk)'", 'single-quoted subshell literal');
    })
  )
    passed++;
  else failed++;

  if (
    test('allows literal (rm -rf ...) inside double quotes', () => {
      expectAllow('echo "(rm -rf /tmp/junk)"', 'double-quoted subshell literal');
    })
  )
    passed++;
  else failed++;

  if (
    test('allows literal { rm -rf ...; } inside double quotes', () => {
      expectAllow('echo "{ rm -rf /tmp/junk; }"', 'double-quoted brace-group literal');
    })
  )
    passed++;
  else failed++;

  if (
    test('allows non-destructive (echo hello)', () => {
      expectAllow('(echo hello)', 'non-destructive subshell');
    })
  )
    passed++;
  else failed++;

  if (
    test('allows non-destructive { echo hello; }', () => {
      expectAllow('{ echo hello; }', 'non-destructive brace group');
    })
  )
    passed++;
  else failed++;

  if (
    test('allows {rm -rf} — no space after { is not a brace group', () => {
      // bash treats `{rm` as a single token; no destructive intent
      // can be statically derived from this form, and the command
      // would not actually run rm at runtime either.
      expectAllow('echo {rm -rf /tmp/junk}', 'no-space brace literal');
    })
  )
    passed++;
  else failed++;

  // --- Round 1 review fixes: brace-group span-skip + boundary ---
  // Verifies the body-accumulation loop in `extractBraceGroups`
  // correctly walks past `$(...)`, `(...)`, and backtick spans so
  // a `}` inside one of those does not terminate the brace group
  // early, plus the nested `{` boundary rule.

  if (
    test('denies rm -rf in brace group with backtick containing }', () => {
      expectDestructiveDeny('{ echo `echo }`; rm -rf /tmp/junk; }', 'brace + backtick containing }');
    })
  )
    passed++;
  else failed++;

  if (
    test('denies rm -rf in brace group with $() containing }', () => {
      expectDestructiveDeny('{ echo $(echo "}"); rm -rf /tmp/junk; }', 'brace + $() containing }');
    })
  )
    passed++;
  else failed++;

  if (
    test('denies rm -rf in brace group with nested () containing }', () => {
      expectDestructiveDeny('{ (echo "}"); rm -rf /tmp/junk; }', 'brace + () containing }');
    })
  )
    passed++;
  else failed++;

  if (
    test('denies rm -rf in brace group with $() body containing }', () => {
      expectDestructiveDeny('{ x=$(echo a}b); rm -rf /tmp/junk; }', 'brace + $() body with }');
    })
  )
    passed++;
  else failed++;

  if (
    test('denies rm -rf when token like foo{ appears before brace group close', () => {
      // tokens like `foo{` are not reserved-word `{` (no boundary,
      // no whitespace after) — must not bump nested-depth and so
      // must not delay brace-group close
      expectDestructiveDeny('{ echo foo{bar; rm -rf /tmp/junk; }', 'foo{ token inside brace body');
    })
  )
    passed++;
  else failed++;

  // --- Issue #2078: GATEGUARD_BASH_ROUTINE_DISABLED env var ---
  // Operators on hosts that don't benefit from the once-per-session
  // routine bash gate (Cursor, OpenCode, etc.) get an env-var opt-out.
  // The destructive gate is unaffected.

  clearState();
  if (
    test('GATEGUARD_BASH_ROUTINE_DISABLED=1 skips routine bash gate', () => {
      const input = { tool_name: 'Bash', tool_input: { command: 'ls -la' } };
      const result = runBashHook(input, { GATEGUARD_BASH_ROUTINE_DISABLED: '1' });
      assert.strictEqual(result.code, 0, 'exit code should be 0');
      const output = parseOutput(result.stdout);
      assert.ok(output, 'should produce valid JSON output');
      if (output.hookSpecificOutput) {
        assert.notStrictEqual(output.hookSpecificOutput.permissionDecision, 'deny', 'routine bash should not be denied when env opts out');
      } else {
        assert.strictEqual(output.tool_name, 'Bash', 'pass-through should preserve input');
      }
    })
  )
    passed++;
  else failed++;

  clearState();
  if (
    test('GATEGUARD_BASH_ROUTINE_DISABLED accepts truthy aliases (true, on, yes, enabled)', () => {
      for (const value of ['true', 'on', 'yes', 'enabled', 'TRUE', 'On']) {
        clearState();
        const result = runBashHook({ tool_name: 'Bash', tool_input: { command: 'grep foo bar.txt' } }, { GATEGUARD_BASH_ROUTINE_DISABLED: value });
        const output = parseOutput(result.stdout);
        assert.ok(output, `value=${value}: should produce JSON`);
        if (output.hookSpecificOutput) {
          assert.notStrictEqual(output.hookSpecificOutput.permissionDecision, 'deny', `value=${value}: should not deny routine bash`);
        }
      }
    })
  )
    passed++;
  else failed++;

  clearState();
  if (
    test('GATEGUARD_BASH_ROUTINE_DISABLED unset preserves baseline (denies first routine bash)', () => {
      const input = { tool_name: 'Bash', tool_input: { command: 'ls -la' } };
      const result = runBashHook(input);
      assert.strictEqual(result.code, 0, 'exit code should be 0');
      const output = parseOutput(result.stdout);
      assert.ok(output, 'should produce JSON');
      assert.strictEqual(output.hookSpecificOutput.permissionDecision, 'deny', 'baseline routine gate must still fire when env is unset');
    })
  )
    passed++;
  else failed++;

  clearState();
  if (
    test('GATEGUARD_BASH_ROUTINE_DISABLED=0 / off / false keeps current behavior', () => {
      for (const value of ['0', 'false', 'off', '', 'random-value']) {
        clearState();
        const result = runBashHook({ tool_name: 'Bash', tool_input: { command: 'ls -la' } }, { GATEGUARD_BASH_ROUTINE_DISABLED: value });
        const output = parseOutput(result.stdout);
        assert.ok(output, `value="${value}": should produce JSON`);
        assert.strictEqual(output.hookSpecificOutput.permissionDecision, 'deny', `value="${value}": routine gate should still fire`);
      }
    })
  )
    passed++;
  else failed++;

  clearState();
  if (
    test('GATEGUARD_BASH_ROUTINE_DISABLED=1 does NOT disable destructive bash gate', () => {
      const input = { tool_name: 'Bash', tool_input: { command: 'rm -rf /important/data' } };
      const result = runBashHook(input, { GATEGUARD_BASH_ROUTINE_DISABLED: '1' });
      const output = parseOutput(result.stdout);
      assert.ok(output, 'should produce JSON');
      assert.strictEqual(output.hookSpecificOutput.permissionDecision, 'deny', 'destructive gate must still fire even when routine gate is opted out');
      assert.ok(output.hookSpecificOutput.permissionDecisionReason.includes('Destructive'), 'reason should mention Destructive');
    })
  )
    passed++;
  else failed++;

  // --- Issue #2078: GATEGUARD_BASH_EXTRA_DESTRUCTIVE env var ---
  // Operators can register additional destructive patterns without
  // patching the bundled JS. Same matching scope as the built-in
  // SQL/dd regex (matches against quote-stripped, subshell-flattened
  // command) so a custom phrase inside `$(...)` is also caught.

  clearState();
  if (
    test('GATEGUARD_BASH_EXTRA_DESTRUCTIVE custom phrase fires destructive gate', () => {
      const input = { tool_name: 'Bash', tool_input: { command: 'supabase db reset --linked' } };
      const result = runBashHook(input, {
        GATEGUARD_BASH_EXTRA_DESTRUCTIVE: 'supabase\\s+db\\s+reset|prisma\\s+migrate\\s+reset'
      });
      const output = parseOutput(result.stdout);
      assert.ok(output, 'should produce JSON');
      assert.strictEqual(output.hookSpecificOutput.permissionDecision, 'deny', 'custom destructive phrase should be gated');
      assert.ok(output.hookSpecificOutput.permissionDecisionReason.includes('Destructive'), 'reason should mention Destructive');
    })
  )
    passed++;
  else failed++;

  clearState();
  if (
    test('GATEGUARD_BASH_EXTRA_DESTRUCTIVE second member of alternation also fires', () => {
      const input = { tool_name: 'Bash', tool_input: { command: 'prisma migrate reset --force' } };
      const result = runBashHook(input, {
        GATEGUARD_BASH_EXTRA_DESTRUCTIVE: 'supabase\\s+db\\s+reset|prisma\\s+migrate\\s+reset'
      });
      const output = parseOutput(result.stdout);
      assert.ok(output, 'should produce JSON');
      assert.strictEqual(output.hookSpecificOutput.permissionDecision, 'deny', 'second alternation member should be gated');
    })
  )
    passed++;
  else failed++;

  clearState();
  if (
    test('GATEGUARD_BASH_EXTRA_DESTRUCTIVE invalid regex degrades to baseline (no crash)', () => {
      // Unbalanced paren is a regex parse error. Hook must NOT crash; it
      // should fall back to the built-in patterns. A plain `ls` should
      // therefore hit the routine gate (denied first time) and a
      // built-in destructive (`rm -rf`) should still fire the destructive gate.
      const lsResult = runBashHook({ tool_name: 'Bash', tool_input: { command: 'ls -la' } }, { GATEGUARD_BASH_EXTRA_DESTRUCTIVE: '(unclosed' });
      assert.strictEqual(lsResult.code, 0, 'malformed regex must not crash hook');
      const lsOutput = parseOutput(lsResult.stdout);
      assert.ok(lsOutput, 'should produce JSON despite bad env regex');
      // Note: with invalid extra regex, the bash branch behaves as if the
      // env var was unset — routine gate fires on first `ls`, destructive
      // gate fires on `rm -rf`.
      assert.strictEqual(lsOutput.hookSpecificOutput.permissionDecision, 'deny', 'baseline routine gate should still fire when extra-regex is malformed');
    })
  )
    passed++;
  else failed++;

  clearState();
  if (
    test('GATEGUARD_BASH_EXTRA_DESTRUCTIVE unset does not affect baseline', () => {
      const input = { tool_name: 'Bash', tool_input: { command: 'supabase db reset --linked' } };
      const result = runBashHook(input);
      assert.strictEqual(result.code, 0, 'exit code should be 0');
      const output = parseOutput(result.stdout);
      assert.ok(output, 'should produce JSON');
      // Without the extra regex, `supabase db reset` is a routine bash
      // command and should hit the routine gate (deny first time) — the
      // destructive gate's "rollback" guidance must NOT appear, since this
      // is the routine, not destructive, deny path.
      assert.strictEqual(output.hookSpecificOutput.permissionDecision, 'deny', 'routine gate fires when extra-regex is unset');
      assert.ok(!output.hookSpecificOutput.permissionDecisionReason.includes('rollback'), 'should be routine deny (no "rollback" guidance), not destructive');
      assert.ok(!output.hookSpecificOutput.permissionDecisionReason.includes('Destructive'), 'should not be the destructive deny message');
    })
  )
    passed++;
  else failed++;

  clearState();
  if (
    test('GATEGUARD_BASH_EXTRA_DESTRUCTIVE custom phrase inside $(...) also caught', () => {
      const input = {
        tool_name: 'Bash',
        tool_input: { command: 'echo "running" && $(supabase db reset)' }
      };
      const result = runBashHook(input, {
        GATEGUARD_BASH_EXTRA_DESTRUCTIVE: 'supabase\\s+db\\s+reset'
      });
      const output = parseOutput(result.stdout);
      assert.ok(output, 'should produce JSON');
      assert.strictEqual(output.hookSpecificOutput.permissionDecision, 'deny', 'custom phrase inside command substitution should be gated');
    })
  )
    passed++;
  else failed++;

  // --- find -exec destructive detection ---

  if (
    test('denies find -exec rm {} \\; as destructive', () => {
      expectDestructiveDeny('find . -name "*.tmp" -exec rm {} \\;', 'find -exec rm');
    })
  )
    passed++;
  else failed++;

  if (
    test('denies find -exec rm -rf {} \\; as destructive', () => {
      expectDestructiveDeny('find . -name "*.tmp" -exec rm -rf {} \\;', 'find -exec rm -rf');
    })
  )
    passed++;
  else failed++;

  if (
    test('denies find -exec rmdir {} \\; as destructive', () => {
      expectDestructiveDeny('find . -name "*.tmp" -exec rmdir {} \\;', 'find -exec rmdir');
    })
  )
    passed++;
  else failed++;

  if (
    test('denies find -exec unlink {} \\; as destructive', () => {
      expectDestructiveDeny('find . -name "*.tmp" -exec unlink {} \\;', 'find -exec unlink');
    })
  )
    passed++;
  else failed++;

  if (
    test('denies find -exec git reset --hard {} \\; as destructive', () => {
      expectDestructiveDeny('find . -name "*.tmp" -exec git reset --hard {} \\;', 'find -exec git reset --hard');
    })
  )
    passed++;
  else failed++;

  if (
    test('denies find -exec rm {} \\; preceded by && (bypass via compound command)', () => {
      expectDestructiveDeny('echo x && find . -exec rm {} \\;', 'compound command bypass: find -exec rm');
    })
  )
    passed++;
  else failed++;

  if (
    test('denies find -exec rm -rf {} \\; preceded by ; (bypass via semicolon)', () => {
      expectDestructiveDeny('true; find . -name "*.log" -exec rm -rf {} \\;', 'semicolon bypass: find -exec rm -rf');
    })
  )
    passed++;
  else failed++;

  if (
    test('denies find -exec rm {} \\; in pipeline (bypass via pipe)', () => {
      expectDestructiveDeny('echo start | find . -exec rm {} \\;', 'pipe bypass: find -exec rm');
    })
  )
    passed++;
  else failed++;

  if (
    test('denies find -exec rm {} \\; after || (OR-chain bypass)', () => {
      expectDestructiveDeny('false || find . -exec rm {} \\;', 'OR-chain bypass: find -exec rm');
    })
  )
    passed++;
  else failed++;

  // GHSA-4v57-ph3x-gf55: quote/newline/wrapper bypasses of the classifier.
  if (
    test('denies rm -rf after a newline separator (GHSA-4v57)', () => {
      expectDestructiveDeny('echo safe\nrm -rf /tmp/victim', 'newline-separated rm -rf');
    })
  )
    passed++;
  else failed++;

  if (
    test('denies a single-quoted rm command word (GHSA-4v57)', () => {
      expectDestructiveDeny("'rm' -rf /tmp/victim", "quoted 'rm' command word");
    })
  )
    passed++;
  else failed++;

  if (
    test('denies a double-quoted rm command word (GHSA-4v57)', () => {
      expectDestructiveDeny('"rm" -rf /tmp/victim', 'quoted "rm" command word');
    })
  )
    passed++;
  else failed++;

  if (
    test('denies rm -rf wrapped in sh -c (GHSA-4v57)', () => {
      expectDestructiveDeny("sh -c 'rm -rf /tmp/victim'", 'sh -c wrapper');
    })
  )
    passed++;
  else failed++;

  if (
    test('denies rm -rf wrapped in bash -c (GHSA-4v57)', () => {
      expectDestructiveDeny("bash -c 'rm -rf /tmp/victim'", 'bash -c wrapper');
    })
  )
    passed++;
  else failed++;

  if (
    test('denies find -exec with a quoted rm binary (GHSA-4v57)', () => {
      expectDestructiveDeny("find . -name '*.tmp' -exec 'rm' {} \\;", 'quoted find -exec rm');
    })
  )
    passed++;
  else failed++;

  if (
    test('still allows rm -rf inside a quoted echo argument (no false positive)', () => {
      clearState();
      const input = { tool_name: 'Bash', tool_input: { command: 'echo "to clean run: rm -rf build"' } };
      const result = runBashHook(input);
      assert.strictEqual(result.code, 0, 'exit code should be 0');
      const output = parseOutput(result.stdout);
      assert.ok(!output || !/Destructive|rollback/.test(output.hookSpecificOutput?.permissionDecisionReason || ''), 'rm inside a quoted string arg must not be flagged destructive');
    })
  )
    passed++;
  else failed++;

  if (
    test('allows find -exec echo {} \\; (non-destructive, routine gate)', () => {
      clearState();
      const input = { tool_name: 'Bash', tool_input: { command: 'find . -name "*.tmp" -exec echo {} \\;' } };
      const result = runBashHook(input);
      assert.strictEqual(result.code, 0, 'exit code should be 0');
      const output = parseOutput(result.stdout);
      assert.ok(output, 'should produce JSON output');
      // Should be denied by routine gate (first bash), not destructive gate
      assert.strictEqual(output.hookSpecificOutput.permissionDecision, 'deny', 'should be denied by routine gate');
      assert.ok(!output.hookSpecificOutput.permissionDecisionReason.includes('Destructive'), 'should not be the destructive deny message');
      assert.ok(!output.hookSpecificOutput.permissionDecisionReason.includes('rollback'), 'should not mention rollback');
    })
  )
    passed++;
  else failed++;

  // --- Issue #2078 review fix: warning emitted once per *distinct*
  // invalid regex, not once per process. Verifies the same-process
  // path that the reviewers (CodeRabbit + cubic) flagged.
  clearState();
  if (
    test('GATEGUARD_BASH_EXTRA_DESTRUCTIVE warns once per distinct invalid regex (not once per process)', () => {
      // We can't easily intercept stderr from a spawnSync child without
      // re-running the hook in the same process, so we exercise
      // checkCommand-equivalent behavior via a same-process require.
      const originalEnv = process.env.GATEGUARD_BASH_EXTRA_DESTRUCTIVE;
      const originalStderrWrite = process.stderr.write.bind(process.stderr);
      const captured = [];
      process.stderr.write = chunk => {
        const s = typeof chunk === 'string' ? chunk : chunk.toString();
        if (s.includes('GATEGUARD_BASH_EXTRA_DESTRUCTIVE')) {
          captured.push(s.trim());
        }
        // Don't forward to real stderr — keeps test output clean.
        return true;
      };
      try {
        // First bad pattern — should warn once.
        process.env.GATEGUARD_BASH_EXTRA_DESTRUCTIVE = '(unclosed-a';
        const hook1 = loadDirectHook({ GATEGUARD_BASH_EXTRA_DESTRUCTIVE: '(unclosed-a' });
        hook1.run(JSON.stringify({ tool_name: 'Bash', tool_input: { command: 'ls' } }));
        hook1.run(JSON.stringify({ tool_name: 'Bash', tool_input: { command: 'ls' } }));
        assert.strictEqual(captured.length, 1, `same invalid pattern should warn exactly once, got ${captured.length}: ${JSON.stringify(captured)}`);

        // Switch to a *different* bad pattern — should warn again (this is
        // the bug both reviewers flagged: the sticky flag was never reset
        // when the cache key changed).
        process.env.GATEGUARD_BASH_EXTRA_DESTRUCTIVE = '(unclosed-b';
        hook1.run(JSON.stringify({ tool_name: 'Bash', tool_input: { command: 'ls' } }));
        assert.strictEqual(captured.length, 2, `distinct invalid pattern should produce a second warning, got ${captured.length}: ${JSON.stringify(captured)}`);

        // Switch back to a valid regex — no extra warning.
        process.env.GATEGUARD_BASH_EXTRA_DESTRUCTIVE = 'valid\\s+pattern';
        hook1.run(JSON.stringify({ tool_name: 'Bash', tool_input: { command: 'ls' } }));
        assert.strictEqual(captured.length, 2, `valid regex should not emit a warning, got ${captured.length}: ${JSON.stringify(captured)}`);
      } finally {
        process.stderr.write = originalStderrWrite;
        if (originalEnv === undefined) {
          delete process.env.GATEGUARD_BASH_EXTRA_DESTRUCTIVE;
        } else {
          process.env.GATEGUARD_BASH_EXTRA_DESTRUCTIVE = originalEnv;
        }
      }
    })
  )
    passed++;
  else failed++;

  // --- Fact-force denial dampening (#2142) ---

  console.log('\n  Fact-force denial dampening (#2142):');

  clearState();
  if (
    test('first denials use the full four-fact block and count toward the budget', () => {
      const result = runHook({ tool_name: 'Edit', tool_input: { file_path: '/src/damp-one.js' } });
      const output = parseOutput(result.stdout);
      assert.strictEqual(output.hookSpecificOutput.permissionDecision, 'deny');
      assert.ok(output.hookSpecificOutput.permissionDecisionReason.includes('present these facts'), 'first denial should use the full block');
      const state = JSON.parse(fs.readFileSync(stateFile, 'utf8'));
      assert.strictEqual(state.fact_force_denials, 1, 'denial counter should persist in session state');
    })
  )
    passed++;
  else failed++;

  clearState();
  if (
    test('emits a condensed single-line denial once the full-block budget is spent', () => {
      writeState({ checked: [], last_active: Date.now(), fact_force_denials: 3 });
      const result = runHook({ tool_name: 'Edit', tool_input: { file_path: '/src/damp-two.js' } });
      const output = parseOutput(result.stdout);
      assert.strictEqual(result.code, 0);
      assert.strictEqual(output.hookSpecificOutput.permissionDecision, 'deny', 'still denies first touch');
      const reason = output.hookSpecificOutput.permissionDecisionReason;
      assert.ok(reason.includes('[Fact-Forcing Gate]'), 'condensed message keeps the gate marker');
      assert.ok(reason.includes('denial #4'), 'condensed message carries the denial ordinal');
      assert.ok(reason.includes('/src/damp-two.js'), 'condensed message names the target');
      assert.ok(!reason.includes('present these facts'), 'no repeated four-fact block');
      assert.ok(!reason.includes('\n'), 'condensed message is a single line');
      assert.ok(reason.includes('ECC_GATEGUARD=off'), 'condensed message keeps a recovery hint');
    })
  )
    passed++;
  else failed++;

  clearState();
  if (
    test('consecutive condensed denials are textually different (ordinal advances)', () => {
      writeState({ checked: [], last_active: Date.now(), fact_force_denials: 5 });
      const first = parseOutput(runHook({ tool_name: 'Write', tool_input: { file_path: '/src/damp-a.js', content: 'x' } }).stdout);
      const second = parseOutput(runHook({ tool_name: 'Write', tool_input: { file_path: '/src/damp-b.js', content: 'x' } }).stdout);
      const firstReason = first.hookSpecificOutput.permissionDecisionReason;
      const secondReason = second.hookSpecificOutput.permissionDecisionReason;
      assert.ok(firstReason.includes('denial #6'), `expected ordinal 6, got: ${firstReason}`);
      assert.ok(secondReason.includes('denial #7'), `expected ordinal 7, got: ${secondReason}`);
      assert.notStrictEqual(firstReason, secondReason, 'successive denials must differ so they cannot compound verbatim');
    })
  )
    passed++;
  else failed++;

  clearState();
  if (
    test('retry of the same target is still allowed after a condensed denial', () => {
      writeState({ checked: [], last_active: Date.now(), fact_force_denials: 9 });
      const input = { tool_name: 'Edit', tool_input: { file_path: '/src/damp-retry.js' } };
      const denied = parseOutput(runHook(input).stdout);
      assert.strictEqual(denied.hookSpecificOutput.permissionDecision, 'deny');
      const retryOutput = parseOutput(runHook(input).stdout);
      assert.ok(!retryOutput || !retryOutput.hookSpecificOutput, 'retry passes through (no second deny, no re-prompt)');
    })
  )
    passed++;
  else failed++;

  clearState();
  if (
    test('GATEGUARD_FACT_FORCE_FULL_DENIALS tunes the full-block budget', () => {
      // Budget 0: condensed from the very first denial.
      const zero = parseOutput(runHook({ tool_name: 'Edit', tool_input: { file_path: '/src/damp-zero.js' } }, { GATEGUARD_FACT_FORCE_FULL_DENIALS: '0' }).stdout);
      assert.ok(zero.hookSpecificOutput.permissionDecisionReason.includes('denial #1'));
      assert.ok(!zero.hookSpecificOutput.permissionDecisionReason.includes('present these facts'));

      // Large budget: full block well past the default threshold.
      clearState();
      writeState({ checked: [], last_active: Date.now(), fact_force_denials: 7 });
      const big = parseOutput(runHook({ tool_name: 'Edit', tool_input: { file_path: '/src/damp-big.js' } }, { GATEGUARD_FACT_FORCE_FULL_DENIALS: '20' }).stdout);
      assert.ok(big.hookSpecificOutput.permissionDecisionReason.includes('present these facts'), 'budget of 20 keeps the full block at denial 8');
    })
  )
    passed++;
  else failed++;

  clearState();
  if (
    test('malformed denial counter in state is treated as zero (full block, no crash)', () => {
      writeState({ checked: [], last_active: Date.now(), fact_force_denials: 'garbage' });
      const result = runHook({ tool_name: 'Edit', tool_input: { file_path: '/src/damp-malformed.js' } });
      assert.strictEqual(result.code, 0);
      const output = parseOutput(result.stdout);
      assert.strictEqual(output.hookSpecificOutput.permissionDecision, 'deny');
      assert.ok(output.hookSpecificOutput.permissionDecisionReason.includes('present these facts'), 'malformed counter resets to the full block');
    })
  )
    passed++;
  else failed++;

  clearState();
  if (
    test('MultiEdit denials are dampened past the budget', () => {
      writeState({ checked: [], last_active: Date.now(), fact_force_denials: 4 });
      const result = runHook({
        tool_name: 'MultiEdit',
        tool_input: { edits: [{ file_path: '/src/damp-multi.js', old_string: 'a', new_string: 'b' }] }
      });
      const output = parseOutput(result.stdout);
      assert.strictEqual(output.hookSpecificOutput.permissionDecision, 'deny');
      assert.ok(output.hookSpecificOutput.permissionDecisionReason.includes('denial #5'));
      assert.ok(!output.hookSpecificOutput.permissionDecisionReason.includes('present these facts'));
    })
  )
    passed++;
  else failed++;

  clearState();
  if (
    test('destructive Bash gate keeps the full message regardless of denial count', () => {
      writeState({ checked: ['__bash_session__'], last_active: Date.now(), fact_force_denials: 50 });
      const result = runBashHook({ tool_name: 'Bash', tool_input: { command: 'rm -rf /tmp/damp-target' } });
      const output = parseOutput(result.stdout);
      assert.strictEqual(output.hookSpecificOutput.permissionDecision, 'deny');
      assert.ok(output.hookSpecificOutput.permissionDecisionReason.includes('rollback'), 'destructive gate is exempt from dampening');
    })
  )
    passed++;
  else failed++;

  // --- Novos comandos Git read-only ---
  console.log('\n  Novos comandos Git read-only:');

  clearState();
  if (
    test('allows git diff --cached', () => {
      expectAllow('git diff --cached', 'git diff --cached');
    })
  )
    passed++;
  else failed++;

  clearState();
  if (
    test('allows git diff --staged', () => {
      expectAllow('git diff --staged', 'git diff --staged');
    })
  )
    passed++;
  else failed++;

  clearState();
  if (
    test('allows git diff --stat', () => {
      expectAllow('git diff --stat', 'git diff --stat');
    })
  )
    passed++;
  else failed++;

  clearState();
  if (
    test('allows git diff --name-only --cached', () => {
      expectAllow('git diff --name-only --cached', 'git diff --name-only --cached');
    })
  )
    passed++;
  else failed++;

  clearState();
  if (
    test('allows git show --stat', () => {
      expectAllow('git show --stat', 'git show --stat');
    })
  )
    passed++;
  else failed++;

  clearState();
  if (
    test('allows git show --name-only', () => {
      expectAllow('git show --name-only', 'git show --name-only');
    })
  )
    passed++;
  else failed++;

  clearState();
  if (
    test('allows git show HEAD --stat', () => {
      expectAllow('git show HEAD --stat', 'git show HEAD --stat');
    })
  )
    passed++;
  else failed++;

  clearState();
  if (
    test('allows git show HEAD --name-only', () => {
      expectAllow('git show HEAD --name-only', 'git show HEAD --name-only');
    })
  )
    passed++;
  else failed++;

  // Garantir que comandos destrutivos continuam negados
  clearState();
  if (
    test('still denies git reset --hard', () => {
      expectDestructiveDeny('git reset --hard', 'git reset --hard');
    })
  )
    passed++;
  else failed++;

  clearState();
  if (
    test('still denies git checkout -f', () => {
      expectDestructiveDeny('git checkout -f main', 'git checkout -f');
    })
  )
    passed++;
  else failed++;

  clearState();
  if (
    test('still denies git clean -fd', () => {
      expectDestructiveDeny('git clean -fd', 'git clean -fd');
    })
  )
    passed++;
  else failed++;

  clearState();
  if (
    test('still denies git push --force', () => {
      expectDestructiveDeny('git push --force origin main', 'git push --force');
    })
  )
    passed++;
  else failed++;

  // --- Exempt globs: GATEGUARD_EXEMPT_GLOBS skips first-touch fact-forcing ---
  clearState();
  if (
    test('exempts an Edit whose path matches GATEGUARD_EXEMPT_GLOBS', () => {
      const input = {
        tool_name: 'Edit',
        tool_input: { file_path: '/proj/tests/test_x.js', old_string: 'a', new_string: 'b' }
      };
      const result = runHook(input, { GATEGUARD_EXEMPT_GLOBS: '**/tests/**' });
      assert.strictEqual(result.code, 0, 'exit code should be 0');
      const output = parseOutput(result.stdout);
      assert.ok(output, 'should produce valid JSON output');
      if (output.hookSpecificOutput) {
        assert.notStrictEqual(output.hookSpecificOutput.permissionDecision, 'deny', 'exempt path must not be denied');
      } else {
        assert.strictEqual(output.tool_name, 'Edit', 'pass-through should preserve input');
      }
    })
  )
    passed++;
  else failed++;

  clearState();
  if (
    test('does NOT exempt a non-matching path under the same globs', () => {
      const input = {
        tool_name: 'Edit',
        tool_input: { file_path: '/proj/src/core/x.js', old_string: 'a', new_string: 'b' }
      };
      const result = runHook(input, { GATEGUARD_EXEMPT_GLOBS: '**/tests/**' });
      const output = parseOutput(result.stdout);
      assert.ok(output, 'should produce JSON output');
      assert.strictEqual(output.hookSpecificOutput.permissionDecision, 'deny', 'non-matching path still gated');
    })
  )
    passed++;
  else failed++;

  if (
    test('supports multiple comma-separated exempt globs (Write + non-match)', () => {
      const globs = '**/tests/**,**/scratchpad/**';
      clearState();
      const exempt = runHook(
        { tool_name: 'Write', tool_input: { file_path: '/tmp/x/scratchpad/s.js', content: 'x' } },
        { GATEGUARD_EXEMPT_GLOBS: globs }
      );
      const exemptOut = parseOutput(exempt.stdout);
      assert.ok(exemptOut, 'should produce JSON output');
      if (exemptOut.hookSpecificOutput) {
        assert.notStrictEqual(exemptOut.hookSpecificOutput.permissionDecision, 'deny', 'scratchpad path exempt');
      }
      clearState();
      const gated = runHook(
        { tool_name: 'Write', tool_input: { file_path: '/proj/src/s.js', content: 'x' } },
        { GATEGUARD_EXEMPT_GLOBS: globs }
      );
      const gatedOut = parseOutput(gated.stdout);
      assert.ok(gatedOut, 'should produce JSON output');
      assert.strictEqual(gatedOut.hookSpecificOutput.permissionDecision, 'deny', 'src path still gated');
    })
  )
    passed++;
  else failed++;

  clearState();
  if (
    test('is default-off: unset GATEGUARD_EXEMPT_GLOBS gates tests/ as before', () => {
      const input = {
        tool_name: 'Edit',
        tool_input: { file_path: '/proj/tests/test_x.js', old_string: 'a', new_string: 'b' }
      };
      const result = runHook(input, { GATEGUARD_EXEMPT_GLOBS: '' });
      const output = parseOutput(result.stdout);
      assert.ok(output, 'should produce JSON output');
      assert.strictEqual(output.hookSpecificOutput.permissionDecision, 'deny', 'no exemptions when unset');
    })
  )
    passed++;
  else failed++;

  // Cleanup only the temp directory created by this test file.
  try {
    if (fs.existsSync(stateDir)) {
      fs.rmSync(stateDir, { recursive: true, force: true });
    }
  } catch (err) {
    console.error(`  [cleanup] failed to remove ${stateDir}: ${err.message}`);
  }

  console.log(`\n  ${passed} passed, ${failed} failed\n`);
  process.exit(failed > 0 ? 1 : 0);
}

runTests();
