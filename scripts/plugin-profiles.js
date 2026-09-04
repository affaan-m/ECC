#!/usr/bin/env node
/**
 * Generate slim ECC profile plugins (carriers) for Claude Code from the
 * selective-install manifests.
 *
 * Usage:
 *   node scripts/plugin-profiles.js list
 *   node scripts/plugin-profiles.js plan --profile developer [--json]
 *   node scripts/plugin-profiles.js generate --profile developer --hooks off [options]
 *
 * Selection (plan/generate):
 *   --profile <id>            Install profile from manifests/install-profiles.json
 *   --modules <a,b>           Explicit module IDs (adds to the profile)
 *   --with <component,...>    Include component IDs (e.g. skill:react-patterns, agent:planner)
 *   --without <component,...> Exclude component IDs
 *   --name <plugin-name>      Generated plugin name (default: ecc-<profile>)
 *
 * Capabilities:
 *   --hooks <off|minimal|standard|strict>
 *                             Carry the hook runtime at that profile. Required
 *                             whenever the selection includes hooks-runtime;
 *                             a context profile never implies automation.
 *   --no-hooks                Alias for --hooks off
 *
 * Context budget:
 *   --budget <tokens>         Declared listing budget (default: 8000)
 *   --allow-over-budget       Generate even when the ledger exceeds the budget
 *
 * Output (generate):
 *   --out <dir>               Output marketplace root (default: ~/.claude/ecc-profiles)
 *   --marketplace-name <name> Marketplace name to write (default: ecc-profiles)
 *   --dry-run                 Print the exact file list, deletions, ledger, and blockers; write nothing
 *   --force                   Replace a directory that is not an unmodified generated plugin
 *   --yes                     Confirm --force when stdin is not a terminal
 *   --keep-prev               Keep the replaced tree beside the new one (.prev-<name>-<pid>)
 *   --no-catalog              Skip the ecc-catalog skill and on-demand skill copies
 *   --json                    Print the plan (plan) or preview (generate --dry-run) as JSON
 */

'use strict';

const os = require('os');
const path = require('path');
const { listInstallProfiles } = require('./lib/install-manifests');
const {
  DEFAULT_MARKETPLACE_NAME,
  HOOK_PROFILES,
  measureContextLedger,
  resolvePluginProfilePlan,
  previewProfilePlugin,
  generateProfilePlugin,
  writeMarketplaceManifest,
} = require('./lib/plugin-profiles');

const DEFAULT_OUT_ROOT = path.join(os.homedir(), '.claude', 'ecc-profiles');

const BOOLEAN_FLAGS = ['no-catalog', 'no-hooks', 'json', 'dry-run', 'force', 'yes', 'keep-prev', 'allow-over-budget', 'help'];
const VALUE_FLAGS = ['profile', 'modules', 'with', 'without', 'name', 'out', 'marketplace-name', 'repo-root', 'hooks', 'budget'];

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

function splitList(value) {
  return value ? value.split(',').map(entry => entry.trim()).filter(Boolean) : [];
}

function resolveHooksFlag(flags) {
  if (flags['no-hooks'] && flags.hooks && flags.hooks !== 'off') {
    throw new Error('--no-hooks and --hooks are mutually exclusive');
  }
  if (flags['no-hooks']) {
    return 'off';
  }
  if (flags.hooks === undefined) {
    return undefined;
  }
  if (!HOOK_PROFILES.includes(flags.hooks)) {
    throw new Error(`--hooks expects one of ${HOOK_PROFILES.join(', ')}`);
  }
  return flags.hooks;
}

function resolveBudgetFlag(flags) {
  if (flags.budget === undefined) {
    return undefined;
  }
  const budget = Number(flags.budget);
  if (!Number.isInteger(budget) || budget <= 0) {
    throw new Error('--budget expects a positive integer token count');
  }
  return budget;
}

