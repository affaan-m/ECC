'use strict';

const assert = require('assert');
const crypto = require('crypto');
const fs = require('fs');
const os = require('os');
const path = require('path');
const { execFileSync } = require('child_process');
const {
  buildPatchArtifact,
  digestArtifact,
} = require('../../scripts/sandbox/fabric/patch-artifact');
const {
  digestEvaluation,
  evaluateArtifact,
} = require('../../scripts/sandbox/fabric/evaluator');
const { promoteCandidate } = require('../../scripts/sandbox/fabric/promoter');

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

function withTemp(fn) {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'ecc-fabric-promotion-'));
  try {
    return fn(root);
  } finally {
    fs.rmSync(root, { recursive: true, force: true });
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

function createRepository(root) {
  const repository = path.join(root, 'repository');
  fs.mkdirSync(repository);
  git(repository, 'init', '-b', 'main');
  fs.writeFileSync(path.join(repository, 'app.js'), 'module.exports = 1;\n');
  git(repository, 'add', '.');
  git(repository, 'commit', '-m', 'base');
  return repository;
}

function candidateArtifact(root, repository, content = 'module.exports = 2;\n') {
  const candidate = path.join(root, `candidate-${crypto.randomBytes(3).toString('hex')}`);
  fs.mkdirSync(candidate);
  fs.writeFileSync(path.join(candidate, 'app.js'), content);
  const runDirectory = path.join(root, `run-${crypto.randomBytes(3).toString('hex')}`);
  const artifact = buildPatchArtifact({
    basePath: repository,
    baseRef: 'refs/heads/main',
    candidatePath: candidate,
    runDirectory,
    runId: 'run_1234567890abcdef1234567890abcdef',
    jobId: 'worker-a',
  });
  return { artifact, candidate, runDirectory };
}

function acceptedEvaluation(artifact, overrides = {}) {
  return evaluateArtifact(artifact, {
    required: overrides.required || ['artifact-integrity', 'sandbox-pass', 'patch-policy', 'secret-scan'],
    sandboxResult: overrides.sandboxResult || 'pass',
    cleanupPass: overrides.cleanupPass !== false,
  });
}

function candidateRefExists(repository, candidateRef) {
  try {
    git(repository, 'show-ref', '--verify', '--quiet', candidateRef);
    return true;
  } catch {
    return false;
  }
}

console.log('\n=== ECC fabric evaluation and promotion tests ===\n');

test('accepts only intact artifacts with passing sandbox and cleanup evidence', () => withTemp(root => {
  const repository = createRepository(root);
  const { artifact } = candidateArtifact(root, repository);
  const evaluation = acceptedEvaluation(artifact);

  assert.strictEqual(evaluation.verdict, 'accepted');
  assert.strictEqual(evaluation.artifact_digest, digestArtifact(artifact));
  assert.ok(evaluation.evaluators.every(item => item.verdict === 'pass'));
  assert.match(digestEvaluation(evaluation), /^[a-f0-9]{64}$/);

  const inconclusive = acceptedEvaluation(artifact, { cleanupPass: false });
  assert.strictEqual(inconclusive.verdict, 'rejected');
  assert.strictEqual(inconclusive.evaluators.find(item => item.id === 'sandbox-pass').verdict, 'reject');
}));

test('secret scanning deterministically rejects credential material in a patch', () => withTemp(root => {
  const repository = createRepository(root);
  const { artifact } = candidateArtifact(root, repository, 'const API_KEY = "sk-1234567890abcdefghijklmnop";\n');
  const evaluation = acceptedEvaluation(artifact);
  assert.strictEqual(evaluation.verdict, 'rejected');
  const scan = evaluation.evaluators.find(item => item.id === 'secret-scan');
  assert.strictEqual(scan.verdict, 'reject');
  assert.ok(scan.findings.length > 0);
  assert.ok(scan.findings.every(finding => !JSON.stringify(finding).includes('sk-1234567890')));
}));

test('promotes an accepted digest only to a separate candidate branch', () => withTemp(root => {
  const repository = createRepository(root);
  const mainBefore = git(repository, 'rev-parse', 'refs/heads/main');
  const workingBefore = fs.readFileSync(path.join(repository, 'app.js'), 'utf8');
  const { artifact, runDirectory } = candidateArtifact(root, repository);
  const evaluation = acceptedEvaluation(artifact);
  const candidateRef = 'refs/heads/ecc/candidates/worker-a';

  const receipt = promoteCandidate({
    artifact,
    evaluation,
    repositoryPath: repository,
    runDirectory,
    targetRef: 'refs/heads/main',
    candidateRef,
    checks: [{ name: 'syntax', executable: process.execPath, args: ['--check', 'app.js'] }],
  });

  assert.strictEqual(receipt.result, 'promoted');
  assert.strictEqual(receipt.artifact_id, artifact.artifact_id);
  assert.strictEqual(receipt.evaluation_digest, digestEvaluation(evaluation));
  assert.strictEqual(receipt.target_ref, 'refs/heads/main');
  assert.strictEqual(receipt.observed_target_oid, mainBefore);
  assert.strictEqual(receipt.base_oid, mainBefore);
  assert.strictEqual(receipt.candidate_ref, candidateRef);
  assert.match(receipt.candidate_commit, /^[a-f0-9]{40,64}$/);
  assert.strictEqual(git(repository, 'rev-parse', 'refs/heads/main'), mainBefore);
  assert.strictEqual(fs.readFileSync(path.join(repository, 'app.js'), 'utf8'), workingBefore);
  assert.strictEqual(git(repository, 'show', `${candidateRef}:app.js`), 'module.exports = 2;');
  assert.strictEqual(fs.readdirSync(runDirectory).some(name => name.startsWith('promotion-')), false);
}));

test('refuses rejected evaluations and tampered patch artifacts', () => withTemp(root => {
  const repository = createRepository(root);
  const { artifact, runDirectory } = candidateArtifact(root, repository, 'const API_KEY = "sk-1234567890abcdefghijklmnop";\n');
  const rejected = acceptedEvaluation(artifact);
  const candidateRef = 'refs/heads/ecc/candidates/rejected';
  const rejectedReceipt = promoteCandidate({
    artifact, evaluation: rejected, repositoryPath: repository, runDirectory,
    targetRef: 'refs/heads/main', candidateRef,
  });
  assert.strictEqual(rejectedReceipt.result, 'rejected');
  assert.strictEqual(candidateRefExists(repository, candidateRef), false);

  const clean = candidateArtifact(root, repository);
  const accepted = acceptedEvaluation(clean.artifact);
  fs.appendFileSync(path.join(clean.runDirectory, clean.artifact.patch.relative_path), '\nmalicious tamper\n');
  const tamperedReceipt = promoteCandidate({
    artifact: clean.artifact, evaluation: accepted, repositoryPath: repository,
    runDirectory: clean.runDirectory, targetRef: 'refs/heads/main',
    candidateRef: 'refs/heads/ecc/candidates/tampered',
  });
  assert.strictEqual(tamperedReceipt.result, 'error');
  assert.match(tamperedReceipt.error, /digest/);
}));

test('returns stale without touching refs when the target base has advanced', () => withTemp(root => {
  const repository = createRepository(root);
  const { artifact, runDirectory } = candidateArtifact(root, repository);
  const evaluation = acceptedEvaluation(artifact);
  fs.writeFileSync(path.join(repository, 'later.txt'), 'advance\n');
  git(repository, 'add', '.');
  git(repository, 'commit', '-m', 'advance target');
  const currentMain = git(repository, 'rev-parse', 'refs/heads/main');
  const candidateRef = 'refs/heads/ecc/candidates/stale';

  const receipt = promoteCandidate({
    artifact, evaluation, repositoryPath: repository, runDirectory,
    targetRef: 'refs/heads/main', candidateRef,
  });
  assert.strictEqual(receipt.result, 'stale');
  assert.strictEqual(receipt.observed_target_oid, currentMain);
  assert.strictEqual(candidateRefExists(repository, candidateRef), false);
}));

test('fails closed on a dirty target checkout', () => withTemp(root => {
  const repository = createRepository(root);
  const { artifact, runDirectory } = candidateArtifact(root, repository);
  const evaluation = acceptedEvaluation(artifact);
  fs.writeFileSync(path.join(repository, 'dirty.txt'), 'uncommitted\n');
  const candidateRef = 'refs/heads/ecc/candidates/dirty';

  const receipt = promoteCandidate({
    artifact, evaluation, repositoryPath: repository, runDirectory,
    targetRef: 'refs/heads/main', candidateRef,
  });
  assert.strictEqual(receipt.result, 'error');
  assert.match(receipt.error, /dirty/);
  assert.strictEqual(candidateRefExists(repository, candidateRef), false);
}));

test('reports failed git apply checks and removes promotion staging', () => withTemp(root => {
  const repository = createRepository(root);
  const built = candidateArtifact(root, repository);
  const patchPath = path.join(built.runDirectory, built.artifact.patch.relative_path);
  fs.writeFileSync(patchPath, 'this is not a patch\n');
  const bytes = fs.readFileSync(patchPath);
  const malformedArtifact = {
    ...built.artifact,
    patch: {
      ...built.artifact.patch,
      sha256: crypto.createHash('sha256').update(bytes).digest('hex'),
      byte_count: bytes.length,
    },
  };
  const evaluation = acceptedEvaluation(malformedArtifact);
  assert.strictEqual(evaluation.verdict, 'accepted');

  const receipt = promoteCandidate({
    artifact: malformedArtifact, evaluation, repositoryPath: repository,
    runDirectory: built.runDirectory, targetRef: 'refs/heads/main',
    candidateRef: 'refs/heads/ecc/candidates/bad-apply',
  });
  assert.strictEqual(receipt.result, 'error');
  assert.match(receipt.error, /apply check/);
  assert.strictEqual(fs.readdirSync(built.runDirectory).some(name => name.startsWith('promotion-')), false);
}));

console.log(`\nPassed: ${passed}`);
console.log(`Failed: ${failed}`);
process.exit(failed > 0 ? 1 : 0);
