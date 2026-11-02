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
const BLOCKED_REASONS = Object.freeze({
  'astra-review': 'The astra-review.js executable and its independent reviewer library are not in the managed Copilot closure; an authenticated Codex CLI and selected reviewer model are also required.',
  'auto-update': 'auto-update.js requires the complete ECC checkout, Git upstream, install manifests, and recorded reinstall request; the managed Copilot helper closure is not a self-updating ECC checkout.',
  'cost-report': 'The Claude cost-tracker hook and its costs.jsonl cumulative token/cost schema are not produced by the Copilot lifecycle adapter; no Copilot cost ingestion is implemented.',
  'epic-claim': 'Claiming an epic requires github-coordination.js, authenticated GitHub issue mutations, and its SQLite ownership cache; this coordination runtime is not installed.',
  'epic-decompose': 'Epic decomposition requires github-coordination.js to reconcile issue task checklists and persist coordination blocks; that runtime and cache are not installed.',
  'epic-publish': 'Publishing validated epic state requires github-coordination.js, its policy validator, GitHub mutation support, and SQLite cache; these are outside this Copilot runtime closure.',
  'epic-review': 'Review-state labels and audit comments require github-coordination.js and its coordination cache; this is different from a plain code review and is not installed.',
  'epic-sync': 'Epic synchronization requires github-coordination.js and its GitHub-to-SQLite coordination snapshot implementation; neither is installed in the Copilot closure.',
  'epic-unblock': 'Dependency-driven epic reopening requires github-coordination.js and its label/comment/cache reconciliation; no equivalent is wired into Copilot.',
  'epic-validate': 'Epic readiness validation requires github-coordination.js and the coordination-block policy/cache; running ordinary lint or tests would not preserve these semantics.',
  evolve: 'Instinct evolution requires continuous-learning-v2 instinct-cli.py and its scoped homunculus stores; Copilot checkpoints are not compatible instinct observations.',
  'gan-build': 'The GAN loop depends on the Claude Task-tool launch/wait protocol plus isolated generator/evaluator agents and browser-evaluation capabilities; this orchestration protocol has not been adapted.',
  'gan-design': 'The design evaluator loop builds on the unported gan-build orchestration and its screenshot/browser rubric; a plain design prompt would not execute that evaluation contract.',
  'harness-audit': 'harness-audit.js and its deterministic category scorers/configuration dependencies are not in the managed Copilot runtime closure.',
  hookify: 'The dynamic Hookify rule loader is not wired into Copilot events; creating a rule file would not make the existing static Copilot policy adapter enforce it.',
  'hookify-configure': 'Copilot does not load Hookify local rule files; toggling their enabled fields would not change the managed Copilot hook policies.',
  'hookify-help': 'The legacy Hookify event/rule format describes a runtime not wired to Copilot. The static Copilot hook adapter has a separate documented policy allowlist.',
  'hookify-list': 'The Copilot adapter has no Hookify rule store or loader; listing another harness\'s local rule files would misrepresent active Copilot policies.',
  'instinct-export': 'Export requires the continuous-learning-v2 scoped instinct backend and merge rules; the Copilot checkpoint store contains summaries, not instinct records.',
  'instinct-import': 'Import requires continuous-learning-v2 instinct-cli.py with scoped inherited-instinct storage and conflict handling; no Copilot instinct importer is implemented.',
  'instinct-status': 'Status requires continuous-learning-v2 instinct-cli.py and its project/global confidence and observation records; Copilot lifecycle metadata does not provide them.',
  'loop-start': 'Managed loop launch requires the complete continuous-agent-loop runtime, launch/monitor commands, and loop-specific stop/quality hooks. The audited Copilot hook subset does not provide those guarantees.',
  'loop-status': 'The loop-status scanner reads Claude transcript ScheduleWakeup/Bash events; Copilot event transcripts do not implement that schema and no monitor conversion is installed.',
  'multi-backend': 'Backend multi-model orchestration requires the external ccg-workflow codeagent-wrapper, Codex role files, and Claude background-task waiting protocol; these are not installed or adapted.',
  'multi-execute': 'Resuming multi-model execution requires the external ccg-workflow wrapper/session protocol and Codex/Antigravity role files; no Copilot driver is implemented.',
  'multi-frontend': 'Frontend multi-model orchestration requires the external ccg-workflow Antigravity wrapper/role files and background-task waiting protocol; these are not installed or adapted.',
  'multi-plan': 'Dual-model planning requires the external ccg-workflow wrapper, Codex/Antigravity role files, and session/wait protocol; an inline plan would not be equivalent.',
  'multi-workflow': 'The complete research-to-review pipeline requires the external ccg-workflow runtime, two model backends, role files, and background-session coordination; these are not installed or adapted.',
  'orch-review': 'The Workflow tool and workflows/orch-review.workflow.js fan-out/adversarial verifier are not installed or adapted. Falling back to an inline review would violate the command\'s fail-closed contract.',
  pm2: 'The PM2 generator emits Claude command files and scripts and may provision PM2; its output generator has not been adapted to Copilot skills and managed script ownership.',
  'project-init': 'Onboarding requires the complete ECC checkout with install-plan.js, install-apply.js, manifests, and stack mappings; the installed project helper closure does not ship those planning tools.',
  projects: 'Project statistics require continuous-learning-v2 instinct-cli.py and its project registry/observation stores; this is different from listing Copilot checkpoint sessions.',
  promote: 'Promotion requires continuous-learning-v2 scoped instinct confidence records and its project-to-global promotion policy; Copilot checkpoint text cannot be promoted as instincts.',
  prune: 'Pruning requires continuous-learning-v2 pending-instinct storage and age/promotion metadata; no equivalent data exists in the Copilot checkpoint store.',
  'quality-gate': 'The canonical single-file formatter hook quality-gate.js and formatter-resolution dependencies are outside the audited Copilot closure; general verification is not an equivalent formatter gate.',
  'santa-loop': 'Dual independent review requires the external reviewer CLI adapters, isolated Claude Task fallback, and model-diversity verdict protocol; no equivalent Copilot reviewer driver is installed.',
  'skill-health': 'The skills-health.js dashboard and its instrumentation/failure snapshot backend are not installed, and Copilot skill-use events are not fed into that health store.',
});

