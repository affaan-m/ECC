'use strict';

const fs = require('fs');
const crypto = require('crypto');
const os = require('os');
const path = require('path');

const { assertSafeInstallOperation } = require('./install/apply');
const { assertWithinTrustedRoot, realpathNearestExisting } = require('./path-safety');

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

function canonicalPath(filePath) {
  return realpathNearestExisting(filePath);
}

function pathsMatch(left, right) {
  return canonicalPath(left) === canonicalPath(right);
}

function sameFileIdentity(left, right) {
  return left.dev === right.dev
    && left.ino === right.ino
    && left.size === right.size
    && left.mtimeMs === right.mtimeMs
    && left.ctimeMs === right.ctimeMs;
}

function readRegularFileSnapshot(filePath) {
  const flags = fs.constants.O_RDONLY | (fs.constants.O_NOFOLLOW || 0);
  let descriptor;
  try {
    descriptor = fs.openSync(filePath, flags);
  } catch (error) {
    if (error && (error.code === 'ENOENT' || error.code === 'ENOTDIR')) return null;
    throw error;
  }

  try {
    const before = fs.fstatSync(descriptor);
    if (!before.isFile()) {
      throw new Error(`Refusing to read a non-file at ${filePath}.`);
    }
    const content = fs.readFileSync(descriptor);
    const after = fs.fstatSync(descriptor);
    const finalPathStat = fs.lstatSync(filePath);
    if (
      finalPathStat.isSymbolicLink()
      || !finalPathStat.isFile()
      || !sameFileIdentity(before, after)
      || !sameFileIdentity(after, finalPathStat)
    ) {
      throw new Error(`Refusing to read a file that changed during validation: ${filePath}.`);
    }
    return { content, stat: after };
  } finally {
    fs.closeSync(descriptor);
  }
}

function fingerprintFile(filePath) {
  const snapshot = readRegularFileSnapshot(filePath);
  if (!snapshot) return { exists: false, sha256: null };
  return {
    exists: true,
    sha256: crypto.createHash('sha256').update(snapshot.content).digest('hex'),
  };
}

function fingerprintInstallStateValue(state) {
  const content = Buffer.from(`${JSON.stringify(state, null, 2)}\n`);
  return {
    exists: true,
    sha256: crypto.createHash('sha256').update(content).digest('hex'),
  };
}

function operationIdentityMatches(stateOperation, plannedOperation) {
  return [
    'kind',
    'moduleId',
    'sourceRelativePath',
    'strategy',
    'scaffoldOnly',
  ].every(field => stateOperation[field] === plannedOperation[field]);
}

function assertInstallStateUnchanged(plan, expectedFingerprint) {
  const currentFingerprint = fingerprintFile(plan.installStatePath);
  if (
    currentFingerprint.exists !== expectedFingerprint.exists
    || currentFingerprint.sha256 !== expectedFingerprint.sha256
  ) {
    throw new Error(
      `Refusing to overwrite an unowned or changed install-state at ${plan.installStatePath}. `
      + 'Re-run the guided preview and review the existing state before retrying.'
    );
  }
}

function assertPriorInstallStateMatchesPlan(state, plan) {
  const target = state.target || {};
  const adapter = plan.adapter || {};
  if (
    target.id !== adapter.id
    || target.target !== adapter.target
    || target.kind !== adapter.kind
  ) {
    throw new Error(
      `Refusing to trust managed install-state at ${plan.installStatePath}: `
      + 'target identity does not match the current Kimi install plan.'
    );
  }
  if (!pathsMatch(target.root, plan.targetRoot)) {
    throw new Error(
      `Refusing to trust managed install-state at ${plan.installStatePath}: `
      + 'recorded root does not match the current install root.'
    );
  }
  if (!pathsMatch(target.installStatePath, plan.installStatePath)) {
    throw new Error(
      `Refusing to trust managed install-state at ${plan.installStatePath}: `
      + 'recorded install-state path does not match the current install-state path.'
    );
  }
}

function readOwnedDestinations(plan, dependencies) {
  if (!plan.installStatePath) {
    return { destinations: new Set(), stateFingerprint: { exists: false, sha256: null } };
  }
  try {
    assertSafeInstallOperation(plan, { destinationPath: plan.installStatePath });
  } catch (error) {
    throw new Error(`Refusing to trust managed install-state path: ${error.message}`);
  }
  const initialFingerprint = fingerprintFile(plan.installStatePath);
  if (!initialFingerprint.exists) {
    return { destinations: new Set(), stateFingerprint: { exists: false, sha256: null } };
  }
  const readState = dependencies.readInstallState || require('./install-state').readInstallState;
  const state = readState(plan.installStatePath);
  const validatedFingerprint = fingerprintFile(plan.installStatePath);
  if (
    initialFingerprint.exists !== validatedFingerprint.exists
    || initialFingerprint.sha256 !== validatedFingerprint.sha256
  ) {
    throw new Error(
      `Refusing to trust install-state that changed during validation: ${plan.installStatePath}.`
    );
  }
  assertPriorInstallStateMatchesPlan(state, plan);
  const plannedByDestination = new Map(plan.operations.map(operation => [
    canonicalPath(operation.destinationPath),
    operation,
  ]));
  const destinations = new Set();
  for (const operation of state.operations || []) {
    if (operation.ownership !== 'managed') {
      throw new Error(
        `Refusing to trust non-managed ownership from install-state at ${plan.installStatePath}.`
      );
    }
    const destinationPath = operation.destinationPath;
    assertWithinTrustedRoot(destinationPath, plan.targetRoot, 'trust install-state ownership');
    const canonicalDestination = canonicalPath(destinationPath);
    const plannedOperation = plannedByDestination.get(canonicalDestination);
    if (!plannedOperation) continue;
    if (!operationIdentityMatches(operation, plannedOperation)) {
      throw new Error(
        `Refusing unverified ownership from install-state at ${plan.installStatePath}: `
        + `operation identity does not match the current plan for ${destinationPath}.`
      );
    }
    const currentFingerprint = fingerprintFile(destinationPath);
    if (
      !currentFingerprint.exists
      || !/^[a-f0-9]{64}$/i.test(operation.contentSha256 || '')
      || currentFingerprint.sha256 !== operation.contentSha256.toLowerCase()
    ) {
      throw new Error(
        `Refusing unverified ownership from install-state at ${plan.installStatePath}: `
        + `content digest does not match ${destinationPath}.`
      );
    }
    destinations.add(canonicalDestination);
  }
  return { destinations, stateFingerprint: validatedFingerprint };
}

