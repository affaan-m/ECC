/**
 * Astra review: invoke the Codex CLI (ChatGPT login) with GPT-6-Astra
 * in a read-only sandbox and return the parsed structured verdict. The fix
 * fallback reuses the same isolation with a workspace-write sandbox.
 */

'use strict';

const fs = require('fs');
const os = require('os');
const path = require('path');
const { spawnSync } = require('child_process');
const { REVIEW_SCHEMA, parseReviewOutput } = require('./prompt');
const { FIX_SCHEMA, parseFixOutput } = require('./fix');

const DEFAULT_MODEL = 'gpt-6-astra';
const DEFAULT_TIMEOUT_MS = 300_000;
const MIN_TIMEOUT_MS = 30_000;
const MAX_TIMEOUT_MS = 900_000;
const MAX_OUTPUT_BUFFER = 4 * 1024 * 1024;
// danger-full-access is never allowed: the fixer must stay inside the repository.
const ALLOWED_SANDBOXES = Object.freeze(['read-only', 'workspace-write']);
// workspace-write also allows /tmp and $TMPDIR by default; the fixer gets the repository only.
const WORKSPACE_WRITE_LIMITS = Object.freeze([
  'sandbox_workspace_write.exclude_tmpdir_env_var=true',
  'sandbox_workspace_write.exclude_slash_tmp=true',
  'sandbox_workspace_write.network_access=false',
]);

const ENV_ALLOWLIST = Object.freeze([
  'PATH', 'HOME', 'USERPROFILE', 'CODEX_HOME',
  'TMPDIR', 'TMP', 'TEMP', 'SystemRoot', 'ComSpec', 'PATHEXT', 'LANG', 'LC_ALL',
]);

/**
 * Only pass through what Codex needs. API keys and other secrets stay out.
 * Keys match case-insensitively (Windows exposes `Path`, not `PATH`) and keep
 * their original spelling so the child process sees what the OS expects.
 */
function buildEnvironment(sourceEnv = process.env) {
  const allowed = new Set(ENV_ALLOWLIST.map((name) => name.toUpperCase()));
  return Object.fromEntries(
    Object.entries(sourceEnv).filter(([name, value]) => value && allowed.has(name.toUpperCase()))
  );
}

// `codex -c` treats dots as key separators and does not support quoted keys,
// so a dotted server name cannot be disabled reliably. Refuse instead of guessing.
const MCP_SERVER_NAME = /^[A-Za-z0-9][A-Za-z0-9_-]*$/;
const MCP_LIST_TIMEOUT_MS = 15_000;

/**
 * Codex merges `mcp_servers={}` with the loaded config instead of clearing it,
 * so every configured server is disabled by name. The user config file is
 * skipped as well (auth is separate and still applies). Because exec then no
 * longer sees user-level servers, a bare `<name>.enabled=false` would create an
 * entry without a transport and Codex rejects it; the override therefore
 * carries an inert stdio transport alongside enabled=false.
 * @param {{cwd: string, model: string, outputFile: string, schemaFile: string, mcpServers?: string[], sandbox?: string}} input
 * @returns {string[]}
 */
function buildCodexArgs(input) {
  const sandbox = input.sandbox || 'read-only';
  if (!ALLOWED_SANDBOXES.includes(sandbox)) {
    throw new Error(`sandbox must be one of ${ALLOWED_SANDBOXES.join(', ')} (got ${sandbox})`);
  }
  const mcpDisables = (input.mcpServers || []).flatMap((name) => {
    if (!MCP_SERVER_NAME.test(name)) {
      throw new Error(`cannot isolate MCP server name "${name}" (only letters, digits, - and _ can be disabled via codex -c); rename or disable it in the Codex config first`);
    }
    return ['--config', `mcp_servers.${name}={command="true",enabled=false}`];
  });
  const writeLimits = sandbox === 'workspace-write'
    ? WORKSPACE_WRITE_LIMITS.flatMap((setting) => ['--config', setting])
    : [];
  return [
    '--ask-for-approval', 'never',
    'exec',
    '--ignore-user-config',
    '--sandbox', sandbox,
    '--cd', input.cwd,
    '--color', 'never',
    '--skip-git-repo-check',
    '-m', input.model,
    '--config', 'web_search="disabled"',
    ...writeLimits,
    ...mcpDisables,
    '--output-schema', input.schemaFile,
    '--output-last-message', input.outputFile,
    '-',
  ];
}

