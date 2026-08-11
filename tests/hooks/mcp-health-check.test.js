/**
 * Tests for scripts/hooks/mcp-health-check.js
 *
 * Run with: node tests/hooks/mcp-health-check.test.js
 */

const assert = require('assert');
const fs = require('fs');
const http = require('http');
const https = require('https');
const os = require('os');
const path = require('path');
const { spawn, spawnSync } = require('child_process');

const script = path.join(__dirname, '..', '..', 'scripts', 'hooks', 'mcp-health-check.js');

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

function createTempDir() {
  return fs.mkdtempSync(path.join(os.tmpdir(), 'ecc-mcp-health-'));
}

function cleanupTempDir(dirPath) {
  fs.rmSync(dirPath, { recursive: true, force: true });
}

function writeConfig(configPath, body) {
  fs.writeFileSync(configPath, JSON.stringify(body, null, 2));
}

function readState(statePath) {
  return JSON.parse(fs.readFileSync(statePath, 'utf8'));
}

function readOptionalFile(filePath) {
  return fs.existsSync(filePath) ? fs.readFileSync(filePath, 'utf8') : '<missing>';
}

function hookFailureDetails(result, statePath) {
  return [
    `exit=${result.code}`,
    `stderr=${result.stderr.trim() || '<empty>'}`,
    `state=${readOptionalFile(statePath)}`
  ].join('; ');
}

function createCommandConfig(scriptPath) {
  return {
    command: process.execPath,
    args: [scriptPath]
  };
}

function buildHookEnv(env = {}) {
  const merged = {
    ...process.env,
    ECC_HOOK_PROFILE: 'standard'
  };

  for (const [key, value] of Object.entries(env)) {
    if (value === null || value === undefined) {
      delete merged[key];
    } else {
      merged[key] = value;
    }
  }

  return merged;
}

function runHook(input, env = {}, options = {}) {
  const result = spawnSync('node', [script], {
    input: JSON.stringify(input),
    encoding: 'utf8',
    cwd: options.cwd || process.cwd(),
    env: buildHookEnv(env),
    timeout: 15000,
    stdio: ['pipe', 'pipe', 'pipe']
  });

  return {
    code: result.status || 0,
    stdout: result.stdout || '',
    stderr: result.stderr || ''
  };
}

function runRawHook(rawInput, env = {}, options = {}) {
  const result = spawnSync('node', [script], {
    input: rawInput,
    encoding: 'utf8',
    cwd: options.cwd || process.cwd(),
    env: buildHookEnv(env),
    timeout: 15000,
    stdio: ['pipe', 'pipe', 'pipe']
  });

  return {
    code: result.status || 0,
    stdout: result.stdout || '',
    stderr: result.stderr || ''
  };
}

function waitForFile(filePath, timeoutMs = 5000) {
  const started = Date.now();
  while (Date.now() - started < timeoutMs) {
    if (fs.existsSync(filePath)) {
      const content = fs.readFileSync(filePath, 'utf8');
      if (content.trim()) {
        return content;
      }
    }
    Atomics.wait(new Int32Array(new SharedArrayBuffer(4)), 0, 0, 25);
  }
  throw new Error(`Timed out waiting for ${filePath}`);
}

function waitForHttpReady(urlString, timeoutMs = 5000) {
  const deadline = Date.now() + timeoutMs;
  const { protocol } = new URL(urlString);
  const client = protocol === 'https:' ? https : http;

  return new Promise((resolve, reject) => {
    const attempt = () => {
      const req = client.request(urlString, { method: 'GET' }, res => {
        res.resume();
        res.once('end', resolve);
        res.once('error', error => {
          if (Date.now() >= deadline) {
            reject(new Error(`Timed out waiting for ${urlString}: ${error.message}`));
            return;
          }

          setTimeout(attempt, 25);
        });
      });

      req.setTimeout(250, () => {
        req.destroy(new Error('timeout'));
      });

      req.on('error', error => {
        if (Date.now() >= deadline) {
          reject(new Error(`Timed out waiting for ${urlString}: ${error.message}`));
          return;
        }

        setTimeout(attempt, 25);
      });

      req.end();
    };

    attempt();
  });
}

