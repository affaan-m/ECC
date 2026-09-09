'use strict';

const crypto = require('crypto');
const fs = require('fs');
const path = require('path');
const { spawnSync } = require('child_process');
const { canonicalContractJson } = require('../contracts');
const { validatePromotion } = require('./contracts');
const { artifactPatchPath, digestArtifact, sha256 } = require('./patch-artifact');
const { deepFreeze, digestEvaluation } = require('./evaluator');

function safeHostEnvironment() {
  const allowed = new Set([
    'COMSPEC', 'LANG', 'PATH', 'PATHEXT', 'SYSTEMROOT', 'TEMP', 'TMP', 'TMPDIR', 'TZ', 'WINDIR',
  ]);
  return Object.fromEntries(Object.entries(process.env).filter(([name]) => (
    allowed.has(name.toUpperCase()) || name.toUpperCase().startsWith('LC_')
  )));
}

function gitEnvironment(home) {
  return {
    ...safeHostEnvironment(),
    HOME: home,
    GIT_CONFIG_GLOBAL: process.platform === 'win32' ? 'NUL' : '/dev/null',
    GIT_CONFIG_NOSYSTEM: '1',
    GIT_TERMINAL_PROMPT: '0',
    GIT_AUTHOR_NAME: 'ECC Sandbox Promoter',
    GIT_AUTHOR_EMAIL: 'sandbox-promoter@ecc.invalid',
    GIT_COMMITTER_NAME: 'ECC Sandbox Promoter',
    GIT_COMMITTER_EMAIL: 'sandbox-promoter@ecc.invalid',
  };
}

function defaultRun(executable, argv, options = {}) {
  return spawnSync(executable, argv, {
    cwd: options.cwd,
    encoding: 'utf8',
    shell: false,
    windowsHide: true,
    timeout: options.timeout || 60_000,
    maxBuffer: options.maxBuffer || 64 * 1024 * 1024,
    env: options.env || process.env,
  });
}

function runGit(run, repository, argv, home) {
  return run('git', ['-c', 'core.hooksPath=/dev/null', '-C', repository, ...argv], {
    cwd: repository,
    env: gitEnvironment(home),
    timeout: 60_000,
    maxBuffer: 64 * 1024 * 1024,
  });
}

function successful(result) {
  return !result.error && result.status === 0;
}

function output(result) {
  return String(result.stdout || '').trim();
}

function detail(result) {
  return [result.stderr, result.stdout, result.error?.message].filter(Boolean).join('\n').trim();
}

function resolveCommit(run, repository, ref, home, label) {
  const result = runGit(run, repository, ['rev-parse', '--verify', `${ref}^{commit}`], home);
  if (!successful(result)) throw new Error(`${label} failed: ${detail(result)}`);
  return output(result);
}

function validCandidateRef(ref) {
  return typeof ref === 'string'
    && /^refs\/heads\/ecc\/candidates\/[A-Za-z0-9][A-Za-z0-9._/-]{0,199}$/.test(ref)
    && !ref.includes('..')
    && !ref.includes('//')
    && !ref.endsWith('/')
    && !ref.endsWith('.lock');
}

function checks(overrides = {}) {
  return {
    evaluation_accepted: false,
    cleanup_verified: false,
    patch_digest_verified: false,
    target_unchanged: false,
    ...overrides,
  };
}

function receipt(input, observed, result, receiptChecks, extras = {}) {
  const value = {
    schema_version: 1,
    promotion_id: `promotion_${crypto.randomBytes(12).toString('hex')}`,
    artifact_id: input.artifact.artifact_id,
    evaluation_digest: digestEvaluation(input.evaluation),
    target_ref: input.targetRef,
    observed_target_oid: observed,
    base_oid: input.artifact.base.commit,
    candidate_ref: input.candidateRef,
    candidate_commit: extras.candidateCommit || null,
    checks: receiptChecks,
    result,
    ...(extras.error ? { error: extras.error } : {}),
    created_at: new Date().toISOString(),
  };
  validatePromotion(value, { artifact: input.artifact, evaluation: input.evaluation });
  return deepFreeze(value);
}

