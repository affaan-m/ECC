'use strict';

const fs = require('fs');
const os = require('os');
const path = require('path');

// OpenCode stores MCP servers under "mcp" in ~/.config/opencode/opencode.json.
// Shape differs from Claude/Codex:
//   { type: "local"|"remote", command: ["npx","-y","pkg"], environment: {},
//     enabled: bool, url: "https://..." }
// command is an ARRAY (binary + args combined); environment (not env) holds
// secrets; type "local" => stdio, "remote" => http/sse.
function mapOpencodeServer(name, raw, configPath) {
  if (!raw || typeof raw !== 'object') {
    return null;
  }

  const commandArray = Array.isArray(raw.command) ? raw.command.filter(item => typeof item === 'string') : [];
  const [command, ...args] = commandArray;

  return {
    name,
    type: typeof raw.type === 'string' ? raw.type : (raw.url ? 'remote' : 'local'),
    command: command || (typeof raw.command === 'string' ? raw.command : null),
    args: command ? args : (Array.isArray(raw.args) ? raw.args : []),
    url: typeof raw.url === 'string' ? raw.url : null,
    env: raw.environment && typeof raw.environment === 'object'
      ? raw.environment
      : (raw.env && typeof raw.env === 'object' ? raw.env : {}),
    enabled: raw.enabled === false ? false : true,
    source: {
      harness: 'opencode',
      scope: 'user',
      configPath
    }
  };
}

function readOpencodeMcp(options = {}) {
  const homeDir = options.homeDir || os.homedir();
  const candidatePaths = options.configPath
    ? [options.configPath]
    : [
      path.join(homeDir, '.config', 'opencode', 'opencode.json'),
      path.join(homeDir, '.config', 'opencode', 'config.json'),
      path.join(homeDir, '.opencode.json')
    ];

  const configPath = candidatePaths.find(candidate => fs.existsSync(candidate) && fs.statSync(candidate).isFile());
  if (!configPath) {
    return [];
  }

  let parsed;
  try {
    parsed = JSON.parse(fs.readFileSync(configPath, 'utf8'));
  } catch {
    return [];
  }

  const block = parsed && typeof parsed.mcp === 'object' && parsed.mcp
    ? parsed.mcp
    : (parsed && typeof parsed.mcpServers === 'object' && parsed.mcpServers ? parsed.mcpServers : {});

  return Object.entries(block)
    .map(([name, raw]) => mapOpencodeServer(name, raw, configPath))
    .filter(Boolean);
}

module.exports = {
  readOpencodeMcp,
  mapOpencodeServer
};
