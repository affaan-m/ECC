'use strict';

const path = require('path');
const { shellQuote } = require('./control-pane/actions');

/**
 * Antigravity Hooks Generator
 *
 * Generates valid Antigravity hooks.json configuration matching Antigravity's
 * lifecycle schema (PreToolUse, PostToolUse, Stop) and pointing to the ECC
 * hook bridge.
 */

function buildAntigravityHooksConfig(options = {}) {
  const profile = options.profile || 'standard';
  const { bridgeScript } = options;
  if (typeof bridgeScript !== 'string' || !path.isAbsolute(bridgeScript) || bridgeScript.includes('\0')) {
    throw new Error('bridgeScript must be an absolute path');
  }
  let quotedBridgeScript;
  if (process.platform === 'win32') {
    if (/[%"!$`\r\n]/.test(bridgeScript)) {
      throw new Error('bridgeScript contains unsafe shell expansion characters');
    }
    quotedBridgeScript = `"${bridgeScript}"`;
  } else {
    quotedBridgeScript = shellQuote(bridgeScript);
  }

  const preToolUseHandlers = [
    {
      matcher: 'run_command',
      hooks: [
        {
          type: 'command',
          command: `node ${quotedBridgeScript} --mode pre-tool-use --hook pre:bash:dispatcher`,
          timeout: 15,
        },
      ],
    },
    {
      matcher: 'write_to_file|replace_file_content|multi_replace_file_content',
      hooks: [
        {
          type: 'command',
          command: `node ${quotedBridgeScript} --mode pre-tool-use --hook pre:edit-write:gateguard-fact-force`,
          timeout: 10,
        },
        {
          type: 'command',
          command: `node ${quotedBridgeScript} --mode pre-tool-use --hook pre:config-protection`,
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
          command: `node ${quotedBridgeScript} --mode pre-tool-use --hook pre:write:doc-file-warning`,
          timeout: 5,
        },
      ],
    });
  }

  const stopHandlers = [
    {
      type: 'command',
      command: `node ${quotedBridgeScript} --mode stop --hook stop:format-typecheck`,
      timeout: 300,
    },
    {
      type: 'command',
      command: `node ${quotedBridgeScript} --mode stop --hook stop:check-console-log`,
      timeout: 30,
    },
  ];

  return {
    'ecc-guard': {
      PreToolUse: preToolUseHandlers,
      PostToolUse: [{
        matcher: 'write_to_file|replace_file_content|multi_replace_file_content',
        hooks: [{
          type: 'command',
          command: `node ${quotedBridgeScript} --mode post-tool-use --hook post:edit:accumulator`,
          timeout: 10,
        }],
      }],
      Stop: stopHandlers,
    },
  };
}

module.exports = {
  buildAntigravityHooksConfig,
};
