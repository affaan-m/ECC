'use strict';

const assert = require('node:assert/strict');
const fs = require('fs');
const path = require('path');
const test = require('node:test');
const { compileContextProfile, loadContextProfile } = require('../../scripts/lib/context-profiles');
const { KERNEL, update, withFixture, write } = require('./helpers/context-fixture');

test('Lean selects three discoverable skills and leaves remaining workflows routed', () => withFixture(root => {
  const plan = compileContextProfile({ repoRoot: root, profileId: 'lean@1', target: 'codex' });
  assert.equal(plan.schemaVersion, 'ecc.context-plan.v1');
  assert.deepEqual(plan.selectedIds, KERNEL.map(id => `skill:${id}`));
  assert.deepEqual(plan.routedIds, ['skill:feature', 'skill:shared']);
  assert.deepEqual(plan.excludedIds, []);
  assert.equal(plan.active, false);
  assert.equal(plan.disposition, 'proposed');
  assert.equal(plan.estimate.surface, 'skill-discovery-metadata');
  assert.equal(plan.estimate.nativeTokens, null);
  assert.equal(plan.estimate.wrapperTokens, null);
  assert.equal(plan.estimate.wholeScopeTokens, null);
  assert.equal(plan.estimate.withinBudget, true);
}));

test('Full selects all canonical skill IDs without claiming native activation', () => withFixture(root => {
  const plan = compileContextProfile({ repoRoot: root, profileId: 'full', target: 'pi' });
  assert.equal(plan.profileId, 'full@1');
  assert.equal(plan.selectedIds.length, 5);
  assert.equal(plan.routedIds.length, 0);
  assert.equal(plan.estimate.budgetMode, 'report-only');
  assert.ok(plan.entries.every(entry => entry.projection.nativeSupport === 'unobserved'));
}));

test('selection modes describe proposals and never mutate the source repository', () => withFixture(root => {
  const source = fs.readFileSync(path.join(root, 'manifests/context-profiles/lean@1.json'), 'utf8');
  for (const selectionMode of ['manual', 'suggest', 'auto']) {
    const plan = compileContextProfile({ repoRoot: root, selectionMode });
    assert.equal(plan.selectionMode, selectionMode);
    assert.equal(plan.active, false);
    assert.equal(plan.disposition, 'proposed');
  }
  assert.equal(fs.readFileSync(path.join(root, 'manifests/context-profiles/lean@1.json'), 'utf8'), source);
  assert.deepEqual(fs.readdirSync(root).sort(), ['manifests', 'skills']);
}));

test('equivalent selections produce deterministic portable plan digests', () => withFixture(root => {
  const options = { repoRoot: root, include: ['skill:feature', 'skill:shared'] };
  const plan = compileContextProfile(options);
  const reordered = compileContextProfile({ ...options, include: [...options.include].reverse() });
  assert.deepEqual(plan, reordered);
  for (const key of ['registryDigest', 'profileDigest', 'compilerDigest', 'planDigest']) {
    assert.match(plan[key], /^[a-f0-9]{64}$/);
  }
  assert.ok(!JSON.stringify(plan).includes(root));
  assert.ok(!JSON.stringify(plan).includes('generatedAt'));
}));

test('declared dependencies are selected transitively and exclusions cannot break closure', () => withFixture(root => {
  update(root, 'manifests/context-packs/skill-registry@1.json', value => ({ ...value, overrides: [
    { id: 'skill:feature', dependencies: ['skill:shared'] },
  ] }));
  const plan = compileContextProfile({ repoRoot: root, include: ['skill:feature'] });
  assert.ok(plan.selectedIds.includes('skill:shared'));
  assert.match(plan.entries.find(entry => entry.id === 'skill:shared').reason, /depend/i);
  assert.throws(() => compileContextProfile({ repoRoot: root, include: ['skill:feature'], exclude: ['skill:shared'] }), /required|depend|closure/i);
}));

