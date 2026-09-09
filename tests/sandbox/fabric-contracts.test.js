'use strict';

const assert = require('assert');
const {
  ContractValidationError,
  contractDigest,
  validateCredentialRequest,
  validateEvaluation,
  validateExecutionBoundary,
  validateExecutionPlan,
  validateFabricJob,
  validateFabricRun,
  validateFabricWorkspaceReceipt,
  validatePatchArtifact,
  validatePromotion,
  validateTrajectory,
} = require('../../scripts/sandbox/fabric/contracts');
const { buildExecutionBoundary } = require('../../scripts/sandbox/fabric/execution-boundary');

let passed = 0;
let failed = 0;

function test(name, fn) {
  try {
    fn();
    console.log(`  ✓ ${name}`);
    passed += 1;
  } catch (error) {
    console.log(`  ✗ ${name}\n    Error: ${error.stack || error.message}`);
    failed += 1;
  }
}

function clone(value) {
  return JSON.parse(JSON.stringify(value));
}

const timestamp = '2026-08-25T12:00:00.000Z';
const sha256 = 'a'.repeat(64);
const otherSha256 = 'b'.repeat(64);
const commit = 'c'.repeat(40);

function credential(overrides = {}) {
  return {
    schema_version: 1,
    request_id: 'credential_npm',
    job_id: 'build',
    credential_ref: 'broker://npm/read-only',
    audience: ['registry.npmjs.org'],
    authorized_audience: ['*.npmjs.org'],
    scopes: ['packages:read'],
    ttl_seconds: 300,
    requested_at: timestamp,
    ...overrides,
  };
}

function testCredential(overrides = {}) {
  return credential({
    credential_ref: 'env:NPM_TOKEN',
    test_only: true,
    ...overrides,
  });
}

function plan(overrides = {}) {
  return {
    schema_version: 1,
    plan_id: 'plan_contract_test',
    created_at: timestamp,
    max_parallel: 2,
    jobs: [
      {
        job_id: 'build',
        depends_on: [],
        manifest: 'examples/sandbox/build.yaml',
        trust: 'first-party',
        network_audience: ['registry.npmjs.org'],
        workspace: { mode: 'worktree' },
        route: { backend: 'podman', tier: 1, os: 'linux', arch: 'arm64' },
        credential_request_ids: ['credential_npm'],
      },
      {
        job_id: 'verify',
        depends_on: ['build'],
        manifest: 'examples/sandbox/verify.yaml',
        trust: 'first-party',
        network_audience: [],
        workspace: { mode: 'isolated-copy' },
        route: { backend: 'lume', tier: 2, os: 'macos', arch: 'arm64' },
        credential_request_ids: [],
      },
    ],
    credential_requests: [credential()],
    ...overrides,
  };
}

function trajectory(overrides = {}) {
  return {
    schema_version: 1,
    trajectory_id: 'trajectory_contract_test',
    plan_id: 'plan_contract_test',
    job_id: 'build',
    run_id: 'run_1234567890abcdef1234567890abcdef',
    manifest_digest: sha256,
    worker: { id: 'worker_1', harness: 'codex', model: 'gpt-5' },
    route: {
      backend: 'podman', tier: 1, os: 'linux', arch: 'arm64', policy_version: '1',
    },
    environment: { digest: otherSha256, cache_key: sha256, warm: true },
    started_at: timestamp,
    completed_at: '2026-08-25T12:00:01.000Z',
    commands: [{ phase: 'assert', command: 'npm test', exit_code: 0 }],
    tests: [{ name: 'unit', result: 'pass' }],
    artifacts: [{ kind: 'patch', artifact_id: 'patch_contract_test', digest: sha256 }],
    credential_lease_ids: ['lease_npm_1'],
    cleanup: { verified: true, owned_resources_remaining: 0 },
    timings: { active_ms: 900, wall_ms: 1000 },
    cost: { amount: 0, currency: 'USD' },
    redactions: 1,
    result: 'pass',
    ...overrides,
  };
}

