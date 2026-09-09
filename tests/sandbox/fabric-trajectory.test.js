'use strict';

const assert = require('assert');
const fs = require('fs');
const os = require('os');
const path = require('path');

const { contractDigest } = require('../../scripts/sandbox/contracts');
const { validateTrajectory } = require('../../scripts/sandbox/fabric/contracts');

const {
  collectArtifacts,
} = require('../../scripts/sandbox/fabric/artifact-store');
const {
  buildTrajectory,
  trajectoryDigest,
  verifyTrajectory,
} = require('../../scripts/sandbox/fabric/trajectory');

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

function withRoot(fn) {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'ecc-fabric-trajectory-'));
  try {
    return fn(root);
  } finally {
    fs.rmSync(root, { recursive: true, force: true });
  }
}

function trajectoryInput(evidenceRefs = []) {
  return {
    trajectory_id: 'trajectory:implement-auth:1',
    plan_id: 'plan:auth',
    job_id: 'implement-auth',
    run_id: `run_${'a'.repeat(32)}`,
    manifest_digest: 'c'.repeat(64),
    previous_sha256: 'b'.repeat(64),
    worker: {
      id: 'worker:codex:1',
      harness: 'codex',
      model: 'gpt-5.6',
    },
    route: {
      backend: 'podman', tier: 1, os: 'linux', arch: 'arm64', policy_version: 'router-v1',
    },
    environment: {
      digest: 'e'.repeat(64), cache_key: null, warm: false,
    },
    started_at: '2026-08-25T12:00:00.000Z',
    completed_at: '2026-08-25T12:00:01.000Z',
    commands: [{ phase: 'setup', command: 'printf token=must-not-survive', exit_code: 0 }],
    tests: [{ name: 'auth works', result: 'pass' }],
    artifacts: [],
    evidence_refs: evidenceRefs,
    credential_lease_ids: ['lease:github-read'],
    cleanup: { verified: true, owned_resources_remaining: 0 },
    timings: { active_ms: 125, wall_ms: 150 },
    cost: { amount: 0.04, currency: 'USD' },
    redactions: 0,
    result: 'pass',
  };
}

console.log('\n=== ECC fabric trajectory and artifact tests ===\n');

test('collects sorted bounded regular artifact refs with content hashes', () => withRoot(root => {
  fs.mkdirSync(path.join(root, 'nested'));
  fs.writeFileSync(path.join(root, 'nested', 'report.json'), '{"result":"pass"}\n');
  fs.writeFileSync(path.join(root, 'patch.diff'), 'diff --git a/a b/a\n');

  const refs = collectArtifacts(root, ['patch.diff', 'nested/report.json'], {
    redacted: true,
    sourceSealed: true,
  });

  assert.deepStrictEqual(refs.map(ref => ref.path), ['nested/report.json', 'patch.diff']);
  assert.deepStrictEqual(refs.map(ref => ref.bytes), [18, 19]);
  assert.ok(refs.every(ref => /^[a-f0-9]{64}$/.test(ref.sha256)));
  assert.ok(refs.every(ref => ref.redacted === true));
  assert.ok(refs.every(ref => !Object.prototype.hasOwnProperty.call(ref, 'content')));
}));

test('rejects traversal, absolute paths, duplicates, symlinks, and non-files', () => withRoot(root => {
  fs.writeFileSync(path.join(root, 'ok.txt'), 'ok');
  fs.mkdirSync(path.join(root, 'directory'));
  fs.symlinkSync(path.join(root, 'ok.txt'), path.join(root, 'linked.txt'));
  fs.mkdirSync(path.join(root, 'real-parent'));
  fs.writeFileSync(path.join(root, 'real-parent', 'inside.txt'), 'inside');
  fs.symlinkSync(path.join(root, 'real-parent'), path.join(root, 'linked-parent'));

  for (const candidate of [
    '../outside.txt',
    '..\\outside.txt',
    path.resolve(root, 'ok.txt'),
  ]) {
    assert.throws(() => collectArtifacts(root, [candidate], { sourceSealed: true }), /relative|traversal/i);
  }
  assert.throws(() => collectArtifacts(root, ['ok.txt', './ok.txt'], { sourceSealed: true }), /duplicate/i);
  assert.throws(() => collectArtifacts(root, ['linked.txt'], { sourceSealed: true }), /symbolic link/i);
  assert.throws(() => collectArtifacts(root, ['linked-parent/inside.txt'], { sourceSealed: true }), /symbolic link/i);
  assert.throws(() => collectArtifacts(root, ['directory'], { sourceSealed: true }), /regular file/i);
}));

