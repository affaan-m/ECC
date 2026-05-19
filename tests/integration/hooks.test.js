/**
 * Integration tests for hook scripts
 *
 * Tests hook behavior in realistic scenarios with proper input/output handling.
 *
 * Run with: node tests/integration/hooks.test.js
 */

const assert = require('assert');
const crypto = require('crypto');
const path = require('path');
const fs = require('fs');
const os = require('os');
const { spawn } = require('child_process');
const REPO_ROOT = path.join(__dirname, '..', '..');

// Test helper
function _test(name, fn) {
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

    // Ignore EPIPE/EOF errors (process may exit before we finish writing)
    // Windows uses EOF instead of EPIPE for closed pipe writes
    proc.stdin.on('error', (err) => {
      if (err.code !== 'EPIPE' && err.code !== 'EOF') {
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

function getSessionStartPayload(stdout) {
  assert.ok(stdout.trim(), 'Expected SessionStart hook to emit stdout payload');
  const payload = JSON.parse(stdout);
  assert.strictEqual(payload.hookSpecificOutput?.hookEventName, 'SessionStart');
  assert.strictEqual(typeof payload.hookSpecificOutput?.additionalContext, 'string');
  return payload;
}

/**
 * Run a hook command string exactly as declared in hooks.json.
 * Supports wrapped node script commands and shell wrappers.
 * @param {string} command - Hook command from hooks.json
 * @param {object} input - Hook input object
 * @param {object} env - Environment variables
 */
function runHookCommand(command, input = {}, env = {}, timeoutMs = 10000) {
  return new Promise((resolve, reject) => {
    const isWindows = process.platform === 'win32';
    const mergedEnv = { ...process.env, CLAUDE_PLUGIN_ROOT: REPO_ROOT, ...env };
    if (Array.isArray(command)) {
      const [program, ...args] = command;
      const proc = spawn(program, args, { env: mergedEnv, stdio: ['pipe', 'pipe', 'pipe'] });

      let stdout = '';
      let stderr = '';
      let timer;

      proc.stdout.on('data', data => stdout += data);
      proc.stderr.on('data', data => stderr += data);

      proc.stdin.on('error', (err) => {
        if (err.code !== 'EPIPE' && err.code !== 'EOF') {
          if (timer) clearTimeout(timer);
          reject(err);
        }
      });

      if (input && Object.keys(input).length > 0) {
        proc.stdin.write(JSON.stringify(input));
      }
      proc.stdin.end();

      timer = setTimeout(() => {
        proc.kill(isWindows ? undefined : 'SIGKILL');
        reject(new Error(`Hook command timed out after ${timeoutMs}ms`));
      }, timeoutMs);

      proc.on('close', code => {
        clearTimeout(timer);
        resolve({ code, stdout, stderr });
      });

      proc.on('error', err => {
        clearTimeout(timer);
        reject(err);
      });
      return;
    }

    const resolvedCommand = command.replace(
      /\$\{([A-Z_][A-Z0-9_]*)\}/g,
      (_, name) => String(mergedEnv[name] || '')
    );

    const inlineNodeMatch = resolvedCommand.match(/^node -e "((?:[^"\\]|\\.)*)"(?:\s+(.*))?$/s);
    const fileNodeMatch = resolvedCommand.match(/^node\s+"([^"]+)"\s*(.*)$/);
    const useDirectNodeSpawn = Boolean(inlineNodeMatch || fileNodeMatch);
    const shell = isWindows ? 'cmd' : 'bash';
    const shellArgs = isWindows ? ['/d', '/s', '/c', resolvedCommand] : ['-lc', resolvedCommand];
    const splitArgs = value => Array.from(
      String(value || '').matchAll(/"([^"]*)"|(\S+)/g),
      m => m[1] !== undefined ? m[1] : m[2]
    );
    const unescapeInlineJs = value => value
      .replace(/\\\\/g, '\\')
      .replace(/\\"/g, '"')
      .replace(/\\n/g, '\n')
      .replace(/\\t/g, '\t');
    const nodeArgs = inlineNodeMatch
      ? ['-e', unescapeInlineJs(inlineNodeMatch[1]), ...splitArgs(inlineNodeMatch[2])]
      : fileNodeMatch
        ? [fileNodeMatch[1], ...splitArgs(fileNodeMatch[2])]
        : [];

    const proc = useDirectNodeSpawn
      ? spawn('node', nodeArgs, { env: mergedEnv, stdio: ['pipe', 'pipe', 'pipe'] })
      : spawn(shell, shellArgs, { env: mergedEnv, stdio: ['pipe', 'pipe', 'pipe'] });

    let stdout = '';
    let stderr = '';
    let timer;

    proc.stdout.on('data', data => stdout += data);
    proc.stderr.on('data', data => stderr += data);

    // Ignore EPIPE/EOF errors (process may exit before we finish writing)
    proc.stdin.on('error', (err) => {
      if (err.code !== 'EPIPE' && err.code !== 'EOF') {
        if (timer) clearTimeout(timer);
        reject(err);
      }
    });

    if (input && Object.keys(input).length > 0) {
      proc.stdin.write(JSON.stringify(input));
    }
    proc.stdin.end();

    timer = setTimeout(() => {
      proc.kill(isWindows ? undefined : 'SIGKILL');
      reject(new Error(`Hook command timed out after ${timeoutMs}ms`));
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

// Create a temporary test directory
function createTestDir() {
  return fs.mkdtempSync(path.join(os.tmpdir(), 'hook-integration-test-'));
}

// Clean up test directory
function cleanupTestDir(testDir) {
  fs.rmSync(testDir, { recursive: true, force: true });
}

function getTestHomunculusEnv(testDir) {
  const xdgDataHome = path.join(testDir, '.local', 'share');
  return {
    HOME: testDir,
    XDG_DATA_HOME: xdgDataHome,
    homunculusDir: path.join(xdgDataHome, 'ecc-homunculus'),
  };
}

function writeInstinctFile(filePath, entries) {
  const body = entries.map(entry => `---
id: ${entry.id}
trigger: "${entry.trigger}"
confidence: ${entry.confidence}
domain: ${entry.domain || 'general'}
scope: ${entry.scope}
---

## Action
${entry.action}

## Evidence
${entry.evidence || 'Learned from repeated observations.'}
`).join('\n');

  fs.mkdirSync(path.dirname(filePath), { recursive: true });
  fs.writeFileSync(filePath, body);
}

function getHookCommandByDescription(hooks, lifecycle, descriptionText) {
  const hookGroup = hooks.hooks[lifecycle]?.find(
    entry => entry.description && entry.description.includes(descriptionText)
  );

  assert.ok(hookGroup, `Expected ${lifecycle} hook matching "${descriptionText}"`);
  assert.ok(hookGroup.hooks?.[0]?.command, `Expected ${lifecycle} hook command for "${descriptionText}"`);
  return hookGroup.hooks[0].command;
}

function getHookCommandById(hooks, lifecycle, hookId) {
  const hookGroup = hooks.hooks[lifecycle]?.find(entry => entry.id === hookId);

  assert.ok(hookGroup, `Expected ${lifecycle} hook with id "${hookId}"`);
  assert.ok(hookGroup.hooks?.[0]?.command, `Expected ${lifecycle} hook command for id "${hookId}"`);
  return hookGroup.hooks[0].command;
}

// Test suite
async function runTests() {
  console.log('\n=== Hook Integration Tests ===\n');

  let passed = 0;
  let failed = 0;

  const scriptsDir = path.join(__dirname, '..', '..', 'scripts', 'hooks');
  const hooksJsonPath = path.join(__dirname, '..', '..', 'hooks', 'hooks.json');
  const hooks = JSON.parse(fs.readFileSync(hooksJsonPath, 'utf8'));

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
    // Test the console.log warning hook with valid input
    const command = 'node -e "const fs=require(\'fs\');let d=\'\';process.stdin.on(\'data\',c=>d+=c);process.stdin.on(\'end\',()=>{const i=JSON.parse(d);const p=i.tool_input?.file_path||\'\';console.log(\'Path:\',p)})"';
    const match = command.match(/^node -e "(.+)"$/s);

    const proc = spawn('node', ['-e', match[1]], {
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

  if (await asyncTest('session-start logs diagnostics to stderr and emits structured stdout when context exists', async () => {
    const result = await runHookWithInput(path.join(scriptsDir, 'session-start.js'), {});
    // Session-start should write info to stderr
    assert.ok(result.stderr.length > 0, 'Should have stderr output');
    assert.ok(result.stderr.includes('[SessionStart]'), 'Should have [SessionStart] prefix');
    const payload = getSessionStartPayload(result.stdout);
    assert.ok(payload.hookSpecificOutput, 'Should include hookSpecificOutput');
    assert.strictEqual(payload.hookSpecificOutput.hookEventName, 'SessionStart');
  })) passed++; else failed++;

  if (await asyncTest('PreCompact hook logs to stderr', async () => {
    const result = await runHookWithInput(path.join(scriptsDir, 'pre-compact.js'), {});
    assert.ok(result.stderr.includes('[PreCompact]'), 'Should output to stderr with prefix');
  })) passed++; else failed++;

  if (await asyncTest('dev server hook transforms command to tmux session', async () => {
    const hookCommand = getHookCommandById(hooks, 'PreToolUse', 'pre:bash:dispatcher');
    const result = await runHookCommand(hookCommand, {
      tool_input: { command: 'npm run dev' }
    });

    assert.strictEqual(result.code, 0, 'Hook should exit 0 (transforms, does not block)');
    // On Unix with tmux, stdout contains transformed JSON with tmux command
    // On Windows or without tmux, stdout contains original JSON passthrough
    const output = result.stdout.trim();
    if (output) {
      const parsed = JSON.parse(output);
      assert.ok(parsed.tool_input, 'Should output valid JSON with tool_input');
    }
  })) passed++; else failed++;

  // ==========================================
  // Exit Code Tests
  // ==========================================
  console.log('\nHook Exit Codes:');

  if (await asyncTest('non-blocking hooks exit with code 0', async () => {
    const result = await runHookWithInput(path.join(scriptsDir, 'session-end.js'), {});
    assert.strictEqual(result.code, 0, 'Non-blocking hook should exit 0');
  })) passed++; else failed++;

  if (await asyncTest('session-start registers an observer lease for the active session', async () => {
    const testDir = createTestDir();
    const projectDir = path.join(testDir, 'project');
    fs.mkdirSync(projectDir, { recursive: true });

    try {
      const sessionId = `session-${Date.now()}`;
      const homunculusEnv = getTestHomunculusEnv(testDir);
      const result = await runHookWithInput(
        path.join(scriptsDir, 'session-start.js'),
        {},
        {
          HOME: homunculusEnv.HOME,
          XDG_DATA_HOME: homunculusEnv.XDG_DATA_HOME,
          CLAUDE_PROJECT_DIR: projectDir,
          CLAUDE_SESSION_ID: sessionId
        }
      );

      assert.strictEqual(result.code, 0, 'SessionStart should exit 0');
      const projectsDir = path.join(homunculusEnv.homunculusDir, 'projects');
      const projectEntries = fs.existsSync(projectsDir) ? fs.readdirSync(projectsDir) : [];
      assert.ok(projectEntries.length > 0, 'SessionStart should create a homunculus project directory');
      const leaseDir = path.join(projectsDir, projectEntries[0], '.observer-sessions');
      const leaseFiles = fs.existsSync(leaseDir) ? fs.readdirSync(leaseDir).filter(name => name.endsWith('.json')) : [];
      assert.ok(leaseFiles.length === 1, `Expected one observer lease file, found ${leaseFiles.length}`);
    } finally {
      cleanupTestDir(testDir);
    }
  })) passed++; else failed++;

  if (await asyncTest('session-start injects high-confidence instincts into additionalContext', async () => {
    const testDir = createTestDir();
    const projectDir = path.join(testDir, 'project');
    fs.mkdirSync(projectDir, { recursive: true });

    try {
      const projectId = crypto.createHash('sha256').update(projectDir).digest('hex').slice(0, 12);
      const homunculusEnv = getTestHomunculusEnv(testDir);
      const homunculusDir = homunculusEnv.homunculusDir;
      const projectInstinctDir = path.join(homunculusDir, 'projects', projectId, 'instincts', 'personal');
      const globalInstinctDir = path.join(homunculusDir, 'instincts', 'inherited');

      writeInstinctFile(path.join(projectInstinctDir, 'project-instincts.yaml'), [
        {
          id: 'project-tests-first',
          trigger: 'when changing tests',
          confidence: 0.9,
          scope: 'project',
          action: 'Run the targeted *.test.js file first, then widen to node tests/run-all.js.',
        },
        {
          id: 'project-low-confidence',
          trigger: 'when guessing',
          confidence: 0.4,
          scope: 'project',
          action: 'This should never be injected.',
        },
      ]);

      writeInstinctFile(path.join(globalInstinctDir, 'global-instincts.yaml'), [
        {
          id: 'global-validation',
          trigger: 'when editing hooks',
          confidence: 0.82,
          scope: 'global',
          action: 'Keep hook scripts, tests, and docs aligned in the same change set.',
        },
      ]);

      const result = await runHookWithInput(
        path.join(scriptsDir, 'session-start.js'),
        {},
        {
          HOME: homunculusEnv.HOME,
          XDG_DATA_HOME: homunculusEnv.XDG_DATA_HOME,
          CLAUDE_PROJECT_DIR: projectDir,
        }
      );

      assert.strictEqual(result.code, 0, 'SessionStart should exit 0');
      const payload = getSessionStartPayload(result.stdout);
      const additionalContext = payload.hookSpecificOutput.additionalContext;

      assert.ok(additionalContext.includes('Active instincts:'), 'Should inject instinct summary into additionalContext');
      assert.ok(additionalContext.includes('[project 90%] Run the targeted *.test.js file first, then widen to node tests/run-all.js.'), 'Should include project-scoped instinct');
      assert.ok(additionalContext.includes('[global 82%] Keep hook scripts, tests, and docs aligned in the same change set.'), 'Should include global instinct');
      assert.ok(!additionalContext.includes('This should never be injected.'), 'Should exclude low-confidence instincts');
    } finally {
      cleanupTestDir(testDir);
    }
  })) passed++; else failed++;

  if (await asyncTest('session-end-marker removes the last lease and stops the observer process', async () => {
    const testDir = createTestDir();
    const projectDir = path.join(testDir, 'project');
    fs.mkdirSync(projectDir, { recursive: true });

    const sessionId = `session-${Date.now()}`;
    const sleeper = spawn(process.execPath, ['-e', "process.on('SIGTERM', () => process.exit(0)); setInterval(() => {}, 1000)"], {
      stdio: 'ignore'
    });

    try {
      const homunculusEnv = getTestHomunculusEnv(testDir);
      await runHookWithInput(
        path.join(scriptsDir, 'session-start.js'),
        {},
        {
          HOME: homunculusEnv.HOME,
          XDG_DATA_HOME: homunculusEnv.XDG_DATA_HOME,
          CLAUDE_PROJECT_DIR: projectDir,
          CLAUDE_SESSION_ID: sessionId
        }
      );

      const projectsDir = path.join(homunculusEnv.homunculusDir, 'projects');
      const projectEntries = fs.existsSync(projectsDir) ? fs.readdirSync(projectsDir) : [];
      assert.ok(projectEntries.length > 0, 'Expected SessionStart to create a homunculus project directory');
      const projectStorageDir = path.join(projectsDir, projectEntries[0]);
      const pidFile = path.join(projectStorageDir, '.observer.pid');
      fs.writeFileSync(pidFile, `${sleeper.pid}\n`);

      const markerInput = { hook_event_name: 'SessionEnd' };
      const result = await runHookWithInput(
        path.join(scriptsDir, 'session-end-marker.js'),
        markerInput,
        {
          HOME: homunculusEnv.HOME,
          XDG_DATA_HOME: homunculusEnv.XDG_DATA_HOME,
          CLAUDE_PROJECT_DIR: projectDir,
          CLAUDE_SESSION_ID: sessionId
        }
      );

      assert.strictEqual(result.code, 0, 'SessionEnd marker should exit 0');
      assert.strictEqual(result.stdout, JSON.stringify(markerInput), 'SessionEnd marker should pass stdin through unchanged');

      await new Promise(resolve => setTimeout(resolve, 150));
      const exited = sleeper.exitCode !== null || sleeper.signalCode !== null;
      let processAlive = !exited;
      if (processAlive) {
        try {
          process.kill(sleeper.pid, 0);
        } catch {
          processAlive = false;
        }
      }
      assert.strictEqual(processAlive, false, 'SessionEnd marker should stop the observer process when the last lease ends');

      const leaseDir = path.join(projectStorageDir, '.observer-sessions');
      const leaseFiles = fs.existsSync(leaseDir) ? fs.readdirSync(leaseDir).filter(name => name.endsWith('.json')) : [];
      assert.strictEqual(leaseFiles.length, 0, 'SessionEnd marker should remove the finished session lease');
      assert.strictEqual(fs.existsSync(pidFile), false, 'SessionEnd marker should remove the observer pid file after stopping it');
    } finally {
      sleeper.kill();
      cleanupTestDir(testDir);
    }
  })) passed++; else failed++;

  if (await asyncTest('dev server hook transforms yarn dev to tmux session', async () => {
    const hookCommand = getHookCommandById(hooks, 'PreToolUse', 'pre:bash:dispatcher');
    const result = await runHookCommand(hookCommand, {
      tool_input: { command: 'yarn dev' }
    });

    // Hook always exits 0 — it transforms, never blocks
    assert.strictEqual(result.code, 0, 'Hook should exit 0 (transforms, does not block)');
    const output = result.stdout.trim();
    if (output) {
      const parsed = JSON.parse(output);
      assert.ok(parsed.tool_input, 'Should output valid JSON with tool_input');
      assert.ok(parsed.tool_input.command, 'Should have a command in output');
    }
  })) passed++; else failed++;

  if (await asyncTest('MCP health hook blocks unhealthy MCP tool calls through hooks.json', async () => {
    const hookCommand = getHookCommandByDescription(
      hooks,
      'PreToolUse',
      'Check MCP server health before MCP tool execution'
    );

    const testDir = createTestDir();
    const configPath = path.join(testDir, 'claude.json');
    const statePath = path.join(testDir, 'mcp-health.json');
    const serverScript = path.join(testDir, 'broken-mcp.js');

    try {
      fs.writeFileSync(serverScript, 'process.exit(1);\n');
      fs.writeFileSync(
        configPath,
        JSON.stringify({
          mcpServers: {
            broken: {
              command: process.execPath,
              args: [serverScript]
            }
          }
        })
      );

      const result = await runHookCommand(
        hookCommand,
        { tool_name: 'mcp__broken__search', tool_input: {} },
        {
          CLAUDE_HOOK_EVENT_NAME: 'PreToolUse',
          ECC_MCP_CONFIG_PATH: configPath,
          ECC_MCP_HEALTH_STATE_PATH: statePath,
          ECC_MCP_HEALTH_TIMEOUT_MS: '1000'
        }
      );

      assert.strictEqual(result.code, 2, 'Expected unhealthy MCP preflight to block');
      assert.ok(result.stderr.includes('broken is unavailable'), `Expected health warning, got: ${result.stderr}`);
    } finally {
      cleanupTestDir(testDir);
    }
  })) passed++; else failed++;

  if (await asyncTest('hooks handle missing files gracefully', async () => {
    const testDir = createTestDir();
    const transcriptPath = path.join(testDir, 'nonexistent.jsonl');

    try {
      const result = await runHookWithInput(
        path.join(scriptsDir, 'evaluate-session.js'),
        { transcript_path: transcriptPath }
      );

      // Should not crash, just skip processing
      assert.strictEqual(result.code, 0, 'Should exit 0 for missing file');
    } finally {
      cleanupTestDir(testDir);
    }
  })) passed++; else failed++;

  // ==========================================
  // Realistic Scenario Tests
  // ==========================================
  console.log('\nRealistic Scenarios:');

  if (await asyncTest('suggest-compact increments and triggers at threshold', async () => {
    const sessionId = 'integration-test-' + Date.now();
    const counterFile = path.join(os.tmpdir(), `claude-tool-count-${sessionId}`);

    try {
      // Set counter just below threshold
      fs.writeFileSync(counterFile, '49');

      const result = await runHookWithInput(
        path.join(scriptsDir, 'suggest-compact.js'),
        {},
        { CLAUDE_SESSION_ID: sessionId, COMPACT_THRESHOLD: '50' }
      );

      assert.ok(
        result.stderr.includes('50 tool calls'),
        'Should suggest compact at threshold'
      );
    } finally {
      if (fs.existsSync(counterFile)) fs.unlinkSync(counterFile);
    }
  })) passed++; else failed++;

  if (await asyncTest('evaluate-session processes transcript with sufficient messages', async () => {
    const testDir = createTestDir();
    const transcriptPath = path.join(testDir, 'transcript.jsonl');

    // Create a transcript with 15 user messages
    const messages = Array(15).fill(null).map((_, i) => ({
      type: 'user',
      content: `Test message ${i + 1}`
    }));

    fs.writeFileSync(
      transcriptPath,
      messages.map(m => JSON.stringify(m)).join('\n')
    );

    try {
      const result = await runHookWithInput(
        path.join(scriptsDir, 'evaluate-session.js'),
        { transcript_path: transcriptPath }
      );

      assert.ok(result.stderr.includes('15 messages'), 'Should process session');
    } finally {
      cleanupTestDir(testDir);
    }
  })) passed++; else failed++;

  if (await asyncTest('PostToolUse PR hook extracts PR URL', async () => {
    const hookCommand = getHookCommandById(hooks, 'PostToolUse', 'post:bash:dispatcher');
    const result = await runHookCommand(hookCommand, {
      tool_input: { command: 'gh pr create --title "Test"' },
      tool_output: { output: 'Creating pull request...\nhttps://github.com/owner/repo/pull/123' }
    });

    assert.ok(
      result.stderr.includes('PR created') || result.stderr.includes('github.com'),
      'Should extract and log PR URL'
    );
  })) passed++; else failed++;

  // ==========================================
  // Session End Transcript Parsing Tests
  // ==========================================
  console.log('\nSession End Transcript Parsing:');

  if (await asyncTest('session-end extracts summary from mixed JSONL formats', async () => {
    const testDir = createTestDir();
    const transcriptPath = path.join(testDir, 'mixed-transcript.jsonl');

    // Create transcript with both direct tool_use and nested assistant message formats
    const lines = [
      JSON.stringify({ type: 'user', content: 'Fix the login bug' }),
      JSON.stringify({ type: 'tool_use', name: 'Read', input: { file_path: 'src/auth.ts' } }),
      JSON.stringify({ type: 'assistant', message: { content: [
        { type: 'tool_use', name: 'Edit', input: { file_path: 'src/auth.ts' } }
      ]}}),
      JSON.stringify({ type: 'user', content: 'Now add tests' }),
      JSON.stringify({ type: 'assistant', message: { content: [
        { type: 'tool_use', name: 'Write', input: { file_path: 'tests/auth.test.ts' } },
        { type: 'text', text: 'Here are the tests' }
      ]}}),
      JSON.stringify({ type: 'user', content: 'Looks good, commit' })
    ];
    fs.writeFileSync(transcriptPath, lines.join('\n'));

    try {
      const result = await runHookWithInput(
        path.join(scriptsDir, 'session-end.js'),
        { transcript_path: transcriptPath },
        { HOME: testDir, USERPROFILE: testDir }
      );

      assert.strictEqual(result.code, 0, 'Should exit 0');
      assert.ok(result.stderr.includes('[SessionEnd]'), 'Should have SessionEnd log');

      // Verify a session file was created
      const sessionsDir = path.join(testDir, '.claude', 'sessions');
      if (fs.existsSync(sessionsDir)) {
        const files = fs.readdirSync(sessionsDir).filter(f => f.endsWith('.tmp'));
        assert.ok(files.length > 0, 'Should create a session file');

        // Verify session content includes tasks from user messages
        const content = fs.readFileSync(path.join(sessionsDir, files[0]), 'utf8');
        assert.ok(content.includes('Fix the login bug'), 'Should include first user message');
        assert.ok(content.includes('auth.ts'), 'Should include modified files');
      }
    } finally {
      cleanupTestDir(testDir);
    }
  })) passed++; else failed++;

  if (await asyncTest('session-end handles transcript with malformed lines gracefully', async () => {
    const testDir = createTestDir();
    const transcriptPath = path.join(testDir, 'malformed-transcript.jsonl');

    const lines = [
      JSON.stringify({ type: 'user', content: 'Task 1' }),
      '{broken json here',
      JSON.stringify({ type: 'user', content: 'Task 2' }),
      '{"truncated":',
      JSON.stringify({ type: 'user', content: 'Task 3' })
    ];
    fs.writeFileSync(transcriptPath, lines.join('\n'));

    try {
      const result = await runHookWithInput(
        path.join(scriptsDir, 'session-end.js'),
        { transcript_path: transcriptPath },
        { HOME: testDir, USERPROFILE: testDir }
      );

      assert.strictEqual(result.code, 0, 'Should exit 0 despite malformed lines');
      // Should still process the valid lines
      assert.ok(result.stderr.includes('[SessionEnd]'), 'Should have SessionEnd log');
      assert.ok(result.stderr.includes('unparseable'), 'Should warn about unparseable lines');
    } finally {
      cleanupTestDir(testDir);
    }
  })) passed++; else failed++;

  if (await asyncTest('session-end creates session file with nested user messages', async () => {
    const testDir = createTestDir();
    const transcriptPath = path.join(testDir, 'nested-transcript.jsonl');

    // Claude Code JSONL format uses nested message.content arrays
    const lines = [
      JSON.stringify({ type: 'user', message: { role: 'user', content: [
        { type: 'text', text: 'Refactor the utils module' }
      ]}}),
      JSON.stringify({ type: 'assistant', message: { content: [
        { type: 'tool_use', name: 'Read', input: { file_path: 'lib/utils.js' } }
      ]}}),
      JSON.stringify({ type: 'user', message: { role: 'user', content: 'Approve the changes' }})
    ];
    fs.writeFileSync(transcriptPath, lines.join('\n'));

    try {
      const result = await runHookWithInput(
        path.join(scriptsDir, 'session-end.js'),
        { transcript_path: transcriptPath },
        { HOME: testDir, USERPROFILE: testDir }
      );

      assert.strictEqual(result.code, 0, 'Should exit 0');

      // Check session file was created
      const sessionsDir = path.join(testDir, '.claude', 'sessions');
      if (fs.existsSync(sessionsDir)) {
        const files = fs.readdirSync(sessionsDir).filter(f => f.endsWith('.tmp'));
        assert.ok(files.length > 0, 'Should create session file');
        const content = fs.readFileSync(path.join(sessionsDir, files[0]), 'utf8');
        assert.ok(content.includes('Refactor the utils module') || content.includes('Approve'),
          'Should extract user messages from nested format');
      }
    } finally {
      cleanupTestDir(testDir);
    }
  })) passed++; else failed++;

  // ==========================================
  // Error Handling Tests
  // ==========================================
  console.log('\nError Handling:');

  if (await asyncTest('hooks do not crash on unexpected input structure', async () => {
    const result = await runHookWithInput(
      path.join(scriptsDir, 'suggest-compact.js'),
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

  if (await asyncTest('hooks survive stdin exceeding 1MB limit', async () => {
    // The post-edit-console-warn hook reads stdin up to 1MB then passes through
    // Send > 1MB to verify truncation doesn't crash the hook
    const oversizedInput = JSON.stringify({
      tool_input: { file_path: '/test.js' },
      tool_output: { output: 'x'.repeat(1200000) } // ~1.2MB
    });

    const proc = spawn('node', [path.join(scriptsDir, 'post-edit-console-warn.js')], {
      stdio: ['pipe', 'pipe', 'pipe']
    });

    let code = null;
    // MUST drain stdout/stderr to prevent backpressure blocking the child process
    proc.stdout.on('data', () => {});
    proc.stderr.on('data', () => {});
    proc.stdin.on('error', (err) => {
      if (err.code !== 'EPIPE' && err.code !== 'EOF') throw err;
    });
    proc.stdin.write(oversizedInput);
    proc.stdin.end();

    await new Promise(resolve => {
      proc.on('close', (c) => { code = c; resolve(); });
    });

    assert.strictEqual(code, 0, 'Should exit 0 despite oversized input');
  })) passed++; else failed++;

  if (await asyncTest('hooks handle truncated JSON from overflow gracefully', async () => {
    // session-end parses stdin JSON. If input is > 1MB and truncated mid-JSON,
    // JSON.parse should fail and fall back to env var
    const proc = spawn('node', [path.join(scriptsDir, 'session-end.js')], {
      stdio: ['pipe', 'pipe', 'pipe']
    });

    let code = null;
    let stderr = '';
    // MUST drain stdout to prevent backpressure blocking the child process
    proc.stdout.on('data', () => {});
    proc.stderr.on('data', data => stderr += data);
    proc.stdin.on('error', (err) => {
      if (err.code !== 'EPIPE' && err.code !== 'EOF') throw err;
    });

    // Build a string that will be truncated mid-JSON at 1MB
    const bigValue = 'x'.repeat(1200000);
    proc.stdin.write(`{"transcript_path":"/tmp/none","padding":"${bigValue}"}`);
    proc.stdin.end();

    await new Promise(resolve => {
      proc.on('close', (c) => { code = c; resolve(); });
    });

    // Should exit 0 even if JSON parse fails (falls back to env var or null)
    assert.strictEqual(code, 0, 'Should not crash on truncated JSON');
  })) passed++; else failed++;

  // ==========================================
  // Round 51: Timeout Enforcement
  // ==========================================
  console.log('\nRound 51: Timeout Enforcement:');

  if (await asyncTest('runHookWithInput kills hanging hooks after timeout', async () => {
    const testDir = createTestDir();
    const hangingHookPath = path.join(testDir, 'hanging-hook.js');
    fs.writeFileSync(hangingHookPath, 'setInterval(() => {}, 100);');

    try {
      const startTime = Date.now();
      let error = null;

      try {
        await runHookWithInput(hangingHookPath, {}, {}, 500);
      } catch (err) {
        error = err;
      }

      const elapsed = Date.now() - startTime;
      assert.ok(error, 'Should throw timeout error');
      assert.ok(error.message.includes('timed out'), 'Error should mention timeout');
      assert.ok(elapsed >= 450, `Should wait at least ~500ms, waited ${elapsed}ms`);
      assert.ok(elapsed < 2000, `Should not wait much longer than 500ms, waited ${elapsed}ms`);
    } finally {
      cleanupTestDir(testDir);
    }
  })) passed++; else failed++;

  // ==========================================
  // Round 51: hooks.json Schema Validation
  // ==========================================
  console.log('\nRound 51: hooks.json Schema Validation:');

  if (await asyncTest('hooks.json async hook has valid timeout field', async () => {
    const asyncHook = hooks.hooks.PostToolUse.find(h =>
      h.hooks && h.hooks[0] && h.hooks[0].async === true
    );

    assert.ok(asyncHook, 'Should have at least one async hook defined');
    assert.strictEqual(asyncHook.hooks[0].async, true, 'async field should be true');
    assert.ok(asyncHook.hooks[0].timeout, 'Should have timeout field');
    assert.strictEqual(typeof asyncHook.hooks[0].timeout, 'number', 'Timeout should be a number');
    assert.ok(asyncHook.hooks[0].timeout > 0, 'Timeout should be positive');

    const command = asyncHook.hooks[0].command;
    const commandText = Array.isArray(command) ? command.join(' ') : command;
    const isNodeInline =
      (Array.isArray(command) && command[0] === 'node' && command[1] === '-e') ||
      commandText.startsWith('node -e');
    const isNodeScript =
      (Array.isArray(command) && command[0] === 'node' && typeof command[1] === 'string' && command[1].endsWith('.js')) ||
      commandText.startsWith('node "');
    const isShellWrapper =
      (Array.isArray(command) && (command[0] === 'bash' || command[0] === 'sh')) ||
      commandText.startsWith('bash "') ||
      commandText.startsWith('sh "') ||
      commandText.startsWith('bash -lc ') ||
      commandText.startsWith('sh -c ');
    assert.ok(
      isNodeInline || isNodeScript || isShellWrapper,
      `Async hook command should be runnable (node -e, node script, or shell wrapper), got: ${commandText.substring(0, 80)}`
    );
  })) passed++; else failed++;

  if (await asyncTest('all hook commands in hooks.json are valid format', async () => {
    for (const [hookType, hookArray] of Object.entries(hooks.hooks)) {
      for (const hookDef of hookArray) {
        assert.ok(hookDef.hooks, `${hookType} entry should have hooks array`);

        for (const hook of hookDef.hooks) {
          assert.ok(hook.command, `Hook in ${hookType} should have command field`);

          const command = hook.command;
          const commandText = Array.isArray(command) ? command.join(' ') : command;
          const isInline =
            (Array.isArray(command) && command[0] === 'node' && command[1] === '-e') ||
            commandText.startsWith('node -e');
          const isFilePath =
            (Array.isArray(command) && command[0] === 'node' && typeof command[1] === 'string' && command[1].endsWith('.js')) ||
            commandText.startsWith('node "');
          const isNpx = (Array.isArray(command) && command[0] === 'npx') || commandText.startsWith('npx ');
          const isShellWrapper =
            (Array.isArray(command) && (command[0] === 'bash' || command[0] === 'sh')) ||
            commandText.startsWith('bash "') ||
            commandText.startsWith('sh "') ||
            commandText.startsWith('bash -lc ') ||
            commandText.startsWith('sh -c ');
          const isShellScriptPath =
            (Array.isArray(command) && typeof command[0] === 'string' && command[0].endsWith('.sh')) ||
            commandText.endsWith('.sh');

          if (isInline) {
            assert.ok(
              !commandText.includes('\\"'),
              `Hook command in ${hookType} should not include escaped double quotes in node -e payload: ${commandText.substring(0, 80)}`
            );
          }

          assert.ok(
            isInline || isFilePath || isNpx || isShellWrapper || isShellScriptPath,
            `Hook command in ${hookType} should be node -e, node script, npx, or shell wrapper/script, got: ${commandText.substring(0, 80)}`
          );
        }
      }
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
