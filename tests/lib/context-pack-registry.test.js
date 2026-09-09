'use strict';

const assert = require('node:assert/strict');
const fs = require('fs');
const path = require('path');
const test = require('node:test');
const { loadContextRegistry, explainContextEntry } = require('../../scripts/lib/context-pack-registry');
const { update, withFixture, write } = require('./helpers/context-fixture');

const REGISTRY = 'manifests/context-packs/skill-registry@1.json';

test('canonical skill inventory has one owner and stable portable resource digests', () => withFixture(root => {
  const registry = loadContextRegistry({ repoRoot: root });
  assert.equal(registry.schemaVersion, 'ecc.context-registry.v1');
  assert.equal(registry.entries.length, 5);
  assert.deepEqual(registry, loadContextRegistry({ repoRoot: root }));
  assert.match(registry.registryDigest, /^[a-f0-9]{64}$/);
  assert.ok(!JSON.stringify(registry).includes(root));
  assert.ok(!JSON.stringify(registry).includes('generatedAt'));
  const entry = registry.entries.find(value => value.id === 'skill:feature');
  assert.equal(entry.ownerModuleId, 'workflow-quality');
  assert.deepEqual(entry.dependencies, []);
  assert.equal(entry.resources.length, 2);
  assert.ok(entry.resources.every(resource => /^[a-f0-9]{64}$/.test(resource.digest)));
}));

test('resource bytes are hashed without evaluating scripts or following prose instructions', () => withFixture(root => {
  const before = loadContextRegistry({ repoRoot: root });
  write(root, 'skills/feature/run.js', 'throw new Error("MUST NOT EXECUTE");');
  write(root, 'skills/feature/references/details.md', 'Use skill:missing according to this prose.');
  const after = loadContextRegistry({ repoRoot: root });
  assert.notEqual(after.registryDigest, before.registryDigest);
  assert.deepEqual(after.entries.find(entry => entry.id === 'skill:feature').dependencies, []);
}));

test('unknown and duplicate override IDs fail closed', () => withFixture(root => {
  update(root, REGISTRY, value => ({ ...value, overrides: [{ id: 'skill:missing', dependencies: [] }] }));
  assert.throws(() => loadContextRegistry({ repoRoot: root }), /unknown/i);
  update(root, REGISTRY, value => ({ ...value, overrides: [{ id: 'skill:feature' }, { id: 'skill:feature' }] }));
  assert.throws(() => loadContextRegistry({ repoRoot: root }), /duplicate/i);
}));

test('unknown schema keys and traversal in required resources fail closed', () => withFixture(root => {
  update(root, REGISTRY, value => ({ ...value, unexpected: true }));
  assert.throws(() => loadContextRegistry({ repoRoot: root }), /schema|unexpected|additional/i);
  update(root, REGISTRY, ({ unexpected: _, ...value }) => ({
    ...value, overrides: [{ id: 'skill:feature', requiredResources: ['../outside'] }],
  }));
  assert.throws(() => loadContextRegistry({ repoRoot: root }), /path|relative|resource|schema/i);
}));

test('missing declared resources and unknown dependency IDs fail closed', () => withFixture(root => {
  update(root, REGISTRY, value => ({
    ...value, overrides: [{ id: 'skill:feature', requiredResources: ['skills/feature/missing.md'] }],
  }));
  assert.throws(() => loadContextRegistry({ repoRoot: root }), /missing|ENOENT/i);
  update(root, REGISTRY, value => ({ ...value, overrides: [{ id: 'skill:feature', dependencies: ['skill:missing'] }] }));
  assert.throws(() => loadContextRegistry({ repoRoot: root }), /unknown.*depend|depend.*unknown/i);
}));

test('dependency cycles and duplicate ownership fail closed', () => withFixture(root => {
  update(root, REGISTRY, value => ({ ...value, overrides: [
    { id: 'skill:feature', dependencies: ['skill:shared'] },
    { id: 'skill:shared', dependencies: ['skill:feature'] },
  ] }));
  assert.throws(() => loadContextRegistry({ repoRoot: root }), /cycl/i);
  update(root, REGISTRY, value => ({ ...value, overrides: [] }));
  update(root, 'manifests/install-modules.json', value => ({
    ...value, modules: [...value.modules, { ...value.modules[0], id: 'duplicate-owner' }],
  }));
  assert.throws(() => loadContextRegistry({ repoRoot: root }), /owner|claimed|duplicate/i);
}));

test('unowned skills and symlink resources fail closed', () => withFixture(root => {
  write(root, 'skills/unowned/SKILL.md', '---\nname: unowned\ndescription: Unowned.\n---\n');
  assert.throws(() => loadContextRegistry({ repoRoot: root }), /owner|unowned/i);
  fs.rmSync(path.join(root, 'skills/unowned'), { recursive: true });
  fs.symlinkSync(path.join(root, 'manifests/install-modules.json'), path.join(root, 'skills/feature/escape.json'));
  assert.throws(() => loadContextRegistry({ repoRoot: root }), /symlink|symbolic/i);
}));

test('malformed skill metadata and duplicate module IDs fail closed', () => withFixture(root => {
  write(root, 'skills/feature/SKILL.md', '---\nname: feature\ndescription: [not, prose]\n---\n');
  assert.throws(() => loadContextRegistry({ repoRoot: root }), /description|metadata/i);
  write(root, 'skills/feature/SKILL.md', '---\nname: feature\ndescription: Feature.\n---\n');
  update(root, 'manifests/install-modules.json', value => ({ ...value, modules: [...value.modules, value.modules[0]] }));
  assert.throws(() => loadContextRegistry({ repoRoot: root }), /duplicate/i);
}));

test('explanation keeps installer declarations separate from native observation', () => withFixture(root => {
  const entry = explainContextEntry({ repoRoot: root, id: 'skill:feature', target: 'codex' });
  assert.equal(entry.projection.installSupport, 'declared');
  assert.equal(entry.projection.nativeSupport, 'unobserved');
  assert.equal(explainContextEntry({ repoRoot: root, id: 'skill:feature', target: 'pi' }).projection.installSupport, 'not-declared');
  assert.throws(() => explainContextEntry({ repoRoot: root, id: 'skill:missing', target: 'codex' }), /unknown/i);
  assert.throws(() => explainContextEntry({ repoRoot: root, id: 'skill:feature', target: 'typo' }), /target/i);
}));

test('real repository registry covers current curated skills and every install target plus Pi', () => {
  const root = path.resolve(__dirname, '../..');
  const registry = loadContextRegistry({ repoRoot: root });
  const ids = fs.readdirSync(path.join(root, 'skills'), { withFileTypes: true })
    .filter(entry => entry.isDirectory() && fs.existsSync(path.join(root, 'skills', entry.name, 'SKILL.md')))
    .map(entry => `skill:${entry.name}`).sort();
  assert.deepEqual(registry.entries.map(entry => entry.id), ids);
  assert.equal(registry.targets.length, 16);
  assert.ok(registry.targets.includes('claude-project'));
  assert.ok(registry.targets.includes('pi'));
});