function verifyPatch(artifact, runDirectory) {
  const patchPath = artifactPatchPath(artifact, runDirectory);
  const stats = fs.lstatSync(patchPath);
  if (!stats.isFile() || stats.isSymbolicLink()) throw new Error('Artifact patch is not a regular file');
  const bytes = fs.readFileSync(patchPath);
  if (bytes.length !== artifact.patch.byte_count || sha256(bytes) !== artifact.patch.sha256) {
    throw new Error('Artifact patch digest or byte count does not match its receipt');
  }
  return patchPath;
}

function existingRef(run, repository, ref, home) {
  const result = runGit(run, repository, ['show-ref', '--verify', '--hash', ref], home);
  return successful(result) ? output(result) : null;
}

function runChecks(run, repository, requested, environment) {
  for (const check of requested) {
    if (!check || typeof check.name !== 'string' || typeof check.executable !== 'string' || !Array.isArray(check.args)) {
      throw new Error('Promotion check contract is invalid');
    }
    const result = run(check.executable, [...check.args], {
      cwd: repository,
      env: environment,
      timeout: check.timeout_ms || 60_000,
      maxBuffer: 4 * 1024 * 1024,
    });
    if (!successful(result)) {
      const evidence = sha256(`${result.status}\0${result.stdout || ''}\0${result.stderr || ''}`);
      throw new Error(`Required promotion check ${check.name} failed; output_digest=${evidence}`);
    }
  }
}

function removeStaging(stagingRoot) {
  try {
    fs.rmSync(stagingRoot, { recursive: true, force: true });
    return !fs.existsSync(stagingRoot);
  } catch {
    return false;
  }
}

