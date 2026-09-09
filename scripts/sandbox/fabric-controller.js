'use strict';

const crypto = require('crypto');
const fs = require('fs');
const os = require('os');
const path = require('path');
const { createFabricPlan, executionFabric } = require('./fabric');
const { contractDigest } = require('./contracts');
const {
  validateFabricJob,
  validateFabricRun,
  validateFabricWorkspaceReceipt,
} = require('./fabric/contracts');
const { reduceSchedulerEvent } = require('./fabric/reducer');
const { buildAggregateReport } = require('./report');

const JOB_ABORT_SETTLE_GRACE_MS = 250;
const OWNED_ROUTE_BACKENDS = new Set(['podman', 'lume', 'lima', 'tart']);

function deepFreeze(value) {
  if (!value || typeof value !== 'object' || Object.isFrozen(value)) return value;
  Object.values(value).forEach(deepFreeze);
  return Object.freeze(value);
}

function createManifestApproval(manifest) {
  const commands = JSON.parse(JSON.stringify(manifest.steps));
  const resources = JSON.parse(JSON.stringify(manifest.resources));
  return deepFreeze({
    schema_version: 1,
    digest: contractDigest(manifest),
    commands,
    resources,
    report: manifest.report,
  });
}

function createControllerRunIdentity() {
  const token = crypto.randomBytes(16).toString('hex');
  return Object.freeze({
    runId: `run_${token}`,
    planId: `plan_${token}`,
    trajectoryId: `trajectory_${token}`,
  });
}

function createBackendOwnershipReceipt({
  backend,
  jobId,
  ownerToken,
  receiptDirectory,
  runId,
}) {
  if (!OWNED_ROUTE_BACKENDS.has(backend)) return null;
  if (!/^run_[a-f0-9]{32}$/.test(runId || '')) {
    throw new Error('Backend ownership requires a canonical controller run ID');
  }
  if (!/^[a-f0-9]{64}$/.test(ownerToken || '')) {
    throw new Error('Backend ownership requires a controller owner token');
  }
  if (!/^[A-Za-z0-9][A-Za-z0-9._:-]{0,119}$/.test(jobId || '')) {
    throw new Error('Backend ownership requires a validated job ID');
  }
  const ownerLabel = crypto.createHmac('sha256', ownerToken)
    .update(`ecc-fabric-backend-label\0${runId}\0${jobId}\0${backend}`)
    .digest('hex');
  const identity = crypto.createHash('sha256')
    .update(`${ownerLabel}\0${runId}\0${jobId}\0${backend}`)
    .digest('hex')
    .slice(0, 24);
  let processReceipt = null;
  if (backend === 'lume' && receiptDirectory) {
    const parent = fs.realpathSync.native(receiptDirectory);
    const receiptPath = path.join(parent, '.lume-process-receipts.jsonl');
    const descriptor = fs.openSync(receiptPath, 'wx', 0o600);
    fs.closeSync(descriptor);
    processReceipt = Object.freeze({
      path: receiptPath,
      key: crypto.randomBytes(32).toString('hex'),
    });
  }
  return deepFreeze({
    schema_version: 1,
    run_id: runId,
    job_id: jobId,
    owner_label: ownerLabel,
    backend,
    resource_name: `ecc-fabric-${backend}-${identity}`,
    ...(processReceipt ? { process_receipt: processReceipt } : {}),
  });
}

function privateRunDirectory(parent = os.tmpdir(), runId) {
  if (!/^run_[a-f0-9]{32}$/.test(runId || '')) {
    throw new Error('Fabric run directory requires a canonical controller run ID');
  }
  const directory = path.join(path.resolve(parent), runId);
  fs.mkdirSync(directory, { mode: 0o700 });
  fs.chmodSync(directory, 0o700);
  return fs.realpathSync.native(directory);
}

function publicWorkspaceReceipt(receipt) {
  return validateFabricWorkspaceReceipt({
    schema_version: receipt.schema_version,
    workspace_id: receipt.workspace_id,
    mode: receipt.mode,
    owned: receipt.owned,
    base_ref: receipt.base_ref,
    base_oid: receipt.base_oid,
    input_digest: receipt.input_digest,
  });
}

