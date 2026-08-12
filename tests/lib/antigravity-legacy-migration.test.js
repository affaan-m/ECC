/**
 * Focused coverage for migrating Antigravity installs from .agent to .agents.
 */

const assert = require('assert');
const crypto = require('crypto');
const fs = require('fs');
const os = require('os');
const path = require('path');

const { applyInstallPlan } = require('../../scripts/lib/install/apply');
const {
  buildDoctorReport,
  discoverInstalledStates,
  repairInstalledStates,
  uninstallInstalledStates,
} = require('../../scripts/lib/install-lifecycle');
const {
  createInstallState,
  readInstallState,
  writeInstallState,
} = require('../../scripts/lib/install-state');

const REPO_ROOT = path.join(__dirname, '..', '..');
const PACKAGE_VERSION = require('../../package.json').version;
const MANIFEST_VERSION = require('../../manifests/install-modules.json').version;

function test(name, fn) {
  try {
    fn();
    console.log(`  \u2713 ${name}`);
    return true;
  } catch (error) {
    console.log(`  \u2717 ${name}`);
    console.log(`    Error: ${error.message}`);
    return false;
  }
}

function digest(content) {
  return crypto.createHash('sha256').update(content).digest('hex');
}

function managedCopy(destinationPath, sourceRelativePath, content) {
  return {
    kind: 'copy-file',
    moduleId: 'rules-core',
    sourceRelativePath,
    destinationPath,
    strategy: 'copy-file',
    ownership: 'managed',
    scaffoldOnly: false,
    contentSha256: digest(content),
  };
}

function createAntigravityState(targetRoot, installStatePath, operations = []) {
  return createInstallState({
    adapter: { id: 'antigravity-project', target: 'antigravity', kind: 'project' },
    targetRoot,
    installStatePath,
    request: {
      profile: null,
      modules: [],
      includeComponents: [],
      excludeComponents: [],
      legacyLanguages: ['typescript'],
      legacyMode: true,
    },
    resolution: {
      selectedModules: ['legacy-antigravity-install'],
      skippedModules: [],
    },
    source: {
      repoVersion: PACKAGE_VERSION,
      repoCommit: 'test-commit',
      manifestVersion: MANIFEST_VERSION,
    },
    operations,
  });
}

function seedLegacyState(projectRoot, entries = []) {
  const targetRoot = path.join(projectRoot, '.agent');
  const installStatePath = path.join(targetRoot, 'ecc-install-state.json');
  const operations = entries.map(entry => {
    const destinationPath = path.join(targetRoot, entry.relativePath);
    fs.mkdirSync(path.dirname(destinationPath), { recursive: true });
    fs.writeFileSync(destinationPath, entry.recordedContent, 'utf8');
    return managedCopy(destinationPath, entry.sourceRelativePath, entry.recordedContent);
  });
  writeInstallState(
    installStatePath,
    createAntigravityState(targetRoot, installStatePath, operations)
  );
  return { targetRoot, installStatePath, operations };
}

function createCanonicalPlan(projectRoot, sourcePath) {
  const targetRoot = path.join(projectRoot, '.agents');
  const installStatePath = path.join(targetRoot, 'ecc-install-state.json');
  const operation = {
    kind: 'copy-file',
    moduleId: 'rules-core',
    sourcePath,
    sourceRelativePath: 'rules/common/coding-style.md',
    destinationPath: path.join(targetRoot, 'rules', 'coding-style.md'),
    strategy: 'copy-file',
    ownership: 'managed',
    scaffoldOnly: false,
  };

  return {
    mode: 'legacy',
    sourceRoot: REPO_ROOT,
    target: 'antigravity',
    adapter: { id: 'antigravity-project', target: 'antigravity', kind: 'project' },
    targetRoot,
    installRoot: targetRoot,
    installStatePath,
    operations: [operation],
    warnings: [],
    statePreview: createAntigravityState(targetRoot, installStatePath, [operation]),
  };
}

