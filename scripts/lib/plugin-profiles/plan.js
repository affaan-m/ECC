/**
 * Plan resolution: turn an install selection into a concrete carrier plan,
 * and turn a plan plus its measured surroundings into the list of refusals.
 *
 * Nothing in this module writes to disk.
 */

'use strict';

const fs = require('fs');
const path = require('path');

const { DEFAULT_REPO_ROOT, resolveInstallPlan } = require('../install-manifests');
const { HOOK_CAPABILITY_GROUPS, formatHookCapabilityDisclosure } = require('../install/hook-consent');
const {
  COMMAND_RUNTIME_DATA,
  DEFAULT_CONTEXT_BUDGET_TOKENS,
  HOOK_PROFILES,
  PLUGIN_NAME_PATTERN,
  PROFILE_METADATA_FILE,
} = require('./constants');
const {
  toPosix,
  readJson,
  listChildDirectories,
  listMarkdownFiles,
  listFilesRecursive,
} = require('./fs-utils');
const { resolveScriptClosure } = require('./require-graph');
const { resolveContextProfile, buildContextProfileReceipt } = require('./context-profile');

const COMMAND_SCRIPT_REFERENCE_PATTERN = /scripts\/[A-Za-z0-9_./-]+\.js/g;

/**
 * True when a runtime path belongs to the hook runtime.
 *
 * @param {string} relPath POSIX repo-relative path.
 * @returns {boolean} Whether the path is hook runtime.
 */
function isHookRuntimePath(relPath) {
  return relPath === 'hooks' || relPath.startsWith('hooks/')
    || relPath === 'scripts/hooks' || relPath.startsWith('scripts/hooks/');
}

/**
 * Classify one install-module path into the plugin surface it feeds.
 *
 * @param {string} rawPath Module path.
 * @returns {{surface: string, relPath: string}} Surface and normalized path.
 */
function classifyModulePath(rawPath) {
  const relPath = toPosix(rawPath).replace(/\/+$/, '');
  if (relPath === 'skills' || relPath.startsWith('skills/')) {
    return { surface: 'skills', relPath };
  }
  if (relPath === 'agents' || relPath.startsWith('agents/')) {
    return { surface: 'agents', relPath };
  }
  if (relPath === 'commands' || relPath.startsWith('commands/')) {
    return { surface: 'commands', relPath };
  }
  if (relPath === 'hooks' || relPath.startsWith('hooks/') || relPath.startsWith('scripts/')) {
    return { surface: 'runtime', relPath };
  }
  return { surface: 'skipped', relPath };
}

/**
 * Validate a `hooks` decision value.
 *
 * @param {unknown} value Candidate decision.
 * @returns {string|null} Normalized profile, or null when no decision given.
 */
function normalizeHookDecision(value) {
  if (value === undefined || value === null || value === '') {
    return null;
  }
  const normalized = String(value).trim().toLowerCase();
  if (!HOOK_PROFILES.includes(normalized)) {
    throw new Error(`Invalid hooks decision "${value}"; expected one of ${HOOK_PROFILES.join(', ')}`);
  }
  return normalized;
}

/**
 * Build the human-readable refusal for a plan whose hook decision is pending.
 *
 * @returns {string} Disclosure text reused from the installer consent gate.
 */
function buildHookDecisionMessage() {
  return 'This selection would carry ECC\'s automatic hook runtime, which can:\n'
    + `${formatHookCapabilityDisclosure()}\n`
    + 'A narrow context selection does not authorize lifecycle automation. Pass '
    + '--hooks <minimal|standard|strict> to carry the hook runtime at that '
    + 'profile, or --hooks off (alias --no-hooks) to generate the carrier without it.';
}

/**
 * Add one runtime path to a surface accumulator, holding hook-runtime paths
 * back until an explicit hook decision authorizes them.
 *
 * @param {object} acc Surface accumulator.
 * @param {object} context Repo root, hook decision, and the module id.
 * @returns {void}
 */
function addRuntimePath(acc, { relPath, moduleId, repoRoot, hookDecision }) {
  if (!fs.existsSync(path.join(repoRoot, ...relPath.split('/')))) {
    acc.warnings.push(`Module ${moduleId}: missing runtime path ${relPath}`);
    return;
  }
  if (isHookRuntimePath(relPath) && (hookDecision === null || hookDecision === 'off')) {
    acc.heldRuntimePaths.add(relPath);
    return;
  }
  acc.runtimePaths.add(relPath);
}

/**
 * Expand one `skills/...` module path into concrete skill directory ids.
 *
 * @param {object} acc Surface accumulator.
 * @param {object} context Path, module id, and repo root.
 * @returns {void}
 */