function artifactCandidate(receipt, runDirectory, ownerToken, trust) {
  if (receipt.mode !== 'worktree') return { path: receipt.path, cleanup: null };
  const stagingDirectory = path.join(runDirectory, 'artifact-source');
  fs.mkdirSync(stagingDirectory, { mode: 0o700 });
  const copy = executionFabric.workspace.prepareWorkspace({
    mode: 'isolated-copy',
    sourcePath: receipt.path,
    runDirectory: stagingDirectory,
    ownerToken,
    trust,
  });
  return { path: copy.path, cleanup: copy };
}

function buildRunTrajectory(context) {
  const assertionCommands = new Set(context.report.assertions.map(assertion => assertion.cmd));
  const artifacts = [];
  if (context.artifact) {
    artifacts.push({
      kind: 'patch',
      artifact_id: context.artifact.artifact_id,
      digest: executionFabric.patches.digestArtifact(context.artifact),
    });
  }
  if (context.evaluation) {
    artifacts.push({
      kind: 'evaluation',
      artifact_id: context.evaluation.evaluation_id,
      digest: executionFabric.evaluation.digestEvaluation(context.evaluation),
    });
  }
  const result = context.report.result === 'pass'
    && context.cleanup.pass
    && (!context.evaluation || context.evaluation.verdict === 'accepted')
    && (!context.promotion || context.promotion.result === 'promoted')
    ? 'pass'
    : 'fail';
  return executionFabric.trajectory.buildTrajectory({
    trajectory_id: context.trajectoryId,
    plan_id: context.plan.plan_id,
    job_id: context.job.job_id,
    run_id: context.runId,
    manifest_digest: contractDigest(context.manifest),
    worker: { id: 'fabric-controller', harness: 'ecc-sandbox', model: 'not-recorded' },
    route: {
      backend: context.report.backend,
      tier: context.report.tier,
      os: context.report.os,
      arch: context.report.arch,
      policy_version: 'router-v1',
    },
    environment: {
      digest: contractDigest({
        backend: context.report.backend,
        execution_mode: context.report.execution_mode,
        os: context.report.os,
        arch: context.report.arch,
      }),
      cache_key: null,
      warm: false,
    },
    started_at: context.report.started,
    completed_at: new Date().toISOString(),
    commands: context.report.steps.map(step => ({
      phase: assertionCommands.has(step.cmd) ? 'assert' : 'setup',
      command: step.cmd,
      exit_code: step.exit,
    })),
    tests: context.report.assertions.map(assertion => ({
      name: assertion.cmd,
      result: assertion.pass ? 'pass' : 'fail',
    })),
    artifacts,
    credential_lease_ids: [],
    cleanup: { verified: context.cleanup.pass, owned_resources_remaining: 0 },
    timings: { active_ms: context.report.duration_ms, wall_ms: context.report.duration_ms },
    cost: { amount: 0, currency: 'USD' },
    redactions: 0,
    result,
  });
}

function approvedSingleReport(report, approvedRoute) {
  if (!report || typeof report !== 'object') {
    throw new Error('Approved route execution did not return a sandbox report');
  }
  const effective = report.backend === 'aggregate'
    && Array.isArray(report.children)
    && report.children.length === 1
    ? report.children[0]
    : report;
  const fields = ['backend', 'tier', 'os', 'arch'];
  if (fields.some(field => effective[field] !== approvedRoute[field])) {
    const expected = fields.map(field => approvedRoute[field]).join('/');
    const actual = fields.map(field => effective[field] ?? 'missing').join('/');
    throw new Error(`Sandbox report route drift: expected ${expected}, received ${actual}`);
  }
  const escalations = [
    ...(Array.isArray(report.escalations) ? report.escalations : []),
    ...(effective !== report && Array.isArray(effective.escalations) ? effective.escalations : []),
  ];
  if (escalations.length !== 0) {
    throw new Error('Sandbox report contains an escalation outside the approved plan route');
  }
  return effective;
}

