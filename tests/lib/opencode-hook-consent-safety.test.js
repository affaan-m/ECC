'use strict';

const assert = require('assert');
const crypto = require('crypto');
const fs = require('fs');
const os = require('os');
const path = require('path');
const { createFileSystemLoader } = require('./helpers/load-with-file-system');
const fileSystem = { ...fs };
const load = createFileSystemLoader(fileSystem);
const { applyInstallPlan } = load(require.resolve('../../scripts/lib/install/apply'));
const { withHookConsent } = require('../../scripts/lib/install/hook-consent');
const { createInstallState, readInstallState, writeInstallState } = require('../../scripts/lib/install-state');
const { buildDoctorReport, repairInstalledStates } = load(require.resolve('../../scripts/lib/install-lifecycle'));

const REPO_ROOT = path.resolve(__dirname, '../..');
const sha256 = value => crypto.createHash('sha256').update(value).digest('hex');

// Authentic public ECC source fixtures, kept as inert bytes (never imported).
// Copying these bytes to an alias does not claim they were published build output.
const legacyPluginFixtures = [
  {
    name: "2.2.1 barrel",
    // https://github.com/affaan-m/ECC/blob/ca185ef5f7667078a1e70a763bd3a9c71c48acf0/.opencode/plugins/index.ts
    sha256: '965c5fac76ce0c3ceb3836814f5eb9ede8c9db50373a508c734f949cb321a21a',
    content: `/**
 * ECC Plugins for OpenCode
 *
 * This module exports all ECC plugins for OpenCode integration.
 * Plugins provide hook-based automation that mirrors Claude Code's hook system
 * while taking advantage of OpenCode's more sophisticated 20+ event types.
 */

export { ECCHooksPlugin, default } from "./ecc-hooks.js"

// Re-export for named imports
export * from "./ecc-hooks.js"
`,
  },
  {
    name: "early barrel",
    // https://github.com/affaan-m/ECC/blob/6d440c036df2c1b2fec957627d1202c3708e0627/.opencode/plugins/index.ts
    sha256: 'e42c733adb177f84cea813663aa34c7868dbaa98c96950d0ef91cd211b8aa169',
    content: `/**
 * Everything Claude Code (ECC) Plugins for OpenCode
 *
 * This module exports all ECC plugins for OpenCode integration.
 * Plugins provide hook-based automation that mirrors Claude Code's hook system
 * while taking advantage of OpenCode's more sophisticated 20+ event types.
 */

export { ECCHooksPlugin, default } from "./ecc-hooks"

// Re-export for named imports
export * from "./ecc-hooks"
`,
  },
];

function fixture(callback, enabled = false) {
  const root = fs.realpathSync(fs.mkdtempSync(path.join(os.tmpdir(), 'ecc-opencode-write-')));
  const homeDir = path.join(root, 'home');
  const sourceRoot = path.join(root, 'source');
  const targetRoot = path.join(homeDir, '.config', 'opencode');
  const adapter = { id: 'opencode-home', target: 'opencode', kind: 'home' };
  try {
    fs.mkdirSync(path.join(sourceRoot, 'manifests'), { recursive: true });
    for (const name of ['install-modules.json', 'install-components.json', 'install-profiles.json']) {
      fs.copyFileSync(path.join(REPO_ROOT, 'manifests', name), path.join(sourceRoot, 'manifests', name));
    }
    fs.copyFileSync(path.join(REPO_ROOT, 'package.json'), path.join(sourceRoot, 'package.json'));
    const operations = ['opencode.json', 'plugins/ecc-hooks.ts'].map(relativePath => {
      const sourceRelativePath = `.opencode/${relativePath}`;
      const sourcePath = path.join(sourceRoot, sourceRelativePath);
      const destinationPath = path.join(targetRoot, relativePath);
      const content = relativePath === 'opencode.json'
        ? '{"plugin":["./plugins"],"userSetting":true}\n'
        : 'export default async () => ({ "session.created": () => {} });\n';
      fs.mkdirSync(path.dirname(sourcePath), { recursive: true });
      fs.mkdirSync(path.dirname(destinationPath), { recursive: true });
      fs.writeFileSync(sourcePath, content);
      fs.writeFileSync(destinationPath, content);
      return { kind: 'copy-file', moduleId: 'platform-configs', sourceRelativePath, sourcePath,
        destinationPath, ownership: 'managed', scaffoldOnly: false,
        strategy: 'preserve-relative-path', contentSha256: sha256(content) };
    });
    const dist = path.join(sourceRoot, '.opencode', 'dist');
    fs.mkdirSync(path.join(dist, 'plugins'), { recursive: true });
    fs.mkdirSync(path.join(dist, 'tools'), { recursive: true });
    fs.writeFileSync(path.join(dist, 'index.js'), 'module.exports = {};\n');
    const installStatePath = path.join(targetRoot, 'ecc-install-state.json');
    const state = createInstallState({
      adapter, targetRoot, installStatePath,
      request: { modules: ['platform-configs'], legacyMode: true,
        hookConsent: enabled ? 'enabled' : null },
      resolution: { selectedModules: enabled ? ['platform-configs', 'hooks-runtime'] : ['platform-configs'],
        skippedModules: [] },
      operations, source: { repoVersion: '2.2.2', manifestVersion: 1 },
    });
    writeInstallState(installStatePath, state);
    const basePlan = { target: 'opencode', adapter, homeDir, sourceRoot, targetRoot,
      installRoot: targetRoot, installStatePath, operations, warnings: [],
      selectedModuleIds: state.resolution.selectedModules, statePreview: state };
    const previousCwd = process.cwd();
    try {
      // Hosted Windows checkouts and os.tmpdir() may be on different drives.
      // Anchor relative-root callers inside their private fixture on every OS.
      process.chdir(root);
      callback({ root, homeDir, sourceRoot, targetRoot, installStatePath, state, basePlan,
        declinePlan: withHookConsent(basePlan, 'declined') });
    } finally {
      process.chdir(previousCwd);
    }
  } finally {
    fs.rmSync(root, { recursive: true, force: true });
  }
}

