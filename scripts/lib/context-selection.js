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
// Tier-2 fallback: when Auto defers to a provider proposal and a NON-EMPTY
// proposal admits nothing, admit the top candidate anyway if it clears this
// lower bar. An explicitly empty proposal is a decline and is honored — the
// task runs without injected context. Below the bar, no fallback exists —
// running without context is safer than loading a likely-wrong skill.
const FALLBACK_MIN_BM25 = 12;
const FALLBACK_MIN_TERMS = 2;
const FALLBACK_MARGIN = 1.1;
// v4: an explicit empty proposal (decline) is honored; the tier-2 fallback no
// longer overrides declines at the launch/selection call sites.
// v5: indirect name citations cannot bypass review through exact or scored admission.
// v6: ordered directives and singular named references share the same admission guard.
// v7: independent directives scope negation and imperatives allow question punctuation.
// v8: only recognized request/rejection scopes can authorize coordinated directives.
// v9: neutral task preambles do not suppress a later explicit skill request.
// v10: illustrative instructions do not supply or withdraw a direct request.
const ROUTING_POLICY_VERSION = 10;
const TASK_KEYS = new Set(['sessionId', 'taskId', 'revision', 'phase', 'query', 'explicitIds', 'proposedIds', 'noWorkflow']);

const DIRECTIVE_VERB = /\b(use|apply|invoke|run|follow|load)\s+(the\s+)?/i;
const DIRECTIVE_REQUEST = /^(?:please )?(?:(?:can|could|would|will) you (?:please )?|do )?(?:use|apply|invoke|run|follow|load)\b/;
const DIRECTIVE_REJECTION = /^(?:please )?(?:(?:(?:do )?not|never) (?:use|apply|invoke|run|follow|load)\b|avoid\b)/;
const DIRECTIVE_NAME_PREFIX = new RegExp(DIRECTIVE_REQUEST.source + '\\s+(?:the\\s+)?(?:skill\\s*)?$');
const QUESTION_START = /^(?!do not\b)(can|could|would|should|shall|will|may|might|must|ought|do|does|did|is|are|why|how|what|when|where|which)\b/;
const REPORTED_INSTRUCTION = /\b(say|says|said|reads|told|mentions?|quoted?|document|states?|stated|recommends?|recommended|asserts?|asserted)\b/;
const EXAMPLE_PREFIX = /^(?:for (?:example|instance)|as an example|to illustrate)\b/;
// Subject-led statements may describe someone else's instructions or intentions.
const SUBJECT_PREFIX = /^(?:the|a|an|i|you|he|she|it|we|they|my|your|his|her|its|our|their|this|that|these|those)\b/;
// Rejections keep their whole list until another instruction/question begins.
const INSTRUCTION_BOUNDARY = /(?:,\s*(?:(?:and|but)\s+)?|\s+(?:and|but)\s+)(?=(?:please\s+)?(?:do\s+(?:not\s+)?|not\s+|never\s+)?(?:use|apply|invoke|run|follow|load)\b|(?:can|could|would|should|shall|will|may|might|must|ought|do|does|did|is|are|why|how|what|when|where|which)\b)/i;
// Admission additionally checks intervening scopes, including unknown wording.
const ADMISSION_BOUNDARY = /(?:,\s*(?:(?:and|but)\s+)?|\s+(?:and|but)\s+)(?=\S)/i;
/** Normalize citation names while preserving contracted negation as a separate word.
 * @param {string} text Raw query text or a registry alias.
 * @returns {string} Lowercase alphanumeric words with negation preserved.
 */
