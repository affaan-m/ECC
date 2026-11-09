'use strict';

const fs = require('fs');
const path = require('path');
const crypto = require('crypto');
const { spawn } = require('child_process');
const { findPotentialSecrets } = require('./memory-vault-format');
const { mapRemote, probeHttp } = require('./copilot-mcp-http');
const LIMIT = 1024 * 1024;
const REF = /^\$\{([A-Za-z_][A-Za-z0-9_]*)\}$/;
const BUILTIN = new Set(['github', 'github-mcp-server']);
function object(value) {
  if (!value || typeof value !== 'object' || Array.isArray(value)) throw new Error('Expected JSON object');
  return value;
}
function hash(value) { return crypto.createHash('sha256').update(value).digest('hex'); }
function entryHash(value) { return hash(JSON.stringify(value)); }
function safePath(file) {
  if (typeof file !== 'string' || !path.isAbsolute(file)) throw new Error('Explicit absolute config path required');
  const resolved = path.resolve(file);
  for (let cursor = resolved; ; cursor = path.dirname(cursor)) {
    try {
      const stat = fs.lstatSync(cursor);
      if (stat.isSymbolicLink() || (stat.isFile() && stat.nlink !== 1)) throw new Error('Linked config paths are unsupported');
    } catch (error) { if (error.code !== 'ENOENT') throw error; }
    if (path.dirname(cursor) === cursor) break;
  }
  return resolved;
}
function load(file, fallback) {
  safePath(file);
  try {
    const fd = fs.openSync(file, fs.constants.O_RDONLY | (fs.constants.O_NOFOLLOW || 0));
    try {
      const stat = fs.fstatSync(fd);
      if (!stat.isFile() || stat.nlink !== 1 || stat.size > LIMIT) throw new Error('Config is not a bounded regular file');
      const buffer = Buffer.alloc(LIMIT + 1);
      let bytes = 0;
      while (bytes <= LIMIT) {
        const count = fs.readSync(fd, buffer, bytes, buffer.length - bytes, null);
        if (!count) break;
        bytes += count;
      }
      if (bytes > LIMIT) throw new Error('Config grew beyond the read limit');
      const raw = new TextDecoder('utf-8', { fatal: true }).decode(buffer.subarray(0, bytes));
      return { value: object(JSON.parse(raw)), digest: hash(raw) };
    } finally { fs.closeSync(fd); }
  } catch (error) { if (error.code !== 'ENOENT') throw error; return { value: fallback, digest: null }; }
}
function paths(configPath) {
  const config = safePath(configPath);
  return { config, state: `${config}.ecc-managed.json`, lock: `${config}.ecc-lock` };
}
function configState(configPath) {
  const files = paths(configPath);
  const config = load(files.config, { mcpServers: {} });
  if (!Object.hasOwn(config.value, 'mcpServers') && Object.keys(config.value).length) {
    throw new Error('Unsupported bare or VS Code config format; explicitly migrate to mcpServers first');
  }
  if (Object.hasOwn(config.value, 'mcpServers')) object(config.value.mcpServers);
  const state = load(files.state, { version: 1, managed: {} });
  if (state.value.version !== 1) throw new Error('Unsupported MCP ownership version');
  object(state.value.managed);
  if (Object.keys(state.value).some(key => !['version', 'managed'].includes(key))
    || Object.entries(state.value.managed).some(([alias, digest]) => {
      try { name(alias); } catch { return true; }
      return typeof digest !== 'string' || !/^[a-f0-9]{64}$/.test(digest);
    })) throw new Error('Invalid MCP ownership state');
  return { files, config, state };
}
function name(value) {
  if (typeof value !== 'string' || !/^[A-Za-z0-9][A-Za-z0-9_-]{0,63}$/.test(value) || ['__proto__', 'constructor', 'prototype'].includes(value)) throw new Error('Unsupported server name');
  return value;
}
function credentialArguments(command, args) {
  const text = [command, ...args].join('\n');
  const assignment = /(?:password|passwd|api[-_]?key|access[-_]?token|auth[-_]?token|client[-_]?secret|secret|token)\s*[:=]\s*\S+/i;
  const flag = /^--?(?:password|passwd|api[-_]?key|access[-_]?token|auth[-_]?token|client[-_]?secret|secret|token)(?:=|$)/i;
  if (findPotentialSecrets(text).length || assignment.test(text)
    || /https?:\/\/[^\s/]+:[^\s/@]+@/i.test(text)
    || /\bauthorization\s*[:=]\s*\S+/i.test(text)
    || args.some(arg => flag.test(arg))) {
    throw new Error('Literal credential arguments are unsupported; use environment references in env.');
  }
}
function mapServer(server, tools = []) {
  object(server);
  if (!Array.isArray(tools) || tools.some(tool => typeof tool !== 'string' || !/^[\w*-]+$/.test(tool))) throw new Error('Invalid tool selection');
  if (['http', 'streamable-http', 'sse'].includes(server.type)) return mapRemote(server, tools);
  const allowed = new Set(['type', 'command', 'args', 'env', 'description', 'tools']);
  if (Object.keys(server).some(key => !allowed.has(key))) throw new Error('Unsupported server fields; explicit adapter required');
  if (server.type && !['local', 'stdio'].includes(server.type)) throw new Error('Unsupported transport: local stdio only');
  if (typeof server.command !== 'string' || !server.command || /[\0\r\n]/.test(server.command)) throw new Error('Invalid executable');
  if (!Array.isArray(server.args) || server.args.some(arg => typeof arg !== 'string' || /\0/.test(arg))) throw new Error('Invalid arguments');
  credentialArguments(server.command, server.args);
  if (!Array.isArray(tools) || tools.some(tool => typeof tool !== 'string' || !/^[\w*-]+$/.test(tool))) throw new Error('Invalid tool selection');
  const env = Object.fromEntries(Object.keys(object(server.env || {})).map(key => {
    if (!/^[A-Za-z_][A-Za-z0-9_]*$/.test(key)) throw new Error('Invalid environment key');
    return [key, '${' + key + '}'];
  }));
  // Values never travel from catalog env into a config or preview. Credentials
  // belong to the operator environment; only variable references are written.
  return { type: 'local', command: server.command, args: [...server.args], env, tools: [...tools] };
}
function preview({ configPath, catalog, selected }) {
  const { files, config, state } = configState(configPath);
  object(catalog); object(catalog.mcpServers);
  if (!Array.isArray(selected)) throw new Error('Explicit server selection required');
  const names = selected.map(item => name(item.alias || item.name));
  if (new Set(names).size !== names.length) throw new Error('Duplicate server aliases');
  const additions = {}; const retained = []; const skipped = [];
  selected.forEach((item, index) => {
    const canonical = name(item.name); const alias = names[index];
    if (BUILTIN.has(canonical) || BUILTIN.has(alias)) { skipped.push({ name: canonical, reason: 'built-in-github' }); return; }
    if (!Object.hasOwn(catalog.mcpServers, canonical)) throw new Error('Unknown selected server');
    const projected = mapServer(catalog.mcpServers[canonical], item.tools || []);
    const current = config.value.mcpServers?.[alias];
    if (current !== undefined) {
      if (state.value.managed[alias] !== entryHash(current)) throw new Error(`Server collision or user-modified entry: ${alias}`);
      if (entryHash(projected) !== entryHash(current)) throw new Error(`Managed server changed; rollback and preview replacement: ${alias}`);
      retained.push(alias); return;
    }
    additions[alias] = projected;
  });
  return { version: 1, configPath: files.config, expected_config_sha256: config.digest,
    expected_state_sha256: state.digest, additions, retained, skipped, native_status: 'native-unverified' };
}
function atomicWrite(file, value) {
  safePath(file);
  const temporary = `${file}.tmp-${crypto.randomBytes(8).toString('hex')}`;
  try {
    fs.writeFileSync(temporary, JSON.stringify(value, null, 2) + '\n', { flag: 'wx', mode: 0o600 });
    fs.renameSync(temporary, file);
  } finally { try { fs.unlinkSync(temporary); } catch (error) { if (error.code !== 'ENOENT') process.emitWarning('MCP temporary file cleanup failed'); } }
}
function locked(configPath, fn) {
  const files = paths(configPath);
  fs.mkdirSync(path.dirname(files.config), { recursive: true, mode: 0o700 });
  safePath(files.config);
  const fd = fs.openSync(files.lock, 'wx', 0o600);
  try { return fn(configState(configPath)); }
  finally { fs.closeSync(fd); fs.unlinkSync(files.lock); }
}
function apply(plan) {
  if (plan.version !== 1) throw new Error('Unsupported plan version');
  return locked(plan.configPath, ({ files, config, state }) => {
    if (config.digest !== plan.expected_config_sha256 || state.digest !== plan.expected_state_sha256) throw new Error('Configuration changed since preview; preview again');
    const additions = Object.fromEntries(Object.entries(object(plan.additions)).map(([alias, server]) => {
      name(alias);
      if (BUILTIN.has(alias) || Object.hasOwn(config.value.mcpServers || {}, alias)) throw new Error('Server collision');
      const mapped = mapServer(server, server.tools || []);
      // Applying a mutated preview cannot inject plaintext env credentials.
      if (JSON.stringify(mapped) !== JSON.stringify(server)) throw new Error('Invalid mapped server preview');
      return [alias, mapped];
    }));
    if (!Object.keys(additions).length) return { status: 'unchanged', added: [] };
    const nextConfig = { ...config.value, mcpServers: { ...config.value.mcpServers, ...additions } };
    const nextState = { version: 1, managed: { ...state.value.managed,
      ...Object.fromEntries(Object.entries(additions).map(([alias, server]) => [alias, entryHash(server)])) } };
    // Config first: a crash can leave an unowned entry, never ownership of a
    // user's replacement. Such an orphan requires explicit reconciliation.
    atomicWrite(files.config, nextConfig); atomicWrite(files.state, nextState);
    return { status: 'applied', added: Object.keys(additions), native_status: 'native-unverified' };
  });
}
function rollback({ configPath, aliases }) {
  if (aliases !== undefined && (!Array.isArray(aliases) || new Set(aliases).size !== aliases.length)) throw new Error('Invalid rollback alias selection');
  if (aliases) aliases.forEach(name);
  return locked(configPath, ({ files, config, state }) => {
    const servers = config.value.mcpServers || {};
    const owned = Object.keys(state.value.managed).filter(alias => aliases === undefined || aliases.includes(alias));
    const removed = owned.filter(alias => Object.hasOwn(servers, alias) && entryHash(servers[alias]) === state.value.managed[alias]);
    const preserved = owned.filter(alias => Object.hasOwn(servers, alias) && !removed.includes(alias));
    const nextServers = Object.fromEntries(Object.entries(servers).filter(([alias]) => !removed.includes(alias)));
    atomicWrite(files.config, { ...config.value, mcpServers: nextServers });
    const remaining = Object.fromEntries(Object.entries(state.value.managed).filter(([alias]) => !owned.includes(alias)));
    atomicWrite(files.state, { version: 1, managed: remaining });
    return { status: 'rolled-back', removed, preserved };
  });
}
function doctor({ configPath }) {
  const { config } = configState(configPath);
  return { status: config.digest === null ? 'not-configured' : 'configured', native_status: 'native-unverified',
    transports: Object.fromEntries(Object.entries(config.value.mcpServers || {}).map(([alias, entry]) => [alias, entry?.type || 'local'])),
    servers: Object.fromEntries(Object.keys(config.value.mcpServers || {}).map(alias => [alias, 'configured-not-probed'])) };
}
function probeStdio(server, { timeoutMs = 3000, env = process.env, cwd } = {}) {
  if (!Number.isInteger(timeoutMs) || timeoutMs < 1 || timeoutMs > 30000) throw new Error('Probe timeout must be between 1 and 30000 ms');
  if (!server || !['local', 'stdio', undefined].includes(server.type)) return Promise.resolve({ status: 'unsupported-transport' });
  const variables = {};
  for (const [key, value] of Object.entries(object(server.env || {}))) {
    const match = typeof value === 'string' && REF.exec(value);
    if (!match || typeof env[match[1]] !== 'string' || !env[match[1]]) return Promise.resolve({ status: 'missing-env', key });
    variables[key] = env[match[1]];
  }
  if (typeof server.command !== 'string' || !Array.isArray(server.args)) return Promise.resolve({ status: 'invalid-config' });
  return new Promise(resolve => {
    let settled = false; let output = ''; let bytes = 0;
    const child = spawn(server.command, server.args, { shell: false, cwd,
      env: { ...Object.fromEntries(['PATH', 'Path', 'SystemRoot', 'WINDIR', 'HOME', 'USERPROFILE', 'TEMP', 'TMP'].filter(key => env[key]).map(key => [key, env[key]])), ...variables },
      stdio: ['pipe', 'pipe', 'pipe'], windowsHide: true });
    const finish = status => {
      if (settled) return; settled = true; clearTimeout(timer); child.kill('SIGKILL'); child.stdin.destroy();
      resolve({ status, attempts: 1, tool_calls: 0 });
    };
    const timer = setTimeout(() => finish('timeout'), timeoutMs);
    child.on('error', () => finish('spawn-error'));
    child.on('close', () => finish('process-exit'));
    child.stdin.on('error', () => finish('process-exit'));
    child.stderr.on('data', chunk => { bytes += chunk.length; if (bytes > 65536) finish('output-limit'); });
    child.stdout.on('data', chunk => {
      bytes += chunk.length; if (bytes > 65536) { finish('output-limit'); return; }
      output += chunk.toString('utf8');
      const end = output.indexOf('\n'); if (end < 0) return;
      try {
        const response = JSON.parse(output.slice(0, end));
        const valid = response.jsonrpc === '2.0' && response.id === 1 && !response.error &&
          response.result?.protocolVersion === '2024-11-05' &&
          typeof response.result?.serverInfo?.name === 'string' && typeof response.result?.serverInfo?.version === 'string' &&
          response.result?.capabilities && typeof response.result.capabilities === 'object' && !Array.isArray(response.result.capabilities);
        finish(valid ? 'healthy' : 'invalid-response');
      } catch { finish('invalid-response'); }
    });
    child.stdin.write(JSON.stringify({ jsonrpc: '2.0', id: 1, method: 'initialize',
      params: { protocolVersion: '2024-11-05', capabilities: {}, clientInfo: { name: 'ecc-copilot-doctor', version: '1' } } }) + '\n');
  });
}
function probeConfigured({ configPath, alias, ...options }) {
  const { config } = configState(configPath);
  if (!Object.hasOwn(config.value.mcpServers || {}, alias)) throw new Error('Unknown probe server');
  const server = config.value.mcpServers[alias];
  return ['http', 'streamable-http', 'sse'].includes(server.type) ? probeHttp(server, options) : probeStdio(server, options);
}
module.exports = { preview, apply, rollback, doctor, probeStdio, probeHttp, probeConfigured };
