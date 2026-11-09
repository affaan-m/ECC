'use strict';
const groups = [require('./copilot-learning'), require('./copilot-epics'), require('./copilot-runtime-commands'),
  require('./copilot-orchestration'), require('./copilot-policy-commands')];
const COMMANDS = Object.freeze(groups.flatMap(group => group.COMMANDS || group.LEARNING_COMMANDS));
const RUNTIME_PATHS = Object.freeze([...new Set([...groups.flatMap(group => group.RUNTIME_PATHS),
  'scripts/copilot-memory.js', 'scripts/lib/copilot-memory.js',
  'scripts/copilot-memory-mcp.js',
  'scripts/copilot-mcp.js', 'scripts/lib/copilot-mcp.js',
  'scripts/lib/copilot-mcp-http.js',
  'mcp-configs/mcp-servers.json',
  'scripts/copilot-telemetry.js', 'scripts/lib/copilot-telemetry.js',
  'scripts/lib/skill-evolution/tracker.js',
  'scripts/copilot-observer.js', 'scripts/lib/copilot-observer.js',
  'scripts/lib/copilot-observer-analysis.js', 'scripts/lib/copilot-observations.js',
])]);
function getNativeBody(name) {
  for (const group of groups) { const body = group.getNativeBody(name); if (body) return body; }
  return null;
}
module.exports = { COMMANDS, RUNTIME_PATHS, getNativeBody };
