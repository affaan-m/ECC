'use strict';

const assert = require('assert');
const crypto = require('crypto');
const fs = require('fs');
const os = require('os');
const path = require('path');

const { applyInstallPlan } = require('../../scripts/lib/install/apply');
const { createManifestInstallPlan } = require('../../scripts/lib/install-executor');
const {
  buildDoctorReport,
  discoverInstalledStates,
  repairInstalledStates,
  uninstallInstalledStates,
} = require('../../scripts/lib/install-lifecycle');
const { createInstallState, writeInstallState } = require('../../scripts/lib/install-state');
const {
  cleanupLegacyOpencodeInstall,
  getLegacyOpencodeLocation,
  inspectLegacyOpencodeState,
  removeVerifiedLegacyFile,
} = require('../../scripts/lib/install/opencode-legacy-migration');

const REPO_ROOT = path.join(__dirname, '..', '..');
const SOURCE_RELATIVE_PATH = path.join('skills', 'skill-comply', 'SKILL.md');

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

function digest(content) {
  return crypto.createHash('sha256').update(content).digest('hex');
}

function seedLegacyInstall(homeDir, options = {}) {
  const targetRoot = path.join(homeDir, '.opencode');
  const installStatePath = path.join(targetRoot, 'ecc-install-state.json');
  const destinationPath = path.join(targetRoot, SOURCE_RELATIVE_PATH);
  const sourceContent = fs.readFileSync(path.join(REPO_ROOT, SOURCE_RELATIVE_PATH));
  const installedContent = options.modified ? Buffer.from('user-modified\n') : sourceContent;
  fs.mkdirSync(path.dirname(destinationPath), { recursive: true });
  fs.writeFileSync(destinationPath, installedContent);

  const operation = {
    kind: 'copy-file',
    moduleId: 'workflow-quality',
    sourceRelativePath: SOURCE_RELATIVE_PATH,
    destinationPath,
    strategy: 'preserve-relative-path',
    ownership: 'managed',
    scaffoldOnly: false,
    contentSha256: digest(sourceContent),
  };
  const operations = [operation];
  if (options.includeJsonOperation) {
    const configPath = path.join(targetRoot, 'opencode.json');
    fs.writeFileSync(configPath, JSON.stringify({ plugin: ['ecc'] }, null, 2) + '\n');
    operations.push({
      kind: 'merge-json',
      moduleId: 'opencode-plugin',
      sourceRelativePath: '.opencode/opencode.json',
      destinationPath: configPath,
      strategy: 'merge-json',
      ownership: 'managed',
      scaffoldOnly: false,
      mergePayload: { plugin: ['ecc'] },
      previousExists: false,
      previousContent: null,
    });
  }
  const state = createInstallState({
    adapter: { id: 'opencode-home', target: 'opencode', kind: 'home' },
    targetRoot,
    installStatePath,
    request: {
      profile: null,
      modules: ['workflow-quality'],
      includeComponents: [],
      excludeComponents: [],
      legacyLanguages: [],
      legacyMode: false,
    },
    resolution: { selectedModules: ['workflow-quality'], skippedModules: [] },
    source: {
      repoVersion: require('../../package.json').version,
      repoCommit: 'legacy-opencode-test',
      manifestVersion: require('../../manifests/install-modules.json').version,
    },
    operations,
  });
  writeInstallState(installStatePath, state);
  return { targetRoot, installStatePath, destinationPath };
}

function canonicalPlan(homeDir, env) {
  return createManifestInstallPlan({
    sourceRoot: REPO_ROOT,
    target: 'opencode',
    moduleIds: ['workflow-quality'],
    projectRoot: homeDir,
    homeDir,
    ...(env ? { env } : {}),
    exemptValidationCodes: ['opencode-plugin-not-built'],
  });
}

console.log('\n=== Testing OpenCode legacy migration ===\n');