function runTests() {
  console.log('\n=== Testing Antigravity legacy migration ===\n');

  let passed = 0;
  let failed = 0;

  if (test('writes canonical state before removing unchanged legacy-managed files', () => {
    const projectRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'antigravity-migrate-'));
    try {
      const legacy = seedLegacyState(projectRoot, [{
        relativePath: 'rules/common-coding-style.md',
        sourceRelativePath: 'rules/common/coding-style.md',
        recordedContent: fs.readFileSync(
          path.join(REPO_ROOT, 'rules', 'common', 'coding-style.md'),
          'utf8'
        ),
      }]);
      const sourcePath = path.join(projectRoot, 'source.md');
      fs.writeFileSync(sourcePath, 'canonical managed\n', 'utf8');
      const plan = createCanonicalPlan(projectRoot, sourcePath);

      applyInstallPlan(plan, {
        writeInstallState(filePath, state) {
          assert.ok(fs.existsSync(legacy.installStatePath));
          assert.ok(fs.existsSync(legacy.operations[0].destinationPath));
          return writeInstallState(filePath, state);
        },
      });

      assert.ok(fs.existsSync(plan.installStatePath));
      assert.ok(fs.existsSync(plan.operations[0].destinationPath));
      assert.ok(!fs.existsSync(legacy.operations[0].destinationPath));
      assert.ok(!fs.existsSync(legacy.installStatePath));
    } finally {
      fs.rmSync(projectRoot, { recursive: true, force: true });
    }
  })) passed++; else failed++;

  if (test('does not clean legacy files when canonical state persistence fails', () => {
    const projectRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'antigravity-migrate-fail-'));
    try {
      const legacy = seedLegacyState(projectRoot, [{
        relativePath: 'rules/common-coding-style.md',
        sourceRelativePath: 'rules/common/coding-style.md',
        recordedContent: fs.readFileSync(
          path.join(REPO_ROOT, 'rules', 'common', 'coding-style.md'),
          'utf8'
        ),
      }]);
      const sourcePath = path.join(projectRoot, 'source.md');
      fs.writeFileSync(sourcePath, 'canonical managed\n', 'utf8');

      assert.throws(
        () => applyInstallPlan(createCanonicalPlan(projectRoot, sourcePath), {
          writeInstallState() {
            throw new Error('simulated canonical state failure');
          },
        }),
        /simulated canonical state failure/
      );

      assert.ok(fs.existsSync(legacy.operations[0].destinationPath));
      assert.ok(fs.existsSync(legacy.installStatePath));
    } finally {
      fs.rmSync(projectRoot, { recursive: true, force: true });
    }
  })) passed++; else failed++;

  if (test('preserves drifted and unmanaged legacy files and retains legacy state', () => {
    const projectRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'antigravity-migrate-partial-'));
    try {
      const legacy = seedLegacyState(projectRoot, [
        {
          relativePath: 'rules/common-coding-style.md',
          sourceRelativePath: 'rules/common/coding-style.md',
          recordedContent: fs.readFileSync(
            path.join(REPO_ROOT, 'rules', 'common', 'coding-style.md'),
            'utf8'
          ),
        },
        {
          relativePath: 'rules/common-patterns.md',
          sourceRelativePath: 'rules/common/patterns.md',
          recordedContent: fs.readFileSync(
            path.join(REPO_ROOT, 'rules', 'common', 'patterns.md'),
            'utf8'
          ),
        },
      ]);
      fs.writeFileSync(legacy.operations[1].destinationPath, 'customer edit\n', 'utf8');
      const unmanagedPath = path.join(legacy.targetRoot, 'customer-note.md');
      fs.writeFileSync(unmanagedPath, 'keep me\n', 'utf8');
      const sourcePath = path.join(projectRoot, 'source.md');
      fs.writeFileSync(sourcePath, 'canonical managed\n', 'utf8');

      applyInstallPlan(createCanonicalPlan(projectRoot, sourcePath));

      assert.ok(!fs.existsSync(legacy.operations[0].destinationPath));
      assert.strictEqual(fs.readFileSync(legacy.operations[1].destinationPath, 'utf8'), 'customer edit\n');
      assert.strictEqual(fs.readFileSync(unmanagedPath, 'utf8'), 'keep me\n');
      assert.ok(fs.existsSync(legacy.installStatePath));
      const remainingLegacyState = readInstallState(legacy.installStatePath);
      assert.strictEqual(remainingLegacyState.operations.length, 2);
      const report = buildDoctorReport({
        repoRoot: REPO_ROOT,
        projectRoot,
        targets: ['antigravity'],
      });
      const legacyReport = report.results.find(result => result.legacy);
      assert.ok(legacyReport.issues.some(issue => issue.code === 'legacy-antigravity-layout'));
      assert.ok(legacyReport.issues.some(issue => issue.code === 'drifted-managed-files'));
      assert.ok(legacyReport.issues.some(issue => issue.code === 'missing-managed-files'));

      const uninstall = uninstallInstalledStates({ projectRoot, targets: ['antigravity'] });
      assert.strictEqual(
        fs.readFileSync(legacy.operations[1].destinationPath, 'utf8'),
        'customer edit\n'
      );
      assert.strictEqual(fs.readFileSync(unmanagedPath, 'utf8'), 'keep me\n');
      assert.ok(fs.existsSync(legacy.installStatePath));
      assert.strictEqual(uninstall.summary.partialCount, 1);
      const dryRun = uninstallInstalledStates({
        projectRoot,
        targets: ['antigravity'],
        dryRun: true,
      });
      const legacyDryRun = dryRun.results.find(result => (
        result.installStatePath === legacy.installStatePath
      ));
      assert.deepStrictEqual(legacyDryRun.plannedRemovals, []);
      assert.ok(legacyDryRun.retainedPaths.includes(legacy.operations[1].destinationPath));
    } finally {
      fs.rmSync(projectRoot, { recursive: true, force: true });
    }
  })) passed++; else failed++;

  if (test('does not trust a forged legacy digest to delete customer content', () => {
    const projectRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'antigravity-migrate-forged-'));
    try {
      const legacy = seedLegacyState(projectRoot, [
        {
          relativePath: 'rules/common-coding-style.md',
          sourceRelativePath: 'rules/common/coding-style.md',
          recordedContent: 'customer-owned content\n',
        },
        {
          relativePath: 'customer-note.md',
          sourceRelativePath: 'rules/common/patterns.md',
          recordedContent: 'customer note\n',
        },
        {
          relativePath: 'README.md',
          sourceRelativePath: 'commands/../README.md',
          recordedContent: fs.readFileSync(path.join(REPO_ROOT, 'README.md'), 'utf8'),
        },
      ]);
      const sourcePath = path.join(projectRoot, 'source.md');
      fs.writeFileSync(sourcePath, 'canonical managed\n', 'utf8');

      const result = applyInstallPlan(createCanonicalPlan(projectRoot, sourcePath));

      assert.strictEqual(
        fs.readFileSync(legacy.operations[0].destinationPath, 'utf8'),
        'customer-owned content\n'
      );
      assert.strictEqual(
        fs.readFileSync(legacy.operations[1].destinationPath, 'utf8'),
        'customer note\n'
      );
      assert.ok(fs.existsSync(legacy.operations[2].destinationPath));
      assert.ok(fs.existsSync(legacy.installStatePath));
      assert.ok(result.warnings.some(warning => warning.includes('migration is incomplete')));
    } finally {
      fs.rmSync(projectRoot, { recursive: true, force: true });
    }
  })) passed++; else failed++;

  if (test('warns when digestless legacy files require manual migration', () => {
    const projectRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'antigravity-migrate-digestless-'));
    try {
      const legacy = seedLegacyState(projectRoot, [{
        relativePath: 'rules/common-coding-style.md',
        sourceRelativePath: 'rules/common/coding-style.md',
        recordedContent: fs.readFileSync(
          path.join(REPO_ROOT, 'rules', 'common', 'coding-style.md'),
          'utf8'
        ),
      }]);
      const legacyState = readInstallState(legacy.installStatePath);
      delete legacyState.operations[0].contentSha256;
      writeInstallState(legacy.installStatePath, legacyState);
      const sourcePath = path.join(projectRoot, 'source.md');
      fs.writeFileSync(sourcePath, 'canonical managed\n', 'utf8');

      const result = applyInstallPlan(createCanonicalPlan(projectRoot, sourcePath));

      assert.ok(fs.existsSync(legacy.operations[0].destinationPath));
      assert.ok(fs.existsSync(legacy.installStatePath));
      assert.ok(result.warnings.some(warning => (
        warning.includes('Legacy Antigravity migration is incomplete')
        && warning.includes('.agent')
      )));
    } finally {
      fs.rmSync(projectRoot, { recursive: true, force: true });
    }
  })) passed++; else failed++;

  if (test('preserves unrelated empty legacy directories after complete cleanup', () => {
    const projectRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'antigravity-migrate-empty-dir-'));
    try {
      const legacy = seedLegacyState(projectRoot, [{
        relativePath: 'rules/common-coding-style.md',
        sourceRelativePath: 'rules/common/coding-style.md',
        recordedContent: fs.readFileSync(
          path.join(REPO_ROOT, 'rules', 'common', 'coding-style.md'),
          'utf8'
        ),
      }]);
      const userDirectory = path.join(legacy.targetRoot, 'customer-empty-directory');
      fs.mkdirSync(userDirectory);
      const sourcePath = path.join(projectRoot, 'source.md');
      fs.writeFileSync(sourcePath, 'canonical managed\n', 'utf8');

      applyInstallPlan(createCanonicalPlan(projectRoot, sourcePath));

      assert.ok(fs.existsSync(userDirectory));
      assert.ok(!fs.existsSync(legacy.installStatePath));
    } finally {
      fs.rmSync(projectRoot, { recursive: true, force: true });
    }
  })) passed++; else failed++;

  if (test('list discovery and doctor report both canonical and remaining legacy states', () => {
    const homeDir = fs.mkdtempSync(path.join(os.tmpdir(), 'antigravity-home-'));
    const projectRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'antigravity-discover-'));
    try {
      const canonicalRoot = path.join(projectRoot, '.agents');
      const canonicalStatePath = path.join(canonicalRoot, 'ecc-install-state.json');
      writeInstallState(
        canonicalStatePath,
        createAntigravityState(canonicalRoot, canonicalStatePath)
      );
      const legacy = seedLegacyState(projectRoot);

      const records = discoverInstalledStates({
        homeDir,
        projectRoot,
        targets: ['antigravity'],
      }).filter(record => record.exists);
      assert.deepStrictEqual(
        records.map(record => record.installStatePath).sort(),
        [canonicalStatePath, legacy.installStatePath].sort()
      );

      const report = buildDoctorReport({
        repoRoot: REPO_ROOT,
        homeDir,
        projectRoot,
        targets: ['antigravity'],
      });
      assert.strictEqual(report.results.length, 2);
      assert.strictEqual(report.summary.checkedCount, 2);
      const legacyReport = report.results.find(result => result.legacy);
      assert.ok(legacyReport);
      assert.ok(legacyReport.issues.some(issue => (
        issue.severity === 'warning'
        && issue.code === 'legacy-antigravity-layout'
      )));

      fs.rmSync(canonicalStatePath);
      const legacyOnlyRecords = discoverInstalledStates({
        homeDir,
        projectRoot,
        targets: ['antigravity'],
      }).filter(record => record.exists);
      assert.strictEqual(legacyOnlyRecords.length, 1);
      assert.strictEqual(legacyOnlyRecords[0].installStatePath, legacy.installStatePath);
      assert.strictEqual(legacyOnlyRecords[0].legacy, true);
    } finally {
      fs.rmSync(homeDir, { recursive: true, force: true });
      fs.rmSync(projectRoot, { recursive: true, force: true });
    }
  })) passed++; else failed++;

  if (test('uninstall discovers and removes both canonical and legacy states', () => {
    const homeDir = fs.mkdtempSync(path.join(os.tmpdir(), 'antigravity-home-'));
    const projectRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'antigravity-uninstall-'));
    try {
      const canonicalRoot = path.join(projectRoot, '.agents');
      const canonicalStatePath = path.join(canonicalRoot, 'ecc-install-state.json');
      writeInstallState(
        canonicalStatePath,
        createAntigravityState(canonicalRoot, canonicalStatePath)
      );
      const legacy = seedLegacyState(projectRoot);

      const dryRun = uninstallInstalledStates({
        homeDir,
        projectRoot,
        targets: ['antigravity'],
        dryRun: true,
      });
      assert.strictEqual(dryRun.results.length, 2);
      assert.ok(dryRun.results.some(result => result.installStatePath === canonicalStatePath));
      assert.ok(dryRun.results.some(result => result.installStatePath === legacy.installStatePath));

      const result = uninstallInstalledStates({
        homeDir,
        projectRoot,
        targets: ['antigravity'],
      });
      assert.strictEqual(result.summary.uninstalledCount, 2);
      assert.ok(!fs.existsSync(canonicalStatePath));
      assert.ok(!fs.existsSync(legacy.installStatePath));
    } finally {
      fs.rmSync(homeDir, { recursive: true, force: true });
      fs.rmSync(projectRoot, { recursive: true, force: true });
    }
  })) passed++; else failed++;

  if (test('does not repair residual legacy state over preserved customer edits', () => {
    const homeDir = fs.mkdtempSync(path.join(os.tmpdir(), 'antigravity-home-'));
    const projectRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'antigravity-repair-'));
    try {
      const canonicalRoot = path.join(projectRoot, '.agents');
      const canonicalStatePath = path.join(canonicalRoot, 'ecc-install-state.json');
      writeInstallState(
        canonicalStatePath,
        createAntigravityState(canonicalRoot, canonicalStatePath)
      );
      const legacy = seedLegacyState(projectRoot, [{
        relativePath: 'rules/coding-style.md',
        sourceRelativePath: 'rules/common/coding-style.md',
        recordedContent: fs.readFileSync(
          path.join(REPO_ROOT, 'rules', 'common', 'coding-style.md'),
          'utf8'
        ),
      }]);
      fs.writeFileSync(legacy.operations[0].destinationPath, 'customer edit\n', 'utf8');

      const result = repairInstalledStates({
        repoRoot: REPO_ROOT,
        homeDir,
        projectRoot,
        targets: ['antigravity'],
      });

      assert.strictEqual(
        fs.readFileSync(legacy.operations[0].destinationPath, 'utf8'),
        'customer edit\n'
      );
      assert.ok(!result.results.some(entry => entry.installStatePath === legacy.installStatePath));
    } finally {
      fs.rmSync(homeDir, { recursive: true, force: true });
      fs.rmSync(projectRoot, { recursive: true, force: true });
    }
  })) passed++; else failed++;

  if (test('does not discover mismatched or symlinked legacy state', () => {
    const homeDir = fs.mkdtempSync(path.join(os.tmpdir(), 'antigravity-home-'));
    const mismatchedProject = fs.mkdtempSync(path.join(os.tmpdir(), 'antigravity-mismatch-'));
    const symlinkProject = fs.mkdtempSync(path.join(os.tmpdir(), 'antigravity-symlink-'));
    const externalRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'antigravity-external-'));
    try {
      const mismatchedRoot = path.join(mismatchedProject, '.agent');
      const mismatchedStatePath = path.join(mismatchedRoot, 'ecc-install-state.json');
      writeInstallState(mismatchedStatePath, createInstallState({
        adapter: { id: 'cursor-project', target: 'cursor', kind: 'project' },
        targetRoot: mismatchedRoot,
        installStatePath: mismatchedStatePath,
        request: {
          profile: null,
          modules: [],
          includeComponents: [],
          excludeComponents: [],
          legacyLanguages: [],
          legacyMode: true,
        },
        resolution: { selectedModules: [], skippedModules: [] },
        source: {
          repoVersion: PACKAGE_VERSION,
          repoCommit: 'test-commit',
          manifestVersion: MANIFEST_VERSION,
        },
        operations: [],
      }));

      const mismatchedRecords = discoverInstalledStates({
        homeDir,
        projectRoot: mismatchedProject,
        targets: ['antigravity'],
      }).filter(record => record.exists);
      assert.strictEqual(mismatchedRecords.length, 0);

      if (process.platform !== 'win32') {
        const symlinkStatePath = path.join(externalRoot, 'ecc-install-state.json');
        const linkedRoot = path.join(symlinkProject, '.agent');
        fs.symlinkSync(externalRoot, linkedRoot, 'dir');
        writeInstallState(
          symlinkStatePath,
          createAntigravityState(linkedRoot, path.join(linkedRoot, 'ecc-install-state.json'))
        );

        const symlinkRecords = discoverInstalledStates({
          homeDir,
          projectRoot: symlinkProject,
          targets: ['antigravity'],
        }).filter(record => record.exists);
        assert.strictEqual(symlinkRecords.length, 0);
      }
    } finally {
      fs.rmSync(homeDir, { recursive: true, force: true });
      fs.rmSync(mismatchedProject, { recursive: true, force: true });
      fs.rmSync(symlinkProject, { recursive: true, force: true });
      fs.rmSync(externalRoot, { recursive: true, force: true });
    }
  })) passed++; else failed++;

  if (test('doctor and repair compare Antigravity agents using transformed content', () => {
    const homeDir = fs.mkdtempSync(path.join(os.tmpdir(), 'antigravity-home-'));
    const projectRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'antigravity-transform-health-'));
    try {
      const sourcePath = path.join(REPO_ROOT, 'agents', 'architect.md');
      const targetRoot = path.join(projectRoot, '.agents');
      const installStatePath = path.join(targetRoot, 'ecc-install-state.json');
      const operation = {
        kind: 'copy-file',
        moduleId: 'agents-core',
        sourcePath,
        sourceRelativePath: 'agents/architect.md',
        destinationPath: path.join(targetRoot, 'agents', 'architect.md'),
        strategy: 'copy-file',
        ownership: 'managed',
        scaffoldOnly: false,
        contentTransform: 'antigravity-agent-frontmatter',
      };
      const plan = {
        mode: 'legacy',
        target: 'antigravity',
        adapter: { id: 'antigravity-project', target: 'antigravity', kind: 'project' },
        targetRoot,
        installRoot: targetRoot,
        installStatePath,
        operations: [operation],
        warnings: [],
        statePreview: createAntigravityState(targetRoot, installStatePath, [operation]),
      };
      applyInstallPlan(plan);
      const installedContent = fs.readFileSync(operation.destinationPath, 'utf8');
      assert.notStrictEqual(installedContent, fs.readFileSync(sourcePath, 'utf8'));

      const report = buildDoctorReport({
        repoRoot: REPO_ROOT,
        homeDir,
        projectRoot,
        targets: ['antigravity'],
      });
      assert.ok(!report.results[0].issues.some(issue => issue.code === 'drifted-managed-files'));

      fs.writeFileSync(operation.destinationPath, 'drifted\n', 'utf8');
      const repair = repairInstalledStates({
        repoRoot: REPO_ROOT,
        homeDir,
        projectRoot,
        targets: ['antigravity'],
      });
      assert.strictEqual(repair.results[0].status, 'repaired');
      assert.strictEqual(fs.readFileSync(operation.destinationPath, 'utf8'), installedContent);
    } finally {
      fs.rmSync(homeDir, { recursive: true, force: true });
      fs.rmSync(projectRoot, { recursive: true, force: true });
    }
  })) passed++; else failed++;

  console.log(`\nResults: Passed: ${passed}, Failed: ${failed}`);
  process.exit(failed > 0 ? 1 : 0);
}

runTests();
