'use strict';

const assert = require('assert');
const fs = require('fs');
const os = require('os');
const path = require('path');

const { applyInstallPlan } = require('../../scripts/lib/install/apply');
const { readInstallState } = require('../../scripts/lib/install-state');
const { uninstallInstalledStates } = require('../../scripts/lib/install-lifecycle');

let passed = 0;
let failed = 0;

function makePlan(root, moduleId, fileName) {
  const targetRoot = path.join(root, '.cursor');
  const installStatePath = path.join(targetRoot, 'ecc-install-state.json');
  const sourcePath = path.join(root, 'source', moduleId, fileName);
  const destinationPath = path.join(targetRoot, 'skills', moduleId, fileName);
  fs.mkdirSync(path.dirname(sourcePath), { recursive: true });
  fs.writeFileSync(sourcePath, `${moduleId}\n`);
  const operation = {
    kind: 'copy-file',
    moduleId,
    sourcePath,
    sourceRelativePath: path.join('skills', moduleId, fileName),
    destinationPath,
    strategy: 'preserve-relative-path',
    ownership: 'managed',
    scaffoldOnly: false,
  };
  return {
    mode: 'manifest',
    target: 'cursor',
    adapter: { id: 'cursor-project', target: 'cursor', kind: 'project' },
    targetRoot,
    installRoot: targetRoot,
    installStatePath,
    operations: [operation],
    statePreview: {
      schemaVersion: 'ecc.install.v1',
      installedAt: new Date().toISOString(),
      target: {
        id: 'cursor-project',
        target: 'cursor',
        kind: 'project',
        root: targetRoot,
        installStatePath,
      },
      request: {
        profile: null,
        modules: [moduleId],
        includeComponents: [],
        excludeComponents: [],
        legacyLanguages: [],
        legacyMode: false,
      },
      resolution: { selectedModules: [moduleId], skippedModules: [] },
      source: { manifestVersion: 1 },
      operations: [operation],
    },
    warnings: [],
  };
}

const root = fs.mkdtempSync(path.join(os.tmpdir(), 'ecc-selective-reinstall-'));
try {
  const first = makePlan(root, 'first-module', 'FIRST.md');
  const second = makePlan(root, 'second-module', 'SECOND.md');
  applyInstallPlan(first);
  fs.writeFileSync(first.operations[0].destinationPath, 'user-modified\n');
  applyInstallPlan(second);

  const state = readInstallState(first.installStatePath);
  assert.deepStrictEqual(
    new Set(state.operations.map(operation => operation.moduleId)),
    new Set(['first-module', 'second-module']),
    'a later selective install must preserve earlier managed ownership'
  );

  const result = uninstallInstalledStates({ projectRoot: root, targets: ['cursor'] });
  assert.strictEqual(result.summary.errorCount, 0);
  assert.strictEqual(
    fs.readFileSync(first.operations[0].destinationPath, 'utf8'),
    'user-modified\n',
    'selective reinstall must not claim modified retained content'
  );
  assert.ok(!fs.existsSync(second.operations[0].destinationPath));
  console.log('  ✓ selective reinstall preserves cumulative ownership without claiming user changes');
  passed += 1;
} catch (error) {
  console.log(`  ✗ ${error.message}`);
  failed += 1;
} finally {
  fs.rmSync(root, { recursive: true, force: true });
}

const partialRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'ecc-partial-non-claude-'));
try {
  const copied = makePlan(partialRoot, 'copied-module', 'COPIED.md');
  const missing = makePlan(partialRoot, 'missing-module', 'MISSING.md');
  fs.rmSync(missing.operations[0].sourcePath);
  const partialPlan = {
    ...copied,
    operations: [copied.operations[0], missing.operations[0]],
    statePreview: {
      ...copied.statePreview,
      operations: [copied.operations[0], missing.operations[0]],
    },
  };

  assert.throws(() => applyInstallPlan(partialPlan), /ENOENT/);
  assert.ok(fs.existsSync(copied.operations[0].destinationPath));
  const checkpoint = readInstallState(copied.installStatePath);
  assert.ok(checkpoint.operations.some(operation => (
    operation.destinationPath === copied.operations[0].destinationPath
  )));

  const result = uninstallInstalledStates({ projectRoot: partialRoot, targets: ['cursor'] });
  assert.strictEqual(result.summary.errorCount, 0);
  assert.ok(!fs.existsSync(copied.operations[0].destinationPath));
  console.log('  ✓ failed non-Claude install checkpoints managed files for uninstall');
  passed += 1;
} catch (error) {
  console.log(`  ✗ ${error.message}`);
  failed += 1;
} finally {
  fs.rmSync(partialRoot, { recursive: true, force: true });
}

console.log(`\nResults: Passed: ${passed}, Failed: ${failed}`);
process.exit(failed > 0 ? 1 : 0);
