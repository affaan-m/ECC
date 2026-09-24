#!/usr/bin/env node
'use strict';

/**
 * MCP health-check hook.
 *
 * Compatible with Claude Code's existing hook events:
 * - PreToolUse: probe MCP server health before MCP tool execution
 * - PostToolUseFailure: mark unhealthy servers, attempt reconnect, and re-probe
 *
 * The hook persists health state outside the conversation context so it
 * survives compaction and later turns.
 */

const fs = require('fs');
const os = require('os');
const path = require('path');
const http = require('http');
const https = require('https');
const { spawn, spawnSync } = require('child_process');

const MAX_STDIN = 1024 * 1024;
const DEFAULT_TTL_MS = 2 * 60 * 1000;
const DEFAULT_TIMEOUT_MS = 5000;
const DEFAULT_BACKOFF_MS = 30 * 1000;
const MAX_BACKOFF_MS = 10 * 60 * 1000;
// The preflight HTTP probe only checks reachability; it does not have access to
// Claude Code's stored OAuth bearer token. Treat auth-gated responses as
// reachable so the real MCP client can attempt the authenticated call. A
// Streamable HTTP MCP server can also return 406 to a bare GET that omits
// Accept: text/event-stream; that still proves the endpoint is alive.
const HEALTHY_HTTP_CODES = new Set([200, 201, 202, 204, 301, 302, 303, 304, 307, 308, 400, 401, 403, 405, 406]);
const RECONNECT_STATUS_CODES = new Set([401, 403, 429, 503]);
const FAILURE_PATTERNS = [
  { code: 401, pattern: /\b401\b|unauthori[sz]ed|auth(?:entication)?\s+(?:failed|expired|invalid)/i },
  { code: 403, pattern: /\b403\b|forbidden|permission denied/i },
  { code: 429, pattern: /\b429\b|rate limit|too many requests/i },
  { code: 503, pattern: /\b503\b|service unavailable|overloaded|temporarily unavailable/i },
  { code: 'transport', pattern: /ECONNREFUSED|ENOTFOUND|EAI_AGAIN|timed? out|socket hang up|connection (?:failed|lost|reset|closed)/i }
];

function envNumber(name, fallback) {
  const value = Number(process.env[name]);
  return Number.isFinite(value) && value >= 0 ? value : fallback;
}

function stateFilePath() {
  if (process.env.ECC_MCP_HEALTH_STATE_PATH) {
    return path.resolve(process.env.ECC_MCP_HEALTH_STATE_PATH);
  }
  return path.join(os.homedir(), '.claude', 'mcp-health-cache.json');
}

function configPaths() {
  if (process.env.ECC_MCP_CONFIG_PATH) {
    return process.env.ECC_MCP_CONFIG_PATH
      .split(path.delimiter)
      .map(entry => entry.trim())
      .filter(Boolean)
      .map(entry => path.resolve(entry));
  }

  const cwd = process.cwd();
  const home = os.homedir();

  return [
    path.join(cwd, '.claude.json'),
    path.join(cwd, '.claude', 'settings.json'),
    path.join(home, '.claude.json'),
    path.join(home, '.claude', 'settings.json')
  ];
}

function readJsonFile(filePath) {
  try {
    return JSON.parse(fs.readFileSync(filePath, 'utf8'));
  } catch {
    return null;
  }
}

function loadState(filePath) {
  const state = readJsonFile(filePath);
  if (!state || typeof state !== 'object' || Array.isArray(state)) {
    return { version: 1, servers: {} };
  }

  if (!state.servers || typeof state.servers !== 'object' || Array.isArray(state.servers)) {
    state.servers = {};
  }

  return state;
}

function saveState(filePath, state) {
  try {
    fs.mkdirSync(path.dirname(filePath), { recursive: true });
    fs.writeFileSync(filePath, JSON.stringify(state, null, 2));
  } catch {
    // Never block the hook on state persistence errors.
  }
}