function addSkillPath(acc, { relPath, moduleId, repoRoot }) {
  if (relPath === 'skills') {
    listChildDirectories(path.join(repoRoot, 'skills')).forEach(name => acc.skillDirs.add(name));
    return;
  }
  const skillId = relPath.slice('skills/'.length).split('/')[0];
  if (fs.existsSync(path.join(repoRoot, 'skills', skillId, 'SKILL.md'))) {
    acc.skillDirs.add(skillId);
  } else {
    acc.warnings.push(`Module ${moduleId}: missing skill ${skillId}`);
  }
}

/**
 * Expand one `agents/...` or `commands/...` module path into file names.
 *
 * @param {object} acc Surface accumulator.
 * @param {object} context Surface, path, module id, and repo root.
 * @returns {void}
 */
function addMarkdownSurfacePath(acc, { surface, relPath, moduleId, repoRoot }) {
  const target = surface === 'agents' ? acc.agentFiles : acc.commandFiles;
  if (relPath === surface) {
    listMarkdownFiles(path.join(repoRoot, surface)).forEach(name => target.add(name));
    return;
  }
  const fileName = relPath.slice(`${surface}/`.length);
  if (fs.existsSync(path.join(repoRoot, surface, fileName))) {
    target.add(fileName);
  } else {
    acc.warnings.push(`Module ${moduleId}: missing ${surface === 'agents' ? 'agent' : 'command'} ${fileName}`);
  }
}

/**
 * Expand the selected install modules into the plugin surface they imply.
 *
 * @param {Array<object>} selectedModules Modules from the install plan.
 * @param {object} context Repo root and the normalized hook decision.
 * @returns {object} Surface accumulator of Sets plus warnings.
 */
function expandSurface(selectedModules, { repoRoot, hookDecision }) {
  const acc = {
    skillDirs: new Set(),
    agentFiles: new Set(),
    commandFiles: new Set(),
    runtimePaths: new Set(),
    heldRuntimePaths: new Set(),
    skippedPaths: new Set(),
    warnings: [],
  };

  for (const module of selectedModules) {
    for (const rawPath of module.paths || []) {
      const { surface, relPath } = classifyModulePath(rawPath);
      const context = { surface, relPath, moduleId: module.id, repoRoot, hookDecision };
      if (surface === 'skipped') {
        acc.skippedPaths.add(relPath);
      } else if (surface === 'runtime') {
        addRuntimePath(acc, context);
      } else if (surface === 'skills') {
        addSkillPath(acc, context);
      } else {
        addMarkdownSurfacePath(acc, context);
      }
    }
  }
  return acc;
}

/**
 * Discover the scripts a set of shipped commands depend on, then resolve
 * their transitive require() closure.
 *
 * @param {Array<string>} commandFiles Command Markdown file names.
 * @param {string} repoRoot Absolute repository root.
 * @returns {{entries: Array<{command: string, script: string}>, files: Array<string>, data: Array<string>, unresolved: Array<object>, dynamic: Array<object>, warnings: Array<string>}}
 */
