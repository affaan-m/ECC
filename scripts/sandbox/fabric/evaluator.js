'use strict';

const crypto = require('crypto');
const fs = require('fs');
const { spawnSync } = require('child_process');
const { canonicalContractJson } = require('../contracts');
const { validateEvaluation } = require('./contracts');
const {
  artifactPatchPath,
  digestArtifact,
  sha256,
} = require('./patch-artifact');

const BUILTIN_EVALUATORS = new Set([
  'artifact-integrity',
  'sandbox-pass',
  'patch-policy',
  'secret-scan',
]);
const SECRET_PATTERNS = [
  { rule: 'private-key', pattern: /-----BEGIN [A-Z ]*PRIVATE KEY-----/i },
  { rule: 'bearer-token', pattern: /\bBearer\s+[A-Za-z0-9._~+/=-]{12,}/i },
  { rule: 'provider-token', pattern: /\b(?:ghp|gho|ghu|ghs|ghr)_[A-Za-z0-9_]{20,}\b/i },
  { rule: 'openai-style-key', pattern: /\b(?:sk|rk)-[A-Za-z0-9_-]{20,}\b/i },
  { rule: 'secret-assignment', pattern: /\b(?:api[_-]?key|token|password|passwd|secret)\s*[=:]\s*["']?[A-Za-z0-9._~+/=-]{16,}/i },
];

function deepFreeze(value) {
  if (value && typeof value === 'object' && !Object.isFrozen(value)) {
    Object.freeze(value);
    for (const item of Object.values(value)) deepFreeze(item);
  }
  return value;
}

function digestEvaluation(evaluation) {
  return crypto.createHash('sha256').update(canonicalContractJson(evaluation)).digest('hex');
}

function finding(rule, message, severity = 'error') {
  return `${severity}:${rule}: ${message}`;
}

function evaluatorResult(id, verdict, findings = [], artifacts = []) {
  return {
    id,
    version: '1',
    required: true,
    verdict,
    findings,
    artifacts,
  };
}

function artifactIntegrity(artifact) {
  const patchPath = artifactPatchPath(artifact);
  if (!patchPath) {
    return evaluatorResult('artifact-integrity', 'pass');
  }
  try {
    const stats = fs.lstatSync(patchPath);
    if (!stats.isFile() || stats.isSymbolicLink()) {
      return evaluatorResult('artifact-integrity', 'reject', [finding('patch-type', 'Patch artifact is not a regular file')]);
    }
    const bytes = fs.readFileSync(patchPath);
    const findings = [];
    if (bytes.length !== artifact.patch.byte_count) findings.push(finding('patch-size', 'Patch artifact byte count does not match its receipt'));
    if (sha256(bytes) !== artifact.patch.sha256) findings.push(finding('patch-digest', 'Patch artifact digest does not match its receipt'));
    return evaluatorResult('artifact-integrity', findings.length > 0 ? 'reject' : 'pass', findings);
  } catch {
    return evaluatorResult('artifact-integrity', 'reject', [finding('patch-missing', 'Patch artifact is unavailable')]);
  }
}

function sandboxPass(artifact, policy) {
  const findings = [];
  if (policy.sandboxResult !== 'pass') findings.push(finding('sandbox-result', `Sandbox result is ${policy.sandboxResult || 'unknown'}`));
  if (policy.cleanupPass !== true) findings.push(finding('cleanup-result', 'Sandbox cleanup was not verified'));
  if (artifact.workspace_mode === 'in-place') findings.push(finding('workspace-isolation', 'In-place workspaces cannot be promoted automatically'));
  return evaluatorResult('sandbox-pass', findings.length > 0 ? 'reject' : 'pass', findings);
}

function patchPolicy(artifact, policy) {
  const findings = [];
  if (!Array.isArray(artifact.files) || artifact.files.length === 0) {
    findings.push(finding('empty-patch', 'Candidate patch contains no file changes'));
  }
  if (artifact.patch.byte_count > (policy.maxPatchBytes ?? 64 * 1024 * 1024)) {
    findings.push(finding('patch-size', 'Candidate patch exceeds evaluator policy'));
  }
  for (const file of artifact.files || []) {
    if (!file.path || file.path.startsWith('/') || file.path.split('/').includes('..')) {
      findings.push(finding('unsafe-path', 'Candidate contains a path outside the repository'));
    }
    if (file.path.split('/').includes('.git')) {
      findings.push(finding('git-metadata', 'Candidate contains forbidden Git metadata'));
    }
  }
  for (const reported of artifact.findings || []) {
    if (reported.severity === 'error') {
      findings.push(finding(reported.rule || 'artifact-finding', reported.message || 'Artifact contains an error finding'));
    }
  }
  return evaluatorResult('patch-policy', findings.length > 0 ? 'reject' : 'pass', findings);
}

function secretScan(artifact) {
  const patchPath = artifactPatchPath(artifact);
  if (!patchPath) return evaluatorResult('secret-scan', 'pass');
  let patch;
  try {
    patch = fs.readFileSync(patchPath, 'utf8');
  } catch {
    return evaluatorResult('secret-scan', 'inconclusive', [finding('patch-unavailable', 'Patch was unavailable for secret scanning', 'warning')]);
  }
  const findings = SECRET_PATTERNS
    .filter(candidate => candidate.pattern.test(patch))
    .map(candidate => finding(candidate.rule, `Potential credential material matched ${candidate.rule}; value omitted`));
  return evaluatorResult('secret-scan', findings.length > 0 ? 'reject' : 'pass', findings);
}

function runCommandEvaluator(specification, policy) {
  if (!specification || typeof specification.executable !== 'string' || !Array.isArray(specification.args)) {
    return evaluatorResult(specification?.id || 'command', 'inconclusive', [finding('command-contract', 'Evaluator command contract is invalid', 'warning')]);
  }
  const runner = policy.run || ((executable, argv, options) => spawnSync(executable, argv, {
    ...options,
    encoding: 'utf8',
    shell: false,
    windowsHide: true,
    timeout: specification.timeout_ms || 60_000,
    maxBuffer: 4 * 1024 * 1024,
  }));
  const result = runner(specification.executable, [...specification.args], {
    cwd: policy.candidatePath,
    env: policy.environment || {},
  });
  const evidence = crypto.createHash('sha256')
    .update(`${result.status}\0${result.stdout || ''}\0${result.stderr || ''}`)
    .digest('hex');
  return evaluatorResult(
    specification.id,
    !result.error && result.status === 0 ? 'pass' : 'reject',
    !result.error && result.status === 0 ? [] : [finding('command-failed', `Evaluator command exited ${result.status ?? 'without status'}`)],
    [evidence]
  );
}

function evaluateArtifact(artifact, policy = {}) {
  if (!artifact || artifact.schema_version !== 1 || !artifact.patch || !artifact.artifact_id) {
    throw new Error('Patch artifact is invalid');
  }
  const required = policy.required || ['artifact-integrity', 'sandbox-pass', 'patch-policy', 'secret-scan'];
  if (!Array.isArray(required) || required.length === 0) throw new Error('At least one evaluator is required');
  const commandSpecs = new Map((policy.commands || []).map(command => [command.id, command]));
  const evaluators = required.map(id => {
    if (id === 'artifact-integrity') return artifactIntegrity(artifact);
    if (id === 'sandbox-pass') return sandboxPass(artifact, policy);
    if (id === 'patch-policy') return patchPolicy(artifact, policy);
    if (id === 'secret-scan') return secretScan(artifact);
    if (commandSpecs.has(id)) return runCommandEvaluator(commandSpecs.get(id), policy);
    return evaluatorResult(id, 'inconclusive', [finding('evaluator-missing', `Required evaluator is unavailable: ${id}`, 'warning')]);
  });
  const verdict = evaluators.some(item => item.verdict === 'reject')
    ? 'rejected'
    : (evaluators.some(item => item.verdict !== 'pass') ? 'inconclusive' : 'accepted');
  const evaluation = {
    schema_version: 1,
    evaluation_id: `evaluation_${crypto.randomBytes(12).toString('hex')}`,
    artifact_id: artifact.artifact_id,
    artifact_digest: digestArtifact(artifact),
    evaluators,
    verdict,
    created_at: new Date().toISOString(),
  };
  validateEvaluation(evaluation);
  return deepFreeze(evaluation);
}

module.exports = {
  BUILTIN_EVALUATORS,
  SECRET_PATTERNS,
  deepFreeze,
  digestEvaluation,
  evaluateArtifact,
};
