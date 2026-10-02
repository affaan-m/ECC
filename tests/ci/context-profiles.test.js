'use strict';

const assert = require('assert');
const path = require('path');
const { spawnSync } = require('child_process');
const ROOT = path.resolve(__dirname, '../..');
const SCRIPT = path.join(ROOT, 'scripts/ci/validate-context-profiles.js');
const fs = require('fs');
const { withFixture, write, update } = require('../lib/helpers/context-fixture');
const { loadContextRegistry, skillTriggerSourceDigest } = require('../../scripts/lib/context-pack-registry');
const { digestObject } = require('../../scripts/lib/context-profile-support');
const { validate } = require('../../scripts/ci/validate-context-profiles');

function seedTriggers(repoRoot, legacy = false) {
  const registry = loadContextRegistry({ repoRoot });
  const triggers = { 'skill:feature': ['feature task'] };
  write(repoRoot, 'manifests/context-packs/skill-triggers@1.json', {
    schemaVersion: 1, registryDigest: registry.registryDigest,
    ...(legacy ? {} : { triggerSourceDigest: skillTriggerSourceDigest(registry) }),
    coverage: { skills: registry.entries.length, withTriggers: 1 },
    triggers, triggersDigest: digestObject(triggers),
  });
  return registry;
}

const tests = [
  ['validates every profile against every declared target in read-only mode', () => {
    const result = spawnSync(process.execPath, [SCRIPT, '--json'], {
      cwd: ROOT, encoding: 'utf8', timeout: 30_000,
    });
    assert.strictEqual(result.status, 0, result.stderr);
    const output = JSON.parse(result.stdout);
    assert.strictEqual(output.status, 'success');
    assert.strictEqual(output.profileCount, 2);
    assert.ok(output.targetCount >= 15);
    assert.strictEqual(output.projectionCount, output.profileCount * output.targetCount);
    assert.ok(output.skillCount >= 286);
    assert.strictEqual(output.nativeCertification, 'unobserved');
  }],
  ['rejects unknown validator flags', () => {
    const result = spawnSync(process.execPath, [SCRIPT, '--write'], { encoding: 'utf8', timeout: 30_000 });
    assert.strictEqual(result.status, 1);
    assert.match(result.stderr, /Unknown argument/);
  }],
  ['registers the schema gate in the normal test workflow', () => {
    const { scripts } = require('../../package.json');
    assert.strictEqual(scripts['context-profiles:check'], 'node scripts/ci/validate-context-profiles.js');
    assert.ok(scripts.test.includes('validate-context-profiles.js'));
  }],
  ['body and auxiliary resource edits preserve trigger freshness but change the registry', () => withFixture(repoRoot => {
    const before = seedTriggers(repoRoot);
    fs.appendFileSync(path.join(repoRoot, 'skills/feature/SKILL.md'), '\nCorrected instructions.\n');
    write(repoRoot, 'skills/feature/references/details.md', 'Corrected resource.\n');
    const after = loadContextRegistry({ repoRoot });
    assert.notStrictEqual(after.registryDigest, before.registryDigest);
    assert.strictEqual(skillTriggerSourceDigest(after), skillTriggerSourceDigest(before));
    assert.strictEqual(validate(repoRoot).status, 'success');
  })],
  ...['name', 'description'].map(field => [`changed ${field} invalidates triggers`, () => withFixture(repoRoot => {
    seedTriggers(repoRoot);
    const file = path.join(repoRoot, 'skills/feature/SKILL.md');
    const text = fs.readFileSync(file, 'utf8');
    fs.writeFileSync(file, text.replace(new RegExp(`^${field}:.*$`, 'm'), `${field}: Changed metadata`));
    assert.throws(() => validate(repoRoot), /Skill triggers manifest is stale/);
  })]),
  ['new canonical skills invalidate triggers', () => withFixture(repoRoot => {
    seedTriggers(repoRoot);
    write(repoRoot, 'skills/added/SKILL.md', '---\nname: added\ndescription: Added skill.\n---\n');
    update(repoRoot, 'manifests/install-modules.json', value => {
      value.modules[0].paths.push('skills/added');
      return value;
    });
    assert.throws(() => validate(repoRoot), /Skill triggers manifest is stale/);
  })],
  ['removed canonical skills invalidate triggers even without their own trigger entry', () => withFixture(repoRoot => {
    seedTriggers(repoRoot);
    fs.unlinkSync(path.join(repoRoot, 'skills/shared/SKILL.md'));
    assert.throws(() => validate(repoRoot), /Skill triggers manifest is stale/);
  })],
  ['legacy manifests retain full registry freshness checks', () => withFixture(repoRoot => {
    seedTriggers(repoRoot, true);
    assert.strictEqual(validate(repoRoot).status, 'success');
    fs.appendFileSync(path.join(repoRoot, 'skills/feature/SKILL.md'), '\nChanged body.\n');
    assert.throws(() => validate(repoRoot), /Skill triggers manifest is stale/);
  })],
  ['trigger edits still require a matching trigger digest', () => withFixture(repoRoot => {
    seedTriggers(repoRoot);
    update(repoRoot, 'manifests/context-packs/skill-triggers@1.json', value => {
      value.triggers['skill:feature'].push('unrecorded trigger');
      return value;
    });
    assert.throws(() => validate(repoRoot), /Skill triggers digest mismatch/);
  })],
];

let passed = 0;
for (const [name, test] of tests) {
  try { test(); passed++; console.log(`PASS ${name}`); }
  catch (error) { console.error(`FAIL ${name}: ${error.message}`); }
}
console.log(`Passed: ${passed}\nFailed: ${tests.length - passed}`);
process.exitCode = passed === tests.length ? 0 : 1;
