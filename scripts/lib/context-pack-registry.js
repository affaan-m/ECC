'use strict';

const fs = require('fs');
const path = require('path');
const yaml = require('js-yaml');
const {
  DEFAULT_REPO_ROOT, TARGETS, createSourceReader, digestObject, validateRelativePath,
  isExcludedResource, normalizeMetadataText, validateSchema, validateTarget,
} = require('./context-profile-support');

const REGISTRY_PATH = 'manifests/context-packs/skill-registry@1.json';
const TRIGGERS_PATH = 'manifests/context-packs/skill-triggers@1.json';
const ID_PATTERN = /^[a-z0-9]+(?:-[a-z0-9]+)*$/;

function validateModules(document) {
  if (!document || !Array.isArray(document.modules)) throw new Error('Install source requires a modules array');
  const ids = new Set();
  for (const module of document.modules) {
    if (!module || !ID_PATTERN.test(module.id)) throw new Error('Invalid install module ID');
    if (ids.has(module.id)) throw new Error(`Duplicate install module ID: ${module.id}`);
    ids.add(module.id);
    if (!Array.isArray(module.paths) || !Array.isArray(module.targets)) throw new Error(`Invalid module paths or targets: ${module.id}`);
    module.paths.forEach(validateRelativePath);
    module.targets.forEach(validateTarget);
  }
  return document.modules;
}

function discoverSkills(reader, root, names = reader.list(root)) {
  return names.filter(name => {
    const skillRoot = `${root}/${name}`;
    if (isExcludedResource(skillRoot)) return false;
    const absolute = reader.resolve(skillRoot);
    if (!fs.statSync(absolute).isDirectory()) return false;
    if (!ID_PATTERN.test(name)) throw new Error(`Invalid canonical skill ID: ${name}`);
    return reader.list(skillRoot).includes('SKILL.md');
  });
}

function parseMetadata(resource) {
  const source = resource.content.toString('utf8').replace(/^\uFEFF/, '').replace(/\r\n?/g, '\n');
  const match = source.match(/^---\n([\s\S]*?)\n---(?:\n|$)/);
  if (!match) throw new Error(`Missing skill metadata: ${resource.path}`);
  let metadata;
  try { metadata = yaml.load(match[1], { schema: yaml.JSON_SCHEMA }); } catch (error) {
    throw new Error(`Invalid skill metadata: ${resource.path}: ${error.message}`);
  }
  return Object.fromEntries(['name', 'description'].map(key => [
    key, normalizeMetadataText(metadata && metadata[key], `Skill ${key} (${resource.path})`),
  ]));
}

function indexedOverrides(overrides, ids) {
  const byId = new Map();
  for (const override of overrides) {
    if (!ids.has(override.id)) throw new Error(`Unknown override ID: ${override.id}`);
    if (byId.has(override.id)) throw new Error(`Duplicate override ID: ${override.id}`);
    byId.set(override.id, override);
  }
  return byId;
}

function validateDependencies(entries) {
  const byId = new Map(entries.map(entry => [entry.id, entry]));
  const visited = new Set();
  const visiting = new Set();
  function visit(id) {
    if (visited.has(id)) return;
    if (visiting.has(id)) throw new Error(`Dependency cycle at ${id}`);
    visiting.add(id);
    for (const dependency of byId.get(id).dependencies) {
      if (!byId.has(dependency)) throw new Error(`Unknown dependency ${dependency} for ${id}`);
      visit(dependency);
    }
    visiting.delete(id);
    visited.add(id);
  }
  entries.forEach(entry => visit(entry.id));
}

function buildEntry(reader, modules, root, name, override = {}) {
  const skillRoot = `${root}/${name}`;
  const sourcePath = `${skillRoot}/SKILL.md`;
  const owners = modules.filter(module => module.paths.some(source => sourcePath === source || sourcePath.startsWith(`${source}/`)));
  if (owners.length !== 1) throw new Error(`Skill ${name} requires exactly one owner; found ${owners.length}`);
  for (const resource of override.requiredResources || []) {
    validateRelativePath(resource);
    if (!resource.startsWith(`${skillRoot}/`)) throw new Error(`Required resource must belong to ${skillRoot}`);
    if (isExcludedResource(resource)) throw new Error(`Required resource is excluded from publication: ${resource}`);
    reader.read(resource);
  }
  const metadata = parseMetadata(reader.read(sourcePath));
  const resources = reader.walk(skillRoot).map(({ path: resourcePath, digest, bytes }) => ({
    path: resourcePath, digest, bytes,
  }));
  return {
    id: `skill:${name}`, kind: 'skill', sourcePath, ...metadata,
    ownerModuleId: owners[0].id, packId: owners[0].id,
    declaredInstallTargets: [...new Set(owners[0].targets)].sort(),
    dependencies: [...(override.dependencies || [])].sort(),
    requiredResources: [...(override.requiredResources || [])].sort(),
    dependencyCoverage: 'declared-only-unreviewed',
    resources, contentDigest: digestObject(resources),
  };
}

