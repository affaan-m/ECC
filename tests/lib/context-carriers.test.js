'use strict';

const assert = require('node:assert/strict');
const crypto = require('node:crypto');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const childProcess = require('node:child_process');
const test = require('node:test');
const Ajv = require('ajv');
const registryLibrary = require('../../scripts/lib/context-pack-registry');
const { compileContextProfile } = require('../../scripts/lib/context-profiles');
const { digestObject } = require('../../scripts/lib/context-profile-support');
const { KERNEL, update, withFixture, write } = require('./helpers/context-fixture');

const REPO_ROOT = path.resolve(__dirname, '../..');
const MODULE_PATH = path.join(REPO_ROOT, 'scripts/lib/context-carriers.js');
const SCHEMA_PATH = path.join(REPO_ROOT, 'schemas/context-carrier.schema.json');
const KERNEL_IDS = KERNEL.map(id => `skill:${id}`);
const LAYOUTS = {
  claude: { id: 'claude-plugin@1', skillRoot: 'skills', manifestPath: '.claude-plugin/plugin.json' },
  codex: { id: 'codex-plugin@1', skillRoot: 'skills', manifestPath: '.codex-plugin/plugin.json' },
  pi: { id: 'pi-package@1', skillRoot: 'skills', manifestPath: 'package.json' },
  opencode: { id: 'opencode-project@1', skillRoot: '.opencode/skills', manifestPath: null },
  cursor: { id: 'cursor-project@1', skillRoot: '.cursor/skills', manifestPath: null },
};

function plan(options) {
  return require(MODULE_PATH).planContextCarrier(options);
}

function sha256(value) {
  return crypto.createHash('sha256').update(value).digest('hex');
}

function snapshot(root) {
  const visit = relative => fs.readdirSync(path.join(root, relative), { withFileTypes: true })
    .sort((left, right) => left.name.localeCompare(right.name))
    .flatMap(entry => {
      const source = path.join(relative, entry.name);
      return entry.isDirectory() ? visit(source) : [[source, sha256(fs.readFileSync(path.join(root, source)))]];
    });
  return visit('');
}

function withRegistryView(context, transform, operation) {
  const original = registryLibrary.loadContextRegistry;
  const cached = require.cache[MODULE_PATH];
  delete require.cache[MODULE_PATH];
  context.mock.method(registryLibrary, 'loadContextRegistry', options => transform(original(options)));
  try {
    return operation();
  } finally {
    context.mock.restoreAll();
    delete require.cache[MODULE_PATH];
    if (cached) require.cache[MODULE_PATH] = cached;
  }
}

function changeSelectedEntry(registry, transform) {
  return { ...registry, entries: registry.entries.map(entry => (
    entry.id === 'skill:ecc-guide' ? transform(entry) : entry
  )) };
}

test('Lean plans only the three selected whole skill trees and never activates a host', () => withFixture(root => {
  const carrier = plan({ repoRoot: root, target: 'codex', selectionMode: 'auto' });
  assert.equal(carrier.schemaVersion, 'ecc.context-carrier.v1');
  assert.equal(carrier.status, 'planned');
  assert.equal(carrier.active, false);
  assert.equal(carrier.disposition, 'proposed');
  assert.equal(carrier.nativeSupport, 'unobserved');
  assert.equal(carrier.selectionMode, 'auto');
  assert.deepEqual(carrier.selectedIds, KERNEL_IDS);
  assert.deepEqual(carrier.routedIds, ['skill:feature', 'skill:shared']);
  assert.deepEqual(carrier.excludedIds, []);
  assert.deepEqual(carrier.entries.map(entry => entry.id), KERNEL_IDS);
  assert.deepEqual(carrier.files.filter(file => file.kind === 'copy').map(file => file.skillId).sort(), KERNEL_IDS);
  assert.ok(carrier.files.every(file => !/catalog|on-demand|routed/.test(file.destinationPath)));
  assert.match(carrier.limitations.join(' '), /routed.*(?:unimplemented|not implemented)/i);
}));

