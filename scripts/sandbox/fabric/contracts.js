'use strict';

const fs = require('fs');
const path = require('path');
const Ajv = require('ajv');
const {
  ContractValidationError,
  contractDigest,
  formatAjvErrors,
  validateReport,
} = require('../contracts');

const repoRoot = path.join(__dirname, '..', '..', '..');
const schemaPaths = Object.freeze({
  credentialRequest: path.join(repoRoot, 'schemas', 'sandbox-credential-request.schema.json'),
  evaluation: path.join(repoRoot, 'schemas', 'sandbox-evaluation.schema.json'),
  executionBoundary: path.join(repoRoot, 'schemas', 'sandbox-execution-boundary.schema.json'),
  executionPlan: path.join(repoRoot, 'schemas', 'sandbox-execution-plan.schema.json'),
  fabricJob: path.join(repoRoot, 'schemas', 'sandbox-fabric-job.schema.json'),
  fabricRun: path.join(repoRoot, 'schemas', 'sandbox-fabric-run.schema.json'),
  fabricWorkspaceReceipt: path.join(
    repoRoot,
    'schemas',
    'sandbox-fabric-workspace-receipt.schema.json'
  ),
  patchArtifact: path.join(repoRoot, 'schemas', 'sandbox-patch-artifact.schema.json'),
  promotion: path.join(repoRoot, 'schemas', 'sandbox-promotion.schema.json'),
  report: path.join(repoRoot, 'schemas', 'sandbox-report.schema.json'),
  resourceMonitoring: path.join(repoRoot, 'schemas', 'sandbox-resource-monitoring.schema.json'),
  trajectory: path.join(repoRoot, 'schemas', 'sandbox-trajectory.schema.json'),
});

function readSchema(schemaPath) {
  return JSON.parse(fs.readFileSync(schemaPath, 'utf8'));
}

const schemas = Object.fromEntries(
  Object.entries(schemaPaths).map(([name, schemaPath]) => [name, readSchema(schemaPath)])
);
const ajv = new Ajv({ allErrors: true, strict: true });
for (const schema of Object.values(schemas)) ajv.addSchema(schema);

const validators = Object.fromEntries(Object.entries(schemas).map(([name, schema]) => [
  name,
  ajv.getSchema(schema.$id),
]));

function validateWith(name, label, value, semanticErrors = () => []) {
  const validator = validators[name];
  if (!validator(value)) {
    throw new ContractValidationError(label, formatAjvErrors(validator.errors));
  }
  const errors = semanticErrors(value);
  if (errors.length > 0) throw new ContractValidationError(label, errors);
  return value;
}

function audienceAllows(authorized, requested) {
  if (authorized === requested) return true;
  if (!authorized.startsWith('*.')) return false;
  const suffix = authorized.slice(1);
  return requested.endsWith(suffix) && requested.length > suffix.length;
}

function semanticCredentialRequestErrors(request) {
  const errors = [];
  for (const audience of request.audience) {
    if (!request.authorized_audience.some(authorized => audienceAllows(authorized, audience))) {
      errors.push(`/audience audience ${audience} is not authorized`);
    }
  }
  return errors;
}

function duplicateValues(values) {
  const seen = new Set();
  const duplicates = new Set();
  for (const value of values) {
    if (seen.has(value)) duplicates.add(value);
    seen.add(value);
  }
  return [...duplicates];
}

const EXECUTION_SURFACES = Object.freeze([
  'shell', 'child-processes', 'filesystem-tools', 'hooks', 'plugins', 'browsers',
  'mcp-servers', 'model-api-clients', 'network-clients',
]);

