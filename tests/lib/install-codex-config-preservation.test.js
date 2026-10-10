'use strict';

const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { test } = require('node:test');

const { createInstallPlanFromRequest } = require('../../scripts/lib/install/runtime');
const { applyInstallPlan, previewInstallPlan } = require('../../scripts/lib/install/apply');
const {
  buildDoctorReport, repairInstalledStates, uninstallInstalledStates,
} = require('../../scripts/lib/install-lifecycle');
const { readInstallState, writeInstallState } = require('../../scripts/lib/install-state');

const codexAdapter = require('../../scripts/lib/install-targets/codex-home');

const USER_REFERENCE = 'user-config.example.toml';
const PROJECT_CONFIG = '# Project-only configuration\n[features]\nmulti_agent = true\n';
const SHARED_FILES = ['config.toml', 'AGENTS.md'];
const TEMPLATES = {
  'config.toml': '# ECC defaults\nmodel = "example-model"\n',
  'AGENTS.md': '# ECC instructions\n\nFollow the project conventions.\n',
};

function writeFile(filePath, content) {
  fs.mkdirSync(path.dirname(filePath), { recursive: true });
  fs.writeFileSync(filePath, content);
}

function createFixture(t) {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'ecc-codex-preservation-'));
  t.after(() => fs.rmSync(root, { recursive: true, force: true }));
  const sourceRoot = path.join(root, 'source');
  const homeDir = path.join(root, 'home');
  const projectRoot = path.join(root, 'project');
  const json = (relativePath, value) => writeFile(
    path.join(sourceRoot, relativePath), `${JSON.stringify(value, null, 2)}\n`
  );
  json('package.json', { version: '1.0.0' });
  json('manifests/install-modules.json', {
    version: 1,
    modules: [{
      id: 'platform-configs', kind: 'platform', description: 'Codex configuration fixture',
      paths: ['.codex'], targets: ['codex'], dependencies: [],
      defaultInstall: true, cost: 'light', stability: 'stable',
    }, {
      id: 'helper-scripts', kind: 'platform', description: 'Independent helper fixture',
      paths: ['scripts'], targets: ['codex'], dependencies: [],
      defaultInstall: false, cost: 'light', stability: 'stable',
    }],
  });
  json('manifests/install-profiles.json', {
    version: 1, profiles: { minimal: { description: 'Fixture', modules: ['platform-configs'] } },
  });
  for (const name of SHARED_FILES) writeFile(path.join(sourceRoot, '.codex', name), TEMPLATES[name]);
  writeFile(path.join(sourceRoot, '.codex', USER_REFERENCE), TEMPLATES['config.toml']);
  writeFile(path.join(sourceRoot, '.codex', 'config.toml'), PROJECT_CONFIG);
  writeFile(path.join(sourceRoot, 'scripts', 'independent-helper.js'), 'module.exports = "helper";\n');
  fs.mkdirSync(homeDir, { recursive: true });
  fs.mkdirSync(projectRoot, { recursive: true });
  const options = { sourceRoot, homeDir, projectRoot, env: {} };
  const lifecycleOptions = { repoRoot: sourceRoot, homeDir, projectRoot, targets: ['codex'], env: {} };
  const plan = (moduleIds = ['platform-configs']) => createInstallPlanFromRequest({
    mode: 'manifest', target: 'codex', profileId: null, moduleIds,
    includeComponentIds: [], excludeComponentIds: [], hookConsent: 'declined',
  }, options);
  return {
    sourceRoot,
    template: name => path.join(sourceRoot, '.codex', name === 'config.toml' ? USER_REFERENCE : name),
    destination: name => path.join(homeDir, '.codex', name),
    statePath: path.join(homeDir, '.codex', 'ecc-install-state.json'),
    plan,
    install: moduleIds => applyInstallPlan(plan(moduleIds)),
    repair: (dryRun = false) => repairInstalledStates({ ...lifecycleOptions, dryRun }),
    doctor: () => buildDoctorReport(lifecycleOptions),
    uninstall: () => uninstallInstalledStates(lifecycleOptions),
  };
}

function lifecycleResult(report) {
  assert.equal(report.results.length, 1);
  assert.notEqual(report.results[0].status, 'error', report.results[0].error);
  return report.results[0];
}

function assertPreserved(fixture, name, content) {
  assert.deepEqual(fs.readFileSync(fixture.destination(name)), Buffer.from(content));
}