test('all five source-backed layouts preserve exact selected native directories', () => withFixture(root => {
  for (const [target, layout] of Object.entries(LAYOUTS)) {
    const carrier = plan({ repoRoot: root, target });
    assert.deepEqual(carrier.layout, layout);
    assert.equal(carrier.status, 'planned');
    assert.equal(carrier.nativeSupport, 'unobserved');
    assert.deepEqual(carrier.files.filter(file => file.kind === 'copy').map(file => file.destinationPath).sort(),
      KERNEL.map(id => `${layout.skillRoot}/${id}/SKILL.md`));
    assert.deepEqual(carrier.files.filter(file => file.kind === 'generated').map(file => file.destinationPath),
      layout.manifestPath ? [layout.manifestPath] : []);
  }
}));

test('generated provider manifests contain only explicitly allowed discovery fields', () => withFixture(root => {
  write(root, '.claude-plugin/plugin.json', { name: 'source', hooks: './hooks.json', mcpServers: './mcp.json', commands: './commands' });
  write(root, '.codex-plugin/plugin.json', { name: 'source', hooks: './hooks.json', mcpServers: './mcp.json' });
  write(root, 'package.json', { scripts: { postinstall: 'exit 1' }, pi: { extensions: ['./extension.js'], prompts: ['./commands'] } });
  const expected = {
    claude: { name: 'ecc-context-carrier', skills: ['./skills/'] },
    codex: { name: 'ecc-context-carrier', skills: './skills/' },
    pi: { name: 'ecc-context-carrier', private: true, pi: { skills: ['./skills'] } },
  };
  for (const [target, manifest] of Object.entries(expected)) {
    const generated = plan({ repoRoot: root, target }).files.find(file => file.kind === 'generated');
    assert.deepEqual(JSON.parse(generated.content), manifest);
    assert.equal(generated.encoding, 'utf8');
    assert.equal(generated.bytes, Buffer.byteLength(generated.content, 'utf8'));
    assert.equal(generated.digest, sha256(Buffer.from(generated.content, 'utf8')));
  }
}));

test('Full keeps exclusions out of both discovery files and carrier storage', () => withFixture(root => {
  for (const target of Object.keys(LAYOUTS)) {
    const carrier = plan({ repoRoot: root, profileId: 'full@1', target, exclude: ['skill:feature'] });
    assert.equal(carrier.selectedIds.length, 4);
    assert.deepEqual(carrier.excludedIds, ['skill:feature']);
    assert.deepEqual(carrier.routedIds, []);
    assert.ok(carrier.entries.every(entry => entry.id !== 'skill:feature'));
    assert.ok(carrier.files.every(file => file.skillId !== 'skill:feature' && !file.sourcePath?.startsWith('skills/feature/')));
  }
}));

test('bundled binary resources are copied by descriptor without decoding or script execution', () => withFixture(root => {
  const binary = Buffer.from([0, 255, 128, 1, 13, 10]);
  fs.writeFileSync(path.join(root, 'skills/feature/references/image.bin'), binary);
  write(root, 'skills/feature/never-run.js', 'throw new Error("CARRIER_MUST_NOT_EXECUTE_RESOURCE");');
  const carrier = plan({ repoRoot: root, include: ['skill:feature'] });
  const registry = registryLibrary.loadContextRegistry({ repoRoot: root });
  const entry = registry.entries.find(value => value.id === 'skill:feature');
  const copies = carrier.files.filter(file => file.kind === 'copy' && file.skillId === entry.id);
  assert.equal(copies.length, entry.resources.length);
  for (const resource of entry.resources) {
    const copied = copies.find(file => file.sourcePath === resource.path);
    assert.equal(copied.digest, resource.digest);
    assert.equal(copied.bytes, resource.bytes);
    assert.ok(!Object.hasOwn(copied, 'content'));
    assert.equal(copied.destinationPath, resource.path);
  }
  assert.equal(copies.find(file => file.sourcePath.endsWith('image.bin')).digest, sha256(binary));
}));

