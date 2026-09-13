'use strict';

const assert = require('assert');
const crypto = require('crypto');
const fs = require('fs');
const os = require('os');
const path = require('path');
const { spawnSync } = require('child_process');

const { applyInstallPlan } = require('../../scripts/lib/install/apply');
const { createInstallPlanFromRequest } = require('../../scripts/lib/install/runtime');
const { readInstallState } = require('../../scripts/lib/install-state');
const { buildDoctorReport, repairInstalledStates, uninstallInstalledStates } = require('../../scripts/lib/install-lifecycle');

const repoRoot = path.join(__dirname, '..', '..');
let passed = 0;
let failed = 0;

function test(name, fn) {
  try {
    fn();
    console.log(`  ✓ ${name}`);
    passed++;
  } catch (error) {
    console.log(`  ✗ ${name}`);
    console.log(`    Error: ${error.message}`);
    failed++;
  }
}

function createProject(prefix) {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), prefix));
  return { root, home: fs.mkdtempSync(path.join(os.tmpdir(), `${prefix}home-`)) };
}

function cleanup(fixture) {
  fs.rmSync(fixture.root, { recursive: true, force: true });
  fs.rmSync(fixture.home, { recursive: true, force: true });
}

function request(hookConsent) {
  return {
    mode: 'manifest',
    target: 'antigravity',
    profileId: 'core',
    moduleIds: [],
    includeComponentIds: [],
    excludeComponentIds: [],
    legacyLanguages: [],
    hookConsent,
  };
}

function plan(fixture, hookConsent) {
  return createInstallPlanFromRequest(request(hookConsent), {
    sourceRoot: repoRoot,
    projectRoot: fixture.root,
    homeDir: fixture.home,
    env: { HOME: fixture.home, USERPROFILE: fixture.home },
  });
}

function readJson(filePath) {
  return JSON.parse(fs.readFileSync(filePath, 'utf8'));
}

console.log('\n=== Antigravity hook lifecycle tests ===\n');

test('install, doctor, repair, and uninstall preserve user hook groups', () => {
  const fixture = createProject('ecc-antigravity-lifecycle-');
  const hooksPath = path.join(fixture.root, '.agents', 'hooks.json');
  const statePath = path.join(fixture.root, '.agents', 'ecc-install-state.json');
  try {
    fs.mkdirSync(path.dirname(hooksPath), { recursive: true });
    fs.writeFileSync(hooksPath, `${JSON.stringify({
      'user-linter': { PostToolUse: [{ matcher: '*', hooks: [{ command: './lint.sh' }] }] },
    }, null, 2)}\n`);

    applyInstallPlan(plan(fixture, 'enabled'));
    const installed = readJson(hooksPath);
    assert.ok(installed['user-linter']);
    assert.ok(installed['ecc-security-guard']);
    assert.strictEqual(buildDoctorReport({
      repoRoot, projectRoot: fixture.root, homeDir: fixture.home, targets: ['antigravity'],
    }).results[0].status, 'ok');
    const installedAdapter = path.join(
      fixture.root, '.agents', 'ecc-hooks', 'hooks', 'antigravity-security.js'
    );
    const blocked = spawnSync(process.execPath, [installedAdapter], {
      cwd: fixture.root,
      input: JSON.stringify({
        toolCall: { name: 'run_command', args: { CommandLine: 'git push --no-verify' } },
        conversationId: 'installed-adapter-test',
        workspacePaths: [fixture.root],
      }),
      encoding: 'utf8',
      env: {
        ...process.env,
        ECC_HOOKS_ENABLED: '1',
        ECC_HOOK_PROFILE: 'standard',
        ECC_DISABLED_HOOKS: '',
        GATEGUARD_BASH_ROUTINE_DISABLED: '1',
      },
    });
    assert.strictEqual(blocked.status, 0, blocked.stderr);
    assert.strictEqual(JSON.parse(blocked.stdout).decision, 'deny');

    delete installed['ecc-security-guard'];
    fs.writeFileSync(hooksPath, `${JSON.stringify(installed, null, 2)}\n`);
    fs.unlinkSync(installedAdapter);
    assert.strictEqual(buildDoctorReport({
      repoRoot, projectRoot: fixture.root, homeDir: fixture.home, targets: ['antigravity'],
    }).results[0].status, 'error');

    const repaired = repairInstalledStates({
      repoRoot, projectRoot: fixture.root, homeDir: fixture.home, targets: ['antigravity'],
    });
    assert.strictEqual(repaired.results[0].status, 'repaired');
    assert.ok(fs.existsSync(installedAdapter));
    assert.ok(!Object.hasOwn(readJson(hooksPath)['ecc-security-guard'], 'enabled'));
    assert.ok(readJson(hooksPath)['user-linter']);

    const uninstalled = uninstallInstalledStates({
      repoRoot, projectRoot: fixture.root, homeDir: fixture.home, targets: ['antigravity'],
    });
    assert.strictEqual(uninstalled.results[0].status, 'uninstalled');
    assert.deepStrictEqual(readJson(hooksPath), {
      'user-linter': { PostToolUse: [{ matcher: '*', hooks: [{ command: './lint.sh' }] }] },
    });
    assert.ok(!fs.existsSync(path.join(fixture.root, '.agents', 'ecc-hooks')));
    assert.ok(!fs.existsSync(statePath));
  } finally {
    cleanup(fixture);
  }
});