function readRawStdin() {
  return new Promise(resolve => {
    let raw = '';
    let truncated = /^(1|true|yes)$/i.test(String(process.env.ECC_HOOK_INPUT_TRUNCATED || ''));
    process.stdin.setEncoding('utf8');
    process.stdin.on('data', chunk => {
      if (raw.length < MAX_STDIN) {
        const remaining = MAX_STDIN - raw.length;
        raw += chunk.substring(0, remaining);
        if (chunk.length > remaining) {
          truncated = true;
        }
      } else {
        truncated = true;
      }
    });
    process.stdin.on('end', () => resolve({ raw, truncated }));
    process.stdin.on('error', () => resolve({ raw, truncated }));
  });
}

function safeParse(raw) {
  try {
    return raw.trim() ? JSON.parse(raw) : {};
  } catch {
    return {};
  }
}

function extractMcpTarget(input) {
  const toolName = String(input.tool_name || input.name || '');
  const explicitServer = input.server
    || input.mcp_server
    || input.tool_input?.server
    || input.tool_input?.mcp_server
    || input.tool_input?.connector
    || null;
  const explicitTool = input.tool
    || input.mcp_tool
    || input.tool_input?.tool
    || input.tool_input?.mcp_tool
    || null;

  if (explicitServer) {
    return {
      server: String(explicitServer),
      tool: explicitTool ? String(explicitTool) : toolName
    };
  }

  if (!toolName.startsWith('mcp__')) {
    return null;
  }

  const segments = toolName.slice(5).split('__');
  if (segments.length < 2 || !segments[0]) {
    return null;
  }

  return {
    server: segments[0],
    tool: segments.slice(1).join('__')
  };
}

function extractMcpTargetFromRaw(raw) {
  const toolNameMatch = raw.match(/"(?:tool_name|name)"\s*:\s*"([^"]+)"/);
  const serverMatch = raw.match(/"(?:server|mcp_server|connector)"\s*:\s*"([^"]+)"/);
  const toolMatch = raw.match(/"(?:tool|mcp_tool)"\s*:\s*"([^"]+)"/);

  return extractMcpTarget({
    tool_name: toolNameMatch ? toolNameMatch[1] : '',
    server: serverMatch ? serverMatch[1] : undefined,
    tool: toolMatch ? toolMatch[1] : undefined
  });
}

function resolveServerConfig(serverName) {
  for (const filePath of configPaths()) {
    const data = readJsonFile(filePath);
    const server = data?.mcpServers?.[serverName]
      || data?.mcp_servers?.[serverName]
      || null;

    if (server && typeof server === 'object' && !Array.isArray(server)) {
      return {
        config: server,
        source: filePath
      };
    }
  }

  return null;
}

function markHealthy(state, serverName, now, details = {}) {
  state.servers[serverName] = {
    status: 'healthy',
    checkedAt: now,
    expiresAt: now + envNumber('ECC_MCP_HEALTH_TTL_MS', DEFAULT_TTL_MS),
    failureCount: 0,
    lastError: null,
    lastFailureCode: null,
    nextRetryAt: now,
    lastRestoredAt: now,
    ...details
  };
}

function markUnhealthy(state, serverName, now, failureCode, errorMessage) {
  const previous = state.servers[serverName] || {};
  const failureCount = Number(previous.failureCount || 0) + 1;
  const backoffBase = envNumber('ECC_MCP_HEALTH_BACKOFF_MS', DEFAULT_BACKOFF_MS);
  const nextRetryDelay = Math.min(backoffBase * (2 ** Math.max(failureCount - 1, 0)), MAX_BACKOFF_MS);

  state.servers[serverName] = {
    status: 'unhealthy',
    checkedAt: now,
    expiresAt: now,
    failureCount,
    lastError: errorMessage || null,
    lastFailureCode: failureCode || null,
    nextRetryAt: now + nextRetryDelay,
    lastRestoredAt: previous.lastRestoredAt || null
  };
}