const normalizedQueryName = text => text.replace(/n['\u2019]t\b/gi, ' not')
  .replace(/([a-z0-9])([A-Z])/g, '$1 $2').replace(/_/g, ' ')
  .toLowerCase().replace(/[^a-z0-9]+/g, ' ').trim();

/** Return canonical/native aliases plus conservative singular forms. Singular
 * multiword aliases only guard indirect references; they never create exact admission.
 * @param {object} candidate Ranked skill candidate with its canonical ID and exact alias.
 * @param {string} nativeName Registry name that may be absent from exact retrieval.
 * @returns {Array<{name: string, exact: boolean}>} Normalized names and admission eligibility.
 */
function citationAliases(candidate, nativeName) {
  const names = [...new Set([candidate.exactAlias, candidate.id.slice('skill:'.length), nativeName]
    .filter(Boolean).map(normalizedQueryName).filter(Boolean))];
  return names.flatMap(name => [{ name, exact: true },
    ...(/\s\w+[^s]s$/.test(name) ? [{ name: name.slice(0, -1), exact: false }] : [])]);
}

/** Classify a retrieval candidate's references in query order. Genuine later
 * directives/rejections replace earlier instructions; questions, quotations and
 * reported speech do not withdraw a directive. Returns directive, indirect or none.
 * @param {object} candidate Ranked skill candidate with its canonical ID and exact alias.
 * @param {string} query Task text to classify without loading skill contents.
 * @param {string} nativeName Registry name, including aliases absent from exact retrieval.
 * @returns {'directive'|'indirect'|'none'} Admission evidence for this skill only.
 */
function citationFor(candidate, query, nativeName) {
  const aliases = citationAliases(candidate, nativeName);
  let citation = 'none';
  // Mask quoted instructions before splitting clauses so punctuation inside a
  // quotation cannot look like a separate instruction. Quoted names remain usable.
  const unquoted = query.replace(/"[^"]*"|\u201c[^\u201d]*\u201d|(?:^|[\s(:])'[^']*'|\u2018[^\u2019]*\u2019|\x60[^\x60]*\x60/g, part => {
    const text = normalizedQueryName(part);
    if (!DIRECTIVE_VERB.test(text)) return part;
    if (aliases.some(({ name }) => new RegExp('\\b' + name + '\\b').test(text))) citation = 'indirect';
    return part.replace(/[^.!?;\n]/g, ' ');
  });
  // Keep the illustrative abbreviation together when its periods would split clauses.
  const expanded = unquoted.replace(/\be\.g\.(?=\s|[,;:!?]|$)/gi, 'for example');
  for (const clause of expanded.match(/[^.!?;\n]+[.!?;\n]*/g) || []) {
    // Keep comma boundaries for directive scope without changing alias normalization.
    const text = clause.split(',').map(normalizedQueryName).join(', ');
    const mentions = aliases.flatMap(({ name, exact }) => [...text.matchAll(new RegExp('\\b' + name + '\\b', 'g'))]
      .map(mention => ({ index: mention.index, exact }))).sort((a, b) => a.index - b.index);
    for (const mention of mentions) {
      const prefix = text.slice(0, mention.index);
      const scopes = prefix.split(ADMISSION_BOUNDARY);
      const instructionPrefix = prefix.split(INSTRUCTION_BOUNDARY).at(-1);
      const example = scopes.some(scope => EXAMPLE_PREFIX.test(scope));
      // A task preamble such as "fix the bug" does not change a later request.
      // Only preceding scopes may be neutral: an embedded instruction, question,
      // or subject-led statement still needs review. The final scope must remain
      // a direct request; neutral text never supplies admission evidence itself.
      const instruction = scopes.every((scope, index) => DIRECTIVE_REQUEST.test(scope) || DIRECTIVE_REJECTION.test(scope)
        || (index < scopes.length - 1 && !DIRECTIVE_VERB.test(scope)
          && !QUESTION_START.test(scope) && !REPORTED_INSTRUCTION.test(scope) && !SUBJECT_PREFIX.test(scope)));
      const question = (!DIRECTIVE_REQUEST.test(text) && QUESTION_START.test(text))
        || (!DIRECTIVE_REQUEST.test(instructionPrefix)
          && (QUESTION_START.test(instructionPrefix) || clause.includes('?')));
      if (example || question || REPORTED_INSTRUCTION.test(prefix) || /^\s*["'\u201c\u2018\x60]/.test(clause)) {
        if (citation === 'none') citation = 'indirect';
      } else if (/\b(do not|never|no|not|avoid)\b/.test(instructionPrefix)) {
        citation = 'indirect';
      } else if (!instruction) {
        if (citation === 'none') citation = 'indirect';
      } else if (mention.exact && candidate.exact
        && DIRECTIVE_NAME_PREFIX.test(scopes.at(-1))) {
        citation = 'directive';
      }
    }
  }
  return citation;
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

/** Resolve task-scoped skill context without invoking native skills or changing permissions.
 * @param {object} [options] Repository, task, profile, and selection constraints.
 * @param {object} options.task Task identity, query, and explicit or proposed skill IDs.
 * @param {boolean} [options.load=false] Include verified resource contents in the result.
 * @param {object|null} [options.previous=null] Receipt reusable only when its binding matches.
 * @returns {object} Selection decision, candidates, verified resources, and a bound receipt.
 */
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
  const bindingDigest = digestObject({ ...taskBinding, planDigest: plan.planDigest,
    routingPolicyVersion: ROUTING_POLICY_VERSION, triggersDigest: digestObject(triggers),
    queryDigest: digestObject(task.query || '') });
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
  const citations = new Map(candidates.map(candidate => [candidate.id, citationFor(candidate, task.query || '', byId.get(candidate.id).name)]));
  const exactAnchors = candidates.filter(candidate => citations.get(candidate.id) === 'directive');
  let autoSelection = null;
  if (!task.noWorkflow && selectionMode === 'auto' && !reused && !explicitIds.length && !proposedIds.length && candidates.length) {
    if (exactAnchors.length === 1) {
      autoSelection = { id: exactAnchors[0].id, bm25: exactAnchors[0].bm25,
        matchedTerms: exactAnchors[0].matchedTerms.length, exact: true };
    } else if (!exactAnchors.length) {
      const top = candidates[0];
      const second = candidates[1];
      if (citations.get(top.id) !== 'indirect' && top.bm25 >= AUTO_ADMIT_MIN_BM25 && top.matchedTerms.length >= AUTO_ADMIT_MIN_TERMS
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
    if (citations.get(top.id) !== 'indirect' && top.bm25 >= FALLBACK_MIN_BM25 && top.matchedTerms.length >= FALLBACK_MIN_TERMS
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

/** After a bounded proposal admitted nothing despite proposing a candidate,
 * admit the tier-2 fallback candidate so a task with decent local evidence
 * never runs with zero context. Callers must NOT invoke this for an explicit
 * decline (an empty proposal is honored as-is). Returns the original
 * selection when no fallback exists or it cannot be admitted. */
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
