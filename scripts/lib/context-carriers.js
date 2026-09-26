'use strict';

const crypto = require('node:crypto');
const path = require('node:path');
const { compileContextProfile } = require('./context-profiles');
const { loadContextRegistry } = require('./context-pack-registry');
const {
  DEFAULT_REPO_ROOT, createSourceReader, digestObject, stableStringify,
  validateRelativePath, validateSchema,
} = require('./context-profile-support');

const INPUT_KEYS = new Set(['repoRoot', 'profileId', 'selectionMode', 'target', 'include', 'exclude']);
const LAYOUTS = Object.freeze({
  claude: { id: 'claude-plugin@1', skillRoot: 'skills', manifestPath: '.claude-plugin/plugin.json' },
  codex: { id: 'codex-plugin@1', skillRoot: 'skills', manifestPath: '.codex-plugin/plugin.json' },
  pi: { id: 'pi-package@1', skillRoot: 'skills', manifestPath: 'package.json' },
  opencode: { id: 'opencode-project@1', skillRoot: '.opencode/skills', manifestPath: null },
  cursor: { id: 'cursor-project@1', skillRoot: '.cursor/skills', manifestPath: null },
});
const SHA256 = /^[a-f0-9]{64}$/;
const NATIVE_NAME = /^[a-z0-9]+(?:-[a-z0-9]+)*$/;

function validateInput(options) {
  if (!options || typeof options !== 'object' || Array.isArray(options)) {
    throw new Error('Carrier options must be an object');
  }
  for (const key of Reflect.ownKeys(options)) {
    if (!INPUT_KEYS.has(key)) throw new Error(`Unknown carrier input option: ${String(key)}`);
  }
}

function adapterDigest() {
  const reader = createSourceReader(DEFAULT_REPO_ROOT);
  return digestObject(['scripts/lib/context-carriers.js', 'schemas/context-carrier.schema.json']
    .map(source => ({ path: source, digest: reader.read(source).digest })));
}

function validateEntryResources(entry) {
  if (!Array.isArray(entry.resources) || !entry.resources.length || !Array.isArray(entry.requiredResources)) {
    throw new Error(`Missing resource inventory or required-resource metadata: ${entry.id}`);
  }
  const sourceRoot = `skills/${entry.id.slice('skill:'.length)}`;
  if (entry.sourcePath !== `${sourceRoot}/SKILL.md`) {
    throw new Error(`Source resource is not the canonical skill entrypoint: ${entry.id}`);
  }
  const resources = new Set();
  for (const resource of entry.resources) {
    validateRelativePath(resource.path);
    if (!resource.path.startsWith(`${sourceRoot}/`)) throw new Error(`Resource must belong to ${sourceRoot}`);
    if (resources.has(resource.path)) throw new Error(`Duplicate source resource: ${resource.path}`);
    if (!SHA256.test(resource.digest) || !Number.isSafeInteger(resource.bytes) || resource.bytes < 0) {
      throw new Error(`Invalid resource digest or byte count: ${resource.path}`);
    }
    if (path.posix.basename(resource.path).toLowerCase() === 'skill.md' && resource.path !== entry.sourcePath) {
      throw new Error(`Nested or duplicate skill discovery entry: ${resource.path}`);
    }
    resources.add(resource.path);
  }
  for (const required of [entry.sourcePath, ...entry.requiredResources]) {
    validateRelativePath(required);
    if (!resources.has(required)) throw new Error(`Required resource missing from inventory: ${required}`);
  }
}

function selectedEntries(context, registry) {
  const byId = new Map(registry.entries.map(entry => [entry.id, entry]));
  const names = new Set();
  return context.selectedIds.map(id => {
    const entry = byId.get(id);
    if (!entry) throw new Error(`Selected skill missing from registry: ${id}`);
    if (typeof entry.name !== 'string' || entry.name.length > 64 || !NATIVE_NAME.test(entry.name)) {
      throw new Error(`Invalid portable native skill name: ${id}`);
    }
    if (names.has(entry.name)) throw new Error(`Duplicate native skill name: ${entry.name}`);
    names.add(entry.name);
    validateEntryResources(entry);
    return entry;
  });
}

function copyDescriptors(entries, layout) {
  return entries.flatMap(entry => {
    const sourceRoot = path.posix.dirname(entry.sourcePath);
    return entry.resources.map(resource => ({
      kind: 'copy', skillId: entry.id, sourcePath: resource.path,
      destinationPath: `${layout.skillRoot}/${entry.name}/${resource.path.slice(sourceRoot.length + 1)}`,
      digest: resource.digest, bytes: resource.bytes,
    }));
  });
}

