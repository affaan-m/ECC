'use strict';

const assert = require('assert');
const fs = require('fs');
const os = require('os');
const path = require('path');
const { spawnSync } = require('child_process');
const {
  ContractValidationError,
  loadManifest,
  parseManifestText,
  readBoundedRegularFile,
  validateManifest,
  validateCapabilities,
  validateReport,
} = require('../../scripts/sandbox/contracts');
const { routeManifest } = require('../../scripts/sandbox/router');

const repoRoot = path.join(__dirname, '..', '..');
const fixtureRoot = path.join(repoRoot, 'tests', 'fixtures', 'sandbox');
const cliPath = path.join(repoRoot, 'scripts', 'sandbox', 'ecc-sandbox');
const routingFixtures = JSON.parse(
  fs.readFileSync(path.join(fixtureRoot, 'routing-cases.json'), 'utf8')
);
const SUBPROCESS_TIMEOUT_MS = 30_000;

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

function buildManifest(testCase) {
  const base = routingFixtures.baseManifest;
  return {
    ...base,
    needs: {
      ...base.needs,
      ...(testCase.needs || {}),
    },
  };
}

function buildCapabilityMap(testCase) {
  return {
    schema_version: 1,
    host: testCase.host || { os: 'macos', arch: 'arm64' },
    backends: testCase.backends || {},
  };
}

function sampleSingleReport(overrides = {}) {
  return {
    manifest: '/tmp/sandbox.yaml',
    backend: 'podman',
    tier: 1,
    os: 'linux',
    arch: 'arm64',
    started: '2026-08-08T12:00:00.000Z',
    duration_ms: 42,
    escalations: [],
    steps: [{ cmd: 'node --version', exit: 0, stdout_tail: 'v24', stderr_tail: '' }],
    assertions: [{ cmd: 'node --version', pass: true }],
    install_diff: {
      method: 'podman-layer',
      complete: true,
      files_added: ['/usr/local/bin/tool'],
      files_changed: [],
      files_deleted: [],
      path_changes: ['/usr/local/bin'],
      services_registered: [],
      dotfiles_touched: [],
    },
    result: 'pass',
    notes: [],
    ...overrides,
  };
}

function runCli(args) {
  return spawnSync(process.execPath, [cliPath, ...args], {
    cwd: repoRoot,
    encoding: 'utf8',
    shell: false,
    timeout: SUBPROCESS_TIMEOUT_MS,
  });
}

console.log('\n=== ECC sandbox contracts and router tests ===\n');

test('loads and validates the canonical YAML manifest fixture', () => {
  const manifest = loadManifest(path.join(fixtureRoot, 'valid.yaml'));
  assert.strictEqual(manifest.name, 'install-ecc-clean');
  assert.ok(manifest.needs.capabilities.includes('clean-home'));
});

test('rejects unknown manifest keys loudly', () => {
  assert.throws(
    () => loadManifest(path.join(fixtureRoot, 'unknown-key.yaml')),
    error => (
      error instanceof ContractValidationError
      && /additional properties/.test(error.message)
      && /backend/.test(error.message)
    )
  );
});

test('rejects capabilities outside the closed vocabulary', () => {
  assert.throws(
    () => loadManifest(path.join(fixtureRoot, 'invalid-capability.yaml')),
    error => error instanceof ContractValidationError && /must match/.test(error.message)
  );
});

test('rejects duplicate YAML keys before schema validation', () => {
  assert.throws(
    () => parseManifestText('name: one\nname: two\n', 'duplicate.yaml'),
    error => error instanceof ContractValidationError && /Map keys must be unique/.test(error.message)
  );
});

test('rejects YAML aliases and oversized manifests', () => {
  assert.throws(
    () => parseManifestText('name: &name alias-name\ncopy: *name\n', 'alias.yaml'),
    error => error instanceof ContractValidationError
  );
  assert.throws(
    () => parseManifestText(`name: ${'x'.repeat(1024 * 1024)}\n`, 'large.yaml'),
    error => error instanceof ContractValidationError && /exceeds/.test(error.message)
  );
});

test('rejects YAML warnings and non-regular contract files', () => {
  assert.throws(
    () => parseManifestText('name: !unsupported tagged\n', 'tagged.yaml'),
    error => error instanceof ContractValidationError && /tag/i.test(error.message)
  );
  assert.throws(
    () => readBoundedRegularFile(fixtureRoot, 'Fixture contract'),
    /regular file/
  );
});