function createJobDirectory(runDirectory, jobId) {
  if (!/^[A-Za-z0-9][A-Za-z0-9._:-]{0,119}$/.test(jobId)) {
    throw new Error('Fabric job directory requires a validated job ID');
  }
  const jobsDirectory = path.join(runDirectory, 'jobs');
  fs.mkdirSync(jobsDirectory, { recursive: true, mode: 0o700 });
  const directory = path.join(jobsDirectory, jobId);
  const relative = path.relative(runDirectory, directory);
  if (relative.startsWith('..') || path.isAbsolute(relative)) {
    throw new Error('Fabric job directory escapes the controller run directory');
  }
  fs.mkdirSync(directory, { mode: 0o700 });
  fs.chmodSync(directory, 0o700);
  return fs.realpathSync.native(directory);
}

function memoryMegabytes(value) {
  const match = String(value).match(/^([1-9][0-9]*)(MB|GB)$/);
  if (!match) throw new Error('Fabric scheduler requires canonical manifest memory');
  return Number(match[1]) * (match[2] === 'GB' ? 1024 : 1);
}

function schedulerPlan(plan, manifest) {
  const cpu = manifest.resources.cpu;
  const memoryMb = memoryMegabytes(manifest.resources.memory);
  return {
    tasks: plan.jobs.map(job => ({
      id: job.job_id,
      tier: job.route.tier,
      cpu,
      memory_mb: memoryMb,
      depends_on: [...job.depends_on],
      priority: 0,
    })),
    policy: {
      max_parallel: plan.max_parallel,
      cpu: cpu * plan.max_parallel,
      memory_mb: memoryMb * plan.max_parallel,
      lease_ms: manifest.resources.timeout * 1_000,
      per_tier: { 2: 1 },
    },
  };
}

function jobDeadlineError(jobId, deadlineAt) {
  const error = new Error(`Fabric job ${jobId} exceeded its controller-owned deadline`);
  error.name = 'FabricJobDeadlineError';
  error.code = 'FABRIC_JOB_DEADLINE_EXCEEDED';
  error.deadlineAt = deadlineAt;
  return error;
}

async function runApprovedRouteUntilDeadline(context, approvedRoute, cwd) {
  const deadlineAt = context.deadlineAt;
  if (!Number.isSafeInteger(deadlineAt) || deadlineAt <= 0) {
    throw new Error('Fabric job requires a positive controller-owned deadline');
  }
  const controller = new AbortController();
  const deadlineError = jobDeadlineError(context.job.job_id, deadlineAt);
  let executionAttempt;
  let deadlineTimer;
  let forcedSettlementTimer;
  const execution = Promise.resolve().then(() => {
    executionAttempt = context.dependencies.runApprovedRoute(
      context.resolved,
      approvedRoute,
      {
        cwd,
        signal: controller.signal,
        deadlineAt,
        jobId: context.job.job_id,
        manifestApproval: context.manifestApproval,
        ...(context.ownershipReceipt ? {
          runId: context.runIdentity.runId,
          ownerToken: context.ownershipReceipt.owner_label,
          ownershipReceipt: context.ownershipReceipt,
          ...(context.ownershipReceipt.backend === 'podman'
            ? { containerName: context.ownershipReceipt.resource_name }
            : { vmName: context.ownershipReceipt.resource_name }),
        } : {}),
      }
    );
    return executionAttempt;
  }).then(
    value => {
      if (controller.signal.aborted) throw deadlineError;
      return value;
    },
    error => {
      if (controller.signal.aborted) {
        deadlineError.cause = error;
        throw deadlineError;
      }
      throw error;
    }
  );
  const deadline = new Promise((_, reject) => {
    const expire = () => {
      controller.abort(deadlineError);
      if (executionAttempt?.ownedCleanupHandshake === true) return;
      forcedSettlementTimer = setTimeout(
        () => reject(deadlineError),
        JOB_ABORT_SETTLE_GRACE_MS
      );
    };
    const remainingMs = deadlineAt - Date.now();
    if (remainingMs <= 0) expire();
    else deadlineTimer = setTimeout(expire, remainingMs);
  });
  try {
    return await Promise.race([execution, deadline]);
  } finally {
    clearTimeout(deadlineTimer);
    clearTimeout(forcedSettlementTimer);
  }
}

function resultPass(report, cleanup, evaluation, promotion, candidateRef) {
  return report.result === 'pass'
    && cleanup.pass
    && (!evaluation || evaluation.verdict === 'accepted')
    && (!candidateRef || promotion?.result === 'promoted');
}

