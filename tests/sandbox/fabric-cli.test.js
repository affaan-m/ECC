'use strict';

const assert = require('assert');
const fs = require('fs');
const os = require('os');
const path = require('path');
const { execFileSync, spawnSync } = require('child_process');
const {
  validateExecutionPlan,
  validateFabricRun,
  validateTrajectory,
} = require('../../scripts/sandbox/fabric/contracts');
const { validateReport } = require('../../scripts/sandbox/contracts');
const { defaultHost } = require('../../scripts/sandbox/router');
const {
  resolveRun,
  runApprovedRoute,
  runApprovedRouteFromOptions,
} = require('../../scripts/sandbox/ecc-sandbox');
const {
  createBackendOwnershipReceipt,
  createManifestApproval,
} = require('../../scripts/sandbox/fabric-controller');

const cliPath = path.join(__dirname, '..', '..', 'scripts', 'sandbox', 'ecc-sandbox');
const repoRoot = path.join(__dirname, '..', '..');
let passed = 0;
let failed = 0;

function test(name, fn) {
  try {
    fn();
    console.log(`  ✓ ${name}`);
    passed += 1;
  } catch (error) {
    console.log(`  ✗ ${name}`);
    console.log(`    Error: ${error.stack || error.message}`);
    failed += 1;
  }
}

function git(cwd, ...args) {
  return execFileSync('git', args, {
    cwd,
    encoding: 'utf8',
    env: {
      ...process.env,
      GIT_AUTHOR_NAME: 'ECC Test',
      GIT_AUTHOR_EMAIL: 'ecc-test@example.invalid',
      GIT_COMMITTER_NAME: 'ECC Test',
      GIT_COMMITTER_EMAIL: 'ecc-test@example.invalid',
    },
  }).trim();
}

console.log('\n=== ECC sandbox fabric CLI tests ===\n');

test('uses a derived non-secret owner label through an immutable approved Podman route', () => {
  const approvedRoute = Object.freeze({
    backend: 'podman', tier: 1, os: 'linux', arch: 'arm64',
    rule: 'fixture', reason: 'fixture', notes: [], result: 'routable',
  });
  const calls = [];
  const runId = 'run_1234567890abcdef1234567890abcdef';
  const workspaceOwnerToken = 'd'.repeat(64);
  const ownership = createBackendOwnershipReceipt({
    backend: 'podman', jobId: 'job_1_podman_linux_arm64',
    ownerToken: workspaceOwnerToken, runId,
  });
  const containerName = ownership.resource_name;
  const execution = runApprovedRoute({
    manifestPath: path.join(repoRoot, 'sandbox.yaml'),
    manifest: {
      name: 'ownership-propagation',
      needs: {
        os: ['linux'], capabilities: ['fs-write'], trust: 'first-party', native: false,
      },
      resources: { cpu: 1, memory: '64MB', timeout: 30 },
      steps: { setup: ['printf setup'], assert: ['printf assert'] },
      report: 'exit-only',
    },
    decision: { result: 'routable', routes: [approvedRoute] },
  }, approvedRoute, {
    arch: 'arm64', cwd: repoRoot, mock: true, runId,
    ownerToken: ownership.owner_label, containerName,
    run: (executable, argv, options) => {
      calls.push({ executable, argv, options });
      if (argv[0] === 'info') {
        return { status: 0, stdout: '{"host":{"security":{"rootless":true}}}', stderr: '' };
      }
      if (argv[0] === 'image') {
        return { status: 0, stdout: `sha256:${'a'.repeat(64)}\n`, stderr: '' };
      }
      if (argv[0] === 'create') {
        return { status: 0, stdout: `${'b'.repeat(64)}\n`, stderr: '' };
      }
      return { status: 0, stdout: '', stderr: '' };
    },
  });
  assert.strictEqual(execution.cleanup.pass, true);
  const create = calls.find(call => call.argv[0] === 'create');
  assert.deepStrictEqual(create.argv.slice(0, 3), ['create', '--name', containerName]);
  assert.ok(create.argv.includes(`io.ecc.sandbox.run=${runId}`));
  assert.ok(create.argv.includes(`io.ecc.sandbox.owner=${ownership.owner_label}`));
  assert.notStrictEqual(ownership.owner_label, workspaceOwnerToken);
  assert.ok(create.argv.every(value => !value.includes(workspaceOwnerToken)));
  assert.strictEqual(Object.isFrozen(approvedRoute), true);
});