test('--no-hooks removes the managed hook and runtime while preserving user hooks', () => {
  const fixture = createProject('ecc-antigravity-disable-');
  const hooksPath = path.join(fixture.root, '.agents', 'hooks.json');
  try {
    fs.mkdirSync(path.dirname(hooksPath), { recursive: true });
    fs.writeFileSync(hooksPath, `${JSON.stringify({
      'user-linter': { PostToolUse: [{ matcher: '*', hooks: [{ command: './lint.sh' }] }] },
    }, null, 2)}\n`);
    applyInstallPlan(plan(fixture, 'enabled'));
    applyInstallPlan(plan(fixture, 'declined'));

    assert.deepStrictEqual(readJson(hooksPath), {
      'user-linter': { PostToolUse: [{ matcher: '*', hooks: [{ command: './lint.sh' }] }] },
    });
    assert.ok(!fs.existsSync(path.join(fixture.root, '.agents', 'ecc-hooks')));
    const state = readInstallState(path.join(fixture.root, '.agents', 'ecc-install-state.json'));
    assert.strictEqual(state.request.hookConsent, 'declined');
    assert.ok(!state.resolution.selectedModules.includes('hooks-runtime'));
    assert.ok(!state.operations.some(operation => operation.moduleId === 'hooks-runtime'));
  } finally {
    cleanup(fixture);
  }
});

test('runtime conflicts fail before registering Antigravity hooks', () => {
  const fixture = createProject('ecc-antigravity-conflict-');
  const runtimePath = path.join(
    fixture.root, '.agents', 'ecc-hooks', 'hooks', 'block-no-verify.js'
  );
  try {
    fs.mkdirSync(path.dirname(runtimePath), { recursive: true });
    fs.writeFileSync(runtimePath, 'user owned\n');
    assert.throws(() => applyInstallPlan(plan(fixture, 'enabled')), /runtime destination is user-owned/);
    assert.strictEqual(fs.readFileSync(runtimePath, 'utf8'), 'user owned\n');
    assert.ok(!fs.existsSync(path.join(fixture.root, '.agents', 'hooks.json')));
  } finally {
    cleanup(fixture);
  }
});

test('install rejects a symlinked native hooks destination', () => {
  if (process.platform === 'win32') return;
  const fixture = createProject('ecc-antigravity-symlink-');
  const victimPath = path.join(fixture.root, 'victim.json');
  const hooksPath = path.join(fixture.root, '.agents', 'hooks.json');
  try {
    fs.mkdirSync(path.dirname(hooksPath), { recursive: true });
    fs.writeFileSync(victimPath, '{"sentinel":true}\n');
    fs.symlinkSync(victimPath, hooksPath);
    assert.throws(
      () => applyInstallPlan(plan(fixture, 'enabled')),
      /symbolic link|symlink/i
    );
    assert.deepStrictEqual(readJson(victimPath), { sentinel: true });
  } finally {
    cleanup(fixture);
  }
});

test('runtime copy does not follow a final symlink swapped in before rename', () => {
  if (process.platform === 'win32') return;
  const fixture = createProject('ecc-antigravity-copy-symlink-');
  const runtimePath = path.join(
    fixture.root, '.agents', 'ecc-hooks', 'hooks', 'antigravity-security.js'
  );
  const victimPath = path.join(fixture.root, 'victim.js');
  let swapped = false;
  try {
    fs.writeFileSync(victimPath, 'sentinel\n');
    assert.throws(() => applyInstallPlan(plan(fixture, 'enabled'), {
      beforeCopyRename({ operation }) {
        if (swapped || operation.destinationPath !== runtimePath) return;
        swapped = true;
        fs.symlinkSync(victimPath, runtimePath);
      },
    }), /symlink/i);
    assert.strictEqual(fs.readFileSync(victimPath, 'utf8'), 'sentinel\n');
  } finally {
    cleanup(fixture);
  }
});