function semanticExecutionBoundaryErrors(boundary) {
  const errors = [];
  const contained = new Set(boundary.coverage.contained_surfaces);
  const excluded = new Set(boundary.coverage.excluded_surfaces);
  for (const surface of contained) {
    if (excluded.has(surface)) errors.push(`/coverage surface ${surface} cannot be contained and excluded`);
  }
  for (const surface of EXECUTION_SURFACES) {
    if (!contained.has(surface) && !excluded.has(surface)) {
      errors.push(`/coverage surface ${surface} must be contained or excluded`);
    }
  }
  if (boundary.coverage.scope === 'whole-agent' && contained.size !== EXECUTION_SURFACES.length) {
    errors.push('/coverage whole-agent coverage must contain every supported surface');
  }
  for (const statement of boundary.enforced_controls) {
    if (boundary.missing_controls.includes(statement)) {
      errors.push(`/missing_controls ${statement} cannot also be enforced`);
    }
  }
  return errors;
}

function semanticResourceMonitoringErrors(receipt) {
  const errors = [];
  const started = Date.parse(receipt.started_at);
  const completed = Date.parse(receipt.completed_at);
  if (completed < started) errors.push('/completed_at cannot precede started_at');
  if (receipt.samples[0]?.phase !== 'initial') errors.push('/samples first sample must be initial');
  if (receipt.samples.at(-1)?.phase !== 'final') errors.push('/samples last sample must be final');
  let previousRecorded = started;
  receipt.samples.forEach((sample, index) => {
    if (sample.sequence !== index) errors.push(`/samples/${index}/sequence must be contiguous`);
    const recorded = Date.parse(sample.recorded_at);
    if (recorded < started || recorded > completed) {
      errors.push(`/samples/${index}/recorded_at must be within the monitoring interval`);
    }
    if (recorded < previousRecorded) errors.push(`/samples/${index}/recorded_at cannot move backward`);
    previousRecorded = recorded;
    const measured = [
      [sample.cpu_cores, receipt.limits.cpu_cores],
      [sample.memory_bytes, receipt.limits.memory_bytes],
      [sample.processes, receipt.limits.processes],
      [sample.storage_growth_bytes, receipt.limits.storage_growth_bytes],
      [sample.output_bytes, receipt.limits.output_bytes],
      [sample.elapsed_ms, receipt.limits.runtime_ms],
      [sample.spend?.amount ?? null, receipt.limits.spend.amount],
    ];
    const exceeds = measured.some(([value, limit]) => value !== null && value > limit);
    const mustStop = exceeds || sample.telemetry === 'stale';
    const mustWarn = !mustStop && sample.telemetry !== 'complete';
    const expectedDecision = mustStop ? 'stop' : (mustWarn ? 'warn' : 'continue');
    if (sample.decision !== expectedDecision) {
      errors.push(`/samples/${index}/decision must be ${expectedDecision} for its telemetry and limits`);
    }
    if (sample.decision === 'stop' && sample.reasons.length === 0) {
      errors.push(`/samples/${index}/reasons a stop decision requires a reason`);
    }
  });
  const stopped = receipt.samples.some(sample => sample.decision === 'stop');
  if (receipt.status === 'stopped' && (!stopped || !receipt.stop_reason || !receipt.cleanup_triggered)) {
    errors.push('/status stopped monitoring requires a stop sample, reason, and cleanup trigger');
  }
  if (receipt.status !== 'stopped' && receipt.stop_reason !== null) {
    errors.push('/stop_reason is available only for stopped monitoring');
  }
  if (receipt.status === 'warn' && receipt.warnings.length === 0) {
    errors.push('/warnings warning monitoring requires a disclosed warning');
  }
  if (receipt.status === 'pass' && (receipt.telemetry !== 'complete' || receipt.warnings.length > 0)) {
    errors.push('/status pass requires complete telemetry without warnings');
  }
  return errors;
}

