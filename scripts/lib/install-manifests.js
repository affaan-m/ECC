const fs = require('fs');
const os = require('os');
const path = require('path');
const { getInstallTargetAdapter, planInstallTargetScaffold } = require('./install-targets/registry');

const DEFAULT_REPO_ROOT = path.join(__dirname, '../..');
const SUPPORTED_INSTALL_TARGETS = ['claude', 'claude-project', 'cursor', 'antigravity', 'codex', 'gemini', 'opencode', 'codebuddy', 'joycode', 'qwen', 'zed'];
const COMPONENT_FAMILY_PREFIXES = {
  baseline: 'baseline:',
  language: 'lang:',
  framework: 'framework:',
  capability: 'capability:',
  agent: 'agent:',
  skill: 'skill:',
  locale: 'locale:',
};
const SUPPORTED_LOCALES = Object.freeze(['ja', 'zh-CN', 'ko-KR', 'pt-BR', 'ru', 'tr', 'vi-VN', 'zh-TW', 'de-DE']);
const LOCALE_ALIAS_TO_COMPONENT_ID = Object.freeze({
  'ja': 'locale:ja',
  'ja-JP': 'locale:ja',
  'zh-CN': 'locale:zh-cn',
  'zh': 'locale:zh-cn',
  'ko-KR': 'locale:ko-kr',
  'ko': 'locale:ko-kr',
  'pt-BR': 'locale:pt-br',
  'pt': 'locale:pt-br',
  'ru': 'locale:ru',
  'tr': 'locale:tr',
  'vi-VN': 'locale:vi-vn',
  'vi': 'locale:vi-vn',
  'zh-TW': 'locale:zh-tw',
  'de-DE': 'locale:de-de',
  'de': 'locale:de-de',
});

function listSupportedLocales() {
  return [...SUPPORTED_LOCALES];
}
const LEGACY_COMPAT_BASE_MODULE_IDS_BY_TARGET = Object.freeze({
  claude: [
    'rules-core',
    'agents-core',
    'commands-core',
    'hooks-runtime',
    'platform-configs',
    'workflow-quality',
  ],
  'claude-project': [
    'rules-core',
    'agents-core',
    'commands-core',
    'hooks-runtime',
    'platform-configs',
    'workflow-quality',
  ],
  cursor: [
    'rules-core',
    'agents-core',
    'commands-core',
    'hooks-runtime',
    'platform-configs',
    'workflow-quality',
  ],
  antigravity: [
    'rules-core',
    'agents-core',
    'commands-core',
  ],
  zed: [
    'rules-core',
    'agents-core',
    'commands-core',
    'platform-configs',
    'workflow-quality',
  ],
});
const LEGACY_LANGUAGE_ALIAS_TO_CANONICAL = Object.freeze({
  c: 'c',
  cpp: 'cpp',
  csharp: 'csharp',
  fsharp: 'fsharp',
  go: 'go',
  golang: 'go',
  arkts: 'arkts',
  harmonyos: 'arkts',
  java: 'java',
  javascript: 'typescript',
  kotlin: 'java',
  perl: 'perl',
  php: 'php',
  python: 'python',
  rails: 'ruby',
  ruby: 'ruby',
  rust: 'rust',
  swift: 'swift',
  typescript: 'typescript',
});
const LEGACY_LANGUAGE_EXTRA_MODULE_IDS = Object.freeze({
  c: ['framework-language'],
  cpp: ['framework-language'],
  csharp: ['framework-language'],
  fsharp: ['framework-language'],
  go: ['framework-language'],
  arkts: ['framework-language'],
  java: ['framework-language'],
  perl: [],
  php: [],
  python: ['framework-language'],
  ruby: ['framework-language', 'security'],
  rust: ['framework-language'],
  swift: [],
  typescript: ['framework-language'],
});
const TARGET_DEFAULT_PROFILE_IDS = Object.freeze({
  opencode: 'opencode',
});
const TARGET_DEFAULT_EXCLUSIONS = Object.freeze({
  opencode: [
    {
      moduleId: 'hooks-runtime',
      reason: 'OpenCode defaults intentionally exclude hooks-runtime until users opt in.',
      optInCommand: './install.sh --target opencode --modules hooks-runtime',
    },
  ],
});

