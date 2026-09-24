/**
 * Instinct relevance ranking for SessionStart.
 *
 * At SessionStart there is no user task yet, so "relevance" is location/stack
 * relevance: instincts scoped to the current project, or whose domain/trigger
 * matches the detected stack, get a small additive boost on top of their
 * confidence when ranking which instincts to inject. The confidence >=
 * threshold floor and the injection cap are enforced by the caller; this
 * module only computes the additive boost and the stack keyword set. When
 * nothing is project-scoped and no stack is detected, every boost is 0 and the
 * ranking degrades to confidence-only (unchanged behaviour).
 *
 * Resolves part (b) of:
 * https://github.com/affaan-m/everything-claude-code/issues/2371
 */

const fs = require('fs');
const path = require('path');
const { detectProjectType } = require('./project-detect');

// Additive ranking boosts. These are intentionally NOT env-configurable: part
// (b) of the issue asks for relevance ranking, not more tunable knobs (part (a)
// already made the injection count + confidence threshold configurable). The
// values are chosen so a project-scoped 0.7 instinct (0.7 + 0.25 = 0.95) can
// surface above an unrelated global 0.9, and a stack-matching 0.75 instinct
// (0.75 + 0.2 = 0.95) can surface above an unrelated 0.9.
const DEFAULT_PROJECT_SCOPE_BOOST = 0.25;
const DEFAULT_STACK_MATCH_BOOST = 0.2;

/**
 * Whether a file with any of the given extensions exists directly in the root
 * (non-recursive, top-level only — kept cheap for a blocking SessionStart hook).
 * @param {string} root - Project root directory.
 * @param {string[]} extensions - Extensions to look for (e.g. ['.tf']).
 * @returns {boolean}
 */
function hasFileWithExtension(root, extensions) {
  try {
    return fs.readdirSync(root, { withFileTypes: true }).some(
      (entry) => entry.isFile() && extensions.includes(path.extname(entry.name))
    );
  } catch {
    return false;
  }
}

/**
 * Whether a named file exists directly in the root.
 * @param {string} root - Project root directory.
 * @param {string} name - File name relative to root.
 * @returns {boolean}
 */
function fileExists(root, name) {
  try {
    return fs.existsSync(path.join(root, name));
  } catch {
    return false;
  }
}

/**
 * Resolve whether relevance ranking is enabled. Default on; opt out by setting
 * `ECC_INSTINCT_RELEVANCE_RANKING` to `off`, `false`, `0`, or `no`
 * (case-insensitive). Any other value (including unset) keeps ranking on.
 * @returns {boolean}
 */
function isRelevanceRankingEnabled() {
  const raw = process.env.ECC_INSTINCT_RELEVANCE_RANKING;
  if (raw === undefined || raw === null || raw === '') return true;
  const normalized = String(raw).trim().toLowerCase();
  return !['off', 'false', '0', 'no'].includes(normalized);
}

/**
 * Cheap, non-recursive stack-keyword detection for the project root. Reuses
 * detectProjectType (languages + frameworks) and layers the extra IaC/data
 * markers issue #2371 calls out that detectProjectType does not cover
 * (`*.tf` / `*.tfvars` -> terraform, `dbt_project.yml` -> dbt).
 * @param {string} [projectRoot] - Defaults to process.cwd().
 * @param {{languages?: string[], frameworks?: string[]}} [projectInfo] -
 *   Optional precomputed detectProjectType() result, to avoid a second pass.
 * @returns {Set<string>} Lowercase keyword set (may be empty).
 */
function detectStackKeywords(projectRoot, projectInfo) {
  const root = projectRoot || process.cwd();
  const keywords = new Set();

  let info = projectInfo;
  if (!info) {
    try {
      info = detectProjectType(root);
    } catch {
      info = { languages: [], frameworks: [] };
    }
  }
  for (const language of info.languages || []) keywords.add(String(language).toLowerCase());
  for (const framework of info.frameworks || []) keywords.add(String(framework).toLowerCase());

  if (hasFileWithExtension(root, ['.tf', '.tfvars'])) keywords.add('terraform');
  if (fileExists(root, 'dbt_project.yml')) keywords.add('dbt');

  return keywords;
}

/**
 * Tokenize a free-text field into lowercase word tokens (split on
 * non-alphanumerics). Token-set matching avoids substring false positives such
 * as the keyword `go` matching the word `good`.
 * @param {string} value
 * @returns {string[]}
 */
function tokenize(value) {
  return String(value || '')
    .toLowerCase()
    .split(/[^a-z0-9]+/)
    .filter(Boolean);
}

/**
 * Whether an instinct's domain/trigger/stack fields intersect the stack
 * keywords by whole-token match.
 * @param {object} instinct - Parsed instinct (frontmatter fields as properties).
 * @param {Set<string>} stackKeywords
 * @returns {boolean}
 */
function instinctMatchesStack(instinct, stackKeywords) {
  if (!instinct || !stackKeywords || stackKeywords.size === 0) return false;
  const tokens = new Set([
    ...tokenize(instinct.domain),
    ...tokenize(instinct.trigger),
    ...tokenize(instinct.stack),
  ]);
  for (const keyword of stackKeywords) {
    if (tokens.has(keyword)) return true;
  }
  return false;
}

/**
 * Additive relevance boost for ranking. Deterministic and pure. A
 * project-scoped instinct (location-relevant by construction) and a
 * stack-matching instinct each contribute their boost; both can apply.
 * @param {object} instinct - Must carry `_scopeLabel` ('project'|'global') and
 *   optional `domain`/`trigger`/`stack` fields.
 * @param {Set<string>} stackKeywords
 * @param {{projectBoost?: number, stackBoost?: number}} [opts]
 * @returns {number}
 */
function computeRelevanceBoost(instinct, stackKeywords, opts) {
  const options = opts || {};
  const projectBoost = Number.isFinite(options.projectBoost)
    ? options.projectBoost
    : DEFAULT_PROJECT_SCOPE_BOOST;
  const stackBoost = Number.isFinite(options.stackBoost)
    ? options.stackBoost
    : DEFAULT_STACK_MATCH_BOOST;

  let boost = 0;
  if (instinct && instinct._scopeLabel === 'project') boost += projectBoost;
  if (instinctMatchesStack(instinct, stackKeywords)) boost += stackBoost;
  return boost;
}

module.exports = {
  DEFAULT_PROJECT_SCOPE_BOOST,
  DEFAULT_STACK_MATCH_BOOST,
  isRelevanceRankingEnabled,
  detectStackKeywords,
  instinctMatchesStack,
  computeRelevanceBoost,
  // Exported for testing.
  tokenize,
};