test('rejects manifest command, resource, and report drift before worker execution', () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'ecc-fabric-manifest-approval-'));
  const manifestPath = path.join(root, 'sandbox.yaml');
  const capabilitiesPath = path.join(root, 'capabilities.json');
  const mockPath = path.join(root, 'mock.json');
  const hostOs = { darwin: 'macos', linux: 'linux', win32: 'windows' }[process.platform];
  const hostArch = process.arch === 'x64' ? 'x86_64' : process.arch;
  const writeManifest = ({ setup = 'printf approved', cpu = 1, report = 'exit-only' } = {}) => {
    fs.writeFileSync(manifestPath, [
      'name: manifest-approval',
      'needs:',
      '  os: [any]',
      '  capabilities: [fs-write]',
      '  trust: first-party',
      '  native: false',
      'resources:',
      `  cpu: ${cpu}`,
      '  memory: 64MB',
      '  timeout: 30',
      'steps:',
      `  setup: ["${setup}"]`,
      '  assert: ["printf assert"]',
      `report: ${report}`,
      '',
    ].join('\n'));
  };
  try {
    writeManifest();
    fs.writeFileSync(capabilitiesPath, JSON.stringify({
      schema_version: 1,
      host: { os: hostOs, arch: hostArch, cpus: 4, inside_container: false, virtualization: 'available' },
      backends: { srt: { available: true, targets: [{ os: hostOs, arch: hostArch }] } },
    }));
    fs.writeFileSync(mockPath, JSON.stringify({ results: [
      { status: 0, stdout: 'setup' }, { status: 0, stdout: 'assert' },
    ] }));
    const options = { manifestPath, capabilitiesPath, mockPath, localOnly: true };
    const planned = resolveRun(options);
    const approval = createManifestApproval(planned.manifest);
    const approvedRoute = Object.freeze({
      ...planned.decision.routes.find(candidate => candidate.result === 'routable'),
    });
    const mutations = [
      { setup: 'printf mutated' },
      { cpu: 2 },
      { report: 'install-diff' },
    ];
    for (const mutation of mutations) {
      writeManifest(mutation);
      assert.throws(() => runApprovedRouteFromOptions(options, approvedRoute, {
        manifestApproval: approval,
      }), /manifest approval drift/i);
      writeManifest();
    }
  } finally {
    fs.rmSync(root, { recursive: true, force: true });
  }
});

