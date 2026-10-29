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
const OPENCODE_DISABLE_ECC_HOOKS_TRANSFORM = 'opencode-disable-ecc-hooks';
const OPENCODE_DISABLE_PLUGIN_TRANSFORM = 'opencode-disable-plugin-entrypoint';

function normalizeOperationPath(value) {
  return String(value || '').replace(/\\/g, '/').toLowerCase();
}

/**
 * Parse an OpenCode config the way OpenCode itself does: comments and the
 * trailing commas they hide are legal (JSONC). The installer only ever
 * reads these files (the ownership guard never writes user-owned configs),
 * so a tolerant read prevents a membership check from crashing the install
 * on a config OpenCode accepts.
 */
function parseJsoncConfig(content, sourceRelativePath) {
  let config;
  try {
    config = JSON.parse(stripJsonc(content));
  } catch (error) {
    throw new Error(`Failed to parse ${sourceRelativePath}: ${error.message}`);
  }
  if (!config || typeof config !== 'object' || Array.isArray(config)) {
    throw new Error(`Invalid ${sourceRelativePath}: expected a JSON object`);
  }
  return config;
}

function isLineBreak(ch) {
  return ch === '\n' || ch === '\r';
}

/**
 * Advance past whitespace and // or /* *\/ comments; returns the index of
 * the next significant character.
 */
function skipJsoncTrivia(input, start) {
  let j = start;
  for (;;) {
    while (j < input.length && /\s/.test(input[j])) j += 1;
    if (input[j] === '/' && input[j + 1] === '/') {
      while (j < input.length && !isLineBreak(input[j])) j += 1;
      continue;
    }
    if (input[j] === '/' && input[j + 1] === '*') {
      j += 2;
      while (j < input.length && !(input[j] === '*' && input[j + 1] === '/')) j += 1;
      if (j >= input.length) throw new Error('Unterminated block comment');
      j += 2;
      continue;
    }
    return j;
  }
}

function isJsoncTrailingComma(input, index, previousSignificant) {
  const next = skipJsoncTrivia(input, index + 1);
  // Preserve commas in empty containers or after another separator so
  // JSON.parse rejects them; it validates the remaining value syntax.
  return (input[next] === '}' || input[next] === ']')
    && previousSignificant !== null && !'[{,:'.includes(previousSignificant);
}

/**
 * Strip // and /* *\/ comments and the trailing commas they hide, without
 * touching string contents (URLs like "https://..." must survive intact).
 */
function stripJsonc(input) {
  let out = '';
  let inString = false;
  let escaped = false;
  let previousSignificant = null;
  for (let i = 0; i < input.length; i += 1) {
    const ch = input[i];
    if (inString) {
      out += ch;
      if (escaped) escaped = false;
      else if (ch === '\\') escaped = true;
      else if (ch === '"') inString = false;
      continue;
    }
    if (ch === '"') {
      inString = true;
      out += ch;
      previousSignificant = '"';
      continue;
    }
    if (ch === '/' && input[i + 1] === '/') {
      while (i < input.length && !isLineBreak(input[i])) i += 1;
      out += '\n';
      continue;
    }
    if (ch === '/' && input[i + 1] === '*') {
      i += 2;
      while (i < input.length && !(input[i] === '*' && input[i + 1] === '/')) i += 1;
      if (i >= input.length) throw new Error('Unterminated block comment');
      i += 1; // consume the closing '/'
      out += ' ';
      continue;
    }
    if (ch === ',') {
      if (isJsoncTrailingComma(input, i, previousSignificant)) continue;
    }
    out += ch;
    if (!/\s/.test(ch)) previousSignificant = ch;
  }
  return out;
}

function disableOpenCodeHookPluginRegistration(content, sourceRelativePath) {
  const config = parseJsoncConfig(content, sourceRelativePath);
  if (config.plugin !== undefined && !Array.isArray(config.plugin)) {
    throw new Error(`Invalid ${sourceRelativePath}: plugin must be an array`);
  }

  if (!Array.isArray(config.plugin)) {
    return `${JSON.stringify(config, null, 2)}\n`;
  }

  return `${JSON.stringify({
    ...config,
    plugin: config.plugin.filter(plugin => plugin !== './plugins'),
  }, null, 2)}\n`;
}

function getOpenCodeActivationPathKind(value) {
  const relative = normalizeOperationPath(value);
  if (relative === 'opencode.json') return 'config';
  if (/^plugins\/[^/]+\/package\.json$/.test(relative)) return 'package';
  if (/^plugins\/(?:[^/]+\.(?:[cm]?js|ts)|[^/]+\/index\.(?:[cm]?js|ts))$/.test(relative)) return 'plugin';
  return null;
}

function getOpenCodeSourceActivationKind(operation = {}) {
  const source = normalizeOperationPath(operation.sourceRelativePath);
  if (!source.startsWith('.opencode/')) return null;
  return getOpenCodeActivationPathKind(source.replace(/^\.opencode\/(?:dist\/)?/, ''));
}

function isOpenCodePluginEntrypoint(operation = {}) {
  return getOpenCodeSourceActivationKind(operation) === 'plugin';
}