test('explicit dependencies and required-resource annotations remain bound to selected copies', () => withFixture(root => {
  update(root, 'manifests/context-packs/skill-registry@1.json', value => ({ ...value, overrides: [{
    id: 'skill:feature', dependencies: ['skill:shared'], requiredResources: ['skills/feature/references/details.md'],
  }] }));
  const carrier = plan({ repoRoot: root, include: ['skill:feature'] });
  assert.ok(carrier.selectedIds.includes('skill:shared'));
  const feature = carrier.entries.find(entry => entry.id === 'skill:feature');
  assert.deepEqual(feature.requiredResources, ['skills/feature/references/details.md']);
  assert.ok(carrier.files.some(file => file.sourcePath === feature.requiredResources[0]));
  assert.ok(carrier.entries.every(entry => carrier.files.some(file => file.sourcePath === entry.sourcePath)));
}));

test('canonical IDs are retained while destination folders use declared native names', () => withFixture(root => {
  write(root, 'skills/feature/SKILL.md', '---\nname: renamed-feature\ndescription: Native name differs from directory ID.\n---\n');
  for (const target of Object.keys(LAYOUTS)) {
    const carrier = plan({ repoRoot: root, target, include: ['skill:feature'] });
    assert.equal(carrier.entries.find(entry => entry.id === 'skill:feature').name, 'renamed-feature');
    assert.ok(carrier.files.some(file => file.skillId === 'skill:feature'
      && file.destinationPath === `${LAYOUTS[target].skillRoot}/renamed-feature/SKILL.md`));
  }
}));

test('recognized unsupported targets retain the proposal and plan zero files', () => withFixture(root => {
  const targets = registryLibrary.loadContextRegistry({ repoRoot: root }).targets;
  for (const target of targets.filter(value => !Object.hasOwn(LAYOUTS, value))) {
    const carrier = plan({ repoRoot: root, target, exclude: ['skill:feature'] });
    assert.equal(carrier.status, 'unsupported');
    assert.equal(carrier.nativeSupport, 'unobserved');
    assert.equal(carrier.active, false);
    assert.equal(carrier.layout, null);
    assert.deepEqual(carrier.files, []);
    assert.deepEqual(carrier.selectedIds, KERNEL_IDS);
    assert.deepEqual(carrier.excludedIds, ['skill:feature']);
    assert.deepEqual(carrier.entries.map(entry => entry.id), KERNEL_IDS);
  }
}));

test('legacy owner-target declarations are surfaced without suppressing known layouts', () => withFixture(root => {
  const codex = plan({ repoRoot: root, target: 'codex' });
  const pi = plan({ repoRoot: root, target: 'pi' });
  assert.ok(codex.entries.every(entry => entry.installSupport === 'declared'));
  assert.ok(pi.entries.every(entry => entry.installSupport === 'not-declared'));
  assert.equal(pi.status, 'planned');
  assert.deepEqual(pi.selectedIds, codex.selectedIds);
  assert.equal(pi.files.filter(file => file.kind === 'copy').length, 3);
}));

test('canonical provenance and adapter source bindings produce stable portable carrier digests', () => withFixture(root => {
  const input = { repoRoot: root, target: 'codex', include: ['skill:feature', 'skill:shared'] };
  const carrier = plan(input);
  assert.deepEqual(carrier, plan({ ...input, include: [...input.include].reverse() }));
  const context = compileContextProfile(input);
  for (const key of ['registryDigest', 'profileDigest', 'compilerDigest', 'planDigest']) {
    assert.equal(carrier[key], context[key]);
  }
  const adapterSources = ['scripts/lib/context-carriers.js', 'schemas/context-carrier.schema.json'];
  assert.equal(carrier.adapterDigest, digestObject(adapterSources.map(source => ({
    path: source, digest: sha256(fs.readFileSync(path.join(REPO_ROOT, source))),
  }))));
  const { carrierDigest, ...value } = carrier;
  assert.equal(carrierDigest, digestObject(value));
  assert.ok(!JSON.stringify(carrier).includes(root));
  assert.ok(!JSON.stringify(carrier).includes('generatedAt'));
}));