function patchArtifact(overrides = {}) {
  return {
    schema_version: 1,
    artifact_id: 'patch_contract_test',
    run_id: 'run_1234567890abcdef1234567890abcdef',
    job_id: 'build',
    worker_id: 'worker_1',
    workspace_mode: 'worktree',
    base: { ref: 'refs/heads/main', commit, tree_sha256: sha256 },
    candidate: { tree_sha256: otherSha256, byte_count: 120, file_count: 1 },
    patch: {
      relative_path: 'artifacts/candidate.patch',
      sha256,
      byte_count: 120,
      format: 'git-binary-diff',
    },
    files: [{
      path: 'src/example.js', status: 'modified', mode_before: '100644',
      mode_after: '100644', size: 80, sha256: otherSha256,
    }],
    findings: [],
    created_at: timestamp,
    ...overrides,
  };
}

function evaluation(artifact = patchArtifact(), overrides = {}) {
  return {
    schema_version: 1,
    evaluation_id: 'evaluation_contract_test',
    artifact_id: artifact.artifact_id,
    artifact_digest: contractDigest(artifact),
    evaluators: [{
      id: 'evaluator_1', version: '1', required: true, verdict: 'pass',
      findings: [], artifacts: [],
    }],
    verdict: 'accepted',
    created_at: timestamp,
    ...overrides,
  };
}

function promotion(artifact = patchArtifact(), receipt = evaluation(artifact), overrides = {}) {
  return {
    schema_version: 1,
    promotion_id: 'promotion_contract_test',
    artifact_id: artifact.artifact_id,
    evaluation_digest: contractDigest(receipt),
    target_ref: 'refs/heads/main',
    observed_target_oid: commit,
    base_oid: commit,
    candidate_ref: 'refs/ecc/candidates/patch_contract_test',
    candidate_commit: 'd'.repeat(40),
    checks: {
      evaluation_accepted: true,
      cleanup_verified: true,
      patch_digest_verified: true,
      target_unchanged: true,
    },
    result: 'promoted',
    created_at: timestamp,
    ...overrides,
  };
}

function workspaceReceipt(overrides = {}) {
  return {
    schema_version: 1,
    workspace_id: 'workspace_contract_test',
    mode: 'in-place',
    owned: false,
    base_ref: 'HEAD',
    base_oid: commit,
    input_digest: null,
    ...overrides,
  };
}

console.log('\n=== ECC sandbox execution-fabric contract tests ===\n');

test('accepts one strict valid instance of every public fabric contract', () => {
  const artifact = validatePatchArtifact(patchArtifact());
  const receipt = validateEvaluation(evaluation(artifact));
  assert.strictEqual(validateCredentialRequest(credential()).request_id, 'credential_npm');
  assert.strictEqual(validateExecutionPlan(plan()).jobs.length, 2);
  assert.strictEqual(validateTrajectory(trajectory()).result, 'pass');
  assert.strictEqual(validateFabricWorkspaceReceipt(workspaceReceipt()).mode, 'in-place');
  assert.strictEqual(receipt.verdict, 'accepted');
  assert.strictEqual(validatePromotion(promotion(artifact, receipt), { artifact, evaluation: receipt }).result, 'promoted');
});

test('fabric envelope contracts reject unknown public fields', () => {
  assert.throws(
    () => validateFabricWorkspaceReceipt({ ...workspaceReceipt(), owner_token: 'secret' }),
    ContractValidationError
  );
  assert.throws(
    () => validateFabricJob({ schema_version: 1, kind: 'ecc.sandbox.fabric-job', leaked: true }),
    ContractValidationError
  );
  assert.throws(
    () => validateFabricRun({ schema_version: 1, kind: 'ecc.sandbox.fabric-run', leaked: true }),
    ContractValidationError
  );

  const missingBase = workspaceReceipt();
  delete missingBase.base_ref;
  assert.throws(() => validateFabricWorkspaceReceipt(missingBase), ContractValidationError);
  assert.throws(
    () => validateFabricWorkspaceReceipt(workspaceReceipt({
      mode: 'isolated-copy',
      owned: false,
      input_digest: sha256,
    })),
    ContractValidationError
  );
});

test('execution plans bind hosted CI as a Tier 3 route', () => {
  const ciPlan = plan({
    jobs: [{
      ...plan().jobs[0],
      route: { backend: 'ci', tier: 3, os: 'linux', arch: 'x86_64' },
    }],
    credential_requests: [],
  });
  ciPlan.jobs[0].credential_request_ids = [];
  assert.strictEqual(validateExecutionPlan(ciPlan), ciPlan);
});