function readJson(filePath, label) {
  try {
    return JSON.parse(fs.readFileSync(filePath, 'utf8'));
  } catch (error) {
    throw new Error(`Failed to read ${label}: ${error.message}`);
  }
}

function dedupeStrings(values) {
  return [...new Set((Array.isArray(values) ? values : []).map(value => String(value).trim()).filter(Boolean))];
}

function listSkillDirectoryIds(repoRoot) {
  const skillsRoot = path.join(repoRoot, 'skills');
  if (!fs.existsSync(skillsRoot) || !fs.statSync(skillsRoot).isDirectory()) {
    return [];
  }

  return fs.readdirSync(skillsRoot, { withFileTypes: true })
    .filter(entry => entry.isDirectory())
    .map(entry => entry.name)
    .sort();
}

function addSyntheticSkillComponents({ repoRoot, modules, components }) {
  const moduleIds = new Set(modules.map(module => module.id));
  const componentIds = new Set(components.map(component => component.id));

  for (const skillId of listSkillDirectoryIds(repoRoot)) {
    const componentId = `skill:${skillId}`;
    if (componentIds.has(componentId)) {
      continue;
    }

    const moduleId = `skill-${skillId}`;
    if (!moduleIds.has(moduleId)) {
      modules.push({
        id: moduleId,
        kind: 'skills',
        description: `Single-skill install surface for ${skillId}.`,
        paths: [`skills/${skillId}`],
        targets: SUPPORTED_INSTALL_TARGETS.slice(),
        dependencies: [],
        defaultInstall: false,
        cost: 'light',
        stability: 'stable',
        synthetic: true,
      });
      moduleIds.add(moduleId);
    }

    components.push({
      id: componentId,
      family: 'skill',
      description: `Install only the ${skillId} skill directory.`,
      modules: [moduleId],
      synthetic: true,
    });
    componentIds.add(componentId);
  }
}

function readOptionalStringOption(options, key) {
  if (
    !Object.prototype.hasOwnProperty.call(options, key)
    || options[key] === null
    || options[key] === undefined
  ) {
    return null;
  }

  if (typeof options[key] !== 'string' || options[key].trim() === '') {
    throw new Error(`${key} must be a non-empty string when provided`);
  }

  return options[key];
}

function readModuleTargetsOrThrow(module) {
  const moduleId = module && module.id ? module.id : '<unknown>';
  const targets = module && module.targets;

  if (!Array.isArray(targets)) {
    throw new Error(`Install module ${moduleId} has invalid targets; expected an array of supported target ids`);
  }

  const normalizedTargets = targets.map(target => (
    typeof target === 'string' ? target.trim() : ''
  ));

  if (normalizedTargets.some(target => target.length === 0)) {
    throw new Error(`Install module ${moduleId} has invalid targets; expected an array of supported target ids`);
  }

  const unsupportedTargets = normalizedTargets.filter(target => !SUPPORTED_INSTALL_TARGETS.includes(target));
  if (unsupportedTargets.length > 0) {
    throw new Error(
      `Install module ${moduleId} has unsupported targets: ${unsupportedTargets.join(', ')}`
    );
  }

  return normalizedTargets;
}

function assertKnownModuleIds(moduleIds, manifests) {
  const unknownModuleIds = dedupeStrings(moduleIds)
    .filter(moduleId => !manifests.modulesById.has(moduleId));

  if (unknownModuleIds.length === 1) {
    throw new Error(`Unknown install module: ${unknownModuleIds[0]}`);
  }

  if (unknownModuleIds.length > 1) {
    throw new Error(`Unknown install modules: ${unknownModuleIds.join(', ')}`);
  }
}

function intersectTargets(modules) {
  if (!Array.isArray(modules) || modules.length === 0) {
    return [];
  }

  return SUPPORTED_INSTALL_TARGETS.filter(target => (
    modules.every(module => Array.isArray(module.targets) && module.targets.includes(target))
  ));
}

