/**
 * Tests for validate-install-manifests.js — install manifest schema and cross-reference validation.
 *
 * Split from the original monolithic tests/ci/validators.test.js.
 * Tests both success paths (against the real project) and error paths
 * (against temporary fixture directories via wrapper scripts).
 *
 * Run with: node tests/ci/validate-install-manifests.test.js
 */

const assert = require('assert');
const path = require('path');
const fs = require('fs');
const {
  test,
  createTestDir,
  cleanupTestDir,
  writeInstallComponentsManifest,
  writeInstallModulesManifest,
  writeInstallProfilesManifest,
  writeSkillFixture,
  stripShebang,
  runSourceViaTempFile,
  runValidatorWithDirs,
  runValidator,
  validatorsDir,
  modulesSchemaPath,
  profilesSchemaPath,
  componentsSchemaPath,
  finish
} = require('./validator-test-utils');

const PROFILE_NAMES = ['core', 'developer', 'security', 'research', 'full'];

// Standard constant overrides pointing the validator at a fixture directory.
function installManifestOverrides(testDir) {
  return {
    REPO_ROOT: testDir,
    MODULES_MANIFEST_PATH: path.join(testDir, 'manifests', 'install-modules.json'),
    PROFILES_MANIFEST_PATH: path.join(testDir, 'manifests', 'install-profiles.json'),
    COMPONENTS_MANIFEST_PATH: path.join(testDir, 'manifests', 'install-components.json'),
    MODULES_SCHEMA_PATH: modulesSchemaPath,
    PROFILES_SCHEMA_PATH: profilesSchemaPath,
    COMPONENTS_SCHEMA_PATH: componentsSchemaPath
  };
}

function runInstallManifestsValidator(testDir) {
  return runValidatorWithDirs('validate-install-manifests', installManifestOverrides(testDir));
}

// Module entry with schema-required fields defaulted; override per test.
function moduleEntry(overrides) {
  return {
    kind: 'skills',
    targets: ['claude'],
    dependencies: [],
    defaultInstall: false,
    cost: 'light',
    stability: 'stable',
    ...overrides
  };
}

// All five required profiles sharing one module list, with per-profile overrides.
function profilesFor(modules, perProfile = {}) {
  const profiles = {};
  for (const name of PROFILE_NAMES) {
    const description = name.charAt(0).toUpperCase() + name.slice(1);
    profiles[name] = { description, modules: perProfile[name] || modules };
  }
  return profiles;
}

console.log('\nvalidate-install-manifests.js:');

test('passes on real project install manifests', () => {
  const result = runValidator('validate-install-manifests');
  assert.strictEqual(result.code, 0, `Should pass, got stderr: ${result.stderr}`);
  assert.ok(result.stdout.includes('Validated'), 'Should output validation count');
});

test('fails when a curated skill is not referenced by any install module', () => {
  const testDir = createTestDir();
  try {
    writeInstallModulesManifest(testDir, [
      moduleEntry({ id: 'skill-alpha', description: 'Alpha skill', paths: ['skills/alpha'] }),
      moduleEntry({ id: 'skill-beta', description: 'Beta skill', paths: ['skills/beta'] })
    ]);
    writeInstallProfilesManifest(testDir, profilesFor(['skill-alpha', 'skill-beta']));
    writeSkillFixture(testDir, 'alpha', 'Alpha skill');
    writeSkillFixture(testDir, 'beta', 'Beta skill');

    let result = runInstallManifestsValidator(testDir);
    assert.strictEqual(result.code, 0, `Should pass with both skills referenced, got stderr: ${result.stderr}`);

    writeInstallModulesManifest(testDir, [
      moduleEntry({ id: 'skill-alpha', description: 'Alpha skill', paths: ['skills/alpha'] }),
      moduleEntry({ id: 'skill-beta', description: 'Beta skill', paths: ['skills/beta-restored'] })
    ]);
    writeSkillFixture(testDir, 'beta-restored', 'Beta skill restored');

    result = runInstallManifestsValidator(testDir);
    assert.strictEqual(result.code, 1, 'Should fail when beta is no longer referenced');
    assert.ok(result.stderr.includes('curated skill skills/beta is not referenced by any install module'), `Should report unreferenced skill, got: ${result.stderr}`);
  } finally {
    cleanupTestDir(testDir);
  }
});