function failureSummary(input) {
  const output = input.tool_output;
  const pieces = [
    typeof input.error === 'string' ? input.error : '',
    typeof input.message === 'string' ? input.message : '',
    typeof input.tool_response === 'string' ? input.tool_response : '',
    typeof output === 'string' ? output : '',
    typeof output?.output === 'string' ? output.output : '',
    typeof output?.stderr === 'string' ? output.stderr : '',
    typeof input.tool_input?.error === 'string' ? input.tool_input.error : ''
  ].filter(Boolean);

  return pieces.join('\n');
}

function detectFailureCode(text) {
  const summary = String(text || '');
  for (const entry of FAILURE_PATTERNS) {
    if (entry.pattern.test(summary)) {
      return entry.code;
    }
  }
  return null;
}

function requestHttp(urlString, headers, timeoutMs) {
  return new Promise(resolve => {
    let settled = false;
    let timedOut = false;

    const url = new URL(urlString);
    const client = url.protocol === 'https:' ? https : http;

    const req = client.request(
      url,
      {
        method: 'GET',
        headers,
      },
      res => {
        if (settled) return;
        settled = true;
        res.resume();
        resolve({
          ok: HEALTHY_HTTP_CODES.has(res.statusCode),
          statusCode: res.statusCode,
          reason: `HTTP ${res.statusCode}`
        });
      }
    );

    req.setTimeout(timeoutMs, () => {
      timedOut = true;
      req.destroy(new Error('timeout'));
    });

    req.on('error', error => {
      if (settled) return;
      settled = true;
      resolve({
        ok: false,
        statusCode: null,
        reason: timedOut ? 'request timed out' : error.message
      });
    });

    req.end();
  });
}