function assertMergeDestination(destinationPath, existingSnapshot = null) {
  const snapshot = existingSnapshot || readRegularFileSnapshot(destinationPath);
  if (!snapshot) return null;
  let current;
  try {
    current = JSON.parse(snapshot.content.toString('utf8'));
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
  const destination = readRegularFileSnapshot(destinationPath);
  if (!destination) return 'create';
  const canonicalDestination = canonicalPath(destinationPath);
  if (operation.kind === 'merge-json') {
    const current = assertMergeDestination(destinationPath, destination);
    if (ownedDestinations.has(canonicalDestination)) return 'managed-json-update';
    const conflicts = findJsonConflicts(current, operation.mergePayload);
    if (conflicts.length > 0) {
      throw new Error(
        `Refusing to overwrite unowned JSON fields at ${destinationPath}: ${conflicts.join(', ')}`
      );
    }
    return 'json-merge';
  }
  if (ownedDestinations.has(canonicalDestination)) return 'managed-update';
  if (
    operation.kind === 'copy-file'
    && typeof operation.sourcePath === 'string'
    && readRegularFileSnapshot(operation.sourcePath)?.content.equals(destination.content)
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
  if (typeof plan.installStatePath !== 'string' || plan.installStatePath.length === 0) {
    throw new Error('A managed install-state path is required before preflight.');
  }
  const ownership = readOwnedDestinations(plan, dependencies);
  const operations = plan.operations.map(operation => {
    assertSafeInstallOperation(plan, operation);
    return {
      destinationPath: operation.destinationPath,
      kind: operation.kind,
      classification: classifyManagedOperation(operation, ownership.destinations),
    };
  });
  assertManagedDestinationsWritable(plan, dependencies);
  return {
    plan,
    operations,
    ownershipSnapshot: {
      destinations: [...ownership.destinations],
      stateFingerprint: ownership.stateFingerprint,
    },
  };
}

async function applyPreflightedManagedPlan(entry) {
  const preview = entry.preview && entry.preview.ownershipSnapshot
    ? entry.preview
    : preflightManagedPlan(entry.preview.plan);
  const ownedDestinations = new Set(preview.ownershipSnapshot.destinations);
  let expectedStateFingerprint = preview.ownershipSnapshot.stateFingerprint;
  let operationIndex = 0;
  const assertStateUnchanged = () => (
    assertInstallStateUnchanged(preview.plan, expectedStateFingerprint)
  );
  const prepareInstallStateWrite = ({ state }) => {
    assertStateUnchanged();
    expectedStateFingerprint = fingerprintInstallStateValue(state);
  };

  const result = require('./install-executor').applyInstallPlan(preview.plan, {
    beforeInstallStateRead: assertStateUnchanged,
    beforeOperationWrite({ operation }) {
      assertStateUnchanged();
      const expected = preview.operations[operationIndex];
      const currentClassification = classifyManagedOperation(operation, ownedDestinations);
      const destination = canonicalPath(operation.destinationPath);
      if (
        !expected
        || expected.kind !== operation.kind
        || canonicalPath(expected.destinationPath) !== destination
        || expected.classification !== currentClassification
      ) {
        throw new Error(
          `Refusing to write ${operation.destinationPath}: destination changed after Kimi preflight.`
        );
      }
      ownedDestinations.add(destination);
      operationIndex += 1;
    },
    beforeInstallStateWrite: prepareInstallStateWrite,
  });
  const { projectCanonicalInstallState } = require('./install-state-store-sync');
  const installStateProjection = await projectCanonicalInstallState(result.statePreview);
  return {
    ...result,
    installStateProjection,
    warnings: installStateProjection.warning
      ? [...result.warnings, `Install health projection warning: ${installStateProjection.warning.message}`]
      : result.warnings,
  };
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
    applyManaged: applyPreflightedManagedPlan,
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
      else if (entry.preview && entry.preview.plan) {
        const latestPreview = dependencies.preflightManaged(entry.preview.plan);
        result = await dependencies.applyManaged(
          { ...entry, preview: latestPreview },
          plan.request
        );
      } else {
        result = await dependencies.applyManaged(entry, plan.request);
      }
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