test('runs a Tier 0 mock through an owned worktree and rejects its empty candidate', () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'ecc-fabric-cli-'));
  try {
    const host = defaultHost();
    git(root, 'init', '-b', 'main');
    const manifestPath = path.join(root, 'sandbox.yaml');
    const capabilitiesPath = path.join(root, 'capabilities.json');
    const mockPath = path.join(root, 'mock.json');
    fs.writeFileSync(manifestPath, [
      'name: fabric-cli-test',
      'needs:',
      '  os: [any]',
      '  capabilities: [fs-write]',
      '  trust: first-party',
      '  native: false',
      'resources:',
      '  cpu: 1',
      '  memory: 256MB',
      '  timeout: 30',
      'steps:',
      '  setup: ["printf candidate > fabric-marker.txt"]',
      '  assert: ["test -f fabric-marker.txt"]',
      'report: exit-only',
      '',
    ].join('\n'));
    fs.writeFileSync(capabilitiesPath, JSON.stringify({
      schema_version: 1,
      host: { ...host, inside_container: false, virtualization: 'available' },
      backends: { srt: { available: true, targets: [{ os: host.os, arch: host.arch }] } },
    }));
    fs.writeFileSync(mockPath, JSON.stringify({ results: [
      { status: 0, stdout: 'setup' },
      { status: 0, stdout: 'assert' },
    ] }));
    git(root, 'add', '.');
    git(root, 'commit', '-m', 'fixture');

    const cli = spawnSync(process.execPath, [
      cliPath, 'fabric', manifestPath,
      '--workspace-mode', 'worktree',
      '--local-only',
      '--capabilities', capabilitiesPath,
      '--mock', mockPath,
    ], { cwd: root, encoding: 'utf8', shell: false, timeout: 30_000 });

    assert.strictEqual(cli.status, 1, cli.stderr || cli.stdout);
    assert.strictEqual(cli.stderr, '');
    const outcome = JSON.parse(cli.stdout);
    assert.strictEqual(outcome.kind, 'ecc.sandbox.fabric-run');
    assert.strictEqual(validateFabricRun(outcome), outcome);
    assert.strictEqual(outcome.result, 'fail');
    assert.match(outcome.run_id, /^run_[a-f0-9]{32}$/);
    assert.strictEqual(outcome.plan.plan_id, outcome.run_id.replace(/^run_/, 'plan_'));
    assert.strictEqual(path.basename(outcome.run_directory), outcome.run_id);
    assert.strictEqual(validateExecutionPlan(outcome.plan), outcome.plan);
    assert.strictEqual(validateReport(outcome.report), outcome.report);
    assert.strictEqual(outcome.report.backend, 'srt');
    assert.strictEqual(outcome.report.execution_mode, 'mock');
    assert.strictEqual(outcome.workspace.mode, 'worktree');
    assert.strictEqual(outcome.cleanup.pass, true);
    assert.strictEqual(outcome.evaluation.verdict, 'rejected');
    assert.strictEqual(outcome.artifact.run_id, outcome.run_id);
    assert.strictEqual(outcome.artifact.job_id, outcome.plan.jobs[0].job_id);
    assert.strictEqual(validateTrajectory(outcome.trajectory), outcome.trajectory);
    assert.strictEqual(outcome.trajectory.run_id, outcome.run_id);
    assert.strictEqual(outcome.trajectory.plan_id, outcome.plan.plan_id);
    assert.strictEqual(outcome.trajectory.job_id, outcome.plan.jobs[0].job_id);
    assert.match(outcome.trajectory_digest, /^[a-f0-9]{64}$/);
    assert.strictEqual(fs.existsSync(path.join(root, 'fabric-marker.txt')), false);
    fs.rmSync(outcome.run_directory, { recursive: true, force: true });
  } finally {
    fs.rmSync(root, { recursive: true, force: true });
  }
});

