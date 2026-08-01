'use strict';

const fs = require('fs');
const os = require('os');
const path = require('path');

const { assertSafeInstallOperation } = require('./install/apply');

const VALID_CLAUDE_SCOPES = new Set(['user', 'project', 'local']);
const VALID_CLAUDE_HOOKS = new Set(['off', 'minimal', 'standard', 'strict']);
const VALID_PROFILES = new Set(['minimal', 'core', 'developer', 'security', 'research', 'full']);

function catalogHelpers() {
  return require('./harness-capabilities');
}

function normalizeGuidedInstallRequest(input = {}) {
  const { normalizeHarnessSelection } = catalogHelpers();
  const harnesses = normalizeHarnessSelection(input.harnesses || []);
  if (harnesses.length === 0) {
    throw new Error('Choose at least one guided harness: Claude, Codex, or Kimi.');
  }

  const includesClaude = harnesses.includes('claude');
  const includesKimi = harnesses.includes('kimi');
  if (!includesClaude && (input.claudeScope !== undefined || input.claudeHooks !== undefined)) {
    throw new Error('Claude scope and hook options require Claude to be selected.');
  }
  if (!includesKimi && input.profile !== undefined) {
    throw new Error('The managed install profile requires Kimi to be selected.');
  }

  const claudeScope = includesClaude ? (input.claudeScope || 'user') : undefined;
  const claudeHooks = includesClaude ? (input.claudeHooks || 'standard') : undefined;
  const profile = includesKimi ? (input.profile || 'core') : undefined;
  if (claudeScope && !VALID_CLAUDE_SCOPES.has(claudeScope)) {
    throw new Error(`Invalid Claude scope: ${claudeScope}`);
  }
  if (claudeHooks && !VALID_CLAUDE_HOOKS.has(claudeHooks)) {
    throw new Error(`Invalid Claude hooks preference: ${claudeHooks}`);
  }
  if (profile && !VALID_PROFILES.has(profile)) {
    throw new Error(`Invalid Kimi install profile: ${profile}`);
  }

  return {
    harnesses,
    ...(claudeHooks ? { claudeHooks } : {}),
    ...(claudeScope ? { claudeScope } : {}),
    dryRun: Boolean(input.dryRun),
    json: Boolean(input.json),
    ...(profile ? { profile } : {}),
    yes: Boolean(input.yes),
  };
}

function readOwnedDestinations(plan, dependencies) {
  if (!plan.installStatePath || !fs.existsSync(plan.installStatePath)) return new Set();
  const readState = dependencies.readInstallState || require('./install-state').readInstallState;
  const state = readState(plan.installStatePath);
  return new Set((state.operations || []).map(operation => operation.destinationPath));
}

function assertMergeDestination(destinationPath) {
  if (!fs.existsSync(destinationPath)) return null;
  let current;
  try {
    current = JSON.parse(fs.readFileSync(destinationPath, 'utf8'));
  } catch (error) {
    throw new Error(`Cannot merge ECC configuration into invalid JSON at ${destinationPath}: ${error.message}`);
  }
  if (!current || typeof current !== 'object' || Array.isArray(current)) {
    throw new Error(`Cannot merge ECC configuration at ${destinationPath}: expected a JSON object.`);
  }
  return current;
}

function isPlainObject(value) {
  return Boolean(value) && typeof value === 'object' && !Array.isArray(value);
}

function findJsonConflicts(current, patch, prefix = '') {
  if (!isPlainObject(patch)) return [];
  return Object.entries(patch).flatMap(([key, patchValue]) => {
    if (!Object.prototype.hasOwnProperty.call(current, key)) return [];
    const currentValue = current[key];
    const field = prefix ? `${prefix}.${key}` : key;
    if (isPlainObject(currentValue) && isPlainObject(patchValue)) {
      return findJsonConflicts(currentValue, patchValue, field);
    }
    return JSON.stringify(currentValue) === JSON.stringify(patchValue) ? [] : [field];
  });
}

function classifyManagedOperation(operation, ownedDestinations) {
  const destinationPath = operation.destinationPath;
  if (!fs.existsSync(destinationPath)) return 'create';
  if (operation.kind === 'merge-json') {
    const current = assertMergeDestination(destinationPath);
    if (ownedDestinations.has(destinationPath)) return 'managed-json-update';
    const conflicts = findJsonConflicts(current, operation.mergePayload);
    if (conflicts.length > 0) {
      throw new Error(
        `Refusing to overwrite unowned JSON fields at ${destinationPath}: ${conflicts.join(', ')}`
      );
    }
    return 'json-merge';
  }
  if (ownedDestinations.has(destinationPath)) return 'managed-update';
  if (
    operation.kind === 'copy-file'
    && typeof operation.sourcePath === 'string'
    && fs.existsSync(operation.sourcePath)
    && fs.statSync(destinationPath).isFile()
    && fs.readFileSync(operation.sourcePath).equals(fs.readFileSync(destinationPath))
  ) {
    return 'identical';
  }
  throw new Error(`Refusing to replace unowned existing file: ${destinationPath}`);
}