function repair(value, extra = {}) {
  return repairInstalledStates({ repoRoot: value.sourceRoot, homeDir: value.homeDir,
    projectRoot: value.homeDir, targets: ['opencode'],
    buildOpencodePayload() { throw new Error('Unexpected compiler execution'); }, ...extra });
}

function withWritableOpenMutation(filePath, mutate, callback) {
  const originalOpen = fileSystem.openSync;
  const originalClose = fileSystem.closeSync;
  let injected = false;
  const descriptors = new Set();
  fileSystem.openSync = function (candidate, flags, ...rest) {
    const writable = typeof flags === 'number'
      ? Boolean(flags & (fs.constants.O_WRONLY | fs.constants.O_RDWR))
      : /[wa+]/.test(flags);
    const matches = typeof candidate === 'string' && path.resolve(candidate) === path.resolve(filePath);
    if (matches && writable && !injected) {
      injected = true;
      mutate();
    }
    const fd = originalOpen.call(fs, candidate, flags, ...rest);
    if (matches && writable) descriptors.add(fd);
    return fd;
  };
  fileSystem.closeSync = function (fd) {
    descriptors.delete(fd);
    return originalClose.call(fs, fd);
  };
  try {
    callback();
    assert.ok(injected, 'The destination writable-open boundary must be exercised');
    assert.strictEqual(descriptors.size, 0, 'Every owned writable descriptor must close');
  } finally {
    fileSystem.openSync = originalOpen;
    fileSystem.closeSync = originalClose;
  }
}

function assertPriorOwnership(value, filePath) {
  const after = readInstallState(value.installStatePath);
  const prior = value.state.operations.find(operation => operation.destinationPath === filePath);
  const current = after.operations.find(operation => operation.destinationPath === filePath);
  assert.strictEqual(current.contentSha256, prior.contentSha256, 'Do not adopt raced bytes');
  assert.strictEqual(after.request.hookConsent, value.state.request.hookConsent);
}

