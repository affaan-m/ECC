'use strict';

/**
 * Antigravity MCP Configuration Generator
 *
 * Generates valid Antigravity mcp_config.json containing the ECC Memory Vault
 * stdio server so that Antigravity agents have native access to .ecc/memory/.
 */

function buildAntigravityMcpConfig(options = {}) {
  const memoryScript = options.memoryScript || 'scripts/memory-mcp.mjs';

  return {
    mcpServers: {
      'ecc-memory': {
        command: 'node',
        args: [memoryScript],
        env: {
          ECC_MEMORY_HARNESS: 'antigravity',
        },
      },
    },
  };
}

module.exports = {
  buildAntigravityMcpConfig,
};
