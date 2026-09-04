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

const { CATALOG_SKILL_ID, LISTING_PAYLOAD_FORMAT } = require('./constants');
const { flattenLine } = require('./fs-utils');
const { parseFrontmatter } = require('./frontmatter');

// The default token measurer. Claude's tokenizer is not public, so this is
// an estimate and is labelled as one in every ledger. Callers may inject a
// provider-backed `measureTokens` to replace it; the ledger records which
// method produced the number.
const DEFAULT_TOKEN_MEASURER = Object.freeze({
  method: 'chars-per-token-estimate',
  version: '1',
  measure: text => Math.ceil(String(text || '').length / 4),
});

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
    payloadFormat: LISTING_PAYLOAD_FORMAT,
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
  catalogSkillFrontmatter,
  estimateTokens,
  buildListingEntries,
  buildListingPayload,
  measureContextLedger,
  estimatePlanCatalogTokens,
};
