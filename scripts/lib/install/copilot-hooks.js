'use strict';

const { COPILOT_HOOKS, COPILOT_SESSION_EVENTS } = require('../copilot-hooks');

function adaptCopilotHooks(content) {
  // The canonical manifest remains the source inventory. Execution uses an
  // audited allowlist rather than evaluating its Claude bootstrap commands.
  const canonical = JSON.parse(content);
  if (!canonical?.hooks || typeof canonical.hooks !== 'object') {
    throw new Error('Invalid canonical ECC hooks manifest');
  }
  const hooks = Object.fromEntries(['preToolUse', 'postToolUse'].map(event => [event,
    COPILOT_HOOKS.filter(hook => hook.event === event
      && !['post:edit:console-warn', 'pre:bash:block-no-verify'].includes(hook.id)).map(hook => ({
      type: 'command', exec: 'node',
      args: ['.github/ecc/scripts/hooks/copilot-hook-adapter.js', event, hook.id],
      timeoutSec: 15,
    })),
  ]));
  const lifecycle = Object.fromEntries(COPILOT_SESSION_EVENTS.map(event => [event, [{
    type: 'command', exec: 'node',
    args: ['.github/ecc/scripts/hooks/copilot-lifecycle.js', event], timeoutSec: 15,
  }]]));
  const combined = { ...hooks, ...lifecycle };
  for (const event of ['sessionStart', 'agentStop']) {
    combined[event] = [...combined[event], { type: 'command', exec: 'node',
      args: ['.github/ecc/scripts/hooks/copilot-canvas.js', event], timeoutSec: 5 }];
  }
  for (const event of ['agentStop', 'sessionEnd']) {
    combined[event] = [...combined[event], { type: 'command', exec: 'node',
      args: ['.github/ecc/scripts/hooks/copilot-native-telemetry.js', event], timeoutSec: 15 }];
  }
  for (const event of ['preToolUse', 'postToolUse', 'postToolUseFailure', 'sessionStart', 'userPromptSubmitted', 'agentStop', 'preCompact', 'sessionEnd']) {
    combined[event] = [...(combined[event] || []), { type: 'command', exec: 'node',
      args: ['.github/ecc/scripts/hooks/copilot-evidence.js', event], timeoutSec: 15 }];
  }
  for (const event of ['postToolUse', 'agentStop']) {
    combined[event] = [...(combined[event] || []), { type: 'command', exec: 'node',
      args: ['.github/ecc/scripts/hooks/copilot-quality.js', event], timeoutSec: 15 }];
  }
  for (const event of ['preToolUse', 'postToolUse', 'postToolUseFailure']) {
    combined[event] = [...(combined[event] || []), { type: 'command', exec: 'node',
      args: ['.github/ecc/scripts/hooks/copilot-observe.js', event], timeoutSec: 15 }];
  }
  for (const event of ['preToolUse', 'postToolUse', 'agentStop', 'userPromptTransformed']) {
    combined[event] = [...(combined[event] || []), { type: 'command', exec: 'node',
      args: ['.github/ecc/scripts/copilot-hookify.js', 'hook', event], timeoutSec: 15 }];
  }
  return `${JSON.stringify({ version: 1, hooks: combined }, null, 2)}\n`;
}

module.exports = { adaptCopilotHooks };
