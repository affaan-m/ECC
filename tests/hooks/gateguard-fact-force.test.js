/**
 * Tests for scripts/hooks/gateguard-fact-force.js via run-with-flags.js
 */

const assert = require('assert');
const fs = require('fs');
const path = require('path');
const { spawnSync } = require('child_process');

const runner = path.join(__dirname, '..', '..', 'scripts', 'hooks', 'run-with-flags.js');
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
      last_active: Date.now() - (31 * 60 * 1000) // 31 minutes ago
    };
    fs.writeFileSync(stateFile, JSON.stringify(expired), 'utf8');
  } catch (_) { /* ignore */ }
}

function writeState(state) {
  fs.mkdirSync(stateDir, { recursive: true });
  fs.writeFileSync(stateFile, JSON.stringify(state), 'utf8');
}

function runHook(input, env = {}) {
  const rawInput = typeof input === 'string' ? input : JSON.stringify(input);
  const result = spawnSync('node', [
    runner,
    'pre:edit-write:gateguard-fact-force',
    'scripts/hooks/gateguard-fact-force.js',
    'standard,strict'
  ], {
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
  const result = spawnSync('node', [
    runner,
    'pre:bash:gateguard-fact-force',
    'scripts/hooks/gateguard-fact-force.js',
    'standard,strict'
  ], {
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

function runTests() {
  console.log('\n=== Testing gateguard-fact-force ===\n');

  let passed = 0;
  let failed = 0;

  // --- Test 1: denies first Edit per file ---
  clearState();
  if (test('denies first Edit per file with fact-forcing message', () => {
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
  })) passed++; else failed++;

  // --- Test 2: allows second Edit on same file ---
  if (test('allows second Edit on same file (gate already passed)', () => {
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
      assert.notStrictEqual(output.hookSpecificOutput.permissionDecision, 'deny',
        'should not deny second edit on same file');
    } else {
      // Pass-through: output matches original input (allow)
      assert.strictEqual(output.tool_name, 'Edit', 'pass-through should preserve input');
    }
  })) passed++; else failed++;

  // --- Test 3: denies first Write per file ---
  clearState();
  if (test('denies first Write per file with fact-forcing message', () => {
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
  })) passed++; else failed++;

  // --- Test 4: denies destructive Bash, allows retry ---
  clearState();
  if (test('denies destructive Bash commands, allows retry after facts presented', () => {
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
      assert.notStrictEqual(output2.hookSpecificOutput.permissionDecision, 'deny',
        'should not deny destructive bash retry after facts presented');
    } else {
      assert.strictEqual(output2.tool_name, 'Bash', 'pass-through should preserve input');
    }
  })) passed++; else failed++;

  // --- Test 5: denies first routine Bash, allows second ---
  clearState();
  if (test('denies first routine Bash, allows second', () => {
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
      assert.notStrictEqual(output2.hookSpecificOutput.permissionDecision, 'deny',
        'should not deny second routine bash');
    } else {
      assert.strictEqual(output2.tool_name, 'Bash', 'pass-through should preserve input');
    }
  })) passed++; else failed++;

  // --- Test 6: session state resets after timeout ---
  if (test('session state resets after 30-minute timeout', () => {
    writeExpiredState();
    const input = {
      tool_name: 'Edit',
      tool_input: { file_path: 'some_file.js', old_string: 'a', new_string: 'b' }
    };
    const result = runHook(input);
    assert.strictEqual(result.code, 0, 'exit code should be 0');
    const output = parseOutput(result.stdout);
    assert.ok(output, 'should produce JSON output after expired state');
    assert.strictEqual(output.hookSpecificOutput.permissionDecision, 'deny',
      'should deny again after session timeout (state was reset)');
  })) passed++; else failed++;

  // --- Test 7: allows unknown tool names ---
  clearState();
  if (test('allows unknown tool names through', () => {
    const input = {
      tool_name: 'Read',
      tool_input: { file_path: '/src/app.js' }
    };
    const result = runHook(input);
    assert.strictEqual(result.code, 0, 'exit code should be 0');
    const output = parseOutput(result.stdout);
    assert.ok(output, 'should produce valid JSON output');
    if (output.hookSpecificOutput) {
      assert.notStrictEqual(output.hookSpecificOutput.permissionDecision, 'deny',
        'should not deny unknown tool');
    } else {
      assert.strictEqual(output.tool_name, 'Read', 'pass-through should preserve input');
    }
  })) passed++; else failed++;

  // --- Test 8: sanitizes file paths with newlines ---
  clearState();
  if (test('sanitizes file paths containing newlines', () => {
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
  })) passed++; else failed++;

  // --- Test 9: respects ECC_DISABLED_HOOKS ---
  clearState();
  if (test('respects ECC_DISABLED_HOOKS (skips when disabled)', () => {
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
      assert.notStrictEqual(output.hookSpecificOutput.permissionDecision, 'deny',
        'should not deny when hook is disabled');
    } else {
      // When disabled, hook passes through raw input
      assert.strictEqual(output.tool_name, 'Edit', 'pass-through should preserve input');
    }
  })) passed++; else failed++;

  // --- Test 10: MultiEdit gates first unchecked file ---
  clearState();
  if (test('denies first MultiEdit with unchecked file', () => {
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
  })) passed++; else failed++;

  // --- Test 11: MultiEdit allows after all files gated ---
  if (test('allows MultiEdit after all files gated', () => {
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
      assert.notStrictEqual(output3.hookSpecificOutput.permissionDecision, 'deny',
        'should allow MultiEdit after all files gated');
    }
  })) passed++; else failed++;

  // --- Test 12: hot-path reads do not rewrite state within heartbeat ---
  clearState();
  if (test('does not rewrite state on hot-path reads within heartbeat window', () => {
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
      assert.notStrictEqual(output.hookSpecificOutput.permissionDecision, 'deny',
        'already-checked file should still be allowed');
    }

    const afterStat = fs.statSync(stateFile);
    const after = JSON.parse(fs.readFileSync(stateFile, 'utf8'));
    assert.strictEqual(after.last_active, recentlyActive, 'read should not touch last_active within heartbeat');
    assert.strictEqual(afterStat.mtimeMs, beforeStat.mtimeMs, 'read should not rewrite the state file within heartbeat');
  })) passed++; else failed++;

  // --- Test 13: reads refresh stale active state after heartbeat ---
  clearState();
  if (test('refreshes last_active after heartbeat elapses', () => {
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
      assert.notStrictEqual(output.hookSpecificOutput.permissionDecision, 'deny',
        'already-checked file should still be allowed');
    }

    const after = JSON.parse(fs.readFileSync(stateFile, 'utf8'));
    assert.ok(after.last_active > staleButActive, 'read should refresh last_active after heartbeat');
  })) passed++; else failed++;

  // --- Test 14: pruning preserves routine bash gate marker ---
  clearState();
  if (test('preserves __bash_session__ when pruning oversized state', () => {
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
      assert.notStrictEqual(output.hookSpecificOutput.permissionDecision, 'deny',
        'routine bash marker should survive pruning');
    }

    const persisted = JSON.parse(fs.readFileSync(stateFile, 'utf8'));
    assert.ok(persisted.checked.includes('__bash_session__'), 'pruned state should retain __bash_session__');
    assert.ok(persisted.checked.length <= 500, 'pruned state should still honor the checked-entry cap');
  })) passed++; else failed++;

  // --- Test 15: raw input session IDs provide stable retry state without env vars ---
  clearState();
  if (test('uses raw input session_id when hook env vars are missing', () => {
    const input = {
      session_id: 'raw-session-1234',
      tool_name: 'Bash',
      tool_input: { command: 'ls -la' }
    };

    const first = runBashHook(input, {
      CLAUDE_SESSION_ID: '',
      ECC_SESSION_ID: '',
    });
    const firstOutput = parseOutput(first.stdout);
    assert.strictEqual(firstOutput.hookSpecificOutput.permissionDecision, 'deny');

    const second = runBashHook(input, {
      CLAUDE_SESSION_ID: '',
      ECC_SESSION_ID: '',
    });
    const secondOutput = parseOutput(second.stdout);
    if (secondOutput.hookSpecificOutput) {
      assert.notStrictEqual(secondOutput.hookSpecificOutput.permissionDecision, 'deny',
        'retry should be allowed when raw session_id is stable');
    } else {
      assert.strictEqual(secondOutput.tool_name, 'Bash');
    }
  })) passed++; else failed++;

  // --- Test 16: allows Claude settings edits so the hook can be disabled safely ---
  clearState();
  if (test('allows edits to .claude/settings.json without gating', () => {
    const input = {
      tool_name: 'Edit',
      tool_input: { file_path: '/workspace/app/.claude/settings.json', old_string: '{}', new_string: '{"hooks":[]}' }
    };
    const result = runHook(input);
    const output = parseOutput(result.stdout);
    assert.ok(output, 'should produce valid JSON output');
    if (output.hookSpecificOutput) {
      assert.notStrictEqual(output.hookSpecificOutput.permissionDecision, 'deny',
        'settings edits must not be blocked by gateguard');
    } else {
      assert.strictEqual(output.tool_name, 'Edit');
    }
  })) passed++; else failed++;

  // --- Test 17: allows read-only git introspection without first-bash gating ---
  clearState();
  if (test('allows read-only git status without first-bash gating', () => {
    const input = {
      tool_name: 'Bash',
      tool_input: { command: 'git status --short' }
    };
    const result = runBashHook(input);
    const output = parseOutput(result.stdout);
    assert.ok(output, 'should produce valid JSON output');
    if (output.hookSpecificOutput) {
      assert.notStrictEqual(output.hookSpecificOutput.permissionDecision, 'deny',
        'read-only git introspection should not be blocked');
    } else {
      assert.strictEqual(output.tool_name, 'Bash');
    }
  })) passed++; else failed++;

  // --- Test 18: rejects mutating git commands that only share a prefix ---
  clearState();
  if (test('does not treat mutating git commands as read-only introspection', () => {
    const input = {
      tool_name: 'Bash',
      tool_input: { command: 'git status && rm -rf /tmp/demo' }
    };
    const result = runBashHook(input);
    const output = parseOutput(result.stdout);
    assert.ok(output, 'should produce valid JSON output');
    assert.strictEqual(output.hookSpecificOutput.permissionDecision, 'deny');
    assert.ok(output.hookSpecificOutput.permissionDecisionReason.includes('current instruction'));
  })) passed++; else failed++;

  // --- Test 19: long raw session IDs hash instead of collapsing to project fallback ---
  clearState();
  if (test('uses a stable hash for long raw session ids', () => {
    const longSessionId = `session-${'x'.repeat(120)}`;
    const input = {
      session_id: longSessionId,
      tool_name: 'Bash',
      tool_input: { command: 'ls -la' }
    };

    const first = runBashHook(input, {
      CLAUDE_SESSION_ID: '',
      ECC_SESSION_ID: '',
    });
    const firstOutput = parseOutput(first.stdout);
    assert.strictEqual(firstOutput.hookSpecificOutput.permissionDecision, 'deny');

    const stateFiles = fs.readdirSync(stateDir).filter(entry => entry.startsWith('state-') && entry.endsWith('.json'));
    assert.strictEqual(stateFiles.length, 1, 'long raw session id should still produce a dedicated state file');
    assert.ok(/state-sid-[a-f0-9]{24}\.json$/.test(stateFiles[0]), 'long raw session ids should hash to a bounded sid-* key');

    const second = runBashHook(input, {
      CLAUDE_SESSION_ID: '',
      ECC_SESSION_ID: '',
    });
    const secondOutput = parseOutput(second.stdout);
    if (secondOutput.hookSpecificOutput) {
      assert.notStrictEqual(secondOutput.hookSpecificOutput.permissionDecision, 'deny',
        'retry should be allowed when long raw session_id is stable');
    } else {
      assert.strictEqual(secondOutput.tool_name, 'Bash');
    }
  })) passed++; else failed++;

  // --- Test 20: GATEGUARD_BASH_ROUTINE_DISABLED skips routine gate ---
  clearState();
  if (test('skips routine bash gate when GATEGUARD_BASH_ROUTINE_DISABLED=1', () => {
    const input = {
      tool_name: 'Bash',
      tool_input: { command: 'ls -la' }
    };
    const result = runBashHook(input, { GATEGUARD_BASH_ROUTINE_DISABLED: '1' });
    assert.strictEqual(result.code, 0, 'exit code should be 0');
    const output = parseOutput(result.stdout);
    assert.ok(output, 'should produce valid JSON output');
    if (output.hookSpecificOutput) {
      assert.notStrictEqual(output.hookSpecificOutput.permissionDecision, 'deny',
        'should not deny routine bash when disabled');
    } else {
      assert.strictEqual(output.tool_name, 'Bash', 'pass-through should preserve input');
    }
  })) passed++; else failed++;

  // --- Test 21: GATEGUARD_BASH_EXTRA_DESTRUCTIVE adds custom literal patterns ---
  clearState();
  if (test('denies commands matching GATEGUARD_BASH_EXTRA_DESTRUCTIVE literal patterns', () => {
    const input = {
      tool_name: 'Bash',
      tool_input: { command: 'supabase db reset --force' }
    };
    const extraPattern = 'supabase db reset';

    // First call: should deny on the extra pattern
    const result1 = runBashHook(input, { GATEGUARD_BASH_EXTRA_DESTRUCTIVE: extraPattern });
    assert.strictEqual(result1.code, 0, 'first call exit code should be 0');
    const output1 = parseOutput(result1.stdout);
    assert.ok(output1, 'first call should produce JSON output');
    assert.strictEqual(output1.hookSpecificOutput.permissionDecision, 'deny');
    assert.ok(output1.hookSpecificOutput.permissionDecisionReason.includes('Destructive'));

    // Second call (retry): should allow
    const result2 = runBashHook(input, { GATEGUARD_BASH_EXTRA_DESTRUCTIVE: extraPattern });
    assert.strictEqual(result2.code, 0, 'second call exit code should be 0');
    const output2 = parseOutput(result2.stdout);
    assert.ok(output2, 'second call should produce valid JSON output');
    if (output2.hookSpecificOutput) {
      assert.notStrictEqual(output2.hookSpecificOutput.permissionDecision, 'deny',
        'should allow retry after facts presented');
    } else {
      assert.strictEqual(output2.tool_name, 'Bash', 'pass-through should preserve input');
    }
  })) passed++; else failed++;

  // --- Test 22: extra destructive patterns are literals, not raw regexes ---
  clearState();
  if (test('treats GATEGUARD_BASH_EXTRA_DESTRUCTIVE as pipe-separated literals', () => {
    const routineInput = {
      tool_name: 'Bash',
      tool_input: { command: 'aaaaaaaaaaaaaaaaaaaaaaaa!' }
    };
    const literalInput = {
      tool_name: 'Bash',
      tool_input: { command: '(a+)+$' }
    };

    const result1 = runBashHook(routineInput, { GATEGUARD_BASH_EXTRA_DESTRUCTIVE: '(a+)+$' });
    assert.strictEqual(result1.code, 0, 'literal regex-like value should not hang or crash');
    const output1 = parseOutput(result1.stdout);
    assert.ok(output1, 'routine command should produce valid JSON output');
    assert.strictEqual(output1.hookSpecificOutput.permissionDecision, 'deny',
      'non-matching routine command should use the routine bash gate');
    assert.ok(output1.hookSpecificOutput.permissionDecisionReason.includes('current instruction'));

    clearState();
    const result2 = runBashHook(literalInput, { GATEGUARD_BASH_EXTRA_DESTRUCTIVE: '(a+)+$' });
    assert.strictEqual(result2.code, 0, 'literal extra pattern call should exit cleanly');
    const output2 = parseOutput(result2.stdout);
    assert.ok(output2, 'literal matching command should produce valid JSON output');
    assert.strictEqual(output2.hookSpecificOutput.permissionDecision, 'deny');
    assert.ok(output2.hookSpecificOutput.permissionDecisionReason.includes('Destructive'));
  })) passed++; else failed++;

  // --- Test 23: destructive gating must not be weakened by routine bash opt-out ---
  clearState();
  if (test('still gates destructive commands when GATEGUARD_BASH_ROUTINE_DISABLED=1', () => {
    const input = {
      tool_name: 'Bash',
      tool_input: { command: 'rm -rf /important/data' }
    };
    const result = runBashHook(input, { GATEGUARD_BASH_ROUTINE_DISABLED: '1' });
    assert.strictEqual(result.code, 0, 'exit code should be 0');
    const output = parseOutput(result.stdout);
    assert.ok(output, 'should produce JSON output');
    assert.strictEqual(output.hookSpecificOutput.permissionDecision, 'deny',
      'destructive commands must still be gated even when routine bash is disabled');
    assert.ok(output.hookSpecificOutput.permissionDecisionReason.includes('Destructive'),
      'deny reason must indicate destructive command');
  })) passed++; else failed++;


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
