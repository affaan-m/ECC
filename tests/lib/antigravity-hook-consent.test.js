'use strict';

const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { spawnSync } = require('node:child_process');
const { test } = require('node:test');
const { createManifestInstallPlan } = require('../../scripts/lib/install/plan');
const { applyInstallPlan, previewInstallPlan } = require('../../scripts/lib/install/apply');
const { readInstallState } = require('../../scripts/lib/install-state');
const { withHookConsent } = require('../../scripts/lib/install/hook-consent');

for (const target of ['antigravity', 'antigravity-home']) {
  for (const legacy of [false, true]) {
    test(`${target} revokes ${legacy ? 'legacy' : 'current'} hooks and can re-enable them`, () => {
      const root = fs.mkdtempSync(path.join(os.tmpdir(), 'ecc-hook-consent-'));
      try {
        const options = { moduleIds: ['hooks-runtime'], target, homeDir: root, projectRoot: root };
        const enabled = withHookConsent(createManifestInstallPlan(options), 'enabled');
        applyInstallPlan(enabled);
        const hooksPath = path.join(enabled.targetRoot, 'hooks.json');
        const setupPath = path.join(enabled.targetRoot, 'ecc', 'setup.json');
        const bridgePath = path.join(enabled.targetRoot, 'scripts', 'hooks', 'antigravity-hook-bridge.js');
        const marker = path.join(root, 'hook-ran');
        // Simulate an already installed bridge that predates managed flag support.
        if (legacy) {
          fs.rmSync(setupPath);
          fs.writeFileSync(bridgePath, `require('node:fs').writeFileSync(${JSON.stringify(marker)}, 'ran');`);
        }
        const config = JSON.parse(fs.readFileSync(hooksPath, 'utf8'));
        const userHook = { Stop: [{ type: 'command', command: 'user-selected-hook' }] };
        fs.writeFileSync(hooksPath, JSON.stringify({ ...config, 'user-hook': userHook }));
        const declinePlan = withHookConsent(createManifestInstallPlan(options), 'declined');
        const beforePreview = fs.readFileSync(hooksPath, 'utf8');
        const preview = previewInstallPlan(declinePlan);
        assert.ok(preview.operations.some(operation => operation.kind === 'remove-antigravity-hooks'));
        assert.ok(preview.warnings.some(warning => /disabl.*Antigravity hooks/i.test(warning)));
        assert.equal(fs.readFileSync(hooksPath, 'utf8'), beforePreview);
        applyInstallPlan(declinePlan);
        const declined = JSON.parse(fs.readFileSync(hooksPath, 'utf8'));
        assert.deepEqual(declined['user-hook'], userHook);
        for (const handler of declined['ecc-guard']?.PostToolUse || []) {
          for (const hook of handler.hooks || []) {
            const result = spawnSync(hook.command, {
              shell: true, cwd: root, encoding: 'utf8',
              input: JSON.stringify({ toolCall: { name: 'write_to_file', args: { TargetFile: path.join(root, 'file.js') } } }),
            });
            assert.equal(result.status, 0, result.stderr);
          }
        }
        assert.equal(fs.existsSync(marker), false, 'Declined legacy hook must not execute');
        assert.equal(Object.hasOwn(declined, 'ecc-guard'), false);
        assert.equal(JSON.parse(fs.readFileSync(setupPath, 'utf8')).hooks.enabled, false);
        assert.equal(readInstallState(enabled.installStatePath).request.hookConsent, 'declined');
        applyInstallPlan(withHookConsent(createManifestInstallPlan(options), 'declined'));
        assert.deepEqual(JSON.parse(fs.readFileSync(hooksPath, 'utf8'))['user-hook'], userHook);
        applyInstallPlan(withHookConsent(createManifestInstallPlan(options), 'enabled'));
        assert.ok(JSON.parse(fs.readFileSync(hooksPath, 'utf8'))['ecc-guard']);
        assert.equal(JSON.parse(fs.readFileSync(setupPath, 'utf8')).hooks.enabled, true);
      } finally {
        fs.rmSync(root, { recursive: true, force: true });
      }
    });
  }

  for (const unsafe of ['modified-hooks', 'symlinked-setup', 'swapped-setup']) {
    test(`${target} refuses ${unsafe} before recording declined consent`, {
      skip: process.platform === 'win32' && unsafe !== 'modified-hooks'
        ? 'Creating file symlinks requires Windows developer mode or elevation' : false,
    }, () => {
      const root = fs.mkdtempSync(path.join(os.tmpdir(), 'ecc-unsafe-revocation-'));
      try {
        const options = { moduleIds: ['hooks-runtime'], target, homeDir: root, projectRoot: root };
        const enabled = withHookConsent(createManifestInstallPlan(options), 'enabled');
        applyInstallPlan(enabled);
        const hooksPath = path.join(enabled.targetRoot, 'hooks.json');
        const setupPath = path.join(enabled.targetRoot, 'ecc', 'setup.json');
        const original = fs.readFileSync(hooksPath, 'utf8');
        if (unsafe === 'modified-hooks') {
          const hooks = JSON.parse(original);
          fs.writeFileSync(hooksPath, JSON.stringify({
            ...hooks, 'ecc-guard': { ...hooks['ecc-guard'], Stop: [{ command: 'user-customized-hook' }] },
          }));
        } else if (unsafe === 'symlinked-setup') {
          fs.rmSync(setupPath);
          fs.symlinkSync(path.join(root, 'outside.json'), setupPath);
        }
        const before = fs.readFileSync(hooksPath, 'utf8');
        assert.throws(() => applyInstallPlan(withHookConsent(createManifestInstallPlan(options), 'declined'), {
          beforeOperationWrite({ operation }) {
            if (unsafe === 'swapped-setup' && operation.destinationPath === setupPath) {
              fs.rmSync(setupPath);
              fs.symlinkSync(path.join(root, 'outside.json'), setupPath);
            }
          },
        }),
          /modified Antigravity hooks|symlink|outside the install root/i);
        if (unsafe !== 'swapped-setup') assert.equal(fs.readFileSync(hooksPath, 'utf8'), before);
        assert.equal(fs.existsSync(path.join(root, 'outside.json')), false);
        assert.equal(JSON.parse(fs.readFileSync(enabled.installStatePath, 'utf8')).request.hookConsent, 'enabled');
      } finally {
        fs.rmSync(root, { recursive: true, force: true });
      }
    });
  }

  test(`${target} fresh declined installation creates no hook runtime`, () => {
    const root = fs.mkdtempSync(path.join(os.tmpdir(), 'ecc-fresh-declined-'));
    try {
      const plan = withHookConsent(createManifestInstallPlan({ moduleIds: ['hooks-runtime'], target, homeDir: root, projectRoot: root }), 'declined');
      applyInstallPlan(plan);
      assert.equal(fs.existsSync(path.join(plan.targetRoot, 'hooks.json')), false);
      assert.equal(fs.existsSync(path.join(plan.targetRoot, 'ecc', 'setup.json')), false);
      assert.equal(fs.existsSync(path.join(plan.targetRoot, 'scripts', 'hooks')), false);
    } finally {
      fs.rmSync(root, { recursive: true, force: true });
    }
  });

  test(`${target} failed deactivation does not record declined consent`, () => {
    const root = fs.mkdtempSync(path.join(os.tmpdir(), 'ecc-decline-failure-'));
    try {
      const options = { moduleIds: ['hooks-runtime'], target, homeDir: root, projectRoot: root };
      const enabled = withHookConsent(createManifestInstallPlan(options), 'enabled');
      applyInstallPlan(enabled);
      const declined = withHookConsent(createManifestInstallPlan(options), 'declined');
      assert.throws(() => applyInstallPlan(declined, {
        beforeOperationWrite({ operation }) {
          if (operation.destinationPath === path.join(enabled.targetRoot, 'ecc', 'setup.json')) {
            throw new Error('injected setup write failure');
          }
        },
      }), /injected setup write failure/);
      assert.equal(readInstallState(enabled.installStatePath).request.hookConsent, 'enabled');
      applyInstallPlan(declined);
      assert.equal(readInstallState(enabled.installStatePath).request.hookConsent, 'declined');
    } finally {
      fs.rmSync(root, { recursive: true, force: true });
    }
  });
}