test('rejects mixed any and explicit OS targets semantically', () => {
  const manifest = buildManifest({ needs: { os: ['any', 'linux'] } });
  assert.throws(
    () => validateManifest(manifest),
    error => error instanceof ContractValidationError && /must be used alone/.test(error.message)
  );
});

test('rejects open network combined with domain allowlists', () => {
  const manifest = buildManifest({
    needs: { capabilities: ['network:*', 'network:npmjs.org'] },
  });
  assert.throws(
    () => validateManifest(manifest),
    error => error instanceof ContractValidationError && /cannot be combined/.test(error.message)
  );
});

test('rejects forged capability maps before routing', () => {
  const manifest = validateManifest(buildManifest({ needs: { capabilities: ['services'] } }));
  const forged = {
    schema_version: 1,
    host: { os: 'linux', arch: 'x86_64' },
    backends: { lume: { available: 'yes' } },
  };
  assert.throws(
    () => validateCapabilities(forged),
    error => error instanceof ContractValidationError && /must be boolean/.test(error.message)
  );
  assert.throws(
    () => routeManifest(manifest, forged),
    error => error instanceof ContractValidationError
  );
});

test('hard backend constraints reject impossible local target claims', () => {
  const manifest = validateManifest(buildManifest({
    needs: { os: ['macos'], arch: ['arm64'], capabilities: ['services'] },
  }));
  const capabilities = {
    schema_version: 1,
    host: { os: 'linux', arch: 'x86_64' },
    backends: {
      lume: { available: true },
      ci: { available: true, targets: [{ os: 'macos', arch: 'arm64' }] },
    },
  };
  const decision = routeManifest(manifest, capabilities);
  assert.strictEqual(decision.routes[0].backend, 'ci');
});

test('requires an explicit macOS target for iOS Simulator', () => {
  const manifest = buildManifest({
    needs: { os: ['any'], capabilities: ['ios-simulator'] },
  });
  assert.throws(
    () => validateManifest(manifest),
    error => error instanceof ContractValidationError && /explicit macos/.test(error.message)
  );
});

test('rejects unbounded memory and command collections', () => {
  assert.throws(
    () => validateManifest({
      ...buildManifest({}),
      resources: { cpu: 1, memory: '999999999GB', timeout: 30 },
    }),
    error => error instanceof ContractValidationError && /cannot exceed/.test(error.message)
  );
  assert.throws(
    () => validateManifest({
      ...buildManifest({}),
      steps: { setup: Array(1001).fill('true'), assert: ['true'] },
    }),
    error => error instanceof ContractValidationError && /more than 1000/.test(error.message)
  );
});

for (const testCase of routingFixtures.cases) {
  test(`routes fixture: ${testCase.name}`, () => {
    const manifest = validateManifest(buildManifest(testCase));
    const decision = routeManifest(manifest, buildCapabilityMap(testCase), testCase.options || {});
    assert.deepStrictEqual(decision.routes.map(route => route.backend), testCase.expected);
    assert.strictEqual(decision.result, testCase.result || 'routable');
    const expectedTier = {
      srt: 0,
      podman: 1,
      docker: 1,
      microsandbox: 1,
      lume: 2,
      lima: 2,
      tart: 2,
      'windows-sandbox': 2,
      'hyper-v': 2,
      'dockur-windows': 2,
      ci: 3,
    };
    for (const route of decision.routes) {
      assert.ok(route.reason.length > 0);
      if (route.backend === null) {
        assert.strictEqual(route.rule, null);
        assert.strictEqual(route.tier, null);
      } else {
        assert.strictEqual(route.tier, expectedTier[route.backend]);
        assert.ok(route.rule);
      }
    }
    if (testCase.notePattern) {
      assert.match(decision.routes.flatMap(route => route.notes).join('\n'), new RegExp(testCase.notePattern));
    }
    if (testCase.reasonPattern) {
      assert.match(decision.routes.map(route => route.reason).join('\n'), new RegExp(testCase.reasonPattern));
    }
  });
}

