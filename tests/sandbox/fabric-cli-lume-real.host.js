'use strict';

const { runHostFabricSmoke } = require('./fabric-host-smoke-helpers');

console.log('\n=== ECC sandbox real Tier 2 Lume fabric smoke ===\n');

process.exitCode = runHostFabricSmoke({
  backend: 'lume',
  tier: 2,
  manifest: 'examples/sandbox/review-tier2-lume.yaml',
  timeoutMs: 480_000,
  requiredHost: { os: 'macos', arch: 'arm64' },
  requireHost: process.argv.includes('--require-host'),
});