function resolveCommandRuntimeClosure(commandFiles, repoRoot) {
  const entries = [];
  const data = new Set();
  const warnings = [];
  const entryScripts = new Set();

  for (const commandFile of commandFiles) {
    let source;
    try {
      source = fs.readFileSync(path.join(repoRoot, 'commands', commandFile), 'utf8');
    } catch {
      continue;
    }
    const references = new Set((source.match(COMMAND_SCRIPT_REFERENCE_PATTERN) || []).map(ref => ref.replace(/^\.\//, '')));
    for (const script of [...references].sort()) {
      if (fs.existsSync(path.join(repoRoot, ...script.split('/')))) {
        entries.push({ command: commandFile, script });
        entryScripts.add(script);
      } else {
        warnings.push(`Command ${commandFile}: references missing script ${script}`);
      }
    }
    for (const dataPath of COMMAND_RUNTIME_DATA[commandFile] || []) {
      if (fs.existsSync(path.join(repoRoot, ...dataPath.split('/')))) {
        data.add(dataPath);
      } else {
        warnings.push(`Command ${commandFile}: missing runtime data path ${dataPath}`);
      }
    }
  }

  const closure = resolveScriptClosure([...entryScripts].sort(), repoRoot);
  return {
    entries,
    files: closure.files,
    data: [...data].sort(),
    unresolved: closure.unresolved,
    dynamic: closure.dynamic,
    warnings,
  };
}

/**
 * Close over the scripts inside directories that are copied wholesale.
 *
 * `hooks-runtime` ships `scripts/lib` as a directory; those scripts have
 * their own requires, which must resolve inside the carrier too or the
 * staged verification rightly refuses it.
 *
 * @param {Set<string>} runtimePaths Selected runtime paths.
 * @param {string} repoRoot Absolute repository root.
 * @returns {{files: Array<string>, unresolved: Array<object>, dynamic: Array<object>}}
 */
function closeOverWholesaleDirectories(runtimePaths, repoRoot) {
  const entries = [];
  for (const runtimePath of runtimePaths) {
    const absPath = path.join(repoRoot, ...runtimePath.split('/'));
    if (fs.statSync(absPath).isDirectory()) {
      for (const relFile of listFilesRecursive(absPath)) {
        if (relFile.endsWith('.js')) {
          entries.push(`${runtimePath}/${relFile}`);
        }
      }
    }
  }
  return entries.length > 0
    ? resolveScriptClosure(entries, repoRoot)
    : { files: [], unresolved: [], dynamic: [] };
}

/**
 * Fold every discovered dependency into the carrier's runtime paths.
 *
 * A command script reaching into the hook runtime does not authorize the
 * hook runtime: the file is copied as plain code, but `hooks/hooks.json`
 * itself is never carried without a decision.
 *
 * @param {object} acc Surface accumulator (mutated).
 * @param {object} closure Merged command + wholesale closure.
 * @param {boolean} hooksIncluded Whether a hook decision authorized hooks.
 * @returns {void}
 */
function coverDependencies(acc, closure, hooksIncluded) {
  for (const depPath of [...closure.files, ...closure.data]) {
    const covered = [...acc.runtimePaths].some(
      existing => existing === depPath || depPath.startsWith(`${existing}/`)
    );
    if (covered) {
      continue;
    }
    if (depPath === 'hooks/hooks.json' && !hooksIncluded) {
      acc.heldRuntimePaths.add(depPath);
      continue;
    }
    acc.runtimePaths.add(depPath);
  }
}

/**
 * Derive the recorded hook decision from the requested one and what the
 * selection would have carried.
 *
 * @param {string|null} hookDecision Normalized request.
 * @param {Set<string>} heldRuntimePaths Paths withheld for want of a decision.
 * @returns {string} `pending`, `off`, or `enabled`.
 */
function resolveHookDecisionState(hookDecision, heldRuntimePaths) {
  if (hookDecision === null) {
    return heldRuntimePaths.size > 0 ? 'pending' : 'off';
  }
  return hookDecision === 'off' ? 'off' : 'enabled';
}

/**
 * Resolve every dependency a carrier needs: the command runtime closure plus
 * the closure of directories copied wholesale.
 *
 * Ship the backing code for every command so a carrier never carries a slash
 * command it cannot run. Runtime paths cost zero session context.
 *
 * @param {object} acc Surface accumulator (warnings are appended).
 * @param {string} repoRoot Absolute repository root.
 * @returns {object} Merged closure.
 */
function resolveFullClosure(acc, repoRoot) {
  const closure = resolveCommandRuntimeClosure([...acc.commandFiles].sort(), repoRoot);
  acc.warnings.push(...closure.warnings);

  const wholesale = closeOverWholesaleDirectories(acc.runtimePaths, repoRoot);
  closure.files = [...new Set([...closure.files, ...wholesale.files])].sort();
  closure.unresolved.push(...wholesale.unresolved);
  closure.dynamic.push(...wholesale.dynamic);
  return closure;
}

/**
 * Freeze the resolved selection into the plan object callers consume.
 *
 * @param {object} context Everything resolvePluginProfilePlan worked out.
 * @returns {object} Resolved plan.
 */
function assemblePlan({ options, repoRoot, pluginName, installPlan, acc, closure, hookDecision, decision, contextProfile }) {
  const rootPackage = readJson(path.join(repoRoot, 'package.json'), 'package.json');
  return {
    repoRoot,
    pluginName,
    profileId: installPlan.profileId,
    contextProfile: buildContextProfileReceipt(contextProfile),
    version: rootPackage.version,
    profileInput: {
      profileId: options.profileId || null,
      moduleIds: [...(options.moduleIds || [])],
      includeComponentIds: [...(options.includeComponentIds || [])],
      excludeComponentIds: [...(options.excludeComponentIds || [])],
    },
    selectedModuleIds: installPlan.selectedModuleIds,
    skills: [...acc.skillDirs].sort(),
    agents: [...acc.agentFiles].sort(),
    commands: [...acc.commandFiles].sort(),
    runtimePaths: [...acc.runtimePaths].sort(),
    heldRuntimePaths: [...acc.heldRuntimePaths].sort(),
    skippedPaths: [...acc.skippedPaths].sort(),
    hooks: {
      decision,
      profile: decision === 'enabled' ? hookDecision : null,
      groups: decision === 'enabled' ? HOOK_CAPABILITY_GROUPS.map(group => group.id) : [],
    },
    closure: {
      entries: closure.entries,
      files: closure.files,
      unresolved: closure.unresolved,
      dynamic: closure.dynamic,
    },
    contextBudgetTokens: Number.isFinite(options.contextBudgetTokens)
      ? options.contextBudgetTokens
      : DEFAULT_CONTEXT_BUDGET_TOKENS,
    warnings: acc.warnings,
  };
}

/**
 * Resolve an install selection into a concrete carrier plan.
 *
 * Options mirror resolveInstallPlan (profileId, moduleIds,
 * includeComponentIds, excludeComponentIds) plus:
 *
 * - `pluginName` — output directory name (validated).
 * - `hooks` — capability decision: `off`, `minimal`, `standard`, `strict`,
 *   or omitted. When omitted and the selection would materialize the hook
 *   runtime, the plan is returned with `hooks.decision === 'pending'` and
 *   the hook paths held back; generation refuses such a plan.
 * - `contextBudgetTokens` — declared listing budget (default 8000).
 *
 * @param {object} [options] Selection options.
 * @returns {object} Resolved plan.
 */
function resolvePluginProfilePlan(options = {}) {
  const repoRoot = options.repoRoot || DEFAULT_REPO_ROOT;
  const hookDecision = normalizeHookDecision(options.hooks);
  const installPlan = resolveInstallPlan({
    repoRoot,
    profileId: options.profileId || null,
    moduleIds: options.moduleIds || [],
    includeComponentIds: options.includeComponentIds || [],
    excludeComponentIds: options.excludeComponentIds || [],
  });

  const pluginName = options.pluginName || `ecc-${installPlan.profileId || 'custom'}`;
  if (!PLUGIN_NAME_PATTERN.test(pluginName)) {
    throw new Error(`Invalid plugin name "${pluginName}"; expected lowercase letters, digits, and hyphens`);
  }

  // The surface comes from the binding seam and nowhere else. When the
  // canonical context-profile registry is published, that file changes and
  // this call site does not. See context-profile.js.
  const contextProfile = resolveContextProfile(installPlan.profileId, {
    selectedModules: installPlan.selectedModules,
    repoRoot,
    expand: modules => expandSurface(modules, { repoRoot, hookDecision }),
  });
  const acc = contextProfile.expansion;
  const closure = resolveFullClosure(acc, repoRoot);

  // A dependency may itself be a held hook path, so the recorded decision is
  // derived after the closure is folded in, not before.
  coverDependencies(acc, closure, hookDecision !== null && hookDecision !== 'off');
  const decision = resolveHookDecisionState(hookDecision, acc.heldRuntimePaths);

  return assemblePlan({
    options, repoRoot, pluginName, installPlan, acc, closure, hookDecision, decision, contextProfile,
  });
}

/**
 * Everything about a plan and its staged surroundings that turns into a
 * refusal. `previewProfilePlugin` reports these; `generateProfilePlugin`
 * throws on any of them. Keeping them in one function is what makes
 * "preview says exactly what generate would do" checkable.
 *
 * @param {object} context Plan plus measured surroundings.
 * @returns {Array<string>} Blocker messages ([] when generation may proceed).
 */
function collectBlockers(context) {
  const { plan, symlinkPaths, ledger, pluginRoot } = context;
  const blockers = [];

  if (plan.hooks.decision === 'pending') {
    blockers.push(buildHookDecisionMessage());
  }
  if (plan.closure.unresolved.length > 0) {
    blockers.push('Unresolved runtime dependencies:\n'
      + plan.closure.unresolved.map(item => `  ${item.from} -> ${item.specifier}`).join('\n'));
  }
  if (symlinkPaths.length > 0) {
    blockers.push('Selected sources contain symlinks, which a generated carrier cannot own '
      + '(the tree digest that proves a carrier is unmodified does not see through them, '
      + 'so a link can be repointed after generation without detection):\n'
      + symlinkPaths.map(absPath => `  ${toPosix(path.relative(plan.repoRoot, absPath))}`).join('\n'));
  }
  if (!ledger.withinBudget && !context.allowOverBudget) {
    blockers.push(`Context ledger ${ledger.tokens} tokens exceeds the declared budget of ${ledger.budget} `
      + `(${ledger.method}@${ledger.methodVersion}). Narrow the selection, raise --budget, or pass --allow-over-budget.`);
  }
  if (context.existing && !context.existingIsGenerated && !context.force) {
    blockers.push(`Refusing to overwrite ${pluginRoot}: it is not an unmodified generated profile plugin `
      + `(${PROFILE_METADATA_FILE} missing, foreign, or its tree digest no longer matches). `
      + 'Choose another --name/--out, or pass --force to replace it.');
  }
  return blockers;
}

module.exports = {
  isHookRuntimePath,
  classifyModulePath,
  normalizeHookDecision,
  buildHookDecisionMessage,
  expandSurface,
  coverDependencies,
  collectBlockers,
  resolveCommandRuntimeClosure,
  resolvePluginProfilePlan,
};
