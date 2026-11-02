'use strict';

const { COPILOT_HOOKS } = require('../copilot-hooks');

function adaptCopilotHooks(content) {
  // The canonical manifest remains the source inventory. Execution uses an
  // audited allowlist rather than evaluating its Claude bootstrap commands.
  const canonical = JSON.parse(content);
  if (!canonical?.hooks || typeof canonical.hooks !== 'object') {
    throw new Error('Invalid canonical ECC hooks manifest');
  }
  const hooks = Object.fromEntries(['preToolUse', 'postToolUse'].map(event => [event,
    COPILOT_HOOKS.filter(hook => hook.event === event).map(hook => ({
      type: 'command', exec: 'node',
      args: ['.github/ecc/scripts/hooks/copilot-hook-adapter.js', event, hook.id],
      timeoutSec: 15,
    })),
  ]));
  return `${JSON.stringify({ version: 1, hooks }, null, 2)}\n`;
}

module.exports = { adaptCopilotHooks };