test('a user-owned ECC hook group fails before writing runtime files', () => {
  const fixture = createProject('ecc-antigravity-group-conflict-');
  const hooksPath = path.join(fixture.root, '.agents', 'hooks.json');
  try {
    fs.mkdirSync(path.dirname(hooksPath), { recursive: true });
    fs.writeFileSync(hooksPath, `${JSON.stringify({
      'ecc-security-guard': { enabled: false },
    }, null, 2)}\n`);
    assert.throws(
      () => applyInstallPlan(plan(fixture, 'enabled')),
      /Refusing to overwrite Antigravity hook group/
    );
    assert.ok(!fs.existsSync(path.join(fixture.root, '.agents', 'ecc-hooks')));
    assert.deepStrictEqual(readJson(hooksPath), { 'ecc-security-guard': { enabled: false } });
  } finally {
    cleanup(fixture);
  }
});

test('failed hook registration does not record ownership of a user hook group', () => {
  const fixture = createProject('ecc-antigravity-group-checkpoint-');
  const hooksPath = path.join(fixture.root, '.agents', 'hooks.json');
  const statePath = path.join(fixture.root, '.agents', 'ecc-install-state.json');
  try {
    fs.mkdirSync(path.dirname(hooksPath), { recursive: true });
    fs.writeFileSync(hooksPath, `${JSON.stringify({
      'ecc-security-guard': { enabled: false },
    }, null, 2)}\n`);
    assert.throws(
      () => applyInstallPlan(plan(fixture, 'enabled')),
      /Refusing to overwrite Antigravity hook group/
    );
    if (fs.existsSync(statePath)) {
      const state = readInstallState(statePath);
      assert.ok(!state.operations.some(operation => (
        operation.kind === 'update-antigravity-hooks'
      )));
    }
  } finally {
    cleanup(fixture);
  }
});

test('runtime drift removes the hook registration before retaining the modified file', () => {
  const fixture = createProject('ecc-antigravity-runtime-drift-');
  const hooksPath = path.join(fixture.root, '.agents', 'hooks.json');
  const runtimePath = path.join(
    fixture.root, '.agents', 'ecc-hooks', 'hooks', 'antigravity-security.js'
  );
  try {
    applyInstallPlan(plan(fixture, 'enabled'));
    fs.appendFileSync(runtimePath, '\n// user modification\n');
    const result = uninstallInstalledStates({
      repoRoot, projectRoot: fixture.root, homeDir: fixture.home, targets: ['antigravity'],
    });
    assert.strictEqual(result.results[0].status, 'partial');
    assert.ok(!Object.hasOwn(readJson(hooksPath), 'ecc-security-guard'));
    assert.ok(fs.existsSync(runtimePath));
    assert.ok(fs.existsSync(path.join(fixture.root, '.agents', 'ecc-install-state.json')));
  } finally {
    cleanup(fixture);
  }
});

test('--no-hooks refuses a replaced runtime before unregistering the hook', () => {
  if (process.platform === 'win32') return;
  const fixture = createProject('ecc-antigravity-disable-symlink-');
  const hooksPath = path.join(fixture.root, '.agents', 'hooks.json');
  const runtimePath = path.join(
    fixture.root, '.agents', 'ecc-hooks', 'hooks', 'antigravity-security.js'
  );
  const victimPath = path.join(fixture.root, 'victim.js');
  try {
    applyInstallPlan(plan(fixture, 'enabled'));
    fs.writeFileSync(victimPath, 'sentinel\n');
    fs.unlinkSync(runtimePath);
    fs.symlinkSync(victimPath, runtimePath);

    assert.throws(
      () => applyInstallPlan(plan(fixture, 'declined')),
      /unsafe managed hook runtime/
    );
    assert.ok(readJson(hooksPath)['ecc-security-guard']);
    assert.strictEqual(fs.readFileSync(victimPath, 'utf8'), 'sentinel\n');
  } finally {
    cleanup(fixture);
  }
});

test('uninstall retains the runtime when the managed hook group drifted', () => {
  const fixture = createProject('ecc-antigravity-drift-');
  const hooksPath = path.join(fixture.root, '.agents', 'hooks.json');
  try {
    applyInstallPlan(plan(fixture, 'enabled'));
    const config = readJson(hooksPath);
    config['ecc-security-guard'].enabled = false;
    fs.writeFileSync(hooksPath, `${JSON.stringify(config, null, 2)}\n`);

    const result = uninstallInstalledStates({
      repoRoot, projectRoot: fixture.root, homeDir: fixture.home, targets: ['antigravity'],
    });
    assert.strictEqual(result.results[0].status, 'partial');
    assert.ok(fs.existsSync(path.join(fixture.root, '.agents', 'ecc-hooks', 'hooks', 'antigravity-security.js')));
    assert.ok(fs.existsSync(path.join(fixture.root, '.agents', 'ecc-install-state.json')));
  } finally {
    cleanup(fixture);
  }
});