function dependencyCycle(jobs) {
  const dependencies = new Map(jobs.map(job => [job.job_id, job.depends_on]));
  const visited = new Set();
  const active = new Set();

  function visit(jobId) {
    if (active.has(jobId)) return jobId;
    if (visited.has(jobId)) return null;
    active.add(jobId);
    for (const dependency of dependencies.get(jobId) || []) {
      const cycleAt = visit(dependency);
      if (cycleAt) return cycleAt;
    }
    active.delete(jobId);
    visited.add(jobId);
    return null;
  }

  for (const job of jobs) {
    const cycleAt = visit(job.job_id);
    if (cycleAt) return cycleAt;
  }
  return null;
}

function semanticExecutionPlanErrors(plan) {
  const errors = [];
  const jobsById = new Map();
  const requestsById = new Map();

  for (const duplicate of duplicateValues(plan.jobs.map(job => job.job_id))) {
    errors.push(`/jobs duplicate job_id ${duplicate}`);
  }
  for (const job of plan.jobs) {
    if (job.execution) {
      const { buildExecutionBoundary } = require('./execution-boundary');
      const expected = buildExecutionBoundary(job.route);
      try {
        validateExecutionBoundary(job.execution);
      } catch (error) {
        errors.push(...error.errors.map(item => `/jobs/${job.job_id}/execution${item}`));
      }
      if (job.execution.execution_class !== expected.execution_class) {
        errors.push(`/jobs/${job.job_id}/execution/execution_class does not match route backend`);
      }
      if (job.execution.placement !== expected.placement) {
        errors.push(`/jobs/${job.job_id}/execution/placement does not match route backend`);
      }
    }
    if (!jobsById.has(job.job_id)) jobsById.set(job.job_id, job);
  }

  for (const duplicate of duplicateValues(plan.credential_requests.map(request => request.request_id))) {
    errors.push(`/credential_requests duplicate request_id ${duplicate}`);
  }
  for (const request of plan.credential_requests) {
    if (!requestsById.has(request.request_id)) requestsById.set(request.request_id, request);
    for (const error of semanticCredentialRequestErrors(request)) {
      errors.push(`/credential_requests/${request.request_id}${error}`);
    }
  }

  for (const job of plan.jobs) {
    if (job.trust === 'untrusted' && job.workspace.mode === 'worktree') {
      errors.push(`/jobs/${job.job_id}/workspace untrusted jobs cannot use worktree`);
    }
    for (const dependency of job.depends_on) {
      if (!jobsById.has(dependency)) {
        errors.push(`/jobs/${job.job_id}/depends_on references unknown job ${dependency}`);
      }
    }
    for (const requestId of job.credential_request_ids) {
      const request = requestsById.get(requestId);
      if (!request) {
        errors.push(`/jobs/${job.job_id}/credential_request_ids references unknown request ${requestId}`);
        continue;
      }
      if (request.job_id !== job.job_id) {
        errors.push(`/jobs/${job.job_id}/credential_request_ids request ${requestId} belongs to job ${request.job_id}`);
      }
      for (const audience of request.audience) {
        if (!job.network_audience.includes(audience)) {
          errors.push(`/credential_requests/${requestId}/audience ${audience} exceeds job ${job.job_id} network audience`);
        }
      }
    }
  }

  for (const request of plan.credential_requests) {
    const job = jobsById.get(request.job_id);
    if (!job) {
      errors.push(`/credential_requests/${request.request_id}/job_id references unknown job ${request.job_id}`);
    } else if (!job.credential_request_ids.includes(request.request_id)) {
      errors.push(`/credential_requests/${request.request_id} is not declared by job ${request.job_id}`);
    }
  }

  if (errors.every(error => !error.includes('unknown job'))) {
    const cycleAt = dependencyCycle(plan.jobs);
    if (cycleAt) errors.push(`/jobs dependency cycle detected at job ${cycleAt}`);
  }
  return errors;
}

