/**
 * Contract and lifecycle tests for the Mistral Vibe project target.
 */

'use strict';

const assert = require('assert');
const fs = require('fs');
const os = require('os');
const path = require('path');

const { createManifestInstallPlan } = require('../../scripts/lib/install/plan');
const { applyInstallPlan } = require('../../scripts/lib/install/apply');
const {
  buildDoctorReport,
  repairInstalledStates,
  uninstallInstalledStates,
} = require('../../scripts/lib/install-lifecycle');
const { resolveInstallPlan } = require('../../scripts/lib/install-manifests');
const {
  getInstallTargetAdapter,
  planInstallTargetScaffold,
} = require('../../scripts/lib/install-targets/registry');
const { createLegacyCompatInstallPlan } = require('../../scripts/lib/install-executor');

const REPO_ROOT = path.resolve(__dirname, '..', '..');

let passed = 0;
let failed = 0;

function test(name, fn) {
  try {
    fn();
    console.log(`  ✓ ${name}`);
    passed += 1;
  } catch (error) {
    console.log(`  ✗ ${name}`);
    console.log(`    Error: ${error.message}`);
    failed += 1;
  }
}

function createFixture() {
  return {
    homeDir: fs.mkdtempSync(path.join(os.tmpdir(), 'ecc-vibe-home-')),
    projectRoot: fs.mkdtempSync(path.join(os.tmpdir(), 'ecc-vibe-project-')),
  };
}

function cleanupFixture(fixture) {
  fs.rmSync(fixture.homeDir, { recursive: true, force: true });
  fs.rmSync(fixture.projectRoot, { recursive: true, force: true });
}

function createSkillPlan(fixture) {
  return createManifestInstallPlan({
    sourceRoot: REPO_ROOT,
    target: 'mistral-vibe',
    includeComponentIds: ['skill:tdd-workflow'],
    projectRoot: fixture.projectRoot,
    homeDir: fixture.homeDir,
  });
}

console.log('\n=== Mistral Vibe install target tests ===\n');

test('registers a project adapter rooted at .vibe', () => {
  const adapter = getInstallTargetAdapter('mistral-vibe');
  const projectRoot = path.resolve('/workspace/app');

  assert.strictEqual(adapter.id, 'mistral-vibe-project');
  assert.strictEqual(adapter.target, 'mistral-vibe');
  assert.strictEqual(adapter.kind, 'project');
  assert.strictEqual(adapter.resolveRoot({ projectRoot }), path.join(projectRoot, '.vibe'));
  assert.strictEqual(
    adapter.getInstallStatePath({ projectRoot }),
    path.join(projectRoot, '.vibe', 'ecc-install-state.json')
  );
});

test('maps only canonical skill sources into the native Vibe skills directory', () => {
  const projectRoot = path.resolve('/workspace/app');
  const plan = planInstallTargetScaffold({
    target: 'mistral-vibe',
    repoRoot: REPO_ROOT,
    projectRoot,
    modules: [
      { id: 'skill-tdd-workflow', kind: 'skills', paths: ['skills/tdd-workflow'] },
      { id: 'agents-core', kind: 'agents', paths: ['AGENTS.md', 'agents', '.agents'] },
      { id: 'commands-core', kind: 'commands', paths: ['commands'] },
      { id: 'rules-core', kind: 'rules', paths: ['rules'] },
      { id: 'hooks-runtime', kind: 'hooks', paths: ['hooks'] },
      { id: 'platform-configs', kind: 'platform', paths: ['.vibe', '.mcp.json'] },
    ],
  });

  assert.deepStrictEqual(plan.operations, [{
    kind: 'copy-path',
    moduleId: 'skill-tdd-workflow',
    sourceRelativePath: 'skills/tdd-workflow',
    destinationPath: path.join(projectRoot, '.vibe', 'skills', 'tdd-workflow'),
    strategy: 'preserve-relative-path',
    ownership: 'managed',
    scaffoldOnly: true,
  }]);
});

test('rejects unsafe Vibe skill source paths before planning writes', () => {
  for (const sourceRelativePath of [
    'skills/../AGENTS.md',
    'skills\\..\\AGENTS.md',
    '/tmp/skills/escape',
    'skills//escape',
  ]) {
    assert.throws(
      () => planInstallTargetScaffold({
        target: 'mistral-vibe',
        repoRoot: REPO_ROOT,
        projectRoot: '/workspace/app',
        modules: [{ id: 'unsafe-skill', kind: 'skills', paths: [sourceRelativePath] }],
      }),
      /unsafe Mistral Vibe skill source path/i,
      sourceRelativePath
    );
  }
});

test('resolves a single-skill install without claiming unsupported profiles', () => {
  assert.throws(
    () => resolveInstallPlan({
      repoRoot: REPO_ROOT,
      target: 'mistral-vibe',
      projectRoot: '/workspace/app',
    }),
    /Mistral Vibe.*--skills/i
  );
  const plan = resolveInstallPlan({
    repoRoot: REPO_ROOT,
    target: 'mistral-vibe',
    projectRoot: '/workspace/app',
    includeComponentIds: ['skill:tdd-workflow'],
  });

  assert.deepStrictEqual(plan.selectedModuleIds, ['skill-tdd-workflow']);
  assert.deepStrictEqual(plan.skippedModuleIds, []);
  assert.strictEqual(plan.operations.length, 1);
  const existingExactModulePlan = resolveInstallPlan({
    repoRoot: REPO_ROOT,
    target: 'mistral-vibe',
    projectRoot: '/workspace/app',
    includeComponentIds: ['skill:unified-memory'],
  });
  assert.deepStrictEqual(existingExactModulePlan.selectedModuleIds, ['skill-unified-memory']);
  assert.deepStrictEqual(
    existingExactModulePlan.operations.map(operation => operation.sourceRelativePath),
    ['skills/unified-memory']
  );
  assert.throws(
    () => resolveInstallPlan({
      repoRoot: REPO_ROOT,
      target: 'mistral-vibe',
      projectRoot: '/workspace/app',
      profileId: 'minimal',
    }),
    /Mistral Vibe.*--skills/i
  );
  assert.throws(
    () => resolveInstallPlan({
      repoRoot: REPO_ROOT,
      target: 'mistral-vibe',
      projectRoot: '/workspace/app',
      moduleIds: ['workflow-quality'],
    }),
    /Mistral Vibe.*--skills/i
  );
});