function assertUnmanaged(fixture, name) {
  assert.ok(!readInstallState(fixture.statePath).operations.some(operation => (
    operation.destinationPath === fixture.destination(name) && operation.ownership === 'managed'
  )), `${name} must not remain managed after preserving user content`);
}

function assertWarning(result, name) {
  assert.ok((result.warnings || []).some(warning => (
    warning.includes(name) && /skip|preserv|user-owned|modif/i.test(warning)
  )), `Expected an explicit preservation warning for ${name}`);
}

function editAfterRepairInspection(fixture, name, content, action) {
  const originalOpen = fs.openSync;
  const originalClose = fs.closeSync;
  const inspectedDescriptors = new Set();
  let injected = false;
  fs.openSync = function (filePath, ...args) {
    const descriptor = originalOpen.call(fs, filePath, ...args);
    if (!injected && typeof filePath === 'string'
      && fs.realpathSync(filePath) === fs.realpathSync(fixture.destination(name))
      && new Error().stack.includes('inspectManagedOperation')) {
      inspectedDescriptors.add(descriptor);
    }
    return descriptor;
  };
  fs.closeSync = function (descriptor) {
    const result = originalClose.call(fs, descriptor);
    if (!injected && inspectedDescriptors.delete(descriptor)) {
      // Inspection has read the previous bytes. Simulate an editor saving next,
      // before repair checkpoints or refreshes state; no digest-refresh hook is used.
      injected = true;
      writeFile(fixture.destination(name), content);
    }
    return result;
  };
  try {
    return { result: action(), injected };
  } finally {
    fs.openSync = originalOpen;
    fs.closeSync = originalClose;
  }
}

