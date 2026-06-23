'use strict';

const { validateInstallModuleIds, LOCALE_ALIAS_TO_COMPONENT_ID, listSupportedLocales } = require('../install-manifests');

const LEGACY_INSTALL_TARGETS = ['claude', 'claude-project', 'cursor', 'antigravity'];

function dedupeStrings(values) {
  return [...new Set((Array.isArray(values) ? values : []).map(value => String(value).trim()).filter(Boolean))];
}

function normalizeSkillComponentIds(rawValue) {
  return dedupeStrings(String(rawValue || '').split(',')).map(value => (
    value.startsWith('skill:') ? value : `skill:${value}`
  ));
}

function parseInstallArgs(argv) {
  const args = argv.slice(2);
  const parsed = {
    target: null,
    dryRun: false,
    json: false,
    help: false,
    configPath: null,
    profileId: null,
    moduleIds: [],
    includeComponentIds: [],
    excludeComponentIds: [],
    languages: [],
    locale: null,
  };

  for (let index = 0; index < args.length; index += 1) {
    const arg = args[index];

    if (arg === '--target') {
      parsed.target = args[index + 1] || null;
      index += 1;
    } else if (arg === '--config') {
      parsed.configPath = args[index + 1] || null;
      index += 1;
    } else if (arg === '--profile') {
      parsed.profileId = args[index + 1] || null;
      index += 1;
    } else if (arg === '--modules') {
      const raw = args[index + 1] || '';
      parsed.moduleIds = dedupeStrings(raw.split(','));
      index += 1;
    } else if (arg === '--with') {
      const componentId = args[index + 1] || '';
      if (componentId.trim()) {
        parsed.includeComponentIds.push(componentId.trim());
      }
      index += 1;
    } else if (arg === '--skill' || arg === '--skills') {
      parsed.includeComponentIds.push(...normalizeSkillComponentIds(args[index + 1] || ''));
      index += 1;
    } else if (arg === '--without') {
      const componentId = args[index + 1] || '';
      if (componentId.trim()) {
        parsed.excludeComponentIds.push(componentId.trim());
      }
      index += 1;
    } else if (arg === '--locale') {
      const locale = args[index + 1] || '';
      if (!locale || locale.startsWith('--')) {
        throw new Error('Missing value for --locale');
      }
      parsed.locale = locale;
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
      parsed.languages.push(arg);
    }
  }

  return parsed;
}

function normalizeInstallRequest(options = {}) {
  const config = options.config && typeof options.config === 'object'
    ? options.config
    : null;
  const profileId = options.profileId || config?.profileId || null;
  const target = options.target || config?.target || 'claude';
  const moduleIds = validateInstallModuleIds(
    dedupeStrings([...(config?.moduleIds || []), ...(options.moduleIds || [])])
  );
  const locale = options.locale || config?.locale || null;
  const localeComponentId = locale ? LOCALE_ALIAS_TO_COMPONENT_ID[locale] : null;
  if (locale && !localeComponentId) {
    throw new Error(
      `Unsupported locale: "${locale}". Supported locales: ${listSupportedLocales().join(', ')}`
    );
  }
  if (locale && target !== 'claude' && target !== 'claude-project') {
    throw new Error('--locale can only be used with --target claude or --target claude-project');
  }
  const requestedIncludeComponentIds = dedupeStrings([
    ...(config?.includeComponentIds || []),
    ...(options.includeComponentIds || []),
  ]);
  const includeComponentIds = dedupeStrings([
    ...requestedIncludeComponentIds,
    ...(localeComponentId ? [localeComponentId] : []),
  ]);
  const excludeComponentIds = dedupeStrings([
    ...(config?.excludeComponentIds || []),
    ...(options.excludeComponentIds || []),
  ]);
  const legacyLanguages = dedupeStrings(dedupeStrings([
    ...(Array.isArray(options.legacyLanguages) ? options.legacyLanguages : []),
    ...(Array.isArray(options.languages) ? options.languages : []),
  ]).map(language => language.toLowerCase()));
  const hasManifestBaseSelection = Boolean(profileId) || moduleIds.length > 0 || includeComponentIds.length > 0;
  const hasNonLocaleManifestSelection = Boolean(profileId)
    || moduleIds.length > 0
    || requestedIncludeComponentIds.length > 0
    || excludeComponentIds.length > 0;
  const usingManifestMode = hasManifestBaseSelection || excludeComponentIds.length > 0;

  if (hasNonLocaleManifestSelection && legacyLanguages.length > 0) {
    throw new Error(
      'Legacy language arguments cannot be combined with --profile, --modules, --with, --without, or manifest config selections'
    );
  }

  if (!options.help && !hasManifestBaseSelection && legacyLanguages.length === 0) {
    throw new Error('No install profile, module IDs, included components, or legacy languages were provided');
  }

  return {
    mode: legacyLanguages.length > 0
      ? 'legacy-compat'
      : (usingManifestMode ? 'manifest' : 'legacy-compat'),
    target,
    profileId,
    moduleIds,
    includeComponentIds,
    excludeComponentIds,
    legacyLanguages,
    configPath: config?.path || options.configPath || null,
  };
}

module.exports = {
  LEGACY_INSTALL_TARGETS,
  normalizeInstallRequest,
  parseInstallArgs,
};
