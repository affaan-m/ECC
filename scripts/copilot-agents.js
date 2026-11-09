#!/usr/bin/env node
'use strict';
const fs = require('fs');
const path = require('path');
const { inspectCopilotAgent } = require('./lib/install/copilot-agent');
const { readBounded } = require('./lib/copilot-sessions');
const ROOT = path.resolve(__dirname, '..');
function report(root = ROOT, env = process.env) {
  const files = fs.readdirSync(path.join(root, 'agents')).filter(file => file.endsWith('.md')).sort();
  if (files.length > 500) throw new Error('Agent catalog scan quota exceeded.');
  const agents = files.map(file => inspectCopilotAgent(readBounded(path.join(root, 'agents', file), 256 * 1024),
    `agents/${file}`, { operatorEnvironment: env }));
  return { schema: 'ecc.copilot.agent-projection.v1', nativeEnforcement: 'unverified', agents,
    counts: agents.reduce((counts, agent) => ({ ...counts, [agent.status]: (counts[agent.status] || 0) + 1 }), {}) };
}
function main(args = process.argv.slice(2)) {
  if (args.length !== 1 || args[0] !== 'report') throw new Error('Usage: copilot-agents.js report');
  process.stdout.write(`${JSON.stringify(report(), null, 2)}\n`);
}
if (require.main === module) {
  try { main(); }
  catch { process.stderr.write('Copilot agent report unavailable: inspect explicit operator configuration and catalog inputs. No config contents are echoed.\n'); process.exitCode = 1; }
}
module.exports = { report, main };
