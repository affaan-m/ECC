'use strict';

const assert = require('assert');
const fs = require('fs');
const os = require('os');
const path = require('path');
const { spawnSync } = require('child_process');
const { validateReport } = require('../../scripts/sandbox/contracts');
const { validateExecutionPlan, validateTrajectory } = require('../../scripts/sandbox/fabric/contracts');
const { probeCapabilities } = require('../../scripts/sandbox/probe');

const repoRoot = path.join(__dirname, '..', '..');
const cliPath = path.join(repoRoot, 'scripts', 'sandbox', 'ecc-sandbox');

function blockedExitCode(requireHost) {
  return requireHost ? 2 : 0;
}

function classifyHost({ backend, capabilities, requiredHost = null }) {
  const host = capabilities.host;
  if (requiredHost && (host.os !== requiredHost.os || host.arch !== requiredHost.arch)) {
    return {
      status: 'skipped',
      reason: `requires ${requiredHost.os}/${requiredHost.arch}; detected ${host.os}/${host.arch}`,
      fix: null,
    };
  }
  const detected = capabilities.backends[backend];
  if (!detected?.available) {
    return {
      status: 'blocked',
      reason: detected?.reason || `${backend} is unavailable`,
      fix: detected?.fix || null,
    };
  }
  return { status: 'ready', reason: null, fix: null };
}

function printUnavailable({ backend, classification, requireHost, tier }) {
  const label = classification.status.toUpperCase();
  console.log(`  ${label}: real Tier ${tier} ${backend} fabric smoke did not run`);
  console.log(`  reason: ${classification.reason}`);
  if (classification.fix) console.log(`  fix: ${classification.fix}`);
  console.log(`  required_host: ${requireHost}`);
}

function runFabricCli({ capabilities, manifest, timeoutMs }) {
  const temporaryRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'ecc-fabric-host-'));
  let runDirectory = null;
  try {
    const capabilitiesPath = path.join(temporaryRoot, 'capabilities.json');
    fs.writeFileSync(capabilitiesPath, `${JSON.stringify(capabilities, null, 2)}\n`, {
      encoding: 'utf8',
      mode: 0o600,
      flag: 'wx',
    });
    const cli = spawnSync(process.execPath, [
      cliPath,
      'fabric',
      path.join(repoRoot, manifest),
      '--workspace-mode', 'in-place',
      '--local-only',
      '--capabilities', capabilitiesPath,
    ], {
      cwd: repoRoot,
      encoding: 'utf8',
      shell: false,
      timeout: timeoutMs,
      maxBuffer: 16 * 1024 * 1024,
    });
    assert.ifError(cli.error);
    assert.strictEqual(cli.stderr, '');
    const outcome = JSON.parse(cli.stdout);
    runDirectory = outcome.run_directory || null;
    assert.strictEqual(cli.status, 0, JSON.stringify(outcome, null, 2));
    return outcome;
  } finally {
    if (runDirectory) fs.rmSync(runDirectory, { recursive: true, force: true });
    fs.rmSync(temporaryRoot, { recursive: true, force: true });
  }
}

function assertRealOutcome(outcome, { backend, tier, requireCompleteDiff = false }) {
  assert.strictEqual(outcome.kind, 'ecc.sandbox.fabric-run');
  assert.strictEqual(outcome.result, 'pass');
  assert.strictEqual(validateExecutionPlan(outcome.plan), outcome.plan);
  assert.strictEqual(validateReport(outcome.report), outcome.report);
  assert.strictEqual(validateTrajectory(outcome.trajectory), outcome.trajectory);
  assert.match(outcome.trajectory_digest, /^[a-f0-9]{64}$/);
  assert.strictEqual(outcome.report.backend, backend);
  assert.strictEqual(outcome.report.tier, tier);
  assert.strictEqual(outcome.report.execution_mode, 'real');
  assert.strictEqual(outcome.report.result, 'pass');
  assert.strictEqual(outcome.cleanup.pass, true);
  assert.strictEqual(outcome.trajectory.cleanup.verified, true);
  assert.strictEqual(outcome.trajectory.cleanup.owned_resources_remaining, 0);
  if (requireCompleteDiff) assert.strictEqual(outcome.report.install_diff.complete, true);
}

function runHostFabricSmoke(options) {
  const requireHost = options.requireHost === true;
  const capabilities = probeCapabilities({ cwd: repoRoot });
  const classification = classifyHost({
    backend: options.backend,
    capabilities,
    requiredHost: options.requiredHost,
  });
  if (classification.status !== 'ready') {
    printUnavailable({
      backend: options.backend,
      classification,
      requireHost,
      tier: options.tier,
    });
    return blockedExitCode(requireHost);
  }

  try {
    const outcome = runFabricCli({
      capabilities,
      manifest: options.manifest,
      timeoutMs: options.timeoutMs,
    });
    assertRealOutcome(outcome, options);
    console.log(
      `  PASS: real Tier ${options.tier} ${options.backend} fabric smoke, `
      + `active=${outcome.report.duration_ms}ms, cleanup=verified`
    );
    return 0;
  } catch (error) {
    console.log(`  FAIL: real Tier ${options.tier} ${options.backend} fabric smoke`);
    console.log(`  error: ${error.stack || error.message}`);
    return 1;
  }
}

module.exports = {
  assertRealOutcome,
  blockedExitCode,
  classifyHost,
  runFabricCli,
  runHostFabricSmoke,
};