function runTests() {
  let passed = 0;
  let failed = 0;
  const test = (name, callback) => {
    try { callback(); passed++; console.log(`  PASS ${name}`); }
    catch (error) { failed++; console.error(`  FAIL ${name}: ${error.stack}`); }
  };
  test('relative-root fixture remains relative across Windows checkout and temp drives', () => {
    const source = 'C:\\private\\source';
    assert.strictEqual(path.win32.isAbsolute(path.win32.relative('D:\\checkout', source)), true);
    const relative = path.win32.relative('C:\\private', source);
    assert.strictEqual(relative, 'source');
    assert.strictEqual(path.win32.isAbsolute(relative), false);
    assert.strictEqual(path.win32.resolve('C:\\private', relative), source);
  });
  test('private filesystem injection never patches the process filesystem or module cache', () => fixture(value => {
    const nativeOpen = fs.openSync;
    const nativeClose = fs.closeSync;
    const cachedApply = require.cache[require.resolve('../../scripts/lib/install/apply')];
    const destination = path.join(value.targetRoot, 'plugins/ecc-hooks.ts');
    withWritableOpenMutation(destination, () => {
      assert.strictEqual(fs.openSync, nativeOpen);
      assert.strictEqual(fs.closeSync, nativeClose);
    }, () => assert.strictEqual(applyInstallPlan(value.declinePlan).applied, true));
    assert.strictEqual(fs.openSync, nativeOpen);
    assert.strictEqual(fs.closeSync, nativeClose);
    assert.strictEqual(require.cache[require.resolve('../../scripts/lib/install/apply')], cachedApply);
  }));
  for (const relativePath of ['plugins/ecc-hooks.ts', 'opencode.json']) {
    for (const mode of ['apply', 'repair']) {
      test(`${mode} preserves a same-inode ${relativePath} edit at writable open`, () => fixture(value => {
        const destination = path.join(value.targetRoot, relativePath);
        const content = relativePath === 'opencode.json'
          ? '{"plugin":["./plugins"],"userEdit":"keep"}\n' : '// user edit: preserve this\n';
        withWritableOpenMutation(destination, () => fs.writeFileSync(destination, content), () => {
          if (mode === 'apply') {
            assert.throws(() => applyInstallPlan(value.declinePlan), /changed after preflight/i);
          } else {
            const result = repair(value).results[0];
            assert.strictEqual(result.status, 'error');
            assert.match(result.error, /changed after preflight/i);
            assert.notStrictEqual(result.stateRefreshed, true);
          }
          assert.strictEqual(fs.readFileSync(destination, 'utf8'), content);
          assertPriorOwnership(value, destination);
        });
      }, mode === 'apply'));
    }
  }
  for (const mode of ['apply', 'repair']) {
    test(`${mode} preserves a file created after expected absence`, () => fixture(value => {
      const destination = path.join(value.targetRoot, 'plugins/ecc-hooks.ts');
      fs.unlinkSync(destination);
      const content = '// newly created user file\n';
      withWritableOpenMutation(destination, () => fs.writeFileSync(destination, content), () => {
        if (mode === 'apply') assert.throws(() => applyInstallPlan(value.declinePlan), /EEXIST|changed after preflight/i);
        else assert.strictEqual(repair(value).results[0].status, 'error');
        assert.strictEqual(fs.readFileSync(destination, 'utf8'), content);
        assertPriorOwnership(value, destination);
      });
    }, mode === 'apply'));
    test(`${mode} does not recreate an expected existing file removed at open`, () => fixture(value => {
      const destination = path.join(value.targetRoot, 'opencode.json');
      withWritableOpenMutation(destination, () => fs.unlinkSync(destination), () => {
        if (mode === 'apply') assert.throws(() => applyInstallPlan(value.declinePlan), /ENOENT|changed after preflight/i);
        else assert.strictEqual(repair(value).results[0].status, 'error');
        assert.strictEqual(fs.existsSync(destination), false);
        assertPriorOwnership(value, destination);
      });
    }, mode === 'apply'));
  }
  for (const mode of ['apply', 'doctor', 'repair']) {
    test(`${mode} reports malformed activation config with source context`, () => fixture(value => {
      const destination = path.join(value.targetRoot, 'opencode.json');
      fs.writeFileSync(destination, '{ malformed');
      const before = fs.readFileSync(value.installStatePath);
      if (mode === 'apply') assert.throws(() => applyInstallPlan(value.declinePlan), /Failed to parse .*opencode\.json/);
      else if (mode === 'repair') assert.match(repair(value).results[0].error, /Failed to parse .*opencode\.json/);
      else {
        const result = buildDoctorReport({ repoRoot: value.sourceRoot, homeDir: value.homeDir,
          projectRoot: value.homeDir, targets: ['opencode'] }).results[0];
        assert.match(JSON.stringify(result.issues), /Failed to parse .*opencode\.json/);
      }
      assert.strictEqual(fs.readFileSync(destination, 'utf8'), '{ malformed');
      assert.deepStrictEqual(fs.readFileSync(value.installStatePath), before);
    }));
  }
  test('apply rejects another enabled writer and repair while holding its target lease', () => fixture(value => {
    let checked = false;
    applyInstallPlan(value.declinePlan, {
      beforeOperationWrite() {
        if (checked) return;
        checked = true;
        assert.throws(() => applyInstallPlan(withHookConsent(value.basePlan, 'enabled')), /Another ECC process|OpenCode.*lock/i);
        assert.strictEqual(repair(value).results[0].status, 'error');
      },
    });
    assert.ok(checked);
    assert.strictEqual(fs.existsSync(`${value.installStatePath}.ecc.lock`), false);
    assert.strictEqual(applyInstallPlan(value.declinePlan).applied, true);
  }));
  test('repair preserves ownership for a destination-classified activation with a recorded transform', () => fixture(value => {
    const operation = value.state.operations.find(entry => entry.sourceRelativePath.endsWith('ecc-hooks.ts'));
    const oldDestination = operation.destinationPath;
    operation.sourceRelativePath = '.opencode/tools/fixture.js';
    operation.contentTransform = 'opencode-disable-plugin-entrypoint';
    operation.destinationPath = path.join(value.targetRoot, 'plugins', 'custom.js');
    const source = path.join(value.sourceRoot, operation.sourceRelativePath);
    fs.mkdirSync(path.dirname(source), { recursive: true });
    fs.copyFileSync(oldDestination, source);
    fs.unlinkSync(oldDestination);
    writeInstallState(value.installStatePath, value.state);
    const content = '// preserve unowned new custom plugin\n';
    withWritableOpenMutation(operation.destinationPath, () => fs.writeFileSync(operation.destinationPath, content), () => {
      const result = repair(value).results[0];
      assert.strictEqual(result.status, 'error');
      assert.match(result.error, /changed after preflight/i);
      assert.strictEqual(fs.readFileSync(operation.destinationPath, 'utf8'), content);
      assertPriorOwnership(value, operation.destinationPath);
    });
  }));
  test('repair completes historical deactivation with exact inert bytes and releases its lock', () => fixture(value => {
    const result = repair(value).results[0];
    assert.strictEqual(result.status, 'repaired', result.error);
    assert.strictEqual(result.stateRefreshed, true);
    assert.strictEqual(fs.readFileSync(path.join(value.targetRoot, 'plugins/ecc-hooks.ts'), 'utf8'),
      'export default async () => ({});\n');
    assert.deepStrictEqual(JSON.parse(fs.readFileSync(path.join(value.targetRoot, 'opencode.json'))),
      { plugin: [], userSetting: true });
    assert.strictEqual(fs.existsSync(`${value.installStatePath}.ecc.lock`), false);
  }));
  for (const consent of [null, 'declined']) {
    for (const plugin of [undefined, ['user-plugin']]) {
      test(`fresh ${consent || 'default'} apply preserves inactive user config ${JSON.stringify(plugin)}`, () => fixture(value => {
        fs.unlinkSync(value.installStatePath);
        fs.unlinkSync(path.join(value.targetRoot, 'plugins/ecc-hooks.ts'));
        const destination = path.join(value.targetRoot, 'opencode.json');
        const content = `${JSON.stringify({ userSetting: 'keep formatting', plugin }, null, 4)}\n`;
        fs.writeFileSync(destination, content);
        const result = applyInstallPlan(withHookConsent(value.basePlan, consent));
        assert.strictEqual(result.applied, true);
        assert.strictEqual(fs.readFileSync(destination, 'utf8'), content);
        assert.ok(result.warnings.includes(`Skipped user-owned file ${destination}: the existing file is not recorded in ECC install-state.`));
        assert.ok(result.skippedOperations.some(operation => operation.destinationPath === destination));
        for (const operations of [result.operations, readInstallState(value.installStatePath).operations]) {
          assert.ok(!operations.some(operation => operation.destinationPath === destination), 'Do not adopt a user config');
        }
        assert.strictEqual(fs.readFileSync(path.join(value.targetRoot, 'plugins/ecc-hooks.ts'), 'utf8'),
          'export default async () => ({});\n');
        assert.strictEqual(fs.existsSync(`${value.installStatePath}.ecc.lock`), false);
      }));
    }
    test(`fresh ${consent || 'default'} apply still refuses active unrecorded config`, () => fixture(value => {
      fs.unlinkSync(value.installStatePath);
      fs.unlinkSync(path.join(value.targetRoot, 'plugins/ecc-hooks.ts'));
      const destination = path.join(value.targetRoot, 'opencode.json');
      const content = fs.readFileSync(destination);
      assert.throws(() => applyInstallPlan(withHookConsent(value.basePlan, consent)), /Refusing OpenCode hook deactivation/);
      assert.deepStrictEqual(fs.readFileSync(destination), content);
      assert.strictEqual(fs.existsSync(path.join(value.targetRoot, 'plugins/ecc-hooks.ts')), false);
      assert.strictEqual(fs.existsSync(value.installStatePath), false);
      assert.strictEqual(fs.existsSync(`${value.installStatePath}.ecc.lock`), false);
    }));
    test(`fresh ${consent || 'default'} apply rechecks skipped user config after writes`, () => fixture(value => {
      fs.unlinkSync(value.installStatePath);
      const plugin = path.join(value.targetRoot, 'plugins/ecc-hooks.ts');
      fs.unlinkSync(plugin);
      const destination = path.join(value.targetRoot, 'opencode.json');
      fs.writeFileSync(destination, '{"userSetting":"initially inactive"}\n');
      const activated = '{"plugin":["./plugins"],"userSetting":"late edit"}\n';
      let injected = false;
      const stateWritePhases = [];
      assert.throws(() => applyInstallPlan(withHookConsent(value.basePlan, consent), {
        beforeInstallStateWrite() { stateWritePhases.push(injected); },
        beforeOperationWrite({ operation }) {
          if (operation.destinationPath === plugin) {
            injected = true;
            fs.writeFileSync(destination, activated);
          }
        },
      }), /OpenCode hook activation remains active/);
      assert.ok(injected, 'Exercise the write boundary after preserving the inactive config');
      assert.strictEqual(fs.readFileSync(destination, 'utf8'), activated);
      assert.ok(!stateWritePhases.includes(true), 'Do not reach final state persistence');
      // A retryable bridge may record the inert plugin already written, but
      // must never adopt the preserved user config after this refusal.
      const checkpoint = readInstallState(value.installStatePath);
      assert.deepStrictEqual(checkpoint.operations.map(operation => operation.destinationPath), [plugin]);
      assert.strictEqual(fs.readFileSync(plugin, 'utf8'), 'export default async () => ({});\n');
      assert.strictEqual(checkpoint.operations[0].contentSha256, sha256(fs.readFileSync(plugin)));
      assert.strictEqual(fs.existsSync(`${value.installStatePath}.ecc.lock`), false);
    }));
    test(`fresh ${consent || 'default'} apply preserves unrelated unrecorded plugin aliases`, () => fixture(value => {
      fs.unlinkSync(value.installStatePath);
      for (const operation of value.basePlan.operations) fs.unlinkSync(operation.destinationPath);
      const aliases = ['index.ts', 'index.js', 'index.mjs', 'index.cjs', 'ecc-hooks.js'];
      const content = 'export default async () => ({ "user.plugin": () => {} });\n';
      for (const alias of aliases) fs.writeFileSync(path.join(value.targetRoot, 'plugins', alias), content);
      const result = applyInstallPlan(withHookConsent(value.basePlan, consent));
      assert.strictEqual(result.applied, true);
      const state = readInstallState(value.installStatePath);
      for (const alias of aliases) {
        const destination = path.join(value.targetRoot, 'plugins', alias);
        assert.strictEqual(fs.readFileSync(destination, 'utf8'), content);
        assert.ok(!state.operations.some(operation => operation.destinationPath === destination), 'Do not adopt a user plugin');
      }
    }));
  }
  for (const missingDigest of [false, true]) {
    test(`apply refuses inactive managed config with ${missingDigest ? 'missing digest' : 'changed bytes'}`, () => fixture(value => {
      const destination = path.join(value.targetRoot, 'opencode.json');
      const content = '{"userSetting":"inactive managed edit"}\n';
      fs.writeFileSync(destination, content);
      if (missingDigest) {
        delete value.state.operations.find(operation => operation.destinationPath === destination).contentSha256;
        writeInstallState(value.installStatePath, value.state);
      }
      const stateBefore = fs.readFileSync(value.installStatePath);
      const plugin = path.join(value.targetRoot, 'plugins/ecc-hooks.ts');
      const pluginBefore = fs.readFileSync(plugin);
      assert.throws(() => applyInstallPlan(value.declinePlan), /Refusing OpenCode hook deactivation/);
      assert.strictEqual(fs.readFileSync(destination, 'utf8'), content);
      assert.deepStrictEqual(fs.readFileSync(value.installStatePath), stateBefore);
      assert.deepStrictEqual(fs.readFileSync(plugin), pluginBefore);
      assert.strictEqual(fs.existsSync(`${value.installStatePath}.ecc.lock`), false);
    }));
  }
  for (const missing of ['profile', 'module']) {
    for (const mode of ['doctor', 'repair']) {
      test(`${mode} reports missing ${missing} as a planning failure before any writes`, () => fixture(value => {
        value.state.request.legacyMode = false;
        value.state.request.profile = missing === 'profile' ? 'missing-fixture-profile' : null;
        value.state.request.modules = missing === 'module' ? ['missing-fixture-module'] : [];
        writeInstallState(value.installStatePath, value.state);
        const paths = [value.installStatePath, ...value.basePlan.operations.map(operation => operation.destinationPath)];
        const before = paths.map(file => fs.readFileSync(file));
        let buildCalls = 0;
        if (mode === 'doctor') {
          const result = buildDoctorReport({ repoRoot: value.sourceRoot, homeDir: value.homeDir,
            projectRoot: value.homeDir, targets: ['opencode'] }).results[0];
          assert.strictEqual(result.status, 'error');
          const planning = result.issues.filter(issue => issue.code === 'resolution-unavailable');
          assert.strictEqual(planning.length, 1, JSON.stringify(result.issues));
          assert.match(planning[0].message, new RegExp(`missing-fixture-${missing}`));
          assert.strictEqual(result.issues.filter(issue => issue.code === 'opencode-hook-consent-violation').length, 0);
        } else {
          const result = repair(value, { buildOpencodePayload() { buildCalls++; throw new Error('Unexpected build'); } }).results[0];
          assert.strictEqual(result.status, 'error');
          assert.match(result.error, new RegExp(`missing-fixture-${missing}`));
          assert.notStrictEqual(result.stateRefreshed, true);
        }
        assert.strictEqual(buildCalls, 0);
        paths.forEach((file, index) => assert.deepStrictEqual(fs.readFileSync(file), before[index]));
        assert.strictEqual(fs.existsSync(`${value.installStatePath}.ecc.lock`), false);
      }));
    }
  }
  test('doctor still identifies active declined activation as a consent violation', () => fixture(value => {
    value.state.request.hookConsent = 'declined';
    writeInstallState(value.installStatePath, value.state);
    const before = fs.readFileSync(value.installStatePath);
    const result = buildDoctorReport({ repoRoot: value.sourceRoot, homeDir: value.homeDir,
      projectRoot: value.homeDir, targets: ['opencode'] }).results[0];
    assert.strictEqual(result.status, 'error');
    assert.strictEqual(result.issues.filter(issue => issue.code === 'opencode-hook-consent-violation').length, 1);
    assert.strictEqual(result.issues.filter(issue => issue.code === 'resolution-unavailable').length, 0);
    assert.deepStrictEqual(fs.readFileSync(value.installStatePath), before);
  }));
  for (const mode of ['doctor', 'repair']) {
    test(`${mode} preserves an unrelated plugin without reporting ECC activation`, () => fixture(value => {
      applyInstallPlan(value.declinePlan);
      const destination = path.join(value.targetRoot, 'plugins', 'index.js');
      const content = 'export default async () => ({ "user.plugin": () => {} });\n';
      fs.writeFileSync(destination, content);
      const before = fs.readFileSync(value.installStatePath);
      if (mode === 'doctor') {
        const result = buildDoctorReport({ repoRoot: value.sourceRoot, homeDir: value.homeDir,
          projectRoot: value.homeDir, targets: ['opencode'] }).results[0];
        assert.ok(!result.issues.some(issue => issue.code === 'opencode-hook-consent-violation'), JSON.stringify(result.issues));
      } else {
        const result = repair(value).results[0];
        assert.notStrictEqual(result.status, 'error', result.error);
      }
      assert.strictEqual(fs.readFileSync(destination, 'utf8'), content);
      const { lastValidatedAt: _beforeValidation, ...priorState } = JSON.parse(before);
      const { lastValidatedAt: _afterValidation, ...afterState } = readInstallState(value.installStatePath);
      assert.deepStrictEqual(afterState, priorState, 'Only the legitimate validation timestamp may change');
      assert.ok(!afterState.operations.some(operation => operation.destinationPath === destination), 'Do not adopt a user plugin');
    }));
  }
  for (const legacy of legacyPluginFixtures) {
    for (const consent of [null, 'declined']) {
      test(`fresh ${consent || 'default'} apply refuses the unrecorded historical ${legacy.name}`, () => fixture(value => {
        assert.strictEqual(sha256(legacy.content), legacy.sha256, 'Preserve exact public-source fixture bytes');
        assert.notStrictEqual(sha256(fs.readFileSync(path.join(value.sourceRoot, '.opencode/plugins/ecc-hooks.ts'))), legacy.sha256);
        assert.notStrictEqual(sha256(fs.readFileSync(path.join(REPO_ROOT, '.opencode/plugins/index.ts'))), legacy.sha256);
        fs.unlinkSync(value.installStatePath);
        for (const operation of value.basePlan.operations) fs.unlinkSync(operation.destinationPath);
        const alias = path.join(value.targetRoot, 'plugins', 'index.js');
        assert.ok(!value.basePlan.operations.some(operation => operation.destinationPath === alias));
        fs.writeFileSync(alias, legacy.content);
        assert.throws(() => applyInstallPlan(withHookConsent(value.basePlan, consent)), /Refusing OpenCode hook deactivation/);
        assert.strictEqual(fs.readFileSync(alias, 'utf8'), legacy.content);
        assert.strictEqual(fs.existsSync(value.installStatePath), false, 'Do not adopt an unrecorded historical alias');
        for (const operation of value.basePlan.operations) assert.strictEqual(fs.existsSync(operation.destinationPath), false);
        assert.strictEqual(fs.existsSync(`${value.installStatePath}.ecc.lock`), false);
      }));
    }
    for (const mode of ['doctor', 'repair']) {
      test(`${mode} refuses the unrecorded historical ${legacy.name} without changing ownership`, () => fixture(value => {
        applyInstallPlan(value.declinePlan);
        const alias = path.join(value.targetRoot, 'plugins', 'index.js');
        fs.writeFileSync(alias, legacy.content);
        const before = fs.readFileSync(value.installStatePath);
        const operationsBefore = value.basePlan.operations.map(operation => fs.readFileSync(operation.destinationPath));
        assert.ok(!readInstallState(value.installStatePath).operations.some(operation => operation.destinationPath === alias));
        if (mode === 'doctor') {
          const result = buildDoctorReport({ repoRoot: value.sourceRoot, homeDir: value.homeDir,
            projectRoot: value.homeDir, targets: ['opencode'] }).results[0];
          const issue = result.issues.find(entry => entry.code === 'opencode-hook-consent-violation');
          assert.ok(issue, JSON.stringify(result.issues));
          assert.match(issue.message, /OpenCode hook activation remains active/);
        } else {
          const result = repair(value).results[0];
          assert.strictEqual(result.status, 'error');
          assert.match(result.error, /Refusing OpenCode hook deactivation/);
          assert.notStrictEqual(result.stateRefreshed, true);
        }
        assert.strictEqual(fs.readFileSync(alias, 'utf8'), legacy.content);
        assert.deepStrictEqual(fs.readFileSync(value.installStatePath), before);
        assert.deepStrictEqual(value.basePlan.operations.map(operation => fs.readFileSync(operation.destinationPath)), operationsBefore);
        assert.strictEqual(fs.existsSync(`${value.installStatePath}.ecc.lock`), false);
      }));
    }
  }
  for (const mode of ['apply', 'repair']) {
    test(`${mode} refuses a historical alias inserted after preflight before state refresh`, () => fixture(value => {
      const destination = path.join(value.targetRoot, 'plugins', 'ecc-hooks.ts');
      const alias = path.join(value.targetRoot, 'plugins', 'index.js');
      const content = legacyPluginFixtures[0].content;
      withWritableOpenMutation(destination, () => fs.writeFileSync(alias, content), () => {
        if (mode === 'apply') assert.throws(() => applyInstallPlan(value.declinePlan), /OpenCode hook activation remains active/);
        else {
          const result = repair(value).results[0];
          assert.strictEqual(result.status, 'error');
          assert.match(result.error, /OpenCode hook activation remains active/);
          assert.notStrictEqual(result.stateRefreshed, true);
        }
        assert.strictEqual(fs.readFileSync(alias, 'utf8'), content);
        const state = readInstallState(value.installStatePath);
        assert.ok(!state.operations.some(operation => operation.destinationPath === alias));
        assert.strictEqual(state.request.hookConsent, value.state.request.hookConsent);
        assert.strictEqual(fs.existsSync(`${value.installStatePath}.ecc.lock`), false);
      });
    }));
  }
  for (const consent of [null, 'declined', 'enabled']) {
    test(`nested JavaScript entrypoint applies with ${consent || 'default'} consent semantics`, () => fixture(value => {
      const sourceRelativePath = '.opencode/plugins/custom/index.js';
      const sourcePath = path.join(value.sourceRoot, sourceRelativePath);
      const destinationPath = path.join(value.targetRoot, 'plugins/custom/index.js');
      const content = 'export default async () => ({ event: () => {} });\n';
      fs.mkdirSync(path.dirname(sourcePath), { recursive: true });
      fs.writeFileSync(sourcePath, content);
      const operation = { kind: 'copy-file', moduleId: 'platform-configs', sourceRelativePath,
        sourcePath, destinationPath, ownership: 'managed', scaffoldOnly: false };
      const selectedModuleIds = consent === 'enabled' ? ['platform-configs', 'hooks-runtime'] : ['platform-configs'];
      const plan = withHookConsent({ ...value.basePlan, selectedModuleIds,
        operations: [...value.basePlan.operations, operation] }, consent);
      assert.strictEqual(applyInstallPlan(plan).applied, true);
      assert.strictEqual(fs.readFileSync(destinationPath, 'utf8'), consent === 'enabled'
        ? content : 'export default async () => ({});\n');
    }));
  }
  test('nested package metadata fails before writing and never receives a JavaScript tombstone', () => fixture(value => {
    const destinationPath = path.join(value.targetRoot, 'plugins/custom/package.json');
    const sourcePath = path.join(value.sourceRoot, '.opencode/plugins/custom/package.json');
    fs.mkdirSync(path.dirname(sourcePath), { recursive: true });
    fs.writeFileSync(sourcePath, '{"main":"index.js"}\n');
    const before = fs.readFileSync(value.installStatePath);
    const operation = { kind: 'copy-file', sourceRelativePath: '.opencode/plugins/custom/package.json',
      sourcePath, destinationPath, ownership: 'managed' };
    assert.throws(() => applyInstallPlan(withHookConsent({ ...value.basePlan,
      operations: [...value.basePlan.operations, operation] }, 'declined')), /unsupported.*package/i);
    assert.strictEqual(fs.existsSync(destinationPath), false);
    assert.deepStrictEqual(fs.readFileSync(value.installStatePath), before);
  }));
  for (const rootForm of ['relative', 'missing']) {
    for (const consent of [null, 'declined']) {
      test(`${rootForm} source root keeps historical refusal for fresh ${consent || 'default'} apply`, () => fixture(value => {
        const legacy = legacyPluginFixtures[0];
        assert.strictEqual(sha256(legacy.content), legacy.sha256);
        fs.unlinkSync(value.installStatePath);
        for (const operation of value.basePlan.operations) fs.unlinkSync(operation.destinationPath);
        const alias = path.join(value.targetRoot, 'plugins', 'index.js');
        fs.writeFileSync(alias, legacy.content);
        const sourceRoot = rootForm === 'relative'
          ? path.relative(process.cwd(), value.sourceRoot) : undefined;
        if (sourceRoot) assert.strictEqual(path.isAbsolute(sourceRoot), false);
        const plan = withHookConsent({ ...value.basePlan, sourceRoot }, consent);
        assert.throws(() => applyInstallPlan(plan), /Refusing OpenCode hook deactivation/);
        assert.strictEqual(fs.readFileSync(alias, 'utf8'), legacy.content);
        assert.strictEqual(fs.existsSync(value.installStatePath), false);
        for (const operation of value.basePlan.operations) assert.strictEqual(fs.existsSync(operation.destinationPath), false);
        assert.strictEqual(fs.existsSync(`${value.installStatePath}.ecc.lock`), false);
      }));
    }
  }
  for (const mode of ['doctor', 'repair']) {
    for (const historical of [true, false]) {
      test(`${mode} with relative repoRoot ${historical ? 'refuses historical ECC' : 'preserves unrelated user'} aliases`, () => fixture(value => {
        applyInstallPlan(value.declinePlan);
        const alias = path.join(value.targetRoot, 'plugins', 'index.js');
        const content = historical ? legacyPluginFixtures[0].content
          : 'export default async () => ({ "user.plugin": () => {} });\n';
        fs.writeFileSync(alias, content);
        const before = fs.readFileSync(value.installStatePath);
        const operationsBefore = value.basePlan.operations.map(operation => fs.readFileSync(operation.destinationPath));
        const repoRoot = path.relative(process.cwd(), value.sourceRoot);
        assert.strictEqual(path.isAbsolute(repoRoot), false);
        if (mode === 'doctor') {
          const result = buildDoctorReport({ repoRoot, homeDir: value.homeDir,
            projectRoot: value.homeDir, targets: ['opencode'] }).results[0];
          const issue = result.issues.find(entry => entry.code === 'opencode-hook-consent-violation');
          assert.strictEqual(Boolean(issue), historical, JSON.stringify(result.issues));
          if (historical) assert.match(issue.message, /OpenCode hook activation remains active/);
        } else {
          const result = repair(value, { repoRoot }).results[0];
          if (historical) {
            assert.strictEqual(result.status, 'error');
            assert.match(result.error, /Refusing OpenCode hook deactivation/);
            assert.notStrictEqual(result.stateRefreshed, true);
          } else assert.strictEqual(result.status, 'ok', result.error);
        }
        assert.strictEqual(fs.readFileSync(alias, 'utf8'), content);
        if (historical) assert.deepStrictEqual(fs.readFileSync(value.installStatePath), before);
        else {
          const { lastValidatedAt: _beforeValidation, ...priorState } = JSON.parse(before);
          const { lastValidatedAt: _afterValidation, ...afterState } = readInstallState(value.installStatePath);
          assert.deepStrictEqual(afterState, priorState, 'Only the validation timestamp may change');
        }
        assert.ok(!readInstallState(value.installStatePath).operations.some(operation => operation.destinationPath === alias));
        assert.deepStrictEqual(value.basePlan.operations.map(operation => fs.readFileSync(operation.destinationPath)), operationsBefore);
        assert.strictEqual(fs.existsSync(`${value.installStatePath}.ecc.lock`), false);
      }));
    }
  }
  for (const mode of ['apply', 'repair']) {
    test(`${mode} with relative root refuses a historical alias inserted after preflight`, () => fixture(value => {
      const alias = path.join(value.targetRoot, 'plugins', 'index.js');
      const content = legacyPluginFixtures[0].content;
      const repoRoot = path.relative(process.cwd(), value.sourceRoot);
      withWritableOpenMutation(path.join(value.targetRoot, 'plugins', 'ecc-hooks.ts'),
        () => fs.writeFileSync(alias, content), () => {
          if (mode === 'apply') {
            assert.throws(() => applyInstallPlan({ ...value.declinePlan, sourceRoot: repoRoot }),
              /OpenCode hook activation remains active/);
          } else {
            const result = repair(value, { repoRoot }).results[0];
            assert.strictEqual(result.status, 'error');
            assert.match(result.error, /OpenCode hook activation remains active/);
            assert.notStrictEqual(result.stateRefreshed, true);
          }
          assert.strictEqual(fs.readFileSync(alias, 'utf8'), content);
          const state = readInstallState(value.installStatePath);
          assert.ok(!state.operations.some(operation => operation.destinationPath === alias));
          assert.strictEqual(state.request.hookConsent, value.state.request.hookConsent);
          assert.strictEqual(fs.existsSync(`${value.installStatePath}.ecc.lock`), false);
        });
    }));
  }
  for (const artifact of ['source', 'build']) {
    test(`relative repoRoot attributes only trusted current ${artifact} bytes in doctor and repair`, () => fixture(value => {
      applyInstallPlan(value.declinePlan);
      const source = artifact === 'source'
        ? path.join(value.sourceRoot, '.opencode', 'plugins', 'ecc-hooks.ts')
        : path.join(value.sourceRoot, '.opencode', 'dist', 'plugins', 'index.js');
      if (artifact === 'build') fs.writeFileSync(source, 'module.exports = { eccHook: true };\n');
      const content = fs.readFileSync(source);
      const alias = path.join(value.targetRoot, 'plugins', 'index.js');
      fs.writeFileSync(alias, content);
      const before = fs.readFileSync(value.installStatePath);
      const operationsBefore = value.basePlan.operations.map(operation => fs.readFileSync(operation.destinationPath));
      const repoRoot = path.relative(process.cwd(), value.sourceRoot);
      assert.strictEqual(path.isAbsolute(repoRoot), false);
      const doctor = buildDoctorReport({ repoRoot, homeDir: value.homeDir,
        projectRoot: value.homeDir, targets: ['opencode'] }).results[0];
      assert.ok(doctor.issues.some(issue => issue.code === 'opencode-hook-consent-violation'), JSON.stringify(doctor.issues));
      const result = repair(value, { repoRoot }).results[0];
      assert.strictEqual(result.status, 'error');
      assert.match(result.error, /Refusing OpenCode hook deactivation/);
      assert.notStrictEqual(result.stateRefreshed, true);
      assert.deepStrictEqual(fs.readFileSync(alias), content);
      assert.deepStrictEqual(fs.readFileSync(value.installStatePath), before);
      assert.deepStrictEqual(value.basePlan.operations.map(operation => fs.readFileSync(operation.destinationPath)), operationsBefore);
      assert.strictEqual(fs.existsSync(`${value.installStatePath}.ecc.lock`), false);
    }));
  }
  for (const mode of ['doctor', 'repair']) {
    test(`${mode} still rejects unsupported explicit repoRoot types`, () => fixture(value => {
      for (const repoRoot of [{}, true, 1]) {
        const invoke = mode === 'doctor'
          ? () => buildDoctorReport({ repoRoot, homeDir: value.homeDir,
            projectRoot: value.homeDir, targets: ['opencode'] })
          : () => repair(value, { repoRoot });
        assert.throws(invoke, error => error instanceof TypeError && error.code === 'ERR_INVALID_ARG_TYPE');
      }
    }));
  }
  for (const artifact of ['source', 'build']) {
    test(`unrecorded ${artifact}-identical ECC alias still fails closed`, () => fixture(value => {
      applyInstallPlan(value.declinePlan);
      const source = artifact === 'source'
        ? path.join(value.sourceRoot, '.opencode', 'plugins', 'ecc-hooks.ts')
        : path.join(value.sourceRoot, '.opencode', 'dist', 'plugins', 'index.js');
      if (artifact === 'build') fs.writeFileSync(source, 'module.exports = { eccHook: true };\n');
      const content = fs.readFileSync(source);
      const alias = path.join(value.targetRoot, 'plugins', 'index.js');
      fs.writeFileSync(alias, content);
      const before = fs.readFileSync(value.installStatePath);
      assert.throws(() => applyInstallPlan(value.declinePlan), /OpenCode hook deactivation/);
      const doctor = buildDoctorReport({ repoRoot: value.sourceRoot, homeDir: value.homeDir,
        projectRoot: value.homeDir, targets: ['opencode'] }).results[0];
      assert.ok(doctor.issues.some(issue => issue.code === 'opencode-hook-consent-violation'));
      assert.strictEqual(repair(value).results[0].status, 'error');
      assert.deepStrictEqual(fs.readFileSync(alias), content);
      assert.deepStrictEqual(fs.readFileSync(value.installStatePath), before);
    }));
  }
  test('an unrecorded collision at a planned ECC plugin destination still fails closed', () => fixture(value => {
    fs.unlinkSync(value.installStatePath);
    fs.unlinkSync(path.join(value.targetRoot, 'opencode.json'));
    const destination = path.join(value.targetRoot, 'plugins', 'ecc-hooks.ts');
    const content = '// user-owned file at an ECC destination\n';
    fs.writeFileSync(destination, content);
    assert.throws(() => applyInstallPlan(value.declinePlan), /user-owned|unverifiable/i);
    assert.strictEqual(fs.readFileSync(destination, 'utf8'), content);
    assert.strictEqual(fs.existsSync(value.installStatePath), false);
  }));
  for (const planned of [false, true]) {
    test(`${planned ? 'planned ECC' : 'unrecorded user'} plugin read failures respect the attribution boundary`, () => fixture(value => {
      const destination = path.join(value.targetRoot, 'plugins', planned ? 'ecc-hooks.ts' : 'index.js');
      const content = planned ? fs.readFileSync(destination) : Buffer.from('// unreadable user plugin\n');
      if (!planned) fs.writeFileSync(destination, content);
      const originalOpen = fileSystem.openSync;
      let refusedReads = 0;
      fileSystem.openSync = function (candidate, ...args) {
        if (typeof candidate === 'string' && path.resolve(candidate) === destination) {
          refusedReads++;
          throw Object.assign(new Error('Synthetic plugin read permission denied'), { code: 'EACCES' });
        }
        return originalOpen.call(fs, candidate, ...args);
      };
      try {
        if (planned) assert.throws(() => applyInstallPlan(value.declinePlan), /permission denied/);
        else assert.strictEqual(applyInstallPlan(value.declinePlan).applied, true);
        assert.ok(refusedReads > 0, 'The permission boundary must be exercised');
      } finally {
        fileSystem.openSync = originalOpen;
      }
      assert.deepStrictEqual(fs.readFileSync(destination), content);
      if (!planned) assert.ok(!readInstallState(value.installStatePath).operations.some(operation => operation.destinationPath === destination));
    }));
  }
  test('repair preserves the primary failure and replacement lock when release also fails', () => fixture(value => {
    const destination = path.join(value.targetRoot, 'opencode.json');
    const lock = `${value.installStatePath}.ecc.lock`;
    withWritableOpenMutation(destination, () => {
      fs.writeFileSync(destination, '{"userEdit":true}');
      fs.renameSync(lock, `${lock}.owned`);
      fs.writeFileSync(lock, 'replacement lock');
    }, () => {
      const result = repair(value).results[0];
      assert.strictEqual(result.status, 'error');
      assert.match(result.error, /changed after preflight/i);
      assert.match(result.releaseError, /changed OpenCode install lock/);
      assert.strictEqual(fs.readFileSync(lock, 'utf8'), 'replacement lock');
      assertPriorOwnership(value, destination);
    });
  }));
  console.log(`\nResults: Passed: ${passed}, Failed: ${failed}`);
  return { passed, failed };
}

if (require.main === module) process.exitCode = runTests().failed ? 1 : 0;
module.exports = { runTests };
