'use strict';

const assert = require('assert');

const {
  explainRouteRanking,
  rankEligibleRoutes,
} = require('../../scripts/sandbox/fabric/route-policy');

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

function route(overrides = {}) {
  return {
    os: overrides.os || 'linux',
    arch: overrides.arch || 'arm64',
    backend: overrides.backend || 'podman',
    tier: overrides.tier ?? 1,
    rule: overrides.rule || 'tier-1-ephemeral',
    reason: overrides.reason || 'fixture',
    notes: overrides.notes || [],
    result: overrides.result || 'routable',
  };
}

function manifest(overrides = {}) {
  return {
    name: 'fabric-policy',
    needs: {
      os: overrides.os || ['linux'],
      arch: overrides.arch || ['arm64'],
      capabilities: overrides.capabilities || ['clean-home'],
      trust: overrides.trust || 'first-party',
      native: overrides.native || false,
    },
    resources: { cpu: 2, memory: '1GB', timeout: 120 },
    steps: { setup: ['true'], assert: ['true'] },
    report: 'exit-only',
  };
}

console.log('\n=== ECC sandbox fabric route policy tests ===\n');

test('falls back to deterministic router order when history has no usable evidence', () => {
  const routes = [
    route({ backend: 'podman', tier: 1 }),
    route({ backend: 'lume', tier: 2, os: 'macos', arch: 'arm64' }),
  ];
  const ranking = rankEligibleRoutes(manifest(), routes, {
    history: [
      { backend: 'lume', execution_mode: 'mock', result: 'pass', cleanup: { pass: true }, active_total_ms: 1 },
      { backend: 'podman', execution_mode: 'real', result: 'pass', cleanup: { pass: false }, active_total_ms: 1 },
    ],
  });

  assert.deepStrictEqual(ranking.routes.map(item => item.backend), ['podman', 'lume']);
  assert.strictEqual(ranking.selected.backend, 'podman');
  assert.strictEqual(ranking.mode, 'deterministic');
  assert.match(ranking.explanations[0], /no eligible real cleanup-complete history/i);
});

test('shadow ranking reorders only static eligible routes and records explanations', () => {
  const routes = [
    route({ backend: 'podman', tier: 1 }),
    route({ backend: 'lima', tier: 2, rule: 'tier-2-native' }),
    route({ backend: null, tier: null, result: 'error' }),
  ];
  const ranking = rankEligibleRoutes(manifest({ capabilities: ['services', 'network:*'], native: true }), routes, {
    history: [
      { backend: 'podman', tier: 1, os: 'linux', arch: 'arm64', execution_mode: 'real', result: 'pass', cleanup: { pass: true }, active_total_ms: 5000 },
      { backend: 'lima', tier: 2, os: 'linux', arch: 'arm64', execution_mode: 'real', result: 'pass', cleanup: { pass: true }, active_total_ms: 1200 },
    ],
  });

  assert.deepStrictEqual(ranking.routes.map(item => item.backend), ['lima', 'podman']);
  assert.strictEqual(ranking.selected.backend, 'lima');
  assert.strictEqual(ranking.mode, 'shadow');
  assert.ok(ranking.explanations.some(line => /ranked lima before podman/i.test(line)));
  assert.strictEqual(ranking.ignored_routes, 1);
});

test('ranker never widens authority beyond the supplied eligible route set', () => {
  const ranking = rankEligibleRoutes(manifest({ capabilities: [] }), [
    route({ backend: 'srt', tier: 0, os: 'macos', arch: 'arm64' }),
  ], {
    history: [
      { backend: 'podman', tier: 1, os: 'linux', arch: 'arm64', execution_mode: 'real', result: 'pass', cleanup: { pass: true }, active_total_ms: 10 },
    ],
  });

  assert.deepStrictEqual(ranking.routes.map(item => item.backend), ['srt']);
  assert.strictEqual(ranking.selected.backend, 'srt');
  assert.ok(ranking.explanations.some(line => /ignored history for unavailable backend podman/i.test(line)));
});

test('explanation helper is stable and excludes mock and cleanup-incomplete runs', () => {
  const explanation = explainRouteRanking([
    route({ backend: 'podman' }),
    route({ backend: 'lima', tier: 2, rule: 'tier-2-native' }),
  ], [
    { backend: 'podman', execution_mode: 'mock', result: 'pass', cleanup: { pass: true }, active_total_ms: 1 },
    { backend: 'podman', execution_mode: 'real', result: 'pass', cleanup: { pass: false }, active_total_ms: 1 },
    { backend: 'lima', execution_mode: 'real', result: 'fail', cleanup: { pass: true }, active_total_ms: 1 },
    { backend: 'lima', execution_mode: 'real', result: 'pass', cleanup: { pass: true }, active_total_ms: 99 },
  ]);

  assert.deepStrictEqual(explanation.backends, ['lima']);
  assert.deepStrictEqual(explanation.ignored_reasons, {
    'mock-history': 1,
    'cleanup-incomplete': 1,
    'non-passing-history': 1,
  });
});

console.log(`\nPassed: ${passed}`);
console.log(`Failed: ${failed}`);
process.exit(failed > 0 ? 1 : 0);
