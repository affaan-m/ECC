'use strict';

const assert = require('assert');
const fs = require('fs');
const os = require('os');
const path = require('path');
const fabric = require('../../scripts/sandbox/fabric');
const { executeRoute, runApprovedRoute } = require('../../scripts/sandbox/ecc-sandbox');
const {
  createFabricPlan,
  executionFabric,
  summarizeTrajectory,
} = fabric;

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

function manifest(overrides = {}) {
  return {
    name: 'fabric-test',
    needs: {
      os: ['linux'],
      capabilities: overrides.capabilities || ['pkg-install', 'network:*'],
      trust: overrides.trust || 'first-party',
      native: overrides.native || false,
    },
    resources: { cpu: 2, memory: '1GB', timeout: 120 },
    steps: { setup: ['printf setup'], assert: ['printf assert'] },
    report: overrides.report || 'install-diff',
  };
}

function route(overrides = {}) {
  return {
    os: overrides.os || 'linux',
    arch: overrides.arch || 'arm64',
    backend: overrides.backend || 'podman',
    tier: overrides.tier ?? 1,
    rule: 'fixture',
    reason: 'fixture',
    notes: [],
    result: 'routable',
  };
}

console.log('\n=== ECC sandbox execution fabric tests ===\n');

test('plans all eight meta-harness controls for a routable decision', () => {
  const decision = { routes: [route()], result: 'routable' };
  const plan = createFabricPlan(manifest(), decision, {
    workspaceMode: 'worktree',
    manifestPath: 'examples/sandbox/fabric-test.yaml',
    maxParallel: 4,
    createdAt: '2026-08-25T12:00:00.000Z',
    planId: 'plan_fabric_test',
  });
  assert.strictEqual(executionFabric.contracts.validateExecutionPlan(plan), plan);
  assert.strictEqual(plan.plan_id, 'plan_fabric_test');
  assert.strictEqual(plan.max_parallel, 4);
  assert.strictEqual(plan.jobs[0].workspace.mode, 'worktree');
  assert.strictEqual(plan.jobs[0].manifest, 'examples/sandbox/fabric-test.yaml');
  assert.deepStrictEqual(plan.jobs[0].route, {
    backend: 'podman', tier: 1, os: 'linux', arch: 'arm64',
  });
  assert.deepStrictEqual(plan.credential_requests, []);
});

test('exports the hardened execution-fabric building blocks through one facade', () => {
  assert.deepStrictEqual(Object.keys(executionFabric).sort(), [
    'artifacts',
    'contracts',
    'credentials',
    'environment',
    'evaluation',
    'events',
    'patches',
    'promotion',
    'routing',
    'scheduler',
    'snapshots',
    'trajectory',
    'visual',
    'workspace',
  ]);
  assert.strictEqual(typeof executionFabric.workspace.prepareWorkspace, 'function');
  assert.strictEqual(typeof executionFabric.scheduler.createScheduler, 'function');
  assert.strictEqual(typeof executionFabric.credentials.CredentialBroker, 'function');
  assert.strictEqual(typeof executionFabric.promotion.promoteCandidate, 'function');
  assert.strictEqual(typeof executionFabric.visual.normalizeVisualEvidence, 'function');
  for (const removed of [
    'credentialEnvironment',
    'prepareExecutionWorkspace',
    'cleanupExecutionWorkspace',
    'createPromotionPatch',
  ]) {
    assert.strictEqual(fabric[removed], undefined, `${removed} must not bypass hardened modules`);
  }
});

test('auto workspace uses isolated copy for untrusted Tier 0 work', () => {
  const plan = createFabricPlan(manifest({ trust: 'untrusted', capabilities: ['fs-write'] }), {
    result: 'routable',
    routes: [route({ backend: 'srt', tier: 0, os: 'macos' })],
  }, {
    workspaceMode: 'auto',
    manifestPath: 'sandbox.yaml',
  });
  assert.strictEqual(plan.jobs[0].workspace.mode, 'isolated-copy');
  assert.throws(() => createFabricPlan(manifest({ trust: 'untrusted' }), {
    result: 'routable', routes: [route({ backend: 'srt', tier: 0 })],
  }, { workspaceMode: 'worktree' }), /isolated-copy/);
});

