#!/usr/bin/env node
/**
 * Generate slim ECC profile plugins for Claude Code from the
 * selective-install manifests.
 *
 * Usage:
 *   node scripts/plugin-profiles.js list
 *   node scripts/plugin-profiles.js plan --profile developer [--json]
 *   node scripts/plugin-profiles.js generate --profile developer [options]
 *
 * Options (plan/generate):
 *   --profile <id>            Install profile from manifests/install-profiles.json
 *   --modules <a,b>           Explicit module IDs (adds to the profile)
 *   --with <component,...>    Include component IDs (e.g. skill:react-patterns, agent:planner)
 *   --without <component,...> Exclude component IDs
 *   --name <plugin-name>      Generated plugin name (default: ecc-<profile>)
 *   --out <dir>               Output marketplace root (default: ~/.claude/ecc-profiles)
 *   --marketplace-name <name> Marketplace name to write (default: ecc-profiles)
 *   --force                   Replace a directory that is not a generated plugin
 *   --no-catalog              Skip the generated ecc-catalog escape-hatch skill
 *   --no-hooks                Skip hooks/ and scripts/hooks/ runtime copies
 *   --json                    (plan) print the resolved plan as JSON
 */

'use strict';

const os = require('os');
const path = require('path');
const { listInstallProfiles } = require('./lib/install-manifests');
const {
  DEFAULT_MARKETPLACE_NAME,
  estimatePlanCatalogTokens,
  resolvePluginProfilePlan,
  generateProfilePlugin,
  writeMarketplaceManifest,
} = require('./lib/plugin-profiles');

const DEFAULT_OUT_ROOT = path.join(os.homedir(), '.claude', 'ecc-profiles');

const BOOLEAN_FLAGS = ['no-catalog', 'no-hooks', 'json'];
const VALUE_FLAGS = ['profile', 'modules', 'with', 'without', 'name', 'out', 'marketplace-name', 'repo-root'];

/**
 * Parse the CLI's `<command> [--flag value]` argv form.
 *
 * @param {Array<string>} argv Arguments after the script path.
 * @returns {{command: string, flags: object}} Command and parsed flags.
 */
function parseArgs(argv) {
  const args = { command: argv[0] || 'help', flags: {} };
  for (let i = 1; i < argv.length; i += 1) {
    const arg = argv[i];
    if (!arg.startsWith('--')) {
      throw new Error(`Unexpected argument: ${arg}`);
    }
    const key = arg.slice(2);
    if (BOOLEAN_FLAGS.includes(key)) {
      args.flags[key] = true;
    } else if (VALUE_FLAGS.includes(key)) {
      const value = argv[i + 1];
      if (value === undefined || value.startsWith('--')) {
        throw new Error(`Flag --${key} requires a value`);
      }
      args.flags[key] = value;
      i += 1;
    } else {
      throw new Error(`Unknown flag --${key}. Valid flags: ${[...VALUE_FLAGS, ...BOOLEAN_FLAGS].map(f => `--${f}`).join(', ')}`);
    }
  }
  return args;
}

/**
 * Split a comma-separated flag value into trimmed, non-empty items.
 *
 * @param {string|undefined} value Raw flag value.
 * @returns {Array<string>} Parsed list.
 */
function splitList(value) {
  return value ? value.split(',').map(entry => entry.trim()).filter(Boolean) : [];
}

/**
 * Translate parsed CLI flags into resolvePluginProfilePlan() options.
 *
 * @param {object} flags Parsed CLI flags.
 * @returns {object} Plan options.
 */
function buildPlanOptions(flags) {
  return {
    repoRoot: flags['repo-root'] || undefined,
    profileId: flags.profile || null,
    moduleIds: splitList(flags.modules),
    includeComponentIds: splitList(flags.with),
    excludeComponentIds: splitList(flags.without),
    pluginName: flags.name || undefined,
    includeHooks: !flags['no-hooks'],
  };
}

/**
 * Print a human-readable summary of a resolved plan, warnings included.
 *
 * @param {object} plan Resolved plugin plan.
 * @returns {void}
 */