test('exempts intentionally-unshipped skills from curated-skill coverage', () => {
  const testDir = createTestDir();
  try {
    writeInstallModulesManifest(testDir, [moduleEntry({ id: 'skill-alpha', description: 'Alpha skill', paths: ['skills/alpha'] })]);
    writeInstallProfilesManifest(testDir, profilesFor(['skill-alpha']));
    writeSkillFixture(testDir, 'alpha', 'Alpha skill');
    writeSkillFixture(testDir, 'unshipped-skill', 'Intentionally unshipped skill');

    const validatorPath = path.join(validatorsDir, 'validate-install-manifests.js');
    let source = stripShebang(fs.readFileSync(validatorPath, 'utf8'));
    for (const [constant, overridePath] of Object.entries(installManifestOverrides(testDir))) {
      const dirRegex = new RegExp(`const ${constant} = .*?;`);
      source = source.replace(dirRegex, `const ${constant} = ${JSON.stringify(overridePath)};`);
    }
    source = source.replace(/const INTENTIONALLY_UNSHIPPED_SKILL_IDS = .*?;/, "const INTENTIONALLY_UNSHIPPED_SKILL_IDS = new Set(['unshipped-skill']);");

    const result = runSourceViaTempFile(source);
    assert.strictEqual(result.code, 0, `Should pass when unshipped skill is allowlisted, got stderr: ${result.stderr}`);
  } finally {
    cleanupTestDir(testDir);
  }
});

test('exits 0 when install manifests do not exist', () => {
  const testDir = createTestDir();
  const result = runValidatorWithDirs('validate-install-manifests', {
    REPO_ROOT: testDir,
    MODULES_MANIFEST_PATH: path.join(testDir, 'manifests', 'install-modules.json'),
    PROFILES_MANIFEST_PATH: path.join(testDir, 'manifests', 'install-profiles.json')
  });
  assert.strictEqual(result.code, 0, 'Should skip when manifests are missing');
  assert.ok(result.stdout.includes('skipping'), 'Should say skipping');
  cleanupTestDir(testDir);
});

test('fails on invalid install manifest JSON', () => {
  const testDir = createTestDir();
  const manifestsDir = path.join(testDir, 'manifests');
  fs.mkdirSync(manifestsDir, { recursive: true });
  fs.writeFileSync(path.join(manifestsDir, 'install-modules.json'), '{ invalid json');
  writeInstallProfilesManifest(testDir, {});

  const result = runInstallManifestsValidator(testDir);
  assert.strictEqual(result.code, 1, 'Should fail on invalid JSON');
  assert.ok(result.stderr.includes('Invalid JSON'), 'Should report invalid JSON');
  cleanupTestDir(testDir);
});

test('fails when install module references a missing path', () => {
  const testDir = createTestDir();
  writeInstallModulesManifest(testDir, [
    moduleEntry({ id: 'rules-core', kind: 'rules', description: 'Rules', paths: ['rules'], defaultInstall: true }),
    moduleEntry({ id: 'security', description: 'Security', paths: ['skills/security-review'], targets: ['codex'], cost: 'medium' })
  ]);
  writeInstallProfilesManifest(
    testDir,
    profilesFor(['rules-core'], {
      security: ['rules-core', 'security'],
      full: ['rules-core', 'security']
    })
  );
  writeInstallComponentsManifest(testDir, [
    { id: 'baseline:rules', family: 'baseline', description: 'Rules', modules: ['rules-core'] },
    { id: 'capability:security', family: 'capability', description: 'Security', modules: ['security'] }
  ]);
  fs.mkdirSync(path.join(testDir, 'rules'), { recursive: true });

  const result = runInstallManifestsValidator(testDir);
  assert.strictEqual(result.code, 1, 'Should fail when a referenced path is missing');
  assert.ok(result.stderr.includes('references missing path'), 'Should report missing path');
  cleanupTestDir(testDir);
});

test('fails when a curated skill directory is not referenced by any module (#2431)', () => {
  const testDir = createTestDir();
  try {
    writeInstallModulesManifest(testDir, [moduleEntry({ id: 'security', description: 'Security', paths: ['skills/security-review'], cost: 'medium' })]);
    writeInstallProfilesManifest(testDir, profilesFor(['security']));
    writeInstallComponentsManifest(testDir, [{ id: 'capability:security', family: 'capability', description: 'Security', modules: ['security'] }]);
    // Referenced skill exists; a second curated skill exists but no module claims it.
    fs.mkdirSync(path.join(testDir, 'skills', 'security-review'), { recursive: true });
    fs.writeFileSync(path.join(testDir, 'skills', 'security-review', 'SKILL.md'), '# ok\n');
    fs.mkdirSync(path.join(testDir, 'skills', 'orphan-skill'), { recursive: true });
    fs.writeFileSync(path.join(testDir, 'skills', 'orphan-skill', 'SKILL.md'), '# orphan\n');
    // A non-skill directory (no SKILL.md) must NOT be flagged.
    fs.mkdirSync(path.join(testDir, 'skills', 'shared-assets'), { recursive: true });
    // A hidden directory must NOT be flagged even if it contains a SKILL.md.
    fs.mkdirSync(path.join(testDir, 'skills', '.hidden-skill'), { recursive: true });
    fs.writeFileSync(path.join(testDir, 'skills', '.hidden-skill', 'SKILL.md'), '# hidden\n');

    const result = runInstallManifestsValidator(testDir);
    assert.strictEqual(result.code, 1, 'Should fail on an unreferenced curated skill');
    assert.ok(result.stderr.includes('skills/orphan-skill'), 'Should name the orphaned skill');
    assert.ok(!result.stderr.includes('skills/security-review'), 'Should not flag referenced skills');
    assert.ok(!result.stderr.includes('shared-assets'), 'Should not flag directories without SKILL.md');
    assert.ok(!result.stderr.includes('.hidden-skill'), 'Should not flag hidden directories');
  } finally {
    cleanupTestDir(testDir);
  }
});