test('resource-only changes alter carrier provenance and file digests', () => withFixture(root => {
  const options = { repoRoot: root, include: ['skill:feature'] };
  const before = plan(options);
  write(root, 'skills/feature/references/details.md', 'Changed resource bytes.\n');
  const after = plan(options);
  assert.notEqual(after.registryDigest, before.registryDigest);
  assert.notEqual(after.carrierDigest, before.carrierDigest);
  const digest = carrier => carrier.files.find(file => file.sourcePath === 'skills/feature/references/details.md').digest;
  assert.notEqual(digest(before), digest(after));
}));

test('registry drift between compilation and carrier inventory fails closed', context => withFixture(root => (
  withRegistryView(context, registry => ({ ...registry, registryDigest: '0'.repeat(64) }), () => {
    assert.throws(() => plan({ repoRoot: root }), /registry.*(?:digest|drift|changed)|(?:digest|drift).*registry/i);
  })
)));

test('missing required-resource metadata or inventory members cannot become partial carriers', context => withFixture(root => {
  for (const transform of [
    ({ requiredResources: _, ...entry }) => entry,
    entry => ({ ...entry, requiredResources: ['skills/ecc-guide/absent.md'] }),
    entry => ({ ...entry, resources: [] }),
    entry => ({ ...entry, sourcePath: 'skills/ecc-guide/absent.md' }),
  ]) {
    withRegistryView(context, registry => changeSelectedEntry(registry, transform), () => {
      assert.throws(() => plan({ repoRoot: root }), /resource|source.*(?:missing|inventory)/i);
    });
  }
}));

test('duplicate native names and case-colliding destination resources are rejected', context => withFixture(root => {
  write(root, 'skills/feature/SKILL.md', '---\nname: ecc-guide\ndescription: Duplicate native name.\n---\n');
  assert.throws(() => plan({ repoRoot: root, include: ['skill:feature'] }), /name|collision|duplicate/i);
  withRegistryView(context, registry => changeSelectedEntry(registry, entry => ({
    ...entry, resources: [...entry.resources, ...['details.md', 'DETAILS.md'].map(file => ({
      path: `skills/ecc-guide/${file}`, digest: 'a'.repeat(64), bytes: 1,
    }))],
  })), () => assert.throws(() => plan({ repoRoot: root }), /collision|duplicate/i));
}));

test('case-aliased ancestor directories with different child files are rejected', context => withFixture(root => (
  withRegistryView(context, registry => changeSelectedEntry(registry, entry => ({
    ...entry, resources: [...entry.resources, ...['Case/one.md', 'case/two.md'].map(file => ({
      path: `skills/ecc-guide/${file}`, digest: 'a'.repeat(64), bytes: 1,
    }))],
  })), () => assert.throws(() => plan({ repoRoot: root }), /collision|alias/i))
)));

test('Unicode-normalization-aliased ancestors with different children are rejected', context => withFixture(root => (
  withRegistryView(context, registry => changeSelectedEntry(registry, entry => ({
    ...entry, resources: [...entry.resources, ...['caf\u00e9/one.md', 'cafe\u0301/two.md'].map(file => ({
      path: `skills/ecc-guide/${file}`, digest: 'a'.repeat(64), bytes: 1,
    }))],
  })), () => assert.throws(() => plan({ repoRoot: root }), /collision|alias/i))
)));

test('nested SKILL.md resources are rejected case-insensitively', () => withFixture(root => {
  write(root, 'skills/feature/nested/skill.MD', 'Nested discovery entry.');
  assert.throws(() => plan({ repoRoot: root, include: ['skill:feature'] }), /nested|discovery.*entry/i);
}));

