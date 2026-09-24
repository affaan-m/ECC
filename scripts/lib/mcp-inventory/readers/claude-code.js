'use strict';

const fs = require('fs');
const os = require('os');
const path = require('path');

// Claude Code stores MCP servers under "mcpServers" in ~/.claude.json (user
// scope) and in project-local .mcp.json files (project scope). Each entry:
//   { type: "stdio"|"http"|"sse", command, args[], env{}, url }
function mapClaudeServer(name, raw, source) {
  if (!raw || typeof raw !== 'object') {
    return null;
  }

  return {
    name,
    type: typeof raw.type === 'string' ? raw.type : (raw.url ? 'http' : 'stdio'),
    command: raw.command || null,
    args: Array.isArray(raw.args) ? raw.args : [],
    url: raw.url || null,
    env: raw.env && typeof raw.env === 'object' ? raw.env : {},
    enabled: raw.disabled === true ? false : true,
    source
  };
}

function readMcpServersBlock(filePath, scope) {
  if (!fs.existsSync(filePath) || !fs.statSync(filePath).isFile()) {
    return [];
  }

  let parsed;
  try {
    parsed = JSON.parse(fs.readFileSync(filePath, 'utf8'));
  } catch {
    return [];
  }

  const block = parsed && typeof parsed.mcpServers === 'object' && parsed.mcpServers
    ? parsed.mcpServers
    : {};

  return Object.entries(block)
    .map(([name, raw]) => mapClaudeServer(name, raw, {
      harness: 'claude-code',
      scope,
      configPath: filePath
    }))
    .filter(Boolean);
}

function readClaudeCodeMcp(options = {}) {
  const homeDir = options.homeDir || os.homedir();
  const userConfig = options.userConfigPath || path.join(homeDir, '.claude.json');
  const projectConfigPaths = Array.isArray(options.projectConfigPaths)
    ? options.projectConfigPaths
    : [];

  const records = [
    ...readMcpServersBlock(userConfig, 'user')
  ];

  for (const projectPath of projectConfigPaths) {
    records.push(...readMcpServersBlock(projectPath, 'project'));
  }

  return records;
}

module.exports = {
  readClaudeCodeMcp,
  mapClaudeServer
};