test('invalid selectors, mode, target and unsafe profile names fail closed', () => withFixture(root => {
  for (const options of [
    { include: ['skill:missing'] }, { exclude: ['skill:missing'] },
    { include: ['skill:feature', 'skill:feature'] },
    { include: ['skill:feature'], exclude: ['skill:feature'] },
    { exclude: ['skill:ecc-guide'] }, { selectionMode: 'maybe' },
    { target: 'unknown' }, { profileId: '../outside' },
    { include: 'skill:feature' },
  ]) assert.throws(() => compileContextProfile({ repoRoot: root, ...options }));
}));

test('profile schema rejects unknown fields, duplicate IDs and missing required roots', () => withFixture(root => {
  const file = 'manifests/context-profiles/lean@1.json';
  update(root, file, value => ({ ...value, activation: true }));
  assert.throws(() => loadContextProfile('lean', { repoRoot: root }), /schema|additional/i);
  update(root, file, ({ activation: _, ...value }) => ({ ...value, selection: { ...value.selection, eager: ['skill:ecc-guide'] } }));
  assert.throws(() => compileContextProfile({ repoRoot: root }), /required|missing/i);
}));

test('metadata ceiling blocks Lean while Full reports the estimate without certification', () => withFixture(root => {
  write(root, 'skills/ecc-guide/SKILL.md', `---\nname: ecc-guide\ndescription: ${'x'.repeat(33000)}\n---\n`);
  assert.throws(() => compileContextProfile({ repoRoot: root }), error => {
    assert.equal(error.code, 'CONTEXT_PROFILE_BUDGET_EXCEEDED');
    assert.ok(error.plan.estimate.estimatedTokens > 8000);
    return true;
  });
  const full = compileContextProfile({ repoRoot: root, profileId: 'full@1' });
  assert.equal(full.estimate.withinBudget, false);
  assert.equal(full.active, false);
}));

test('body changes alter provenance without being charged to discovery metadata', () => withFixture(root => {
  const before = compileContextProfile({ repoRoot: root });
  fs.appendFileSync(path.join(root, 'skills/ecc-guide/SKILL.md'), '\nLarge on-demand body. '.repeat(5000));
  const after = compileContextProfile({ repoRoot: root });
  assert.equal(before.estimate.estimatedTokens, after.estimate.estimatedTokens);
  assert.notEqual(before.registryDigest, after.registryDigest);
  assert.notEqual(before.planDigest, after.planDigest);
}));

test('exact 8000 estimate passes and 8001 blocks while provider totals remain unknown', () => withFixture(root => {
  const before = compileContextProfile({ repoRoot: root });
  const file = path.join(root, 'skills/ecc-guide/SKILL.md');
  const source = fs.readFileSync(file, 'utf8');
  const padding = 'x'.repeat(4 * (8000 - before.estimate.estimatedTokens));
  fs.writeFileSync(file, source.replace('description: ', `description: ${padding}`));
  const boundary = compileContextProfile({ repoRoot: root });
  assert.equal(boundary.estimate.estimatedTokens, 8000);
  assert.equal(boundary.estimate.wholeScopeTokens, null);
  fs.writeFileSync(file, source.replace('description: ', `description: ${padding}xxxx`));
  assert.throws(() => compileContextProfile({ repoRoot: root }), error => {
    assert.equal(error.code, 'CONTEXT_PROFILE_BUDGET_EXCEEDED');
    assert.equal(error.plan.estimate.estimatedTokens, 8001);
    assert.equal(error.plan.estimate.wrapperTokens, null);
    return true;
  });
}));

test('every target projects the same explicit profile selection with unobserved native support', () => withFixture(root => {
  const { loadContextRegistry } = require('../../scripts/lib/context-pack-registry');
  for (const target of loadContextRegistry({ repoRoot: root }).targets) {
    const plan = compileContextProfile({ repoRoot: root, target });
    assert.deepEqual(plan.selectedIds, KERNEL.map(id => `skill:${id}`));
    assert.ok(plan.entries.every(entry => entry.projection.nativeSupport === 'unobserved'));
  }
}));
