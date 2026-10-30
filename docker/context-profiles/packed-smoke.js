#!/usr/bin/env node
'use strict';

const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { spawnSync } = require('node:child_process');
const { planContextCarrier } = require('../../scripts/lib/context-carriers');
const { compileContextProfile } = require('../../scripts/lib/context-profiles');
const { withCarrierFixture } = require('../../tests/lib/helpers/context-carrier-fixture');

const repoRoot = path.resolve(__dirname, '../..');
const temp = fs.realpathSync(fs.mkdtempSync(path.join(os.tmpdir(), 'ecc-packed-context-')));
const expectedSource = process.env.ECC_EXPECTED_CARRIERS
  ? JSON.parse(fs.readFileSync(process.env.ECC_EXPECTED_CARRIERS, 'utf8')) : null;

function profileCommand(args, temp, env, expectedStatus = 0) {
  const result = spawnSync(process.execPath, [path.join(repoRoot, 'scripts/ecc.js'), 'profile', ...args, '--json'], {
    cwd: temp, env, encoding: 'utf8', timeout: 60000, maxBuffer: 16 * 1024 * 1024,
  });
  assert.equal(result.status, expectedStatus, result.stderr || result.stdout);
  return JSON.parse(result.stdout);
}

function managedJourney(temp, env) {
  const stateRoot = path.join(temp, 'managed');
  const command = (args, status) => profileCommand(args, temp, env, status);
  const store = (args, status) => command([...args, '--state-root', stateRoot], status);
  assert.equal(store(['status']).store.status, 'unconfigured');
  const preview = store(['set', 'full', '--dry-run']);
  assert.equal(preview.store.proposedProfileId, 'full@1');
  assert.equal(fs.existsSync(stateRoot), false);
  const full = store(['set', 'full', '--exclude', 'skill:python-patterns', '--expected-revision', '0']).store;
  assert.equal(full.profileId, 'full@1');
  assert.equal(full.active, false);
  assert.equal(full.revision, 1);
  assert.equal(full.selectedIds.includes('skill:python-patterns'), false);
  const lean = store(['set', 'lean', '--selection', 'auto', '--expected-revision', '1']).store;
  assert.equal(lean.revision, 2);
  assert.equal(lean.profileId, 'lean@1');
  assert.equal(lean.selectedIds.length, 3);
  assert.ok(fs.existsSync(path.join(lean.generationRoot, '.codex-plugin/plugin.json')));
  const restored = store(['rollback', '--expected-revision', '2']).store;
  assert.equal(restored.revision, 3);
  assert.equal(restored.carrierDigest, full.carrierDigest);
  const repeated = store(['set', 'full', '--exclude', 'skill:python-patterns']).store;
  assert.equal(repeated.revision, 3, 'Repeated configuration should be idempotent');
  store(['set', 'lean', '--expected-revision', '1'], 1);
  assert.equal(store(['status']).store.revision, 3);
  assert.equal(store(['recover']).store.revision, 3);

  const taskPath = path.join(temp, 'task.json');
  const task = { sessionId: 'packed-probe', taskId: 'python-step', revision: 1, phase: 'implement',
    query: 'python-patterns', proposedIds: ['skill:python-patterns'] };
  fs.writeFileSync(taskPath, JSON.stringify(task));
  const resolve = args => command(['resolve', 'lean', '--task-input', taskPath, ...args]).selection;
  const selected = resolve(['--selection', 'auto']);
  assert.deepEqual(selected.selectedIds, ['skill:python-patterns']);
  assert.deepEqual(selected.loadedIds, []);
  const loaded = resolve(['--selection', 'auto', '--load', '--expected-digest', selected.receipt.selectionDigest]);
  assert.deepEqual(loaded.loadedIds, ['skill:python-patterns']);
  assert.ok(loaded.resources.every(resource => resource.content.length > 0));
  assert.deepEqual(resolve(['--selection', 'suggest', '--load']).loadedIds, []);
  assert.deepEqual(resolve(['--selection', 'manual', '--load']).loadedIds, []);
  assert.deepEqual(resolve(['--selection', 'auto', '--load', '--dry-run']).loadedIds, []);
  const launch = profileCommand(['run', 'lean', '--task-input', taskPath, '--dry-run'], temp,
    { ...env, PATH: temp }).launch;
  assert.equal(launch.status, 'proposed');
  assert.equal(launch.exitCode, null);
  assert.deepEqual(launch.selection.loadedIds, []);
  fs.writeFileSync(taskPath, JSON.stringify({ ...task, explicitIds: ['skill:python-patterns'] }));
  const excluded = command(['resolve', '--state-root', stateRoot, '--task-input', taskPath, '--load'], 1);
  assert.match(excluded.summary, /excluded/);
  fs.writeFileSync(taskPath, JSON.stringify(task));
  const receiptPath = path.join(temp, 'receipt.json');
  fs.writeFileSync(receiptPath, JSON.stringify(loaded.receipt));
  fs.writeFileSync(taskPath, JSON.stringify({ ...task, proposedIds: [], query: 'unrelated wording' }));
  assert.equal(resolve(['--previous', receiptPath, '--load']).reused, true);
  fs.writeFileSync(taskPath, JSON.stringify({ ...task, revision: 2, noWorkflow: true }));
  const reset = resolve(['--previous', receiptPath, '--load']);
  assert.equal(reset.reason, 'no-workflow-needed');
  assert.deepEqual(reset.loadedIds, []);
  const nativeRoot = path.join(temp, 'native-cli');
  const nativeArgs = ['--state-root', stateRoot, '--native-root', nativeRoot];
  const proposedNative = command(['prepare-native', ...nativeArgs, '--dry-run']).native;
  assert.equal(proposedNative.ready, false);
  assert.equal(fs.existsSync(nativeRoot), false);
  const preparedNative = command(['prepare-native', ...nativeArgs]).native;
  assert.equal(preparedNative.ready, true);
  const nativeStatus = command(['native-status', ...nativeArgs]).native;
  assert.equal(nativeStatus.ready, true);
  assert.equal(nativeStatus.storeRevision, 3);
  const nativeLaunch = profileCommand(['run', '--task-input', taskPath, ...nativeArgs, '--dry-run'], temp,
    { ...env, PATH: temp }).launch;
  assert.equal(nativeLaunch.status, 'proposed');
  assert.equal(nativeLaunch.command, preparedNative.executable);
  assert.equal(nativeLaunch.providerConfiguration, 'isolated-native-generation');
  assert.equal(command(['native-recover', ...nativeArgs]).native.ready, true);
  assert.equal(fs.existsSync(env.HOME), false, 'Managed commands changed the caller home');
  return { kind: 'packed-managed-and-auto', transitions: ['full', 'lean', 'rollback-full'],
    finalRevision: 3, idempotency: 'verified', staleRevision: 'rejected',
    autoLoaded: loaded.loadedIds, suggestLoaded: [], manualLoaded: [],
    dryRunLoaded: [], launcherDryRun: 'verified-with-no-provider-on-PATH', savedExclusions: 'enforced',
    pinnedReuse: 'verified', noWorkflowReset: 'verified', nativeCliPreparation: 'verified',
    nativePinnedLaunchDryRun: 'verified', existingSessionActivation: 'unchanged' };
}

