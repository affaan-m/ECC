'use strict';

const fs = require('fs');
const path = require('path');

const { normalizeId } = require('./skill-flags');

const DEFAULT_REPO_ROOT = path.join(__dirname, '../..');
const PROFILE_RANK = Object.freeze({
  minimal: 0,
  standard: 1,
  full: 2,
});

function readJson(filePath, label) {
  try {
    return JSON.parse(fs.readFileSync(filePath, 'utf8'));
  } catch (error) {
    throw new Error(`Failed to read ${label}: ${error.message}`);
  }
}

function listCuratedSkillIds(repoRoot) {
  const skillsRoot = path.join(repoRoot, 'skills');
  if (!fs.existsSync(skillsRoot)) return [];

  return fs.readdirSync(skillsRoot, { withFileTypes: true })
    .filter(entry => (
      entry.isDirectory()
      && fs.existsSync(path.join(skillsRoot, entry.name, 'SKILL.md'))
    ))
    .map(entry => entry.name)
    .sort();
}

function skillIdFromModulePath(relativePath) {
  const normalized = String(relativePath || '').replace(/\\/g, '/').replace(/\/+$/, '');
  if (!normalized.startsWith('skills/')) return null;
  const skillId = normalized.slice('skills/'.length).split('/')[0];
  return skillId || null;
}

function indexSkillsByGroup(modules) {
  const skillToGroup = new Map();
  for (const module of Array.isArray(modules) ? modules : []) {
    for (const relativePath of module.paths || []) {
      const skillId = skillIdFromModulePath(relativePath);
      if (!skillId) continue;
      skillToGroup.set(skillId, module.id);
    }
  }
  return skillToGroup;
}

function loadSkillCatalog(options = {}) {
  const repoRoot = options.repoRoot || DEFAULT_REPO_ROOT;
  const profileManifest = options.profileManifest
    || readJson(
      path.join(repoRoot, 'manifests', 'skill-profiles.json'),
      'skill-profiles.json'
    );
  const modulesManifest = options.modulesManifest
    || readJson(
      path.join(repoRoot, 'manifests', 'install-modules.json'),
      'install-modules.json'
    );
  const skillIds = Array.isArray(options.skillIds)
    ? [...options.skillIds]
    : listCuratedSkillIds(repoRoot);
  const skillToGroup = indexSkillsByGroup(modulesManifest.modules);
  const groups = profileManifest.groups && typeof profileManifest.groups === 'object'
    ? { ...profileManifest.groups }
    : {};
  const minimalSkillIds = [...new Set(
    (Array.isArray(profileManifest.minimalSkills) ? profileManifest.minimalSkills : [])
      .map(id => String(id).trim())
      .filter(Boolean)
  )];

  return {
    repoRoot,
    defaultProfile: profileManifest.defaultProfile || 'standard',
    minimalSkillIds,
    groups,
    skills: skillIds.map(id => ({
      id,
      group: skillToGroup.get(id) || null,
    })),
  };
}

function normalizeIdList(values) {
  if (values instanceof Set) {
    return [...values].map(value => normalizeId(value)).filter(Boolean);
  }
  return (Array.isArray(values) ? values : [])
    .map(value => normalizeId(value))
    .filter(Boolean);
}

function groupProfile(catalog, groupId) {
  if (!groupId) return 'full';
  return catalog.groups[groupId] || 'full';
}

function isSkillSelected(skill, catalog, selection) {
  const skillId = normalizeId(skill.id);
  if (selection.disabledSkills.has(skillId)) return false;

  if (selection.extraSkills.has(skillId)) return true;

  const groupId = skill.group ? normalizeId(skill.group) : '';
  if (groupId && selection.disabledGroups.has(groupId)) return false;
  if (groupId && selection.enabledGroups.has(groupId)) return true;

  if (catalog.minimalSkillIds.some(id => normalizeId(id) === skillId)) return true;

  const requiredRank = PROFILE_RANK[groupProfile(catalog, skill.group)] ?? PROFILE_RANK.full;
  return requiredRank <= selection.profileRank;
}

function selectSkills(catalog, options = {}) {
  const profile = PROFILE_RANK[options.profile] !== undefined
    ? options.profile
    : catalog.defaultProfile;
  const selection = {
    profile,
    profileRank: PROFILE_RANK[profile] ?? PROFILE_RANK.standard,
    enabledGroups: new Set(normalizeIdList(options.enabledGroups)),
    disabledGroups: new Set(normalizeIdList(options.disabledGroups)),
    disabledSkills: new Set(normalizeIdList(options.disabledSkills)),
    extraSkills: new Set(normalizeIdList(options.extraSkills)),
  };

  const enabled = [];
  const disabled = [];
  for (const skill of catalog.skills) {
    if (isSkillSelected(skill, catalog, selection)) {
      enabled.push({ ...skill });
    } else {
      disabled.push({ ...skill });
    }
  }

  return {
    profile,
    enabled,
    disabled,
  };
}

function pluginSkillEntries(skillIds, profile) {
  if (profile === 'full') {
    return ['./skills/'];
  }

  return [...new Set((Array.isArray(skillIds) ? skillIds : []).filter(Boolean))]
    .sort()
    .map(skillId => `./skills/${skillId}/`);
}

function skillIdFromSourcePath(sourceRelativePath) {
  const normalized = String(sourceRelativePath || '').replace(/\\/g, '/');
  const match = normalized.match(/^skills\/([^/]+)/);
  return match ? match[1] : null;
}

function filterSkillInstallOperations(operations, selected) {
  const enabledIds = new Set(
    (selected.enabled || []).map(skill => skill.id)
  );
  return (Array.isArray(operations) ? operations : []).filter(operation => {
    const skillId = skillIdFromSourcePath(operation && operation.sourceRelativePath);
    return !skillId || enabledIds.has(skillId);
  });
}

function extraSkillIdsFromComponentIds(componentIds) {
  return (Array.isArray(componentIds) ? componentIds : [])
    .map(value => String(value || '').trim())
    .filter(value => value.startsWith('skill:'))
    .map(value => value.slice('skill:'.length))
    .filter(Boolean);
}

function resolveSkillSelection(options = {}) {
  const catalog = options.catalog || loadSkillCatalog(options);
  return selectSkills(catalog, {
    profile: options.profile,
    enabledGroups: options.enabledGroups,
    disabledGroups: options.disabledGroups,
    disabledSkills: options.disabledSkills,
    extraSkills: options.extraSkills,
  });
}

module.exports = {
  DEFAULT_REPO_ROOT,
  PROFILE_RANK,
  loadSkillCatalog,
  selectSkills,
  resolveSkillSelection,
  pluginSkillEntries,
  skillIdFromSourcePath,
  filterSkillInstallOperations,
  extraSkillIdsFromComponentIds,
};
