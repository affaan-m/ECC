'use strict';

const assert = require('assert');
const fs = require('fs');
const os = require('os');
const path = require('path');
const { execFileSync } = require('child_process');
const { createManifestInstallPlan } = require('../../scripts/lib/install/plan');
const { applyInstallPlan, previewInstallPlan } = require('../../scripts/lib/install/apply');
const { listInstallTargetAdapters } = require('../../scripts/lib/install-targets/registry');
const { uninstallInstalledStates } = require('../../scripts/lib/install-lifecycle');

let passed = 0;
let failed = 0;
function test(name, fn) {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'ecc-ownership-'));
  try {
    const projectRoot = path.join(root, 'project');
    const homeDir = path.join(root, 'home');
    fs.mkdirSync(projectRoot);
    fs.mkdirSync(homeDir);
    fn({ projectRoot, homeDir, env: {} });
    passed++;
    console.log(`  PASS ${name}`);
  } catch (error) {
    failed++;
    console.error(`  FAIL ${name}: ${error.stack}`);
  } finally {
    fs.rmSync(root, { recursive: true, force: true });
  }
}

function readState(plan) {
  return JSON.parse(fs.readFileSync(plan.installStatePath, 'utf8'));
}

for (const adapter of listInstallTargetAdapters()) {
  test(`${adapter.target}: preserve user files through preview, install, reinstall and uninstall`, context => {
    const nativeTarget = ['codex', 'gemini', 'opencode'].includes(adapter.target);
    const resolved = createManifestInstallPlan({
      ...context, target: adapter.target,
      moduleIds: [nativeTarget ? 'platform-configs' : 'rules-core'],
      // This test exercises ownership of source files, not plugin compilation.
      exemptValidationCodes: ['opencode-plugin-not-built'],
    });
    const operation = resolved.operations.find(item => item.kind === 'copy-file');
    assert.ok(operation, 'target must produce a real copy operation');
    const plan = {
      ...resolved, operations: [operation],
      statePreview: { ...resolved.statePreview, operations: [operation] },
    };
    const destination = operation.destinationPath;
    fs.mkdirSync(path.dirname(destination), { recursive: true });
    fs.writeFileSync(destination, 'User-authored content\n');
    const preview = previewInstallPlan(plan);
    assert.ok(preview.skippedOperations.some(item => item.destinationPath === destination));
    assert.ok(!preview.statePreview.operations.some(item => item.destinationPath === destination));
    assert.ok(!fs.existsSync(plan.installStatePath), 'preview must not create state');
    for (let attempt = 0; attempt < 2; attempt++) {
      const installed = applyInstallPlan(plan);
      assert.strictEqual(fs.readFileSync(destination, 'utf8'), 'User-authored content\n');
      assert.ok(installed.warnings.some(warning => warning.includes('Skipped user-owned file')));
      assert.ok(!readState(plan).operations.some(item => item.destinationPath === destination));
    }
    const result = uninstallInstalledStates({ ...context, targets: [adapter.target] });
    assert.strictEqual(result.summary.errorCount, 0);
    assert.strictEqual(fs.readFileSync(destination, 'utf8'), 'User-authored content\n');
    assert.ok(!fs.existsSync(plan.installStatePath));
  });
}

test('Antigravity transforms preserve a conflicting agent and still update managed files', context => {
  const plan = createManifestInstallPlan({ ...context, target: 'antigravity', moduleIds: ['agents-core'] });
  const userOperation = plan.operations.find(item => (
    item.sourceRelativePath.replace(/\\/g, '/') === 'agents/architect.md'
  ));
  assert.ok(userOperation, 'agent plan must include the architect source on every platform');
  fs.mkdirSync(path.dirname(userOperation.destinationPath), { recursive: true });
  fs.writeFileSync(userOperation.destinationPath, 'My architect\n');
  applyInstallPlan(plan);
  const managed = plan.operations.find(item => item.destinationPath !== userOperation.destinationPath);
  assert.ok(managed, 'agent plan must also include a separately managed file');
  const original = fs.readFileSync(managed.destinationPath, 'utf8');
  fs.writeFileSync(managed.destinationPath, 'old managed version\n');
  applyInstallPlan(plan);
  assert.strictEqual(fs.readFileSync(managed.destinationPath, 'utf8'), original);
  assert.strictEqual(fs.readFileSync(userOperation.destinationPath, 'utf8'), 'My architect\n');
  assert.ok(!readState(plan).operations.some(item => item.destinationPath === userOperation.destinationPath));
});

for (const field of ['id', 'root', 'installStatePath']) {
  test(`rejects previous state with mismatched target ${field}`, context => {
    const plan = createManifestInstallPlan({ ...context, target: 'antigravity', moduleIds: ['rules-core'] });
    applyInstallPlan(plan);
    const operation = plan.operations[0];
    const state = readState(plan);
    const mismatched = { ...state, target: { ...state.target, [field]: `${state.target[field]}-other` } };
    fs.writeFileSync(plan.installStatePath, JSON.stringify(mismatched));
    fs.writeFileSync(operation.destinationPath, 'User file\n');
    assert.throws(() => applyInstallPlan(plan), /install-state target does not match/);
    assert.strictEqual(fs.readFileSync(operation.destinationPath, 'utf8'), 'User file\n');
    assert.deepStrictEqual(readState(plan), mismatched);
  });
}