function writableRequirement(destinationPath) {
  if (fs.existsSync(destinationPath)) {
    const mode = fs.statSync(destinationPath).isDirectory()
      ? fs.constants.W_OK | fs.constants.X_OK
      : fs.constants.W_OK;
    return { candidatePath: destinationPath, mode };
  }

  let candidatePath = path.dirname(destinationPath);
  while (!fs.existsSync(candidatePath)) {
    const parentPath = path.dirname(candidatePath);
    if (parentPath === candidatePath) break;
    candidatePath = parentPath;
  }
  return {
    candidatePath,
    mode: fs.constants.W_OK | fs.constants.X_OK,
  };
}

function assertManagedDestinationsWritable(plan, dependencies) {
  const accessSync = dependencies.accessSync || fs.accessSync;
  const destinationPaths = [
    ...plan.operations.map(operation => operation.destinationPath),
    ...(plan.installStatePath ? [plan.installStatePath] : []),
  ];
  const requirements = new Map();

  for (const destinationPath of destinationPaths) {
    const requirement = writableRequirement(destinationPath);
    const existingMode = requirements.get(requirement.candidatePath) || 0;
    requirements.set(requirement.candidatePath, existingMode | requirement.mode);
  }

  for (const [candidatePath, mode] of requirements) {
    try {
      accessSync(candidatePath, mode);
    } catch (_error) {
      const label = plan.target === 'kimi' ? 'Kimi' : 'Managed install';
      throw new Error(
        `${label} destination is not writable by the current user: ${candidatePath}. `
        + 'Fix the project ownership or permissions, then retry.'
      );
    }
  }
}

function preflightManagedPlan(plan, dependencies = {}) {
  if (!plan || !Array.isArray(plan.operations)) {
    throw new Error('A managed install plan with operations is required.');
  }
  const ownedDestinations = readOwnedDestinations(plan, dependencies);
  const operations = plan.operations.map(operation => {
    assertSafeInstallOperation(plan, operation);
    return {
      destinationPath: operation.destinationPath,
      kind: operation.kind,
      classification: classifyManagedOperation(operation, ownedDestinations),
    };
  });
  assertManagedDestinationsWritable(plan, dependencies);
  return { plan, operations };
}

function defaultDependencies(options = {}) {
  return {
    previewClaude: request => require('../setup').reconcileClaudePlugin(
      { dryRun: true, hooks: request.claudeHooks, scope: request.claudeScope }
    ),
    previewCodex: () => require('./codex-plugin-setup').reconcileCodexPlugin({ dryRun: true }),
    createManagedPlan: request => require('./install/runtime').createInstallPlanFromRequest(
      require('./install/request').normalizeInstallRequest({
        profileId: request.profile,
        target: 'kimi',
      }),
      {
        homeDir: options.homeDir || process.env.HOME || os.homedir(),
        projectRoot: options.projectRoot || process.cwd(),
        sourceRoot: options.sourceRoot,
      }
    ),
    preflightManaged: preflightManagedPlan,
    applyClaude: request => require('../setup').reconcileClaudePlugin(
      { dryRun: false, hooks: request.claudeHooks, scope: request.claudeScope }
    ),
    applyCodex: () => require('./codex-plugin-setup').reconcileCodexPlugin({ dryRun: false }),
    applyManaged: entry => require('./install-executor').applyInstallPlan(entry.preview.plan),
  };
}

async function createMultiHarnessPlan(request, injected = {}, options = {}) {
  const dependencies = { ...defaultDependencies(options), ...injected };
  let entries = [];
  for (const id of request.harnesses) {
    if (id === 'claude') {
      entries = [...entries, { id, channel: 'native-plugin', preview: await dependencies.previewClaude(request) }];
    } else if (id === 'codex') {
      entries = [...entries, { id, channel: 'native-plugin', preview: await dependencies.previewCodex(request) }];
    } else if (id === 'kimi') {
      const managedPlan = await dependencies.createManagedPlan(request);
      entries = [...entries, {
        id,
        channel: 'managed-project',
        preview: await dependencies.preflightManaged(managedPlan),
      }];
    } else {
      throw new Error(`Unsupported guided harness: ${id}`);
    }
  }
  return { harnesses: entries, request };
}

async function applyMultiHarnessPlan(plan, injected = {}, options = {}) {
  const dependencies = { ...defaultDependencies(options), ...injected };
  if (plan.request.dryRun) {
    return { status: 'preview', completed: [], retryHarnesses: [...plan.request.harnesses] };
  }

  let completed = [];
  for (let index = 0; index < plan.harnesses.length; index += 1) {
    const entry = plan.harnesses[index];
    try {
      let result;
      if (entry.id === 'claude') result = await dependencies.applyClaude(plan.request, entry);
      else if (entry.id === 'codex') result = await dependencies.applyCodex(plan.request, entry);
      else result = await dependencies.applyManaged(entry, plan.request);
      completed = [...completed, { id: entry.id, result }];
    } catch (error) {
      return {
        status: completed.length > 0 ? 'partial' : 'failed',
        completed,
        failure: { id: entry.id, message: error.message },
        retryHarnesses: plan.harnesses.slice(index).map(item => item.id),
      };
    }
  }
  return { status: 'complete', completed, retryHarnesses: [] };
}

module.exports = {
  VALID_CLAUDE_HOOKS,
  VALID_CLAUDE_SCOPES,
  VALID_PROFILES,
  applyMultiHarnessPlan,
  createMultiHarnessPlan,
  normalizeGuidedInstallRequest,
  preflightManagedPlan,
  findJsonConflicts,
};