function copilotCommandName(name) {
  return Object.hasOwn(BUILTIN_COMMAND_ALIASES, name) ? BUILTIN_COMMAND_ALIASES[name] : name;
}

function rewriteCommandReferences(content) {
  return String(content).replace(/(^|[\s`"'(])\/(plan|pr|sessions)(?![a-z0-9_-])/g,
    (_match, prefix, name) => `${prefix}/${copilotCommandName(name)}`);
}

function getCommandCapability(name) {
  if (NATIVE_COMMANDS.includes(name)) return { status: 'copilot-native', reason: 'Adapted to the managed Copilot project runtime or native session model selection.' };
  if (PORTABLE_COMMANDS.includes(name)) return { status: 'portable', reason: PATH_ADAPTED_COMMANDS.includes(name)
    ? 'Audited instruction workflow with Copilot artifact/skill paths; existing approval, verification, and external-tool prerequisites remain in force.'
    : 'Audited instruction workflow; project tools and optional agents/integrations must be available.' };
  return { status: 'blocked', reason: Object.hasOwn(BLOCKED_REASONS, name) ? BLOCKED_REASONS[name]
    : 'This new command has not been audited for Copilot dependencies; its runtime and permission contract must be reviewed before execution.' };
}

module.exports = { PORTABLE_COMMANDS, NATIVE_COMMANDS, PATH_ADAPTED_COMMANDS, BLOCKED_REASONS, copilotCommandName, rewriteCommandReferences, getCommandCapability };