try {
  const env = { PATH: process.env.PATH, HOME: path.join(temp, 'home'), LANG: 'C.UTF-8' };
  const results = [];
  for (const target of ['claude', 'codex', 'pi', 'opencode', 'cursor']) {
    for (const profileId of ['lean@1', 'full@1']) {
      const options = { repoRoot, profileId, target, selectionMode: 'auto' };
      const expectedPlan = compileContextProfile(options);
      const artifact = planContextCarrier(options);
      if (expectedSource) {
        assert.deepEqual(artifact, expectedSource.find(item => item.target === target && item.profileId === profileId),
          'Packed carrier differs from source artifact');
      }
      const cli = spawnSync(process.execPath, [path.join(repoRoot, 'scripts/ecc.js'),
        'profile', 'carrier', profileId, '--target', target, '--json'],
      { cwd: temp, env, encoding: 'utf8', timeout: 60000, maxBuffer: 16 * 1024 * 1024 });
      assert.equal(cli.status, 0, cli.stderr);
      assert.deepEqual(JSON.parse(cli.stdout).carrier, artifact);
      const evidence = withCarrierFixture({ repoRoot, artifact, expectedPlan }, ({ verify }) => verify());
      results.push({ target, profileId, selected: artifact.selectedIds.length, files: evidence.fileCount });
    }
  }
  assert.deepEqual(fs.readdirSync(temp), [], 'Preview changed the disposable caller home');
  process.stdout.write(`${JSON.stringify({ kind: 'packed-cli-and-structural', node: process.version,
    platform: `${process.platform}/${process.arch}`, cases: results })}\n`);
  process.stdout.write(`${JSON.stringify(managedJourney(temp, env))}\n`);
  for (const script of ['native-probe.js', 'native-switch-probe.js']) {
    const native = spawnSync(process.execPath, [path.join(__dirname, script)], {
      cwd: temp, env, encoding: 'utf8', timeout: 180000, maxBuffer: 16 * 1024 * 1024,
    });
    assert.equal(native.status, 0, native.stderr || native.stdout);
    process.stdout.write(native.stdout);
  }
} finally {
  fs.rmSync(temp, { recursive: true, force: true });
}
