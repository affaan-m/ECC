'use strict';

const assert = require('node:assert/strict');
const crypto = require('crypto');
const fs = require('fs');
const path = require('path');
const test = require('node:test');
const { explainContextEntry, loadContextRegistry } = require('../../scripts/lib/context-pack-registry');
const { compileContextProfile } = require('../../scripts/lib/context-profiles');
const { createDirectoryLink, update, withFixture, write } = require('./helpers/context-fixture');

const REGISTRY = 'manifests/context-packs/skill-registry@1.json';
const FEATURE = 'skill:feature';
const ENTRYPOINT = 'skills/feature/SKILL.md';
const DETAILS = 'skills/feature/references/details.md';
const EXTRA = 'skills/feature/references/extra.md';

function declare(root, requiredResources) {
  update(root, REGISTRY, value => ({
    ...value, overrides: [{ id: FEATURE, requiredResources }],
  }));
}

function entryIn(document, id = FEATURE) {
  return document.entries.find(entry => entry.id === id);
}

test('v1 entries expose empty declarations separately from mandatory entrypoints and bundled files', () => withFixture(root => {
  const registry = loadContextRegistry({ repoRoot: root });
  const plan = compileContextProfile({ repoRoot: root });
  assert.equal(registry.schemaVersion, 'ecc.context-registry.v1');
  assert.equal(plan.schemaVersion, 'ecc.context-plan.v1');
  for (const entry of registry.entries) {
    assert.ok(Object.hasOwn(entry, 'requiredResources'));
    assert.deepEqual(entry.requiredResources, []);
    assert.ok(entry.sourcePath.endsWith('/SKILL.md'));
    assert.equal(entry.resources.filter(resource => resource.path === entry.sourcePath).length, 1);
    assert.deepEqual(entryIn(plan, entry.id).requiredResources, []);
  }
  assert.ok(entryIn(registry).resources.some(resource => resource.path === DETAILS));
  assert.equal(entryIn(registry).dependencyCoverage, 'declared-only-unreviewed');
}));

test('sorted explicit declarations survive registry, explanation and profile compilation', () => withFixture(root => {
  write(root, EXTRA, 'Additional bundled content.\n');
  declare(root, [EXTRA, DETAILS]);
  const registryEntry = entryIn(loadContextRegistry({ repoRoot: root }));
  const explained = explainContextEntry({ repoRoot: root, id: FEATURE });
  const planEntry = entryIn(compileContextProfile({ repoRoot: root, include: [FEATURE] }));
  for (const entry of [registryEntry, explained, planEntry]) {
    assert.deepEqual(entry.requiredResources, [DETAILS, EXTRA]);
    assert.equal(entry.sourcePath, ENTRYPOINT);
    assert.ok(!entry.requiredResources.includes(ENTRYPOINT));
  }
  assert.deepEqual(registryEntry.resources.map(resource => resource.path), [ENTRYPOINT, DETAILS, EXTRA]);
}));

test('an explicitly declared SKILL.md remains declared without duplicating its resource descriptor', () => withFixture(root => {
  declare(root, [DETAILS, ENTRYPOINT]);
  const registryEntry = entryIn(loadContextRegistry({ repoRoot: root }));
  const planEntry = entryIn(compileContextProfile({ repoRoot: root, include: [FEATURE] }));
  assert.deepEqual(registryEntry.requiredResources, [ENTRYPOINT, DETAILS]);
  assert.deepEqual(planEntry.requiredResources, [ENTRYPOINT, DETAILS]);
  assert.equal(registryEntry.resources.filter(resource => resource.path === ENTRYPOINT).length, 1);
  assert.deepEqual([...new Set([registryEntry.sourcePath, ...registryEntry.requiredResources])], [ENTRYPOINT, DETAILS]);
}));

test('selected, routed and excluded plan entries all retain their declarations without activation', () => withFixture(root => {
  declare(root, [DETAILS]);
  for (const [selection, options] of [
    ['selected', { include: [FEATURE] }], ['routed', {}], ['excluded', { exclude: [FEATURE] }],
  ]) {
    const plan = compileContextProfile({ repoRoot: root, ...options });
    const entry = entryIn(plan);
    assert.equal(entry.selection, selection);
    assert.deepEqual(entry.requiredResources, [DETAILS]);
    assert.equal(entry.sourcePath, ENTRYPOINT);
    assert.equal(entry.projection.nativeSupport, 'unobserved');
    assert.equal(plan.active, false);
    assert.equal(plan.disposition, 'proposed');
  }
}));