test('legacy inspection distinguishes absent, invalid, and unreadable state', () => {
  const homeDir = fs.mkdtempSync(path.join(os.tmpdir(), 'opencode-legacy-inspect-'));
  try {
    const location = getLegacyOpencodeLocation(homeDir);
    assert.strictEqual(inspectLegacyOpencodeState(null).status, 'absent');
    assert.strictEqual(inspectLegacyOpencodeState(location).status, 'absent');

    fs.mkdirSync(location.targetRoot, { recursive: true });
    fs.mkdirSync(location.installStatePath);
    assert.strictEqual(inspectLegacyOpencodeState(location).status, 'invalid');
    fs.rmSync(location.installStatePath, { recursive: true, force: true });

    fs.writeFileSync(location.installStatePath, '{not-json', 'utf8');
    const unreadable = inspectLegacyOpencodeState(location);
    assert.strictEqual(unreadable.status, 'unreadable');
    assert.ok(unreadable.error.includes(location.installStatePath));

    assert.deepStrictEqual(cleanupLegacyOpencodeInstall(null), {
      detected: false,
      complete: false,
      removedPaths: [],
      retainedPaths: [],
      warnings: [],
    });
  } finally {
    fs.rmSync(homeDir, { recursive: true, force: true });
  }
});

test('discovery and doctor surface the legacy managed root', () => {
  const homeDir = fs.mkdtempSync(path.join(os.tmpdir(), 'opencode-legacy-discover-'));
  try {
    const legacy = seedLegacyInstall(homeDir);
    const records = discoverInstalledStates({ homeDir, projectRoot: homeDir, targets: ['opencode'] });
    assert.strictEqual(records.length, 2);
    assert.strictEqual(records[0].exists, false);
    assert.strictEqual(records[1].installStatePath, legacy.installStatePath);
    assert.strictEqual(records[1].legacyLayout, 'opencode');

    const doctor = buildDoctorReport({
      repoRoot: REPO_ROOT,
      homeDir,
      projectRoot: homeDir,
      targets: ['opencode'],
    });
    assert.ok(doctor.results.some(result => (
      result.issues.some(issue => issue.code === 'legacy-opencode-layout')
    )));
  } finally {
    fs.rmSync(homeDir, { recursive: true, force: true });
  }
});

test('uninstall removes unchanged legacy-managed files and preserves user content', () => {
  const homeDir = fs.mkdtempSync(path.join(os.tmpdir(), 'opencode-legacy-uninstall-'));
  try {
    const legacy = seedLegacyInstall(homeDir);
    const sentinelPath = path.join(legacy.targetRoot, 'user.txt');
    fs.writeFileSync(sentinelPath, 'keep\n');
    const result = uninstallInstalledStates({ homeDir, projectRoot: homeDir, targets: ['opencode'] });
    assert.strictEqual(result.summary.errorCount, 0, JSON.stringify(result));
    assert.ok(!fs.existsSync(legacy.destinationPath));
    assert.ok(!fs.existsSync(legacy.installStatePath));
    assert.strictEqual(fs.readFileSync(sentinelPath, 'utf8'), 'keep\n');
  } finally {
    fs.rmSync(homeDir, { recursive: true, force: true });
  }
});

test('a canonical install migrates unchanged legacy ownership', () => {
  const homeDir = fs.mkdtempSync(path.join(os.tmpdir(), 'opencode-legacy-apply-'));
  try {
    const legacy = seedLegacyInstall(homeDir);
    const result = applyInstallPlan(canonicalPlan(homeDir));
    assert.ok(result.applied);
    assert.ok(fs.existsSync(path.join(homeDir, '.config', 'opencode', 'ecc-install-state.json')));
    assert.ok(!fs.existsSync(legacy.installStatePath));
    assert.ok(!fs.existsSync(legacy.destinationPath));
  } finally {
    fs.rmSync(homeDir, { recursive: true, force: true });
  }
});