async function runTests() {
  console.log('\n=== Testing mcp-health-check.js ===\n');

  let passed = 0;
  let failed = 0;

  if (test('passes through non-MCP tools untouched', () => {
    const result = runHook(
      { tool_name: 'Read', tool_input: { file_path: 'README.md' } },
      { CLAUDE_HOOK_EVENT_NAME: 'PreToolUse' }
    );

    assert.strictEqual(result.code, 0, 'Expected non-MCP tool to pass through');
    assert.strictEqual(result.stderr, '', 'Expected no stderr for non-MCP tool');
  })) passed++; else failed++;

  if (test('blocks truncated MCP hook input by default', () => {
    const rawInput = JSON.stringify({ tool_name: 'mcp__flaky__search', tool_input: {} });
    const result = runRawHook(rawInput, {
      CLAUDE_HOOK_EVENT_NAME: 'PreToolUse',
      ECC_HOOK_INPUT_TRUNCATED: '1',
      ECC_HOOK_INPUT_MAX_BYTES: '512'
    });

    assert.strictEqual(result.code, 2, 'Expected truncated MCP input to block by default');
    assert.strictEqual(result.stdout, rawInput, 'Expected raw input passthrough on stdout');
    assert.ok(result.stderr.includes('Hook input exceeded 512 bytes'), `Expected size warning, got: ${result.stderr}`);
    assert.ok(/blocking search/i.test(result.stderr), `Expected blocking message, got: ${result.stderr}`);
  })) passed++; else failed++;

  if (test('allows truncated MCP hook input when fail-open mode is enabled', () => {
    const rawInput = JSON.stringify({ tool_name: 'mcp__flaky__search', tool_input: {} });
    const result = runRawHook(rawInput, {
      CLAUDE_HOOK_EVENT_NAME: 'PreToolUse',
      ECC_HOOK_INPUT_TRUNCATED: 'true',
      ECC_HOOK_INPUT_MAX_BYTES: '256',
      ECC_MCP_HEALTH_FAIL_OPEN: 'yes'
    });

    assert.strictEqual(result.code, 0, 'Expected fail-open mode to allow truncated MCP input');
    assert.strictEqual(result.stdout, rawInput, 'Expected raw input passthrough on stdout');
    assert.ok(result.stderr.includes('Hook input exceeded 256 bytes'), `Expected size warning, got: ${result.stderr}`);
    assert.ok(/fail-open mode is enabled/i.test(result.stderr), `Expected fail-open log, got: ${result.stderr}`);
  })) passed++; else failed++;

  if (await asyncTest('uses default cwd config path and default home state path', async () => {
    const tempDir = createTempDir();
    const homeDir = path.join(tempDir, 'home');
    const configDir = path.join(tempDir, '.claude');
    const configPath = path.join(configDir, 'settings.json');
    const expectedStatePath = path.join(homeDir, '.claude', 'mcp-health-cache.json');
    const serverScript = path.join(tempDir, 'default-path-server.js');

    try {
      fs.mkdirSync(configDir, { recursive: true });
      fs.mkdirSync(homeDir, { recursive: true });
      fs.writeFileSync(serverScript, "setInterval(() => {}, 1000);\n");
      writeConfig(configPath, {
        mcpServers: {
          cwddefault: createCommandConfig(serverScript)
        }
      });

      const input = { tool_name: 'mcp__cwddefault__list', tool_input: {} };
      const result = runHook(
        input,
        {
          CLAUDE_HOOK_EVENT_NAME: 'PreToolUse',
          ECC_MCP_CONFIG_PATH: null,
          ECC_MCP_HEALTH_STATE_PATH: null,
          ECC_MCP_HEALTH_TIMEOUT_MS: '100',
          HOME: homeDir,
          USERPROFILE: homeDir
        },
        { cwd: tempDir }
      );

      assert.strictEqual(result.code, 0, `Expected default-path server to pass, got ${result.code}: ${result.stderr}`);
      assert.strictEqual(result.stdout.trim(), JSON.stringify(input), 'Expected original JSON on stdout');

      const state = readState(expectedStatePath);
      assert.strictEqual(state.servers.cwddefault.status, 'healthy', 'Expected default home state path to be used');
      assert.strictEqual(
        fs.realpathSync(state.servers.cwddefault.source),
        fs.realpathSync(configPath),
        'Expected cwd .claude/settings.json config source'
      );
    } finally {
      cleanupTempDir(tempDir);
    }
  })) passed++; else failed++;

  if (test('uses cached healthy and unhealthy states without probing configs', () => {
    const tempDir = createTempDir();
    const now = Date.now();
    const healthyStatePath = path.join(tempDir, 'healthy-state.json');
    const unhealthyStatePath = path.join(tempDir, 'unhealthy-state.json');

    try {
      fs.writeFileSync(healthyStatePath, JSON.stringify({
        version: 1,
        servers: {
          cached: {
            status: 'healthy',
            checkedAt: now,
            expiresAt: now + 60000,
            failureCount: 0,
            nextRetryAt: now
          }
        }
      }));
      fs.writeFileSync(unhealthyStatePath, JSON.stringify({
        version: 1,
        servers: {
          blocked: {
            status: 'unhealthy',
            checkedAt: now,
            expiresAt: now,
            failureCount: 1,
            nextRetryAt: now + 60000,
            lastError: 'cached outage'
          }
        }
      }));

      const healthy = runHook(
        { tool_name: 'mcp__cached__list', tool_input: {} },
        {
          CLAUDE_HOOK_EVENT_NAME: 'PreToolUse',
          ECC_MCP_CONFIG_PATH: path.join(tempDir, 'missing.json'),
          ECC_MCP_HEALTH_STATE_PATH: healthyStatePath
        }
      );
      const unhealthy = runHook(
        { tool_name: 'mcp__blocked__query', tool_input: {} },
        {
          CLAUDE_HOOK_EVENT_NAME: 'PreToolUse',
          ECC_MCP_CONFIG_PATH: path.join(tempDir, 'missing.json'),
          ECC_MCP_HEALTH_STATE_PATH: unhealthyStatePath
        }
      );

      assert.strictEqual(healthy.code, 0, 'Expected cached healthy server to pass without config lookup');
      assert.strictEqual(healthy.stderr, '', 'Expected cached healthy server to skip logging');
      assert.strictEqual(unhealthy.code, 2, 'Expected cached unhealthy server to block before retry time');
      assert.ok(unhealthy.stderr.includes('marked unhealthy until'), `Expected cached unhealthy log, got: ${unhealthy.stderr}`);
    } finally {
      cleanupTempDir(tempDir);
    }
  })) passed++; else failed++;

  if (test('ignores malformed state files and allows missing MCP configs', () => {
    const tempDir = createTempDir();
    const statePath = path.join(tempDir, 'malformed-state.json');

    try {
      fs.writeFileSync(statePath, '[]');

      const result = runHook(
        {
          tool_name: 'Invoke',
          server: 'ghost',
          tool: 'lookup',
          tool_input: {}
        },
        {
          CLAUDE_HOOK_EVENT_NAME: 'PreToolUse',
          ECC_MCP_CONFIG_PATH: path.join(tempDir, 'missing.json'),
          ECC_MCP_HEALTH_STATE_PATH: statePath
        }
      );

      assert.strictEqual(result.code, 0, 'Expected missing config to be non-blocking');
      assert.ok(result.stderr.includes('No MCP config found for ghost'), `Expected missing config log, got: ${result.stderr}`);
    } finally {
      cleanupTempDir(tempDir);
    }
  })) passed++; else failed++;

  if (await asyncTest('supports explicit tool_input server targets and mcp_servers config aliases', async () => {
    const tempDir = createTempDir();
    const configPath = path.join(tempDir, 'claude.json');
    const statePath = path.join(tempDir, 'mcp-health.json');
    const serverScript = path.join(tempDir, 'alias-server.js');

    try {
      fs.writeFileSync(serverScript, "setInterval(() => {}, 1000);\n");
      writeConfig(configPath, {
        mcp_servers: {
          alias: createCommandConfig(serverScript)
        }
      });

      const input = {
        tool_name: 'GenericMcpTool',
        tool_input: {
          connector: 'alias',
          mcp_tool: 'lookup'
        }
      };
      const result = runHook(input, {
        CLAUDE_HOOK_EVENT_NAME: 'PreToolUse',
        ECC_MCP_CONFIG_PATH: configPath,
        ECC_MCP_HEALTH_STATE_PATH: statePath,
        ECC_MCP_HEALTH_TIMEOUT_MS: '100'
      });

      assert.strictEqual(result.code, 0, `Expected explicit MCP target to pass, got ${result.code}: ${result.stderr}`);
      const state = readState(statePath);
      assert.strictEqual(state.servers.alias.status, 'healthy', 'Expected alias server to be marked healthy');
    } finally {
      cleanupTempDir(tempDir);
    }
  })) passed++; else failed++;

  if (await asyncTest('marks healthy command MCP servers and allows the tool call', async () => {
    const tempDir = createTempDir();
    const configPath = path.join(tempDir, 'claude.json');
    const statePath = path.join(tempDir, 'mcp-health.json');
    const serverScript = path.join(tempDir, 'healthy-server.js');

    try {
      fs.writeFileSync(serverScript, "setInterval(() => {}, 1000);\n");
      writeConfig(configPath, {
        mcpServers: {
          mock: createCommandConfig(serverScript)
        }
      });

      const input = { tool_name: 'mcp__mock__list_items', tool_input: {} };
      const result = runHook(input, {
        CLAUDE_HOOK_EVENT_NAME: 'PreToolUse',
        ECC_MCP_CONFIG_PATH: configPath,
        ECC_MCP_HEALTH_STATE_PATH: statePath,
        ECC_MCP_HEALTH_TIMEOUT_MS: '100'
      });

      assert.strictEqual(result.code, 0, `Expected healthy server to pass, got ${result.code}`);
      assert.strictEqual(result.stdout.trim(), JSON.stringify(input), 'Expected original JSON on stdout');

      const state = readState(statePath);
      assert.strictEqual(state.servers.mock.status, 'healthy', 'Expected mock server to be marked healthy');
    } finally {
      cleanupTempDir(tempDir);
    }
  })) passed++; else failed++;

  if (await asyncTest('blocks unhealthy command MCP servers and records backoff state', async () => {
    const tempDir = createTempDir();
    const configPath = path.join(tempDir, 'claude.json');
    const statePath = path.join(tempDir, 'mcp-health.json');
    const serverScript = path.join(tempDir, 'unhealthy-server.js');

    try {
      fs.writeFileSync(serverScript, "process.exit(1);\n");
      writeConfig(configPath, {
        mcpServers: {
          flaky: createCommandConfig(serverScript)
        }
      });

      const result = runHook(
        { tool_name: 'mcp__flaky__search', tool_input: {} },
        {
          CLAUDE_HOOK_EVENT_NAME: 'PreToolUse',
          ECC_MCP_CONFIG_PATH: configPath,
          ECC_MCP_HEALTH_STATE_PATH: statePath,
          ECC_MCP_HEALTH_TIMEOUT_MS: '1000'
        }
      );

      assert.strictEqual(result.code, 2, 'Expected unhealthy server to block the MCP tool');
      assert.ok(result.stderr.includes('Blocking search'), `Expected blocking message, got: ${result.stderr}`);

      const state = readState(statePath);
      assert.strictEqual(state.servers.flaky.status, 'unhealthy', 'Expected flaky server to be marked unhealthy');
      assert.ok(state.servers.flaky.nextRetryAt > state.servers.flaky.checkedAt, 'Expected retry backoff to be recorded');
    } finally {
      cleanupTempDir(tempDir);
    }
  })) passed++; else failed++;

  if (await asyncTest('fail-open mode warns but does not block unhealthy MCP servers', async () => {
    const tempDir = createTempDir();
    const configPath = path.join(tempDir, 'claude.json');
    const statePath = path.join(tempDir, 'mcp-health.json');
    const serverScript = path.join(tempDir, 'relaxed-server.js');

    try {
      fs.writeFileSync(serverScript, "process.exit(1);\n");
      writeConfig(configPath, {
        mcpServers: {
          relaxed: createCommandConfig(serverScript)
        }
      });

      const result = runHook(
        { tool_name: 'mcp__relaxed__list', tool_input: {} },
        {
          CLAUDE_HOOK_EVENT_NAME: 'PreToolUse',
          ECC_MCP_CONFIG_PATH: configPath,
          ECC_MCP_HEALTH_STATE_PATH: statePath,
          ECC_MCP_HEALTH_FAIL_OPEN: '1',
          ECC_MCP_HEALTH_TIMEOUT_MS: '1000'
        }
      );

      assert.strictEqual(result.code, 0, 'Expected fail-open mode to allow execution');
      assert.ok(result.stderr.includes('Blocking list') || result.stderr.includes('fall back'), 'Expected warning output in fail-open mode');
    } finally {
      cleanupTempDir(tempDir);
    }
  })) passed++; else failed++;

  if (await asyncTest('blocks unsupported MCP configs and command spawn failures', async () => {
    const tempDir = createTempDir();
    const configPath = path.join(tempDir, 'claude.json');
    const statePath = path.join(tempDir, 'mcp-health.json');

    try {
      writeConfig(configPath, {
        mcpServers: {
          unsupported: {},
          missingcmd: {
            command: path.join(tempDir, 'missing-mcp-server')
          }
        }
      });

      const unsupported = runHook(
        { tool_name: 'mcp__unsupported__search', tool_input: {} },
        {
          CLAUDE_HOOK_EVENT_NAME: 'PreToolUse',
          ECC_MCP_CONFIG_PATH: configPath,
          ECC_MCP_HEALTH_STATE_PATH: statePath,
          ECC_MCP_HEALTH_TIMEOUT_MS: '1000'
        }
      );
      const missingCommand = runHook(
        { tool_name: 'mcp__missingcmd__search', tool_input: {} },
        {
          CLAUDE_HOOK_EVENT_NAME: 'PreToolUse',
          ECC_MCP_CONFIG_PATH: configPath,
          ECC_MCP_HEALTH_STATE_PATH: statePath,
          ECC_MCP_HEALTH_TIMEOUT_MS: '1000'
        }
      );

      assert.strictEqual(unsupported.code, 2, 'Expected unsupported config to block');
      assert.ok(unsupported.stderr.includes('unsupported MCP server config'), `Expected unsupported reason, got: ${unsupported.stderr}`);
      assert.strictEqual(missingCommand.code, 2, 'Expected missing command to block');
      assert.ok(/ENOENT|spawn/i.test(missingCommand.stderr), `Expected spawn failure reason, got: ${missingCommand.stderr}`);

      const state = readState(statePath);
      assert.strictEqual(state.servers.unsupported.status, 'unhealthy', 'Expected unsupported server state');
      assert.strictEqual(state.servers.missingcmd.status, 'unhealthy', 'Expected missing command server state');
    } finally {
      cleanupTempDir(tempDir);
    }
  })) passed++; else failed++;

  if (await asyncTest('includes command stderr and config env in unhealthy probe reasons', async () => {
    const tempDir = createTempDir();
    const configPath = path.join(tempDir, 'claude.json');
    const statePath = path.join(tempDir, 'mcp-health.json');
    const serverScript = path.join(tempDir, 'stderr-server.js');

    try {
      fs.writeFileSync(
        serverScript,
        "console.error(`probe failed with ${process.env.ECC_MCP_TEST_MARKER}`); process.exit(1);\n"
      );
      writeConfig(configPath, {
        mcpServers: {
          stderrprobe: {
            command: process.execPath,
            args: [serverScript],
            env: {
              ECC_MCP_TEST_MARKER: 'marker-from-config'
            }
          }
        }
      });

      const result = runHook(
        { tool_name: 'mcp__stderrprobe__search', tool_input: {} },
        {
          CLAUDE_HOOK_EVENT_NAME: 'PreToolUse',
          ECC_MCP_CONFIG_PATH: configPath,
          ECC_MCP_HEALTH_STATE_PATH: statePath,
          ECC_MCP_HEALTH_TIMEOUT_MS: '1000'
        }
      );

      assert.strictEqual(result.code, 2, 'Expected stderr probe failure to block');
      assert.ok(result.stderr.includes('marker-from-config'), `Expected command stderr in reason, got: ${result.stderr}`);

      const state = readState(statePath);
      assert.ok(state.servers.stderrprobe.lastError.includes('marker-from-config'), 'Expected stderr reason in state');
    } finally {
      cleanupTempDir(tempDir);
    }
  })) passed++; else failed++;

  if (await asyncTest('records reconnect reprobe failures for previously unhealthy servers', async () => {
    const tempDir = createTempDir();
    const configPath = path.join(tempDir, 'claude.json');
    const statePath = path.join(tempDir, 'mcp-health.json');
    const serverScript = path.join(tempDir, 'still-down-server.js');
    const reconnectScript = path.join(tempDir, 'noop-reconnect.js');
    const now = Date.now();

    try {
      fs.writeFileSync(serverScript, "console.error('503 Service Unavailable'); process.exit(1);\n");
      fs.writeFileSync(reconnectScript, "process.exit(0);\n");
      fs.writeFileSync(statePath, JSON.stringify({
        version: 1,
        servers: {
          sticky: {
            status: 'unhealthy',
            checkedAt: now - 60000,
            expiresAt: now - 60000,
            failureCount: 2,
            lastError: 'previous outage',
            nextRetryAt: now - 1000,
            lastRestoredAt: now - 120000
          }
        }
      }));
      writeConfig(configPath, {
        mcpServers: {
          sticky: createCommandConfig(serverScript)
        }
      });

      const result = runHook(
        { tool_name: 'mcp__sticky__search', tool_input: {} },
        {
          CLAUDE_HOOK_EVENT_NAME: 'PreToolUse',
          ECC_MCP_CONFIG_PATH: configPath,
          ECC_MCP_HEALTH_STATE_PATH: statePath,
          ECC_MCP_RECONNECT_COMMAND: `${JSON.stringify(process.execPath)} ${JSON.stringify(reconnectScript)}`,
          ECC_MCP_HEALTH_TIMEOUT_MS: '1000',
          ECC_MCP_HEALTH_BACKOFF_MS: '10'
        }
      );

      assert.strictEqual(result.code, 2, 'Expected still-unhealthy server to block');
      assert.ok(result.stderr.includes('reconnect reprobe failed'), `Expected reprobe failure reason, got: ${result.stderr}`);
      assert.ok(result.stderr.includes('Reconnect attempt: ok'), `Expected reconnect attempt suffix, got: ${result.stderr}`);

      const state = readState(statePath);
      assert.strictEqual(state.servers.sticky.failureCount, 3, 'Expected failure count to increment');
      assert.strictEqual(state.servers.sticky.lastRestoredAt, now - 120000, 'Expected previous restore timestamp to survive');
    } finally {
      cleanupTempDir(tempDir);
    }
  })) passed++; else failed++;

  if (await asyncTest('post-failure reconnect command restores server health when a reprobe succeeds', async () => {
    const tempDir = createTempDir();
    const configPath = path.join(tempDir, 'claude.json');
    const statePath = path.join(tempDir, 'mcp-health.json');
    const switchFile = path.join(tempDir, 'server-mode.txt');
    const reconnectFile = path.join(tempDir, 'reconnected.txt');
    const probeScript = path.join(tempDir, 'probe-server.js');

    fs.writeFileSync(switchFile, 'down');
    fs.writeFileSync(
      probeScript,
      [
        "const fs = require('fs');",
        `const mode = fs.readFileSync(${JSON.stringify(switchFile)}, 'utf8').trim();`,
        "if (mode === 'up') { setInterval(() => {}, 1000); } else { console.error('401 Unauthorized'); process.exit(1); }"
      ].join('\n')
    );

    const reconnectScript = path.join(tempDir, 'reconnect.js');
    fs.writeFileSync(
      reconnectScript,
      [
        "const fs = require('fs');",
        `fs.writeFileSync(${JSON.stringify(switchFile)}, 'up');`,
        `fs.writeFileSync(${JSON.stringify(reconnectFile)}, 'done');`
      ].join('\n')
    );

    try {
      writeConfig(configPath, {
        mcpServers: {
          authy: createCommandConfig(probeScript)
        }
      });

      const result = runHook(
        {
          tool_name: 'mcp__authy__messages',
          tool_input: {},
          error: '401 Unauthorized'
        },
        {
          CLAUDE_HOOK_EVENT_NAME: 'PostToolUseFailure',
          ECC_MCP_CONFIG_PATH: configPath,
          ECC_MCP_HEALTH_STATE_PATH: statePath,
          ECC_MCP_RECONNECT_COMMAND: `node ${JSON.stringify(reconnectScript)}`,
          ECC_MCP_HEALTH_TIMEOUT_MS: '1000'
        }
      );

      assert.strictEqual(result.code, 0, 'Expected failure hook to remain non-blocking');
      assert.ok(result.stderr.includes('reported 401'), `Expected reconnect log, got: ${result.stderr}`);
      assert.ok(result.stderr.includes('connection restored'), `Expected restored log, got: ${result.stderr}`);
      assert.ok(fs.existsSync(reconnectFile), 'Expected reconnect command to run');

      const state = readState(statePath);
      assert.strictEqual(state.servers.authy.status, 'healthy', 'Expected authy server to be restored after reconnect');
    } finally {
      cleanupTempDir(tempDir);
    }
  })) passed++; else failed++;

  if (test('ignores post-failure events without a reconnect-worthy failure code', () => {
    const tempDir = createTempDir();
    const statePath = path.join(tempDir, 'mcp-health.json');

    try {
      const result = runHook(
        {
          tool_name: 'mcp__quiet__messages',
          tool_input: {},
          error: 'tool returned an application-level validation error'
        },
        {
          CLAUDE_HOOK_EVENT_NAME: 'PostToolUseFailure',
          ECC_MCP_HEALTH_STATE_PATH: statePath
        }
      );

      assert.strictEqual(result.code, 0, 'Expected unmatched post-failure to remain non-blocking');
      assert.strictEqual(result.stderr, '', 'Expected no logs for unmatched post-failure');
      assert.strictEqual(fs.existsSync(statePath), false, 'Expected no state write for unmatched post-failure');
    } finally {
      cleanupTempDir(tempDir);
    }
  })) passed++; else failed++;

  if (test('post-failure marks servers unhealthy and skips reconnect when no command is configured', () => {
    const tempDir = createTempDir();
    const statePath = path.join(tempDir, 'mcp-health.json');

    try {
      const result = runHook(
        {
          tool_name: 'mcp__noplan__messages',
          tool_input: {},
          tool_output: {
            stderr: '403 Forbidden from upstream MCP'
          }
        },
        {
          CLAUDE_HOOK_EVENT_NAME: 'PostToolUseFailure',
          ECC_MCP_HEALTH_STATE_PATH: statePath,
          ECC_MCP_RECONNECT_COMMAND: null
        }
      );

      assert.strictEqual(result.code, 0, 'Expected post-failure hook to remain non-blocking');
      assert.ok(result.stderr.includes('reported 403'), `Expected detected failure code log, got: ${result.stderr}`);
      assert.ok(result.stderr.includes('reconnect skipped'), `Expected reconnect skipped log, got: ${result.stderr}`);

      const state = readState(statePath);
      assert.strictEqual(state.servers.noplan.status, 'unhealthy', 'Expected post-failure to mark server unhealthy');
      assert.strictEqual(state.servers.noplan.lastFailureCode, 403, 'Expected detected status code in state');
    } finally {
      cleanupTempDir(tempDir);
    }
  })) passed++; else failed++;

  if (test('post-failure reports failed reconnect commands', () => {
    const tempDir = createTempDir();
    const statePath = path.join(tempDir, 'mcp-health.json');
    const reconnectScript = path.join(tempDir, 'failed-reconnect.js');

    try {
      fs.writeFileSync(reconnectScript, "console.error('cannot reconnect'); process.exit(7);\n");

      const result = runHook(
        {
          tool_name: 'mcp__badreconnect__messages',
          tool_input: {},
          tool_response: 'service unavailable 503'
        },
        {
          CLAUDE_HOOK_EVENT_NAME: 'PostToolUseFailure',
          ECC_MCP_HEALTH_STATE_PATH: statePath,
          ECC_MCP_RECONNECT_COMMAND: `${JSON.stringify(process.execPath)} ${JSON.stringify(reconnectScript)}`
        }
      );

      assert.strictEqual(result.code, 0, 'Expected reconnect failure hook to remain non-blocking');
      assert.ok(result.stderr.includes('reported 503'), `Expected detected failure code log, got: ${result.stderr}`);
      assert.ok(result.stderr.includes('reconnect failed: cannot reconnect'), `Expected reconnect failure reason, got: ${result.stderr}`);
    } finally {
      cleanupTempDir(tempDir);
    }
  })) passed++; else failed++;

  if (test('post-failure expands per-server reconnect commands before follow-up config checks', () => {
    const tempDir = createTempDir();
    const statePath = path.join(tempDir, 'mcp-health.json');
    const reconnectScript = path.join(tempDir, 'server-reconnect.js');
    const markerFile = path.join(tempDir, 'server-name.txt');

    try {
      fs.writeFileSync(
        reconnectScript,
        [
          "const fs = require('fs');",
          "fs.writeFileSync(process.argv[2], process.argv[3]);"
        ].join('\n')
      );

      const result = runHook(
        {
          tool_name: 'mcp__foo-bar__messages',
          tool_input: {},
          message: 'transport connection reset'
        },
        {
          CLAUDE_HOOK_EVENT_NAME: 'PostToolUseFailure',
          ECC_MCP_HEALTH_STATE_PATH: statePath,
          ECC_MCP_CONFIG_PATH: path.join(tempDir, 'missing.json'),
          ECC_MCP_RECONNECT_COMMAND: null,
          ECC_MCP_RECONNECT_FOO_BAR: `${JSON.stringify(process.execPath)} ${JSON.stringify(reconnectScript)} ${JSON.stringify(markerFile)} {server}`
        }
      );

      assert.strictEqual(result.code, 0, 'Expected per-server reconnect hook to remain non-blocking');
      assert.strictEqual(fs.readFileSync(markerFile, 'utf8'), 'foo-bar', 'Expected {server} token expansion');
      assert.ok(result.stderr.includes('reported transport'), `Expected transport failure log, got: ${result.stderr}`);
      assert.ok(result.stderr.includes('no config was available'), `Expected missing config follow-up log, got: ${result.stderr}`);
    } finally {
      cleanupTempDir(tempDir);
    }
  })) passed++; else failed++;

  if (await asyncTest('treats HTTP 400 probe responses as healthy reachable servers', async () => {
    const tempDir = createTempDir();
    const configPath = path.join(tempDir, 'claude.json');
    const statePath = path.join(tempDir, 'mcp-health.json');
    const serverScript = path.join(tempDir, 'http-400-server.js');
    const portFile = path.join(tempDir, 'server-port.txt');

    fs.writeFileSync(
      serverScript,
      [
        "const fs = require('fs');",
        "const http = require('http');",
        "const portFile = process.argv[2];",
        "const server = http.createServer((_req, res) => {",
        "  res.writeHead(400, { 'Content-Type': 'application/json' });",
        "  res.end(JSON.stringify({ error: 'invalid MCP request' }));",
        "});",
        "server.listen(0, '127.0.0.1', () => {",
        "  fs.writeFileSync(portFile, String(server.address().port));",
        "});",
        "setInterval(() => {}, 1000);"
      ].join('\n')
    );

    const serverProcess = spawn(process.execPath, [serverScript, portFile], {
      stdio: 'ignore'
    });

    try {
      const port = waitForFile(portFile).trim();
      await waitForHttpReady(`http://127.0.0.1:${port}/mcp`);

      writeConfig(configPath, {
        mcpServers: {
          http400: {
            type: 'http',
            url: `http://127.0.0.1:${port}/mcp`
          }
        }
      });

      const input = { tool_name: 'mcp__http400__search_repositories', tool_input: {} };
      const result = runHook(input, {
        CLAUDE_HOOK_EVENT_NAME: 'PreToolUse',
        ECC_MCP_CONFIG_PATH: configPath,
        ECC_MCP_HEALTH_STATE_PATH: statePath,
        ECC_MCP_HEALTH_TIMEOUT_MS: '2000'
      });

      assert.strictEqual(
        result.code,
        0,
        `Expected HTTP 400 probe to be treated as healthy: ${hookFailureDetails(result, statePath)}`
      );
      assert.strictEqual(result.stdout.trim(), JSON.stringify(input), 'Expected original JSON on stdout');

      const state = readState(statePath);
      assert.strictEqual(state.servers.http400.status, 'healthy', 'Expected HTTP MCP server to be marked healthy');
    } finally {
      serverProcess.kill('SIGTERM');
      cleanupTempDir(tempDir);
    }
  })) passed++; else failed++;

  if (await asyncTest('treats HTTP 401 probe responses as healthy reachable OAuth-protected servers', async () => {
    const tempDir = createTempDir();
    const configPath = path.join(tempDir, 'claude.json');
    const statePath = path.join(tempDir, 'mcp-health.json');
    const serverScript = path.join(tempDir, 'http-401-server.js');
    const portFile = path.join(tempDir, 'server-port.txt');

    fs.writeFileSync(
      serverScript,
      [
        "const fs = require('fs');",
        "const http = require('http');",
        "const portFile = process.argv[2];",
        "const server = http.createServer((_req, res) => {",
        "  res.writeHead(401, {",
        "    'Content-Type': 'application/json',",
        "    'WWW-Authenticate': 'Bearer realm=\"OAuth\", error=\"invalid_token\"'",
        "  });",
        "  res.end(JSON.stringify({ error: 'missing bearer token' }));",
        "});",
        "server.listen(0, '127.0.0.1', () => {",
        "  fs.writeFileSync(portFile, String(server.address().port));",
        "});",
        "setInterval(() => {}, 1000);"
      ].join('\n')
    );

    const serverProcess = spawn(process.execPath, [serverScript, portFile], {
      stdio: 'ignore'
    });

    try {
      const port = waitForFile(portFile).trim();
      await waitForHttpReady(`http://127.0.0.1:${port}/mcp`);

      writeConfig(configPath, {
        mcpServers: {
          atlassian: {
            type: 'http',
            url: `http://127.0.0.1:${port}/mcp`
          }
        }
      });

      const input = { tool_name: 'mcp__atlassian__search', tool_input: {} };
      const result = runHook(input, {
        CLAUDE_HOOK_EVENT_NAME: 'PreToolUse',
        ECC_MCP_CONFIG_PATH: configPath,
        ECC_MCP_HEALTH_STATE_PATH: statePath,
        ECC_MCP_HEALTH_TIMEOUT_MS: '2000'
      });

      assert.strictEqual(
        result.code,
        0,
        `Expected HTTP 401 probe to be treated as healthy: ${hookFailureDetails(result, statePath)}`
      );
      assert.strictEqual(result.stdout.trim(), JSON.stringify(input), 'Expected original JSON on stdout');

      const state = readState(statePath);
      assert.strictEqual(state.servers.atlassian.status, 'healthy', 'Expected OAuth-protected HTTP MCP server to be marked healthy');
    } finally {
      serverProcess.kill('SIGTERM');
      cleanupTempDir(tempDir);
    }
  })) passed++; else failed++;

  if (await asyncTest('treats HTTP 406 probe responses as healthy reachable Streamable HTTP MCP servers', async () => {
    const tempDir = createTempDir();
    const configPath = path.join(tempDir, 'claude.json');
    const statePath = path.join(tempDir, 'mcp-health.json');
    const serverScript = path.join(tempDir, 'http-406-server.js');
    const portFile = path.join(tempDir, 'server-port.txt');

    fs.writeFileSync(
      serverScript,
      [
        "const fs = require('fs');",
        "const http = require('http');",
        "const portFile = process.argv[2];",
        "const server = http.createServer((req, res) => {",
        "  if (String(req.headers.accept || '').includes('text/event-stream')) {",
        "    res.writeHead(200, { 'Content-Type': 'text/event-stream' });",
        "    res.end();",
        "    return;",
        "  }",
        "  res.writeHead(406, { 'Content-Type': 'application/json' });",
        "  res.end(JSON.stringify({ error: 'missing Accept: text/event-stream' }));",
        "});",
        "server.listen(0, '127.0.0.1', () => {",
        "  fs.writeFileSync(portFile, String(server.address().port));",
        "});",
        "setInterval(() => {}, 1000);"
      ].join('\n')
    );

    const serverProcess = spawn(process.execPath, [serverScript, portFile], {
      stdio: 'ignore'
    });

    try {
      const port = waitForFile(portFile).trim();
      await waitForHttpReady(`http://127.0.0.1:${port}/mcp`);

      writeConfig(configPath, {
        mcpServers: {
          streamable: {
            type: 'http',
            url: `http://127.0.0.1:${port}/mcp`
          }
        }
      });

      const input = { tool_name: 'mcp__streamable__initialize', tool_input: {} };
      const result = runHook(input, {
        CLAUDE_HOOK_EVENT_NAME: 'PreToolUse',
        ECC_MCP_CONFIG_PATH: configPath,
        ECC_MCP_HEALTH_STATE_PATH: statePath,
        ECC_MCP_HEALTH_TIMEOUT_MS: '2000'
      });

      assert.strictEqual(
        result.code,
        0,
        `Expected HTTP 406 probe to be treated as healthy: ${hookFailureDetails(result, statePath)}`
      );
      assert.strictEqual(result.stdout.trim(), JSON.stringify(input), 'Expected original JSON on stdout');

      const state = readState(statePath);
      assert.strictEqual(state.servers.streamable.status, 'healthy', 'Expected Streamable HTTP MCP server to be marked healthy');
    } finally {
      serverProcess.kill('SIGTERM');
      cleanupTempDir(tempDir);
    }
  })) passed++; else failed++;

  // Windows-only: child_process.spawn cannot resolve .cmd/.bat shims for
  // bare PATH commands without an extension, and Node 18.20+/20.12+ refuse
  // to spawn .cmd targets without `shell: true` (CVE-2024-27980). The probe
  // must retry bare command names with platform extensions and route .cmd/.bat
  // through the shell, otherwise tools like `npx` are misclassified as
  // unhealthy on first use. Path-like commands keep single-candidate ENOENT
  // semantics.
  if (process.platform === 'win32') {
    if (await asyncTest('windows: probes bare PATH commands via .cmd fallback', async () => {
      const tempDir = createTempDir();
      const binDir = path.join(tempDir, 'bin');
      const configPath = path.join(tempDir, 'claude.json');
      const statePath = path.join(tempDir, 'mcp-health.json');

      fs.mkdirSync(binDir, { recursive: true });
      fs.writeFileSync(
        path.join(binDir, 'winfallback.cmd'),
        ['@echo off', 'node -e "setInterval(()=>{},1000)"', ''].join('\r\n')
      );

      try {
        writeConfig(configPath, {
          mcpServers: {
            winfallback: {
              command: 'winfallback',
              args: []
            }
          }
        });

        const input = { tool_name: 'mcp__winfallback__list', tool_input: {} };
        const result = runHook(input, {
          CLAUDE_HOOK_EVENT_NAME: 'PreToolUse',
          ECC_MCP_CONFIG_PATH: configPath,
          ECC_MCP_HEALTH_STATE_PATH: statePath,
          ECC_MCP_HEALTH_TIMEOUT_MS: '500',
          PATH: `${binDir}${path.delimiter}${process.env.PATH || ''}`
        });

        assert.strictEqual(
          result.code,
          0,
          `Expected bare command to be probed via .cmd fallback: ${hookFailureDetails(result, statePath)}`
        );

        const state = readState(statePath);
        assert.strictEqual(
          state.servers.winfallback.status,
          'healthy',
          'Expected bare command to be marked healthy via .cmd fallback'
        );
      } finally {
        cleanupTempDir(tempDir);
      }
    })) passed++; else failed++;
  } else {
    console.log('  - skipped: windows: probes bare PATH commands via .cmd fallback (non-Windows)');
  }

  if (await asyncTest('probes command servers using non-absolute commands (e.g. npx) via PATH resolution', async () => {
    const tempDir = createTempDir();
    const configPath = path.join(tempDir, 'claude.json');
    const statePath = path.join(tempDir, 'mcp-health.json');
    const serverScript = path.join(tempDir, 'shell-server.js');

    try {
      // Create a server script that stays alive
      fs.writeFileSync(serverScript, "setInterval(() => {}, 1000);\n");

      // Use 'node' (non-absolute) as the command to exercise PATH-based
      // resolution without depending on npx being available in the environment.
      writeConfig(configPath, {
        mcpServers: {
          shelltest: {
            command: 'node',
            args: [serverScript]
          }
        }
      });

      const input = { tool_name: 'mcp__shelltest__ping', tool_input: {} };
      const result = runHook(input, {
        CLAUDE_HOOK_EVENT_NAME: 'PreToolUse',
        ECC_MCP_CONFIG_PATH: configPath,
        ECC_MCP_HEALTH_STATE_PATH: statePath,
        ECC_MCP_HEALTH_TIMEOUT_MS: '100'
      });

      assert.strictEqual(result.code, 0, `Expected non-absolute command to resolve via PATH, got ${result.code}`);

      const state = readState(statePath);
      assert.strictEqual(state.servers.shelltest.status, 'healthy', 'Expected PATH-resolved server to be marked healthy');
    } finally {
      cleanupTempDir(tempDir);
    }
  })) passed++; else failed++;

  // Windows-only: when a .cmd shim is probed via shell:true, args that contain
  // spaces (e.g. paths under "C:\Program Files") must be passed as a single
  // quoted token, not split by cmd.exe at every space boundary.
  if (process.platform === 'win32') {
    if (await asyncTest('windows: .cmd probe preserves space-containing args as single tokens', async () => {
      const tempDir = createTempDir();
      const binDir = path.join(tempDir, 'bin');
      const configPath = path.join(tempDir, 'claude.json');
      const statePath = path.join(tempDir, 'mcp-health.json');

      fs.mkdirSync(binDir, { recursive: true });

      // This .cmd script writes its first argument verbatim to stderr and then
      // keeps running so the probe can time out (= healthy). We inspect stderr
      // to verify cmd.exe received the spaced path as one argument, not split.
      const cmdPath = path.join(binDir, 'spacedarg.cmd');
      fs.writeFileSync(
        cmdPath,
        ['@echo off', 'echo ARG1=[%1] 1>&2', 'node -e "setInterval(()=>{},1000)"', ''].join('\r\n')
      );

      // A path containing a space — the canonical trigger for the DEP0190 bug.
      const spacedPath = 'C:\\Program Files\\Some Server\\server.exe';

      try {
        writeConfig(configPath, {
          mcpServers: {
            spacedarg: {
              command: 'spacedarg',
              args: ['--codesys-path', spacedPath]
            }
          }
        });

        const input = { tool_name: 'mcp__spacedarg__ping', tool_input: {} };
        const result = runHook(input, {
          CLAUDE_HOOK_EVENT_NAME: 'PreToolUse',
          ECC_MCP_CONFIG_PATH: configPath,
          ECC_MCP_HEALTH_STATE_PATH: statePath,
          ECC_MCP_HEALTH_TIMEOUT_MS: '800',
          PATH: `${binDir}${path.delimiter}${process.env.PATH || ''}`
        });

        assert.strictEqual(
          result.code,
          0,
          `Expected .cmd probe with spaced arg to succeed: ${hookFailureDetails(result, statePath)}`
        );

        const state = readState(statePath);
        assert.strictEqual(
          state.servers.spacedarg.status,
          'healthy',
          'Expected server with space-containing arg to be marked healthy'
        );

        // The .cmd echo writes its first positional (%1). If the path was split
        // at the space, %1 would be "C:\Program" (no quotes, no "Files" part).
        // If properly quoted, %1 is the full quoted path.
        assert.ok(
          !result.stderr.includes('ARG1=[C:\\Program]'),
          `Space-containing arg was split by cmd.exe (DEP0190 bug still present). stderr: ${result.stderr}`
        );
      } finally {
        cleanupTempDir(tempDir);
      }
    })) passed++; else failed++;
  } else {
    console.log('  - skipped: windows: .cmd probe preserves space-containing args as single tokens (non-Windows)');
  }

  console.log(`\nResults: Passed: ${passed}, Failed: ${failed}`);
  process.exit(failed > 0 ? 1 : 0);
}

runTests().catch(error => {
  console.error(error);
  process.exit(1);
});
