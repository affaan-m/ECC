#!/usr/bin/env node
const { readStdin, hookEnabled } = require('./adapter');
readStdin().then(raw => {
  if (!hookEnabled('post:mcp:audit', ['standard', 'strict'])) {
    process.stdout.write(raw);
    return;
  }
  try {
    const input = JSON.parse(raw);
    const server = input.server || input.mcp_server || 'unknown';
    const tool = input.tool || input.mcp_tool || 'unknown';
    const success = input.error ? 'FAILED' : 'OK';
    console.error(`[ECC] MCP result: ${server}/${tool} - ${success}`);
  } catch {
    // Audit-only hook: malformed payloads must not interrupt the agent loop.
  }
  process.stdout.write(raw);
}).catch(() => process.exit(0));