function probeCommandServer(serverName, config) {
  return new Promise(resolve => {
    const command = config.command;
    const args = Array.isArray(config.args) ? config.args.map(arg => String(arg)) : [];
    const timeoutMs = envNumber('ECC_MCP_HEALTH_TIMEOUT_MS', DEFAULT_TIMEOUT_MS);
    const mergedEnv = {
      ...process.env,
      ...(config.env && typeof config.env === 'object' && !Array.isArray(config.env) ? config.env : {})
    };

    let done = false;

    function finish(result) {
      if (done) return;
      done = true;
      resolve(result);
    }

    // On Windows, commands like 'npx' are commonly exposed as npx.cmd.
    // Probe bare PATH commands through platform-extension fallbacks, but keep
    // absolute/relative path commands as a single candidate so their existing
    // ENOENT failure semantics stay intact.
    const commandIsString = typeof command === 'string' && command.length > 0;
    const isPathLike = commandIsString && (
      path.isAbsolute(command)
      || command.includes('/')
      || command.includes('\\')
    );
    const candidates = process.platform === 'win32'
      && commandIsString
      && !path.extname(command)
      && !isPathLike
        ? [command, `${command}.cmd`, `${command}.exe`, `${command}.bat`]
        : [command];

    // cmd.exe treats these as operators, grouping syntax, expansion markers,
    // separators, or argument boundaries. Do not route such command strings
    // through shell mode.
    const UNSAFE_SHELL_CHARS = /[&|<>^%!()\s;]/;

    function attempt(idx) {
      const tryCommand = candidates[idx];
      const isLast = idx + 1 >= candidates.length;
      let stderr = '';
      let attemptDone = false;
      let timer = null;

      function retryNext() {
        if (attemptDone) return;
        attemptDone = true;
        if (timer) {
          clearTimeout(timer);
          timer = null;
        }
        attempt(idx + 1);
      }

      function attemptFinish(result) {
        if (attemptDone) return;
        attemptDone = true;
        if (timer) {
          clearTimeout(timer);
          timer = null;
        }
        finish(result);
      }

      // Node 18.20+/20.12+ refuse to spawn .cmd/.bat directly on Windows
      // after the CVE-2024-27980 mitigation. Only those extension candidates
      // go through cmd.exe, after the command string is shell-character clean.
      const useShell = process.platform === 'win32'
        && typeof tryCommand === 'string'
        && /\.(cmd|bat)$/i.test(tryCommand)
        && !UNSAFE_SHELL_CHARS.test(tryCommand);

      let child;
      try {
        child = spawn(tryCommand, args, {
          env: mergedEnv,
          cwd: process.cwd(),
          stdio: ['pipe', 'ignore', 'pipe'],
          shell: useShell
        });
      } catch (error) {
        if ((error.code === 'ENOENT' || error.code === 'EINVAL') && !isLast) {
          retryNext();
          return;
        }
        attemptFinish({
          ok: false,
          statusCode: null,
          reason: error.message
        });
        return;
      }

      child.stderr.on('data', chunk => {
        if (stderr.length < 4000) {
          const remaining = 4000 - stderr.length;
          stderr += String(chunk).slice(0, remaining);
        }
      });

      child.on('error', error => {
        if ((error.code === 'ENOENT' || error.code === 'EINVAL') && !isLast) {
          retryNext();
          return;
        }
        attemptFinish({
          ok: false,
          statusCode: null,
          reason: error.message
        });
      });

      child.on('exit', (code, signal) => {
        attemptFinish({
          ok: false,
          statusCode: code,
          reason: stderr.trim() || `process exited before handshake (${signal || code || 'unknown'})`
        });
      });

      timer = setTimeout(() => {
        // A fast-crashing stdio server can finish before the timer callback runs
        // on a loaded machine. Check the process state again before classifying it
        // as healthy on timeout.
        if (child.exitCode !== null || child.signalCode !== null) {
          attemptFinish({
            ok: false,
            statusCode: child.exitCode,
            reason: stderr.trim() || `process exited before handshake (${child.signalCode || child.exitCode || 'unknown'})`
          });
          return;
        }

        try {
          if (useShell && child.pid && process.platform === 'win32') {
            // When spawned via shell on Windows, child is cmd.exe. kill() only
            // terminates the shell and leaves the real server process orphaned.
            // taskkill /T kills the entire process tree rooted at cmd.exe.
            const killResult = spawnSync('taskkill', ['/PID', String(child.pid), '/T', '/F'], {
              stdio: 'ignore',
              windowsHide: true
            });
            if (killResult.error || (typeof killResult.status === 'number' && killResult.status !== 0)) {
              // taskkill not on PATH, permission denied, or already exited.
              // Best-effort fallback: signal the cmd.exe shell directly. The
              // child tree may still leak if it already detached, but this at
              // least kills the shell we spawned.
              try { child.kill('SIGKILL'); } catch { /* ignore */ }
            }
          } else {
            child.kill('SIGTERM');
            setTimeout(() => {
              try {
                child.kill('SIGKILL');
              } catch {
                // ignore
              }
            }, 200).unref?.();
          }
        } catch {
          // ignore
        }

        attemptFinish({
          ok: true,
          statusCode: null,
          reason: `${serverName} accepted a new stdio process`
        });
      }, timeoutMs);

      if (typeof timer.unref === 'function') {
        timer.unref();
      }
    }

    attempt(0);
  });
}

async function probeServer(serverName, resolvedConfig) {
  const config = resolvedConfig.config;

  if (config.type === 'http' || config.url) {
    const result = await requestHttp(config.url, config.headers || {}, envNumber('ECC_MCP_HEALTH_TIMEOUT_MS', DEFAULT_TIMEOUT_MS));

    return {
      ok: result.ok,
      failureCode: RECONNECT_STATUS_CODES.has(result.statusCode) ? result.statusCode : null,
      reason: result.reason,
      source: resolvedConfig.source
    };
  }

  if (config.command) {
    const result = await probeCommandServer(serverName, config);

    return {
      ok: result.ok,
      failureCode: RECONNECT_STATUS_CODES.has(result.statusCode) ? result.statusCode : null,
      reason: result.reason,
      source: resolvedConfig.source
    };
  }

  return {
    ok: false,
    failureCode: null,
    reason: 'unsupported MCP server config',
    source: resolvedConfig.source
  };
}