function getManifestPaths(repoRoot = DEFAULT_REPO_ROOT) {
  return {
    modulesPath: path.join(repoRoot, 'manifests', 'install-modules.json'),
    profilesPath: path.join(repoRoot, 'manifests', 'install-profiles.json'),
    componentsPath: path.join(repoRoot, 'manifests', 'install-components.json'),
  };
}

function loadInstallManifests(options = {}) {
  const repoRoot = options.repoRoot || DEFAULT_REPO_ROOT;
  const { modulesPath, profilesPath, componentsPath } = getManifestPaths(repoRoot);

  if (!fs.existsSync(modulesPath) || !fs.existsSync(profilesPath)) {
    throw new Error(`Install manifests not found under ${repoRoot}`);
  }

  const modulesData = readJson(modulesPath, 'install-modules.json');
  const profilesData = readJson(profilesPath, 'install-profiles.json');
  const componentsData = fs.existsSync(componentsPath)
    ? readJson(componentsPath, 'install-components.json')
    : { version: null, components: [] };
  const modules = Array.isArray(modulesData.modules) ? modulesData.modules.slice() : [];
  const profiles = profilesData && typeof profilesData.profiles === 'object'
    ? profilesData.profiles
    : {};
  const components = Array.isArray(componentsData.components) ? componentsData.components.slice() : [];

  addSyntheticSkillComponents({ repoRoot, modules, components });

  for (const module of modules) {
    readModuleTargetsOrThrow(module);
  }

  const modulesById = new Map(modules.map(module => [module.id, module]));
  const componentsById = new Map(components.map(component => [component.id, component]));

  return {
    repoRoot,
    modulesPath,
    profilesPath,
    componentsPath,
    modules,
    profiles,
    components,
    modulesById,
    componentsById,
    modulesVersion: modulesData.version,
    profilesVersion: profilesData.version,
    componentsVersion: componentsData.version,
  };
}

function listInstallProfiles(options = {}) {
  const manifests = loadInstallManifests(options);
  return Object.entries(manifests.profiles).map(([id, profile]) => ({
    id,
    description: profile.description,
    moduleCount: Array.isArray(profile.modules) ? profile.modules.length : 0,
  }));
}

function listInstallModules(options = {}) {
  const manifests = loadInstallManifests(options);
  return manifests.modules.map(module => ({
    id: module.id,
    kind: module.kind,
    description: module.description,
    targets: module.targets,
    defaultInstall: module.defaultInstall,
    cost: module.cost,
    stability: module.stability,
    dependencyCount: Array.isArray(module.dependencies) ? module.dependencies.length : 0,
  }));
}

function listLegacyCompatibilityLanguages() {
  return Object.keys(LEGACY_LANGUAGE_ALIAS_TO_CANONICAL).sort();
}

function validateInstallModuleIds(moduleIds, options = {}) {
  const manifests = loadInstallManifests(options);
  const normalizedModuleIds = dedupeStrings(moduleIds);
  assertKnownModuleIds(normalizedModuleIds, manifests);
  return normalizedModuleIds;
}

function listInstallComponents(options = {}) {
  const manifests = loadInstallManifests(options);
  const family = options.family || null;
  const target = options.target || null;

  if (family && !Object.hasOwn(COMPONENT_FAMILY_PREFIXES, family)) {
    throw new Error(
      `Unknown component family: ${family}. Expected one of ${Object.keys(COMPONENT_FAMILY_PREFIXES).join(', ')}`
    );
  }

  if (target && !SUPPORTED_INSTALL_TARGETS.includes(target)) {
    throw new Error(
      `Unknown install target: ${target}. Expected one of ${SUPPORTED_INSTALL_TARGETS.join(', ')}`
    );
  }

  return manifests.components
    .filter(component => !family || component.family === family)
    .map(component => {
      const moduleIds = dedupeStrings(component.modules);
      const modules = moduleIds
        .map(moduleId => manifests.modulesById.get(moduleId))
        .filter(Boolean);
      const targets = intersectTargets(modules);

      return {
        id: component.id,
        family: component.family,
        description: component.description,
        moduleIds,
        moduleCount: moduleIds.length,
        targets,
      };
    })
    .filter(component => !target || component.targets.includes(target));
}