async function executeFabricJob(context) {
  const {
    dependencies,
    job,
    manifest,
    options,
    plan,
    runDirectory,
    runIdentity,
    sourcePath,
  } = context;
  const jobDirectory = createJobDirectory(runDirectory, job.job_id);
  const ownerToken = crypto.randomBytes(32).toString('hex');
  const ownershipReceipt = createBackendOwnershipReceipt({
    backend: job.route.backend,
    jobId: job.job_id,
    ownerToken,
    receiptDirectory: jobDirectory,
    runId: runIdentity.runId,
  });
  let receipt;
  let artifactCopy;
  let cleanup = { attempted: false, pass: false, retained: false };
  try {
    receipt = executionFabric.workspace.prepareWorkspace({
      mode: job.workspace.mode,
      sourcePath,
      runDirectory: jobDirectory,
      ownerToken,
      trust: manifest.needs.trust,
    });
    const approvedRoute = Object.freeze({ ...job.route });
    const execution = await runApprovedRouteUntilDeadline({
      ...context,
      ownerToken,
      ownershipReceipt,
    }, approvedRoute, receipt.path);
    const report = approvedSingleReport(execution.report, approvedRoute);
    if (ownershipReceipt) {
      if (typeof dependencies.verifyApprovedRouteOwnership !== 'function') {
        throw new Error('Fabric final backend ownership verification is unavailable');
      }
      const finalVerification = await dependencies.verifyApprovedRouteOwnership(
        ownershipReceipt
      );
      if (finalVerification?.pass !== true || finalVerification?.verified !== true) {
        throw new Error('Fabric final backend ownership verification failed');
      }
    }
    if (ownershipReceipt?.process_receipt) {
      const processReceipt = fs.lstatSync(ownershipReceipt.process_receipt.path);
      if (!processReceipt.isFile() || processReceipt.isSymbolicLink()) {
        throw new Error('Fabric process receipt changed identity before disposal');
      }
      fs.unlinkSync(ownershipReceipt.process_receipt.path);
    }
    let artifact = null;
    let evaluation = null;
    let promotion = null;
    if (receipt.owned) {
      const candidate = artifactCandidate(
        receipt,
        jobDirectory,
        ownerToken,
        manifest.needs.trust
      );
      artifactCopy = candidate.cleanup;
      artifact = executionFabric.patches.buildPatchArtifact({
        basePath: sourcePath,
        baseRef: receipt.base_ref,
        candidatePath: candidate.path,
        runDirectory: jobDirectory,
        runId: runIdentity.runId,
        jobId: job.job_id,
        workerId: job.job_id,
        workspaceMode: receipt.mode,
      });
      if (artifactCopy) {
        const copyCleanup = executionFabric.workspace.cleanupWorkspace(artifactCopy, { ownerToken });
        if (!copyCleanup.pass) throw new Error('Artifact staging workspace cleanup failed');
        artifactCopy = null;
      }
      cleanup = executionFabric.workspace.cleanupWorkspace(receipt, { ownerToken });
      evaluation = executionFabric.evaluation.evaluateArtifact(artifact, {
        sandboxResult: report.result,
        cleanupPass: cleanup.pass,
      });
      if (options.candidateRef) {
        promotion = executionFabric.promotion.promoteCandidate({
          artifact,
          evaluation,
          repositoryPath: sourcePath,
          runDirectory: jobDirectory,
          targetRef: receipt.base_ref,
          candidateRef: options.candidateRef,
        });
      }
    } else {
      cleanup = executionFabric.workspace.cleanupWorkspace(receipt, { ownerToken });
      if (options.candidateRef) {
        throw new Error('--candidate-ref requires an owned worktree or isolated-copy workspace');
      }
    }
    const pass = resultPass(report, cleanup, evaluation, promotion, options.candidateRef);
    const trajectory = buildRunTrajectory({
      artifact,
      cleanup,
      evaluation,
      job,
      promotion,
      manifest,
      plan,
      report,
      runId: runIdentity.runId,
      trajectoryId: plan.jobs.length === 1
        ? runIdentity.trajectoryId
        : `trajectory_${crypto.randomBytes(16).toString('hex')}`,
    });
    return validateFabricJob({
      schema_version: 1,
      kind: 'ecc.sandbox.fabric-job',
      run_id: runIdentity.runId,
      job_id: job.job_id,
      result: pass ? 'pass' : 'fail',
      run_directory: jobDirectory,
      report,
      workspace: publicWorkspaceReceipt(receipt),
      artifact,
      evaluation,
      promotion,
      trajectory,
      trajectory_digest: executionFabric.trajectory.trajectoryDigest(trajectory),
      cleanup,
    });
  } catch (error) {
    if (artifactCopy) {
      try { executionFabric.workspace.cleanupWorkspace(artifactCopy, { ownerToken }); } catch { /* exact best effort */ }
    }
    if (receipt?.owned && fs.existsSync(receipt.path)) {
      try { cleanup = executionFabric.workspace.cleanupWorkspace(receipt, { ownerToken }); } catch { /* exact best effort */ }
    }
    error.fabric = {
      run_id: runIdentity.runId,
      job_id: job.job_id,
      run_directory: jobDirectory,
      deadline_at: context.deadlineAt,
      cleanup,
    };
    throw error;
  }
}

