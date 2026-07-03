#!/usr/bin/env node
/**
 * Refactored ECC installer runtime.
 *
 * Keeps the legacy language-based install entrypoint intact while moving
 * target-specific mutation logic into testable Node code.
 */

const os = require('os');
const {
  SUPPORTED_INSTALL_TARGETS,
  listLegacyCompatibilityLanguages,
  listSupportedLocales,
} = require('./lib/install-manifests');
const {
  LEGACY_INSTALL_TARGETS,
  normalizeInstallRequest,
  parseInstallArgs,
} = require('./lib/install/request');

function getHelpText() {
  const languages = listLegacyCompatibilityLanguages();
  const locales = listSupportedLocales();

  return `
Usage: install.sh [--target <${LEGACY_INSTALL_TARGETS.join('|')}>] [--dry-run] [--json] <language> [<language> ...]
       install.sh [--target <${SUPPORTED_INSTALL_TARGETS.join('|')}>] [--dry-run] [--json] --profile <name> [--with <component>]... [--without <component>]...
       install.sh [--target <${SUPPORTED_INSTALL_TARGETS.join('|')}>] [--dry-run] [--json] --modules <id,id,...> [--with <component>]... [--without <component>]...
       install.sh [--target <${SUPPORTED_INSTALL_TARGETS.join('|')}>] [--dry-run] [--json] --skills <skill-id[,skill-id...]>
       install.sh [--target claude|claude-project] [--dry-run] [--json] --locale <locale-code>
       install.sh [--dry-run] [--json] --config <path>

Targets:
  claude       (default) - Install ECC into ~/.claude/ with managed rules/skills under rules/ecc and skills/ecc
  claude-project - Install ECC into ./.claude/ (per-project) with managed rules/skills under rules/ecc and skills/ecc
  cursor       - Install rules, hooks, and bundled Cursor configs to ./.cursor/
  antigravity  - Install rules, workflows, skills, and agents to ./.agent/
  codex        - Install shared agents/config into ~/.codex/
  gemini       - Install project-local Gemini config into ./.gemini/
  opencode     - Install shared commands/hooks/config into ~/.opencode/
  codebuddy    - Install commands, agents, skills, and flattened rules into ./.codebuddy/
  joycode      - Install commands, agents, skills, and flattened rules into ./.joycode/
  qwen         - Install commands, agents, skills, rules, and Qwen config into ~/.qwen/
  zed          - Install project settings, commands, agents, skills, and flattened rules into ./.zed/
  hermes       - Install shared rules/skills/commands into ~/.hermes/
  openclaw     - Install shared rules/skills/commands into ~/.openclaw/

Options:
  --profile <name>    Resolve and install a manifest profile
  --modules <ids>     Resolve and install explicit module IDs
  --with <component>  Include a user-facing install component
  --skills <ids>      Install one or more skill directories by ID, e.g. continuous-learning-v2
  --without <component>
                      Exclude a user-facing install component
  --locale <code>     Install translated docs to ~/.claude/docs/<locale>/ (or ./.claude/docs/<locale>/ for claude-project)
                      (claude or claude-project target only; can be combined with --profile or --with)
  --config <path>     Load install intent from ecc-install.json
  --dry-run    Show the install plan without copying files
  --json       Emit machine-readable plan/result JSON
  --help       Show this help text

Available languages:
${languages.map(language => `  - ${language}`).join('\n')}

Available locales (--locale):
${locales.map(locale => `  - ${locale}`).join('\n')}
`;
}

function showHelp(exitCode = 0) {
  console.log(getHelpText());
  process.exit(exitCode);
}

function printHumanPlan(plan, dryRun) {
  console.log(`${dryRun ? 'Dry-run install plan' : 'Applying install plan'}:\n`);
  console.log(`Mode: ${plan.mode}`);
  console.log(`Target: ${plan.target}`);
  console.log(`Adapter: ${plan.adapter.id}`);
  console.log(`Install root: ${plan.installRoot}`);
  console.log(`Install-state: ${plan.installStatePath}`);
  if (plan.mode === 'legacy') {
    console.log(`Languages: ${plan.languages.join(', ')}`);
  } else {
    if (plan.mode === 'legacy-compat') {
      console.log(`Legacy languages: ${plan.legacyLanguages.join(', ')}`);
    }
    console.log(`Profile: ${plan.profileId || '(custom modules)'}`);
    console.log(`Included components: ${plan.includedComponentIds.join(', ') || '(none)'}`);
    console.log(`Excluded components: ${plan.excludedComponentIds.join(', ') || '(none)'}`);
    console.log(`Requested modules: ${plan.requestedModuleIds.join(', ') || '(none)'}`);
    console.log(`Selected modules: ${plan.selectedModuleIds.join(', ') || '(none)'}`);
    if (plan.skippedModuleIds.length > 0) {
      console.log(`Skipped modules: ${plan.skippedModuleIds.join(', ')}`);
    }
    if (plan.excludedModuleIds.length > 0) {
      console.log(`Excluded modules: ${plan.excludedModuleIds.join(', ')}`);
    }
  }
  console.log(`Operations: ${plan.operations.length}`);

  if (plan.warnings.length > 0) {
    console.log('\nWarnings:');
    for (const warning of plan.warnings) {
      console.log(`- ${warning}`);
    }
  }

  console.log('\nPlanned file operations:');
  for (const operation of plan.operations) {
    console.log(`- ${operation.sourceRelativePath} -> ${operation.destinationPath}`);
  }

  if (!dryRun) {
    console.log(`\nDone. Install-state written to ${plan.installStatePath}`);
  }
}

function main() {
  try {
    const options = parseInstallArgs(process.argv);

    if (options.help) {
      showHelp(0);
    }

    const {
      findDefaultInstallConfigPath,
      loadInstallConfig,
    } = require('./lib/install/config');
    const { applyInstallPlan } = require('./lib/install-executor');
    const { createInstallPlanFromRequest } = require('./lib/install/runtime');
    const defaultConfigPath = options.configPath || options.languages.length > 0
      ? null
      : findDefaultInstallConfigPath({ cwd: process.cwd() });
    const config = options.configPath
      ? loadInstallConfig(options.configPath, { cwd: process.cwd() })
      : (defaultConfigPath ? loadInstallConfig(defaultConfigPath, { cwd: process.cwd() }) : null);
    const request = normalizeInstallRequest({
      ...options,
      config,
    });
    const plan = createInstallPlanFromRequest(request, {
      projectRoot: process.cwd(),
      homeDir: process.env.HOME || os.homedir(),
      claudeRulesDir: process.env.CLAUDE_RULES_DIR || null,
    });

    if (options.dryRun) {
      if (options.json) {
        console.log(JSON.stringify({ dryRun: true, plan }, null, 2));
      } else {
        printHumanPlan(plan, true);
      }
      return;
    }

    const result = applyInstallPlan(plan);
    if (options.json) {
      console.log(JSON.stringify({ dryRun: false, result }, null, 2));
    } else {
      printHumanPlan(result, false);
    }
  } catch (error) {
    process.stderr.write(`Error: ${error.message}${getHelpText()}`);
    process.exit(1);
  }
}

main();