test('fails closed when artifact count, individual size, or total size exceeds limits', () => withRoot(root => {
  fs.writeFileSync(path.join(root, 'one.bin'), Buffer.alloc(8, 1));
  fs.writeFileSync(path.join(root, 'two.bin'), Buffer.alloc(8, 2));

  assert.throws(
    () => collectArtifacts(root, ['one.bin', 'two.bin'], { maxFiles: 1, sourceSealed: true }),
    /more than 1/i
  );
  assert.throws(
    () => collectArtifacts(root, ['one.bin'], { maxFileBytes: 7, sourceSealed: true }),
    /individual.*limit|exceeds 7 bytes/i
  );
  assert.throws(
    () => collectArtifacts(root, ['one.bin', 'two.bin'], { maxTotalBytes: 15, sourceSealed: true }),
    /total.*limit|exceeds 15 bytes/i
  );
}));

test('builds a redacted bounded trajectory linked to sealed evidence refs', () => withRoot(root => {
  fs.writeFileSync(path.join(root, 'events.jsonl'), '{"text":"[REDACTED]"}\n');
  const [evidence] = collectArtifacts(root, ['events.jsonl'], {
    redacted: true,
    sourceSealed: true,
  });
  const trajectory = buildTrajectory(trajectoryInput([{
    ...evidence,
    kind: 'redacted-event-journal',
  }]));

  assert.strictEqual(validateTrajectory(trajectory), trajectory);
  assert.strictEqual(trajectory.schema_version, 1);
  assert.strictEqual(trajectory.trajectory_id, 'trajectory:implement-auth:1');
  assert.strictEqual(trajectory.artifacts[0].digest, evidence.sha256);
  assert.match(trajectoryDigest(trajectory), /^[a-f0-9]{64}$/);
  assert.ok(trajectory.redactions >= 1);
  assert.doesNotMatch(JSON.stringify(trajectory), /must-not-survive/);
  assert.strictEqual(verifyTrajectory(trajectory, trajectoryDigest(trajectory)), true);
}));

test('rejects unredacted evidence, malformed links, and oversized trajectory metadata', () => withRoot(root => {
  fs.writeFileSync(path.join(root, 'events.jsonl'), '{}\n');
  const [evidence] = collectArtifacts(root, ['events.jsonl'], { sourceSealed: true });

  assert.throws(
    () => buildTrajectory(trajectoryInput([{ ...evidence, kind: 'journal' }])),
    /evidence.*redacted/i
  );
  assert.throws(
    () => buildTrajectory({ ...trajectoryInput([]), previous_sha256: 'bad' }),
    /previous_sha256/i
  );
  assert.throws(
    () => buildTrajectory({ ...trajectoryInput([]), job_id: 'x'.repeat(300) }),
    /job_id/i
  );
  assert.throws(
    () => buildTrajectory({
      ...trajectoryInput([]),
      credential_lease_ids: [{ ref: 'github-read', value: 'raw-secret' }],
    }),
    /credential_lease_ids/i
  );
}));

test('detects trajectory or evidence-ref tampering', () => {
  const trajectory = buildTrajectory(trajectoryInput([]));
  const digest = trajectoryDigest(trajectory);
  assert.strictEqual(verifyTrajectory({ ...trajectory, result: 'fail' }, digest), false);
  assert.strictEqual(verifyTrajectory({
    ...trajectory,
    environment: { ...trajectory.environment, digest: '0'.repeat(64) },
  }, digest), false);
});

test('requires an explicitly stopped and sealed artifact source', () => withRoot(root => {
  fs.writeFileSync(path.join(root, 'candidate.patch'), 'patch');
  assert.throws(
    () => collectArtifacts(root, ['candidate.patch']),
    /stopped and sealed/i
  );
  if (process.platform !== 'win32') {
    fs.chmodSync(root, 0o755);
    assert.throws(
      () => collectArtifacts(root, ['candidate.patch'], { sourceSealed: true }),
      /private/i
    );
  }
}));

test('semantic verification rejects invalid records even when their digest is recomputed', () => {
  const trajectory = buildTrajectory(trajectoryInput([]));
  const invalidPayload = {
    ...trajectory,
    cleanup: { verified: false, owned_resources_remaining: 1 },
  };
  assert.strictEqual(verifyTrajectory(invalidPayload, contractDigest(invalidPayload)), false);
});

test('trajectory survives persistence and rejects undefined metadata', () => {
  const trajectory = buildTrajectory(trajectoryInput([]));
  assert.strictEqual(verifyTrajectory(JSON.parse(JSON.stringify(trajectory))), true);
  assert.throws(
    () => buildTrajectory({
      ...trajectoryInput([]),
      worker: { id: 'worker:1', harness: 'codex', model: undefined },
    }),
    /undefined/i
  );
});

console.log(`\nPassed: ${passed}`);
console.log(`Failed: ${failed}`);
process.exit(failed > 0 ? 1 : 0);
