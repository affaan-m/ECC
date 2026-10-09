/**
 * Suggestion adapter for the opt-in UserPromptSubmit skill router
 * (proposal-only; see docs/SKILL-ROUTER.md).
 *
 * Owns no catalog, cache, profile, or receipt. Every input comes from the
 * canonical context-profile surfaces:
 *
 *   - the skill inventory is the canonical registry
 *     (scripts/lib/context-pack-registry.js, skill-registry@1);
 *   - the profile is a versioned context profile (lean@1 or full@1) loaded
 *     and validated by scripts/lib/context-profiles.js;
 *   - ranking and admission are resolveTaskContext in `suggest` mode
 *     (scripts/lib/context-selection.js), which returns ranked candidates and
 *     never loads, selects, or activates a skill.
 *
 * This module only shapes a prompt into the resolver's task input and trims
 * the resolver's candidates to the suggestion cap.
 */

'use strict';

const { resolveTaskContext } = require('./context-selection');

const DEFAULT_PROFILE_ID = 'lean@1';
const MAX_SUGGESTIONS = 3;
const MAX_QUERY_BYTES = 8192;
const SESSION_ID_PATTERN = /^[a-zA-Z0-9][a-zA-Z0-9_.:-]{0,127}$/;
const FALLBACK_SESSION_ID = 'skill-router';

/**
 * Cut `text` to at most `maxBytes` of UTF-8 without splitting a character.
 *
 * @param {string} text Text to bound.
 * @param {number} maxBytes Byte ceiling.
 * @returns {string} The bounded text.
 */
function truncateUtf8(text, maxBytes) {
  const bytes = Buffer.from(text, 'utf8');
  if (bytes.length <= maxBytes) {
    return text;
  }
  // A cut mid-sequence decodes to U+FFFD; dropping it keeps the result
  // within the ceiling and free of a replacement character.
  return bytes.subarray(0, maxBytes).toString('utf8').replace(/�+$/, '');
}

/**
 * Shape a prompt into the resolver's task input. The resolver validates the
 * binding fields strictly, so an absent or malformed session id falls back
 * to a fixed one rather than failing the suggestion.
 *
 * @param {string} prompt Raw prompt text.
 * @param {string} [sessionId] Harness session id, when known.
 * @returns {object} A task accepted by resolveTaskContext.
 */
function taskFor(prompt, sessionId) {
  return {
    sessionId: typeof sessionId === 'string' && SESSION_ID_PATTERN.test(sessionId) ? sessionId : FALLBACK_SESSION_ID,
    taskId: 'user-prompt',
    revision: 1,
    phase: 'user-prompt',
    query: truncateUtf8(String(prompt || ''), MAX_QUERY_BYTES),
  };
}

/**
 * Rank skills for a prompt through the canonical resolver in `suggest` mode.
 *
 * @param {string} prompt Raw prompt text.
 * @param {object} [options] Options.
 * @param {string} [options.repoRoot] ECC root holding the canonical sources.
 * @param {string} [options.profileId] Context profile id or alias (lean@1, full@1, lean, full).
 * @param {string} [options.sessionId] Harness session id.
 * @param {number} [options.maxResults] Suggestion cap.
 * @param {object} [options.registry] A loadContextRegistry() result to reuse.
 * @returns {{profileId: string, reason: string, suggestions: Array<{id: string, description: string, score: number}>}}
 */
function suggestSkills(prompt, options = {}) {
  const selection = resolveTaskContext({
    ...(options.repoRoot ? { repoRoot: options.repoRoot } : {}),
    ...(options.registry ? { registry: options.registry } : {}),
    task: taskFor(prompt, options.sessionId),
    profileId: options.profileId || DEFAULT_PROFILE_ID,
    selectionMode: 'suggest',
    target: 'claude',
  });
  return {
    profileId: selection.profileId,
    reason: selection.reason,
    suggestions: selection.candidates
      .slice(0, options.maxResults ?? MAX_SUGGESTIONS)
      .map(candidate => ({ id: candidate.id, description: candidate.description, score: candidate.score })),
  };
}

module.exports = {
  DEFAULT_PROFILE_ID,
  MAX_QUERY_BYTES,
  MAX_SUGGESTIONS,
  suggestSkills,
  taskFor,
  truncateUtf8,
};