function getInstallComponent(componentId, options = {}) {
  const manifests = loadInstallManifests(options);
  const normalizedComponentId = String(componentId || '').trim();

  if (!normalizedComponentId) {
    throw new Error('An install component ID is required');
  }

  const component = manifests.componentsById.get(normalizedComponentId);
  if (!component) {
    throw new Error(`Unknown install component: ${normalizedComponentId}`);
  }

  const moduleIds = dedupeStrings(component.modules);
  const modules = moduleIds
    .map(moduleId => manifests.modulesById.get(moduleId))
    .filter(Boolean)
    .map(module => ({
      id: module.id,
      kind: module.kind,
      description: module.description,
      targets: module.targets,
      defaultInstall: module.defaultInstall,
      cost: module.cost,
      stability: module.stability,
      dependencies: dedupeStrings(module.dependencies),
    }));

  return {
    id: component.id,
    family: component.family,
    description: component.description,
    moduleIds,
    moduleCount: moduleIds.length,
    targets: intersectTargets(modules),
    modules,
  };
}

function expandComponentIdsToModuleIds(componentIds, manifests) {
  const expandedModuleIds = [];

  for (const componentId of dedupeStrings(componentIds)) {
    const component = manifests.componentsById.get(componentId);
    if (!component) {
      throw new Error(`Unknown install component: ${componentId}`);
    }
    expandedModuleIds.push(...component.modules);
  }

  return dedupeStrings(expandedModuleIds);
}

function getTargetDefaultProfileId(target, manifests) {
  const profileId = target ? TARGET_DEFAULT_PROFILE_IDS[target] : null;
  return profileId && manifests.profiles[profileId] ? profileId : null;
}

function getTargetDefaultExclusions(target, manifests) {
  const exclusions = target ? TARGET_DEFAULT_EXCLUSIONS[target] : null;
  if (!Array.isArray(exclusions)) {
    return [];
  }

  return exclusions
    .filter(exclusion => manifests.modulesById.has(exclusion.moduleId))
    .map(exclusion => ({ ...exclusion }));
}

function resolveLegacyCompatibilitySelection(options = {}) {
  const manifests = loadInstallManifests(options);
  const target = options.target || null;

  if (target && !SUPPORTED_INSTALL_TARGETS.includes(target)) {
    throw new Error(
      `Unknown install target: ${target}. Expected one of ${SUPPORTED_INSTALL_TARGETS.join(', ')}`
    );
  }

  const legacyLanguages = dedupeStrings(options.legacyLanguages)
    .map(language => language.toLowerCase());
  const normalizedLegacyLanguages = dedupeStrings(legacyLanguages);

  if (normalizedLegacyLanguages.length === 0) {
    throw new Error('No legacy languages were provided');
  }

  const unknownLegacyLanguages = normalizedLegacyLanguages
    .filter(language => !Object.hasOwn(LEGACY_LANGUAGE_ALIAS_TO_CANONICAL, language));

  if (unknownLegacyLanguages.length === 1) {
    throw new Error(
      `Unknown legacy language: ${unknownLegacyLanguages[0]}. Expected one of ${listLegacyCompatibilityLanguages().join(', ')}`
    );
  }

  if (unknownLegacyLanguages.length > 1) {
    throw new Error(
      `Unknown legacy languages: ${unknownLegacyLanguages.join(', ')}. Expected one of ${listLegacyCompatibilityLanguages().join(', ')}`
    );
  }

  const canonicalLegacyLanguages = normalizedLegacyLanguages
    .map(language => LEGACY_LANGUAGE_ALIAS_TO_CANONICAL[language]);
  const baseModuleIds = LEGACY_COMPAT_BASE_MODULE_IDS_BY_TARGET[target || 'claude']
    || LEGACY_COMPAT_BASE_MODULE_IDS_BY_TARGET.claude;
  const moduleIds = dedupeStrings([
    ...baseModuleIds,
    ...(target === 'antigravity'
      ? []
      : canonicalLegacyLanguages.flatMap(language => LEGACY_LANGUAGE_EXTRA_MODULE_IDS[language] || [])),
  ]);

  assertKnownModuleIds(moduleIds, manifests);

  return {
    legacyLanguages: normalizedLegacyLanguages,
    canonicalLegacyLanguages,
    moduleIds,
  };
}