test('validates single and aggregate reports through one schema', () => {
  const single = sampleSingleReport();
  assert.strictEqual(validateReport(single), single);
  const aggregate = {
    manifest: '/tmp/sandbox.yaml',
    backend: 'aggregate',
    tier: null,
    os: 'multiple',
    arch: 'multiple',
    venue: 'local',
    started: '2026-08-08T12:00:00.000Z',
    duration_ms: 84,
    escalations: [],
    children: [single, sampleSingleReport({ backend: 'lume', tier: 2, os: 'macos' })],
    result: 'pass',
    notes: [],
  };
  assert.strictEqual(validateReport(aggregate), aggregate);
});

test('rejects malformed reports and more than one escalation', () => {
  assert.throws(
    () => validateReport(sampleSingleReport({ unexpected: true })),
    error => error instanceof ContractValidationError && /additional properties/.test(error.message)
  );
  assert.throws(
    () => validateReport(sampleSingleReport({
      escalations: [
        { from: 'srt', reason: 'denied', to: 'podman' },
        { from: 'podman', reason: 'native', to: 'lume' },
      ],
    })),
    error => error instanceof ContractValidationError && /more than 1 items/.test(error.message)
  );
  assert.throws(
    () => validateReport(sampleSingleReport({ backend: 'lume', tier: 0, os: 'windows' })),
    error => error instanceof ContractValidationError
  );
  assert.throws(
    () => validateReport(sampleSingleReport({
      install_diff: {
        ...sampleSingleReport().install_diff,
        method: 'none',
        complete: true,
      },
    })),
    error => error instanceof ContractValidationError
  );
  assert.throws(
    () => validateReport({
      manifest: '/tmp/sandbox.yaml',
      backend: 'aggregate',
      tier: null,
      os: 'multiple',
      arch: 'multiple',
      venue: 'ci',
      started: '2026-08-08T12:00:00.000Z',
      duration_ms: 84,
      escalations: [],
      children: [sampleSingleReport({ result: 'fail' })],
      result: 'pass',
      notes: [],
    }),
    error => error instanceof ContractValidationError && /aggregate result must be fail/.test(error.message)
  );
  assert.throws(
    () => validateReport({
      manifest: '/tmp/sandbox.yaml',
      backend: 'aggregate',
      tier: null,
      os: 'multiple',
      arch: 'multiple',
      venue: 'local',
      started: '2026-08-08T12:00:00.000Z',
      duration_ms: 84,
      escalations: [],
      children: [sampleSingleReport({
        steps: [{ cmd: 'false', exit: 1, stdout_tail: '', stderr_tail: '' }],
      })],
      result: 'pass',
      notes: [],
    }),
    error => error instanceof ContractValidationError && /children\/0/.test(error.message)
  );
});

test('CLI dry-run emits only a routable JSON decision on stdout', () => {
  const tempRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'ecc-sandbox-contract-'));
  try {
    const capabilitiesPath = path.join(tempRoot, 'capabilities.json');
    fs.writeFileSync(capabilitiesPath, JSON.stringify({
      schema_version: 1,
      host: { os: 'macos', arch: 'arm64' },
      backends: {
        microsandbox: {
          available: true,
          capabilities: ['domain-network-policy'],
        },
      },
    }));
    const result = runCli([
      'run',
      path.join(fixtureRoot, 'valid.yaml'),
      '--dry-run',
      '--capabilities',
      capabilitiesPath,
    ]);
    assert.ifError(result.error);
    assert.strictEqual(result.status, 0, result.stderr);
    assert.strictEqual(result.stderr, '');
    const output = JSON.parse(result.stdout);
    assert.strictEqual(output.result, 'routable');
    assert.strictEqual(output.routes[0].backend, 'microsandbox');
  } finally {
    fs.rmSync(tempRoot, { recursive: true, force: true });
  }
});

test('CLI renders manifest failures as structured JSON', () => {
  const result = runCli([
    'run',
    path.join(fixtureRoot, 'unknown-key.yaml'),
    '--dry-run',
  ]);
  assert.ifError(result.error);
  assert.strictEqual(result.status, 2);
  assert.strictEqual(result.stderr, '');
  const output = JSON.parse(result.stdout);
  assert.strictEqual(output.result, 'error');
  assert.strictEqual(output.error.code, 'contract-invalid');
  assert.match(output.error.message, /backend/);
});

console.log(`\nPassed: ${passed}`);
console.log(`Failed: ${failed}`);
process.exit(failed > 0 ? 1 : 0);
