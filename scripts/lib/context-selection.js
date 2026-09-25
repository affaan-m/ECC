'use strict';

const yaml = require('js-yaml');
const { loadContextRegistry, loadSkillTriggers } = require('./context-pack-registry');
const { compileContextProfile } = require('./context-profiles');
const { buildRetrievalIndex, searchRetrieval } = require('./context-retrieval');
const { DEFAULT_REPO_ROOT, createSourceReader, digestObject } = require('./context-profile-support');

const MAX_CANDIDATES = 5;
const MAX_SELECTED = 8;
const MAX_CONTEXT_BYTES = 32000;
// Auto-admission bar, calibrated on the pinned probe corpus in
// tests/lib/context-retrieval.test.js: admit the ranked top skill without a
// provider proposal only when the match is strong in absolute terms and
// clearly separated from the second candidate. Exact canonical-name anchors
// are admitted when exactly one skill is cited. Revisit these values when the
// pinned-embedder upgrade changes score distributions.
const AUTO_ADMIT_MIN_BM25 = 20;
const AUTO_ADMIT_MIN_TERMS = 3;
const AUTO_ADMIT_MARGIN = 1.5;
// Tier-2 fallback: when Auto defers to a provider proposal and the proposal
// declines, admit the top candidate anyway if it clears this lower bar. Below
// it, no fallback exists — running without context is safer than loading a
// likely-wrong skill.
const FALLBACK_MIN_BM25 = 12;
const FALLBACK_MIN_TERMS = 2;
const FALLBACK_MARGIN = 1.1;
const ROUTING_POLICY_VERSION = 3;
const TASK_KEYS = new Set(['sessionId', 'taskId', 'revision', 'phase', 'query', 'explicitIds', 'proposedIds', 'noWorkflow']);
const STOP_WORDS = new Set('a an and are for from help i in is it me my of on please the to with'.split(' '));

function tokens(text) {
  return [...new Set(text.toLowerCase().split(/[^a-z0-9]+/).filter(word => word.length > 1 && !STOP_WORDS.has(word)))];
}

function validateTask(task) {
  if (!task || typeof task !== 'object' || Array.isArray(task)) throw new Error('Task must be an object');
  for (const key of Object.keys(task)) if (!TASK_KEYS.has(key)) throw new Error(`Unknown task field: ${key}`);
  for (const key of ['sessionId', 'taskId', 'phase']) {
    if (typeof task[key] !== 'string' || !/^[a-zA-Z0-9][a-zA-Z0-9_.:-]{0,127}$/.test(task[key])) {
      throw new Error(`Invalid task ${key}`);
    }
  }
  if (!Number.isSafeInteger(task.revision) || task.revision < 1) throw new Error('Task revision must be a positive integer');
  if (task.query !== undefined && (typeof task.query !== 'string' || Buffer.byteLength(task.query) > 8192)) {
    throw new Error('Task query exceeds the input limit');
  }
  if (task.noWorkflow !== undefined && typeof task.noWorkflow !== 'boolean') throw new Error('noWorkflow must be boolean');
  for (const key of ['explicitIds', 'proposedIds']) {
    if (task[key] !== undefined && (!Array.isArray(task[key]) || task[key].length > MAX_SELECTED
      || task[key].some(id => typeof id !== 'string') || new Set(task[key]).size !== task[key].length)) {
      throw new Error(`${key} must contain at most ${MAX_SELECTED} unique skill IDs`);
    }
  }
  if (task.noWorkflow && ((task.explicitIds || []).length || (task.proposedIds || []).length)) {
    throw new Error('noWorkflow conflicts with requested skills');
  }
}

// Inspired by Jeffrey Montoya's bounded local routing in community PR #2945.
// Canonical source digests replace its independent cache/receipt authority.
// Ranking now uses the hybrid retrieval engine (BM25-weighted fields fused
// with hashed character n-gram vectors); see context-retrieval.js.
function candidatesFor(query, entries, excluded, admissible, triggers = {}) {
  const available = entries.filter(entry => !excluded.has(entry.id))
    .map(entry => triggers[entry.id] ? { ...entry, triggers: triggers[entry.id] } : entry);
  const index = buildRetrievalIndex(available);
  const candidates = searchRetrieval(index, query, { limit: MAX_CANDIDATES * 3 })
    .filter(candidate => admissible(candidate.id))
    .slice(0, MAX_CANDIDATES);
  return { candidates };
}