// New, allowlisted discovery manifests. Never inherit source hooks, MCP, commands,
// package scripts, or Pi extensions. OpenCode/Cursor use native project directories.
function generatedManifest(target, layout) {
  if (!layout.manifestPath) return [];
  const name = 'ecc-context-carrier';
  const manifests = {
    claude: { name, skills: ['./skills/'] },
    codex: { name, skills: './skills/' },
    pi: { name, private: true, pi: { skills: ['./skills'] } },
  };
  const content = `${stableStringify(manifests[target])}\n`;
  return [{
    kind: 'generated', destinationPath: layout.manifestPath, content, encoding: 'utf8',
    digest: crypto.createHash('sha256').update(content, 'utf8').digest('hex'),
    bytes: Buffer.byteLength(content, 'utf8'),
  }];
}

function validateDestinations(files) {
  const destinations = new Set();
  const directories = new Map();
  for (const file of files) {
    validateRelativePath(file.destinationPath);
    const destination = file.destinationPath.normalize('NFC').toLowerCase();
    if (destinations.has(destination) || directories.has(destination)) {
      throw new Error(`Carrier destination collision: ${file.destinationPath}`);
    }
    const parts = file.destinationPath.split('/');
    for (let index = 1; index < parts.length; index++) {
      const originalAncestor = parts.slice(0, index).join('/');
      const ancestor = originalAncestor.normalize('NFC').toLowerCase();
      if (destinations.has(ancestor)) throw new Error(`Carrier file/directory collision: ${file.destinationPath}`);
      if (directories.has(ancestor) && directories.get(ancestor) !== originalAncestor) {
        throw new Error(`Carrier ancestor directory alias collision: ${file.destinationPath}`);
      }
      directories.set(ancestor, originalAncestor);
    }
    destinations.add(destination);
  }
}

/** Plan a skill-only carrier from canonical sources. Never write or invoke a host. */
function planContextCarrier(options = {}) {
  validateInput(options);
  const context = compileContextProfile(options);
  const registry = loadContextRegistry({ repoRoot: options.repoRoot || DEFAULT_REPO_ROOT });
  if (registry.registryDigest !== context.registryDigest) {
    throw new Error('Registry digest changed between context compilation and carrier planning');
  }
  const selected = selectedEntries(context, registry);
  const layout = LAYOUTS[context.target] || null;
  const files = layout ? [...copyDescriptors(selected, layout), ...generatedManifest(context.target, layout)] : [];
  validateDestinations(files);
  const value = {
    schemaVersion: 'ecc.context-carrier.v1', status: layout ? 'planned' : 'unsupported',
    active: false, disposition: 'proposed', nativeSupport: 'unobserved',
    target: context.target, profileId: context.profileId, selectionMode: context.selectionMode,
    registryDigest: context.registryDigest, profileDigest: context.profileDigest,
    compilerDigest: context.compilerDigest, planDigest: context.planDigest,
    adapterDigest: adapterDigest(), layout: layout ? { ...layout } : null,
    selectedIds: [...context.selectedIds], routedIds: [...context.routedIds], excludedIds: [...context.excludedIds],
    entries: selected.map(entry => ({
      id: entry.id, name: entry.name, sourcePath: entry.sourcePath, contentDigest: entry.contentDigest,
      requiredResources: [...entry.requiredResources],
      installSupport: entry.declaredInstallTargets.includes(context.target) ? 'declared' : 'not-declared',
    })),
    files: [...files].sort((left, right) => left.destinationPath < right.destinationPath ? -1 : 1),
    limitations: [
      'Read-only file proposal; no artifact was written, installed, activated, or loaded by a native host.',
      'Only selected whole skill trees are planned. Routed loading is unimplemented; no router or catalog bootstrap is added.',
      'Canonical skill IDs are retained; destination directories use validated native metadata names without rewriting source bytes.',
      'Owner-module install declarations are separate from source-backed layouts and do not certify native discovery.',
      'Explicit bundled resources are preserved; external runtime and prose workflow dependencies remain unreviewed.',
      'Source digests bind observed bytes, not an atomic snapshot. Materialization must revalidate every source descriptor.',
      'Native discovery, invocation, permissions, hooks, and whole-context token costs remain unobserved.',
      ...(layout ? [] : ['This recognized target has no implemented carrier layout; zero files are planned.']),
    ],
  };
  const carrier = { ...value, carrierDigest: digestObject(value) };
  validateSchema(carrier, 'context-carrier.schema.json');
  return carrier;
}

module.exports = { planContextCarrier };