function semanticPatchArtifactErrors(artifact) {
  const errors = [];
  for (const duplicate of duplicateValues(artifact.files.map(file => file.path))) {
    errors.push(`/files duplicate path ${duplicate}`);
  }
  artifact.files.forEach((file, index) => {
    if (file.status === 'added' && (file.mode_before !== null || file.mode_after === null)) {
      errors.push(`/files/${index} added files require null mode_before and mode_after`);
    }
    if (file.status === 'deleted' && (file.mode_before === null || file.mode_after !== null)) {
      errors.push(`/files/${index} deleted files require mode_before and null mode_after`);
    }
    if (file.status === 'deleted' && (file.size !== null || file.sha256 !== null)) {
      errors.push(`/files/${index} deleted files require null size and sha256`);
    }
    if (
      (file.status === 'modified' || file.status === 'renamed')
      && (file.mode_before === null || file.mode_after === null)
    ) {
      errors.push(`/files/${index} ${file.status} files require mode_before and mode_after`);
    }
    if (file.status !== 'deleted' && (file.size === null || file.sha256 === null)) {
      errors.push(`/files/${index} ${file.status} files require size and sha256`);
    }
  });
  return errors;
}

function expectedEvaluationVerdict(evaluation) {
  const required = evaluation.evaluators.filter(evaluator => evaluator.required);
  if (required.some(evaluator => evaluator.verdict === 'reject')) return 'rejected';
  if (required.length === 0 || required.some(evaluator => evaluator.verdict === 'inconclusive')) {
    return 'inconclusive';
  }
  return 'accepted';
}

function semanticEvaluationErrors(evaluation) {
  const errors = [];
  for (const duplicate of duplicateValues(evaluation.evaluators.map(evaluator => evaluator.id))) {
    errors.push(`/evaluators duplicate evaluator id ${duplicate}`);
  }
  const expected = expectedEvaluationVerdict(evaluation);
  if (evaluation.verdict !== expected) {
    errors.push(`/verdict verdict must be ${expected} for required evaluator outcomes`);
  }
  return errors;
}

function semanticTrajectoryErrors(trajectory) {
  const errors = [];
  if (trajectory.timings.active_ms > trajectory.timings.wall_ms) {
    errors.push('/timings active_ms cannot exceed wall_ms');
  }
  if (
    trajectory.result === 'pass'
    && (!trajectory.cleanup.verified || trajectory.cleanup.owned_resources_remaining !== 0)
  ) {
    errors.push('/result pass requires verified cleanup with no owned resources remaining');
  }
  if (
    trajectory.result === 'pass'
    && (
      trajectory.commands.some(command => command.exit_code !== 0)
      || trajectory.tests.some(test => test.result === 'fail' || test.result === 'error')
    )
  ) {
    errors.push('/result pass requires successful commands and tests');
  }
  return errors;
}

function semanticPromotionErrors(promotion, context = {}) {
  const errors = [];
  if (promotion.result === 'promoted') {
    if (Object.values(promotion.checks).some(value => value !== true)) {
      errors.push('/checks promoted requires every promotion check to pass');
    }
    if (!promotion.candidate_ref || !promotion.candidate_commit) {
      errors.push('/candidate promoted requires a candidate ref and commit');
    }
    if (promotion.observed_target_oid !== promotion.base_oid) {
      errors.push('/observed_target_oid observed target must equal base_oid');
    }
  }

  const { artifact, evaluation } = context;
  if (promotion.result === 'promoted' && (!artifact || !evaluation)) {
    errors.push('/result promoted requires bound patch and evaluation receipts');
  }
  if (artifact) {
    if (promotion.artifact_id !== artifact.artifact_id) {
      errors.push('/artifact_id does not match patch artifact');
    }
    if (promotion.base_oid !== artifact.base.commit) {
      errors.push('/base_oid does not match patch artifact base commit');
    }
    if (promotion.checks.target_unchanged && promotion.observed_target_oid !== artifact.base.commit) {
      errors.push('/observed_target_oid observed target must equal artifact base commit');
    }
  }
  if (evaluation) {
    if (promotion.evaluation_digest !== contractDigest(evaluation)) {
      errors.push('/evaluation_digest does not match evaluation receipt');
    }
    if (evaluation.artifact_id !== promotion.artifact_id) {
      errors.push('/artifact_id does not match evaluation receipt');
    }
    if (evaluation.verdict !== 'accepted' && promotion.result === 'promoted') {
      errors.push('/result promoted requires an accepted evaluation');
    }
    if (artifact && evaluation.artifact_digest !== contractDigest(artifact)) {
      errors.push('/artifact_digest evaluation artifact digest does not match patch artifact');
    }
    if (artifact && evaluation.evaluators.some(evaluator => evaluator.id === artifact.worker_id)) {
      errors.push('/evaluators worker cannot evaluate its own patch');
    }
  }
  return errors;
}

