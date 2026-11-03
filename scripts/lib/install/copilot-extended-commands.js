'use strict';
const groups = [require('./copilot-learning'), require('./copilot-epics'), require('./copilot-runtime-commands'),
  require('./copilot-orchestration'), require('./copilot-policy-commands')];
const COMMANDS = Object.freeze(groups.flatMap(group => group.COMMANDS || group.LEARNING_COMMANDS));
const RUNTIME_PATHS = Object.freeze([...new Set(groups.flatMap(group => group.RUNTIME_PATHS))]);
function getNativeBody(name) {
  for (const group of groups) { const body = group.getNativeBody(name); if (body) return body; }
  return null;
}
module.exports = { COMMANDS, RUNTIME_PATHS, getNativeBody };