function resolveInstallPlan(options = {}) {
  const manifests = loadInstallManifests(options);
  const requestedProfileId = options.profileId || null;
  const explicitModuleIds = dedupeStrings(options.moduleIds);
  const includedComponentIds = dedupeStrings(options.includeComponentIds);
  const excludedComponentIds = dedupeStrings(options.excludeComponentIds);
  const requestedModuleIds = [];
  const target = options.target || null;

  if (target && !SUPPORTED_INSTALL_TARGETS.includes(target)) {
    throw new Error(
      `Unknown install target: ${target}. Expected one of ${SUPPORTED_INSTALL_TARGETS.join(', ')}`
    );
  }

  const shouldUseTargetDefaultProfile = !requestedProfileId
    && explicitModuleIds.length === 0
    && includedComponentIds.length === 0;
  const targetDefaultProfileId = shouldUseTargetDefaultProfile
    ? getTargetDefaultProfileId(target, manifests)
    : null;
  const profileId = requestedProfileId || targetDefaultProfileId;
  const targetDefaultExclusions = targetDefaultProfileId
    ? getTargetDefaultExclusions(target, manifests)
    : [];

  if (profileId) {
    const profile = manifests.profiles[profileId];
    if (!profile) {
      throw new Error(`Unknown install profile: ${profileId}`);
    }
    requestedModuleIds.push(...profile.modules);
  }

  requestedModuleIds.push(...explicitModuleIds);
  requestedModuleIds.push(...expandComponentIdsToModuleIds(includedComponentIds, manifests));

  const excludedModuleIds = expandComponentIdsToModuleIds(excludedComponentIds, manifests);
  const excludedModuleOwners = new Map();
  for (const componentId of excludedComponentIds) {
    const component = manifests.componentsById.get(componentId);
    if (!component) {
      throw new Error(`Unknown install component: ${componentId}`);
    }
    for (const moduleId of component.modules) {
      const owners = excludedModuleOwners.get(moduleId) || [];
      owners.push(componentId);
      excludedModuleOwners.set(moduleId, owners);
    }
  }
  for (const exclusion of targetDefaultExclusions) {
    const owners = excludedModuleOwners.get(exclusion.moduleId) || [];
    owners.push(`${target} default`);
    excludedModuleOwners.set(exclusion.moduleId, owners);
  }

  const validatedProjectRoot = readOptionalStringOption(options, 'projectRoot');
  const validatedHomeDir = readOptionalStringOption(options, 'homeDir');
  const targetPlanningInput = target
    ? {
      repoRoot: manifests.repoRoot,
      projectRoot: validatedProjectRoot || manifests.repoRoot,
      homeDir: validatedHomeDir || os.homedir(),
    }
    : null;
  const targetAdapter = target ? getInstallTargetAdapter(target) : null;

  const effectiveRequestedIds = dedupeStrings(
    requestedModuleIds.filter(moduleId => !excludedModuleOwners.has(moduleId))
  );

  if (requestedModuleIds.length === 0) {
    throw new Error('No install profile, module IDs, or included component IDs were provided');
  }

  if (effectiveRequestedIds.length === 0) {
    throw new Error('Selection excludes every requested install module');
  }

  const selectedIds = new Set();
  const skippedTargetIds = new Set();
  const excludedIds = new Set([
    ...excludedModuleIds,
    ...targetDefaultExclusions.map(exclusion => exclusion.moduleId),
  ]);
  const visitingIds = new Set();
  const resolvedIds = new Set();

  function resolveModule(moduleId, dependencyOf, rootRequesterId) {
    const module = manifests.modulesById.get(moduleId);
    if (!module) {
      throw new Error(`Unknown install module: ${moduleId}`);
    }

    if (excludedModuleOwners.has(moduleId)) {
      if (dependencyOf) {
        const owners = excludedModuleOwners.get(moduleId) || [];
        throw new Error(
          `Module ${dependencyOf} depends on excluded module ${moduleId}${owners.length > 0 ? ` (excluded by ${owners.join(', ')})` : ''}`
        );
      }
      return;
    }

    const supportsTarget = !target
      || (
        readModuleTargetsOrThrow(module).includes(target)
        && (!targetAdapter || targetAdapter.supportsModule(module, targetPlanningInput))
      );

    if (!supportsTarget) {
      if (dependencyOf) {
        skippedTargetIds.add(rootRequesterId || dependencyOf);
        return false;
      }
      skippedTargetIds.add(moduleId);
      return false;
    }

    if (resolvedIds.has(moduleId)) {
      return true;
    }

    if (visitingIds.has(moduleId)) {
      throw new Error(`Circular install dependency detected at ${moduleId}`);
    }

    visitingIds.add(moduleId);
    for (const dependencyId of module.dependencies) {
      const dependencyResolved = resolveModule(
        dependencyId,
        moduleId,
        rootRequesterId || moduleId
      );
      if (!dependencyResolved) {
        visitingIds.delete(moduleId);
        if (!dependencyOf) {
          skippedTargetIds.add(moduleId);
        }
        return false;
      }
    }
    visitingIds.delete(moduleId);
    resolvedIds.add(moduleId);
    selectedIds.add(moduleId);
    return true;
  }

  for (const moduleId of effectiveRequestedIds) {
    resolveModule(moduleId, null, moduleId);
  }

  const selectedModules = manifests.modules.filter(module => selectedIds.has(module.id));
  const skippedModules = manifests.modules.filter(module => skippedTargetIds.has(module.id));
  const excludedModules = manifests.modules.filter(module => excludedIds.has(module.id));
  const scaffoldPlan = target
    ? planInstallTargetScaffold({
      target,
      repoRoot: targetPlanningInput.repoRoot,
      projectRoot: targetPlanningInput.projectRoot,
      homeDir: targetPlanningInput.homeDir,
      modules: selectedModules,
    })
    : null;

  return {
    repoRoot: manifests.repoRoot,
    profileId,
    target,
    requestedModuleIds: effectiveRequestedIds,
    explicitModuleIds,
    includedComponentIds,
    excludedComponentIds,
    targetDefaultProfileId,
    targetDefaultExclusions,
    warnings: targetDefaultExclusions.map(exclusion => (
      `${exclusion.moduleId} is intentionally excluded from the OpenCode default. `
        + `Opt in with: ${exclusion.optInCommand}`
    )),
    selectedModuleIds: selectedModules.map(module => module.id),
    skippedModuleIds: skippedModules.map(module => module.id),
    excludedModuleIds: excludedModules.map(module => module.id),
    selectedModules,
    skippedModules,
    excludedModules,
    targetAdapterId: scaffoldPlan ? scaffoldPlan.adapter.id : null,
    targetRoot: scaffoldPlan ? scaffoldPlan.targetRoot : null,
    installStatePath: scaffoldPlan ? scaffoldPlan.installStatePath : null,
    operations: scaffoldPlan ? scaffoldPlan.operations : [],
  };
}

module.exports = {
  DEFAULT_REPO_ROOT,
  SUPPORTED_INSTALL_TARGETS,
  SUPPORTED_LOCALES,
  LOCALE_ALIAS_TO_COMPONENT_ID,
  getManifestPaths,
  loadInstallManifests,
  getInstallComponent,
  listInstallComponents,
  listLegacyCompatibilityLanguages,
  listSupportedLocales,
  listInstallModules,
  listInstallProfiles,
  resolveInstallPlan,
  resolveLegacyCompatibilitySelection,
  validateInstallModuleIds,
};
