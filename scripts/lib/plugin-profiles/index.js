/**
 * Profile plugin ("carrier") generation for the Claude Code plugin surface.
 *
 * The marketplace plugin path loads the frontmatter of every skill, agent,
 * and command into session context and ignores the selective-install
 * manifests entirely. This library materializes an install selection as a
 * standalone slim plugin directory — a carrier — that a project can enable
 * instead of the full `ecc` plugin.
 *
 * Design rules (see docs/PLUGIN-PROFILES.md):
 *
 * - Context and capabilities are separate decisions. A narrow install-profile
 *   projection never implies the hook runtime; hooks need an explicit
 *   `hooks` decision, recorded in the receipt.
 * - Generation fails closed. Every shipped command's script dependency
 *   closure is resolved; an unresolved static dependency aborts generation
 *   and the staged tree is re-verified before it is swapped into place.
 * - The carrier is self-contained. On-demand skill content is copied into
 *   the carrier and content-addressed; no absolute source path is written.
 * - Generation is staged, bounded, and receipted. Output is written to a
 *   staging directory, swapped atomically, and described by
 *   `ecc-profile.json`, which doubles as the ownership marker.
 * - The token ledger is labelled. The catalog cost is measured with a named
 *   method and version and gated against a declared budget.
 *
 * Module layout:
 *
 *   constants.js      shared values, so no module needs a cycle to reach them
 *   fs-utils.js       path, hash, listing, and symlink-sweep helpers
 *   frontmatter.js    the two catalog fields, without a YAML dependency
 *   require-graph.js  static require()/import() extraction and closure walk
 *   plan.js           surface expansion, dependency cover, refusals
 *   ledger.js         listing payload, measurers, budget verdict
 *   carrier.js        copy ops, staging, verification, swap, receipt
 *   marketplace.js    the local marketplace projection
 *
 * This file is the only public surface; nothing outside `plugin-profiles/`
 * should reach into the modules directly.
 */

'use strict';

const constants = require('./constants');
const fsUtils = require('./fs-utils');
const frontmatter = require('./frontmatter');
const requireGraph = require('./require-graph');
const plan = require('./plan');
const ledger = require('./ledger');
const carrier = require('./carrier');
const marketplace = require('./marketplace');

module.exports = {
  // constants
  CATALOG_SKILL_ID: constants.CATALOG_SKILL_ID,
  ON_DEMAND_DIR: constants.ON_DEMAND_DIR,
  DEFAULT_MARKETPLACE_NAME: constants.DEFAULT_MARKETPLACE_NAME,
  PROFILE_METADATA_FILE: constants.PROFILE_METADATA_FILE,
  PROFILE_GENERATOR_ID: constants.PROFILE_GENERATOR_ID,
  RECEIPT_SCHEMA_VERSION: constants.RECEIPT_SCHEMA_VERSION,
  HOOK_PROFILES: constants.HOOK_PROFILES,
  DEFAULT_CONTEXT_BUDGET_TOKENS: constants.DEFAULT_CONTEXT_BUDGET_TOKENS,
  LISTING_PAYLOAD_FORMAT: constants.LISTING_PAYLOAD_FORMAT,
  COMMAND_RUNTIME_DATA: constants.COMMAND_RUNTIME_DATA,

  // shared helpers
  flattenLine: fsUtils.flattenLine,
  parseFrontmatter: frontmatter.parseFrontmatter,

  // require graph
  extractRequireSpecifiers: requireGraph.extractRequireSpecifiers,
  resolveScriptClosure: requireGraph.resolveScriptClosure,

  // plan
  classifyModulePath: plan.classifyModulePath,
  buildHookDecisionMessage: plan.buildHookDecisionMessage,
  expandSurface: plan.expandSurface,
  coverDependencies: plan.coverDependencies,
  collectBlockers: plan.collectBlockers,
  resolveCommandRuntimeClosure: plan.resolveCommandRuntimeClosure,
  resolvePluginProfilePlan: plan.resolvePluginProfilePlan,

  // ledger
  DEFAULT_TOKEN_MEASURER: ledger.DEFAULT_TOKEN_MEASURER,
  estimateTokens: ledger.estimateTokens,
  buildListingEntries: ledger.buildListingEntries,
  buildListingPayload: ledger.buildListingPayload,
  measureContextLedger: ledger.measureContextLedger,
  estimatePlanCatalogTokens: ledger.estimatePlanCatalogTokens,

  // carrier
  computeContextDigest: carrier.computeContextDigest,
  computeTreeDigest: carrier.computeTreeDigest,
  readProfileReceipt: carrier.readProfileReceipt,
  isGeneratedProfilePlugin: carrier.isGeneratedProfilePlugin,
  collectCopyOperations: carrier.collectCopyOperations,
  verifyStagedRuntime: carrier.verifyStagedRuntime,
  verifyStagedCarrier: carrier.verifyStagedCarrier,
  buildStagingTree: carrier.buildStagingTree,
  buildReceipt: carrier.buildReceipt,
  writeReceipt: carrier.writeReceipt,
  swapIntoPlace: carrier.swapIntoPlace,
  previewProfilePlugin: carrier.previewProfilePlugin,
  generateProfilePlugin: carrier.generateProfilePlugin,

  // marketplace
  writeMarketplaceManifest: marketplace.writeMarketplaceManifest,
};
