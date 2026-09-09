'use strict';

const assert = require('assert');
const {
  CredentialBroker,
  createEnvironmentSourceProvider,
  createExactValueRedactor,
} = require('../../scripts/sandbox/fabric/credential-broker');

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
    needs: {
      trust: overrides.trust || 'first-party',
      capabilities: overrides.capabilities || ['pkg-install', 'network:*'],
    },
  };
}

function route(overrides = {}) {
  return {
    backend: overrides.backend || 'podman',
    tier: overrides.tier ?? 1,
  };
}

function grant(overrides = {}) {
  return {
    logical_ref: overrides.logical_ref || 'env:NPM_TOKEN',
    expose_as: overrides.expose_as || 'NODE_AUTH_TOKEN',
    provider: overrides.provider || 'environment-source-test',
    audience: overrides.audience || 'npm',
    scopes: overrides.scopes || ['package:read'],
    backends: overrides.backends || ['podman'],
    trust: overrides.trust || ['first-party'],
    capabilities: overrides.capabilities || ['pkg-install'],
    network: overrides.network || ['network:*'],
    ttl_ms: overrides.ttl_ms ?? 1_000,
    allow_tier2: overrides.allow_tier2 === true,
  };
}

function sha256(value) {
  return require('crypto').createHash('sha256').update(value).digest('hex');
}

console.log('\n=== ECC sandbox fabric credential broker tests ===\n');

test('denies every ambient credential without an explicit registered provider and grant', () => {
  const broker = new CredentialBroker({ now: () => 1_000 });
  const request = broker.issueLease({
    manifest: manifest(),
    route: route(),
    grants: [grant()],
    env: { NPM_TOKEN: 'secret-value', GH_TOKEN: 'ambient-value' },
  });
  assert.strictEqual(request.status, 'denied');
  assert.match(request.reason, /provider unavailable/);
  assert.deepStrictEqual(request.environment, {});
  assert.deepStrictEqual(broker.activeLeases(), []);
});

test('requires opt-in environment-source test provider and logical refs only', () => {
  const broker = new CredentialBroker({
    providers: [
      createEnvironmentSourceProvider({
        enabled: true,
        env: { NPM_TOKEN: 'secret-value' },
      }),
    ],
    now: () => 1_000,
  });
  assert.throws(() => broker.issueLease({
    manifest: manifest(),
    route: route(),
    grants: [grant({ logical_ref: 'secret-value' })],
  }), /logical credential refs/);

  const issued = broker.issueLease({
    manifest: manifest(),
    route: route(),
    grants: [grant()],
  });
  assert.strictEqual(issued.status, 'issued');
  assert.deepStrictEqual(issued.environment, { NODE_AUTH_TOKEN: 'secret-value' });
  assert.match(issued.receipt.lease_id, /^cred_[a-f0-9]{24}$/);
  assert.strictEqual(issued.receipt.value_sha256, undefined);
  assert.strictEqual(issued.receipt.digest, undefined);
  assert.doesNotMatch(JSON.stringify(issued.receipt), /secret-value/);
  assert.doesNotMatch(JSON.stringify(issued.receipt), new RegExp(sha256('secret-value')));
});

test('rolls back all leases and redactor state when any grant in a request is denied', () => {
  const redactor = createExactValueRedactor();
  const broker = new CredentialBroker({
    providers: [
      createEnvironmentSourceProvider({
        enabled: true,
        env: { NPM_TOKEN: 'secret-value' },
        allowed_refs: ['env:NPM_TOKEN'],
      }),
    ],
    redactor,
    now: () => 1_000,
  });
  const denied = broker.issueLease({
    manifest: manifest(),
    route: route(),
    grants: [
      grant(),
      grant({ logical_ref: 'env:MISSING_TOKEN' }),
    ],
  });

  assert.strictEqual(denied.status, 'denied');
  assert.deepStrictEqual(denied.environment, {});
  assert.deepStrictEqual(denied.receipts, []);
  assert.deepStrictEqual(broker.activeLeases(), []);
  assert.strictEqual(broker.resolveLease('cred_missing'), null);
  assert.strictEqual(redactor.size(), 0);
  assert.strictEqual(redactor.redact('secret-value'), 'secret-value');
});

