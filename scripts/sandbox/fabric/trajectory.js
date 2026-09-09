'use strict';

const { contractDigest } = require('../contracts');
const { validateTrajectory } = require('./contracts');
const { redactText } = require('../session-store');
const { normalizeArtifactRef } = require('./artifact-store');

const MAX_TRAJECTORY_BYTES = 1024 * 1024;
const HASH_PATTERN = /^[a-f0-9]{64}$/;
const ID_PATTERN = /^[A-Za-z0-9][A-Za-z0-9._:-]{0,119}$/;
const TIMESTAMP_PATTERN = /^[0-9]{4}-[0-9]{2}-[0-9]{2}T[0-9]{2}:[0-9]{2}:[0-9]{2}(?:\.[0-9]{3})?Z$/;
const ARTIFACT_KINDS = new Set(['report', 'patch', 'evaluation', 'recording', 'visual']);
const COMMAND_PHASES = new Set(['setup', 'assert', 'evaluate', 'promote']);
const TEST_RESULTS = new Set(['pass', 'fail', 'error', 'skipped']);

function requireString(value, label, maximum, pattern = null) {
  if (typeof value !== 'string' || value.length === 0 || value.length > maximum) {
    throw new Error(`${label} must be a string between 1 and ${maximum} characters`);
  }
  if (pattern && !pattern.test(value)) throw new Error(`${label} is invalid`);
  return value;
}

function requireId(value, label) {
  return requireString(value, label, 120, ID_PATTERN);
}

function requireHash(value, label, optional = false) {
  if ((value === null || value === undefined) && optional) return null;
  if (!HASH_PATTERN.test(String(value || ''))) {
    throw new Error(`${label} must be 64 lowercase hex characters`);
  }
  return value;
}

function requireTimestamp(value, label) {
  return requireString(value, label, 40, TIMESTAMP_PATTERN);
}

function requireInteger(value, label, minimum = 0) {
  if (!Number.isSafeInteger(value) || value < minimum) {
    throw new Error(`${label} must be an integer no lower than ${minimum}`);
  }
  return value;
}

function requireObject(value, label) {
  if (!value || typeof value !== 'object' || Array.isArray(value)) {
    throw new Error(`${label} must be an object`);
  }
  return value;
}

function assertOnlyKeys(value, allowed, label) {
  const unexpected = Object.keys(value).find(key => !allowed.has(key));
  if (unexpected) throw new Error(`${label} contains unsupported field ${unexpected}`);
}

function redact(value, state) {
  if (value === undefined) throw new Error('Trajectory metadata contains undefined value');
  const redacted = redactText(value);
  state.count += redacted.redaction_count;
  return redacted.text;
}

function normalizeWorker(worker, redactions) {
  requireObject(worker, 'worker');
  assertOnlyKeys(worker, new Set(['id', 'harness', 'model']), 'worker');
  return {
    id: requireId(worker.id, 'worker.id'),
    harness: requireString(redact(worker.harness, redactions), 'worker.harness', 120),
    model: requireString(redact(worker.model, redactions), 'worker.model', 200),
  };
}

function normalizeRoute(route) {
  requireObject(route, 'route');
  assertOnlyKeys(route, new Set(['backend', 'tier', 'os', 'arch', 'policy_version']), 'route');
  return {
    backend: requireString(route.backend, 'route.backend', 80),
    tier: requireInteger(route.tier, 'route.tier'),
    os: requireString(route.os, 'route.os', 20),
    arch: requireString(route.arch, 'route.arch', 20),
    policy_version: requireString(route.policy_version, 'route.policy_version', 120),
  };
}

function normalizeEnvironment(environment) {
  requireObject(environment, 'environment');
  assertOnlyKeys(environment, new Set(['digest', 'cache_key', 'warm']), 'environment');
  if (typeof environment.warm !== 'boolean') throw new Error('environment.warm must be boolean');
  return {
    digest: requireHash(environment.digest, 'environment.digest'),
    cache_key: requireHash(environment.cache_key, 'environment.cache_key', true),
    warm: environment.warm,
  };
}

function normalizeCommands(commands, redactions) {
  if (!Array.isArray(commands) || commands.length > 2000) {
    throw new Error('commands must be an array with no more than 2000 entries');
  }
  return commands.map((command, index) => {
    requireObject(command, `commands[${index}]`);
    assertOnlyKeys(command, new Set(['phase', 'command', 'exit_code']), `commands[${index}]`);
    if (!COMMAND_PHASES.has(command.phase)) {
      throw new Error(`commands[${index}].phase is unsupported`);
    }
    return {
      phase: command.phase,
      command: requireString(redact(command.command, redactions), `commands[${index}].command`, 8192),
      exit_code: requireInteger(command.exit_code, `commands[${index}].exit_code`, -2147483648),
    };
  });
}

function normalizeTests(tests, redactions) {
  if (!Array.isArray(tests) || tests.length > 2000) {
    throw new Error('tests must be an array with no more than 2000 entries');
  }
  return tests.map((test, index) => {
    requireObject(test, `tests[${index}]`);
    assertOnlyKeys(test, new Set(['name', 'result']), `tests[${index}]`);
    if (!TEST_RESULTS.has(test.result)) throw new Error(`tests[${index}].result is unsupported`);
    return {
      name: requireString(redact(test.name, redactions), `tests[${index}].name`, 512),
      result: test.result,
    };
  });
}

