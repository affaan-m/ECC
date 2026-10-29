'use strict';

// Acceptance infrastructure only. It cannot install into a caller-chosen directory.
// Staging assumes a trusted, private temporary parent until the callback starts.
// These tests do not certify an arbitrary-destination writer against concurrent
// mutation, nor provide an atomic source snapshot or a native harness sandbox.
const assert = require('node:assert/strict');
const crypto = require('node:crypto');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const Ajv = require('ajv');
const { loadContextRegistry } = require('../../../scripts/lib/context-pack-registry');
const { compileContextProfile } = require('../../../scripts/lib/context-profiles');
const {
  DEFAULT_REPO_ROOT, createSourceReader, digestObject, validateRelativePath,
} = require('../../../scripts/lib/context-profile-support');

// Independent acceptance oracle, deliberately not imported from the generator.
const LAYOUTS = {
  claude: { id: 'claude-plugin@1', skillRoot: 'skills', manifestPath: '.claude-plugin/plugin.json' },
  codex: { id: 'codex-plugin@1', skillRoot: 'skills', manifestPath: '.codex-plugin/plugin.json' },
  pi: { id: 'pi-package@1', skillRoot: 'skills', manifestPath: 'package.json' },
  opencode: { id: 'opencode-project@1', skillRoot: '.opencode/skills', manifestPath: null },
  cursor: { id: 'cursor-project@1', skillRoot: '.cursor/skills', manifestPath: null },
};
const MANIFESTS = {
  claude: { name: 'ecc-context-carrier', skills: ['./skills/'] },
  codex: { name: 'ecc-context-carrier', skills: './skills/' },
  pi: { name: 'ecc-context-carrier', private: true, pi: { skills: ['./skills'] } },
};

function sha256(value) {
  return crypto.createHash('sha256').update(value).digest('hex');
}

function checkDigest(value, key, label) {
  assert.ok(value && typeof value === 'object', `${label} must be an object`);
  const { [key]: declared, ...body } = value;
  assert.match(declared || '', /^[a-f0-9]{64}$/, `${label} digest is missing`);
  assert.equal(declared, digestObject(body), `${label} digest mismatch`);
}

function schemaCheck(artifact) {
  const reader = createSourceReader(DEFAULT_REPO_ROOT);
  const schema = reader.json('schemas/context-carrier.schema.json');
  const validate = new Ajv({ strict: true, allErrors: true }).compile(schema);
  assert.ok(validate(artifact), `Invalid carrier schema: ${JSON.stringify(validate.errors)}`);
  checkDigest(artifact, 'carrierDigest', 'Carrier');
  const sources = ['scripts/lib/context-carriers.js', 'schemas/context-carrier.schema.json'];
  const adapterDigest = digestObject(sources.map(source => ({ path: source, digest: reader.read(source).digest })));
  assert.equal(artifact.adapterDigest, adapterDigest, 'Adapter source digest mismatch');
}

function checkExpectedPlan(repoRoot, expectedPlan) {
  checkDigest(expectedPlan, 'planDigest', 'Expected plan');
  assert.equal(expectedPlan.schemaVersion, 'ecc.context-plan.v1', 'Unexpected plan schema');
  assert.ok(Array.isArray(expectedPlan.entries), 'Expected plan entries are missing');
  // Derive explicit additions from the canonical plan reasons, then independently
  // compile. Dependency additions and redundant includes already selected by the
  // base retain their original deterministic reasons and need no reconstruction.
  const include = expectedPlan.entries.filter(entry => entry.reason === 'Explicitly included').map(entry => entry.id);
  const observedPlan = compileContextProfile({
    repoRoot, profileId: expectedPlan.profileId, target: expectedPlan.target,
    selectionMode: expectedPlan.selectionMode, include, exclude: expectedPlan.excludedIds,
  });
  assert.deepEqual(observedPlan, expectedPlan, 'Expected plan source binding or digest changed');
  return observedPlan;
}

function checkBindings(artifact, expectedPlan, registry) {
  for (const field of ['target', 'profileId', 'selectionMode', 'registryDigest', 'profileDigest', 'compilerDigest', 'planDigest']) {
    assert.equal(artifact[field], expectedPlan[field], `Carrier ${field} binding mismatch`);
  }
  for (const field of ['selectedIds', 'routedIds', 'excludedIds']) {
    assert.deepEqual(artifact[field], expectedPlan[field], `Carrier ${field} selection mismatch`);
  }
  assert.equal(registry.registryDigest, expectedPlan.registryDigest, 'Source registry digest changed');
  assert.equal(artifact.active, false, 'Carrier cannot claim active state');
  assert.equal(artifact.disposition, 'proposed', 'Carrier must remain proposed');
  assert.equal(artifact.nativeSupport, 'unobserved', 'Native support is unobserved');
  assert.equal(artifact.status, 'planned', 'Unsupported carrier cannot be materialized');
  assert.ok(Object.hasOwn(LAYOUTS, artifact.target), 'Unsupported carrier layout');
  assert.deepEqual(artifact.layout, LAYOUTS[artifact.target], 'Carrier layout mismatch');
}