function printPlanSummary(plan) {
  console.log(`Plugin:   ${plan.pluginName} (ecc@${plan.version}${plan.profileId ? `, profile "${plan.profileId}"` : ''})`);
  console.log(`Modules:  ${plan.selectedModuleIds.join(', ')}`);
  console.log(`Surface:  ${plan.skills.length} skills, ${plan.agents.length} agents, ${plan.commands.length} commands, ${plan.runtimePaths.length} runtime paths`);
  console.log(`Context:  ~${estimatePlanCatalogTokens(plan)} catalog tokens per session`);
  if (plan.skippedPaths.length > 0) {
    console.log(`Skipped (installer-only surfaces): ${plan.skippedPaths.join(', ')}`);
  }
  for (const warning of plan.warnings) {
    console.warn(`Warning:  ${warning}`);
  }
}

/**
 * `list` subcommand: show the install profiles available for generation.
 *
 * @returns {void}
 */
function runList() {
  console.log('Available install profiles:\n');
  for (const profile of listInstallProfiles()) {
    console.log(`  ${profile.id.padEnd(12)} ${profile.description} (${profile.moduleCount} modules)`);
  }
  console.log('\nGenerate one with: node scripts/plugin-profiles.js generate --profile <id>');
}

/**
 * `plan` subcommand: resolve a selection and report it without writing.
 *
 * @param {object} flags Parsed CLI flags.
 * @returns {void}
 */
function runPlan(flags) {
  const plan = resolvePluginProfilePlan(buildPlanOptions(flags));
  if (flags.json) {
    console.log(JSON.stringify({ ...plan, estimatedCatalogTokens: estimatePlanCatalogTokens(plan) }, null, 2));
    return;
  }
  printPlanSummary(plan);
}

/**
 * `generate` subcommand: materialize the plugin and refresh the marketplace.
 *
 * @param {object} flags Parsed CLI flags.
 * @returns {void}
 */
function runGenerate(flags) {
  const outRoot = flags.out || DEFAULT_OUT_ROOT;
  const marketplaceName = flags['marketplace-name'] || DEFAULT_MARKETPLACE_NAME;
  const plan = resolvePluginProfilePlan(buildPlanOptions(flags));

  if (!flags.name && !flags.profile) {
    console.warn(`Warning:  no --profile or --name given; using default name "${plan.pluginName}". `
      + 'Another custom generation without --name will overwrite this plugin.');
  }

  printPlanSummary(plan);

  const result = generateProfilePlugin({
    plan,
    outRoot,
    includeCatalogSkill: !flags['no-catalog'],
    force: Boolean(flags.force),
  });
  writeMarketplaceManifest({ outRoot, marketplaceName });

  console.log(`\nGenerated: ${result.pluginRoot}`);
  console.log('\nNext steps:');
  console.log(`  claude plugin marketplace add "${outRoot}"`);
  console.log(`  claude plugin install ${plan.pluginName}@${marketplaceName}`);
  console.log('\nNote: install enables the plugin at user scope. For per-project use,');
  console.log('disable it globally, then opt in per project via .claude/settings.json:');
  console.log(JSON.stringify({
    enabledPlugins: {
      'ecc@ecc': false,
      [`${plan.pluginName}@${marketplaceName}`]: true,
    },
  }, null, 2));
  console.log('\nRe-run this command after updating ECC to refresh the generated plugin.');
}

/**
 * CLI entry point: dispatch to the requested subcommand.
 *
 * @returns {void}
 */
function main() {
  const { command, flags } = parseArgs(process.argv.slice(2));

  switch (command) {
    case 'list':
      runList();
      break;
    case 'plan':
      runPlan(flags);
      break;
    case 'generate':
      runGenerate(flags);
      break;
    default:
      console.log('Usage: node scripts/plugin-profiles.js <list|plan|generate> [options]');
      console.log('See the header of this file or docs/PLUGIN-PROFILES.md for options.');
      if (command !== 'help') {
        process.exitCode = 1;
      }
  }
}

try {
  main();
} catch (error) {
  console.error(`plugin-profiles: ${error.message}`);
  process.exitCode = 1;
}