test('version two plans require truthful execution boundary claims', () => {
  const versionTwo = plan();
  versionTwo.schema_version = 2;
  versionTwo.jobs = versionTwo.jobs.map(job => ({
    ...job,
    execution: buildExecutionBoundary(job.route),
  }));
  assert.strictEqual(validateExecutionPlan(versionTwo), versionTwo);
  assert.strictEqual(validateExecutionBoundary(versionTwo.jobs[0].execution).coverage.scope, 'shell-only');

  const missing = clone(versionTwo);
  delete missing.jobs[0].execution;
  assert.throws(() => validateExecutionPlan(missing), /execution/i);

  const mislabeledV1 = plan();
  mislabeledV1.jobs[0].execution = buildExecutionBoundary(mislabeledV1.jobs[0].route);
  assert.throws(() => validateExecutionPlan(mislabeledV1), /execution/i);

  const drifted = clone(versionTwo);
  drifted.jobs[0].execution.execution_class = 'disposable-vm';
  assert.throws(() => validateExecutionPlan(drifted), /does not match route backend/i);

  const overstated = clone(versionTwo.jobs[0].execution);
  overstated.coverage.scope = 'whole-agent';
  assert.throws(() => validateExecutionBoundary(overstated), /whole-agent|excluded_surfaces/i);
});

test('rejects unknown properties across public contracts', () => {
  const cases = [
    [validateCredentialRequest, { ...credential(), secret_value: 'must-never-enter-contracts' }],
    [validateExecutionPlan, { ...plan(), backend_override: 'podman' }],
    [validateTrajectory, { ...trajectory(), raw_log: 'secret' }],
    [validatePatchArtifact, { ...patchArtifact(), apply_automatically: true }],
    [validateEvaluation, { ...evaluation(), worker_override: true }],
    [validatePromotion, { ...promotion(), force: true }],
  ];
  for (const [validate, value] of cases) {
    assert.throws(() => validate(value), ContractValidationError);
  }
});

test('execution plans require unique job, request, and dependency identifiers', () => {
  const duplicateJob = plan();
  duplicateJob.jobs.push(clone(duplicateJob.jobs[0]));
  assert.throws(() => validateExecutionPlan(duplicateJob), /duplicate job_id build/);

  const missingDependency = plan();
  missingDependency.jobs[1].depends_on = ['missing'];
  assert.throws(() => validateExecutionPlan(missingDependency), /unknown job missing/);

  const duplicateRequest = plan();
  duplicateRequest.credential_requests.push(clone(duplicateRequest.credential_requests[0]));
  assert.throws(() => validateExecutionPlan(duplicateRequest), /duplicate request_id credential_npm/);
});

test('execution plans reject dependency cycles including self-cycles', () => {
  const cycle = plan();
  cycle.jobs[0].depends_on = ['verify'];
  assert.throws(() => validateExecutionPlan(cycle), /dependency cycle/);

  const selfCycle = plan();
  selfCycle.jobs[0].depends_on = ['build'];
  assert.throws(() => validateExecutionPlan(selfCycle), /dependency cycle/);
});

test('untrusted jobs cannot use linked git worktrees', () => {
  const unsafe = plan();
  unsafe.jobs[0].trust = 'untrusted';
  assert.throws(() => validateExecutionPlan(unsafe), /untrusted jobs cannot use worktree/);

  unsafe.jobs[0].workspace.mode = 'isolated-copy';
  assert.doesNotThrow(() => validateExecutionPlan(unsafe));
});

test('credential requests can only narrow authorized and job audiences', () => {
  assert.doesNotThrow(() => validateCredentialRequest(credential()));
  assert.doesNotThrow(() => validateCredentialRequest(testCredential()));
  assert.throws(
    () => validateCredentialRequest(testCredential({ test_only: false })),
    ContractValidationError
  );
  assert.throws(
    () => validateCredentialRequest(credential({ credential_ref: 'env:NPM_TOKEN' })),
    ContractValidationError
  );
  assert.throws(
    () => validateCredentialRequest(credential({ audience: ['uploads.example.com'] })),
    /audience uploads\.example\.com is not authorized/
  );

  const widenedPlan = plan();
  widenedPlan.credential_requests[0].audience = ['downloads.npmjs.org'];
  assert.throws(() => validateExecutionPlan(widenedPlan), /exceeds job build network audience/);
});