function semanticFabricJobErrors(job) {
  const errors = [];
  try { validateReport(job.report); } catch (error) { errors.push(...error.errors.map(item => `/report${item}`)); }
  try { validateTrajectory(job.trajectory); } catch (error) { errors.push(...error.errors.map(item => `/trajectory${item}`)); }

  if (job.trajectory_digest !== contractDigest(job.trajectory)) {
    errors.push('/trajectory_digest does not match trajectory');
  }
  if (job.trajectory.run_id !== job.run_id) errors.push('/trajectory/run_id does not match job run_id');
  if (job.trajectory.job_id !== job.job_id) errors.push('/trajectory/job_id does not match job_id');
  for (const field of ['backend', 'tier', 'os', 'arch']) {
    if (job.report[field] !== job.trajectory.route[field]) {
      errors.push(`/trajectory/route/${field} does not match report`);
    }
  }
  if (job.trajectory.cleanup.verified !== job.cleanup.pass) {
    errors.push('/trajectory/cleanup/verified does not match cleanup pass');
  }
  if (job.execution) {
    const { buildExecutionBoundary } = require('./execution-boundary');
    const expected = buildExecutionBoundary(job.report);
    if (job.execution.execution_class !== expected.execution_class) {
      errors.push('/execution/execution_class does not match report backend');
    }
    if (job.execution.placement !== expected.placement) {
      errors.push('/execution/placement does not match report backend');
    }
  }
  if (job.resource_monitoring?.status === 'stopped' && job.result === 'pass') {
    errors.push('/resource_monitoring stopped resource monitoring cannot produce a passing job');
  }
  if (job.resource_monitoring) {
    try {
      validateResourceMonitoring(job.resource_monitoring);
    } catch (error) {
      errors.push(...error.errors.map(item => `/resource_monitoring${item}`));
    }
  }

  if (!job.workspace.owned && (job.artifact || job.evaluation || job.promotion)) {
    errors.push('/workspace unowned workspaces cannot emit patch, evaluation, or promotion receipts');
  }
  if (job.workspace.owned && !job.artifact) {
    errors.push('/artifact owned workspaces require a patch artifact');
  }
  if (!job.artifact && (job.evaluation || job.promotion)) {
    errors.push('/artifact evaluation and promotion require a patch artifact');
  }
  if (!job.evaluation && job.promotion) {
    errors.push('/evaluation promotion requires an evaluation receipt');
  }
  if (job.artifact) {
    try { validatePatchArtifact(job.artifact); } catch (error) { errors.push(...error.errors.map(item => `/artifact${item}`)); }
    if (job.artifact.run_id !== job.run_id) errors.push('/artifact/run_id does not match job run_id');
    if (job.artifact.job_id !== job.job_id) errors.push('/artifact/job_id does not match job_id');
    if (job.artifact.workspace_mode !== job.workspace.mode) {
      errors.push('/artifact/workspace_mode does not match workspace mode');
    }
  }
  if (job.evaluation) {
    try { validateEvaluation(job.evaluation); } catch (error) { errors.push(...error.errors.map(item => `/evaluation${item}`)); }
    if (job.evaluation.artifact_id !== job.artifact?.artifact_id) {
      errors.push('/evaluation/artifact_id does not match patch artifact');
    }
    if (job.artifact && job.evaluation.artifact_digest !== contractDigest(job.artifact)) {
      errors.push('/evaluation/artifact_digest does not match patch artifact');
    }
  }
  if (job.promotion) {
    try {
      validatePromotion(job.promotion, { artifact: job.artifact, evaluation: job.evaluation });
    } catch (error) {
      errors.push(...error.errors.map(item => `/promotion${item}`));
    }
  }

  const expectedPass = job.report.result === 'pass'
    && job.cleanup.pass
    && (!job.evaluation || job.evaluation.verdict === 'accepted')
    && (!job.promotion || job.promotion.result === 'promoted');
  if (job.result !== (expectedPass ? 'pass' : 'fail')) {
    errors.push(`/result must be ${expectedPass ? 'pass' : 'fail'} for job receipts`);
  }
  if (job.trajectory.result !== job.result) {
    errors.push('/trajectory/result does not match job result');
  }
  return errors;
}