test('preserves multiple user files created at the write boundary without checkpoint ownership', context => {
  const plan = createManifestInstallPlan({ ...context, target: 'antigravity', moduleIds: ['rules-core'] });
  const collisions = plan.operations.slice(0, 2).map(operation => operation.destinationPath);
  assert.throws(() => applyInstallPlan(plan, {
    beforeOperationWrite({ operation }) {
      if (operation.destinationPath === collisions[0]) {
        for (const collision of collisions) {
          fs.mkdirSync(path.dirname(collision), { recursive: true });
          fs.writeFileSync(collision, 'Concurrent user file\n');
        }
      }
    },
  }), /user-owned file appeared/);
  for (const collision of collisions) {
    assert.strictEqual(fs.readFileSync(collision, 'utf8'), 'Concurrent user file\n');
    assert.ok(!readState(plan).operations.some(item => item.destinationPath === collision));
  }
  uninstallInstalledStates({ ...context, targets: ['antigravity'] });
  for (const collision of collisions) {
    assert.strictEqual(fs.readFileSync(collision, 'utf8'), 'Concurrent user file\n');
  }
});

test('failed reinstall preserves prior hashes for modified managed files it never wrote', context => {
  const plan = createManifestInstallPlan({ ...context, target: 'antigravity', moduleIds: ['rules-core'] });
  applyInstallPlan(plan);
  const modified = plan.operations[1].destinationPath;
  const prior = readState(plan).operations.find(operation => operation.destinationPath === modified);
  fs.writeFileSync(modified, 'My modified managed file\n');
  assert.throws(() => applyInstallPlan(plan, {
    beforeOperationWrite() { throw new Error('injected early failure'); },
  }), /injected early failure/);
  assert.strictEqual(readState(plan).operations.find(operation => operation.destinationPath === modified).contentSha256,
    prior.contentSha256, 'unattempted managed files must keep their prior digest');
  uninstallInstalledStates({ ...context, targets: ['antigravity'] });
  assert.strictEqual(fs.readFileSync(modified, 'utf8'), 'My modified managed file\n');
});

test('partial install checkpoints never claim skipped user files', context => {
  const plan = createManifestInstallPlan({ ...context, target: 'antigravity', moduleIds: ['rules-core'] });
  const userOperation = plan.operations[0];
  fs.mkdirSync(path.dirname(userOperation.destinationPath), { recursive: true });
  fs.writeFileSync(userOperation.destinationPath, 'Keep this file\n');
  assert.throws(() => applyInstallPlan(plan, {
    beforeOperationWrite() { throw new Error('injected write failure'); },
  }), /injected write failure/);
  assert.ok(!readState(plan).operations.some(item => item.destinationPath === userOperation.destinationPath));
  uninstallInstalledStates({ ...context, targets: ['antigravity'] });
  assert.strictEqual(fs.readFileSync(userOperation.destinationPath, 'utf8'), 'Keep this file\n');
});

test('global CLI dry-run preserves installed files, state and canonical database', context => {
  const plan = createManifestInstallPlan({ ...context, target: 'cursor', moduleIds: ['rules-core'] });
  applyInstallPlan(plan);
  const stateBefore = fs.readFileSync(plan.installStatePath);
  const operation = plan.operations[0];
  const fileBefore = fs.readFileSync(operation.destinationPath);
  const env = {
    ...process.env, HOME: context.homeDir, USERPROFILE: context.homeDir,
    CODEX_HOME: path.join(context.homeDir, '.codex'),
    XDG_CONFIG_HOME: path.join(context.homeDir, '.config'),
    ECC_DRY_RUN: '0',
  };
  const cli = path.join(__dirname, '../../scripts/ecc.js');
  for (const args of [['--dry-run', 'uninstall'], ['uninstall', '--dry-run']]) {
    const stdout = execFileSync(process.execPath, [cli, ...args, '--target', 'cursor'], {
      cwd: context.projectRoot, env, encoding: 'utf8', timeout: 30000,
    });
    assert.match(stdout, /WOULD UNINSTALL/);
    assert.match(stdout, /Would remove:/);
    assert.doesNotMatch(stdout, /Status: UNINSTALLED|Removed paths:/);
    assert.deepStrictEqual(fs.readFileSync(plan.installStatePath), stateBefore);
    assert.deepStrictEqual(fs.readFileSync(operation.destinationPath), fileBefore);
    assert.deepStrictEqual(fs.readdirSync(context.homeDir), [], 'dry-run must not initialize canonical state');
  }
});

console.log(`Results: Passed: ${passed}, Failed: ${failed}`);
process.exitCode = failed ? 1 : 0;