test('orchestrates Tier 1 and Tier 2 mock adapters through canonical trajectories', () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'ecc-fabric-tier-mocks-'));
  try {
    const host = defaultHost();
    const tierOneCapabilities = path.join(root, 'tier1-capabilities.json');
    const tierOneMock = path.join(root, 'tier1-mock.json');
    fs.writeFileSync(tierOneCapabilities, JSON.stringify({
      schema_version: 1,
      host,
      backends: { podman: { available: true, targets: [{ os: 'linux', arch: host.arch }] } },
    }));
    fs.writeFileSync(tierOneMock, JSON.stringify({ results: [
      { status: 0, stdout: '{"host":{"security":{"rootless":true}}}\n' },
      { status: 0, stdout: `sha256:${'a'.repeat(64)}\n` },
      { status: 0 }, { status: 0 },
      { status: 0, stdout: 'setup' }, { status: 0, stdout: 'assert' },
      { status: 0, stdout: '' }, { status: 0 },
    ] }));
    const tierOne = spawnSync(process.execPath, [
      cliPath, 'fabric', path.join(repoRoot, 'examples/sandbox/review-tier1-podman.yaml'),
      '--workspace-mode', 'in-place', '--local-only',
      '--capabilities', tierOneCapabilities, '--mock', tierOneMock,
    ], { cwd: repoRoot, encoding: 'utf8', shell: false, timeout: 30_000 });
    assert.strictEqual(tierOne.status, 0, tierOne.stderr || tierOne.stdout);
    const tierOneOutcome = JSON.parse(tierOne.stdout);
    assert.strictEqual(validateFabricRun(tierOneOutcome), tierOneOutcome);
    assert.strictEqual(tierOneOutcome.report.backend, 'podman');
    assert.strictEqual(tierOneOutcome.report.execution_mode, 'mock');
    assert.match(tierOneOutcome.run_id, /^run_[a-f0-9]{32}$/);
    assert.strictEqual(
      tierOneOutcome.plan.plan_id,
      tierOneOutcome.run_id.replace(/^run_/, 'plan_')
    );
    assert.strictEqual(path.basename(tierOneOutcome.run_directory), tierOneOutcome.run_id);
    assert.strictEqual(validateTrajectory(tierOneOutcome.trajectory), tierOneOutcome.trajectory);
    assert.strictEqual(tierOneOutcome.trajectory.run_id, tierOneOutcome.run_id);
    assert.strictEqual(tierOneOutcome.trajectory.plan_id, tierOneOutcome.plan.plan_id);
    assert.strictEqual(tierOneOutcome.trajectory.job_id, tierOneOutcome.plan.jobs[0].job_id);
    fs.rmSync(tierOneOutcome.run_directory, { recursive: true, force: true });

    if (process.platform === 'darwin' && process.arch === 'arm64') {
      const tierTwoCapabilities = path.join(root, 'tier2-capabilities.json');
      const tierTwoMock = path.join(root, 'tier2-mock.json');
      const before = '/usr/local/bin/existing\t10\t100\t755';
      const after = `${before}\n/usr/local/bin/ecc-demo\t20\t101\t755`;
      fs.writeFileSync(tierTwoCapabilities, JSON.stringify({
        schema_version: 1,
        host: { os: 'macos', arch: 'arm64' },
        backends: { lume: { available: true, targets: [{ os: 'macos', arch: 'arm64' }] } },
      }));
      fs.writeFileSync(tierTwoMock, JSON.stringify({ results: [
        { status: 0, stdout: '[{"status":"stopped","os":"macOS"}]' },
        { status: 0, stdout: '[]' },
        { status: 0 }, { status: 0 }, { status: 0 }, { status: 0 },
        { status: 0, stdout: before }, { status: 0 }, { status: 0 },
        { status: 0, stdout: after }, { status: 0 }, { status: 0 },
      ] }));
      const tierTwo = spawnSync(process.execPath, [
        cliPath, 'fabric', path.join(repoRoot, 'examples/sandbox/review-tier2-lume.yaml'),
        '--workspace-mode', 'in-place', '--local-only',
        '--capabilities', tierTwoCapabilities, '--mock', tierTwoMock,
      ], {
        cwd: repoRoot,
        encoding: 'utf8',
        env: { ...process.env, ECC_SANDBOX_LUME_SEED: 'ecc-macos-seed' },
        shell: false,
        timeout: 30_000,
      });
      assert.strictEqual(tierTwo.status, 0, tierTwo.stderr || tierTwo.stdout);
      const tierTwoOutcome = JSON.parse(tierTwo.stdout);
      assert.strictEqual(validateFabricRun(tierTwoOutcome), tierTwoOutcome);
      assert.strictEqual(tierTwoOutcome.report.backend, 'lume');
      assert.strictEqual(tierTwoOutcome.report.execution_mode, 'mock');
      assert.match(tierTwoOutcome.run_id, /^run_[a-f0-9]{32}$/);
      assert.strictEqual(
        tierTwoOutcome.plan.plan_id,
        tierTwoOutcome.run_id.replace(/^run_/, 'plan_')
      );
      assert.strictEqual(path.basename(tierTwoOutcome.run_directory), tierTwoOutcome.run_id);
      assert.strictEqual(validateTrajectory(tierTwoOutcome.trajectory), tierTwoOutcome.trajectory);
      assert.strictEqual(tierTwoOutcome.trajectory.run_id, tierTwoOutcome.run_id);
      assert.strictEqual(tierTwoOutcome.trajectory.plan_id, tierTwoOutcome.plan.plan_id);
      assert.strictEqual(tierTwoOutcome.trajectory.job_id, tierTwoOutcome.plan.jobs[0].job_id);
      fs.rmSync(tierTwoOutcome.run_directory, { recursive: true, force: true });
    }
  } finally {
    fs.rmSync(root, { recursive: true, force: true });
  }
});

console.log(`\nPassed: ${passed}`);
console.log(`Failed: ${failed}`);
process.exit(failed > 0 ? 1 : 0);