function elapsedMilliseconds(startedMs, previous) {
  return Math.max(previous, Date.now() - startedMs);
}

async function executeScheduledJobs(context) {
  const { manifest, plan } = context;
  const startedMs = Date.now();
  let nowMs = 0;
  let state = executionFabric.scheduler.createScheduler(
    schedulerPlan(plan, manifest),
    { now_ms: nowMs }
  );
  let events = [];
  const active = new Map();
  const outcomes = new Map();
  const errors = new Map();
  const jobsById = new Map(plan.jobs.map(job => [job.job_id, job]));
  const allTasksTerminal = () => Object.values(state.tasks)
    .every(task => ['passed', 'failed', 'cancelled'].includes(task.status));

  while (!allTasksTerminal()) {
    nowMs = elapsedMilliseconds(startedMs, nowMs);
    const advanced = executionFabric.scheduler.advanceScheduler(state, { now_ms: nowMs });
    state = advanced.state;
    events = [...events, ...advanced.events];
    for (const event of advanced.events.filter(item => item.type === 'task.started')) {
      const job = jobsById.get(event.task_id);
      const completion = executeFabricJob({
        ...context,
        deadlineAt: startedMs + event.lease_expires_ms,
        job,
      })
        .then(outcome => ({ jobId: job.job_id, outcome, error: null }))
        .catch(error => ({ jobId: job.job_id, outcome: null, error }));
      active.set(job.job_id, completion);
    }
    if (active.size === 0 && allTasksTerminal()) break;
    if (active.size === 0) {
      throw new Error('Fabric scheduler stalled with unfinished jobs');
    }

    const completed = await Promise.race([...active.values()]);
    active.delete(completed.jobId);
    if (completed.error) errors.set(completed.jobId, completed.error);
    else outcomes.set(completed.jobId, completed.outcome);
    const task = state.tasks[completed.jobId];
    nowMs = elapsedMilliseconds(startedMs, nowMs);
    const expired = completed.error?.code === 'FABRIC_JOB_DEADLINE_EXCEEDED';
    const event = expired
      ? {
        type: 'task.lease_expired',
        task_id: completed.jobId,
        lease_id: task.lease_id,
        now_ms: Math.max(nowMs, task.lease_expires_ms),
      }
      : {
        type: 'task.completed',
        task_id: completed.jobId,
        lease_id: task.lease_id,
        result: completed.error
          ? 'error'
          : (completed.outcome.result === 'pass' ? 'pass' : 'fail'),
        reason: completed.error ? completed.error.message : null,
        now_ms: nowMs,
      };
    state = reduceSchedulerEvent(state, event);
    events = [...events, event];
  }

  if (errors.size > 0) {
    const firstJob = plan.jobs.find(job => errors.has(job.job_id));
    const error = errors.get(firstJob.job_id);
    error.fabric = {
      ...error.fabric,
      run_id: context.runIdentity.runId,
      run_directory: context.runDirectory,
      failed_jobs: plan.jobs.filter(job => errors.has(job.job_id)).map(job => job.job_id),
      scheduler: { state, events },
    };
    throw error;
  }
  return {
    outcomes: plan.jobs.map(job => outcomes.get(job.job_id)),
    scheduler: { state, events },
    wallMs: Date.now() - startedMs,
  };
}

