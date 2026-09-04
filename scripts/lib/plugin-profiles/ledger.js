/**
 * The token ledger: what a carrier costs in per-session listing context,
 * measured by a named, versioned method and gated against a declared budget.
 *
 * The listing payload is the text Claude Code injects for a plugin's
 * surface — one `name: description` line per installed skill, agent, and
 * command. The ledger measures exactly that string, records its sha256, and
 * says which measurer produced the number.
 */

'use strict';

const fs = require('fs');
const path = require('path');

const {
  CATALOG_SKILL_ID,
  LISTING_PAYLOAD_FORMAT,
  CONSERVATIVE_CHARS_PER_TOKEN,
  DEFAULT_PROVIDER_MODEL,
} = require('./constants');
const { sha256, flattenLine } = require('./fs-utils');
const { parseFrontmatter } = require('./frontmatter');

// The default token measurer.
//
// Claude's tokenizer is not public and the CLI is network-free by default, so
// the default number is an estimate. It is deliberately CONSERVATIVE: at
// 3.2 characters per token it over-counts relative to the ~4 chars/token
// rule of thumb, which is what makes the verdict safe in one direction.
// "Under budget" from the estimate can be trusted. "Over budget" may be a
// false positive, and `--measure provider` is how you clear it.
//
// The ratio is a placeholder until scripts/ci/calibrate-token-estimate.js is
// run against a provider; see docs/PLUGIN-PROFILES.md "Ledger".
const DEFAULT_TOKEN_MEASURER = Object.freeze({
  method: 'chars-per-token-conservative',
  version: '1',
  measure: text => Math.ceil(String(text || '').length / CONSERVATIVE_CHARS_PER_TOKEN),
});

/**
 * Build a provider-backed measurer that calls Anthropic's count_tokens
 * endpoint on the exact listing payload.
 *
 * Refuses without an API key rather than falling back to the estimate: a
 * caller who asked for a measurement must never be handed an estimate
 * wearing the measurement's label.
 *
 * @param {object} [options] Options.
 * @param {string} [options.model] Model id (default: DEFAULT_PROVIDER_MODEL).
 * @param {string} [options.apiKey] API key (default: ANTHROPIC_API_KEY).
 * @param {Function} [options.fetchImpl] Injected fetch, for tests.
 * @returns {{method: string, version: string, model: string, measure: Function}}
 */
function createProviderMeasurer(options = {}) {
  const apiKey = options.apiKey || process.env.ANTHROPIC_API_KEY;
  if (!apiKey) {
    throw new Error('--measure provider requires an Anthropic API key. Set ANTHROPIC_API_KEY, '
      + 'or use --measure estimate to keep the offline conservative estimate.');
  }
  const model = options.model || DEFAULT_PROVIDER_MODEL;
  const fetchImpl = options.fetchImpl || globalThis.fetch;
  if (typeof fetchImpl !== 'function') {
    throw new Error('--measure provider requires a fetch implementation (Node 18+).');
  }

  return {
    method: 'anthropic-count-tokens',
    version: '1',
    model,
    measure: text => measureWithProvider(String(text || ''), { apiKey, model, fetchImpl }),
  };
}

/**
 * Call count_tokens synchronously from the caller's perspective.
 *
 * measureContextLedger is synchronous everywhere else, so the request is made
 * in a short-lived child process rather than turning the whole ledger API
 * async for one optional path.
 *
 * @param {string} text Payload to measure.
 * @param {object} context apiKey, model, and fetch implementation.
 * @returns {number} Token count reported by the provider.
 */
function measureWithProvider(text, context) {
  const { spawnSync } = require('child_process');
  const runner = require.resolve('./provider-count-tokens.js');
  const result = spawnSync(process.execPath, [runner], {
    input: JSON.stringify({ text, model: context.model }),
    encoding: 'utf8',
    timeout: 30000,
    env: { ...process.env, ANTHROPIC_API_KEY: context.apiKey },
  });
  if (result.error) {
    throw new Error(`provider token count failed: ${result.error.message}`);
  }
  if (result.status !== 0) {
    throw new Error(`provider token count failed: ${String(result.stderr || '').trim() || `exit ${result.status}`}`);
  }
  const parsed = JSON.parse(result.stdout);
  if (!Number.isInteger(parsed.inputTokens)) {
    throw new Error('provider token count returned no input_tokens');
  }
  return parsed.inputTokens;
}

/**
 * Resolve a `--measure` selection to a measurer.
 *
 * @param {string} method `estimate` or `provider`.
 * @param {object} [options] Passed through to createProviderMeasurer.
 * @returns {object} Measurer.
 */
