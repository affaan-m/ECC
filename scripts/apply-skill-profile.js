#!/usr/bin/env node
/**
 * Materialize ECC_SKILL_PROFILE into .claude-plugin/plugin.json so Claude
 * Code only lists the selected skill subset.
 *
 * Usage:
 *   node scripts/apply-skill-profile.js [--profile minimal|standard|full]
 *   node scripts/apply-skill-profile.js --root <plugin-root> --dry-run --json
 */

'use strict';

const fs = require('fs');
const path = require('path');

const { writeFileAtomic } = require('./lib/atomic-write');
const {
  loadSkillCatalog,
  pluginSkillEntries,
  selectSkills,
} = require('./lib/skill-catalog');
const {
  VALID_SKILL_PROFILES,
  getDisabledSkillGroups,
  getDisabledSkillIds,
  getEnabledSkillGroups,
  getSkillProfile,
} = require('./lib/skill-flags');

const DEFAULT_REPO_ROOT = path.join(__dirname, '..');

function parseArgs(argv) {
  const args = argv.slice(2);
  const parsed = {
    profile: null,
    root: DEFAULT_REPO_ROOT,
    dryRun: false,
    json: false,
    help: false,
  };

  for (let index = 0; index < args.length; index += 1) {
    const arg = args[index];
    if (arg === '--profile') {
      parsed.profile = args[index + 1] || null;
      index += 1;
    } else if (arg === '--root') {
      parsed.root = path.resolve(args[index + 1] || '');
      index += 1;
    } else if (arg === '--dry-run') {
      parsed.dryRun = true;
    } else if (arg === '--json') {
      parsed.json = true;
    } else if (arg === '--help' || arg === '-h') {
      parsed.help = true;
    } else if (arg.startsWith('--')) {
      throw new Error(`Unknown argument: ${arg}`);
    } else {
      throw new Error(`Unexpected argument: ${arg}`);
    }
  }

  return parsed;
}

function showHelp() {
  process.stdout.write(`Apply an ECC skill profile to the Claude plugin listing.

Usage:
  node scripts/apply-skill-profile.js [--profile minimal|standard|full]
  node scripts/apply-skill-profile.js --root <plugin-root> [--dry-run] [--json]

Profiles:
  minimal   Common daily-core skills only
  standard  Default. Daily core plus quality, database, security, and orchestration groups
  full      Every curated skill (the previous unconditional listing)

Environment:
  ECC_SKILL_PROFILE=minimal|standard|full
  ECC_ENABLED_SKILL_GROUPS=framework-language,research-apis
  ECC_DISABLED_SKILL_GROUPS=security
  ECC_DISABLED_SKILLS=tasteforge-video
`);
}

function resolveRequestedProfile(options, env) {
  if (options.profile) {
    const normalized = String(options.profile).trim().toLowerCase();
    if (!VALID_SKILL_PROFILES.has(normalized)) {
      throw new Error(`Unknown skill profile: ${options.profile}. Expected minimal, standard, or full.`);
    }
    return normalized;
  }
  return getSkillProfile(env);
}

function readPluginJson(pluginRoot) {
  const pluginPath = path.join(pluginRoot, '.claude-plugin', 'plugin.json');
  if (!fs.existsSync(pluginPath)) {
    throw new Error(`Plugin manifest not found: ${pluginPath}`);
  }
  try {
    return {
      pluginPath,
      plugin: JSON.parse(fs.readFileSync(pluginPath, 'utf8')),
    };
  } catch (error) {
    throw new Error(`Invalid plugin manifest ${pluginPath}: ${error.message}`);
  }
}

function buildSelection(options, env) {
  const catalog = loadSkillCatalog({ repoRoot: DEFAULT_REPO_ROOT });
  const profile = resolveRequestedProfile(options, env);
  const selected = selectSkills(catalog, {
    profile,
    enabledGroups: getEnabledSkillGroups(env),
    disabledGroups: getDisabledSkillGroups(env),
    disabledSkills: getDisabledSkillIds(env),
    extraSkills: [],
  });
  return {
    catalog,
    selected,
    skills: pluginSkillEntries(selected.enabled.map(skill => skill.id), selected.profile),
  };
}

function applySkillProfile(options = {}, env = process.env) {
  const { catalog, selected, skills } = buildSelection(options, env);
  const { pluginPath, plugin } = readPluginJson(options.root);
  const nextPlugin = {
    ...plugin,
    skills: [...skills],
  };
  const changed = JSON.stringify(plugin.skills) !== JSON.stringify(nextPlugin.skills);

  if (!options.dryRun && changed) {
    writeFileAtomic(pluginPath, `${JSON.stringify(nextPlugin, null, 2)}\n`);
  }

  return {
    profile: selected.profile,
    pluginPath,
    changed,
    dryRun: Boolean(options.dryRun),
    skillCount: catalog.skills.length,
    enabledCount: selected.enabled.length,
    disabledCount: selected.disabled.length,
    skills,
  };
}

function main() {
  try {
    const options = parseArgs(process.argv);
    if (options.help) {
      showHelp();
      return;
    }

    const result = applySkillProfile(options, process.env);
    if (options.json) {
      process.stdout.write(`${JSON.stringify(result, null, 2)}\n`);
      return;
    }

    process.stdout.write(
      `${options.dryRun ? 'Would apply' : 'Applied'} skill profile ${result.profile}: `
      + `${result.enabledCount}/${result.skillCount} skills`
      + `${result.changed ? '' : ' (already current)'}\n`
    );
  } catch (error) {
    process.stderr.write(`${error.message}\n`);
    process.exitCode = 1;
  }
}

if (require.main === module) {
  main();
}

module.exports = {
  applySkillProfile,
  parseArgs,
  resolveRequestedProfile,
};
