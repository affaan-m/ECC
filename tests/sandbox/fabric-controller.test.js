'use strict';

const assert = require('assert');
const fs = require('fs');
const os = require('os');
const path = require('path');
const { execFileSync } = require('child_process');
const { EventEmitter } = require('events');
const { buildSingleReport } = require('../../scripts/sandbox/report');
const { createFabricPlan } = require('../../scripts/sandbox/fabric');
const { withLumeProcessReceipt } = require('../../scripts/sandbox/backends/lume');
const { executeTart, TART_DRIVER } = require('../../scripts/sandbox/backends/tart');
const {
  createBackendOwnershipReceipt,
  createControllerRunIdentity,
  createManifestApproval,
  executeScheduledJobs,
  privateRunDirectory,
  runApprovedRouteUntilDeadline,
  runFabric,
} = require('../../scripts/sandbox/fabric-controller');
const {
  validateExecutionPlan,
  validateFabricJob,
  validateFabricRun,
  validateTrajectory,
} = require('../../scripts/sandbox/fabric/contracts');
const { validateReport } = require('../../scripts/sandbox/contracts');
const {
  createFabricWorkerLifecycle,
  cleanupApprovedRouteOwnership,
  superviseApprovedRouteWorker,
} = require('../../scripts/sandbox/ecc-sandbox');

let passed = 0;
let failed = 0;

async function test(name, fn) {
  try {
    await fn();
    console.log(`  ✓ ${name}`);
    passed += 1;
  } catch (error) {
    console.log(`  ✗ ${name}`);
    console.log(`    Error: ${error.stack || error.message}`);
    failed += 1;
  }
}

function clone(value) {
  return JSON.parse(JSON.stringify(value));
}

function ownershipReceipt(backend, tokenCharacter) {
  return createBackendOwnershipReceipt({
    backend,
    jobId: `job_1_${backend}_linux_arm64`,
    ownerToken: tokenCharacter.repeat(64),
    runId: 'run_1234567890abcdef1234567890abcdef',
  });
}

function vmIdentity(backend, name) {
  if (backend === 'lume') {
    return JSON.stringify({ name, status: 'running', os: 'macOS' });
  }
  if (backend === 'lima') {
    return JSON.stringify([{ name, status: 'Running' }]);
  }
  return JSON.stringify({ Name: name, Running: true, State: 'running', OS: 'darwin' });
}

function backendTokenCharacter(backend) {
  return { lume: '1', lima: '2', tart: '3' }[backend];
}

function route(backend, osName, arch, tier = 1) {
  return {
    backend,
    tier,
    os: osName,
    arch,
    rule: 'fixture',
    reason: 'fixture',
    notes: [],
    result: 'routable',
  };
}

function manifest(timeout = 30) {
  return {
    name: 'parallel-fabric',
    needs: {
      os: ['linux', 'macos', 'windows'],
      capabilities: ['fs-write'],
      trust: 'first-party',
      native: false,
    },
    resources: { cpu: 1, memory: '64MB', timeout },
    steps: { setup: ['printf setup'], assert: ['printf assert'] },
    report: 'exit-only',
  };
}

function reportFor(approvedRoute, started) {
  return buildSingleReport({
    manifest: 'sandbox.yaml',
    backend: approvedRoute.backend,
    tier: approvedRoute.tier,
    os: approvedRoute.os,
    arch: approvedRoute.arch,
    executionMode: 'mock',
    started,
    durationMs: 5,
    steps: [{ cmd: 'printf setup', exit: 0, stdout_tail: 'setup', stderr_tail: '' }],
    assertions: [{ cmd: 'printf assert', pass: true }],
  });
}

function fixture(root, routes) {
  const manifestPath = path.join(root, 'sandbox.yaml');
  fs.writeFileSync(manifestPath, 'fixture\n');
  fs.writeFileSync(path.join(root, 'source.txt'), 'source\n');
  if (!fs.existsSync(path.join(root, '.git'))) {
    execFileSync('git', ['init', '-b', 'main'], { cwd: root, stdio: 'ignore' });
    execFileSync('git', ['add', '.'], { cwd: root, stdio: 'ignore' });
    execFileSync('git', [
      '-c', 'user.name=ECC Test',
      '-c', 'user.email=ecc-test@example.invalid',
      'commit', '-m', 'fixture',
    ], { cwd: root, stdio: 'ignore' });
  }
  return {
    manifestPath,
    resolved: {
      manifest: manifest(),
      manifestPath,
      decision: { result: 'routable', routes },
    },
  };
}

