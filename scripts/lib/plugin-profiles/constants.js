/**
 * Shared constants for profile plugin ("carrier") generation.
 *
 * This module holds only values, so every other module in
 * `scripts/lib/plugin-profiles/` can depend on it without creating a cycle.
 */

'use strict';

const CATALOG_SKILL_ID = 'ecc-catalog';
const ON_DEMAND_DIR = 'on-demand';
const PLUGIN_NAME_PATTERN = /^[a-z0-9][a-z0-9-]*$/;
const DEFAULT_MARKETPLACE_NAME = 'ecc-profiles';
const PROFILE_METADATA_FILE = 'ecc-profile.json';
const PROFILE_GENERATOR_ID = 'everything-claude-code';
const RECEIPT_SCHEMA_VERSION = 1;
const HOOK_PROFILES = Object.freeze(['off', 'minimal', 'standard', 'strict']);
const DEFAULT_CONTEXT_BUDGET_TOKENS = 8000;

const LISTING_PAYLOAD_FORMAT = 'name-colon-description-lines@1';

// Characters per token used by the default, offline measurer. Lower than the
// ~4 rule of thumb on purpose: over-counting makes an "under budget" verdict
// safe to act on. PLACEHOLDER until scripts/ci/calibrate-token-estimate.js is
// run against a provider and the measured 95th-percentile ratio is recorded
// in docs/PLUGIN-PROFILES.md.
const CONSERVATIVE_CHARS_PER_TOKEN = 3.2;

// Model used by `--measure provider` when none is given.
const DEFAULT_PROVIDER_MODEL = 'claude-sonnet-4-5';

// Non-code inputs a command's script reads at runtime. Code dependencies
// are discovered by scanning the command body for `scripts/*.js` references
// and walking their require() graph; only data directories need listing.
const COMMAND_RUNTIME_DATA = Object.freeze({
  'plugin-profiles.md': ['manifests'],
  'project-init.md': ['manifests'],
});

module.exports = {
  CATALOG_SKILL_ID,
  ON_DEMAND_DIR,
  PLUGIN_NAME_PATTERN,
  DEFAULT_MARKETPLACE_NAME,
  PROFILE_METADATA_FILE,
  PROFILE_GENERATOR_ID,
  RECEIPT_SCHEMA_VERSION,
  HOOK_PROFILES,
  DEFAULT_CONTEXT_BUDGET_TOKENS,
  LISTING_PAYLOAD_FORMAT,
  CONSERVATIVE_CHARS_PER_TOKEN,
  DEFAULT_PROVIDER_MODEL,
  COMMAND_RUNTIME_DATA,
};