function checkDestinations(files) {
  const nodes = new Map();
  for (const file of files) {
    validateRelativePath(file.destinationPath);
    const parts = file.destinationPath.split('/');
    for (let index = 1; index <= parts.length; index++) {
      const spelling = parts.slice(0, index).join('/');
      const portableKey = spelling.normalize('NFC').toLowerCase();
      const kind = index === parts.length ? 'file' : 'directory';
      const previous = nodes.get(portableKey);
      if (previous) {
        assert.equal(previous.spelling, spelling, 'Portable ancestor spelling alias collision');
        assert.equal(previous.kind, kind, 'Destination file/directory collision');
        assert.equal(kind, 'directory', 'Duplicate file destination collision');
      } else nodes.set(portableKey, { spelling, kind });
    }
  }
}

function expectedEntries(selected, target) {
  return selected.map(entry => {
    assert.ok(Array.isArray(entry.requiredResources), 'Required-resource declarations missing');
    return {
      id: entry.id, name: entry.name, sourcePath: entry.sourcePath,
      contentDigest: entry.contentDigest, requiredResources: [...entry.requiredResources],
      installSupport: entry.declaredInstallTargets.includes(target) ? 'declared' : 'not-declared',
    };
  });
}

function expectedCopies(selected, layout) {
  return selected.flatMap(entry => {
    assert.match(entry.name, /^[a-z0-9]+(?:-[a-z0-9]+)*$/, 'Invalid native name');
    assert.ok(entry.name.length <= 64, 'Invalid native name length');
    const sourceRoot = path.posix.dirname(entry.sourcePath);
    const paths = new Set(entry.resources.map(resource => resource.path));
    assert.ok(paths.has(entry.sourcePath), 'Missing selected source entrypoint');
    for (const required of entry.requiredResources) assert.ok(paths.has(required), 'Missing required resource');
    return entry.resources.map(resource => {
      validateRelativePath(resource.path);
      assert.ok(resource.path.startsWith(`${sourceRoot}/`), 'Resource source is outside its skill');
      const relative = resource.path.slice(sourceRoot.length + 1);
      assert.ok(relative.toLowerCase() !== 'skill.md' || relative === 'SKILL.md', 'Unexpected discovery entrypoint');
      assert.ok(!relative.includes('/') || path.posix.basename(relative).toLowerCase() !== 'skill.md',
        'Nested discovery entrypoint is forbidden');
      return { kind: 'copy', skillId: entry.id, sourcePath: resource.path,
        destinationPath: `${layout.skillRoot}/${entry.name}/${relative}`, digest: resource.digest, bytes: resource.bytes };
    });
  });
}

function pinGenerated(artifact) {
  const files = artifact.files.filter(file => file.kind === 'generated');
  const manifest = MANIFESTS[artifact.target];
  assert.equal(files.length, manifest ? 1 : 0, 'Generated manifest file set mismatch');
  return files.map(file => {
    assert.equal(file.destinationPath, artifact.layout.manifestPath, 'Generated manifest destination mismatch');
    assert.equal(file.encoding, 'utf8', 'Generated manifest encoding mismatch');
    assert.deepEqual(JSON.parse(file.content), manifest, 'Generated manifest contains unexpected discovery or authority fields');
    const content = Buffer.from(file.content, 'utf8');
    assert.equal(file.bytes, content.length, 'Generated byte count mismatch');
    assert.equal(file.digest, sha256(content), 'Generated digest mismatch');
    return { path: file.destinationPath, bytes: content.length, digest: file.digest, content };
  });
}