test('fails when two install modules claim the same path', () => {
  const testDir = createTestDir();
  writeInstallModulesManifest(testDir, [
    moduleEntry({ id: 'agents-core', kind: 'agents', description: 'Agents', paths: ['agents'], targets: ['codex'], defaultInstall: true }),
    moduleEntry({ id: 'commands-core', kind: 'commands', description: 'Commands', paths: ['agents'], targets: ['codex'], defaultInstall: true })
  ]);
  writeInstallProfilesManifest(testDir, profilesFor(['agents-core', 'commands-core']));
  writeInstallComponentsManifest(testDir, [
    { id: 'baseline:agents', family: 'baseline', description: 'Agents', modules: ['agents-core'] },
    { id: 'baseline:commands', family: 'baseline', description: 'Commands', modules: ['commands-core'] }
  ]);
  fs.mkdirSync(path.join(testDir, 'agents'), { recursive: true });

  const result = runInstallManifestsValidator(testDir);
  assert.strictEqual(result.code, 1, 'Should fail on duplicate claimed paths');
  assert.ok(result.stderr.includes('claimed by both'), 'Should report duplicate path claims');
  cleanupTestDir(testDir);
});

test('fails when an install profile references an unknown module', () => {
  const testDir = createTestDir();
  writeInstallModulesManifest(testDir, [moduleEntry({ id: 'rules-core', kind: 'rules', description: 'Rules', paths: ['rules'], defaultInstall: true })]);
  writeInstallProfilesManifest(
    testDir,
    profilesFor(['rules-core'], {
      full: ['rules-core', 'ghost-module']
    })
  );
  writeInstallComponentsManifest(testDir, [{ id: 'baseline:rules', family: 'baseline', description: 'Rules', modules: ['rules-core'] }]);
  fs.mkdirSync(path.join(testDir, 'rules'), { recursive: true });

  const result = runInstallManifestsValidator(testDir);
  assert.strictEqual(result.code, 1, 'Should fail on unknown profile module');
  assert.ok(result.stderr.includes('references unknown module ghost-module'), 'Should report unknown module reference');
  cleanupTestDir(testDir);
});

test('passes on a valid standalone install manifest fixture', () => {
  const testDir = createTestDir();
  writeInstallModulesManifest(testDir, [
    moduleEntry({ id: 'rules-core', kind: 'rules', description: 'Rules', paths: ['rules'], defaultInstall: true }),
    moduleEntry({
      id: 'orchestration',
      kind: 'orchestration',
      description: 'Orchestration',
      paths: ['scripts/orchestrate-worktrees.js'],
      targets: ['codex'],
      dependencies: ['rules-core'],
      cost: 'medium',
      stability: 'beta'
    })
  ]);
  writeInstallProfilesManifest(
    testDir,
    profilesFor(['rules-core'], {
      developer: ['rules-core', 'orchestration'],
      full: ['rules-core', 'orchestration']
    })
  );
  writeInstallComponentsManifest(testDir, [
    { id: 'baseline:rules', family: 'baseline', description: 'Rules', modules: ['rules-core'] },
    { id: 'capability:orchestration', family: 'capability', description: 'Orchestration', modules: ['orchestration'] }
  ]);
  fs.mkdirSync(path.join(testDir, 'rules'), { recursive: true });
  fs.mkdirSync(path.join(testDir, 'scripts'), { recursive: true });
  fs.writeFileSync(path.join(testDir, 'scripts', 'orchestrate-worktrees.js'), '#!/usr/bin/env node\n');

  const result = runInstallManifestsValidator(testDir);
  assert.strictEqual(result.code, 0, `Should pass valid fixture, got stderr: ${result.stderr}`);
  assert.ok(result.stdout.includes('Validated 2 install modules, 2 install components, and 5 profiles'), 'Should report validated install manifest counts');
  cleanupTestDir(testDir);
});

test('fails when an install component references an unknown module', () => {
  const testDir = createTestDir();
  writeInstallModulesManifest(testDir, [moduleEntry({ id: 'rules-core', kind: 'rules', description: 'Rules', paths: ['rules'], defaultInstall: true })]);
  writeInstallProfilesManifest(testDir, profilesFor(['rules-core']));
  writeInstallComponentsManifest(testDir, [{ id: 'capability:security', family: 'capability', description: 'Security', modules: ['ghost-module'] }]);
  fs.mkdirSync(path.join(testDir, 'rules'), { recursive: true });

  const result = runInstallManifestsValidator(testDir);
  assert.strictEqual(result.code, 1, 'Should fail on unknown component module');
  assert.ok(result.stderr.includes('references unknown module ghost-module'), 'Should report unknown component module');
  cleanupTestDir(testDir);
});

finish();
