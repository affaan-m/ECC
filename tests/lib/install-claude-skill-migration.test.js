'use strict';

const assert = require('assert');
const fs = require('fs');
const os = require('os');
const path = require('path');

const { applyInstallPlan } = require('../../scripts/lib/install/apply');
const { readInstallState, writeInstallState } = require('../../scripts/lib/install-state');
const { uninstallInstalledStates } = require('../../scripts/lib/install-lifecycle');

function createTempDir(prefix) {
  return fs.mkdtempSync(path.join(os.tmpdir(), prefix));
}

function cleanup(dirPath) {
  fs.rmSync(dirPath, { recursive: true, force: true });
}

function createOperation(moduleId, sourceRoot, sourceRelativePath, destinationPath) {
  return {
    kind: 'copy-file',
    moduleId,
    sourcePath: path.join(sourceRoot, sourceRelativePath),
    sourceRelativePath,
    destinationPath,
    strategy: 'preserve-relative-path',
    ownership: 'managed',
    scaffoldOnly: false,
  };
}

function createFixture(options = {}) {
  const tempDir = createTempDir('claude-skill-migration-');
  const homeDir = path.join(tempDir, 'home');
  const projectRoot = path.join(tempDir, 'project');
  const sourceRoot = path.join(tempDir, 'source');
  const target = options.target || 'claude';
  const targetRoot = target === 'claude'
    ? path.join(homeDir, '.claude')
    : path.join(projectRoot, target === 'cursor' ? '.cursor' : '.claude');
  const installStatePath = target === 'cursor'
    ? path.join(targetRoot, 'ecc-install-state.json')
    : path.join(targetRoot, 'ecc', 'install-state.json');
  const adapterId = target === 'claude'
    ? 'claude-home'
    : target === 'cursor' ? 'cursor-project' : 'claude-project';
  const adapterKind = target === 'claude' ? 'home' : 'project';
  const skillFiles = options.skillFiles || {
    'SKILL.md': '# Current ECC skill\n',
    'references/guide.md': '# Current ECC guide\n',
  };

  for (const [relativePath, content] of Object.entries(skillFiles)) {
    const sourcePath = path.join(sourceRoot, 'skills', 'demo-skill', relativePath);
    fs.mkdirSync(path.dirname(sourcePath), { recursive: true });
    fs.writeFileSync(sourcePath, content);
  }

  const operations = Object.keys(skillFiles).map(relativePath => createOperation(
    'workflow-quality',
    sourceRoot,
    path.join('skills', 'demo-skill', relativePath),
    path.join(targetRoot, 'skills', 'demo-skill', relativePath)
  ));
  const statePreview = {
    schemaVersion: 'ecc.install.v1',
    installedAt: new Date().toISOString(),
    target: {
      id: adapterId,
      target,
      kind: adapterKind,
      root: targetRoot,
      installStatePath,
    },
    request: {
      profile: null,
      modules: ['workflow-quality'],
      includeComponents: [],
      excludeComponents: [],
      legacyLanguages: [],
      legacyMode: false,
    },
    resolution: {
      selectedModules: ['workflow-quality'],
      skippedModules: [],
    },
    source: {
      repoVersion: null,
      repoCommit: null,
      manifestVersion: 1,
    },
    operations: operations.map(operation => ({ ...operation })),
  };

  return {
    tempDir,
    homeDir,
    projectRoot,
    sourceRoot,
    target,
    targetRoot,
    installStatePath,
    operations,
    plan: {
      mode: 'manifest',
      target,
      adapter: {
        id: adapterId,
        target,
        kind: adapterKind,
      },
      targetRoot,
      installRoot: targetRoot,
      installStatePath,
      operations,
      statePreview,
      warnings: [],
    },
  };
}

function legacyDestinationPath(targetRoot, operation) {
  const sourceParts = operation.sourceRelativePath.split(path.sep);
  return path.join(targetRoot, 'skills', 'ecc', ...sourceParts.slice(1));
}

