'use strict';

const assert = require('assert');
const fs = require('fs');
const os = require('os');
const path = require('path');

const {
  buildEnvironmentReceipt,
  environmentCacheKey,
} = require('../../scripts/sandbox/fabric/environment-receipt');
const {
  assertPrivateRoot,
  createSnapshotRecord,
  promoteSnapshotReady,
  readSnapshotRecord,
  snapshotRecordPath,
} = require('../../scripts/sandbox/fabric/snapshot-store');

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
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'ecc-fabric-env-'));
  try {
    return fn(root);
  } finally {
    fs.rmSync(root, { recursive: true, force: true });
  }
}

function manifest(overrides = {}) {
  return {
    name: 'fabric-env',
    needs: {
      os: ['linux'],
      arch: ['arm64'],
      capabilities: overrides.capabilities || ['clean-home', 'pkg-install'],
      trust: overrides.trust || 'first-party',
      native: false,
    },
    resources: { cpu: 2, memory: '1GB', timeout: 120 },
    steps: { setup: ['true'], assert: ['true'] },
    report: 'install-diff',
  };
}

function route(overrides = {}) {
  return {
    os: overrides.os || 'linux',
    arch: overrides.arch || 'arm64',
    backend: overrides.backend || 'podman',
    tier: overrides.tier ?? 1,
    rule: 'tier-1-ephemeral',
    reason: 'fixture',
    notes: [],
    result: 'routable',
  };
}

console.log('\n=== ECC sandbox fabric environment tests ===\n');

test('builds an immutable digest-bound environment receipt and stable cache key', () => {
  const credentialReceipt = {
    lease_id: 'cred_1234567890abcdef12345678',
    provider: 'environment-source-test',
    logical_ref: 'env:NPM_TOKEN',
    expose_as: 'NODE_AUTH_TOKEN',
    audience: 'npm',
    scopes: ['package:read'],
    backend: 'podman',
    tier: 1,
    trust: 'first-party',
    issued_at: '2026-08-25T12:00:00.000Z',
    expires_at: '2026-08-25T12:15:00.000Z',
  };
  const first = buildEnvironmentReceipt({
    manifest: manifest(),
    route: route(),
    backend: {
      image: 'localhost/ecc-sandbox:ubuntu-lts',
      image_digest: 'sha256:'.concat('a'.repeat(64)),
    },
    workspace: {
      mode: 'worktree',
      source_digest: 'b'.repeat(64),
    },
    credentials: {
      grants: [credentialReceipt],
    },
    createdAt: '2026-08-25T12:00:00.000Z',
  });
  const second = buildEnvironmentReceipt({
    manifest: manifest(),
    route: route(),
    backend: {
      image_digest: 'sha256:'.concat('a'.repeat(64)),
      image: 'localhost/ecc-sandbox:ubuntu-lts',
    },
    workspace: {
      source_digest: 'b'.repeat(64),
      mode: 'worktree',
    },
    credentials: {
      grants: [{ ...credentialReceipt, scopes: ['package:read'] }],
    },
    createdAt: '2026-08-25T12:00:00.000Z',
  });

  assert.strictEqual(first.schema_version, 1);
  assert.strictEqual(first.state, 'quarantine');
  assert.match(first.digest, /^[a-f0-9]{64}$/);
  assert.strictEqual(first.digest, second.digest);
  assert.strictEqual(environmentCacheKey(first), environmentCacheKey(second));
  assert.deepStrictEqual(Object.keys(first.inputs).sort(), [
    'backend', 'credentials', 'manifest', 'route', 'workspace',
  ]);
  assert.strictEqual(first.inputs.credentials.grants[0].digest, undefined);
  assert.doesNotMatch(JSON.stringify(first), /secret-value|[c]{64}/);
});

test('environment receipts reject mutable backend refs and secret-like credential digests', () => {
  assert.throws(
    () => buildEnvironmentReceipt({
      manifest: manifest(),
      route: route(),
      backend: { image: 'localhost/ecc-sandbox:latest' },
    }),
    /digest/
  );
  assert.throws(
    () => buildEnvironmentReceipt({
      manifest: manifest(),
      route: route(),
      backend: { image_digest: 'sha256:'.concat('a'.repeat(64)) },
      credentials: { grants: [{ name: 'bad', env: 'TOKEN', digest: 'secret-token' }] },
    }),
    /must not contain secret or value digests/
  );
});