console.log('\n=== ECC sandbox fabric controller tests ===\n');

(async () => {
  await test('pins the approved manifest digest, commands, resources, and report contract', () => {
    const approvedManifest = manifest();
    const approval = createManifestApproval(approvedManifest);

    assert.match(approval.digest, /^[a-f0-9]{64}$/);
    assert.deepStrictEqual(approval.commands, approvedManifest.steps);
    assert.deepStrictEqual(approval.resources, approvedManifest.resources);
    assert.strictEqual(approval.report, approvedManifest.report);
    assert.strictEqual(Object.isFrozen(approval), true);
    assert.strictEqual(Object.isFrozen(approval.commands), true);
    assert.strictEqual(Object.isFrozen(approval.resources), true);
  });

  await test('fails closed for Tart without open network and enables host networking only for network:*', () => {
    const noNetwork = manifest();
    assert.throws(
      () => TART_DRIVER.startArgs('ecc-tart-no-network', noNetwork),
      /explicit network:\*/i
    );
    let backendCalls = 0;
    assert.throws(() => executeTart(noNetwork, {
      arch: 'arm64',
      cwd: process.cwd(),
      mock: true,
      run: () => {
        backendCalls += 1;
        return { status: 0, stdout: '', stderr: '' };
      },
    }), /explicit network:\*/i);
    assert.strictEqual(backendCalls, 0);
    const domainNetwork = clone(noNetwork);
    domainNetwork.needs.capabilities.push('network:example.com');
    assert.throws(
      () => TART_DRIVER.startArgs('ecc-tart-domain-network', domainNetwork),
      /explicit network:\*/i
    );
    const openNetwork = clone(noNetwork);
    openNetwork.needs.capabilities.push('network:*');
    const argv = TART_DRIVER.startArgs('ecc-tart-open-network', openNetwork);
    assert.ok(argv.includes('--net-host'));
    assert.strictEqual(argv.at(-1), 'ecc-tart-open-network');
  });

  await test('schedules targets concurrently with isolated paths and stable result ordering', async () => {
    const root = fs.mkdtempSync(path.join(os.tmpdir(), 'ecc-fabric-controller-'));
    const routes = [
      route('podman', 'linux', 'arm64'),
      route('lume', 'macos', 'arm64', 2),
      route('srt', 'windows', 'x86_64', 0),
    ];
    const { resolved } = fixture(root, routes);
    const activePaths = new Set();
    const observed = [];
    let active = 0;
    let peak = 0;
    try {
      const outcome = await runFabric({
        manifestPath: resolved.manifestPath,
        maxParallel: 2,
        workspaceMode: 'isolated-copy',
      }, {
        sourcePath: root,
        resolveRun: () => resolved,
        verifyApprovedRouteOwnership: async () => ({ pass: true, verified: true }),
        runApprovedRoute: async (_resolved, approvedRoute, executionOptions) => {
          active += 1;
          peak = Math.max(peak, active);
          assert.strictEqual(fs.existsSync(executionOptions.cwd), true);
          assert.strictEqual(activePaths.has(executionOptions.cwd), false);
          activePaths.add(executionOptions.cwd);
          observed.push({ route: approvedRoute, options: executionOptions });
          fs.writeFileSync(path.join(executionOptions.cwd, `${approvedRoute.os}.txt`), 'candidate\n');
          const waitMs = approvedRoute.os === 'linux' ? 35 : 5;
          await new Promise(resolve => setTimeout(resolve, waitMs));
          activePaths.delete(executionOptions.cwd);
          active -= 1;
          return {
            report: reportFor(approvedRoute, '2026-08-25T12:00:00.000Z'),
            exitCode: 0,
          };
        },
      });

      assert.strictEqual(peak, 2);
      assert.strictEqual(outcome.kind, 'ecc.sandbox.fabric-run');
      assert.strictEqual(outcome.result, 'pass');
      assert.strictEqual(validateFabricRun(outcome), outcome);
      assert.ok(outcome.jobs.every(job => validateFabricJob(job) === job));
      const malformedJob = clone(outcome.jobs[0]);
      delete malformedJob.cleanup;
      assert.throws(() => validateFabricJob(malformedJob), /fabric job validation failed/i);
      const malformedRun = clone(outcome);
      malformedRun.scheduler.state.controller_debug = true;
      assert.throws(() => validateFabricRun(malformedRun), /fabric run validation failed/i);
      assert.strictEqual(validateExecutionPlan(outcome.plan), outcome.plan);
      assert.strictEqual(validateReport(outcome.report), outcome.report);
      assert.strictEqual(outcome.report.backend, 'aggregate');
      assert.deepStrictEqual(
        outcome.jobs.map(job => job.job_id),
        outcome.plan.jobs.map(job => job.job_id)
      );
      assert.deepStrictEqual(
        outcome.jobs.map(job => job.report.os),
        ['linux', 'macos', 'windows']
      );
      assert.strictEqual(new Set(observed.map(entry => entry.options.cwd)).size, 3);
      assert.ok(observed.every(entry => (
        entry.options.cwd.startsWith(`${outcome.run_directory}${path.sep}`)
      )));
      assert.ok(outcome.jobs.every(job => job.cleanup.pass));
      assert.ok(outcome.jobs.every(job => validateTrajectory(job.trajectory) === job.trajectory));
      assert.deepStrictEqual(
        Object.values(outcome.scheduler.state.tasks).map(task => task.status).sort(),
        ['passed', 'passed', 'passed']
      );
      assert.ok(observed.every(entry => entry.options.jobId.startsWith('job_')));
      assert.ok(observed.every(entry => Object.isFrozen(entry.route)));
      for (const entry of observed) {
        if (!['podman', 'lume', 'lima', 'tart'].includes(entry.route.backend)) {
          assert.strictEqual(entry.options.ownershipReceipt, undefined);
          assert.strictEqual(entry.options.runId, undefined);
          assert.strictEqual(entry.options.ownerToken, undefined);
          continue;
        }
        assert.strictEqual(entry.options.runId, outcome.run_id);
        assert.match(entry.options.ownerToken, /^[a-f0-9]{64}$/);
        assert.strictEqual(entry.options.ownershipReceipt.run_id, outcome.run_id);
        assert.strictEqual(entry.options.ownershipReceipt.job_id, entry.options.jobId);
        assert.strictEqual(entry.options.ownershipReceipt.owner_label, entry.options.ownerToken);
        assert.strictEqual(entry.options.ownershipReceipt.owner_token, undefined);
        assert.strictEqual(entry.options.ownershipReceipt.backend, entry.route.backend);
        assert.match(
          entry.options.ownershipReceipt.resource_name,
          new RegExp(`^ecc-fabric-${entry.route.backend}-[a-f0-9]{24}$`)
        );
        assert.strictEqual(Object.isFrozen(entry.options.ownershipReceipt), true);
      }
      assert.strictEqual(
        outcome.scheduler.events.filter(event => event.type === 'task.started').length,
        3
      );
      fs.rmSync(outcome.run_directory, { recursive: true, force: true });
    } finally {
      fs.rmSync(root, { recursive: true, force: true });
    }
  });

  await test('keeps the single-target outcome shape and rejects ambiguous multi-target promotion', async () => {
    const root = fs.mkdtempSync(path.join(os.tmpdir(), 'ecc-fabric-controller-single-'));
    const singleRoute = route('podman', 'linux', 'arm64');
    const { resolved } = fixture(root, [singleRoute]);
    try {
      const outcome = await runFabric({
        manifestPath: resolved.manifestPath,
        maxParallel: 8,
        workspaceMode: 'in-place',
      }, {
        sourcePath: root,
        resolveRun: () => resolved,
        verifyApprovedRouteOwnership: async () => ({ pass: true, verified: true }),
        runApprovedRoute: async (_resolved, approvedRoute) => ({
          report: reportFor(approvedRoute, '2026-08-25T12:00:00.000Z'),
          exitCode: 0,
        }),
      });
      assert.strictEqual(outcome.report.backend, 'podman');
      assert.strictEqual(validateFabricRun(outcome), outcome);
      const internalWorkspace = clone(outcome);
      internalWorkspace.workspace.source_path = root;
      assert.throws(() => validateFabricRun(internalWorkspace), /fabric run validation failed/i);
      assert.strictEqual(outcome.workspace.mode, 'in-place');
      assert.strictEqual(outcome.jobs, undefined);
      assert.strictEqual(outcome.scheduler, undefined);
      fs.rmSync(outcome.run_directory, { recursive: true, force: true });

      const multiple = fixture(root, [singleRoute, route('lume', 'macos', 'arm64', 2)]).resolved;
      await assert.rejects(() => runFabric({
        manifestPath: multiple.manifestPath,
        maxParallel: 2,
        workspaceMode: 'isolated-copy',
        candidateRef: 'refs/heads/ecc/candidates/parallel',
      }, {
        sourcePath: root,
        resolveRun: () => multiple,
        runApprovedRoute: async () => {
          throw new Error('must not execute');
        },
      }), /candidate-ref.*single-target/i);
    } finally {
      fs.rmSync(root, { recursive: true, force: true });
    }
  });

  await test('fails an owned fabric success without exact controller-verified absence', async () => {
    const root = fs.mkdtempSync(path.join(os.tmpdir(), 'ecc-fabric-controller-final-verify-'));
    const approved = route('podman', 'linux', 'arm64');
    const { resolved } = fixture(root, [approved]);
    let verificationReceipt = null;
    try {
      await assert.rejects(() => runFabric({
        manifestPath: resolved.manifestPath,
        workspaceMode: 'in-place',
      }, {
        sourcePath: root,
        resolveRun: () => resolved,
        runApprovedRoute: async () => ({
          report: reportFor(approved, '2026-08-25T12:00:00.000Z'),
          exitCode: 0,
          cleanup: { attempted: true, pass: true },
        }),
        verifyApprovedRouteOwnership: async receipt => {
          verificationReceipt = receipt;
          return { attempted: false, pass: false, verified: false };
        },
      }), /final backend ownership verification failed/i);
      assert.strictEqual(verificationReceipt.backend, 'podman');
    } finally {
      fs.rmSync(root, { recursive: true, force: true });
    }
  });

  await test('fails route drift before artifact evaluation and cleans the owned workspace', async () => {
    const root = fs.mkdtempSync(path.join(os.tmpdir(), 'ecc-fabric-controller-drift-'));
    const approved = route('podman', 'linux', 'arm64');
    const { resolved } = fixture(root, [approved]);
    let failure;
    try {
      try {
        await runFabric({
          manifestPath: resolved.manifestPath,
          maxParallel: 1,
          workspaceMode: 'isolated-copy',
        }, {
          sourcePath: root,
          resolveRun: () => resolved,
          runApprovedRoute: async (_resolved, _approvedRoute, executionOptions) => {
            fs.writeFileSync(path.join(executionOptions.cwd, 'drifted.txt'), 'must not promote\n');
            return {
              report: reportFor(route('srt', 'macos', 'arm64', 0), '2026-08-25T12:00:00.000Z'),
              exitCode: 0,
            };
          },
        });
      } catch (error) {
        failure = error;
      }
      assert.ok(failure);
      assert.match(failure.message, /route drift/i);
      assert.strictEqual(failure.fabric.cleanup.pass, true);
      const jobId = 'job_1_podman_linux_arm64';
      assert.strictEqual(
        fs.existsSync(path.join(failure.fabric.run_directory, 'jobs', jobId, 'artifacts')),
        false
      );
      assert.strictEqual(fs.existsSync(path.join(root, 'drifted.txt')), false);
      fs.rmSync(failure.fabric.run_directory, { recursive: true, force: true });
    } finally {
      fs.rmSync(root, { recursive: true, force: true });
    }
  });

  await test('expires a never-settling route, cleans its workspace, and cancels dependents', async () => {
    const root = fs.mkdtempSync(path.join(os.tmpdir(), 'ecc-fabric-controller-deadline-'));
    const routes = [
      route('podman', 'linux', 'arm64'),
      route('lume', 'macos', 'arm64', 2),
    ];
    const fixtureData = fixture(root, routes);
    fixtureData.resolved.manifest = manifest(1);
    const runIdentity = createControllerRunIdentity();
    const basePlan = createFabricPlan(
      fixtureData.resolved.manifest,
      fixtureData.resolved.decision,
      {
        manifestPath: 'sandbox.yaml',
        maxParallel: 1,
        planId: runIdentity.planId,
        workspaceMode: 'isolated-copy',
      }
    );
    const plan = {
      ...basePlan,
      jobs: basePlan.jobs.map((job, index) => ({
        ...job,
        depends_on: index === 0 ? [] : [basePlan.jobs[index - 1].job_id],
      })),
    };
    const runDirectory = privateRunDirectory(undefined, runIdentity.runId);
    let workspacePath;
    let executionOptions;
    let guardTimer;
    const startedMs = Date.now();
    try {
      const attempt = executeScheduledJobs({
        dependencies: {
          runApprovedRoute: async (_resolved, _approvedRoute, options) => {
            workspacePath = options.cwd;
            executionOptions = options;
            await new Promise(() => {});
          },
        },
        manifest: fixtureData.resolved.manifest,
        options: { candidateRef: null },
        plan,
        resolved: fixtureData.resolved,
        sourcePath: root,
        runDirectory,
        runIdentity,
      }).then(
        outcome => ({ kind: 'outcome', outcome }),
        error => ({ kind: 'failure', error })
      );
      const observed = await Promise.race([
        attempt,
        new Promise(resolve => {
          guardTimer = setTimeout(() => resolve({ kind: 'guard-timeout' }), 2_500);
        }),
      ]);
      clearTimeout(guardTimer);

      assert.strictEqual(observed.kind, 'failure');
      assert.strictEqual(observed.error.code, 'FABRIC_JOB_DEADLINE_EXCEEDED');
      assert.ok(Date.now() - startedMs < 2_500);
      assert.strictEqual(executionOptions.signal.aborted, true);
      assert.ok(Number.isSafeInteger(executionOptions.deadlineAt));
      assert.strictEqual(observed.error.fabric.cleanup.pass, true);
      assert.strictEqual(fs.existsSync(workspacePath), false);
      assert.deepStrictEqual(
        observed.error.fabric.scheduler.events.map(event => event.type),
        ['task.started', 'task.lease_expired', 'task.cancelled']
      );
      assert.strictEqual(
        observed.error.fabric.scheduler.state.tasks[plan.jobs[0].job_id].status,
        'failed'
      );
      assert.strictEqual(
        observed.error.fabric.scheduler.state.tasks[plan.jobs[1].job_id].status,
        'cancelled'
      );
    } finally {
      clearTimeout(guardTimer);
      fs.rmSync(runDirectory, { recursive: true, force: true });
      fs.rmSync(root, { recursive: true, force: true });
    }
  });

  await test('terminates an approved-route worker before rejecting an abort', async () => {
    class FakeWorker extends EventEmitter {
      constructor() {
        super();
        this.terminations = 0;
      }

      async terminate() {
        this.terminations += 1;
        return 0;
      }
    }
    const worker = new FakeWorker();
    const controller = new AbortController();
    const receipt = ownershipReceipt('podman', 'a');
    let cleanedReceipt = null;
    const execution = superviseApprovedRouteWorker(worker, {
      signal: controller.signal,
      deadlineAt: Date.now() + 5_000,
      ownershipReceipt: receipt,
      cleanupOwnership: async receipt => {
        assert.strictEqual(worker.terminations, 1);
        cleanedReceipt = receipt;
        return { attempted: true, pass: true, verified: true };
      },
    });
    controller.abort(new Error('operator cancelled'));
    await assert.rejects(execution, /operator cancelled/i);
    assert.strictEqual(worker.terminations, 1);
    assert.strictEqual(cleanedReceipt, receipt);
  });

  await test('terminates an approved-route worker before rejecting its deadline', async () => {
    class FakeWorker extends EventEmitter {
      constructor() {
        super();
        this.terminations = 0;
      }

      async terminate() {
        this.terminations += 1;
        return 0;
      }
    }
    const worker = new FakeWorker();
    await assert.rejects(
      superviseApprovedRouteWorker(worker, { deadlineAt: Date.now() + 20 }),
      error => error.code === 'FABRIC_JOB_DEADLINE_EXCEEDED'
    );
    assert.strictEqual(worker.terminations, 1);
  });

  await test('fails closed when terminated worker ownership cleanup is not verified', async () => {
    class FakeWorker extends EventEmitter {
      async terminate() {
        return 0;
      }
    }
    const receipt = ownershipReceipt('lume', 'b');
    const controller = new AbortController();
    const execution = superviseApprovedRouteWorker(new FakeWorker(), {
      signal: controller.signal,
      ownershipReceipt: receipt,
      cleanupOwnership: async () => ({ attempted: true, pass: false, verified: false }),
    });
    controller.abort(new Error('operator cancelled'));
    await assert.rejects(execution, error => (
      error instanceof AggregateError
      && /ownership cleanup was not verified/i.test(error.message)
    ));
  });

  await test('waits for an owned worker cleanup handshake after the job deadline', async () => {
    let cleanupSettled = false;
    const deadlineAt = Date.now() + 20;
    const startedAt = Date.now();
    const execution = runApprovedRouteUntilDeadline({
      deadlineAt,
      dependencies: {
        runApprovedRoute: (_resolved, _route, options) => {
          const attempt = new Promise((resolve, reject) => {
            options.signal.addEventListener('abort', () => {
              setTimeout(() => {
                cleanupSettled = true;
                reject(options.signal.reason);
              }, 350);
            }, { once: true });
          });
          Object.defineProperty(attempt, 'ownedCleanupHandshake', { value: true });
          return attempt;
        },
      },
      job: { job_id: 'job_1_podman_linux_arm64' },
      ownerToken: 'c'.repeat(64),
      ownershipReceipt: ownershipReceipt('podman', 'c'),
      resolved: {},
      runIdentity: { runId: 'run_1234567890abcdef1234567890abcdef' },
    }, Object.freeze(route('podman', 'linux', 'arm64')), process.cwd());
    await assert.rejects(execution, error => error.code === 'FABRIC_JOB_DEADLINE_EXCEEDED');
    assert.strictEqual(cleanupSettled, true);
    assert.ok(Date.now() - startedAt >= 300);
  });

  await test('deletes only an exactly labelled Podman ownership receipt', async () => {
    const receipt = ownershipReceipt('podman', 'e');
    const calls = [];
    const results = [
      {
        status: 0,
        stdout: JSON.stringify({
          'io.ecc.sandbox.run': receipt.run_id,
          'io.ecc.sandbox.owner': receipt.owner_label,
        }),
        stderr: '',
      },
      { status: 0, stdout: '', stderr: '' },
      { status: 1, stdout: '', stderr: '' },
    ];
    const cleanup = cleanupApprovedRouteOwnership(receipt, {
      run: (executable, argv) => {
        calls.push({ executable, argv });
        return results.shift();
      },
    });
    assert.deepStrictEqual(cleanup, { attempted: true, pass: true, verified: true });
    assert.deepStrictEqual(calls.map(call => call.argv[0]), ['inspect', 'rm', 'container']);
    assert.ok(calls.every(call => call.argv.includes(receipt.resource_name)));
  });

  await test('fails closed when Podman diagnostics spoof missing-resource text', async () => {
    const receipt = ownershipReceipt('podman', '9');
    for (const diagnostic of [
      'Error: authorization helper not found',
      `Error: no such object: "not-${receipt.resource_name}"`,
      'Error: unable to connect to Podman socket',
    ]) {
      const calls = [];
      const results = [
        { status: 125, stdout: '', stderr: diagnostic },
        { status: 125, stdout: '', stderr: diagnostic },
      ];
      const cleanup = cleanupApprovedRouteOwnership(receipt, {
        run: (executable, argv) => {
          calls.push({ executable, argv });
          return results.shift();
        },
      });
      assert.deepStrictEqual(cleanup, { attempted: false, pass: false, verified: false });
      assert.deepStrictEqual(calls.map(call => call.argv[0]), ['inspect', 'container']);
      assert.ok(calls.every(call => call.argv.includes(receipt.resource_name)));
    }
  });

  await test('refuses cleanup when Podman ownership labels do not match', async () => {
    const receipt = ownershipReceipt('podman', 'f');
    let calls = 0;
    const cleanup = cleanupApprovedRouteOwnership(receipt, {
      run: () => {
        calls += 1;
        return {
          status: 0,
          stdout: JSON.stringify({
            'io.ecc.sandbox.run': receipt.run_id,
            'io.ecc.sandbox.owner': '0'.repeat(64),
          }),
          stderr: '',
        };
      },
    });
    assert.deepStrictEqual(cleanup, { attempted: false, pass: false, verified: false });
    assert.strictEqual(calls, 1);
  });

  await test('stops and deletes only exact inspected Lume, Lima, and Tart VM identities', async () => {
    for (const backend of ['lume', 'lima', 'tart']) {
      const receipt = ownershipReceipt(backend, backendTokenCharacter(backend));
      const calls = [];
      const results = [
        { status: 0, stdout: vmIdentity(backend, receipt.resource_name), stderr: '' },
        { status: 0, stdout: '', stderr: '' },
        { status: 0, stdout: vmIdentity(backend, receipt.resource_name), stderr: '' },
        { status: 0, stdout: '', stderr: '' },
        { status: 1, stdout: '', stderr: 'virtual machine not found' },
      ];
      const cleanup = cleanupApprovedRouteOwnership(receipt, {
        run: (executable, argv) => {
          calls.push({ executable, argv });
          return results.shift();
        },
      });
      assert.deepStrictEqual(cleanup, { attempted: true, pass: true, verified: true });
      assert.strictEqual(calls.length, 5);
      assert.ok(calls.every(call => call.argv.includes(receipt.resource_name)));
    }
  });

  await test('refuses VM delete when stop fails or post-stop identity changes', () => {
    const receipt = ownershipReceipt('lume', '4');
    for (const afterStop of [
      { status: 1, stdout: '', stderr: 'stop failed' },
      { status: 0, stdout: vmIdentity('lume', 'operator-vm-alias'), stderr: '' },
    ]) {
      const calls = [];
      const results = [
        { status: 0, stdout: vmIdentity('lume', receipt.resource_name), stderr: '' },
        afterStop.status === 1
          ? afterStop
          : { status: 0, stdout: '', stderr: '' },
        ...(afterStop.status === 1 ? [] : [afterStop]),
        { status: 0, stdout: '', stderr: '' },
        { status: 1, stdout: '', stderr: 'virtual machine not found' },
      ];
      const cleanup = cleanupApprovedRouteOwnership(receipt, {
        run: (executable, argv) => {
          calls.push({ executable, argv });
          return results.shift();
        },
      });
      assert.deepStrictEqual(cleanup, { attempted: true, pass: false, verified: false });
      assert.strictEqual(calls.some(call => call.argv.includes('delete')), false);
    }
  });

  await test('fails closed before VM stop or delete for aliases and malformed inspection output', async () => {
    for (const backend of ['lume', 'lima', 'tart']) {
      const receipt = ownershipReceipt(backend, backendTokenCharacter(backend));
      const exactParsed = JSON.parse(vmIdentity(backend, receipt.resource_name));
      const aliasParsed = JSON.parse(vmIdentity(backend, 'operator-vm-alias'));
      const multiple = JSON.stringify([
        ...(Array.isArray(exactParsed) ? exactParsed : [exactParsed]),
        ...(Array.isArray(aliasParsed) ? aliasParsed : [aliasParsed]),
      ]);
      for (const stdout of [
        vmIdentity(backend, 'operator-vm-alias'),
        multiple,
        '{malformed',
      ]) {
        const calls = [];
        const cleanup = cleanupApprovedRouteOwnership(receipt, {
          run: (executable, argv) => {
            calls.push({ executable, argv });
            return { status: 0, stdout, stderr: '' };
          },
        });
        assert.deepStrictEqual(cleanup, { attempted: false, pass: false, verified: false });
        assert.strictEqual(calls.length, 1);
      }
    }
  });

  await test('cleans durable exact Lume launcher and helper receipts after worker loss', async () => {
    class FakeWorker extends EventEmitter {
      async terminate() { return 0; }
    }
    const root = fs.mkdtempSync(path.join(os.tmpdir(), 'ecc-lume-process-receipt-'));
    const receipt = createBackendOwnershipReceipt({
      backend: 'lume',
      jobId: 'job_1_lume_macos_arm64',
      ownerToken: '9'.repeat(64),
      runId: 'run_1234567890abcdef1234567890abcdef',
      receiptDirectory: root,
    });
    const launcher = {
      pid: 71_000, pgid: 71_000,
      started: 'Mon Aug 10 00:00:00 2026', command: '/usr/local/bin/lume run exact-vm',
    };
    const helper = {
      pid: 71_001, pgid: 71_001,
      started: 'Mon Aug 10 00:00:01 2026', command: '/usr/bin/ssh lume@192.0.2.20 VNC_PORT=55000',
    };
    const lifecycle = createFabricWorkerLifecycle(receipt);
    lifecycle.resourceAdmission({ backend: 'lume', storage_path: '/fixture/lume-vms' });
    lifecycle.processCreated({ backend: 'lume', resource: { process: launcher } });
    lifecycle.helperCreated({ backend: 'lume', resource: { process: helper } });

    const live = new Map([[launcher.pid, launcher], [helper.pid, helper]]);
    const calls = [];
    let vmDeleted = false;
    const execution = superviseApprovedRouteWorker(new FakeWorker(), {
      signal: AbortSignal.abort(new Error('worker deadline')),
      ownershipReceipt: receipt,
      cleanupOwnership: owned => cleanupApprovedRouteOwnership(owned, {
        signalProcess: target => live.delete(Math.abs(target)),
        run: (executable, argv) => {
          calls.push({ executable, argv: [...argv] });
          if (executable === '/bin/ps') {
            const pid = Number(argv[1]);
            const current = live.get(pid);
            return current
              ? {
                status: 0,
                stdout: `${current.pgid} ${current.started} ${current.command}\n`,
                stderr: '',
              }
              : { status: 1, stdout: '', stderr: '' };
          }
          if (argv[0] === 'get') {
            return vmDeleted
              ? { status: 1, stdout: '', stderr: 'virtual machine not found' }
              : { status: 0, stdout: vmIdentity('lume', owned.resource_name), stderr: '' };
          }
          if (argv[0] === 'delete') {
            vmDeleted = true;
            return { status: 0, stdout: '', stderr: '' };
          }
          if (argv[0] === 'stop') return { status: 0, stdout: '', stderr: '' };
          throw new Error(`unexpected cleanup command: ${executable} ${argv.join(' ')}`);
        },
      }),
    });
    await assert.rejects(execution, /worker deadline/i);
    assert.strictEqual(live.size, 0);
    const firstVmCall = calls.findIndex(call => call.executable === 'lume');
    assert.ok(firstVmCall > 0);
    assert.ok(calls.slice(0, firstVmCall).every(call => call.executable === '/bin/ps'));
    fs.rmSync(root, { recursive: true, force: true });
  });

  await test('persists the detached Lume launcher identity before returning it to VM execution', () => {
    const observed = [];
    const launcher = {
      pid: 72_000, pgid: 72_000,
      started: 'Mon Aug 10 00:00:00 2026', command: '/usr/local/bin/lume run exact-vm',
    };
    let returned = false;
    const start = withLumeProcessReceipt(
      (_executable, _argv, options) => {
        options.onLauncher(launcher);
        assert.strictEqual(observed.length, 1);
        returned = true;
        return { status: 0, stdout: '', stderr: '', child: { ownershipReceipt: launcher } };
      },
      { processCreated: details => observed.push(details) }
    );
    const result = start('lume', ['run', 'exact-vm'], { cwd: process.cwd() });
    assert.strictEqual(returned, true);
    assert.strictEqual(result.child.ownershipReceipt, launcher);
    assert.deepStrictEqual(observed, [{
      backend: 'lume',
      resource: { process: launcher },
    }]);
  });

  await test('publishes the real Lume launcher receipt synchronously inside startLume', () => {
    const launcher = {
      pid: 73_000, pgid: 73_000,
      started: 'Mon Aug 10 00:00:00 2026', command: '/lume run exact-vm',
    };
    let published = null;
    let startReturned = false;
    const result = require('../../scripts/sandbox/backends/lume').startLume(
      '/lume',
      ['run', 'exact-vm'],
      {
        launch: () => ({ pid: launcher.pid, once() {}, kill() {}, unref() {} }),
        processIdentity: () => ({ started: launcher.started, command: launcher.command }),
        processGroupIsAlive: () => true,
        onLauncher: receipt => {
          assert.strictEqual(startReturned, false);
          published = receipt;
        },
      }
    );
    startReturned = true;
    assert.strictEqual(result.status, 0);
    assert.deepStrictEqual(published, launcher);
  });

  console.log(`\nPassed: ${passed}`);
  console.log(`Failed: ${failed}`);
  process.exitCode = failed > 0 ? 1 : 0;
})();
