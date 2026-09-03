'use strict';

const { adaptAntigravityAgent } = require('./antigravity-agent');

function formatJson(value) {
  return `${JSON.stringify(value, null, 2)}\n`;
}

function transformCopyFileContent(operation, content) {
  if (!operation.contentTransform) {
    return content;
  }
  if (operation.contentTransform === 'antigravity-agent-frontmatter') {
    return adaptAntigravityAgent(content, operation.sourceRelativePath);
  }
  if (operation.contentTransform === 'grok-plugin-consent') {
    const manifest = JSON.parse(content);
    return formatJson({
      ...manifest,
      hooks: operation.grokHooksEnabled ? 'hooks/hooks.json' : '',
      mcpServers: operation.grokMcpEnabled ? '.mcp.json' : '',
    });
  }
  if (operation.contentTransform === 'grok-hook-boundary') {
    return content.split('var e=process.env.CLAUDE_PLUGIN_ROOT;').join(
      'var e=process.env.GROK_PLUGIN_ROOT||process.env.CLAUDE_PLUGIN_ROOT;'
    );
  }
  if (operation.contentTransform === 'grok-mcp-consent') {
    const config = JSON.parse(content);
    if (!config || typeof config !== 'object' || Array.isArray(config)
      || !config.mcpServers || typeof config.mcpServers !== 'object' || Array.isArray(config.mcpServers)) {
      throw new Error(`Invalid Grok MCP config: ${operation.sourceRelativePath}`);
    }
    const allowed = new Set(operation.grokMcpIds || []);
    return formatJson({
      ...config,
      mcpServers: Object.fromEntries(
        Object.entries(config.mcpServers).filter(([id]) => allowed.has(id))
      ),
    });
  }
  throw new Error(`Unknown install content transform: ${operation.contentTransform}`);
}

module.exports = {
  transformCopyFileContent,
};