function resolveMeasurer(method, options = {}) {
  if (method === undefined || method === null || method === 'estimate') {
    return DEFAULT_TOKEN_MEASURER;
  }
  if (method === 'provider') {
    return createProviderMeasurer(options);
  }
  throw new Error(`--measure expects estimate or provider, got "${method}"`);
}

/**
 * The frontmatter written for the generated catalog skill.
 *
 * @returns {{name: string, description: string}} Frontmatter fields.
 */
function catalogSkillFrontmatter() {
  return {
    name: CATALOG_SKILL_ID,
    description: 'Index of the full ECC skill catalog carried by this slim profile plugin. '
      + 'Use when a task needs an ECC skill that is not installed in this profile: find it in the table, '
      + 'then read its SKILL.md from the listed path inside this plugin.',
  };
}

/**
 * Estimate tokens with the default measurer.
 *
 * @param {string} text Text to measure.
 * @returns {number} Estimated tokens.
 */
function estimateTokens(text) {
  return DEFAULT_TOKEN_MEASURER.measure(text);
}

/**
 * Enumerate the listing entries Claude Code loads for a plan: one
 * {surface, id, name, description} per installed skill, agent, and command.
 *
 * @param {object} plan Resolved plan.
 * @param {boolean} [includeCatalogSkill=true] Whether the catalog skill is emitted.
 * @returns {Array<{surface: string, id: string, name: string, description: string}>}
 */
function buildListingEntries(plan, includeCatalogSkill = true) {
  const { repoRoot } = plan;
  const entries = [];
  const push = (surface, id, filePath) => {
    if (!fs.existsSync(filePath)) {
      return;
    }
    const { name, description } = parseFrontmatter(fs.readFileSync(filePath, 'utf8'));
    entries.push({ surface, id, name: name || id, description });
  };

  for (const skillId of plan.skills) {
    push('skill', skillId, path.join(repoRoot, 'skills', skillId, 'SKILL.md'));
  }
  if (includeCatalogSkill) {
    const { name, description } = catalogSkillFrontmatter();
    entries.push({ surface: 'skill', id: CATALOG_SKILL_ID, name, description });
  }
  for (const agentFile of plan.agents) {
    push('agent', agentFile.replace(/\.md$/, ''), path.join(repoRoot, 'agents', agentFile));
  }
  for (const commandFile of plan.commands) {
    push('command', commandFile.replace(/\.md$/, ''), path.join(repoRoot, 'commands', commandFile));
  }
  return entries;
}

/**
 * Render listing entries in the shape the harness lists them.
 *
 * @param {Array<object>} entries Listing entries.
 * @returns {string} Payload text.
 */
function buildListingPayload(entries) {
  return entries.map(entry => `${entry.name}: ${flattenLine(entry.description)}`).join('\n');
}

/**
 * Measure the per-session listing cost of a plan against its budget.
 *
 * @param {object} plan Resolved plan.
 * @param {object} [options] Measurement options.
 * @param {boolean} [options.includeCatalogSkill=true] Count the catalog skill.
 * @param {{method: string, version: string, measure: Function}} [options.measurer] Token measurer.
 * @param {number} [options.budget] Budget override (default: plan.contextBudgetTokens).
 * @returns {object} Ledger.
 */
function measureContextLedger(plan, options = {}) {
  const measurer = options.measurer || DEFAULT_TOKEN_MEASURER;
  const includeCatalogSkill = options.includeCatalogSkill !== false;
  const entries = buildListingEntries(plan, includeCatalogSkill);
  const payload = buildListingPayload(entries);
  const budget = Number.isFinite(options.budget) ? options.budget : plan.contextBudgetTokens;
  const tokens = measurer.measure(payload);

  return {
    method: measurer.method,
    methodVersion: measurer.version,
    ...(measurer.model ? { model: measurer.model } : {}),
    payloadFormat: LISTING_PAYLOAD_FORMAT,
    payloadSha256: sha256(payload),
    entries: {
      skills: entries.filter(entry => entry.surface === 'skill').length,
      agents: entries.filter(entry => entry.surface === 'agent').length,
      commands: entries.filter(entry => entry.surface === 'command').length,
    },
    chars: payload.length,
    tokens,
    budget,
    withinBudget: tokens <= budget,
    measuredAt: new Date().toISOString(),
  };
}

/**
 * Estimated listing tokens for a plan (default measurer, catalog included).
 *
 * @param {object} plan Resolved plan.
 * @returns {number} Estimated tokens.
 */
function estimatePlanCatalogTokens(plan) {
  return measureContextLedger(plan).tokens;
}

module.exports = {
  DEFAULT_TOKEN_MEASURER,
  createProviderMeasurer,
  resolveMeasurer,
  catalogSkillFrontmatter,
  estimateTokens,
  buildListingEntries,
  buildListingPayload,
  measureContextLedger,
  estimatePlanCatalogTokens,
};