function promoteCandidate(input = {}, dependencies = {}) {
  if (!input.artifact || !input.evaluation) throw new Error('Artifact and evaluation receipts are required');
  if (!validCandidateRef(input.candidateRef)) throw new Error('Candidate ref must stay under refs/heads/ecc/candidates/');
  if (input.targetRef === input.candidateRef) throw new Error('Candidate ref must differ from the target ref');
  const run = dependencies.run || defaultRun;
  const repository = fs.realpathSync.native(path.resolve(input.repositoryPath));
  const runDirectory = fs.realpathSync.native(path.resolve(input.runDirectory));
  const observed = resolveCommit(run, repository, input.targetRef, runDirectory, 'Target ref resolution');
  let verified = checks({ target_unchanged: observed === input.artifact.base.commit });

  if (input.evaluation.verdict !== 'accepted') return receipt(input, observed, 'rejected', verified);
  if (input.evaluation.artifact_id !== input.artifact.artifact_id
    || input.evaluation.artifact_digest !== digestArtifact(input.artifact)) {
    return receipt(input, observed, 'error', verified, { error: 'Evaluation does not bind the supplied artifact digest' });
  }
  if (input.evaluation.evaluators.some(evaluator => evaluator.id === input.artifact.worker_id)) {
    return receipt(input, observed, 'error', verified, { error: 'Artifact worker cannot evaluate its own promotion' });
  }
  verified = checks({ ...verified, evaluation_accepted: true });
  if (!verified.target_unchanged) return receipt(input, observed, 'stale', verified);

  let patchPath;
  try {
    patchPath = verifyPatch(input.artifact, runDirectory);
    verified = checks({ ...verified, patch_digest_verified: true });
  } catch (error) {
    return receipt(input, observed, 'error', verified, { error: error.message });
  }

  const dirty = runGit(run, repository, ['status', '--porcelain=v1', '--untracked-files=all'], runDirectory);
  if (!successful(dirty) || output(dirty)) {
    return receipt(input, observed, 'error', verified, {
      error: successful(dirty) ? 'Target checkout is dirty' : `Target checkout inspection failed: ${detail(dirty)}`,
    });
  }
  const oldCandidate = existingRef(run, repository, input.candidateRef, runDirectory);
  if (oldCandidate && !input.expectedCandidateOid) {
    return receipt(input, observed, 'error', verified, { error: 'Candidate ref already exists and no expected OID was supplied' });
  }
  if (input.expectedCandidateOid && oldCandidate !== input.expectedCandidateOid) {
    return receipt(input, observed, 'error', verified, { error: 'Candidate ref changed before promotion' });
  }

  const stagingRoot = fs.mkdtempSync(path.join(runDirectory, 'promotion-'));
  const stagingRepository = path.join(stagingRoot, 'repository');
  let candidateCommit = null;
  let failure = null;
  try {
    const clone = runGit(run, runDirectory, ['clone', '--quiet', '--no-local', '--no-hardlinks', repository, stagingRepository], runDirectory);
    if (!successful(clone)) throw new Error(`Promotion clone failed: ${detail(clone)}`);
    const checkout = runGit(run, stagingRepository, ['checkout', '--quiet', '--detach', observed], stagingRoot);
    if (!successful(checkout)) throw new Error(`Promotion checkout failed: ${detail(checkout)}`);
    const applyCheck = runGit(run, stagingRepository, ['apply', '--check', '--binary', patchPath], stagingRoot);
    if (!successful(applyCheck)) throw new Error(`Git apply check failed: ${detail(applyCheck)}`);
    const apply = runGit(run, stagingRepository, ['apply', '--index', '--binary', patchPath], stagingRoot);
    if (!successful(apply)) throw new Error(`Git patch application failed: ${detail(apply)}`);
    runChecks(run, stagingRepository, input.checks || [], gitEnvironment(stagingRoot));
    const commit = runGit(run, stagingRepository, ['commit', '--quiet', '--no-gpg-sign', '-m', `chore: promote sandbox candidate ${input.artifact.artifact_id}`], stagingRoot);
    if (!successful(commit)) throw new Error(`Candidate commit failed: ${detail(commit)}`);
    candidateCommit = resolveCommit(run, stagingRepository, 'HEAD', stagingRoot, 'Candidate commit resolution');
    const fetch = runGit(run, repository, ['fetch', '--quiet', '--no-tags', stagingRepository, candidateCommit], runDirectory);
    if (!successful(fetch)) throw new Error(`Candidate object transfer failed: ${detail(fetch)}`);
  } catch (error) {
    failure = error.message;
  }

  const cleanupPass = removeStaging(stagingRoot);
  verified = checks({ ...verified, cleanup_verified: cleanupPass });
  if (failure || !cleanupPass) {
    return receipt(input, observed, 'error', verified, { error: failure || 'Promotion staging cleanup failed' });
  }
  const targetBeforeUpdate = resolveCommit(run, repository, input.targetRef, runDirectory, 'Target recheck');
  if (targetBeforeUpdate !== observed) {
    return receipt(input, targetBeforeUpdate, 'stale', checks({ ...verified, target_unchanged: false }));
  }
  const formatResult = runGit(run, repository, ['rev-parse', '--show-object-format'], runDirectory);
  const zeroOid = '0'.repeat(successful(formatResult) && output(formatResult) === 'sha256' ? 64 : 40);
  const update = runGit(run, repository, [
    'update-ref', input.candidateRef, candidateCommit, input.expectedCandidateOid || zeroOid,
    '-m', `ECC sandbox artifact ${input.artifact.artifact_id}`,
  ], runDirectory);
  if (!successful(update)) {
    return receipt(input, observed, 'error', verified, { error: `Atomic candidate ref update failed: ${detail(update)}` });
  }
  return receipt(input, observed, 'promoted', verified, { candidateCommit });
}

function digestPromotion(value) {
  return crypto.createHash('sha256').update(canonicalContractJson(value)).digest('hex');
}

module.exports = { digestPromotion, promoteCandidate, validCandidateRef };
