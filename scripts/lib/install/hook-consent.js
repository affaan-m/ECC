'use strict';

/**
 * Explicit consent gate for materializing the automatic hook runtime.
 *
 * The capability disclosure and held-materialization semantics were
 * contributed in PR #2634 by Samarjeet Singh Tomar (@samartomar); this
 * module integrates them with the single-decision consent model used by
 * the guided installer.
 */

const HOOK_CAPABILITY_GROUPS = Object.freeze([
  Object.freeze({
    id: 'automatic-source-writes',
    description: 'Automatically format or otherwise modify project source files.',
  }),
  Object.freeze({
    id: 'command-rewrite-and-process-control',
    description: 'Rewrite requested commands and start, replace, or terminate processes.',
  }),
  Object.freeze({
    id: 'transcript-derived-llm-egress',
    description: 'Send transcript-derived conversation text to an external LLM.',
  }),
  Object.freeze({
    id: 'mcp-network-and-process-activity',
    description: 'Probe MCP endpoints and launch, reconnect, or terminate MCP processes.',
  }),
  Object.freeze({
    id: 'automatic-permission-gates',
    description: 'Automatically deny or alter Edit, Write, Bash, and configuration operations.',
  }),
  Object.freeze({
    id: 'session-observation-and-cost-records',
    description: 'Persist session, observation, governance, notification, and cost records.',
  }),
]);

const HOOK_CONSENT_DECISIONS = Object.freeze(['enabled', 'declined']);
const HOOK_RUNTIME_MODULE_ID = 'hooks-runtime';

function normalizeOperationPath(value) {
  return String(value || '').replace(/\\/g, '/').toLowerCase();
}

function isHookRuntimeOperation(operation = {}) {
  if (operation.moduleId === HOOK_RUNTIME_MODULE_ID) {
    return true;
  }

  const source = normalizeOperationPath(operation.sourceRelativePath);
  const destination = normalizeOperationPath(operation.destinationPath);
  return (
    source === 'hooks'
    || source.startsWith('hooks/')
    || source === '.cursor/hooks'
    || source.startsWith('.cursor/hooks/')
    || source === '.cursor/hooks.json'
    || destination.endsWith('/hooks/hooks.json')
    || destination.endsWith('/.cursor/hooks.json')
    || destination.includes('/.cursor/hooks/')
  );
}

function planMaterializesHookRuntime(plan = {}) {
  const operations = Array.isArray(plan.operations) ? plan.operations : [];
  return operations.some(isHookRuntimeOperation);
}

function formatHookCapabilityDisclosure(indent = '  ') {
  return HOOK_CAPABILITY_GROUPS
    .map((group, index) => `${indent}${index + 1}. ${group.description}`)
    .join('\n');
}

function resolveHookConsentFlags({ enableHooks = false, noHooks = false } = {}) {
  if (enableHooks && noHooks) {
    throw new Error('--enable-hooks and --no-hooks are mutually exclusive');
  }
  if (enableHooks) {
    return 'enabled';
  }
  if (noHooks) {
    return 'declined';
  }
  return null;
}

function withoutHookRuntimeId(values) {
  return (Array.isArray(values) ? values : []).filter(value => value !== HOOK_RUNTIME_MODULE_ID);
}

function setStatePreviewHookConsent(statePreview, hookConsent) {
  if (!statePreview || !statePreview.request) {
    return statePreview;
  }

  return {
    ...statePreview,
    request: {
      ...statePreview.request,
      hookConsent,
    },
  };
}

function getRecordedHookConsent(state = {}) {
  const explicitDecision = state.request && HOOK_CONSENT_DECISIONS.includes(state.request.hookConsent)
    ? state.request.hookConsent
    : null;
  if (explicitDecision) {
    return explicitDecision;
  }

  if (Array.isArray(state.request && state.request.modules) && state.request.modules.includes(HOOK_RUNTIME_MODULE_ID)) {
    return 'enabled';
  }

  if (Array.isArray(state.resolution && state.resolution.selectedModules) && state.resolution.selectedModules.includes(HOOK_RUNTIME_MODULE_ID)) {
    return 'enabled';
  }

  if (planMaterializesHookRuntime(state)) {
    return 'enabled';
  }

  return null;
}

function stripHookRuntimeFromPlan(plan) {
  const hadHookRuntimeModule = Array.isArray(plan.selectedModuleIds)
    && plan.selectedModuleIds.includes('hooks-runtime');
  const operations = (Array.isArray(plan.operations) ? plan.operations : [])
    .filter(operation => !isHookRuntimeOperation(operation));
  const statePreview = plan.statePreview
    ? {
      ...plan.statePreview,
      operations: (Array.isArray(plan.statePreview.operations) ? plan.statePreview.operations : [])
        .filter(operation => !isHookRuntimeOperation(operation)),
      resolution: plan.statePreview.resolution
        ? {
          ...plan.statePreview.resolution,
          selectedModules: withoutHookRuntimeId(plan.statePreview.resolution.selectedModules),
        }
        : plan.statePreview.resolution,
    }
    : plan.statePreview;

  return {
    ...plan,
    operations,
    statePreview: setStatePreviewHookConsent(statePreview, 'declined'),
    selectedModuleIds: withoutHookRuntimeId(plan.selectedModuleIds),
    excludedModuleIds: hadHookRuntimeModule && Array.isArray(plan.excludedModuleIds)
      ? [...new Set([...plan.excludedModuleIds, HOOK_RUNTIME_MODULE_ID])]
      : plan.excludedModuleIds,
  };
}

function withHookConsent(plan, hookConsent = null) {
  if (hookConsent !== null && !HOOK_CONSENT_DECISIONS.includes(hookConsent)) {
    throw new Error(`Unknown hook consent decision: ${hookConsent}`);
  }
  if (hookConsent === 'declined') {
    return { ...stripHookRuntimeFromPlan(plan), hookConsent };
  }
  return {
    ...plan,
    hookConsent,
    statePreview: setStatePreviewHookConsent(plan.statePreview, hookConsent),
  };
}

function assertHookConsentReady(plan = {}) {
  if (!planMaterializesHookRuntime(plan)) {
    return;
  }
  if (plan.hookConsent === 'enabled') {
    return;
  }
  throw new Error(
    'This install would enable ECC\'s automatic hook runtime, which can:\n'
      + `${formatHookCapabilityDisclosure()}\n`
      + 'Confirm with --enable-hooks to install it, or --no-hooks to install '
      + 'everything else without the hook runtime. The guided installer '
      + '(ecc install --guided) collects this choice interactively.'
  );
}

module.exports = {
  HOOK_CAPABILITY_GROUPS,
  assertHookConsentReady,
  formatHookCapabilityDisclosure,
  getRecordedHookConsent,
  isHookRuntimeOperation,
  planMaterializesHookRuntime,
  resolveHookConsentFlags,
  withHookConsent,
};