test('route execution honors a trusted prepared workspace cwd', () => {
  const workspace = fs.mkdtempSync(path.join(os.tmpdir(), 'ecc-fabric-cwd-'));
  const calls = [];
  try {
    const outcome = executeRoute({
      manifest: manifest({ capabilities: [], report: 'exit-only' }),
      manifestPath: path.join(workspace, 'sandbox.yaml'),
      capabilities: { schema_version: 1, host: { os: 'macos', arch: 'arm64' }, backends: {} },
    }, route({ backend: 'srt', tier: 0, os: 'macos' }), {
      cwd: workspace,
      mock: true,
      run: (executable, argv, options) => {
        calls.push({ executable, argv, options });
        return { status: 0, stdout: '', stderr: '' };
      },
    });
    assert.strictEqual(outcome.report.result, 'pass');
    assert.strictEqual(calls.length, 2);
    assert.ok(calls.every(call => call.options.cwd === workspace));
  } finally {
    fs.rmSync(workspace, { recursive: true, force: true });
  }
});

test('approved route execution cannot reroute or auto-escalate', () => {
  const workspace = fs.mkdtempSync(path.join(os.tmpdir(), 'ecc-fabric-approved-route-'));
  const approvedRoute = Object.freeze({
    backend: 'srt', tier: 0, os: 'macos', arch: 'arm64',
  });
  const resolved = {
    manifest: manifest({ capabilities: [], report: 'exit-only' }),
    manifestPath: path.join(workspace, 'sandbox.yaml'),
    capabilities: { schema_version: 1, host: { os: 'macos', arch: 'arm64' }, backends: {} },
    decision: { result: 'routable', routes: [route({ backend: 'srt', tier: 0, os: 'macos' })] },
  };
  const calls = [];
  try {
    const outcome = runApprovedRoute(resolved, approvedRoute, {
      cwd: workspace,
      mock: true,
      run: (executable, argv, options) => {
        calls.push({ executable, argv, options });
        return { status: 0, stdout: '', stderr: '' };
      },
    });
    assert.strictEqual(outcome.report.backend, 'srt');
    assert.strictEqual(outcome.report.tier, 0);
    assert.strictEqual(outcome.report.os, 'macos');
    assert.strictEqual(outcome.report.arch, 'arm64');
    assert.deepStrictEqual(outcome.report.escalations, []);
    assert.strictEqual(calls.length, 2);
    assert.throws(
      () => runApprovedRoute(resolved, Object.freeze({ ...approvedRoute, backend: 'podman', tier: 1 }), {
        cwd: workspace, mock: true, run: () => ({ status: 0, stdout: '', stderr: '' }),
      }),
      /approved route is not present in the resolved plan/i
    );
  } finally {
    fs.rmSync(workspace, { recursive: true, force: true });
  }
});

test('summarizes trajectory without exposing redacted secret material', () => {
  const summary = summarizeTrajectory([
    { type: 'run.created', phase: 'session' },
    { type: 'step.output', phase: 'setup', text: '[REDACTED]', redaction_count: 1 },
    { type: 'cleanup.completed', phase: 'cleanup', pass: true },
  ], { result: 'pass', install_diff: { complete: true } }, {
    active_total_ms: 25,
    review_wait_ms: 5,
  });
  assert.deepStrictEqual(summary.phases, ['session', 'setup', 'cleanup']);
  assert.strictEqual(summary.redactions, 1);
  assert.strictEqual(summary.evidence_complete, true);
  assert.match(summary.sha256, /^[a-f0-9]{64}$/);
});

console.log(`\nPassed: ${passed}`);
console.log(`Failed: ${failed}`);
process.exit(failed > 0 ? 1 : 0);