test('invalid native names and unsafe resource paths fail before projection', context => withFixture(root => {
  for (const transform of [
    entry => ({ ...entry, name: '../escape' }),
    entry => ({ ...entry, name: 'name with spaces' }),
    entry => ({ ...entry, name: 'a'.repeat(65) }),
    entry => ({ ...entry, resources: [...entry.resources, { path: '../outside', digest: 'a'.repeat(64), bytes: 1 }] }),
    entry => ({ ...entry, resources: [...entry.resources, { path: 'skills/shared/data.bin', digest: 'a'.repeat(64), bytes: 1 }] }),
  ]) withRegistryView(context, registry => changeSelectedEntry(registry, transform), () => {
    assert.throws(() => plan({ repoRoot: root }), /name|path|resource|outside|belong/i);
  });
}));

test('unknown targets and externally supplied plans or options are rejected', () => withFixture(root => {
  assert.throws(() => plan({ repoRoot: root, target: 'typo' }), /target/i);
  assert.throws(() => plan({ repoRoot: root, plan: { selectedIds: [] } }), /unknown|option|input/i);
  assert.throws(() => plan({ repoRoot: root, out: '/unused' }), /unknown|option|input/i);
}));

test('read-only planning does not write files, execute processes, or inspect user homes', context => withFixture(root => {
  const before = snapshot(root);
  const forbidden = () => { throw new Error('FORBIDDEN_CARRIER_SIDE_EFFECT'); };
  for (const name of ['writeFileSync', 'appendFileSync', 'mkdirSync', 'rmSync', 'renameSync', 'copyFileSync', 'cpSync']) {
    context.mock.method(fs, name, forbidden);
  }
  for (const name of ['spawn', 'spawnSync', 'exec', 'execSync', 'execFile', 'execFileSync']) {
    context.mock.method(childProcess, name, forbidden);
  }
  context.mock.method(os, 'homedir', forbidden);
  try {
    assert.equal(plan({ repoRoot: root, target: 'codex' }).status, 'planned');
  } finally {
    context.mock.restoreAll();
  }
  assert.deepEqual(snapshot(root), before);
}));

test('published carrier schema validates outputs and rejects extra or capability-bearing fields', () => withFixture(root => {
  const carrier = plan({ repoRoot: root });
  const schema = JSON.parse(fs.readFileSync(SCHEMA_PATH, 'utf8'));
  const validate = new Ajv({ allErrors: true, strict: true }).compile(schema);
  assert.equal(validate(carrier), true, JSON.stringify(validate.errors));
  assert.equal(validate({ ...carrier, extra: true }), false);
  assert.equal(validate({ ...carrier, active: true }), false);
  assert.equal(validate({ ...carrier, nativeSupport: 'verified' }), false);
  assert.equal(validate({ ...carrier, files: [{ ...carrier.files[0], hooks: true }] }), false);
  assert.equal(validate({ ...carrier, files: [{ kind: 'generated', destinationPath: 'hooks/hooks.json',
    content: '{}', encoding: 'utf8', digest: sha256('{}'), bytes: 2 }] }), false);
  const unsupported = plan({ repoRoot: root, target: 'gemini' });
  assert.equal(validate(unsupported), true, JSON.stringify(validate.errors));
  assert.equal(validate({ ...unsupported, files: carrier.files }), false);
}));

test('real canonical inventory projects every selected bundled resource without relying on mirrors', () => {
  const carrier = plan({ repoRoot: REPO_ROOT, profileId: 'full@1', target: 'opencode' });
  const registry = registryLibrary.loadContextRegistry({ repoRoot: REPO_ROOT });
  assert.deepEqual(carrier.selectedIds, registry.entries.map(entry => entry.id));
  assert.equal(carrier.files.filter(file => file.kind === 'copy').length,
    registry.entries.reduce((count, entry) => count + entry.resources.length, 0));
  assert.ok(carrier.files.every(file => file.kind !== 'copy' || file.sourcePath.startsWith('skills/')));
  assert.ok(carrier.files.some(file => file.destinationPath === '.opencode/skills/gget/SKILL.md'
    && file.skillId === 'skill:scientific-pkg-gget'));
});