for (const name of SHARED_FILES) {
  for (const stage of ['bridge', 'no-op refresh']) {
    test(`repair ${stage} does not claim a concurrent edit to Codex ${name}`, t => {
      const fixture = createFixture(t);
      fixture.install();
      const previousOperation = readInstallState(fixture.statePath).operations.find(operation => (
        operation.destinationPath === fixture.destination(name)
      ));
      if (stage === 'bridge') {
        writeFile(fixture.template(name),
          `${TEMPLATES[name]}\n# Updated upstream template\n`);
      }
      const content = `${TEMPLATES[name]}\r\n# Saved after repair inspected the file\r\n`;

      const { result: report, injected } = editAfterRepairInspection(
        fixture, name, content, () => fixture.repair()
      );

      assert.ok(injected, 'The simulated edit must occur after repair inspection');
      assert.equal(report.results.length, 1);
      if (stage === 'bridge') {
        assert.equal(report.results[0].status, 'error');
        assert.match(report.results[0].error, /Refusing.*user configuration.*changed after planning/);
      } else {
        assert.equal(report.results[0].status, 'ok');
      }
      assertPreserved(fixture, name, content);
      const refreshedOperation = readInstallState(fixture.statePath).operations.find(operation => (
        operation.destinationPath === fixture.destination(name) && operation.ownership === 'managed'
      ));
      assert.ok(refreshedOperation,
        'Repair must retain the previous ledger entry for configuration it did not write');
      assert.equal(refreshedOperation.contentSha256, previousOperation.contentSha256,
        'Repair must retain the previous digest for configuration it did not write');
      lifecycleResult(fixture.uninstall());
      assertPreserved(fixture, name, content);
    });
  }

  test(`selective reinstall releases edited Codex ${name} retained from an earlier module`, t => {
    const fixture = createFixture(t);
    fixture.install();
    const content = `${TEMPLATES[name]}\n# Keep this across unrelated module installations\n`;
    writeFile(fixture.destination(name), content);
    const selectivePlan = fixture.plan(['helper-scripts']);
    assert.ok(!selectivePlan.operations.some(operation => (
      operation.destinationPath === fixture.destination(name)
    )), 'The edited configuration must not be in the selected module operations');

    const result = applyInstallPlan(selectivePlan);

    assertPreserved(fixture, name, content);
    assertUnmanaged(fixture, name);
    assertWarning(result, name);
    lifecycleResult(fixture.repair());
    assertPreserved(fixture, name, content);
    assertUnmanaged(fixture, name);
    lifecycleResult(fixture.uninstall());
    assertPreserved(fixture, name, content);
  });

  test(`reinstall rejects a last-minute edit to Codex ${name} without claiming the edited bytes`, t => {
    const fixture = createFixture(t);
    fixture.install();
    const destination = fixture.destination(name);
    const previousOperation = readInstallState(fixture.statePath).operations.find(operation => (
      operation.destinationPath === destination
    ));
    const rawPlan = fixture.plan();
    // Write the other file first to exercise the partial-install checkpoint on failure.
    const plan = {
      ...rawPlan,
      operations: [
        ...rawPlan.operations.filter(operation => operation.destinationPath !== destination),
        ...rawPlan.operations.filter(operation => operation.destinationPath === destination),
      ],
    };
    const content = `${TEMPLATES[name]}\r\n# Saved while ECC was running\r\n`;
    let wroteAnotherFile = false;
    let injectedEdit = false;

    assert.throws(() => applyInstallPlan(plan, {
      beforeOperationWrite({ operation }) {
        if (operation.destinationPath !== destination) {
          wroteAnotherFile = true;
          return;
        }
        assert.ok(wroteAnotherFile, 'The failure must exercise a partial install');
        writeFile(destination, content);
        injectedEdit = true;
      },
    }), /Refusing.*user configuration.*changed after planning/);

    assert.ok(injectedEdit);
    assertPreserved(fixture, name, content);
    const checkpointOperation = readInstallState(fixture.statePath).operations.find(operation => (
      operation.destinationPath === destination && operation.ownership === 'managed'
    ));
    assert.ok(checkpointOperation,
      'A failure checkpoint must retain the previous ledger entry');
    assert.equal(checkpointOperation.contentSha256, previousOperation.contentSha256,
      'A failure checkpoint must retain the old digest, never adopt the user edit');
    lifecycleResult(fixture.uninstall());
    assertPreserved(fixture, name, content);
  });

  test(`repeated repair keeps edited Codex ${name} unmanaged while repairing an ECC script`, t => {
    const fixture = createFixture(t);
    const scriptName = path.join('scripts', 'ecc-helper.js');
    const scriptContent = 'module.exports = "ECC helper";\n';
    writeFile(path.join(fixture.sourceRoot, '.codex', scriptName), scriptContent);
    fixture.install();
    const content = `${TEMPLATES[name]}\n# Keep my preferences\n`;
    writeFile(fixture.destination(name), content);

    lifecycleResult(fixture.repair());
    assertPreserved(fixture, name, content);
    assertUnmanaged(fixture, name);
    for (let attempt = 0; attempt < 2; attempt += 1) {
      const before = lifecycleResult(fixture.doctor());
      assert.ok(!before.issues.some(issue => issue.code === 'drifted-managed-files'));
      writeFile(fixture.destination(scriptName), 'damaged ECC helper\n');
      const damaged = lifecycleResult(fixture.doctor());
      assert.ok(damaged.issues.some(issue => issue.code === 'drifted-managed-files'));

      const result = lifecycleResult(fixture.repair());

      assert.ok(result.repairedPaths.includes(fixture.destination(scriptName)));
      assertPreserved(fixture, scriptName, scriptContent);
      assertPreserved(fixture, name, content);
      assertUnmanaged(fixture, name);
      const after = lifecycleResult(fixture.doctor());
      assert.ok(!after.issues.some(issue => issue.code === 'drifted-managed-files'));
    }
    lifecycleResult(fixture.uninstall());
    assertPreserved(fixture, name, content);
    assert.ok(!fs.existsSync(fixture.destination(scriptName)));
  });

  for (const action of ['reinstall', 'repair']) {
    test(`${action} preserves edited Codex ${name} and leaves it safe to uninstall`, t => {
      const fixture = createFixture(t);
      fixture.install();
      const content = `${TEMPLATES[name]}\r\n# Personal preferences — 保留\r\n`;
      writeFile(fixture.destination(name), content);

      const result = action === 'reinstall' ? fixture.install() : lifecycleResult(fixture.repair());

      assertPreserved(fixture, name, content);
      assertWarning(result, name);
      assertUnmanaged(fixture, name);
      lifecycleResult(fixture.uninstall());
      assertPreserved(fixture, name, content);
    });
  }

  test(`dry runs warn about edited Codex ${name} without changing files or state`, t => {
    const fixture = createFixture(t);
    fixture.install();
    const content = `${TEMPLATES[name]}\n# User customization\n`;
    writeFile(fixture.destination(name), content);
    const previousState = fs.readFileSync(fixture.statePath);

    const preview = previewInstallPlan(fixture.plan());
    const repairPreview = lifecycleResult(fixture.repair(true));

    assertPreserved(fixture, name, content);
    assert.deepEqual(fs.readFileSync(fixture.statePath), previousState);
    assertWarning(preview, name);
    assertWarning(repairPreview, name);
    assert.ok(!preview.operations.some(operation => operation.destinationPath === fixture.destination(name)));
    assert.ok(!repairPreview.plannedRepairs.includes(fixture.destination(name)));
  });

  test(`pre-existing Codex ${name} survives install, repair and uninstall`, t => {
    const fixture = createFixture(t);
    const content = '# Personal file before ECC installation\r\n保持原样\r\n';
    writeFile(fixture.destination(name), content);

    assertWarning(fixture.install(), name);
    assertPreserved(fixture, name, content);
    assertUnmanaged(fixture, name);
    const repairResult = lifecycleResult(fixture.repair());
    assertPreserved(fixture, name, content);
    assertWarning(repairResult, name);
    assertUnmanaged(fixture, name);
    lifecycleResult(fixture.uninstall());
    assertPreserved(fixture, name, content);
  });

  for (const action of ['reinstall', 'repair']) {
    test(`${action} preserves Codex ${name} when legacy state lacks its content digest`, t => {
      const fixture = createFixture(t);
      fixture.install();
      const state = readInstallState(fixture.statePath);
      writeInstallState(fixture.statePath, {
        ...state,
        operations: state.operations.map(operation => {
          if (operation.destinationPath !== fixture.destination(name)) return operation;
          const { contentSha256: _contentSha256, ...legacyOperation } = operation;
          return legacyOperation;
        }),
      });
      // Even bytes equal to today's template cannot prove ownership without a recorded digest.
      const content = fs.readFileSync(fixture.destination(name));
      const result = action === 'reinstall' ? fixture.install() : lifecycleResult(fixture.repair());

      assertPreserved(fixture, name, content);
      assertWarning(result, name);
      assertUnmanaged(fixture, name);
      lifecycleResult(fixture.uninstall());
      assertPreserved(fixture, name, content);
    });
  }

  for (const action of ['reinstall', 'repair']) {
    test(`${action} updates unedited Codex ${name} when the template changes`, t => {
      const fixture = createFixture(t);
      fixture.install();
      const updated = `${TEMPLATES[name]}\n# New upstream default\n`;
      writeFile(fixture.template(name), updated);

      if (action === 'reinstall') fixture.install();
      else lifecycleResult(fixture.repair());

      assertPreserved(fixture, name, updated);
      assert.ok(readInstallState(fixture.statePath).operations.some(operation => (
        operation.destinationPath === fixture.destination(name) && operation.ownership === 'managed'
      )));
      lifecycleResult(fixture.uninstall());
      assert.ok(!fs.existsSync(fixture.destination(name)));
    });
  }

  test(`repair restores missing managed Codex ${name}`, t => {
    const fixture = createFixture(t);
    fixture.install();
    const installedContent = fs.readFileSync(fixture.destination(name));
    fs.unlinkSync(fixture.destination(name));

    lifecycleResult(fixture.repair());

    assertPreserved(fixture, name, installedContent);
  });
}