function buildPlanOptions(flags) {
  return {
    repoRoot: flags['repo-root'] || undefined,
    profileId: flags.profile || null,
    moduleIds: splitList(flags.modules),
    includeComponentIds: splitList(flags.with),
    excludeComponentIds: splitList(flags.without),
    pluginName: flags.name || undefined,
    hooks: resolveHooksFlag(flags),
    contextBudgetTokens: resolveBudgetFlag(flags),
  };
}

function formatLedger(ledger) {
  const status = ledger.withinBudget ? 'within' : 'OVER';
  return `${ledger.tokens} tokens (${ledger.method}@${ledger.methodVersion}, ${ledger.chars} chars, `
    + `${ledger.entries.skills} skills/${ledger.entries.agents} agents/${ledger.entries.commands} commands) `
    + `- ${status} budget ${ledger.budget}`;
}

function printPlanSummary(plan, ledger) {
  console.log(`Plugin:       ${plan.pluginName} (ecc@${plan.version}${plan.profileId ? `, profile "${plan.profileId}"` : ''})`);
  console.log(`Modules:      ${plan.selectedModuleIds.join(', ')}`);
  console.log('');
  console.log('Context selection');
  console.log(`  Surface:    ${plan.skills.length} skills, ${plan.agents.length} agents, ${plan.commands.length} commands`);
  console.log(`  Ledger:     ${formatLedger(ledger)}`);
  console.log('');
  console.log('Capability selection');
  if (plan.hooks.decision === 'enabled') {
    console.log(`  Hooks:      enabled at profile "${plan.hooks.profile}" (${plan.hooks.groups.length} capability groups)`);
  } else if (plan.hooks.decision === 'pending') {
    console.log(`  Hooks:      DECISION REQUIRED - selection includes ${plan.heldRuntimePaths.join(', ')}; pass --hooks <profile> or --hooks off`);
  } else {
    console.log('  Hooks:      off');
  }
  console.log(`  Runtime:    ${plan.runtimePaths.length} paths (${plan.closure.entries.length} command script entry points, ${plan.closure.files.length} files in closure)`);
  if (plan.closure.dynamic.length > 0) {
    console.log(`  Dynamic:    ${plan.closure.dynamic.length} non-literal module loads could not be resolved statically:`);
    for (const item of plan.closure.dynamic) {
      console.log(`              ${item.from}: ${item.expression}`);
    }
  }
  if (plan.skippedPaths.length > 0) {
    console.log(`  Skipped:    ${plan.skippedPaths.join(', ')} (installer-only surfaces)`);
  }
  for (const warning of plan.warnings) {
    console.warn(`Warning:      ${warning}`);
  }
}

function runList() {
  console.log('Available install profiles:\n');
  for (const profile of listInstallProfiles()) {
    console.log(`  ${profile.id.padEnd(12)} ${profile.description} (${profile.moduleCount} modules)`);
  }
  console.log('\nGenerate one with: node scripts/plugin-profiles.js generate --profile <id> --hooks <off|minimal|standard|strict>');
}

function runPlan(flags) {
  const plan = resolvePluginProfilePlan(buildPlanOptions(flags));
  const ledger = measureContextLedger(plan, { includeCatalogSkill: !flags['no-catalog'] });
  if (flags.json) {
    console.log(JSON.stringify({ ...plan, ledger, estimatedCatalogTokens: ledger.tokens }, null, 2));
    return;
  }
  printPlanSummary(plan, ledger);
}

function printPreview(preview) {
  console.log('');
  console.log(`Target:       ${preview.pluginRoot}`);
  if (preview.willReplace) {
    console.log(`Replaces:     existing directory (${preview.existingIsGenerated ? 'unmodified generated plugin' : 'NOT a generated plugin or modified since generation'})`);
    if (preview.existingReceipt && preview.existingReceipt.createdAt) {
      console.log(`              previous receipt created ${preview.existingReceipt.createdAt}`);
    }
  }
  console.log(`Copies:       ${preview.operations.length} paths`);
  for (const operation of preview.operations) {
    console.log(`  ${operation.source} -> ${operation.destination}`);
  }
  console.log(`Generates:    ${preview.generatedFiles.join(', ')}`);
  console.log(`Ledger:       ${formatLedger(preview.ledger)}`);
  if (preview.pendingChecks && preview.pendingChecks.length > 0) {
    console.log('');
    console.log('Checks that only run against the staged tree (a dry run writes nothing):');
    for (const check of preview.pendingChecks) {
      console.log(`  - ${check}`);
    }
  }
  if (preview.blockers.length > 0) {
    console.log('');
    console.log('Generation would be refused:');
    for (const blocker of preview.blockers) {
      console.log(`  - ${blocker.split('\n').join('\n    ')}`);
    }
  }
}

