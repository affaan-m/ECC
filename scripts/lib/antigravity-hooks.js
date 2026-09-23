'use strict';

/**
 * Antigravity Hooks Generator
 *
 * Generates valid Antigravity hooks.json configuration matching Antigravity's
 * lifecycle schema (PreToolUse, PostToolUse, Stop) and pointing to the ECC
 * hook bridge.
 */

function buildAntigravityHooksConfig(options = {}) {
  const profile = options.profile || 'standard';
  const bridgeScript = options.bridgeScript || 'scripts/hooks/antigravity-hook-bridge.js';

  const preToolUseHandlers = [
    {
      matcher: 'run_command',
      hooks: [
        {
          type: 'command',
          command: `node ${bridgeScript} --mode pre-tool-use --hook pre:bash:dispatcher`,
          timeout: 15,
        },
      ],
    },
    {
      matcher: 'write_to_file|replace_file_content',
      hooks: [
        {
          type: 'command',
          command: `node ${bridgeScript} --mode pre-tool-use --hook pre:edit-write:gateguard-fact-force`,
          timeout: 10,
        },
        {
          type: 'command',
          command: `node ${bridgeScript} --mode pre-tool-use --hook pre:config-protection`,
          timeout: 5,
        },
      ],
    },
  ];

  if (profile === 'standard' || profile === 'strict') {
    preToolUseHandlers.push({
      matcher: 'write_to_file',
      hooks: [
        {
          type: 'command',
          command: `node ${bridgeScript} --mode pre-tool-use --hook pre:write:doc-file-warning`,
          timeout: 5,
        },
      ],
    });
  }

  const stopHandlers = [
    {
      type: 'command',
      command: `node ${bridgeScript} --mode stop --hook stop:format-typecheck`,
      timeout: 120,
    },
    {
      type: 'command',
      command: `node ${bridgeScript} --mode stop --hook stop:check-console-log`,
      timeout: 30,
    },
  ];

  return {
    'ecc-guard': {
      PreToolUse: preToolUseHandlers,
      Stop: stopHandlers,
    },
  };
}

module.exports = {
  buildAntigravityHooksConfig,
};
