'use strict';

const assert = require('assert');
const {
  blockedExitCode,
  classifyHost,
} = require('./fabric-host-smoke-helpers');

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

console.log('\n=== ECC sandbox host lane contract tests ===\n');

test('classifies an unsupported native host as skipped', () => {
  assert.deepStrictEqual(classifyHost({
    backend: 'lume',
    capabilities: {
      host: { os: 'linux', arch: 'x86_64' },
      backends: { lume: { available: false, reason: 'requires Apple Silicon' } },
    },
    requiredHost: { os: 'macos', arch: 'arm64' },
  }), {
    status: 'skipped',
    reason: 'requires macos/arm64; detected linux/x86_64',
    fix: null,
  });
});

test('classifies a missing runtime on a supported host as blocked', () => {
  assert.deepStrictEqual(classifyHost({
    backend: 'podman',
    capabilities: {
      host: { os: 'macos', arch: 'arm64' },
      backends: {
        podman: {
          available: false,
          reason: 'Podman machine is not running',
          fix: 'Start Podman: podman machine start',
        },
      },
    },
  }), {
    status: 'blocked',
    reason: 'Podman machine is not running',
    fix: 'Start Podman: podman machine start',
  });
});

test('admits only an available backend to real execution', () => {
  assert.deepStrictEqual(classifyHost({
    backend: 'podman',
    capabilities: {
      host: { os: 'linux', arch: 'x86_64' },
      backends: { podman: { available: true, state: 'ready' } },
    },
  }), { status: 'ready', reason: null, fix: null });
});

test('optional host lanes skip cleanly while required lanes fail closed', () => {
  assert.strictEqual(blockedExitCode(false), 0);
  assert.strictEqual(blockedExitCode(true), 2);
});

console.log(`\nPassed: ${passed}`);
console.log(`Failed: ${failed}`);
process.exit(failed > 0 ? 1 : 0);