test('evaluation verdict is derived from required evaluator outcomes', () => {
  const rejectedAsAccepted = evaluation(patchArtifact(), {
    evaluators: [{
      id: 'evaluator_1', version: '1', required: true, verdict: 'reject',
      findings: ['tests failed'], artifacts: [],
    }],
    verdict: 'accepted',
  });
  assert.throws(() => validateEvaluation(rejectedAsAccepted), /verdict must be rejected/);
});

test('promotion requires accepted bound evaluation, verified cleanup, and stable base', () => {
  const artifact = patchArtifact();
  const receipt = evaluation(artifact);
  assert.throws(
    () => validatePromotion(promotion(artifact, receipt)),
    /promoted requires bound patch and evaluation receipts/
  );
  assert.throws(
    () => validatePromotion(promotion(artifact, receipt, {
      checks: { ...promotion(artifact, receipt).checks, cleanup_verified: false },
    }), { artifact, evaluation: receipt }),
    /promoted requires every promotion check/
  );
  assert.throws(
    () => validatePromotion(promotion(artifact, receipt, { observed_target_oid: 'e'.repeat(40) }), {
      artifact, evaluation: receipt,
    }),
    /observed target must equal artifact base commit/
  );
  const substituted = clone(artifact);
  substituted.patch.sha256 = otherSha256;
  assert.throws(
    () => validatePromotion(promotion(artifact, receipt), { artifact: substituted, evaluation: receipt }),
    /evaluation artifact digest does not match patch artifact/
  );

  const selfEvaluation = evaluation(artifact, {
    evaluators: [{
      id: artifact.worker_id, version: '1', required: true, verdict: 'pass',
      findings: [], artifacts: [],
    }],
  });
  assert.throws(
    () => validatePromotion(promotion(artifact, selfEvaluation), {
      artifact, evaluation: selfEvaluation,
    }),
    /worker cannot evaluate its own patch/
  );

  const advisorySelfEvaluation = evaluation(artifact, {
    evaluators: [
      {
        id: 'evaluator_1', version: '1', required: true, verdict: 'pass',
        findings: [], artifacts: [],
      },
      {
        id: artifact.worker_id, version: '1', required: false, verdict: 'pass',
        findings: [], artifacts: [],
      },
    ],
  });
  assert.throws(
    () => validatePromotion(promotion(artifact, advisorySelfEvaluation), {
      artifact, evaluation: advisorySelfEvaluation,
    }),
    /worker cannot evaluate its own patch/
  );

  const stale = promotion(artifact, receipt, {
    observed_target_oid: 'e'.repeat(40),
    candidate_ref: null,
    candidate_commit: null,
    checks: {
      evaluation_accepted: true,
      cleanup_verified: true,
      patch_digest_verified: true,
      target_unchanged: false,
    },
    result: 'stale',
  });
  assert.strictEqual(
    validatePromotion(stale, { artifact, evaluation: receipt }).result,
    'stale'
  );
});

test('patch file receipts enforce status-consistent mode transitions', () => {
  const deleted = patchArtifact();
  deleted.candidate.file_count = 25;
  deleted.files[0] = {
    ...deleted.files[0], status: 'deleted', mode_before: '100644', mode_after: null,
    size: null, sha256: null,
  };
  assert.doesNotThrow(() => validatePatchArtifact(deleted));

  deleted.files[0].mode_after = '100644';
  assert.throws(() => validatePatchArtifact(deleted), /deleted files require mode_before and null mode_after/);

  deleted.files[0].mode_after = null;
  deleted.files[0].size = 10;
  assert.throws(() => validatePatchArtifact(deleted), /deleted files require null size and sha256/);

  const added = patchArtifact();
  added.files[0] = {
    ...added.files[0], status: 'added', mode_before: '100644', mode_after: '100644',
  };
  assert.throws(() => validatePatchArtifact(added), /added files require null mode_before and mode_after/);
});

test('error promotions may carry one bounded diagnostic', () => {
  const artifact = patchArtifact();
  const receipt = evaluation(artifact);
  const failed = promotion(artifact, receipt, {
    candidate_ref: null,
    candidate_commit: null,
    result: 'error',
    error: 'atomic ref update failed',
  });
  assert.strictEqual(validatePromotion(failed, { artifact, evaluation: receipt }).error, 'atomic ref update failed');
});

console.log(`\nPassed: ${passed}`);
console.log(`Failed: ${failed}`);
process.exit(failed > 0 ? 1 : 0);