function installOldConfigLedger(fixture) {
  const projectPath = path.join(fixture.sourceRoot, '.codex', 'config.toml');
  writeFile(projectPath, TEMPLATES['config.toml']);
  try {
    const plan = fixture.plan();
    const oldOperation = plan.operations.find(operation => (
      operation.destinationPath === fixture.destination('config.toml')
    ));
    assert.ok(oldOperation);
    const useOldSource = operation => (
      operation.destinationPath === oldOperation.destinationPath ? {
        ...operation, sourceRelativePath: '.codex/config.toml', sourcePath: projectPath,
      } : operation
    );
    // Both executable operations and the planned ledger describe the old source.
    applyInstallPlan({
      ...plan,
      operations: plan.operations.map(useOldSource),
      statePreview: { ...plan.statePreview, operations: plan.statePreview.operations.map(useOldSource) },
    });
    assert.equal(readInstallState(fixture.statePath).operations.find(operation => (
      operation.destinationPath === fixture.destination('config.toml')
    )).sourceRelativePath, '.codex/config.toml');
  } finally {
    writeFile(projectPath, PROJECT_CONFIG);
  }
}

test('Codex native install uses one user-reference operation before preview, apply and state', t => {
  const fixture = createFixture(t);
  const plan = fixture.plan();
  const selected = plan.operations.filter(operation => (
    operation.destinationPath === fixture.destination('config.toml')
  ));
  assert.equal(selected.length, 1);
  assert.equal(selected[0].sourceRelativePath, '.codex/user-config.example.toml');
  assert.equal(previewInstallPlan(plan).operations.filter(operation => (
    operation.destinationPath === fixture.destination('config.toml')
  )).length, 1);
  applyInstallPlan(plan);
  assertPreserved(fixture, 'config.toml', TEMPLATES['config.toml']);
  assertPreserved(fixture, 'AGENTS.md', TEMPLATES['AGENTS.md']);
  assertPreserved(fixture, USER_REFERENCE, TEMPLATES['config.toml']);
  const recorded = readInstallState(fixture.statePath).operations.filter(operation => (
    operation.destinationPath === fixture.destination('config.toml')
  ));
  assert.equal(recorded.length, 1);
  assert.equal(recorded[0].sourceRelativePath, '.codex/user-config.example.toml');
});

