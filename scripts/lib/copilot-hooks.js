'use strict';

// Explicitly audited projections of canonical ECC policies. Do not infer a
// command from Claude's bootstrap shell strings or from a hook payload.
const COPILOT_HOOKS = Object.freeze([
  { id: 'pre:bash:block-no-verify', event: 'preToolUse', tools: ['Bash'], script: 'block-no-verify.js' },
  { id: 'pre:config-protection', event: 'preToolUse', tools: ['Edit', 'Write'], script: 'config-protection.js' },
  { id: 'pre:write:doc-file-warning', event: 'preToolUse', tools: ['Write'], script: 'doc-file-warning.js' },
  { id: 'post:edit:console-warn', event: 'postToolUse', tools: ['Edit', 'Write'], script: 'post-edit-console-warn.js' },
].map(hook => Object.freeze({ ...hook, tools: Object.freeze(hook.tools), timeoutMs: 5000 })));

const COPILOT_HOOK_RUNTIME_PATHS = Object.freeze([
  'scripts/hooks/copilot-hook-adapter.js',
  ...COPILOT_HOOKS.map(hook => `scripts/hooks/${hook.script}`),
  'scripts/hooks/lib/shell-scan.js',
  'scripts/hooks/pretooluse-visible-output.js',
  'scripts/lib/copilot-hooks.js',
  'scripts/lib/hook-flags.js',
  'scripts/lib/utils.js',
  'scripts/lib/agent-data-home.js',
  'scripts/lib/path-safety.js',
]);

module.exports = { COPILOT_HOOKS, COPILOT_HOOK_RUNTIME_PATHS };