/**
 * Names of every MCP server Codex would load, so each can be disabled explicitly.
 * @param {{command: string, prefixArgs: string[]}} launcher
 * @param {{spawnSync?: Function, env?: object}} [deps]
 * @returns {string[]}
 */
function listConfiguredMcpServers(launcher, deps = {}) {
  const spawn = deps.spawnSync || spawnSync;
  const result = spawn(launcher.command, [...launcher.prefixArgs, 'mcp', 'list', '--json'], {
    env: deps.env || process.env,
    encoding: 'utf8',
    timeout: MCP_LIST_TIMEOUT_MS,
    maxBuffer: MAX_OUTPUT_BUFFER,
    windowsHide: true,
  });
  if (result.error) throw translateSpawnError(result.error);
  let servers;
  try {
    servers = JSON.parse(result.stdout || '');
  } catch (error) {
    throw new Error(`MCP servers could not be listed (${error.message}); refusing to review without isolation`);
  }
  if (result.status !== 0 || !Array.isArray(servers)) {
    const detail = (result.stderr || '').trim().split('\n').slice(-1)[0];
    throw new Error(`MCP servers could not be listed${detail ? `: ${detail}` : ''}; refusing to review without isolation`);
  }
  return servers.map((server) => String(server && server.name));
}

/**
 * The npm-installed Codex CLI is a `codex.cmd` shim on Windows, which Node
 * cannot spawn without a shell. Run its JavaScript entry point through node
 * instead; a native codex.exe is used as-is. Elsewhere `codex` on PATH is enough.
 * @param {{platform?: string, env?: object, existsSync?: Function, execPath?: string}} [deps]
 * @returns {{command: string, prefixArgs: string[]}}
 */
function resolveCodexCommand(deps = {}) {
  const platform = deps.platform || process.platform;
  if (platform !== 'win32') return { command: 'codex', prefixArgs: [] };

  const env = deps.env || process.env;
  const exists = deps.existsSync || fs.existsSync;
  const execPath = deps.execPath || process.execPath;
  const pathValue = env.PATH || env.Path || env.path || '';
  const dirs = pathValue.split(';').filter(Boolean);

  const exeDir = dirs.find((dir) => exists(path.win32.join(dir, 'codex.exe')));
  if (exeDir) return { command: path.win32.join(exeDir, 'codex.exe'), prefixArgs: [] };

  const shimDir = dirs.find((dir) => exists(path.win32.join(dir, 'codex.cmd')));
  if (shimDir) {
    const entry = path.win32.join(shimDir, 'node_modules', '@openai', 'codex', 'bin', 'codex.js');
    if (exists(entry)) return { command: execPath, prefixArgs: [entry] };
  }
  return { command: 'codex', prefixArgs: [] };
}

function translateSpawnError(error, task = 'review') {
  if (error.code === 'ENOENT') return new Error('Codex CLI is not installed (install: npm i -g @openai/codex)');
  if (error.code === 'ETIMEDOUT') return new Error(`Codex ${task} timed out`);
  return new Error(`Codex invocation failed: ${error.message}`);
}

function readLastMessage(outputFile) {
  let text;
  try {
    text = fs.readFileSync(outputFile, 'utf8').trim();
  } catch (error) {
    throw new Error(`Codex returned no final response: ${error.message}`);
  }
  if (!text) throw new Error('Codex returned an empty final response');
  return text;
}

