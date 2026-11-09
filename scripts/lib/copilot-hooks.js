'use strict';

// Explicitly audited projections of canonical ECC policies. Do not infer a
// command from Claude's bootstrap shell strings or from a hook payload.
const COPILOT_HOOKS = Object.freeze([
  { id: 'pre:bash:block-no-verify', event: 'preToolUse', tools: ['Bash'], script: 'block-no-verify.js' },
  { id: 'pre:copilot:guard', event: 'preToolUse', tools: ['Bash', 'PowerShell', 'Edit', 'Write'], script: 'copilot-guard.js' },
  { id: 'pre:config-protection', event: 'preToolUse', tools: ['Edit', 'Write'], script: 'config-protection.js' },
  { id: 'pre:write:doc-file-warning', event: 'preToolUse', tools: ['Write'], script: 'doc-file-warning.js' },
  { id: 'post:edit:console-warn', event: 'postToolUse', tools: ['Edit', 'Write'], script: 'post-edit-console-warn.js' },
].map(hook => Object.freeze({ ...hook, tools: Object.freeze(hook.tools), timeoutMs: 5000 })));

const COPILOT_SESSION_EVENTS = Object.freeze(['sessionStart', 'agentStop', 'preCompact', 'sessionEnd']);
const COPILOT_SESSION_RUNTIME_PATHS = Object.freeze([
  'scripts/hooks/copilot-lifecycle.js',
  'scripts/lib/copilot-sessions.js',
  'scripts/lib/memory-vault-format.js',
  'scripts/lib/hook-flags.js',
  'scripts/lib/copilot-accessories.js',
]);

const COPILOT_HOOKIFY_RUNTIME_PATHS = Object.freeze([
  'scripts/copilot-hookify.js', 'scripts/lib/copilot-native-events.js', 'scripts/lib/copilot-runtime-tools.js',
  'scripts/lib/copilot-event-envelope.js', 'scripts/lib/copilot-sessions.js',
  'scripts/lib/memory-vault-format.js', 'scripts/lib/hook-flags.js',
  'scripts/hooks/hookify-runtime.js', 'scripts/hooks/hookify-frontmatter.js',
  'scripts/hooks/hook-input.js', 'scripts/hooks/hook-input-limits.js',
]);
const COPILOT_HOOK_RUNTIME_PATHS = Object.freeze([...new Set([
  'scripts/hooks/copilot-hook-adapter.js',
  'scripts/lib/copilot-event-envelope.js',
  'scripts/hooks/copilot-quality.js',
  'scripts/lib/copilot-quality.js',
  'scripts/hooks/copilot-canvas.js',
  'scripts/lib/copilot-canvas.js',
  'scripts/lib/plan-canvas/sessions.js',
  'scripts/lib/resolve-formatter.js',
  'scripts/lib/package-manager.js',
  'scripts/hooks/design-quality-check.js',
  'scripts/hooks/copilot-observe.js',
  'scripts/hooks/copilot-evidence.js',
  'scripts/lib/copilot-evidence.js',
  'scripts/hooks/copilot-accessories.js',
  'scripts/lib/copilot-observations.js',
  'scripts/lib/copilot-telemetry.js',
  'scripts/lib/copilot-native-skill-telemetry.js',
  'scripts/hooks/copilot-native-telemetry.js',
  'scripts/copilot-telemetry.js',
  'scripts/lib/skill-evolution/tracker.js',
  'scripts/hooks/gateguard-fact-force.js',
  'scripts/hooks/gateguard-heredoc.js',
  'scripts/lib/shell-substitution.js',
  'scripts/lib/powershell-destructive-command.js',
  'scripts/lib/gateguard-state.js',
  'scripts/lib/gateguard-target-class.js',
  'scripts/lib/copilot-shell-preflight.js',
  'scripts/hooks/pre-bash-commit-quality.js',
  'scripts/hooks/pre-bash-git-push-reminder.js',
  ...COPILOT_HOOKS.map(hook => `scripts/hooks/${hook.script}`),
  'scripts/hooks/lib/shell-scan.js',
  'scripts/hooks/pretooluse-visible-output.js',
  'scripts/lib/copilot-hooks.js',
  'scripts/lib/hook-flags.js',
  'scripts/lib/utils.js',
  'scripts/lib/agent-data-home.js',
  'scripts/lib/path-safety.js',
  ...COPILOT_SESSION_RUNTIME_PATHS,
  ...COPILOT_HOOKIFY_RUNTIME_PATHS,
])]);

module.exports = { COPILOT_HOOKS, COPILOT_HOOK_RUNTIME_PATHS, COPILOT_SESSION_EVENTS, COPILOT_SESSION_RUNTIME_PATHS, COPILOT_HOOKIFY_RUNTIME_PATHS };