function normalizeArtifacts(artifacts) {
  if (!Array.isArray(artifacts) || artifacts.length > 1000) {
    throw new Error('artifacts must be an array with no more than 1000 entries');
  }
  const seen = new Set();
  return artifacts.map((artifact, index) => {
    requireObject(artifact, `artifacts[${index}]`);
    assertOnlyKeys(artifact, new Set(['kind', 'artifact_id', 'digest']), `artifacts[${index}]`);
    if (!ARTIFACT_KINDS.has(artifact.kind)) {
      throw new Error(`artifacts[${index}].kind is unsupported`);
    }
    const artifactId = requireId(artifact.artifact_id, `artifacts[${index}].artifact_id`);
    if (seen.has(artifactId)) throw new Error(`artifacts contains duplicate artifact_id ${artifactId}`);
    seen.add(artifactId);
    return {
      kind: artifact.kind,
      artifact_id: artifactId,
      digest: requireHash(artifact.digest, `artifacts[${index}].digest`),
    };
  });
}

function normalizeEvidenceRefs(references) {
  if (references === undefined) return [];
  if (!Array.isArray(references) || references.length > 128) {
    throw new Error('evidence_refs must be an array with no more than 128 entries');
  }
  return references.map((reference, index) => {
    const normalized = normalizeArtifactRef(reference, { maxBytes: 128 * 1024 * 1024 });
    if (!normalized.redacted) throw new Error('evidence_refs must contain only redacted evidence refs');
    return {
      kind: 'report',
      artifact_id: `evidence:${index + 1}`,
      digest: normalized.sha256,
    };
  });
}

function normalizeCredentialLeaseIds(ids) {
  if (!Array.isArray(ids) || ids.length > 64) {
    throw new Error('credential_lease_ids must be an array with no more than 64 entries');
  }
  const normalized = ids.map((id, index) => requireId(id, `credential_lease_ids[${index}]`));
  if (new Set(normalized).size !== normalized.length) {
    throw new Error('credential_lease_ids contains duplicates');
  }
  return normalized;
}

function normalizeCleanup(cleanup) {
  requireObject(cleanup, 'cleanup');
  assertOnlyKeys(cleanup, new Set(['verified', 'owned_resources_remaining']), 'cleanup');
  if (typeof cleanup.verified !== 'boolean') throw new Error('cleanup.verified must be boolean');
  return {
    verified: cleanup.verified,
    owned_resources_remaining: requireInteger(
      cleanup.owned_resources_remaining,
      'cleanup.owned_resources_remaining'
    ),
  };
}

function normalizeTimings(timings) {
  requireObject(timings, 'timings');
  assertOnlyKeys(timings, new Set(['active_ms', 'wall_ms']), 'timings');
  return {
    active_ms: requireInteger(timings.active_ms, 'timings.active_ms'),
    wall_ms: requireInteger(timings.wall_ms, 'timings.wall_ms'),
  };
}

function normalizeCost(cost) {
  requireObject(cost, 'cost');
  assertOnlyKeys(cost, new Set(['amount', 'currency']), 'cost');
  if (!Number.isFinite(cost.amount) || cost.amount < 0) {
    throw new Error('cost.amount must be a non-negative number');
  }
  return {
    amount: cost.amount,
    currency: requireString(cost.currency, 'cost.currency', 3, /^[A-Z]{3}$/),
  };
}

function buildTrajectory(input) {
  requireObject(input, 'Trajectory input');
  if (input.previous_sha256 !== undefined) {
    requireHash(input.previous_sha256, 'previous_sha256', true);
  }
  const redactionState = {
    count: requireInteger(input.redactions || 0, 'redactions'),
  };
  const artifacts = [
    ...normalizeArtifacts(input.artifacts || []),
    ...normalizeEvidenceRefs(input.evidence_refs),
  ];
  if (new Set(artifacts.map(artifact => artifact.artifact_id)).size !== artifacts.length) {
    throw new Error('artifacts contains duplicate artifact_id');
  }
  const trajectory = {
    schema_version: 1,
    trajectory_id: requireId(input.trajectory_id, 'trajectory_id'),
    plan_id: requireId(input.plan_id, 'plan_id'),
    job_id: requireId(input.job_id, 'job_id'),
    run_id: requireId(input.run_id, 'run_id'),
    manifest_digest: requireHash(input.manifest_digest, 'manifest_digest'),
    worker: normalizeWorker(input.worker, redactionState),
    route: normalizeRoute(input.route),
    environment: normalizeEnvironment(input.environment),
    started_at: requireTimestamp(input.started_at, 'started_at'),
    completed_at: requireTimestamp(input.completed_at, 'completed_at'),
    commands: normalizeCommands(input.commands || [], redactionState),
    tests: normalizeTests(input.tests || [], redactionState),
    artifacts,
    credential_lease_ids: normalizeCredentialLeaseIds(input.credential_lease_ids || []),
    cleanup: normalizeCleanup(input.cleanup),
    timings: normalizeTimings(input.timings),
    cost: normalizeCost(input.cost),
    redactions: redactionState.count,
    result: input.result,
  };
  if (Buffer.byteLength(JSON.stringify(trajectory), 'utf8') > MAX_TRAJECTORY_BYTES) {
    throw new Error(`Trajectory exceeds ${MAX_TRAJECTORY_BYTES} bytes`);
  }
  return validateTrajectory(trajectory);
}

function trajectoryDigest(trajectory) {
  return contractDigest(validateTrajectory(trajectory));
}

function verifyTrajectory(trajectory, expectedDigest = null) {
  try {
    validateTrajectory(trajectory);
    if (expectedDigest === null || expectedDigest === undefined) return true;
    return requireHash(expectedDigest, 'expected trajectory digest') === contractDigest(trajectory);
  } catch {
    return false;
  }
}

module.exports = {
  HASH_PATTERN,
  MAX_TRAJECTORY_BYTES,
  buildTrajectory,
  trajectoryDigest,
  verifyTrajectory,
};