/**
 * Shared Codex exec runner: isolated environment, MCP servers disabled,
 * structured output enforced by `schema` and validated by `parse`.
 * @param {{prompt: string, cwd: string, model: string, timeoutMs: number}} input
 * @param {{task: string, sandbox: string, schema: object, parse: Function}} mode
 * @param {{spawnSync?: Function, env?: object, resolveCodexCommand?: Function}} deps
 */
function runCodexExec(input, mode, deps) {
  if (!input.prompt || !input.prompt.trim()) throw new Error(`${mode.task} prompt is empty`);
  if (input.timeoutMs < MIN_TIMEOUT_MS || input.timeoutMs > MAX_TIMEOUT_MS) {
    throw new Error(`timeout must be between ${MIN_TIMEOUT_MS / 1000} and ${MAX_TIMEOUT_MS / 1000} seconds`);
  }

  const spawn = deps.spawnSync || spawnSync;
  const environment = buildEnvironment(deps.env || process.env);
  const launcher = (deps.resolveCodexCommand || resolveCodexCommand)({ env: environment });
  const tempDir = fs.mkdtempSync(path.join(os.tmpdir(), `ecc-astra-${mode.task}-`));
  const outputFile = path.join(tempDir, 'last-message.txt');
  const schemaFile = path.join(tempDir, `${mode.task}-schema.json`);

  try {
    fs.writeFileSync(schemaFile, JSON.stringify(mode.schema), 'utf8');
    const mcpServers = listConfiguredMcpServers(launcher, { spawnSync: spawn, env: environment });
    const args = buildCodexArgs({
      cwd: input.cwd, model: input.model, outputFile, schemaFile, mcpServers, sandbox: mode.sandbox,
    });
    const result = spawn(launcher.command, [...launcher.prefixArgs, ...args], {
      cwd: input.cwd,
      env: environment,
      input: input.prompt,
      encoding: 'utf8',
      timeout: input.timeoutMs,
      maxBuffer: MAX_OUTPUT_BUFFER,
      windowsHide: true,
    });

    if (result.error) throw translateSpawnError(result.error, mode.task);
    if (result.status !== 0) {
      const detail = (result.stderr || '').trim().split('\n').slice(-1)[0];
      throw new Error(`Codex ${mode.task} failed${detail ? `: ${detail}` : ''}`);
    }
    return mode.parse(readLastMessage(outputFile));
  } finally {
    fs.rmSync(tempDir, { recursive: true, force: true });
  }
}

/**
 * @param {{prompt: string, cwd: string, model: string, timeoutMs: number}} input
 * @param {{spawnSync?: Function, env?: object, resolveCodexCommand?: Function}} [deps]
 * @returns {object} Parsed review
 */
function runCodexReview(input, deps = {}) {
  return runCodexExec(input, {
    task: 'review', sandbox: 'read-only', schema: REVIEW_SCHEMA, parse: parseReviewOutput,
  }, deps);
}

/**
 * Fallback writer: Astra edits the working tree to fix confirmed findings.
 * @param {{prompt: string, cwd: string, model: string, timeoutMs: number}} input
 * @param {{spawnSync?: Function, env?: object, resolveCodexCommand?: Function}} [deps]
 * @returns {object} Parsed fix result
 */
function runCodexFix(input, deps = {}) {
  return runCodexExec(input, {
    task: 'fix', sandbox: 'workspace-write', schema: FIX_SCHEMA, parse: parseFixOutput,
  }, deps);
}

module.exports = {
  DEFAULT_MODEL,
  DEFAULT_TIMEOUT_MS,
  MAX_TIMEOUT_MS,
  MIN_TIMEOUT_MS,
  buildCodexArgs,
  buildEnvironment,
  listConfiguredMcpServers,
  resolveCodexCommand,
  runCodexFix,
  runCodexReview,
};
