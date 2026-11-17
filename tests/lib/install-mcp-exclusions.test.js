'use strict';

const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { test } = require('node:test');

const { createInstallPlanFromRequest } = require('../../scripts/lib/install/runtime');
const { applyInstallPlan, previewInstallPlan } = require('../../scripts/lib/install/apply');
const { readInstallState } = require('../../scripts/lib/install-state');
const {
  buildDoctorReport,
  repairInstalledStates,
  uninstallInstalledStates,
} = require('../../scripts/lib/install-lifecycle');

const EXCLUDED_SERVER = { command: 'excluded-mcp', args: ['--stdio'] };
const INCLUDED_SERVER = { command: 'included-mcp', args: ['--stdio'] };
const USER_SERVER = { command: 'user-mcp' };

function writeJson(filePath, value) {
  fs.mkdirSync(path.dirname(filePath), { recursive: true });
  fs.writeFileSync(filePath, `${JSON.stringify(value, null, 2)}\n`);
}

function createFixture(t, { allExcluded = false, userConfig = false } = {}) {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'ecc-mcp-exclusions-'));
  const previousDisabled = process.env.ECC_DISABLED_MCPS;
  delete process.env.ECC_DISABLED_MCPS;
  t.after(() => {
    if (previousDisabled === undefined) delete process.env.ECC_DISABLED_MCPS;
    else process.env.ECC_DISABLED_MCPS = previousDisabled;
    fs.rmSync(root, { recursive: true, force: true });
  });
  const sourceRoot = path.join(root, 'source');
  const homeDir = path.join(root, 'home');
  const projectRoot = path.join(root, 'project');
  const targetRoot = path.join(projectRoot, '.cursor');
  const configPath = path.join(targetRoot, 'mcp.json');
  const statePath = path.join(targetRoot, 'ecc-install-state.json');
  const json = (relativePath, value) => writeJson(path.join(sourceRoot, relativePath), value);
  const module = (id, paths) => ({
    id, kind: 'platform', description: 'MCP lifecycle fixture', paths,
    targets: ['cursor'], dependencies: [], defaultInstall: false,
    cost: 'light', stability: 'stable',
  });
  json('package.json', { version: '1.0.0' });
  json('manifests/install-modules.json', {
    version: 1,
    modules: [
      module('platform-configs', ['mcp-configs', 'scripts/after-mcp.js']),
      module('helper-tools', ['scripts/helper.js']),
    ],
  });
  json('manifests/install-profiles.json', {
    version: 1,
    profiles: { minimal: { description: 'MCP fixture', modules: ['platform-configs'] } },
  });
  json('.mcp.json', {
    mcpServers: allExcluded
      ? { excluded: EXCLUDED_SERVER }
      : { excluded: EXCLUDED_SERVER, included: INCLUDED_SERVER },
  });
  fs.mkdirSync(path.join(sourceRoot, 'mcp-configs'), { recursive: true });
  fs.mkdirSync(path.join(sourceRoot, 'scripts'), { recursive: true });
  fs.writeFileSync(path.join(sourceRoot, 'scripts/after-mcp.js'), 'module.exports = "after MCP";\n');
  fs.writeFileSync(path.join(sourceRoot, 'scripts/helper.js'), 'module.exports = "helper";\n');
  fs.mkdirSync(homeDir, { recursive: true });
  fs.mkdirSync(projectRoot, { recursive: true });
  if (userConfig) writeJson(configPath, {
    mcpServers: { excluded: EXCLUDED_SERVER, custom: USER_SERVER },
  });
  const options = { sourceRoot, homeDir, projectRoot, env: {} };
  const lifecycleOptions = { repoRoot: sourceRoot, homeDir, projectRoot, targets: ['cursor'], env: {} };
  const plan = (moduleIds = ['platform-configs']) => createInstallPlanFromRequest({
    mode: 'manifest', target: 'cursor', profileId: null, moduleIds,
    includeComponentIds: [], excludeComponentIds: [], hookConsent: 'declined',
  }, options);
  return {
    configPath,
    statePath,
    plan,
    afterMcpPath: path.join(targetRoot, 'scripts/after-mcp.js'),
    install: (dependencies, moduleIds) => applyInstallPlan(plan(moduleIds), dependencies),
    readConfig: () => JSON.parse(fs.readFileSync(configPath, 'utf8')),
    writeConfig: value => writeJson(configPath, value),
    repair: () => repairInstalledStates(lifecycleOptions),
    doctor: () => buildDoctorReport(lifecycleOptions),
    uninstall: () => uninstallInstalledStates(lifecycleOptions),
  };
}

function installWithExclusion(fixture, dependencies) {
  process.env.ECC_DISABLED_MCPS = 'excluded';
  try {
    return fixture.install(dependencies);
  } finally {
    // Lifecycle commands must honor recorded ownership without this environment.
    delete process.env.ECC_DISABLED_MCPS;
  }
}