test('a canonical install migrates legacy ownership when its config root is overridden', () => {
  const homeDir = fs.mkdtempSync(path.join(os.tmpdir(), 'opencode-legacy-custom-root-'));
  try {
    const legacy = seedLegacyInstall(homeDir);
    const configRoot = path.join(homeDir, 'custom', 'opencode');
    const result = applyInstallPlan(canonicalPlan(homeDir, {
      OPENCODE_CONFIG_DIR: configRoot,
    }));
    assert.ok(result.applied);
    assert.ok(fs.existsSync(path.join(configRoot, 'ecc-install-state.json')));
    assert.ok(!fs.existsSync(legacy.installStatePath));
    assert.ok(!fs.existsSync(legacy.destinationPath));
  } finally {
    fs.rmSync(homeDir, { recursive: true, force: true });
  }
});

test('legacy non-file operations do not block canonical cleanup or repair', () => {
  const applyHome = fs.mkdtempSync(path.join(os.tmpdir(), 'opencode-legacy-json-apply-'));
  const repairHome = fs.mkdtempSync(path.join(os.tmpdir(), 'opencode-legacy-json-repair-'));
  try {
    const legacyApply = seedLegacyInstall(applyHome, { includeJsonOperation: true });
    applyInstallPlan(canonicalPlan(applyHome));
    assert.ok(!fs.existsSync(legacyApply.installStatePath));
    assert.ok(fs.existsSync(path.join(legacyApply.targetRoot, 'opencode.json')));

    const legacyRepair = seedLegacyInstall(repairHome, { includeJsonOperation: true });
    const result = repairInstalledStates({
      repoRoot: REPO_ROOT,
      homeDir: repairHome,
      projectRoot: repairHome,
      targets: ['opencode'],
    });
    const canonicalStatePath = path.join(
      repairHome,
      '.config',
      'opencode',
      'ecc-install-state.json'
    );
    assert.strictEqual(result.summary.errorCount, 0, JSON.stringify(result));
    assert.ok(fs.existsSync(canonicalStatePath));
    assert.ok(!fs.existsSync(legacyRepair.installStatePath));
    assert.ok(fs.existsSync(path.join(legacyRepair.targetRoot, 'opencode.json')));
  } finally {
    fs.rmSync(applyHome, { recursive: true, force: true });
    fs.rmSync(repairHome, { recursive: true, force: true });
  }
});

test('repair migrates a legacy install while preserving modified legacy files', () => {
  const homeDir = fs.mkdtempSync(path.join(os.tmpdir(), 'opencode-legacy-repair-'));
  try {
    const legacy = seedLegacyInstall(homeDir, { modified: true });
    const result = repairInstalledStates({
      repoRoot: REPO_ROOT,
      homeDir,
      projectRoot: homeDir,
      targets: ['opencode'],
    });
    assert.strictEqual(result.summary.errorCount, 0, JSON.stringify(result));
    assert.ok(fs.existsSync(path.join(homeDir, '.config', 'opencode', 'ecc-install-state.json')));
    assert.strictEqual(fs.readFileSync(legacy.destinationPath, 'utf8'), 'user-modified\n');
    assert.ok(fs.existsSync(legacy.installStatePath));
  } finally {
    fs.rmSync(homeDir, { recursive: true, force: true });
  }
});

test('migration never follows a legacy managed-file symlink', () => {
  const homeDir = fs.mkdtempSync(path.join(os.tmpdir(), 'opencode-legacy-symlink-'));
  try {
    const legacy = seedLegacyInstall(homeDir);
    const victimPath = path.join(homeDir, 'victim.txt');
    fs.writeFileSync(victimPath, 'do-not-delete\n');
    fs.rmSync(legacy.destinationPath);
    try {
      fs.symlinkSync(victimPath, legacy.destinationPath);
    } catch (error) {
      if (process.platform === 'win32' && error.code === 'EPERM') {
        console.log('    (symlink unsupported on this platform; skipping)');
        return;
      }
      throw error;
    }

    const result = applyInstallPlan(canonicalPlan(homeDir));
    assert.ok(result.warnings.some(warning => warning.includes('Legacy OpenCode migration')));
    assert.strictEqual(fs.readFileSync(victimPath, 'utf8'), 'do-not-delete\n');
    assert.ok(fs.lstatSync(legacy.destinationPath).isSymbolicLink());
    assert.ok(fs.existsSync(legacy.installStatePath));
  } finally {
    fs.rmSync(homeDir, { recursive: true, force: true });
  }
});