function reconnectCommand(serverName) {
  const key = `ECC_MCP_RECONNECT_${String(serverName).toUpperCase().replace(/[^A-Z0-9]/g, '_')}`;
  const command = process.env[key] || process.env.ECC_MCP_RECONNECT_COMMAND || '';
  if (!command.trim()) {
    return null;
  }

  return command.includes('{server}')
    ? command.replace(/\{server\}/g, serverName)
    : command;
}

function attemptReconnect(serverName) {
  const command = reconnectCommand(serverName);
  if (!command) {
    return { attempted: false, success: false, reason: 'no reconnect command configured' };
  }

  const result = spawnSync(command, {
    shell: true,
    env: process.env,
    cwd: process.cwd(),
    encoding: 'utf8',
    timeout: envNumber('ECC_MCP_RECONNECT_TIMEOUT_MS', DEFAULT_TIMEOUT_MS)
  });

  if (result.error) {
    return { attempted: true, success: false, reason: result.error.message };
  }

  if (result.status !== 0) {
    return {
      attempted: true,
      success: false,
      reason: (result.stderr || result.stdout || `reconnect exited ${result.status}`).trim()
    };
  }

  return { attempted: true, success: true, reason: 'reconnect command completed' };
}

function shouldFailOpen() {
  return /^(1|true|yes)$/i.test(String(process.env.ECC_MCP_HEALTH_FAIL_OPEN || ''));
}

function emitLogs(logs) {
  for (const line of logs) {
    process.stderr.write(`${line}\n`);
  }
}

async function handlePreToolUse(rawInput, input, target, statePathValue, now) {
  const logs = [];
  const state = loadState(statePathValue);
  const previous = state.servers[target.server] || {};

  if (previous.status === 'healthy' && Number(previous.expiresAt || 0) > now) {
    return { rawInput, exitCode: 0, logs };
  }

  if (previous.status === 'unhealthy' && Number(previous.nextRetryAt || 0) > now) {
    logs.push(
      `[MCPHealthCheck] ${target.server} is marked unhealthy until ${new Date(previous.nextRetryAt).toISOString()}; skipping ${target.tool || 'tool'}`
    );
    return { rawInput, exitCode: shouldFailOpen() ? 0 : 2, logs };
  }

  const resolvedConfig = resolveServerConfig(target.server);
  if (!resolvedConfig) {
    logs.push(`[MCPHealthCheck] No MCP config found for ${target.server}; skipping preflight probe`);
    return { rawInput, exitCode: 0, logs };
  }

  const probe = await probeServer(target.server, resolvedConfig);
  if (probe.ok) {
    markHealthy(state, target.server, now, { source: resolvedConfig.source });
    saveState(statePathValue, state);

    if (previous.status === 'unhealthy') {
      logs.push(`[MCPHealthCheck] ${target.server} connection restored`);
    }

    return { rawInput, exitCode: 0, logs };
  }

  let reconnect = { attempted: false, success: false, reason: 'probe failed' };
  if (probe.failureCode || previous.status === 'unhealthy') {
    reconnect = attemptReconnect(target.server);
    if (reconnect.success) {
      const reprobe = await probeServer(target.server, resolvedConfig);
      if (reprobe.ok) {
        markHealthy(state, target.server, now, {
          source: resolvedConfig.source,
          restoredBy: 'reconnect-command'
        });
        saveState(statePathValue, state);
        logs.push(`[MCPHealthCheck] ${target.server} connection restored after reconnect`);
        return { rawInput, exitCode: 0, logs };
      }
      probe.reason = `${probe.reason}; reconnect reprobe failed: ${reprobe.reason}`;
    }
  }

  markUnhealthy(state, target.server, now, probe.failureCode, probe.reason);
  saveState(statePathValue, state);

  const reconnectSuffix = reconnect.attempted
    ? ` Reconnect attempt: ${reconnect.success ? 'ok' : reconnect.reason}.`
    : '';
  logs.push(
    `[MCPHealthCheck] ${target.server} is unavailable (${probe.reason}). Blocking ${target.tool || 'tool'} so Claude can fall back to non-MCP tools.${reconnectSuffix}`
  );

  return { rawInput, exitCode: shouldFailOpen() ? 0 : 2, logs };
}