test('uninstall rejects forged managed hook group provenance', () => {
  const fixture = createProject('ecc-antigravity-forged-group-');
  const hooksPath = path.join(fixture.root, '.agents', 'hooks.json');
  const statePath = path.join(fixture.root, '.agents', 'ecc-install-state.json');
  const forgedGroup = {
    PreToolUse: [{
      matcher: 'run_command',
      hooks: [{ type: 'command', command: 'node user-owned-hook.js' }],
    }],
  };
  try {
    applyInstallPlan(plan(fixture, 'enabled'));
    const config = readJson(hooksPath);
    config['ecc-security-guard'] = forgedGroup;
    fs.writeFileSync(hooksPath, `${JSON.stringify(config, null, 2)}\n`);
    const state = readJson(statePath);
    state.operations.find(operation => operation.kind === 'update-antigravity-hooks')
      .managedHookGroups['ecc-security-guard'] = forgedGroup;
    fs.writeFileSync(statePath, `${JSON.stringify(state, null, 2)}\n`);

    const result = uninstallInstalledStates({
      repoRoot, projectRoot: fixture.root, homeDir: fixture.home, targets: ['antigravity'],
    });
    assert.strictEqual(result.results[0].status, 'partial');
    assert.deepStrictEqual(readJson(hooksPath)['ecc-security-guard'], forgedGroup);
    assert.ok(fs.existsSync(statePath));
  } finally {
    cleanup(fixture);
  }
});

test('uninstall rejects a forged runtime digest that does not match the trusted release', () => {
  const fixture = createProject('ecc-antigravity-forged-runtime-');
  const statePath = path.join(fixture.root, '.agents', 'ecc-install-state.json');
  const runtimePath = path.join(
    fixture.root, '.agents', 'ecc-hooks', 'hooks', 'antigravity-security.js'
  );
  try {
    applyInstallPlan(plan(fixture, 'enabled'));
    fs.writeFileSync(runtimePath, 'user-important-content\n');
    const state = readJson(statePath);
    state.operations.find(operation => operation.destinationPath === runtimePath).contentSha256 =
      crypto.createHash('sha256').update(fs.readFileSync(runtimePath)).digest('hex');
    fs.writeFileSync(statePath, `${JSON.stringify(state, null, 2)}\n`);

    const result = uninstallInstalledStates({
      repoRoot, projectRoot: fixture.root, homeDir: fixture.home, targets: ['antigravity'],
    });
    assert.strictEqual(result.results[0].status, 'partial');
    assert.strictEqual(fs.readFileSync(runtimePath, 'utf8'), 'user-important-content\n');
    assert.ok(fs.existsSync(statePath));
  } finally {
    cleanup(fixture);
  }
});

test('legacy Antigravity state repair does not silently enable hooks', () => {
  const fixture = createProject('ecc-antigravity-upgrade-');
  try {
    const minimalPlan = createInstallPlanFromRequest({ ...request(null), profileId: 'minimal' }, {
      sourceRoot: repoRoot,
      projectRoot: fixture.root,
      homeDir: fixture.home,
      env: { HOME: fixture.home, USERPROFILE: fixture.home },
    });
    applyInstallPlan(minimalPlan);
    const statePath = path.join(fixture.root, '.agents', 'ecc-install-state.json');
    const state = readJson(statePath);
    state.request.profile = 'core';
    state.request.modules = ['hooks-runtime'];
    state.request.hookConsent = null;
    state.resolution.skippedModules = ['hooks-runtime'];
    fs.writeFileSync(statePath, `${JSON.stringify(state, null, 2)}\n`);

    const result = repairInstalledStates({
      repoRoot, projectRoot: fixture.root, homeDir: fixture.home, targets: ['antigravity'],
    });
    assert.notStrictEqual(result.results[0].status, 'error');
    assert.ok(!fs.existsSync(path.join(fixture.root, '.agents', 'hooks.json')));
    assert.ok(!fs.existsSync(path.join(fixture.root, '.agents', 'ecc-hooks')));
  } finally {
    cleanup(fixture);
  }
});

console.log(`\nPassed: ${passed}`);
console.log(`Failed: ${failed}`);
process.exit(failed > 0 ? 1 : 0);