async function runFabric(options, dependencies = {}) {
  if (
    typeof dependencies.resolveRun !== 'function'
    || typeof dependencies.runApprovedRoute !== 'function'
  ) {
    throw new Error('Fabric controller requires sandbox resolve and execute dependencies');
  }
  const resolved = dependencies.resolveRun(options);
  const routable = resolved.decision.routes.filter(route => route.result === 'routable');
  const sourcePath = fs.realpathSync.native(path.resolve(dependencies.sourcePath || process.cwd()));
  const manifestPath = fs.realpathSync.native(resolved.manifestPath);
  const runIdentity = createControllerRunIdentity();
  const requestedWorkspaceMode = options.workspaceMode || 'auto';
  const workspaceMode = routable.length > 1 && requestedWorkspaceMode === 'auto'
    ? 'isolated-copy'
    : requestedWorkspaceMode;
  const plan = createFabricPlan(resolved.manifest, resolved.decision, {
    manifestPath: path.relative(sourcePath, manifestPath).split(path.sep).join('/'),
    maxParallel: options.maxParallel || 1,
    planId: runIdentity.planId,
    workspaceMode,
  });
  const manifestApproval = createManifestApproval(resolved.manifest);
  if (options.planOnly) {
    return {
      kind: 'ecc.sandbox.fabric-plan',
      run_id: runIdentity.runId,
      plan,
      result: 'planned',
    };
  }
  if (plan.jobs.length > 1 && options.candidateRef) {
    throw new Error('--candidate-ref is available only for a single-target fabric run');
  }
  if (
    plan.jobs.length > 1
    && plan.max_parallel > 1
    && plan.jobs.some(job => job.workspace.mode === 'in-place')
  ) {
    throw new Error('Parallel fabric jobs require isolated-copy or worktree workspaces');
  }

  const runDirectory = privateRunDirectory(dependencies.tempParent, runIdentity.runId);
  try {
    if (plan.jobs.length === 1) {
      const leaseMs = schedulerPlan(plan, resolved.manifest).policy.lease_ms;
      const jobOutcome = await executeFabricJob({
        deadlineAt: Date.now() + leaseMs,
        dependencies,
        job: plan.jobs[0],
        manifestApproval,
        manifest: resolved.manifest,
        options,
        plan,
        resolved,
        runDirectory,
        runIdentity,
        sourcePath,
      });
      return validateFabricRun({
        ...jobOutcome,
        kind: 'ecc.sandbox.fabric-run',
        run_directory: runDirectory,
        plan,
      });
    }

    const scheduled = await executeScheduledJobs({
      dependencies,
      manifestApproval,
      manifest: resolved.manifest,
      options,
      plan,
      resolved,
      sourcePath,
      runDirectory,
      runIdentity,
    });
    const reports = scheduled.outcomes.map(outcome => outcome.report);
    const usesCi = reports.some(report => report.backend === 'ci');
    const usesLocal = reports.some(report => report.backend !== 'ci');
    const report = buildAggregateReport({
      manifest: resolved.manifestPath,
      venue: usesCi && usesLocal ? 'mixed' : (usesCi ? 'ci' : 'local'),
      started: reports.map(item => item.started).sort()[0],
      durationMs: scheduled.wallMs,
      children: reports,
      escalations: [],
      notes: [],
    });
    return validateFabricRun({
      schema_version: 1,
      kind: 'ecc.sandbox.fabric-run',
      run_id: runIdentity.runId,
      result: scheduled.outcomes.every(outcome => outcome.result === 'pass') ? 'pass' : 'fail',
      run_directory: runDirectory,
      plan,
      report,
      jobs: scheduled.outcomes,
      scheduler: scheduled.scheduler,
    });
  } catch (error) {
    error.fabric = {
      ...error.fabric,
      run_id: runIdentity.runId,
      run_directory: runDirectory,
    };
    throw error;
  }
}

module.exports = {
  buildRunTrajectory,
  approvedSingleReport,
  createBackendOwnershipReceipt,
  createControllerRunIdentity,
  createManifestApproval,
  createJobDirectory,
  executeFabricJob,
  executeScheduledJobs,
  jobDeadlineError,
  privateRunDirectory,
  publicWorkspaceReceipt,
  runFabric,
  runApprovedRouteUntilDeadline,
  schedulerPlan,
};