test('declaration-only changes bind provenance without changing content identity or discovery cost', () => withFixture(root => {
  const options = { repoRoot: root, include: [FEATURE] };
  const beforeRegistry = loadContextRegistry(options);
  const beforePlan = compileContextProfile(options);
  declare(root, [DETAILS]);
  const afterRegistry = loadContextRegistry(options);
  const afterPlan = compileContextProfile(options);
  assert.deepEqual(entryIn(beforeRegistry).requiredResources, []);
  assert.deepEqual(entryIn(afterRegistry).requiredResources, [DETAILS]);
  assert.deepEqual(entryIn(beforeRegistry).resources, entryIn(afterRegistry).resources);
  assert.equal(entryIn(beforeRegistry).contentDigest, entryIn(afterRegistry).contentDigest);
  assert.notEqual(beforeRegistry.registryDigest, afterRegistry.registryDigest);
  assert.notEqual(beforePlan.registryDigest, afterPlan.registryDigest);
  assert.notEqual(beforePlan.planDigest, afterPlan.planDigest);
  assert.equal(beforePlan.profileDigest, afterPlan.profileDigest);
  assert.equal(beforePlan.compilerDigest, afterPlan.compilerDigest);
  assert.deepEqual(beforePlan.estimate, afterPlan.estimate);
  assert.deepEqual(beforePlan.selectedIds, afterPlan.selectedIds);
}));

test('required resource byte changes alter content digests without changing declarations or metadata estimates', () => withFixture(root => {
  declare(root, [DETAILS]);
  const before = compileContextProfile({ repoRoot: root, include: [FEATURE] });
  write(root, DETAILS, 'Changed resource bytes.\n');
  const after = compileContextProfile({ repoRoot: root, include: [FEATURE] });
  assert.deepEqual(entryIn(after).requiredResources, [DETAILS]);
  assert.deepEqual(entryIn(before).requiredResources, entryIn(after).requiredResources);
  assert.notEqual(entryIn(before).contentDigest, entryIn(after).contentDigest);
  assert.notEqual(before.registryDigest, after.registryDigest);
  assert.notEqual(before.planDigest, after.planDigest);
  assert.deepEqual(before.estimate, after.estimate);
}));

test('declaration order is normalized while exact source-manifest bytes remain provenance-sensitive', () => withFixture(root => {
  write(root, EXTRA, 'Additional bundled content.\n');
  declare(root, [EXTRA, DETAILS]);
  const before = loadContextRegistry({ repoRoot: root });
  declare(root, [DETAILS, EXTRA]);
  const after = loadContextRegistry({ repoRoot: root });
  assert.deepEqual(entryIn(before).requiredResources, [DETAILS, EXTRA]);
  assert.deepEqual(entryIn(before), entryIn(after));
  assert.notEqual(before.registryDigest, after.registryDigest);
  assert.deepEqual(after, loadContextRegistry({ repoRoot: root }));
}));

test('frozen parsed declarations and caller selectors retain their original order and ownership', context => withFixture(root => {
  write(root, EXTRA, 'Additional bundled content.\n');
  declare(root, [EXTRA, DETAILS]);
  const sourceBefore = fs.readFileSync(path.join(root, REGISTRY), 'utf8');
  const originalParse = JSON.parse;
  const parsedDeclarations = [];
  context.mock.method(JSON, 'parse', (source, ...args) => {
    const value = originalParse(source, ...args);
    if (value && value.id === 'skill-registry@1' && Array.isArray(value.overrides)) {
      const declared = value.overrides.find(override => override.id === FEATURE).requiredResources;
      parsedDeclarations.push(Object.freeze(declared));
    }
    return value;
  });
  const include = Object.freeze(['skill:shared', FEATURE]);
  const exclude = Object.freeze([]);
  const registryEntry = entryIn(loadContextRegistry({ repoRoot: root }));
  const planEntry = entryIn(compileContextProfile({ repoRoot: root, include, exclude }));
  assert.deepEqual(registryEntry.requiredResources, [DETAILS, EXTRA]);
  assert.deepEqual(planEntry.requiredResources, [DETAILS, EXTRA]);
  assert.ok(parsedDeclarations.length >= 2);
  for (const declaration of parsedDeclarations) {
    assert.deepEqual(declaration, [EXTRA, DETAILS]);
    assert.notEqual(registryEntry.requiredResources, declaration);
    assert.notEqual(planEntry.requiredResources, declaration);
  }
  assert.deepEqual(include, ['skill:shared', FEATURE]);
  assert.deepEqual(exclude, []);
  assert.equal(fs.readFileSync(path.join(root, REGISTRY), 'utf8'), sourceBefore);
  context.mock.restoreAll();
}));

