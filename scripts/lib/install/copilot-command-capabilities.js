'use strict';

// Only collisions verified in GitHub's CLI command reference are renamed.
// https://docs.github.com/en/copilot/reference/copilot-cli-reference/cli-command-reference
const BUILTIN_COMMAND_ALIASES = Object.freeze({ plan: 'ecc-plan', pr: 'ecc-pr', sessions: 'ecc-sessions' });
const PATH_ADAPTED_COMMANDS = Object.freeze([
  'checkpoint', 'learn', 'learn-eval', 'plan', 'plan-prd', 'pr', 'prp-implement',
  'prp-plan', 'prp-pr', 'prp-prd', 'skill-create',
]);
// Instruction workflows audited separately from runtime-bearing command shims.
const PORTABLE_COMMANDS = Object.freeze([
  'aside', 'build-fix', 'cpp-build', 'cpp-review', 'cpp-test', 'fastapi-review',
  'feature-dev', 'flutter-build', 'flutter-review', 'flutter-test', 'go-build',
  'go-review', 'go-test', 'gradle-build', 'kotlin-build', 'kotlin-review',
  'kotlin-test', 'python-review', 'react-build', 'react-review', 'react-test',
  'refactor-clean', 'review-pr', 'rust-build', 'rust-review', 'rust-test',
  'test-coverage', 'update-codemaps', 'vue-review', 'update-docs', 'prp-commit',
  'jira', ...PATH_ADAPTED_COMMANDS,
]);
const NATIVE_COMMANDS = Object.freeze(['code-review', 'setup-pm', 'model-route', 'sessions', 'save-session', 'resume-session']);
function copilotCommandName(name) {
  return Object.hasOwn(BUILTIN_COMMAND_ALIASES, name) ? BUILTIN_COMMAND_ALIASES[name] : name;
}

function rewriteCommandReferences(content) {
  return String(content).replace(/(^|[\s`"'(])\/(plan|pr|sessions)(?![a-z0-9_-])/g,
    (_match, prefix, name) => `${prefix}/${copilotCommandName(name)}`);
}

function getCommandCapability(name) {
  if (require('./copilot-extended-commands').COMMANDS.includes(name)) return { status: 'copilot-native', reason: 'Implemented managed Copilot workflow; declared external tools, reviewed runtime and account permissions remain prerequisites.' };
  if (NATIVE_COMMANDS.includes(name)) return { status: 'copilot-native', reason: 'Adapted to the managed Copilot project runtime or native session model selection.' };
  if (PORTABLE_COMMANDS.includes(name)) return { status: 'portable', reason: PATH_ADAPTED_COMMANDS.includes(name)
    ? 'Audited instruction workflow with Copilot artifact/skill paths; existing approval, verification, and external-tool prerequisites remain in force.'
    : 'Audited instruction workflow; project tools and optional agents/integrations must be available.' };
  return { status: 'blocked', reason: 'This new command has not been audited for Copilot dependencies; its runtime and permission contract must be reviewed before execution.' };
}

module.exports = { PORTABLE_COMMANDS, NATIVE_COMMANDS, PATH_ADAPTED_COMMANDS, copilotCommandName, rewriteCommandReferences, getCommandCapability };