function lifecycleResult(report) {
  assert.equal(report.results.length, 1);
  assert.notEqual(report.results[0].status, 'error', report.results[0].error);
  return report.results[0];
}

function assertRecordedPayload(fixture, expectedServers) {
  const operation = readInstallState(fixture.statePath).operations.find(entry => (
    entry.kind === 'merge-json' && entry.destinationPath === fixture.configPath
  ));
  assert.ok(operation, 'The installed JSON merge must remain tracked');
  assert.deepEqual(operation.mergePayload, { mcpServers: expectedServers });
}

test('repair preserves MCP exclusions without the installation environment', t => {
  const fixture = createFixture(t);
  installWithExclusion(fixture);
  assert.deepEqual(fixture.readConfig(), { mcpServers: { included: INCLUDED_SERVER } });

  // The remaining managed server must still be repairable.
  fixture.writeConfig({ mcpServers: { custom: USER_SERVER } });
  const repair = lifecycleResult(fixture.repair());
  assert.ok(repair.repairedPaths.includes(fixture.configPath));
  assert.deepEqual(fixture.readConfig(), {
    mcpServers: { custom: USER_SERVER, included: INCLUDED_SERVER },
  });
  assertRecordedPayload(fixture, { included: INCLUDED_SERVER });
  assert.equal(lifecycleResult(fixture.doctor()).status, 'ok');
  assert.equal(lifecycleResult(fixture.uninstall()).status, 'uninstalled');
  assert.deepEqual(fixture.readConfig(), { mcpServers: { custom: USER_SERVER } });
});

test('repair does not restore MCP servers when every bundled server was excluded', t => {
  const fixture = createFixture(t, { allExcluded: true });
  installWithExclusion(fixture);
  assert.deepEqual(fixture.readConfig(), { mcpServers: {} });
  const repair = lifecycleResult(fixture.repair());
  assert.equal(repair.status, 'ok');
  assert.deepEqual(repair.repairedPaths, []);
  assert.deepEqual(fixture.readConfig(), { mcpServers: {} });
  assertRecordedPayload(fixture, {});
});

test('uninstall preserves a user MCP server excluded from the install', t => {
  const fixture = createFixture(t, { userConfig: true });
  installWithExclusion(fixture);
  assert.deepEqual(fixture.readConfig(), {
    mcpServers: { excluded: EXCLUDED_SERVER, custom: USER_SERVER, included: INCLUDED_SERVER },
  });
  assert.equal(lifecycleResult(fixture.uninstall()).status, 'uninstalled');
  assert.deepEqual(fixture.readConfig(), {
    mcpServers: { excluded: EXCLUDED_SERVER, custom: USER_SERVER },
  });
  assert.ok(!fs.existsSync(fixture.statePath));
});

for (const failure of ['after MCP write', 'final state write']) {
  test(`failed install preserves MCP exclusions (${failure})`, t => {
    const fixture = createFixture(t, { userConfig: true });
    let stateWrites = 0;
    const dependencies = failure === 'after MCP write' ? {
      beforeOperationWrite({ operation }) {
        if (operation.destinationPath === fixture.afterMcpPath) {
          throw new Error('Injected failure after MCP write');
        }
      },
    } : {
      beforeInstallStateWrite() {
        stateWrites += 1;
        if (stateWrites === 2) throw new Error('Injected final state write failure');
      },
    };
    assert.throws(() => installWithExclusion(fixture, dependencies), /Injected.*failure/);
    assert.deepEqual(fixture.readConfig().mcpServers.included, INCLUDED_SERVER);
    assert.ok(fs.existsSync(fixture.statePath), 'Partial installs retain a recovery ledger');
    lifecycleResult(fixture.repair());
    assert.equal(lifecycleResult(fixture.uninstall()).status, 'uninstalled');
    assert.deepEqual(fixture.readConfig(), {
      mcpServers: { excluded: EXCLUDED_SERVER, custom: USER_SERVER },
    });
  });
}

test('repeated and selective installs retain the filtered MCP ownership', t => {
  const fixture = createFixture(t, { userConfig: true });
  installWithExclusion(fixture);
  installWithExclusion(fixture);
  // Installing a different module does not select MCP configuration again.
  fixture.install(undefined, ['helper-tools']);
  lifecycleResult(fixture.repair());
  assertRecordedPayload(fixture, { included: INCLUDED_SERVER });
  assert.equal(lifecycleResult(fixture.uninstall()).status, 'uninstalled');
  assert.deepEqual(fixture.readConfig(), {
    mcpServers: { excluded: EXCLUDED_SERVER, custom: USER_SERVER },
  });
});