function prepare(options) {
  assert.ok(options && typeof options === 'object', 'Fixture options are required');
  for (const key of Object.keys(options)) {
    assert.ok(['repoRoot', 'artifact', 'expectedPlan'].includes(key), `Unknown fixture option: ${key}`);
  }
  schemaCheck(options.artifact);
  const artifact = JSON.parse(JSON.stringify(options.artifact));
  const expectedPlan = checkExpectedPlan(options.repoRoot, options.expectedPlan);
  const registry = loadContextRegistry({ repoRoot: options.repoRoot });
  checkBindings(artifact, expectedPlan, registry);
  checkDestinations(artifact.files);
  const selected = expectedPlan.selectedIds.map(id => {
    const entry = registry.entries.find(value => value.id === id);
    assert.ok(entry, 'Selected registry entry missing');
    return entry;
  });
  assert.deepEqual(artifact.entries, expectedEntries(selected, artifact.target), 'Required declaration or entry mismatch');
  const copies = expectedCopies(selected, artifact.layout);
  checkDestinations(copies);
  const sortFiles = files => [...files].sort((left, right) => left.destinationPath < right.destinationPath ? -1
    : left.destinationPath > right.destinationPath ? 1 : 0);
  assert.deepEqual(sortFiles(artifact.files.filter(file => file.kind === 'copy')), sortFiles(copies),
    'Source byte claims or complete required resource file set mismatch');
  const reader = createSourceReader(options.repoRoot);
  const pinned = copies.map(copy => {
    const resource = reader.read(copy.sourcePath);
    assert.equal(resource.bytes, copy.bytes, 'Source bytes changed before copy');
    assert.equal(resource.digest, copy.digest, 'Source digest changed before copy');
    return { path: copy.destinationPath, bytes: copy.bytes, digest: copy.digest, content: Buffer.from(resource.content) };
  });
  return { artifact, files: [...pinned, ...pinGenerated(artifact)] };
}

function sameIdentity(before, after) {
  return before.dev === after.dev && before.ino === after.ino && before.mode === after.mode;
}

function requireDirectoryIdentity(directory, identity) {
  const stats = fs.lstatSync(directory);
  assert.ok(!stats.isSymbolicLink() && stats.isDirectory() && sameIdentity(identity, stats),
    'Fixture root or ancestor identity changed');
}

function expectedDirectories(files) {
  const result = new Set();
  for (const file of files) {
    const parts = file.path.split('/');
    for (let index = 1; index < parts.length; index++) result.add(parts.slice(0, index).join('/'));
  }
  return result;
}

function createVerifier(root, container, containerIdentity, identity, prepared) {
  const expected = new Map(prepared.files.map(file => [file.path, { path: file.path, digest: file.digest, bytes: file.bytes }]));
  const directories = expectedDirectories(prepared.files);
  const carrierDigest = prepared.artifact.carrierDigest;
  const planDigest = prepared.artifact.planDigest;
  return () => {
    const checkRoot = () => {
      requireDirectoryIdentity(container, containerIdentity);
      requireDirectoryIdentity(root, identity);
    };
    checkRoot();
    const reader = createSourceReader(root);
    const observed = [];
    const walk = (relative = '') => {
      const names = relative ? reader.list(relative) : fs.readdirSync(root).sort();
      checkRoot();
      for (const name of names) {
        const child = relative ? `${relative}/${name}` : name;
        const stats = fs.lstatSync(reader.resolve(child));
        assert.ok(!stats.isSymbolicLink(), 'Staged symbolic link is forbidden');
        if (stats.isDirectory()) {
          assert.ok(directories.has(child), 'Unexpected staged directory');
          walk(child);
        } else {
          assert.ok(stats.isFile() && expected.has(child), 'Unexpected staged file set');
          const resource = reader.read(child);
          const descriptor = { path: child, digest: resource.digest, bytes: resource.bytes };
          assert.deepEqual(descriptor, expected.get(child), 'Observed file digest or bytes mismatch');
          observed.push(descriptor);
        }
      }
    };
    walk();
    checkRoot();
    assert.equal(observed.length, expected.size, 'Missing staged files');
    return { schemaVersion: 'ecc.context-fixture-evidence.v1', status: 'verified', evidenceKind: 'structural',
      nativeSupport: 'unobserved', activation: 'unobserved', carrierDigest, planDigest,
      fileCount: observed.length, files: observed.sort((left, right) => left.path < right.path ? -1 : left.path > right.path ? 1 : 0) };
  };
}

function withCarrierFixture(options, callback) {
  assert.equal(typeof callback, 'function', 'Fixture callback must be synchronous');
  const prepared = prepare(options);
  const container = fs.mkdtempSync(path.join(os.tmpdir(), 'ecc-carrier-acceptance-'));
  const containerIdentity = fs.lstatSync(container);
  const root = path.join(container, 'stage');
  try {
    fs.mkdirSync(root);
    const identity = fs.lstatSync(root);
    for (const file of prepared.files) {
      requireDirectoryIdentity(container, containerIdentity);
      requireDirectoryIdentity(root, identity);
      const destination = path.join(root, file.path);
      fs.mkdirSync(path.dirname(destination), { recursive: true });
      fs.writeFileSync(destination, file.content, { flag: 'wx', mode: 0o600 });
    }
    const verify = createVerifier(root, container, containerIdentity, identity, prepared);
    verify();
    const result = callback({ root, verify });
    assert.ok(!result || typeof result.then !== 'function', 'Fixture callback must be synchronous');
    return result;
  } finally {
    requireDirectoryIdentity(container, containerIdentity);
    fs.rmSync(container, { recursive: true, force: true });
  }
}

module.exports = { withCarrierFixture };
