/**
 * Rules-only install helper, built on top of ECC's canonical installer
 * contract (scripts/install-apply.js --modules rules-core) instead of
 * hand-copying files from a cloned checkout.
 *
 * The manifest's `rules-core` module treats rules/ as one atomic unit (no
 * per-language selection is exposed by the install-state contract - see
 * docs/SELECTIVE-INSTALL-ARCHITECTURE.md "Open Questions"). Stack detection
 * here is therefore informational only: it tells the caller which of the
 * installed rule directories actually apply to this project, but the
 * install action always installs the whole `rules-core` module through the
 * canonical `--modules` flag, so install-state/doctor/repair/uninstall stay
 * fully consistent.
 *
 * This module never touches the filesystem outside a project directory it
 * is asked to read, and never writes ECC-managed files itself: all mutation
 * is delegated to scripts/install-apply.js, so this stays bounded and
 * consistent with the rest of the install-state/plan/apply contract.
 */

'use strict';

const fs = require('fs');
const path = require('path');

const DEFAULT_MAPPINGS_PATH = path.join(__dirname, '../../config/project-stack-mappings.json');

function loadStackMappings(mappingsPath = DEFAULT_MAPPINGS_PATH) {
  let raw;
  try {
    raw = fs.readFileSync(mappingsPath, 'utf8');
  } catch (error) {
    throw new Error(`Could not read project-stack-mappings file at ${mappingsPath}: ${error.message}`);
  }

  let parsed;
  try {
    parsed = JSON.parse(raw);
  } catch (error) {
    throw new Error(`Could not parse project-stack-mappings file at ${mappingsPath}: ${error.message}`);
  }

  if (!parsed || !Array.isArray(parsed.stacks)) {
    throw new Error(`project-stack-mappings file at ${mappingsPath} is missing a "stacks" array`);
  }

  return parsed;
}

function globToRegExp(glob) {
  const escaped = glob.replace(/[.+^${}()|[\]\\]/g, '\\$&').replace(/\*/g, '.*');
  return new RegExp(`^${escaped}$`);
}

function findMatchingFiles(projectRoot, filePattern) {
  if (!filePattern.includes('*')) {
    const fullPath = path.join(projectRoot, filePattern);
    return fs.existsSync(fullPath) ? [fullPath] : [];
  }

  const dir = path.dirname(filePattern) === '.' ? projectRoot : path.join(projectRoot, path.dirname(filePattern));
  if (!fs.existsSync(dir)) return [];

  const basenamePattern = globToRegExp(path.basename(filePattern));
  return fs
    .readdirSync(dir, { withFileTypes: true })
    .filter(entry => entry.isFile() && basenamePattern.test(entry.name))
    .map(entry => path.join(dir, entry.name));
}

function indicatorMatches(projectRoot, indicator) {
  const matches = findMatchingFiles(projectRoot, indicator.file);
  if (matches.length === 0) return false;
  if (!indicator.contains) return true;

  return matches.some(filePath => {
    try {
      return fs.readFileSync(filePath, 'utf8').includes(indicator.contains);
    } catch (_error) {
      return false;
    }
  });
}

function detectStacks(projectRoot, mappings) {
  return mappings.stacks
    .filter(stack => stack.indicators.some(indicator => indicatorMatches(projectRoot, indicator)))
    .map(stack => ({ id: stack.id, name: stack.name || stack.id, rules: stack.rules || [] }));
}

function resolveLanguages(detectedStacks, options = {}) {
  const installExecutor = require('./install-executor');
  const sourceRoot = options.sourceRoot || installExecutor.getSourceRoot();
  const listAvailableLanguages = options.listAvailableLanguages || installExecutor.listAvailableLanguages;
  const available = new Set(listAvailableLanguages(sourceRoot));

  const requested = [...new Set(detectedStacks.flatMap(stack => stack.rules).filter(rule => rule !== 'common'))].sort();

  const languages = requested.filter(language => available.has(language));
  const skipped = requested.filter(language => !available.has(language));

  return { languages, skipped };
}

const RULES_MODULE_ID = 'rules-core';

function buildInstallArgs({ modules, target, dryRun, json = true }) {
  if (!Array.isArray(modules) || modules.length === 0) {
    throw new Error('buildInstallArgs requires at least one module id');
  }

  const args = [];
  if (target) args.push('--target', target);
  if (dryRun) args.push('--dry-run');
  if (json) args.push('--json');
  args.push('--modules', modules.join(','));
  return args;
}

function runInstallApply({ sourceRoot, args, cwd, spawn = require('child_process').spawnSync }) {
  const scriptPath = path.join(sourceRoot, 'scripts', 'install-apply.js');
  return spawn(process.execPath, [scriptPath, ...args], { encoding: 'utf8', cwd });
}

function parsePlanOutput(result) {
  if (result.status !== 0) {
    const error = (result.stderr || '').trim() || `install-apply.js exited with status ${result.status}`;
    return { error };
  }

  try {
    const parsed = JSON.parse(result.stdout);
    return { plan: parsed.plan || parsed.result || null };
  } catch (error) {
    return { error: `Could not parse install-apply.js output: ${error.message}` };
  }
}

function planRulesInstall(options) {
  const {
    projectRoot,
    sourceRoot,
    target,
    mappingsPath,
    mappings: mappingsOverride,
    listAvailableLanguages,
    spawn
  } = options;

  const mappings = mappingsOverride || loadStackMappings(mappingsPath);
  const detected = detectStacks(projectRoot, mappings);
  const { languages, skipped } = resolveLanguages(detected, { sourceRoot, listAvailableLanguages });

  const args = buildInstallArgs({ modules: [RULES_MODULE_ID], target, dryRun: true, json: true });
  const result = runInstallApply({ sourceRoot, args, cwd: projectRoot, spawn });
  const { plan, error } = parsePlanOutput(result);

  return { detected, languages, skipped, plan: plan || null, error };
}

function applyRulesInstall(options) {
  const { sourceRoot, projectRoot, target, spawn } = options;
  const args = buildInstallArgs({ modules: [RULES_MODULE_ID], target, dryRun: false, json: true });
  const result = runInstallApply({ sourceRoot, args, cwd: projectRoot, spawn });
  const { plan, error } = parsePlanOutput(result);
  return { result: plan || null, error };
}

function runInstallRulesFlow(options) {
  const { projectRoot, sourceRoot, target, mappingsPath, mappings, listAvailableLanguages, spawn, confirm } = options;

  const planResult = planRulesInstall({
    projectRoot,
    sourceRoot,
    target,
    mappingsPath,
    mappings,
    listAvailableLanguages,
    spawn
  });

  if (planResult.error) {
    return { status: 'plan-failed', ...planResult };
  }

  const approved = confirm(planResult);
  if (!approved) {
    return { status: 'cancelled', ...planResult };
  }

  const applyResult = applyRulesInstall({ sourceRoot, projectRoot, target, spawn });

  if (applyResult.error) {
    return { status: 'apply-failed', ...planResult, error: applyResult.error };
  }

  return { status: 'applied', ...planResult, result: applyResult.result };
}

module.exports = {
  DEFAULT_MAPPINGS_PATH,
  RULES_MODULE_ID,
  loadStackMappings,
  detectStacks,
  resolveLanguages,
  buildInstallArgs,
  runInstallApply,
  planRulesInstall,
  applyRulesInstall,
  runInstallRulesFlow
};
