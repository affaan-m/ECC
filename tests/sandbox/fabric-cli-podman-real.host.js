'use strict';

const { runHostFabricSmoke } = require('./fabric-host-smoke-helpers');

console.log('\n=== ECC sandbox real Tier 1 Podman fabric smoke ===\n');

process.exitCode = runHostFabricSmoke({
  backend: 'podman',
  tier: 1,
  manifest: 'examples/sandbox/review-tier1-podman.yaml',
  timeoutMs: 120_000,
  requireCompleteDiff: true,
  requireHost: process.argv.includes('--require-host'),
});