function sameValues(left, right) {
  return left.length === right.length && left.every((value, index) => value === right[index]);
}

function semanticFabricRunErrors(run) {
  const errors = [];
  try { validateExecutionPlan(run.plan); } catch (error) { errors.push(...error.errors.map(item => `/plan${item}`)); }
  try { validateReport(run.report); } catch (error) { errors.push(...error.errors.map(item => `/report${item}`)); }
  if (run.schema_version !== run.plan.schema_version) {
    errors.push('/schema_version must match the execution plan schema version');
  }
  const planJobIds = run.plan.jobs.map(job => job.job_id);
  if (run.jobs) {
    const runJobIds = run.jobs.map(job => job.job_id);
    if (!sameValues(runJobIds, planJobIds)) {
      errors.push('/jobs must correspond to plan jobs in plan order');
    }
    run.jobs.forEach((job, index) => {
      for (const error of semanticFabricJobErrors(job)) errors.push(`/jobs/${index}${error}`);
      if (job.run_id !== run.run_id) errors.push(`/jobs/${index}/run_id does not match run_id`);
      if (job.schema_version !== run.schema_version) {
        errors.push(`/jobs/${index}/schema_version does not match run schema version`);
      }
      if (
        run.plan.jobs[index]?.execution
        && contractDigest(job.execution) !== contractDigest(run.plan.jobs[index].execution)
      ) {
        errors.push(`/jobs/${index}/execution does not match plan execution boundary`);
      }
      if (job.trajectory.plan_id !== run.plan.plan_id) {
        errors.push(`/jobs/${index}/trajectory/plan_id does not match plan`);
      }
      for (const field of ['backend', 'tier', 'os', 'arch']) {
        if (job.trajectory.route[field] !== run.plan.jobs[index]?.route[field]) {
          errors.push(`/jobs/${index}/trajectory/route/${field} does not match plan route`);
        }
      }
    });
    const expected = run.jobs.every(job => job.result === 'pass') ? 'pass' : 'fail';
    if (run.result !== expected) errors.push(`/result must be ${expected} for job outcomes`);
    const schedulerIds = Object.keys(run.scheduler.state.tasks);
    if (!sameValues([...schedulerIds].sort(), [...planJobIds].sort())) {
      errors.push('/scheduler/state/tasks must correspond to plan jobs');
    }
    for (const [taskId, task] of Object.entries(run.scheduler.state.tasks)) {
      if (task.id !== taskId) errors.push(`/scheduler/state/tasks/${taskId}/id does not match task key`);
    }
    if (run.scheduler.state.event_count !== run.scheduler.events.length) {
      errors.push('/scheduler/state/event_count does not match scheduler events');
    }
    for (const [index, event] of run.scheduler.events.entries()) {
      if (event.task_id && !planJobIds.includes(event.task_id)) {
        errors.push(`/scheduler/events/${index}/task_id references an unknown plan job`);
      }
    }
    if (run.report.backend !== 'aggregate') errors.push('/report multi-job runs require an aggregate report');
    if (run.report.children?.length !== run.jobs.length) {
      errors.push('/report/children must contain one report per job');
    }
    return errors;
  }

  if (planJobIds.length !== 1 || planJobIds[0] !== run.job_id) {
    errors.push('/job_id single-job run must correspond to its only plan job');
  }
  if (
    run.plan.jobs[0]?.execution
    && contractDigest(run.execution) !== contractDigest(run.plan.jobs[0].execution)
  ) {
    errors.push('/execution does not match plan execution boundary');
  }
  for (const error of semanticFabricJobErrors({ ...run, kind: 'ecc.sandbox.fabric-job' })) {
    errors.push(error);
  }
  if (run.trajectory.plan_id !== run.plan.plan_id) {
    errors.push('/trajectory/plan_id does not match plan');
  }
  for (const field of ['backend', 'tier', 'os', 'arch']) {
    if (run.trajectory.route[field] !== run.plan.jobs[0]?.route[field]) {
      errors.push(`/trajectory/route/${field} does not match plan route`);
    }
  }
  return errors;
}