test('an install without exclusions still repairs and removes both managed servers', t => {
  const fixture = createFixture(t);
  fixture.install();
  fixture.writeConfig({ mcpServers: { custom: USER_SERVER } });
  lifecycleResult(fixture.repair());
  assert.deepEqual(fixture.readConfig(), {
    mcpServers: { custom: USER_SERVER, excluded: EXCLUDED_SERVER, included: INCLUDED_SERVER },
  });
  assert.equal(lifecycleResult(fixture.uninstall()).status, 'uninstalled');
  assert.deepEqual(fixture.readConfig(), { mcpServers: { custom: USER_SERVER } });
});

test('preview and apply share MCP filtering without changing the plan or other JSON merges', t => {
  const fixture = createFixture(t);
  const originalPlan = fixture.plan();
  const mcpOperation = originalPlan.operations.find(operation => operation.kind === 'merge-json');
  const ordinaryPath = path.join(path.dirname(fixture.configPath), 'preferences.json');
  const ordinaryMerge = { ...mcpOperation, destinationPath: ordinaryPath };
  const plan = {
    ...originalPlan,
    operations: [...originalPlan.operations, ordinaryMerge],
    statePreview: {
      ...originalPlan.statePreview,
      operations: [...originalPlan.statePreview.operations, ordinaryMerge],
    },
  };
  const before = structuredClone(plan);
  const expectedMcp = { mcpServers: { included: INCLUDED_SERVER } };
  const expectedOrdinary = { mcpServers: { excluded: EXCLUDED_SERVER, included: INCLUDED_SERVER } };
  const payloadFor = (operations, destinationPath) => operations.find(operation => (
    operation.destinationPath === destinationPath
  )).mergePayload;
  process.env.ECC_DISABLED_MCPS = 'excluded';
  try {
    const preview = previewInstallPlan(plan);
    assert.ok(!fs.existsSync(fixture.statePath));
    assert.ok(!fs.existsSync(fixture.configPath));
    for (const operations of [preview.operations, preview.statePreview.operations]) {
      assert.deepEqual(payloadFor(operations, fixture.configPath), expectedMcp);
      assert.deepEqual(payloadFor(operations, ordinaryPath), expectedOrdinary);
    }
    assert.deepEqual(plan, before, 'Preview must not mutate the original plan');
    applyInstallPlan(plan);
  } finally {
    delete process.env.ECC_DISABLED_MCPS;
  }
  assert.deepEqual(plan, before, 'Apply must not mutate the original plan');
  assert.deepEqual(fixture.readConfig(), expectedMcp);
  assert.deepEqual(JSON.parse(fs.readFileSync(ordinaryPath, 'utf8')), expectedOrdinary);
  const operations = readInstallState(fixture.statePath).operations;
  assert.deepEqual(payloadFor(operations, fixture.configPath), expectedMcp);
  assert.deepEqual(payloadFor(operations, ordinaryPath), expectedOrdinary);
});

for (const [name, payload, expected] of [
  ['missing mcpServers', { theme: 'dark' }, { userSetting: true, theme: 'dark' }],
  ['null mcpServers', { mcpServers: null }, { userSetting: true, mcpServers: null }],
  ['array mcpServers', { mcpServers: [] }, { userSetting: true, mcpServers: [] }],
  ['scalar mcpServers', { mcpServers: 'custom' }, { userSetting: true, mcpServers: 'custom' }],
  ['empty mcpServers', { mcpServers: {} }, { userSetting: true, mcpServers: {} }],
  ['null payload', null, null],
  ['array payload', ['custom'], ['custom']],
  ['string payload', 'custom', 'custom'],
  ['number payload', 42, 42],
  ['boolean payload', false, false],
]) {
  test(`MCP exclusions preserve ordinary JSON merge behavior (${name})`, t => {
    const fixture = createFixture(t);
    fixture.writeConfig({ userSetting: true });
    const originalPlan = fixture.plan();
    const replacePayload = operations => operations.map(operation => (
      operation.destinationPath === fixture.configPath
        ? { ...operation, mergePayload: payload }
        : operation
    ));
    const plan = {
      ...originalPlan,
      operations: replacePayload(originalPlan.operations),
      statePreview: {
        ...originalPlan.statePreview,
        operations: replacePayload(originalPlan.statePreview.operations),
      },
    };
    const before = structuredClone(plan);
    const payloadFor = operations => operations.find(operation => (
      operation.destinationPath === fixture.configPath
    )).mergePayload;
    process.env.ECC_DISABLED_MCPS = 'excluded';

    const preview = previewInstallPlan(plan);
    assert.deepEqual(payloadFor(preview.operations), payload);
    assert.deepEqual(payloadFor(preview.statePreview.operations), payload);
    assert.deepEqual(fixture.readConfig(), { userSetting: true });
    assert.ok(!fs.existsSync(fixture.statePath));
    assert.deepEqual(plan, before, 'Preview must not mutate the original plan');

    applyInstallPlan(plan);
    assert.deepEqual(fixture.readConfig(), expected);
    assert.deepEqual(payloadFor(readInstallState(fixture.statePath).operations), payload);
    assert.deepEqual(plan, before, 'Apply must not mutate the original plan');
  });
}
