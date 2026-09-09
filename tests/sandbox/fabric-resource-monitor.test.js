'use strict';

const assert = require('assert');
const fs = require('fs');
const os = require('os');
const path = require('path');
const { createResourceMonitor } = require('../../scripts/sandbox/fabric/resource-monitor');
const { validateResourceMonitoring } = require('../../scripts/sandbox/fabric/contracts');

let passed = 0;
let failed = 0;

async function test(name, fn) {
  try {
    await fn();
    console.log(`  ✓ ${name}`);
    passed += 1;
  } catch (error) {
    console.log(`  ✗ ${name}\n    Error: ${error.stack || error.message}`);
    failed += 1;
  }
}

function manifest() {
  return { resources: { cpu: 2, memory: '1GB', timeout: 30 } };
}

function workspace() {
  return fs.mkdtempSync(path.join(os.tmpdir(), 'ecc-resource-monitor-'));
}

console.log('\n=== ECC execution fabric resource monitoring tests ===\n');

(async () => {
  await test('discloses missing dynamic telemetry while measuring workspace growth', async () => {
    const root = workspace();
    let clock = Date.parse('2026-09-08T12:00:00.000Z');
    try {
      const monitor = createResourceMonitor({
        abort: () => assert.fail('missing optional telemetry must not invent a limit breach'),
        backend: 'srt',
        jobId: 'job_missing_telemetry',
        manifest: manifest(),
        now: () => clock,
        workspacePath: root,
      });
      await monitor.start();
      fs.writeFileSync(path.join(root, 'artifact.bin'), Buffer.alloc(512));
      clock += 100;
      const receipt = await monitor.finish();
      assert.strictEqual(validateResourceMonitoring(receipt), receipt);
      assert.strictEqual(receipt.status, 'warn');
      assert.strictEqual(receipt.telemetry, 'missing');
      assert.strictEqual(receipt.controls.cpu, 'unavailable');
      assert.strictEqual(receipt.samples.at(-1).storage_growth_bytes, 512);
      assert.match(receipt.warnings[0], /telemetry/i);
    } finally {
      fs.rmSync(root, { recursive: true, force: true });
    }
  });

  await test('stops an over-memory worker and records the cleanup trigger', async () => {
    const root = workspace();
    const clock = Date.parse('2026-09-08T12:00:00.000Z');
    let stopped = null;
    try {
      const monitor = createResourceMonitor({
        abort: error => { stopped = error; },
        backend: 'podman',
        jobId: 'job_memory_limit',
        manifest: manifest(),
        now: () => clock,
        sampler: () => ({
          observed_ms: clock,
          cpu_cores: 1,
          memory_bytes: 2 * 1024 ** 3,
          processes: 4,
          output_bytes: 20,
          spend: { amount: 0, currency: 'USD' },
        }),
        workspacePath: root,
      });
      await monitor.start();
      const receipt = await monitor.finish(null, true);
      assert.strictEqual(stopped.code, 'FABRIC_RESOURCE_LIMIT_EXCEEDED');
      assert.strictEqual(receipt.status, 'stopped');
      assert.strictEqual(receipt.cleanup_triggered, true);
      assert.match(receipt.stop_reason, /memory limit exceeded/i);
      assert.strictEqual(validateResourceMonitoring(receipt), receipt);
    } finally {
      fs.rmSync(root, { recursive: true, force: true });
    }
  });

  await test('treats stale telemetry as a stop condition', async () => {
    const root = workspace();
    const clock = Date.parse('2026-09-08T12:00:10.000Z');
    let stopped = null;
    try {
      const monitor = createResourceMonitor({
        abort: error => { stopped = error; },
        backend: 'lume',
        intervalMs: 50,
        jobId: 'job_stale_telemetry',
        manifest: manifest(),
        now: () => clock,
        sampler: () => ({ observed_ms: clock - 6_000 }),
        workspacePath: root,
      });
      await monitor.start();
      const receipt = await monitor.finish(null, true);
      assert.strictEqual(stopped.code, 'FABRIC_RESOURCE_LIMIT_EXCEEDED');
      assert.strictEqual(receipt.telemetry, 'stale');
      assert.match(receipt.stop_reason, /stale/i);
      assert.strictEqual(validateResourceMonitoring(receipt), receipt);
    } finally {
      fs.rmSync(root, { recursive: true, force: true });
    }
  });

  console.log(`\nPassed: ${passed}`);
  console.log(`Failed: ${failed}`);
  process.exitCode = failed > 0 ? 1 : 0;
})();