function seedLegacyInstall(fixture, options = {}) {
  const legacyOperations = fixture.operations.map((operation, index) => {
    const destinationPath = legacyDestinationPath(fixture.targetRoot, operation);
    fs.mkdirSync(path.dirname(destinationPath), { recursive: true });
    fs.writeFileSync(destinationPath, `# Legacy managed file ${index}\n`);
    return {
      ...operation,
      sourceRelativePath: options.windowsSourcePaths
        ? operation.sourceRelativePath.split(path.sep).join('\\')
        : operation.sourceRelativePath,
      destinationPath,
    };
  });

  writeInstallState(fixture.installStatePath, {
    ...fixture.plan.statePreview,
    operations: legacyOperations,
  });
  return legacyOperations;
}

function runUninstall(fixture) {
  return uninstallInstalledStates({
    homeDir: fixture.homeDir,
    projectRoot: fixture.projectRoot,
    targets: [fixture.target],
  });
}

function test(name, fn) {
  try {
    fn();
    console.log(`  \u2713 ${name}`);
    return true;
  } catch (error) {
    console.log(`  \u2717 ${name}`);
    console.log(`    Error: ${error.stack || error.message}`);
    return false;
  }
}

function runTests() {
  console.log('\n=== Testing Claude flat-skill migration ===\n');
  let passed = 0;
  let failed = 0;

  for (const target of ['claude', 'claude-project']) {
    if (test(`migrates state-managed nested skills for ${target} without deleting untracked files`, () => {
      const fixture = createFixture({ target });
      try {
        const legacyOperations = seedLegacyInstall(fixture, {
          windowsSourcePaths: target === 'claude-project',
        });
        const untrackedPath = path.join(
          fixture.targetRoot,
          'skills',
          'ecc',
          'demo-skill',
          'user-notes.md'
        );
        fs.writeFileSync(untrackedPath, '# User notes\n');

        applyInstallPlan(fixture.plan);

        for (const operation of fixture.operations) {
          assert.strictEqual(
            fs.readFileSync(operation.destinationPath, 'utf8'),
            fs.readFileSync(operation.sourcePath, 'utf8')
          );
        }
        for (const operation of legacyOperations) {
          assert.ok(!fs.existsSync(operation.destinationPath), operation.destinationPath);
        }
        assert.strictEqual(fs.readFileSync(untrackedPath, 'utf8'), '# User notes\n');

        const state = readInstallState(fixture.installStatePath);
        assert.ok(state.operations.some(operation => (
          operation.destinationPath === fixture.operations[0].destinationPath
        )));
        assert.ok(!state.operations.some(operation => (
          operation.destinationPath.includes(path.join('skills', 'ecc', 'demo-skill'))
        )));

        const rerun = applyInstallPlan(fixture.plan);
        assert.deepStrictEqual(rerun.skippedOperations, []);
        assert.strictEqual(fs.readFileSync(untrackedPath, 'utf8'), '# User notes\n');

        const uninstall = runUninstall(fixture);
        assert.strictEqual(uninstall.summary.errorCount, 0);
        assert.ok(!fs.existsSync(fixture.operations[0].destinationPath));
        assert.strictEqual(fs.readFileSync(untrackedPath, 'utf8'), '# User notes\n');
      } finally {
        cleanup(fixture.tempDir);
      }
    })) passed++; else failed++;
  }

  if (test('selective migration preserves unrelated legacy skills and uninstall ownership', () => {
    const fixture = createFixture();
    try {
      const legacyOperations = seedLegacyInstall(fixture);
      const otherSourceRelativePath = path.join('skills', 'other-skill', 'SKILL.md');
      const otherSourcePath = path.join(fixture.sourceRoot, otherSourceRelativePath);
      const otherLegacyPath = path.join(
        fixture.targetRoot,
        'skills',
        'ecc',
        'other-skill',
        'SKILL.md'
      );
      fs.mkdirSync(path.dirname(otherSourcePath), { recursive: true });
      fs.mkdirSync(path.dirname(otherLegacyPath), { recursive: true });
      fs.writeFileSync(otherSourcePath, '# Other source\n');
      fs.writeFileSync(otherLegacyPath, '# Other legacy managed skill\n');
      const otherLegacyOperation = createOperation(
        'other-module',
        fixture.sourceRoot,
        otherSourceRelativePath,
        otherLegacyPath
      );
      writeInstallState(fixture.installStatePath, {
        ...fixture.plan.statePreview,
        operations: [...legacyOperations, otherLegacyOperation],
      });

      applyInstallPlan(fixture.plan);

      assert.ok(legacyOperations.every(operation => !fs.existsSync(operation.destinationPath)));
      assert.strictEqual(
        fs.readFileSync(otherLegacyPath, 'utf8'),
        '# Other legacy managed skill\n'
      );
      const state = readInstallState(fixture.installStatePath);
      assert.ok(state.operations.some(operation => (
        operation.destinationPath === otherLegacyPath
      )));

      const uninstall = runUninstall(fixture);
      assert.strictEqual(uninstall.summary.errorCount, 0);
      assert.ok(!fs.existsSync(otherLegacyPath));
    } finally {
      cleanup(fixture.tempDir);
    }
  })) passed++; else failed++;

  if (test('reruns a completed migration idempotently and remains uninstallable', () => {
    const fixture = createFixture();
    try {
      const legacyOperations = seedLegacyInstall(fixture);
      applyInstallPlan(fixture.plan);
      const stateAfterMigration = readInstallState(fixture.installStatePath);

      const rerun = applyInstallPlan(fixture.plan);
      const stateAfterRerun = readInstallState(fixture.installStatePath);

      assert.deepStrictEqual(rerun.skippedOperations, []);
      assert.ok(!rerun.warnings.some(warning => (
        warning.includes('user-owned') || warning.includes('nested copy')
      )));
      assert.deepStrictEqual(stateAfterRerun, stateAfterMigration);
      assert.ok(fixture.operations.every(operation => (
        fs.readFileSync(operation.destinationPath, 'utf8')
          === fs.readFileSync(operation.sourcePath, 'utf8')
      )));
      assert.ok(legacyOperations.every(operation => !fs.existsSync(operation.destinationPath)));
      assert.ok(!fs.existsSync(path.join(fixture.targetRoot, 'skills', 'ecc')));

      const uninstall = runUninstall(fixture);
      assert.strictEqual(uninstall.summary.errorCount, 0);
      assert.ok(fixture.operations.every(operation => !fs.existsSync(operation.destinationPath)));
    } finally {
      cleanup(fixture.tempDir);
    }
  })) passed++; else failed++;

  if (test('preserves a user-owned flat skill and keeps legacy ownership for uninstall', () => {
    const fixture = createFixture();
    try {
      const legacyOperations = seedLegacyInstall(fixture);
      const userSkillPath = fixture.operations[0].destinationPath;
      fs.mkdirSync(path.dirname(userSkillPath), { recursive: true });
      fs.writeFileSync(userSkillPath, '# User-owned flat skill\n');

      const result = applyInstallPlan(fixture.plan);

      assert.strictEqual(fs.readFileSync(userSkillPath, 'utf8'), '# User-owned flat skill\n');
      assert.ok(legacyOperations.every(operation => fs.existsSync(operation.destinationPath)));
      assert.ok(result.warnings.some(warning => (
        warning.includes('demo-skill') && warning.includes('user-owned')
      )), JSON.stringify(result.warnings));
      assert.strictEqual(result.operations.length, 0);
      assert.strictEqual(result.skippedOperations.length, fixture.operations.length);

      const state = readInstallState(fixture.installStatePath);
      assert.ok(legacyOperations.every(legacyOperation => (
        state.operations.some(operation => operation.destinationPath === legacyOperation.destinationPath)
      )));
      assert.ok(!state.operations.some(operation => (
        operation.destinationPath === fixture.operations[0].destinationPath
      )));

      const uninstall = runUninstall(fixture);
      assert.strictEqual(uninstall.summary.errorCount, 0);
      assert.strictEqual(fs.readFileSync(userSkillPath, 'utf8'), '# User-owned flat skill\n');
      assert.ok(legacyOperations.every(operation => !fs.existsSync(operation.destinationPath)));
    } finally {
      cleanup(fixture.tempDir);
    }
  })) passed++; else failed++;

  if (test('does not claim or merge into a user-owned flat skill on first install', () => {
    const fixture = createFixture();
    try {
      const userSkillPath = fixture.operations[0].destinationPath;
      fs.mkdirSync(path.dirname(userSkillPath), { recursive: true });
      fs.writeFileSync(userSkillPath, '# User-owned flat skill\n');

      const result = applyInstallPlan(fixture.plan);

      assert.strictEqual(fs.readFileSync(userSkillPath, 'utf8'), '# User-owned flat skill\n');
      assert.ok(!fs.existsSync(fixture.operations[1].destinationPath));
      assert.ok(result.warnings.some(warning => warning.includes('user-owned')));
      assert.strictEqual(result.operations.length, 0);
      assert.strictEqual(result.skippedOperations.length, fixture.operations.length);
      assert.deepStrictEqual(readInstallState(fixture.installStatePath).operations, []);

      const uninstall = runUninstall(fixture);
      assert.strictEqual(uninstall.summary.errorCount, 0);
      assert.strictEqual(fs.readFileSync(userSkillPath, 'utf8'), '# User-owned flat skill\n');
    } finally {
      cleanup(fixture.tempDir);
    }
  })) passed++; else failed++;

  if (test('updates recorded flat files but preserves conflicting unrecorded files', () => {
    const initial = createFixture({
      skillFiles: {
        'SKILL.md': '# Initial ECC skill\n',
      },
    });
    let expanded;
    try {
      applyInstallPlan(initial.plan);
      expanded = createFixture({
        skillFiles: {
          'SKILL.md': '# Updated ECC skill\n',
          'references/guide.md': '# ECC guide\n',
          'references/new.md': '# New managed file\n',
        },
      });
      const expandedOriginalTargetRoot = expanded.targetRoot;
      expanded.homeDir = initial.homeDir;
      expanded.projectRoot = initial.projectRoot;
      expanded.targetRoot = initial.targetRoot;
      expanded.installStatePath = initial.installStatePath;
      expanded.operations = expanded.operations.map(operation => ({
        ...operation,
        destinationPath: path.join(
          initial.targetRoot,
          path.relative(expandedOriginalTargetRoot, operation.destinationPath)
        ),
      }));
      expanded.plan = {
        ...expanded.plan,
        targetRoot: initial.targetRoot,
        installRoot: initial.targetRoot,
        installStatePath: initial.installStatePath,
        operations: expanded.operations,
        statePreview: {
          ...expanded.plan.statePreview,
          target: {
            ...expanded.plan.statePreview.target,
            root: initial.targetRoot,
            installStatePath: initial.installStatePath,
          },
          operations: expanded.operations,
        },
      };

      const userGuidePath = expanded.operations[1].destinationPath;
      fs.mkdirSync(path.dirname(userGuidePath), { recursive: true });
      fs.writeFileSync(userGuidePath, '# User guide\n');

      const result = applyInstallPlan(expanded.plan);

      assert.strictEqual(
        fs.readFileSync(expanded.operations[0].destinationPath, 'utf8'),
        '# Updated ECC skill\n'
      );
      assert.strictEqual(fs.readFileSync(userGuidePath, 'utf8'), '# User guide\n');
      assert.strictEqual(
        fs.readFileSync(expanded.operations[2].destinationPath, 'utf8'),
        '# New managed file\n'
      );
      assert.ok(result.warnings.some(warning => warning.includes('guide.md')));

      const state = readInstallState(initial.installStatePath);
      assert.ok(state.operations.some(operation => (
        operation.destinationPath === expanded.operations[0].destinationPath
      )));
      assert.ok(!state.operations.some(operation => (
        operation.destinationPath === userGuidePath
      )));
      assert.ok(state.operations.some(operation => (
        operation.destinationPath === expanded.operations[2].destinationPath
      )));
    } finally {
      cleanup(initial.tempDir);
      if (expanded) {
        cleanup(expanded.tempDir);
      }
    }
  })) passed++; else failed++;

  if (test('merges managed operations across selective installs for enabled and disabled migrations', () => {
    for (const target of ['claude', 'cursor']) {
      const fixture = createFixture({ target });
      try {
        applyInstallPlan(fixture.plan);

        const extraSourceRelativePath = path.join('skills', 'extra-skill', 'SKILL.md');
        const extraSourcePath = path.join(fixture.sourceRoot, extraSourceRelativePath);
        const extraDestinationPath = path.join(
          fixture.targetRoot,
          'skills',
          'extra-skill',
          'SKILL.md'
        );
        fs.mkdirSync(path.dirname(extraSourcePath), { recursive: true });
        fs.writeFileSync(extraSourcePath, '# Extra ECC skill\n');
        const extraOperation = createOperation(
          'skill-extra',
          fixture.sourceRoot,
          extraSourceRelativePath,
          extraDestinationPath
        );
        const extraPlan = {
          ...fixture.plan,
          operations: [extraOperation],
          statePreview: {
            ...fixture.plan.statePreview,
            request: {
              ...fixture.plan.statePreview.request,
              modules: [],
              includeComponents: ['skill-extra'],
            },
            resolution: {
              selectedModules: [],
              skippedModules: [],
            },
            operations: [extraOperation],
          },
        };

        applyInstallPlan(extraPlan);
        const stateAfterExtraInstall = readInstallState(fixture.installStatePath);
        assert.ok(fixture.operations.every(operation => (
          stateAfterExtraInstall.operations.some(recorded => (
            recorded.destinationPath === operation.destinationPath
          ))
        )));
        assert.ok(stateAfterExtraInstall.operations.some(operation => (
          operation.destinationPath === extraDestinationPath
        )));

        const updatedExtraOperation = {
          ...extraOperation,
          moduleId: 'skill-extra-updated',
        };
        applyInstallPlan({
          ...extraPlan,
          operations: [updatedExtraOperation],
          statePreview: {
            ...extraPlan.statePreview,
            operations: [updatedExtraOperation],
          },
        });
        const stateAfterMetadataUpdate = readInstallState(fixture.installStatePath);
        const updatedExtraRecords = stateAfterMetadataUpdate.operations.filter(operation => (
          operation.destinationPath === extraDestinationPath
        ));
        assert.strictEqual(updatedExtraRecords.length, 1);
        assert.strictEqual(updatedExtraRecords[0].moduleId, 'skill-extra-updated');

        const retry = applyInstallPlan(fixture.plan);
        assert.deepStrictEqual(retry.skippedOperations, []);
        const stateAfterRetry = readInstallState(fixture.installStatePath);
        const retainedExtraRecords = stateAfterRetry.operations.filter(operation => (
          operation.destinationPath === extraDestinationPath
        ));
        assert.strictEqual(retainedExtraRecords.length, 1);
        assert.strictEqual(retainedExtraRecords[0].moduleId, 'skill-extra-updated');

        const uninstall = runUninstall(fixture);
        assert.strictEqual(uninstall.summary.errorCount, 0);
        assert.ok(fixture.operations.every(operation => !fs.existsSync(operation.destinationPath)));
        assert.ok(!fs.existsSync(extraDestinationPath));
      } finally {
        cleanup(fixture.tempDir);
      }
    }
  })) passed++; else failed++;

  if (test('tracks a partial migration so retry and uninstall remain safe', () => {
    const fixture = createFixture();
    try {
      const legacyOperations = seedLegacyInstall(fixture);
      const missingSourcePlan = {
        ...fixture.plan,
        operations: fixture.operations.map((operation, index) => (
          index === 1
            ? { ...operation, sourcePath: path.join(fixture.sourceRoot, 'missing.md') }
            : operation
        )),
      };

      assert.throws(() => applyInstallPlan(missingSourcePlan), /ENOENT/);
      assert.ok(legacyOperations.every(operation => fs.existsSync(operation.destinationPath)));
      assert.ok(fs.existsSync(fixture.operations[0].destinationPath));
      assert.ok(!fs.existsSync(fixture.operations[1].destinationPath));
      const bridgeState = readInstallState(fixture.installStatePath);
      assert.ok(legacyOperations.every(legacyOperation => (
        bridgeState.operations.some(operation => (
          operation.destinationPath === legacyOperation.destinationPath
        ))
      )));
      assert.ok(fixture.operations.every(flatOperation => (
        bridgeState.operations.some(operation => (
          operation.destinationPath === flatOperation.destinationPath
        ))
      )));

      const retry = applyInstallPlan(fixture.plan);
      assert.deepStrictEqual(retry.skippedOperations, []);
      assert.ok(fixture.operations.every(operation => fs.existsSync(operation.destinationPath)));
      assert.ok(legacyOperations.every(operation => !fs.existsSync(operation.destinationPath)));

      const uninstall = runUninstall(fixture);
      assert.strictEqual(uninstall.summary.errorCount, 0);
      assert.ok(fixture.operations.every(operation => !fs.existsSync(operation.destinationPath)));
    } finally {
      cleanup(fixture.tempDir);
    }
  })) passed++; else failed++;

  if (test('tracks a partial first install so retry does not misclassify it as user-owned', () => {
    const fixture = createFixture();
    try {
      const missingSourcePlan = {
        ...fixture.plan,
        operations: fixture.operations.map((operation, index) => (
          index === 1
            ? { ...operation, sourcePath: path.join(fixture.sourceRoot, 'missing.md') }
            : operation
        )),
      };

      assert.throws(() => applyInstallPlan(missingSourcePlan), /ENOENT/);
      assert.ok(fs.existsSync(fixture.operations[0].destinationPath));
      assert.ok(!fs.existsSync(fixture.operations[1].destinationPath));
      const bridgeState = readInstallState(fixture.installStatePath);
      assert.ok(fixture.operations.every(flatOperation => (
        bridgeState.operations.some(operation => (
          operation.destinationPath === flatOperation.destinationPath
        ))
      )));

      const retry = applyInstallPlan(fixture.plan);
      assert.deepStrictEqual(retry.skippedOperations, []);
      assert.ok(!retry.warnings.some(warning => warning.includes('user-owned')));
      assert.ok(fixture.operations.every(operation => fs.existsSync(operation.destinationPath)));

      const uninstall = runUninstall(fixture);
      assert.strictEqual(uninstall.summary.errorCount, 0);
      assert.ok(fixture.operations.every(operation => !fs.existsSync(operation.destinationPath)));
    } finally {
      cleanup(fixture.tempDir);
    }
  })) passed++; else failed++;

  if (test('tracks non-skill files written before a partial flat-skill install fails', () => {
    const fixture = createFixture();
    try {
      const ruleSourceRelativePath = path.join('rules', 'common', 'coding.md');
      const ruleSourcePath = path.join(fixture.sourceRoot, ruleSourceRelativePath);
      const ruleDestinationPath = path.join(
        fixture.targetRoot,
        'rules',
        'ecc',
        'common',
        'coding.md'
      );
      fs.mkdirSync(path.dirname(ruleSourcePath), { recursive: true });
      fs.writeFileSync(ruleSourcePath, '# Managed rule\n');

      const ruleOperation = createOperation(
        'workflow-quality',
        fixture.sourceRoot,
        ruleSourceRelativePath,
        ruleDestinationPath
      );
      const missingOperation = createOperation(
        'workflow-quality',
        fixture.sourceRoot,
        path.join('commands', 'missing.md'),
        path.join(fixture.targetRoot, 'commands', 'missing.md')
      );
      const operations = [
        fixture.operations[0],
        ruleOperation,
        missingOperation,
      ];
      const partialPlan = {
        ...fixture.plan,
        operations,
        statePreview: {
          ...fixture.plan.statePreview,
          operations: operations.map(operation => ({ ...operation })),
        },
      };

      assert.throws(() => applyInstallPlan(partialPlan), /ENOENT/);
      assert.ok(fs.existsSync(ruleDestinationPath));

      const bridgeState = readInstallState(fixture.installStatePath);
      assert.ok(bridgeState.operations.some(operation => (
        operation.destinationPath === ruleDestinationPath
      )));

      const uninstall = runUninstall(fixture);
      assert.strictEqual(uninstall.summary.errorCount, 0);
      assert.ok(!fs.existsSync(ruleDestinationPath));
    } finally {
      cleanup(fixture.tempDir);
    }
  })) passed++; else failed++;

  if (test('tracks partial non-skill writes when every flat skill is user-owned', () => {
    const fixture = createFixture();
    try {
      const userSkillPath = fixture.operations[0].destinationPath;
      fs.mkdirSync(path.dirname(userSkillPath), { recursive: true });
      fs.writeFileSync(userSkillPath, '# User skill\n');

      const ruleSourceRelativePath = path.join('rules', 'common', 'coding.md');
      const ruleSourcePath = path.join(fixture.sourceRoot, ruleSourceRelativePath);
      const ruleDestinationPath = path.join(
        fixture.targetRoot,
        'rules',
        'ecc',
        'common',
        'coding.md'
      );
      fs.mkdirSync(path.dirname(ruleSourcePath), { recursive: true });
      fs.writeFileSync(ruleSourcePath, '# Managed rule\n');

      const ruleOperation = createOperation(
        'workflow-quality',
        fixture.sourceRoot,
        ruleSourceRelativePath,
        ruleDestinationPath
      );
      const missingOperation = createOperation(
        'workflow-quality',
        fixture.sourceRoot,
        path.join('commands', 'missing.md'),
        path.join(fixture.targetRoot, 'commands', 'missing.md')
      );
      const operations = [
        ...fixture.operations,
        ruleOperation,
        missingOperation,
      ];
      const partialPlan = {
        ...fixture.plan,
        operations,
        statePreview: {
          ...fixture.plan.statePreview,
          operations: operations.map(operation => ({ ...operation })),
        },
      };

      assert.throws(() => applyInstallPlan(partialPlan), /ENOENT/);
      assert.strictEqual(fs.readFileSync(userSkillPath, 'utf8'), '# User skill\n');
      assert.ok(fs.existsSync(ruleDestinationPath));

      const bridgeState = readInstallState(fixture.installStatePath);
      assert.ok(!bridgeState.operations.some(operation => (
        operation.destinationPath === userSkillPath
      )));
      assert.ok(bridgeState.operations.some(operation => (
        operation.destinationPath === ruleDestinationPath
      )));

      const uninstall = runUninstall(fixture);
      assert.strictEqual(uninstall.summary.errorCount, 0);
      assert.strictEqual(fs.readFileSync(userSkillPath, 'utf8'), '# User skill\n');
      assert.ok(!fs.existsSync(ruleDestinationPath));
    } finally {
      cleanup(fixture.tempDir);
    }
  })) passed++; else failed++;

  if (test('keeps legacy files tracked when the bridge state write fails', () => {
    const fixture = createFixture();
    try {
      const legacyOperations = seedLegacyInstall(fixture);
      const failingStateWriter = filePath => {
        assert.strictEqual(
          path.resolve(filePath),
          path.resolve(fixture.installStatePath)
        );
        throw new Error('injected install-state write failure');
      };

      assert.throws(
        () => applyInstallPlan(fixture.plan, { writeInstallState: failingStateWriter }),
        /injected install-state write failure/
      );

      assert.ok(legacyOperations.every(operation => fs.existsSync(operation.destinationPath)));
      assert.ok(fixture.operations.every(operation => !fs.existsSync(operation.destinationPath)));
      const state = readInstallState(fixture.installStatePath);
      assert.ok(state.operations.every(operation => (
        operation.destinationPath.includes(path.join('skills', 'ecc', 'demo-skill'))
      )));

      const retry = applyInstallPlan(fixture.plan);
      assert.deepStrictEqual(retry.skippedOperations, []);
      const uninstall = runUninstall(fixture);
      assert.strictEqual(uninstall.summary.errorCount, 0);
      assert.ok(fixture.operations.every(operation => !fs.existsSync(operation.destinationPath)));
    } finally {
      cleanup(fixture.tempDir);
    }
  })) passed++; else failed++;

  if (test('keeps both layouts represented if the final state write fails', () => {
    const fixture = createFixture();
    let stateWriteCount = 0;
    try {
      const legacyOperations = seedLegacyInstall(fixture);
      const failFinalStateWrite = (filePath, state) => {
        assert.strictEqual(
          path.resolve(filePath),
          path.resolve(fixture.installStatePath)
        );
        stateWriteCount += 1;
        if (stateWriteCount === 2) {
          throw new Error('injected final install-state write failure');
        }
        return writeInstallState(fixture.installStatePath, state);
      };

      assert.throws(
        () => applyInstallPlan(fixture.plan, { writeInstallState: failFinalStateWrite }),
        /injected final install-state write failure/
      );
      assert.ok(fixture.operations.every(operation => fs.existsSync(operation.destinationPath)));
      assert.ok(legacyOperations.every(operation => !fs.existsSync(operation.destinationPath)));

      const bridgeState = readInstallState(fixture.installStatePath);
      assert.ok(fixture.operations.every(flatOperation => (
        bridgeState.operations.some(operation => (
          operation.destinationPath === flatOperation.destinationPath
        ))
      )));
      assert.ok(bridgeState.operations.some(operation => (
        operation.destinationPath.includes(path.join('skills', 'ecc', 'demo-skill'))
      )));

      const uninstall = runUninstall(fixture);
      assert.strictEqual(uninstall.summary.errorCount, 0);
      assert.ok(fixture.operations.every(operation => !fs.existsSync(operation.destinationPath)));
    } finally {
      cleanup(fixture.tempDir);
    }
  })) passed++; else failed++;

  if (test('rejects a flat skill symlink that escapes the Claude install root', () => {
    if (process.platform === 'win32') {
      console.log('    ↷ skipped on Windows: symlink privileges vary');
      return;
    }

    const fixture = createFixture();
    try {
      const outsideRoot = path.join(fixture.tempDir, 'outside');
      fs.mkdirSync(outsideRoot, { recursive: true });
      const flatSkillRoot = path.join(fixture.targetRoot, 'skills', 'demo-skill');
      fs.mkdirSync(path.dirname(flatSkillRoot), { recursive: true });
      fs.symlinkSync(outsideRoot, flatSkillRoot, 'dir');

      assert.throws(
        () => applyInstallPlan(fixture.plan),
        /outside the install root|symlinked Claude skill path/
      );
      assert.deepStrictEqual(fs.readdirSync(outsideRoot), []);
      assert.ok(!fs.existsSync(fixture.installStatePath));
    } finally {
      cleanup(fixture.tempDir);
    }
  })) passed++; else failed++;

  if (test('rechecks skill directories created between validation and copy', () => {
    if (process.platform === 'win32') {
      console.log('    ↷ skipped on Windows: symlink privileges vary');
      return;
    }

    const fixture = createFixture({
      skillFiles: {
        'SKILL.md': '# Current ECC skill\n',
      },
    });
    const destinationDirectory = path.dirname(fixture.operations[0].destinationPath);
    const outsideRoot = path.join(fixture.tempDir, 'outside');
    const originalMkdirSync = fs.mkdirSync;

    try {
      originalMkdirSync(outsideRoot, { recursive: true });
      let injectedSymlink = false;
      fs.mkdirSync = function mkdirAndReplaceWithSymlink(directoryPath, options) {
        const result = originalMkdirSync(directoryPath, options);
        if (!injectedSymlink && path.resolve(directoryPath) === path.resolve(destinationDirectory)) {
          fs.rmSync(destinationDirectory, { recursive: true, force: true });
          fs.symlinkSync(outsideRoot, destinationDirectory, 'dir');
          injectedSymlink = true;
        }
        return result;
      };

      assert.throws(
        () => applyInstallPlan(fixture.plan, { writeInstallState() {} }),
        /outside the install root|symlinked Claude skill path/
      );
      assert.strictEqual(injectedSymlink, true);
      assert.deepStrictEqual(fs.readdirSync(outsideRoot), []);
    } finally {
      fs.mkdirSync = originalMkdirSync;
      cleanup(fixture.tempDir);
    }
  })) passed++; else failed++;

  if (test('rejects a dangling destination symlink before copying a Claude skill file', () => {
    if (process.platform === 'win32') {
      console.log('    ↷ skipped on Windows: symlink privileges vary');
      return;
    }

    const fixture = createFixture({
      skillFiles: {
        'SKILL.md': '# Current ECC skill\n',
      },
    });
    try {
      const outsideRoot = path.join(fixture.tempDir, 'outside');
      const outsideTarget = path.join(outsideRoot, 'not-created.md');
      fs.mkdirSync(outsideRoot, { recursive: true });
      fs.mkdirSync(path.dirname(fixture.operations[0].destinationPath), { recursive: true });
      fs.symlinkSync(outsideTarget, fixture.operations[0].destinationPath, 'file');
      assert.strictEqual(fs.existsSync(fixture.operations[0].destinationPath), false);

      assert.throws(
        () => applyInstallPlan(fixture.plan),
        /symlinked Claude skill path/
      );
      assert.ok(!fs.existsSync(outsideTarget));
      assert.ok(!fs.existsSync(fixture.installStatePath));
    } finally {
      cleanup(fixture.tempDir);
    }
  })) passed++; else failed++;

  console.log(`\nResults: Passed: ${passed}, Failed: ${failed}`);
  process.exit(failed > 0 ? 1 : 0);
}

runTests();