function runGenerate(flags) {
  const outRoot = flags.out || DEFAULT_OUT_ROOT;
  const marketplaceName = flags['marketplace-name'] || DEFAULT_MARKETPLACE_NAME;
  const plan = resolvePluginProfilePlan(buildPlanOptions(flags));
  const includeCatalogSkill = !flags['no-catalog'];

  if (!flags.name && !flags.profile) {
    console.warn(`Warning:  no --profile or --name given; using default name "${plan.pluginName}". `
      + 'Another custom generation without --name will overwrite this plugin.');
  }

  const generationOptions = {
    plan,
    outRoot,
    includeCatalogSkill,
    force: Boolean(flags.force),
    allowOverBudget: Boolean(flags['allow-over-budget']),
    keepPrevious: Boolean(flags['keep-prev']),
  };

  if (flags['dry-run']) {
    const preview = previewProfilePlugin(generationOptions);
    if (flags.json) {
      console.log(JSON.stringify({ plan, preview }, null, 2));
      return;
    }
    printPlanSummary(plan, preview.ledger);
    printPreview(preview);
    console.log('\nDry run: nothing was written.');
    return;
  }

  if (flags.force && !flags.yes && !process.stdin.isTTY) {
    throw new Error('--force deletes the target directory; pass --yes to confirm when not running interactively');
  }

  const preview = previewProfilePlugin(generationOptions);
  printPlanSummary(plan, preview.ledger);
  if (flags.force && preview.willReplace && !preview.existingIsGenerated) {
    console.warn(`\nWarning:  --force will delete ${preview.pluginRoot}, which is not an unmodified generated plugin.`);
  }

  const result = generateProfilePlugin(generationOptions);
  writeMarketplaceManifest({ outRoot, marketplaceName });
  printGenerationResult(result, { plan, outRoot, marketplaceName });
}

function printExternalDependencies(receipt) {
  const external = (receipt.dependencies && receipt.dependencies.external) || [];
  if (external.length === 0) {
    return;
  }
  console.warn('\nWarning:  the staged load smoke found shipped scripts that need npm packages');
  console.warn('          no carrier carries. Those commands will fail at runtime:');
  for (const item of external) {
    console.warn(`            ${item.file} requires "${item.module}"`);
  }
}

function printGenerationResult(result, { plan, outRoot, marketplaceName }) {
  console.log(`\nGenerated: ${result.pluginRoot}`);
  printExternalDependencies(result.receipt);
  console.log(`Receipt:   ${path.join(result.pluginRoot, 'ecc-profile.json')} (context digest ${result.receipt.context.digest.slice(0, 12)}, tree digest ${result.receipt.treeDigest.slice(0, 12)})`);
  if (result.previousRoot) {
    console.log(`Previous:  ${result.previousRoot}`);
  }
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

function printUsage() {
  console.log('Usage: node scripts/plugin-profiles.js <list|plan|generate> [options]');
  console.log('See the header of this file or docs/PLUGIN-PROFILES.md for options.');
}

function main() {
  const argv = process.argv.slice(2);
  // `--help` before argument parsing: the staged-carrier load smoke runs this
  // entry point with `--help` to prove it loads inside a carrier, so the flag
  // has to work without a subcommand and without touching the filesystem.
  if (argv.length === 0 || argv.includes('--help') || argv.includes('-h')) {
    printUsage();
    return;
  }

  const { command, flags } = parseArgs(argv);

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
      printUsage();
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