for (const invalid of ['missing', 'directory']) {
  test(`selected Codex native install rejects ${invalid} user reference before writes`, t => {
    const fixture = createFixture(t);
    fs.unlinkSync(fixture.template('config.toml'));
    if (invalid === 'directory') fs.mkdirSync(fixture.template('config.toml'));
    assert.throws(() => fixture.install(), /Codex user reference.*regular file/);
    assert.ok(!fs.existsSync(fixture.statePath));
    assert.ok(!fs.existsSync(fixture.destination('config.toml')));
    assert.ok(!fs.existsSync(fixture.destination('AGENTS.md')));
    // Unselected native configuration must not block independent modules.
    fixture.install(['helper-scripts']);
    assert.ok(!fs.existsSync(fixture.destination('config.toml')));
  });
}

test('Codex adapter preserves metadata-only planning and foreign/excluded filters', () => {
  const operations = codexAdapter.planOperations({
    homeDir: '/example',
    modules: [{ id: 'platform-configs', paths: ['.codex', '.cursor', '.agents', 'scripts'] }],
  });
  assert.deepEqual(operations.map(operation => operation.sourceRelativePath),
    ['.codex', '.codex/user-config.example.toml', 'scripts']);
  assert.equal(operations[1].destinationPath, path.join('/example', '.codex', 'config.toml'));
});

for (const action of ['reinstall', 'repair']) {
  for (const edited of [false, true]) {
    test(`${action} preserves ownership through old config source migration (edited=${edited})`, t => {
      const fixture = createFixture(t);
      installOldConfigLedger(fixture);
      const updated = `${TEMPLATES['config.toml']}# New explicit user reference\n`;
      writeFile(fixture.template('config.toml'), updated);
      const personal = `${TEMPLATES['config.toml']}# Personal change\n`;
      if (edited) writeFile(fixture.destination('config.toml'), personal);
      const result = action === 'reinstall' ? fixture.install() : lifecycleResult(fixture.repair());
      assertPreserved(fixture, 'config.toml', edited ? personal : updated);
      if (edited) {
        assertWarning(result, 'config.toml');
        assertUnmanaged(fixture, 'config.toml');
      } else {
        const operations = readInstallState(fixture.statePath).operations.filter(operation => (
          operation.destinationPath === fixture.destination('config.toml')
        ));
        assert.equal(operations.length, 1);
        assert.equal(operations[0].sourceRelativePath, '.codex/user-config.example.toml');
        assert.equal(operations[0].ownership, 'managed');
      }
      lifecycleResult(fixture.doctor());
      lifecycleResult(fixture.uninstall());
      if (edited) assertPreserved(fixture, 'config.toml', personal);
      else assert.ok(!fs.existsSync(fixture.destination('config.toml')));
    });
  }
}

test('old config source migration retains its digest after a raced user edit', t => {
  const fixture = createFixture(t);
  installOldConfigLedger(fixture);
  const previous = readInstallState(fixture.statePath).operations.find(operation => (
    operation.destinationPath === fixture.destination('config.toml')
  ));
  writeFile(fixture.template('config.toml'), `${TEMPLATES['config.toml']}# Upstream update\n`);
  const personal = '# User saved during migration\n';
  const { result, injected } = editAfterRepairInspection(
    fixture, 'config.toml', personal, () => fixture.repair()
  );
  assert.ok(injected);
  assert.equal(result.results[0].status, 'error');
  assert.match(result.results[0].error, /Refusing.*user configuration.*changed after planning/);
  assertPreserved(fixture, 'config.toml', personal);
  const current = readInstallState(fixture.statePath).operations.find(operation => (
    operation.destinationPath === fixture.destination('config.toml')
  ));
  assert.equal(current.contentSha256, previous.contentSha256);
  lifecycleResult(fixture.uninstall());
  assertPreserved(fixture, 'config.toml', personal);
});