test('guides legacy language requests to the supported Vibe skill surface', () => {
  assert.throws(
    () => createLegacyCompatInstallPlan({
      sourceRoot: REPO_ROOT,
      target: 'mistral-vibe',
      legacyLanguages: ['typescript'],
      projectRoot: '/workspace/app',
    }),
    /--target mistral-vibe --skills <id,...>/
  );
});

test('installs, diagnoses, repairs, and uninstalls a Vibe skill', () => {
  const fixture = createFixture();
  try {
    const plan = createSkillPlan(fixture);
    applyInstallPlan(plan);

    const skillPath = path.join(fixture.projectRoot, '.vibe', 'skills', 'tdd-workflow', 'SKILL.md');
    const statePath = path.join(fixture.projectRoot, '.vibe', 'ecc-install-state.json');
    assert.ok(fs.existsSync(skillPath));
    assert.ok(fs.existsSync(statePath));

    const healthy = buildDoctorReport({
      repoRoot: REPO_ROOT,
      projectRoot: fixture.projectRoot,
      homeDir: fixture.homeDir,
      targets: ['mistral-vibe'],
    });
    assert.strictEqual(healthy.results[0].status, 'ok');

    fs.unlinkSync(skillPath);
    const broken = buildDoctorReport({
      repoRoot: REPO_ROOT,
      projectRoot: fixture.projectRoot,
      homeDir: fixture.homeDir,
      targets: ['mistral-vibe'],
    });
    assert.strictEqual(broken.results[0].status, 'error');

    const repaired = repairInstalledStates({
      repoRoot: REPO_ROOT,
      projectRoot: fixture.projectRoot,
      homeDir: fixture.homeDir,
      targets: ['mistral-vibe'],
    });
    assert.strictEqual(repaired.results[0].status, 'repaired');
    assert.ok(fs.existsSync(skillPath));

    const uninstalled = uninstallInstalledStates({
      repoRoot: REPO_ROOT,
      projectRoot: fixture.projectRoot,
      homeDir: fixture.homeDir,
      targets: ['mistral-vibe'],
    });
    assert.strictEqual(uninstalled.results[0].status, 'uninstalled');
    assert.ok(!fs.existsSync(skillPath));
    assert.ok(!fs.existsSync(statePath));
  } finally {
    cleanupFixture(fixture);
  }
});

test('never overwrites or claims a user-owned Vibe skill file', () => {
  const fixture = createFixture();
  const skillPath = path.join(fixture.projectRoot, '.vibe', 'skills', 'tdd-workflow', 'SKILL.md');
  try {
    fs.mkdirSync(path.dirname(skillPath), { recursive: true });
    fs.writeFileSync(skillPath, '# User-owned Vibe skill\n', 'utf8');

    const result = applyInstallPlan(createSkillPlan(fixture));
    assert.strictEqual(fs.readFileSync(skillPath, 'utf8'), '# User-owned Vibe skill\n');
    assert.ok(result.skippedOperations.some(operation => operation.destinationPath === skillPath));
    assert.ok(!result.statePreview.operations.some(operation => operation.destinationPath === skillPath));
  } finally {
    cleanupFixture(fixture);
  }
});

test('rejects a Vibe skill file created after preflight without overwriting it', () => {
  const fixture = createFixture();
  const skillPath = path.join(fixture.projectRoot, '.vibe', 'skills', 'tdd-workflow', 'SKILL.md');
  try {
    const plan = createSkillPlan(fixture);
    assert.throws(
      () => applyInstallPlan(plan, {
        beforeOperationWrite({ operation }) {
          if (operation.destinationPath === skillPath) {
            fs.writeFileSync(skillPath, '# Concurrent user-owned Vibe skill\n', 'utf8');
          }
        },
      }),
      /user-owned file appeared.*after planning/i
    );
    assert.strictEqual(
      fs.readFileSync(skillPath, 'utf8'),
      '# Concurrent user-owned Vibe skill\n'
    );
  } finally {
    cleanupFixture(fixture);
  }
});

test('preserves a modified managed Vibe skill during uninstall', () => {
  const fixture = createFixture();
  const skillPath = path.join(fixture.projectRoot, '.vibe', 'skills', 'tdd-workflow', 'SKILL.md');
  try {
    applyInstallPlan(createSkillPlan(fixture));
    fs.appendFileSync(skillPath, '\nUser change.\n', 'utf8');

    const result = uninstallInstalledStates({
      repoRoot: REPO_ROOT,
      projectRoot: fixture.projectRoot,
      homeDir: fixture.homeDir,
      targets: ['mistral-vibe'],
    });
    assert.strictEqual(result.results[0].status, 'partial');
    assert.ok(fs.existsSync(skillPath));
    assert.ok(fs.existsSync(path.join(fixture.projectRoot, '.vibe', 'ecc-install-state.json')));
  } finally {
    cleanupFixture(fixture);
  }
});

console.log(`\nPassed: ${passed}`);
console.log(`Failed: ${failed}`);
process.exit(failed > 0 ? 1 : 0);