function getDisabledOpenCodePluginContent() {
  // OpenCode discovers plugins independently of opencode.json registration.
  // Do not import the original module: even module initialization has effects.
  return 'export default async () => ({});\n';
}

function isOpenCodeHookActivationOperation(operation = {}) {
  return getOpenCodeSourceActivationKind(operation) !== null;
}

function isHookRuntimeOperation(operation = {}) {
  if (
    operation.kind === 'update-claude-settings'
    || operation.moduleId === HOOK_RUNTIME_MODULE_ID
  ) {
    return true;
  }

  if (isOpenCodeHookActivationOperation(operation)) {
    return !(
      operation.kind === 'copy-file'
      && operation.contentTransform === (isOpenCodePluginEntrypoint(operation)
        ? OPENCODE_DISABLE_PLUGIN_TRANSFORM
        : OPENCODE_DISABLE_ECC_HOOKS_TRANSFORM)
    );
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

function withoutOpenCodeHookActivation(operation) {
  if (getOpenCodeSourceActivationKind(operation) === 'package') {
    throw new Error(`Unsupported OpenCode package metadata deactivation: ${operation.sourceRelativePath}`);
  }
  if (
    !isOpenCodeHookActivationOperation(operation)
    || operation.kind !== 'copy-file'
  ) {
    return operation;
  }
  return {
    ...operation,
    contentTransform: isOpenCodePluginEntrypoint(operation)
      ? OPENCODE_DISABLE_PLUGIN_TRANSFORM
      : OPENCODE_DISABLE_ECC_HOOKS_TRANSFORM,
  };
}

function planSelectsHookRuntime(plan = {}) {
  return (
    Array.isArray(plan.selectedModuleIds)
    && plan.selectedModuleIds.includes(HOOK_RUNTIME_MODULE_ID)
  ) || (
    Array.isArray(plan.operations)
    && plan.operations.some(operation => operation.moduleId === HOOK_RUNTIME_MODULE_ID)
  );
}

function disableUnselectedOpenCodeHooks(plan) {
  if (plan.target !== 'opencode') {
    return plan;
  }
  const runtimeSelected = planSelectsHookRuntime(plan);
  const transformOperations = operations => (Array.isArray(operations) ? operations : []).map(operation => {
    // The source barrel is needed by the published package, but OpenCode scans
    // plugins/index.ts and plugins/ecc-hooks.ts independently in home installs.
    if (!runtimeSelected || normalizeOperationPath(operation.sourceRelativePath) === '.opencode/plugins/index.ts') {
      return withoutOpenCodeHookActivation(operation);
    }
    return operation;
  });

  return {
    ...plan,
    operations: transformOperations(plan.operations),
    statePreview: plan.statePreview
      ? {
        ...plan.statePreview,
        operations: transformOperations(plan.statePreview.operations),
      }
      : plan.statePreview,
  };
}

function shouldDisableOpenCodeHooks(plan = {}) {
  return plan.target === 'opencode'
    && (plan.hookConsent === 'declined' || !planSelectsHookRuntime(plan));
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

  // Older OpenCode installs copied activation files without asking for consent.
  // Their presence cannot establish that the user opted in to automatic hooks.
  if ((Array.isArray(state.operations) ? state.operations : []).some(operation => (
    !isOpenCodeHookActivationOperation(operation) && isHookRuntimeOperation(operation)
  ))) {
    return 'enabled';
  }

  return null;
}

function stripHookRuntimeFromPlan(plan) {
  const hadHookRuntimeModule = Array.isArray(plan.selectedModuleIds)
    && plan.selectedModuleIds.includes('hooks-runtime');
  const operations = (Array.isArray(plan.operations) ? plan.operations : [])
    .map(operation => (
      plan.target === 'opencode' ? withoutOpenCodeHookActivation(operation) : operation
    ))
    .filter(operation => !isHookRuntimeOperation(operation));
  const statePreview = plan.statePreview
    ? {
      ...plan.statePreview,
      operations: (Array.isArray(plan.statePreview.operations) ? plan.statePreview.operations : [])
        .map(operation => (
          plan.target === 'opencode' ? withoutOpenCodeHookActivation(operation) : operation
        ))
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
  const effectivePlan = disableUnselectedOpenCodeHooks(plan);
  return {
    ...effectivePlan,
    hookConsent,
    statePreview: setStatePreviewHookConsent(effectivePlan.statePreview, hookConsent),
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
  disableUnselectedOpenCodeHooks,
  disableOpenCodeHookPluginRegistration,
  parseJsoncConfig,
  getDisabledOpenCodePluginContent,
  getOpenCodeActivationPathKind,
  getOpenCodeSourceActivationKind,
  formatHookCapabilityDisclosure,
  getRecordedHookConsent,
  isHookRuntimeOperation,
  isOpenCodeHookActivationOperation,
  isOpenCodePluginEntrypoint,
  planMaterializesHookRuntime,
  resolveHookConsentFlags,
  shouldDisableOpenCodeHooks,
  withHookConsent,
};