test('declaration arrays are independent between entries and calls', () => withFixture(root => {
  const registry = loadContextRegistry({ repoRoot: root });
  assert.deepEqual(entryIn(registry).requiredResources, []);
  entryIn(registry).requiredResources.push(DETAILS);
  assert.deepEqual(entryIn(registry, 'skill:shared').requiredResources, []);
  assert.deepEqual(entryIn(loadContextRegistry({ repoRoot: root })).requiredResources, []);
  const plan = compileContextProfile({ repoRoot: root });
  entryIn(plan).requiredResources.push(DETAILS);
  assert.deepEqual(entryIn(plan, 'skill:shared').requiredResources, []);
  assert.deepEqual(entryIn(compileContextProfile({ repoRoot: root })).requiredResources, []);
}));

test('declared resources cannot replace a missing canonical SKILL.md entrypoint', () => withFixture(root => {
  declare(root, [DETAILS]);
  fs.unlinkSync(path.join(root, ENTRYPOINT));
  assert.throws(() => loadContextRegistry({ repoRoot: root }), /unknown.*override|entrypoint|missing/i);
  assert.throws(() => compileContextProfile({ repoRoot: root, include: [FEATURE] }), /unknown|entrypoint|missing/i);
}));

test('duplicate, malformed, missing, cross-skill and excluded resource declarations still fail closed', () => withFixture(root => {
  for (const [declaration, expected] of [
    [[DETAILS, DETAILS], /schema|unique/i],
    [null, /schema/i],
    [[42], /schema/i],
    [['../outside'], /path|relative/i],
    [['skills/feature/../shared/SKILL.md'], /path|relative/i],
    [['skills/shared/SKILL.md'], /belong/i],
    [['skills/feature/missing.md'], /ENOENT|missing/i],
    [['skills/feature/references'], /regular file/i],
    [['skills/feature/__pycache__/worker.pyc'], /excluded|publication/i],
  ]) {
    declare(root, declaration);
    assert.throws(() => loadContextRegistry({ repoRoot: root }), expected);
    assert.throws(() => compileContextProfile({ repoRoot: root }), expected);
  }
}));

test('required resource ancestors cannot be redirected through a symbolic link or junction', () => withFixture(root => {
  declare(root, [DETAILS]);
  const references = path.join(root, 'skills/feature/references');
  const original = path.join(root, 'original-references');
  fs.renameSync(references, original);
  createDirectoryLink(original, references);
  assert.throws(() => loadContextRegistry({ repoRoot: root }), /symbolic|symlink/i);
  assert.throws(() => compileContextProfile({ repoRoot: root }), /symbolic|symlink/i);
}));

test('declared binary and script resources are hashed as bytes without execution', () => withFixture(root => {
  const binaryPath = 'skills/feature/references/data.bin';
  const scriptPath = 'skills/feature/run.js';
  const bytes = Buffer.from([0, 255, 128, 13, 10]);
  write(root, binaryPath, '');
  fs.writeFileSync(path.join(root, binaryPath), bytes);
  write(root, scriptPath, 'throw new Error("DECLARED RESOURCE MUST REMAIN INERT");\n');
  declare(root, [scriptPath, binaryPath]);
  const entry = entryIn(loadContextRegistry({ repoRoot: root }));
  assert.deepEqual(entry.requiredResources, [binaryPath, scriptPath]);
  const resource = entry.resources.find(item => item.path === binaryPath);
  assert.equal(resource.bytes, bytes.length);
  assert.equal(resource.digest, crypto.createHash('sha256').update(bytes).digest('hex'));
  assert.deepEqual(entryIn(compileContextProfile({ repoRoot: root, include: [FEATURE] })).requiredResources, [binaryPath, scriptPath]);
}));
