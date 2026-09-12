'use strict';

const { loadContextRegistry, projectionFor, explainContextEntry } = require('./context-pack-registry');
const {
  DEFAULT_REPO_ROOT, compilerDigest, createSourceReader, digestObject,
  normalizeMetadataText, stableStringify, validateSchema, validateTarget,
} = require('./context-profile-support');

const PROFILE_ALIASES = Object.freeze({ lean: 'lean@1', full: 'full@1' });
const MODES = Object.freeze(['manual', 'suggest', 'auto']);

function loadContextProfile(profileId = 'lean@1', { repoRoot = DEFAULT_REPO_ROOT } = {}) {
  const id = PROFILE_ALIASES[profileId] || profileId;
  if (!['lean@1', 'full@1'].includes(id)) throw new Error(`Unknown context profile: ${profileId}`);
  const source = createSourceReader(repoRoot).json(`manifests/context-profiles/${id}.json`);
  validateSchema(source, 'context-profile.schema.json');
  if (source.id !== id) throw new Error('Context profile source ID does not match the requested profile');
  if ((id === 'lean@1' && (source.budget.mode !== 'blocking' || source.selection.eager === 'all'))
    || (id === 'full@1' && (source.budget.mode !== 'report-only' || source.selection.eager !== 'all'))) {
    throw new Error('Profile selection and budget mode violate the versioned profile contract');
  }
  const canonical = {
    ...source,
    description: normalizeMetadataText(source.description, 'Profile description'),
    selection: {
      ...source.selection,
      eager: source.selection.eager === 'all' ? 'all' : [...source.selection.eager].sort(),
      required: [...source.selection.required].sort(),
    },
  };
  return { ...canonical, profileDigest: digestObject(canonical) };
}

function validateSelectors(values, knownIds, label) {
  if (!Array.isArray(values)) throw new Error(`${label} must be an array of skill IDs`);
  const seen = new Set();
  for (const id of values) {
    if (typeof id !== 'string' || !knownIds.has(id)) throw new Error(`Unknown ${label} ID: ${id}`);
    if (seen.has(id)) throw new Error(`Duplicate ${label} ID: ${id}`);
    seen.add(id);
  }
  return [...seen].sort();
}

function resolveSelection(registry, profile, include, exclude) {
  const byId = new Map(registry.entries.map(entry => [entry.id, entry]));
  const known = new Set(byId.keys());
  const additions = validateSelectors(include, known, 'include');
  const removals = new Set(validateSelectors(exclude, known, 'exclude'));
  const eager = profile.selection.eager === 'all' ? [...known] : validateSelectors(profile.selection.eager, known, 'profile');
  const required = validateSelectors(profile.selection.required, known, 'required');
  for (const id of required) {
    if (!eager.includes(id)) throw new Error(`Profile is missing required eager ID: ${id}`);
    if (removals.has(id)) throw new Error(`Cannot exclude required profile entry: ${id}`);
  }
  if (additions.some(id => removals.has(id))) throw new Error('Include and exclude selections overlap');
  const selected = new Map();
  function select(id, reason) {
    if (removals.has(id)) throw new Error(`Required dependency closure excludes ${id}`);
    if (selected.has(id)) return;
    selected.set(id, reason);
    byId.get(id).dependencies.forEach(dependency => select(dependency, `Required dependency of ${id}`));
  }
  eager.filter(id => !removals.has(id)).sort().forEach(id => select(id, 'Selected by context profile'));
  additions.forEach(id => select(id, 'Explicitly included'));
  return registry.entries.map(entry => ({
    ...entry,
    selection: selected.has(entry.id) ? 'selected' : removals.has(entry.id) ? 'excluded' : 'routed',
    reason: selected.get(entry.id) || (removals.has(entry.id) ? 'Explicitly excluded' : 'Available through routed discovery'),
  }));
}

function estimateMetadata(entries, target, profile) {
  const ledger = entries.filter(entry => entry.selection === 'selected').map(entry => {
    const metadata = { harness: target, type: 'skill', name: entry.name, description: entry.description };
    const renderedBytes = Buffer.byteLength(`${stableStringify(metadata)}\n`, 'utf8');
    return { id: entry.id, renderedBytes, estimatedTokens: Math.ceil(renderedBytes / 4) };
  });
  const estimatedTokens = ledger.reduce((total, entry) => total + entry.estimatedTokens, 0);
  return {
    method: 'utf8-bytes-div-4@1', surface: 'skill-discovery-metadata',
    renderedBytes: ledger.reduce((total, entry) => total + entry.renderedBytes, 0),
    estimatedTokens, budgetTokens: profile.budget.tokens,
    withinBudget: estimatedTokens <= profile.budget.tokens, budgetMode: profile.budget.mode,
    nativeTokens: null, wrapperTokens: null, wholeScopeTokens: null, ledger,
  };
}

function compileContextProfile({
  repoRoot = DEFAULT_REPO_ROOT, profileId = 'lean@1', selectionMode = 'manual',
  target = 'codex', include = [], exclude = [],
} = {}) {
  validateTarget(target);
  if (!MODES.includes(selectionMode)) throw new Error(`Unknown selection mode: ${selectionMode}`);
  const registry = loadContextRegistry({ repoRoot });
  const profile = loadContextProfile(profileId, { repoRoot });
  if (profile.registryId !== registry.id) throw new Error('Profile registry ID mismatch');
  const selected = resolveSelection(registry, profile, include, exclude);
  const ids = selection => selected.filter(entry => entry.selection === selection).map(entry => entry.id);
  const value = {
    schemaVersion: 'ecc.context-plan.v1', profileId: profile.id, selectionMode, target,
    disposition: 'proposed', active: false,
    registryDigest: registry.registryDigest, profileDigest: profile.profileDigest,
    compilerDigest: compilerDigest(),
    selectedIds: ids('selected'), routedIds: ids('routed'), excludedIds: ids('excluded'),
    entries: selected.map(entry => ({
      id: entry.id, selection: entry.selection, reason: entry.reason,
      sourcePath: entry.sourcePath, contentDigest: entry.contentDigest,
      projection: projectionFor(entry, target),
    })),
    estimate: estimateMetadata(selected, target, profile),
    excludedSurfaces: registry.excludedSurfaces,
    limitations: [
      'Read-only proposal; no harness activation, installation or permission change was attempted.',
      'Selection modes are recorded intent; task routing and automatic switching are not implemented.',
      'Only skill discovery metadata is estimated; provider counters, wrappers and whole-scope costs are unknown.',
      'An estimate within 8000 tokens does not certify native context usage or successful discovery.',
      'Dependency closure covers explicit declarations only; workflow dependency review is incomplete.',
      'Install support is an owner-module declaration; it does not prove native exposure or execution.',
    ],
  };
  const plan = { ...value, planDigest: digestObject(value) };
  if (!plan.estimate.withinBudget && plan.estimate.budgetMode === 'blocking') {
    const error = new Error(`Context metadata estimate ${plan.estimate.estimatedTokens} exceeds the 8000-token ceiling`);
    error.code = 'CONTEXT_PROFILE_BUDGET_EXCEEDED';
    error.plan = plan;
    throw error;
  }
  return plan;
}

module.exports = { compileContextProfile, explainContextEntry, loadContextProfile };