test('legacy cleanup never overwrites a file created during quarantine recovery', () => {
  const homeDir = fs.mkdtempSync(path.join(os.tmpdir(), 'opencode-legacy-no-clobber-'));
  const targetRoot = path.join(homeDir, '.opencode');
  const destinationPath = path.join(targetRoot, 'managed.md');
  let quarantinePath = null;
  let effectiveSafePath = destinationPath;
  let userDescriptor = null;
  const openDescriptors = [];
  try {
    fs.mkdirSync(targetRoot, { recursive: true });
    fs.writeFileSync(destinationPath, 'managed-old\n');
    const originalDescriptor = fs.openSync(destinationPath, 'r');
    openDescriptors.push(originalDescriptor);
    const originalStat = fs.fstatSync(originalDescriptor, { bigint: true });
    let injected = false;
    const fileSystem = new Proxy(fs, {
      get(target, property) {
        if (property === 'renameSync') {
          return (sourcePath, targetPath) => {
            fs.renameSync(sourcePath, targetPath);
            effectiveSafePath = sourcePath;
            quarantinePath = targetPath;
          };
        }
        if (property === 'lstatSync') {
          return (filePath, options) => {
            if (!injected && quarantinePath && filePath === quarantinePath) {
              injected = true;
              const stat = fs.fstatSync(originalDescriptor, options);
              userDescriptor = fs.openSync(effectiveSafePath, 'wx+', 0o600);
              openDescriptors.push(userDescriptor);
              fs.writeFileSync(userDescriptor, 'user-new\n');
              return new Proxy(stat, {
                get(statTarget, statProperty) {
                  if (statProperty === 'ino') return statTarget.ino + 1n;
                  const value = Reflect.get(statTarget, statProperty, statTarget);
                  return typeof value === 'function' ? value.bind(statTarget) : value;
                },
              });
            }
            return fs.lstatSync(filePath, options);
          };
        }
        const value = Reflect.get(target, property, target);
        return typeof value === 'function' ? value.bind(target) : value;
      },
    });

    assert.throws(
      () => removeVerifiedLegacyFile(
        { destinationPath, stat: originalStat },
        { targetRoot },
        fileSystem
      ),
      error => {
        assert.strictEqual(error.code, 'EEXIST');
        assert.strictEqual(error.retainedPath, quarantinePath);
        return true;
      }
    );
    const destinationStat = fs.lstatSync(destinationPath, { bigint: true });
    const userStat = fs.fstatSync(userDescriptor, { bigint: true });
    const retainedStat = fs.lstatSync(quarantinePath, { bigint: true });
    const managedStat = fs.fstatSync(originalDescriptor, { bigint: true });
    assert.strictEqual(destinationStat.dev, userStat.dev);
    assert.strictEqual(destinationStat.ino, userStat.ino);
    assert.strictEqual(retainedStat.dev, managedStat.dev);
    assert.strictEqual(retainedStat.ino, managedStat.ino);
    const userContent = Buffer.alloc(Buffer.byteLength('user-new\n'));
    const managedContent = Buffer.alloc(Buffer.byteLength('managed-old\n'));
    fs.readSync(userDescriptor, userContent, 0, userContent.length, 0);
    fs.readSync(originalDescriptor, managedContent, 0, managedContent.length, 0);
    assert.strictEqual(userContent.toString('utf8'), 'user-new\n');
    assert.strictEqual(managedContent.toString('utf8'), 'managed-old\n');
  } finally {
    for (const descriptor of openDescriptors) {
      try {
        fs.closeSync(descriptor);
      } catch (_error) {
        // Best-effort fixture cleanup.
      }
    }
    fs.rmSync(homeDir, { recursive: true, force: true });
    if (quarantinePath) {
      fs.rmSync(path.dirname(quarantinePath), { recursive: true, force: true });
    }
  }
});

console.log(`\nResults: Passed: ${passed}, Failed: ${failed}`);
process.exit(failed > 0 ? 1 : 0);