async function handlePostToolUseFailure(rawInput, input, target, statePathValue, now) {
  const logs = [];
  const summary = failureSummary(input);
  const failureCode = detectFailureCode(summary);

  if (!failureCode) {
    return { rawInput, exitCode: 0, logs };
  }

  const state = loadState(statePathValue);
  markUnhealthy(state, target.server, now, failureCode, summary.slice(0, 500));
  saveState(statePathValue, state);

  logs.push(`[MCPHealthCheck] ${target.server} reported ${failureCode}; marking server unhealthy and attempting reconnect`);

  const reconnect = attemptReconnect(target.server);
  if (!reconnect.attempted) {
    logs.push(`[MCPHealthCheck] ${target.server} reconnect skipped: ${reconnect.reason}`);
    return { rawInput, exitCode: 0, logs };
  }

  if (!reconnect.success) {
    logs.push(`[MCPHealthCheck] ${target.server} reconnect failed: ${reconnect.reason}`);
    return { rawInput, exitCode: 0, logs };
  }

  const resolvedConfig = resolveServerConfig(target.server);
  if (!resolvedConfig) {
    logs.push(`[MCPHealthCheck] ${target.server} reconnect completed but no config was available for a follow-up probe`);
    return { rawInput, exitCode: 0, logs };
  }

  const reprobe = await probeServer(target.server, resolvedConfig);
  if (!reprobe.ok) {
    logs.push(`[MCPHealthCheck] ${target.server} reconnect command ran, but health probe still failed: ${reprobe.reason}`);
    return { rawInput, exitCode: 0, logs };
  }

  const refreshed = loadState(statePathValue);
  markHealthy(refreshed, target.server, now, {
    source: resolvedConfig.source,
    restoredBy: 'post-failure-reconnect'
  });
  saveState(statePathValue, refreshed);
  logs.push(`[MCPHealthCheck] ${target.server} connection restored`);
  return { rawInput, exitCode: 0, logs };
}

async function main() {
  const { raw: rawInput, truncated } = await readRawStdin();
  const input = safeParse(rawInput);
  const target = extractMcpTarget(input) || (truncated ? extractMcpTargetFromRaw(rawInput) : null);

  if (!target) {
    process.stdout.write(rawInput);
    process.exit(0);
    return;
  }

  if (truncated) {
    const limit = Number(process.env.ECC_HOOK_INPUT_MAX_BYTES) || MAX_STDIN;
    const logs = [
      shouldFailOpen()
        ? `[MCPHealthCheck] Hook input exceeded ${limit} bytes while checking ${target.server}; allowing ${target.tool || 'tool'} because fail-open mode is enabled`
        : `[MCPHealthCheck] Hook input exceeded ${limit} bytes while checking ${target.server}; blocking ${target.tool || 'tool'} to avoid bypassing MCP health checks`
    ];
    emitLogs(logs);
    process.stdout.write(rawInput);
    process.exit(shouldFailOpen() ? 0 : 2);
    return;
  }

  const eventName = process.env.CLAUDE_HOOK_EVENT_NAME || 'PreToolUse';
  const now = Date.now();
  const statePathValue = stateFilePath();

  const result = eventName === 'PostToolUseFailure'
    ? await handlePostToolUseFailure(rawInput, input, target, statePathValue, now)
    : await handlePreToolUse(rawInput, input, target, statePathValue, now);

  emitLogs(result.logs);
  process.stdout.write(result.rawInput);
  process.exit(result.exitCode);
}

main().catch(error => {
  process.stderr.write(`[MCPHealthCheck] Unexpected error: ${error.message}\n`);
  process.exit(0);
});
