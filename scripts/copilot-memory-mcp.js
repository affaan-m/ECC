#!/usr/bin/env node
'use strict';

// Fixed Copilot bootstrap. The selected canonical package supplies all Vault
// algorithms and protocol handling; neither requests nor memories select code.
const { pathToFileURL } = require('url');
const { runtimePrerequisite } = require('./lib/copilot-memory');
async function main(args = process.argv.slice(2), env = process.env) {
  if (args.length !== 2 || args[0] !== '--runtime') throw new Error('Explicit --runtime package root required.');
  const runtime = runtimePrerequisite({ ...env, ECC_COPILOT_MEMORY_RUNTIME: args[1] });
  if (!runtime.available || !runtime.mcpAvailable) throw new Error('Canonical Memory MCP runtime unavailable.');
  const canonical = await import(pathToFileURL(runtime.mcpScript).href);
  if (typeof canonical.runStdioServer !== 'function') throw new Error('Unsupported canonical Memory MCP runtime.');
  canonical.runStdioServer({ serviceOptions: { harness: 'copilot', allowUserScope: env.ECC_MEMORY_ALLOW_USER_SCOPE === '1' } });
}
if (require.main === module) main().catch(() => {
  process.stderr.write('Copilot Memory MCP startup failed: invalid or unavailable explicit runtime.\n'); process.exitCode = 1;
});
module.exports = { main };