test('represents production credential URI refs without allowing env refs through production providers', () => {
  const productionProvider = {
    name: 'vault-provider',
    available: true,
    kind: 'production',
    resolve() {
      return { ok: true, value: 'prod-secret' };
    },
  };
  const broker = new CredentialBroker({
    providers: [productionProvider],
    now: () => 1_000,
  });

  const issued = broker.issueLease({
    manifest: manifest(),
    route: route(),
    grants: [grant({
      logical_ref: 'vault://team/npm/read-only',
      provider: 'vault-provider',
    })],
  });
  assert.strictEqual(issued.status, 'issued');
  assert.strictEqual(issued.receipt.logical_ref, 'vault://team/npm/read-only');
  assert.doesNotMatch(JSON.stringify(issued.receipt), /prod-secret/);

  const denied = broker.issueLease({
    manifest: manifest(),
    route: route(),
    grants: [grant({
      logical_ref: 'env:NPM_TOKEN',
      provider: 'vault-provider',
    })],
  });
  assert.strictEqual(denied.status, 'denied');
  assert.match(denied.reason, /test-only provider/);
});

test('checks audience, scope, expiry, backend, trust, capability, and network policy', () => {
  const provider = createEnvironmentSourceProvider({
    enabled: true,
    env: { TOKEN: 'secret-value' },
    allowed_refs: ['env:TOKEN'],
    audiences: ['npm'],
    scopes: ['package:read'],
  });
  const broker = new CredentialBroker({ providers: [provider], now: () => 5_000 });
  for (const bad of [
    grant({ logical_ref: 'env:TOKEN', audience: 'github' }),
    grant({ logical_ref: 'env:TOKEN', scopes: ['package:write'] }),
    grant({ logical_ref: 'env:TOKEN', backends: ['lima'] }),
    grant({ logical_ref: 'env:TOKEN', trust: ['untrusted'] }),
    grant({ logical_ref: 'env:TOKEN', capabilities: ['services'] }),
    grant({ logical_ref: 'env:TOKEN', network: ['network:npmjs.org'] }),
    grant({ logical_ref: 'env:TOKEN', ttl_ms: 0 }),
  ]) {
    const denied = broker.issueLease({
      manifest: manifest(),
      route: route(),
      grants: [bad],
    });
    assert.strictEqual(denied.status, 'denied');
    assert.deepStrictEqual(denied.environment, {});
  }

  const issued = broker.issueLease({
    manifest: manifest(),
    route: route(),
    grants: [grant({ logical_ref: 'env:TOKEN' })],
  });
  assert.strictEqual(issued.status, 'issued');
  assert.strictEqual(broker.resolveLease(issued.receipt.lease_id).expired, false);
  assert.strictEqual(new CredentialBroker({
    providers: [provider],
    now: () => 6_001,
  }).resolveLease(issued.receipt.lease_id), null);
});

test('fails closed for Tier 2 credentials unless the grant explicitly allows native VM exposure', () => {
  const broker = new CredentialBroker({
    providers: [
      createEnvironmentSourceProvider({ enabled: true, env: { TOKEN: 'secret-value' } }),
    ],
    now: () => 1_000,
  });
  const denied = broker.issueLease({
    manifest: manifest({ capabilities: ['services', 'network:*'] }),
    route: route({ backend: 'lume', tier: 2 }),
    grants: [grant({ logical_ref: 'env:TOKEN', backends: ['lume'], capabilities: ['services'] })],
  });
  assert.strictEqual(denied.status, 'denied');
  assert.match(denied.reason, /Tier 2/);

  const issued = broker.issueLease({
    manifest: manifest({ capabilities: ['services', 'network:*'] }),
    route: route({ backend: 'lume', tier: 2 }),
    grants: [grant({
      logical_ref: 'env:TOKEN',
      backends: ['lume'],
      capabilities: ['services'],
      allow_tier2: true,
    })],
  });
  assert.strictEqual(issued.status, 'issued');
});

test('revokes leases and redacts exact in-memory values from later evidence', () => {
  const broker = new CredentialBroker({
    providers: [
      createEnvironmentSourceProvider({ enabled: true, env: { TOKEN: 'secret-value' } }),
    ],
    now: (() => {
      let time = 1_000;
      return () => time;
    })(),
  });
  const issued = broker.issueLease({
    manifest: manifest(),
    route: route(),
    grants: [grant({ logical_ref: 'env:TOKEN' })],
  });
  assert.strictEqual(issued.status, 'issued');
  assert.strictEqual(broker.revokeLease(issued.receipt.lease_id).revoked, true);
  assert.strictEqual(broker.resolveLease(issued.receipt.lease_id), null);

  const redactor = createExactValueRedactor();
  redactor.add('secret-value');
  redactor.add('');
  assert.strictEqual(
    redactor.redact('prefix secret-value suffix secret-value'),
    'prefix [REDACTED] suffix [REDACTED]'
  );
});

console.log(`\nPassed: ${passed}`);
console.log(`Failed: ${failed}`);
process.exit(failed > 0 ? 1 : 0);