function loadContextRegistry({ repoRoot = DEFAULT_REPO_ROOT } = {}) {
  const reader = createSourceReader(repoRoot);
  const manifest = reader.json(REGISTRY_PATH);
  validateSchema(manifest, 'context-pack-registry.schema.json');
  const modules = validateModules(reader.json(manifest.inventory.source));
  const names = discoverSkills(reader, manifest.inventory.skillsRoot);
  const overrides = indexedOverrides(manifest.overrides, new Set(names.map(name => `skill:${name}`)));
  const entries = names.map(name => buildEntry(reader, modules, manifest.inventory.skillsRoot, name, overrides.get(`skill:${name}`)));
  validateDependencies(entries);
  const value = {
    schemaVersion: 'ecc.context-registry.v1', id: manifest.id,
    sourceDigests: [REGISTRY_PATH, manifest.inventory.source].map(source => ({ path: source, digest: reader.read(source).digest })),
    targets: [...TARGETS],
    packs: [...new Set(entries.map(entry => entry.packId))].sort().map(id => ({ id })),
    entries,
    excludedSurfaces: ['agents', 'commands', 'rules', 'hooks', 'mcp-schemas', 'harness-wrappers', 'learned-skills'],
    limitations: ['Only canonical skill discovery is inventoried.', 'Dependency declarations are incomplete until explicitly reviewed.', 'Aliases and capability activation are outside this schema.'],
  };
  return { ...value, registryDigest: digestObject(value) };
}

/** Throws unless a previously loaded registry still matches the current
 * declaration sources (registry manifest and install-module ownership) and
 * skill inventory. A caller reusing a registry snapshot must call this so a
 * changed dependency, required-resource, ownership, or inventory declaration
 * is rejected rather than silently served from the old snapshot. Skill and
 * resource bytes are verified separately when they are read. */
function assertRegistryCurrent(registry, { repoRoot = DEFAULT_REPO_ROOT } = {}) {
  if (!registry || registry.schemaVersion !== 'ecc.context-registry.v1'
    || !Array.isArray(registry.sourceDigests) || !Array.isArray(registry.entries)) {
    throw new Error('Invalid context registry');
  }
  const reader = createSourceReader(repoRoot);
  const manifest = reader.json(REGISTRY_PATH);
  const expectedSources = [REGISTRY_PATH, manifest.inventory.source];
  const recorded = registry.sourceDigests.map(source => source && source.path);
  if (recorded.length !== expectedSources.length || recorded.some((source, index) => source !== expectedSources[index])
    || registry.sourceDigests.some(source => reader.read(source.path).digest !== source.digest)) {
    throw new Error('Registry changed during task selection');
  }
  // One listing of the skills root; only names the snapshot lacks get the
  // per-directory skill check, so an unchanged inventory costs one readdir.
  const root = manifest.inventory.skillsRoot;
  const loaded = new Set(registry.entries.map(entry => entry.id));
  const listed = new Set(reader.list(root));
  const unknown = [...listed].filter(name => !loaded.has(`skill:${name}`));
  if ([...loaded].some(id => !listed.has(id.slice('skill:'.length))) || discoverSkills(reader, root, unknown).length) {
    throw new Error('Registry changed during task selection');
  }
}

function loadSkillTriggers({ repoRoot = DEFAULT_REPO_ROOT } = {}) {
  const file = path.join(repoRoot, TRIGGERS_PATH);
  if (!fs.existsSync(file) || !fs.statSync(file).isFile()) return { triggers: {}, manifest: null };
  let manifest;
  try { manifest = JSON.parse(fs.readFileSync(file, 'utf8')); }
  catch (error) { throw new Error(`Invalid skill triggers manifest: ${error.message}`); }
  if (!manifest || manifest.schemaVersion !== 1 || !manifest.triggers || typeof manifest.triggers !== 'object') {
    throw new Error('Invalid skill triggers manifest: expected schemaVersion 1 with a triggers object');
  }
  const triggers = {};
  for (const [id, list] of Object.entries(manifest.triggers)) {
    if (!Array.isArray(list) || !list.length) continue;
    triggers[id] = [...new Set(list.map(item => String(item).trim().toLowerCase()).filter(Boolean))];
  }
  return { triggers, manifest };
}

function projectionFor(entry, target) {
  return {
    installSupport: entry.declaredInstallTargets.includes(target) ? 'declared' : 'not-declared',
    nativeSupport: 'unobserved',
  };
}

function explainContextEntry({ repoRoot = DEFAULT_REPO_ROOT, id, target = 'codex' } = {}) {
  validateTarget(target);
  const registry = loadContextRegistry({ repoRoot });
  const entry = registry.entries.find(value => value.id === id);
  if (!entry) throw new Error(`Unknown context entry: ${id}`);
  return { ...entry, target, projection: projectionFor(entry, target), registryDigest: registry.registryDigest };
}

module.exports = { assertRegistryCurrent, explainContextEntry, loadContextRegistry, loadSkillTriggers, projectionFor };