test('snapshot registry writes quarantine first, promotes ready atomically, and preserves metadata', () => withRoot(root => {
  const receipt = buildEnvironmentReceipt({
    manifest: manifest(),
    route: route(),
    backend: { image_digest: 'sha256:'.concat('d'.repeat(64)) },
    workspace: { mode: 'source', source_digest: 'e'.repeat(64) },
    createdAt: '2026-08-25T12:00:00.000Z',
  });
  const record = createSnapshotRecord(root, receipt, {
    backend: 'podman',
    name: 'podman-image-cache',
    metadata: { image_id: 'sha256:'.concat('f'.repeat(64)) },
    now: '2026-08-25T12:00:01.000Z',
  });

  assert.strictEqual(record.state, 'quarantine');
  assert.strictEqual(readSnapshotRecord(root, record.id).state, 'quarantine');
  assert.ok(fs.existsSync(snapshotRecordPath(root, record.id)));
  assert.strictEqual(fs.existsSync(path.join(root, `${record.id}.tmp`)), false);

  const ready = promoteSnapshotReady(root, record.id, {
    expectedReceiptDigest: receipt.digest,
    expectedCacheKey: receipt.cache_key,
    expectedBackend: 'podman',
    metadata: { warmed_ms: 42 },
    now: '2026-08-25T12:00:02.000Z',
  });
  const reread = readSnapshotRecord(root, record.id);
  assert.strictEqual(ready.state, 'ready');
  assert.strictEqual(reread.state, 'ready');
  assert.deepStrictEqual(reread.metadata, {
    image_id: 'sha256:'.concat('f'.repeat(64)),
    warmed_ms: 42,
  });
  assert.strictEqual(reread.receipt_digest, receipt.digest);
}));

test('snapshot registry never promotes a missing or non-quarantine record', () => withRoot(root => {
  assert.throws(() => promoteSnapshotReady(root, `snap_${'0'.repeat(32)}`), /missing/);
  const receipt = buildEnvironmentReceipt({
    manifest: manifest(),
    route: route(),
    backend: { image_digest: 'sha256:'.concat('1'.repeat(64)) },
  });
  const record = createSnapshotRecord(root, receipt, {
    backend: 'podman',
    name: 'once',
    now: '2026-08-25T12:00:01.000Z',
  });
  promoteSnapshotReady(root, record.id, {
    expectedReceiptDigest: receipt.digest,
    expectedCacheKey: receipt.cache_key,
    expectedBackend: 'podman',
    now: '2026-08-25T12:00:02.000Z',
  });
  assert.throws(() => promoteSnapshotReady(root, record.id, {
    expectedReceiptDigest: receipt.digest,
    expectedCacheKey: receipt.cache_key,
    expectedBackend: 'podman',
  }), /quarantine/);
}));

test('snapshot registry rejects symlink and non-private roots', () => withRoot(parent => {
  const receipt = buildEnvironmentReceipt({
    manifest: manifest(),
    route: route(),
    backend: { image_digest: 'sha256:'.concat('2'.repeat(64)) },
  });
  const realRoot = path.join(parent, 'real');
  const linkRoot = path.join(parent, 'link');
  fs.mkdirSync(realRoot, { mode: 0o700 });
  fs.symlinkSync(realRoot, linkRoot);
  assert.throws(() => createSnapshotRecord(linkRoot, receipt, {
    backend: 'podman',
    name: 'symlink-root',
  }), /symbolic link/);

  const publicRoot = path.join(parent, 'public');
  fs.mkdirSync(publicRoot, { mode: 0o755 });
  assert.throws(() => createSnapshotRecord(publicRoot, receipt, {
    backend: 'podman',
    name: 'public-root',
  }), /private/);
}));

test('snapshot registry rejects non-owned roots through the ownership guard', () => withRoot(root => {
  assert.throws(() => assertPrivateRoot(root, { expectedUid: (process.getuid?.() || 0) + 1 }), /owned/);
}));

test('snapshot ready promotion requires expected identity and rejects poisoned records', () => withRoot(root => {
  const receipt = buildEnvironmentReceipt({
    manifest: manifest(),
    route: route({ backend: 'podman' }),
    backend: { image_digest: 'sha256:'.concat('3'.repeat(64)) },
  });
  const record = createSnapshotRecord(root, receipt, {
    backend: 'podman',
    name: 'poison-target',
    now: '2026-08-25T12:00:01.000Z',
  });
  assert.throws(() => promoteSnapshotReady(root, record.id), /expected receipt digest/);
  assert.throws(() => promoteSnapshotReady(root, record.id, {
    expectedReceiptDigest: receipt.digest,
    expectedCacheKey: receipt.cache_key,
    expectedBackend: 'lume',
  }), /backend/);

  const filePath = snapshotRecordPath(root, record.id);
  const poisoned = {
    ...readSnapshotRecord(root, record.id),
    receipt_digest: '4'.repeat(64),
    cache_key: `env_${'5'.repeat(64)}`,
  };
  fs.writeFileSync(filePath, `${JSON.stringify(poisoned, null, 2)}\n`, { mode: 0o600 });
  assert.throws(() => promoteSnapshotReady(root, record.id, {
    expectedReceiptDigest: receipt.digest,
    expectedCacheKey: receipt.cache_key,
    expectedBackend: 'podman',
  }), /receipt digest/);
}));

console.log(`\nPassed: ${passed}`);
console.log(`Failed: ${failed}`);
process.exit(failed > 0 ? 1 : 0);