function verifiedResource(entry, sourcePath, reader) {
  const expected = entry.resources.find(resource => resource.path === sourcePath);
  const actual = reader.read(sourcePath);
  if (!expected || actual.digest !== expected.digest || actual.bytes !== expected.bytes) {
    throw new Error('Context source changed during selection');
  }
  return actual;
}

function policyFor(entry, reader) {
  const source = verifiedResource(entry, entry.sourcePath, reader).content.toString('utf8');
  const match = source.replace(/\r\n?/g, '\n').match(/^---\n([\s\S]*?)\n---(?:\n|$)/);
  const metadata = match ? yaml.load(match[1], { schema: yaml.JSON_SCHEMA }) : {};
  let manualOnly = metadata['disable-model-invocation'] === true;
  const config = entry.resources.find(resource => resource.path.endsWith('/agents/openai.yaml'));
  if (config) {
    const document = yaml.load(verifiedResource(entry, config.path, reader).content.toString('utf8'), { schema: yaml.JSON_SCHEMA });
    manualOnly ||= document?.policy?.allow_implicit_invocation === false;
  }
  return { manualOnly, authority: ['allowed-tools', 'tools', 'context', 'agent', 'hooks'].some(key => metadata[key] !== undefined),
    dynamic: /!`/.test(source) };
}

function selectedClosure(ids, explicit, byId, excluded, reader) {
  const selected = new Set();
  function visit(id) {
    if (!byId.has(id)) throw new Error(`Unknown context ID: ${id}`);
    if (excluded.has(id)) throw new Error(`Context ID is excluded: ${id}`);
    if (selected.has(id)) return;
    const entry = byId.get(id);
    const policy = policyFor(entry, reader);
    if (policy.manualOnly && !explicit.has(id)) throw new Error(`Context ID is manual-only: ${id}`);
    if (policy.authority || policy.dynamic) throw new Error(`Context requires native authority or dynamic-content review: ${id}`);
    selected.add(id);
    if (selected.size > MAX_SELECTED) throw new Error('Task selection exceeds the skill limit');
    entry.dependencies.forEach(visit);
  }
  ids.forEach(visit);
  return [...selected].sort();
}

function readSelected(ids, byId, reader) {
  let total = 0;
  return ids.flatMap(id => {
    const entry = byId.get(id);
    return [...new Set([entry.sourcePath, ...entry.requiredResources])].map(sourcePath => {
      const actual = verifiedResource(entry, sourcePath, reader);
      total += actual.bytes;
      if (total > MAX_CONTEXT_BYTES) throw new Error('Task context exceeds the 32000-byte budget; choose a narrower immediate step');
      const content = actual.content.toString('utf8');
      if (!Buffer.from(content, 'utf8').equals(actual.content) || content.includes('\0')) throw new Error('Required context resource is not UTF-8 text');
      return { id, path: sourcePath, digest: actual.digest, bytes: actual.bytes, content };
    });
  });
}

function validatePrevious(previous) {
  if (!previous) return;
  const { receiptDigest, ...value } = previous;
  if (previous.schemaVersion !== 'ecc.task-context-receipt.v1' || digestObject(value) !== receiptDigest
    || !Array.isArray(previous.selectedIds) || !Array.isArray(previous.explicitIds)
    || (previous.decision !== undefined && !['pending', 'selected', 'none'].includes(previous.decision))) {
    throw new Error('Invalid task context receipt');
  }
}

/** Pure task-scoped resolver. Returned context never invokes a native skill or changes permissions. */
function resolveTaskContext({ repoRoot = DEFAULT_REPO_ROOT, task, profileId = 'lean@1', target = 'codex',
  selectionMode = 'auto', include = [], exclude = [], load = false, previous = null, expectedDigest = null } = {}) {
  validateTask(task);
  validatePrevious(previous);
  const plan = compileContextProfile({ repoRoot, profileId, target, selectionMode, include, exclude });
  const registry = loadContextRegistry({ repoRoot });
  const { triggers } = loadSkillTriggers({ repoRoot });
  if (registry.registryDigest !== plan.registryDigest) throw new Error('Registry changed during task selection');
  const reader = createSourceReader(repoRoot);
  const byId = new Map(registry.entries.map(entry => [entry.id, entry]));
  const excluded = new Set(plan.excludedIds);
  const explicitIds = [...(task.explicitIds || [])].sort();
  const proposedIds = [...(task.proposedIds || [])].sort();
  [...explicitIds, ...proposedIds].forEach(id => {
    if (!byId.has(id)) throw new Error(`Unknown context ID: ${id}`);
    if (excluded.has(id)) throw new Error(`Context ID is excluded: ${id}`);
  });
  const taskBinding = { sessionId: task.sessionId, taskId: task.taskId, revision: task.revision, phase: task.phase };
  const bindingDigest = digestObject({ ...taskBinding, planDigest: plan.planDigest, routingPolicyVersion: ROUTING_POLICY_VERSION });
  const reused = Boolean(previous && previous.bindingDigest === bindingDigest && !task.noWorkflow
    && ['selected', 'none'].includes(previous.decision) && !explicitIds.length && !proposedIds.length);
  const admissible = id => {
    try {
      const closure = selectedClosure([id], new Set(), byId, excluded, reader);
      readSelected(closure, byId, reader);
      return true;
    } catch (error) {
      // Only known admission denials remove a suggestion. Source drift and
      // malformed policy still fail closed instead of disappearing from view.
      if (/manual-only|requires native authority|is excluded|exceeds the skill limit|32000-byte budget|not UTF-8 text/.test(error.message)) return false;
      throw error;
    }
  };
  const { candidates } = task.noWorkflow || selectionMode === 'manual' || reused
    ? { candidates: [] } : candidatesFor(task.query || '', registry.entries, excluded, admissible, triggers);
  // Auto admission: free-text routing loads the ranked top skill only on
  // unambiguous evidence, or when the query is an explicit directive citation
  // of exactly one skill (for example "Use the X skill"). Mere mentions —
  // questions, negations, reported speech, multiple cited names — never admit
  // implicitly. Everything else keeps the bounded-proposal path so the
  // primary agent decides ambiguous cases during work it was already doing.
  const DIRECTIVE_VERB = /\b(use|apply|invoke|run|follow|load)\s+(the\s+)?/i;
  const normalizedQueryName = text => text.replace(/([a-z0-9])([A-Z])/g, '$1 $2').replace(/_/g, ' ')
    .toLowerCase().replace(/[^a-z0-9]+/g, ' ').trim();
  const directiveCitation = candidate => {
    if (!candidate || !candidate.exact) return false;
    const text = normalizedQueryName(task.query || '');
    const aliases = [...new Set([candidate.exactAlias,
      candidate.id.slice('skill:'.length).toLowerCase(),
      candidate.id.slice('skill:'.length).toLowerCase().replace(/-/g, ' ')].filter(Boolean))];
    for (const name of aliases) {
      const escaped = name.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
      const pattern = new RegExp(`${DIRECTIVE_VERB.source}(skill\\s*:?\\s*)?${escaped}(\\s+(skill|workflow|guidance))?\\b`, 'i');
      const match = pattern.exec(text);
      if (!match) continue;
      const window = text.slice(Math.max(0, match.index - 28), match.index);
      if (/\b(do not|don't|never|no)\b/.test(window)) return false;
      if (/\b(says|said|reads|told|document)\b/i.test(task.query || '')) return false;
      return true;
    }
    return false;
  };
  const exactAnchors = candidates.filter(directiveCitation);
  let autoSelection = null;
  if (!task.noWorkflow && selectionMode === 'auto' && !reused && !explicitIds.length && !proposedIds.length && candidates.length) {
    if (exactAnchors.length === 1) {
      autoSelection = { id: exactAnchors[0].id, bm25: exactAnchors[0].bm25,
        matchedTerms: exactAnchors[0].matchedTerms.length, exact: true };
    } else if (!exactAnchors.length) {
      const top = candidates[0];
      const second = candidates[1];
      if (top.bm25 >= AUTO_ADMIT_MIN_BM25 && top.matchedTerms.length >= AUTO_ADMIT_MIN_TERMS
        && (!second || top.bm25 >= AUTO_ADMIT_MARGIN * (second.bm25 || 0))) {
        autoSelection = { id: top.id, bm25: top.bm25, matchedTerms: top.matchedTerms.length, exact: false };
      }
    }
  }
  let fallback = null;
  if (!autoSelection && !task.noWorkflow && selectionMode === 'auto' && !reused
    && !explicitIds.length && !proposedIds.length && candidates.length && !exactAnchors.length) {
    const top = candidates[0];
    const second = candidates[1];
    if (top.bm25 >= FALLBACK_MIN_BM25 && top.matchedTerms.length >= FALLBACK_MIN_TERMS
      && (!second || top.bm25 >= FALLBACK_MARGIN * (second.bm25 || 0))) {
      fallback = { id: top.id, bm25: top.bm25, matchedTerms: top.matchedTerms.length };
    }
  }
  const requested = task.noWorkflow ? [] : explicitIds.length ? explicitIds
    : reused ? previous.selectedIds : selectionMode === 'manual' ? []
      : proposedIds.length ? proposedIds : autoSelection ? [autoSelection.id] : [];
  const effectiveExplicit = reused ? previous.explicitIds : explicitIds;
  const selectedIds = selectedClosure(requested, new Set(effectiveExplicit), byId, excluded, reader);
  const selectionDigest = digestObject({ bindingDigest, selectedIds, explicitIds: effectiveExplicit });
  if (expectedDigest && expectedDigest !== selectionDigest) throw new Error('Task selection is stale; resolve again before loading');
  const resources = load && selectionMode !== 'suggest' ? readSelected(selectedIds, byId, reader) : [];
  const loadedIds = [...new Set(resources.map(resource => resource.id))].sort();
  const reason = task.noWorkflow ? 'no-workflow-needed' : reused ? 'reused-pinned-selection'
    : explicitIds.length ? 'explicit-selection' : autoSelection ? 'auto-selection'
      : proposedIds.length && selectedIds.length ? 'bounded-local-selection'
        : candidates.length ? 'agent-selection-required' : 'no-selection';
  const decision = selectedIds.length ? 'selected' : reason === 'agent-selection-required' ? 'pending' : 'none';
  const receiptValue = { schemaVersion: 'ecc.task-context-receipt.v1', ...taskBinding, bindingDigest,
    selectionDigest, profileId: plan.profileId, selectionMode, target, registryDigest: registry.registryDigest,
    decision, selectedIds, explicitIds: effectiveExplicit, loadedIds,
    resources: resources.map(({ content: _content, ...resource }) => resource) };
  if (autoSelection) receiptValue.autoSelection = autoSelection;
  return { schemaVersion: 'ecc.task-context.v1', profileId: plan.profileId, selectionMode, target,
    reason, reused, selectedIds, loadedIds, candidates, resources, fallback,
    activation: loadedIds.length ? 'context-returned' : 'proposed', nativeInvocation: 'unobserved',
    enforcement: 'prompt-advisory', maxContextBytes: MAX_CONTEXT_BYTES,
    receipt: { ...receiptValue, receiptDigest: digestObject(receiptValue) },
    limitations: ['Context returned by this command is data for the calling agent; native invocation and execution are unobserved.',
      'Auto mode admits a ranked skill only on calibrated unambiguous evidence or a single cited skill name; ambiguous routing still requires an explicit ID or an admitted agent proposal.',
      'Selection grants no tools, hooks, network access, installation or persistent configuration changes.',
      'The byte cap is an output bound, not a measured native token budget. Declared workflow dependencies remain incomplete.'] };
}

/** After a bounded proposal declines, admit the tier-2 fallback candidate so a
 * task with decent local evidence never runs with zero context. Returns the
 * original selection when no fallback exists or it cannot be admitted. */
function resolveDeclinedFallback(options, selection) {
  if (!selection || selection.reason !== 'agent-selection-required' || !selection.fallback) return selection;
  const resolved = resolveTaskContext({ ...options, task: { ...options.task, proposedIds: [selection.fallback.id] } });
  if (!resolved.selectedIds.length) return selection;
  const receiptValue = { ...resolved.receipt, fallbackApplied: true };
  delete receiptValue.receiptDigest;
  return { ...resolved, reason: 'auto-selection-fallback',
    receipt: { ...receiptValue, receiptDigest: digestObject(receiptValue) } };
}

module.exports = { resolveTaskContext, resolveDeclinedFallback };
