'use strict';

const HOOK_AUTHORIZATION_GROUPS = Object.freeze([
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

const HOOK_AUTHORIZATION_GROUP_IDS = Object.freeze(
  HOOK_AUTHORIZATION_GROUPS.map(group => group.id)
);
const HOOK_AUTHORIZATION_GROUP_BY_ID = new Map(
  HOOK_AUTHORIZATION_GROUPS.map(group => [group.id, group])
);
const VALID_HOOK_AUTHORIZATION_DECISIONS = new Set(['allow', 'decline']);

function isPlainObject(value) {
  return Boolean(value) && typeof value === 'object' && !Array.isArray(value);
}

function normalizeHookAuthorizations(value, label = 'hook authorizations') {
  if (value === undefined || value === null) {
    return {};
  }
  if (!isPlainObject(value)) {
    throw new Error(`${label} must be an object`);
  }

  const normalized = {};
  for (const [rawId, rawDecision] of Object.entries(value)) {
    const id = String(rawId || '').trim();
    const decision = String(rawDecision || '').trim().toLowerCase();
    if (!HOOK_AUTHORIZATION_GROUP_BY_ID.has(id)) {
      throw new Error(`Unknown hook authorization group: ${id || '(empty)'}`);
    }
    if (!VALID_HOOK_AUTHORIZATION_DECISIONS.has(decision)) {
      throw new Error(
        `Hook authorization decision for ${id} must be allow or decline`
      );
    }
    normalized[id] = decision;
  }

  return normalized;
}

function mergeHookAuthorizations(...sources) {
  const merged = {};

  for (const source of sources) {
    const normalized = normalizeHookAuthorizations(source);
    for (const [id, decision] of Object.entries(normalized)) {
      if (merged[id] && merged[id] !== decision) {
        throw new Error(
          `Conflicting hook authorization decision for ${id}: ${merged[id]} versus ${decision}`
        );
      }
      merged[id] = decision;
    }
  }

  return merged;
}

function parseHookAuthorizationArgument(rawValue) {
  const raw = String(rawValue || '').trim();
  const separatorIndex = raw.indexOf('=');
  if (
    separatorIndex <= 0
    || separatorIndex === raw.length - 1
    || raw.indexOf('=', separatorIndex + 1) !== -1
  ) {
    throw new Error(
      'Invalid --hook-authorization value. Expected <group>=allow|decline'
    );
  }

  const id = raw.slice(0, separatorIndex).trim();
  const decision = raw.slice(separatorIndex + 1).trim();
  return normalizeHookAuthorizations({ [id]: decision });
}

function buildHookMaterializationAuthorization(decisions) {
  const normalized = normalizeHookAuthorizations(decisions);
  const missingGroupIds = HOOK_AUTHORIZATION_GROUP_IDS.filter(
    id => normalized[id] !== 'allow'
  );
  return {
    status: missingGroupIds.length === 0 ? 'AUTHORIZED' : 'HELD',
    missingGroupIds,
    decisions: normalized,
  };
}

function normalizeOperationPath(value) {
  return String(value || '').replace(/\\/g, '/').toLowerCase();
}

function isHookRuntimeOperation(operation = {}) {
  if (operation.moduleId === 'hooks-runtime') {
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
    || source === '.opencode/plugins'
    || source.startsWith('.opencode/plugins/')
    || source === '.opencode/dist/plugins'
    || source.startsWith('.opencode/dist/plugins/')
    || destination.endsWith('/hooks/hooks.json')
    || destination.endsWith('/.cursor/hooks.json')
    || destination.includes('/.cursor/hooks/')
  );
}

function assertHookAuthorizationReady(plan = {}) {
  const selectedModuleIds = Array.isArray(plan.selectedModuleIds)
    ? plan.selectedModuleIds
    : [];
  const operations = Array.isArray(plan.operations) ? plan.operations : [];
  const includesHookRuntime = (
    selectedModuleIds.includes('hooks-runtime')
    || operations.some(isHookRuntimeOperation)
  );
  if (!includesHookRuntime) {
    return;
  }

  const status = plan.hookAuthorization?.status;
  if (status !== 'AUTHORIZED') {
    const missing = Array.isArray(plan.hookAuthorization?.missingGroupIds)
      ? plan.hookAuthorization.missingGroupIds
      : HOOK_AUTHORIZATION_GROUP_IDS;
    throw new Error(
      'Hook authorization REVIEW / HELD: installation cannot materialize hooks-runtime'
        + `${missing.length > 0 ? ` until these groups are decided: ${missing.join(', ')}` : ''}`
    );
  }
}

module.exports = {
  HOOK_AUTHORIZATION_GROUPS,
  HOOK_AUTHORIZATION_GROUP_IDS,
  assertHookAuthorizationReady,
  buildHookMaterializationAuthorization,
  isHookRuntimeOperation,
  mergeHookAuthorizations,
  normalizeHookAuthorizations,
  parseHookAuthorizationArgument,
};