function validateCredentialRequest(request) {
  return validateWith(
    'credentialRequest',
    'sandbox credential request',
    request,
    semanticCredentialRequestErrors
  );
}

function validateExecutionPlan(plan) {
  return validateWith('executionPlan', 'sandbox execution plan', plan, semanticExecutionPlanErrors);
}

function validateExecutionBoundary(boundary) {
  return validateWith(
    'executionBoundary',
    'sandbox execution boundary',
    boundary,
    semanticExecutionBoundaryErrors
  );
}

function validateResourceMonitoring(receipt) {
  return validateWith(
    'resourceMonitoring',
    'sandbox resource monitoring receipt',
    receipt,
    semanticResourceMonitoringErrors
  );
}

function validatePatchArtifact(artifact) {
  return validateWith('patchArtifact', 'sandbox patch artifact', artifact, semanticPatchArtifactErrors);
}

function validateEvaluation(evaluation) {
  return validateWith('evaluation', 'sandbox evaluation', evaluation, semanticEvaluationErrors);
}

function validateTrajectory(trajectory) {
  return validateWith('trajectory', 'sandbox trajectory', trajectory, semanticTrajectoryErrors);
}

function validatePromotion(promotion, context = {}) {
  return validateWith(
    'promotion',
    'sandbox promotion',
    promotion,
    value => semanticPromotionErrors(value, context)
  );
}

function validateFabricWorkspaceReceipt(receipt) {
  return validateWith('fabricWorkspaceReceipt', 'sandbox fabric workspace receipt', receipt);
}

function validateFabricJob(job) {
  return validateWith('fabricJob', 'sandbox fabric job', job, semanticFabricJobErrors);
}

function validateFabricRun(run) {
  return validateWith('fabricRun', 'sandbox fabric run', run, semanticFabricRunErrors);
}

module.exports = {
  ContractValidationError,
  audienceAllows,
  contractDigest,
  schemaPaths,
  semanticCredentialRequestErrors,
  semanticEvaluationErrors,
  semanticExecutionBoundaryErrors,
  semanticExecutionPlanErrors,
  semanticFabricJobErrors,
  semanticFabricRunErrors,
  semanticPatchArtifactErrors,
  semanticPromotionErrors,
  semanticResourceMonitoringErrors,
  semanticTrajectoryErrors,
  validateCredentialRequest,
  validateEvaluation,
  validateExecutionBoundary,
  validateExecutionPlan,
  validateFabricJob,
  validateFabricRun,
  validateFabricWorkspaceReceipt,
  validatePatchArtifact,
  validatePromotion,
  validateResourceMonitoring,
  validateTrajectory,
};
