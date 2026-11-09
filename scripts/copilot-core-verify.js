#!/usr/bin/env node
'use strict';

// Checkout verification only: passing fixtures never certifies native delivery.
const fs = require('fs');
const path = require('path');
const crypto = require('crypto');
const { spawnSync } = require('child_process');
const ROOT = path.resolve(__dirname, '..');
const CHECKS = Object.freeze([
  ['P00', 'scripts/ci/copilot-capabilities.js', '--check'],
  ['P01', 'tests/lib/copilot-event-envelope.test.js'],
  ['P01', 'tests/hooks/copilot-hook-adapter.test.js'],
  ['P01', 'tests/lib/copilot-hooks-install.test.js'],
  ['P02', 'tests/hooks/copilot-guard.test.js'],
  ['P02', 'tests/lib/copilot-evidence.test.js'],
  ['P03', 'tests/hooks/copilot-quality.test.js'],
  ['P03', 'tests/hooks/design-quality-check.test.js'],
  ['P03', 'tests/lib/copilot-phase-install.test.js'],
  ['P04', 'tests/lib/copilot-telemetry.test.js'],
  ['P04', 'tests/lib/copilot-native-skill-telemetry.test.js'],
  ['P04', 'tests/hooks/copilot-native-telemetry.test.js'],
  ['P05', 'tests/lib/copilot-observations.test.js'],
  ['P05', 'tests/lib/copilot-observation-faults.test.js'],
  ['P05', 'tests/lib/copilot-learning-mapping.test.js'],
]);
const GAPS = Object.freeze({
  P00: ['Windows discovery and native pre/post/lifecycle payload evidence'],
  P01: ['Native hook contract and approved platform latency thresholds'],
  P02: ['Native Windows corpus, guard feedback and read-evidence delivery'],
  P03: ['Native check/fix delivery and project toolchains on declared platforms'],
  P04: ['Authenticated skill-event delivery and ephemeral signal availability'],
  P05: ['Native Windows filesystem/event delivery fault matrix'],
});

function verify(options = {}) {
  const runner = options.runner || spawnSync;
  const checks = CHECKS.map(([phase, file, ...args]) => {
    const started = performance.now();
    const result = runner(process.execPath, [path.join(ROOT, file), ...args], {
      cwd: ROOT, encoding: 'utf8', shell: false, timeout: 90000, maxBuffer: 1024 * 1024,
    });
    const output = String(result.stdout || '') + String(result.stderr || '');
    return { phase, file, args, status: !result.error && !result.signal && result.status === 0 ? 'passed' : 'failed',
      exitCode: Number.isInteger(result.status) ? result.status : null,
      durationMs: Math.round(performance.now() - started),
      outputSha256: crypto.createHash('sha256').update(output).digest('hex') };
  });
  const fixturesPassed = checks.every(check => check.status === 'passed');
  const inventoryFile = path.join(ROOT, 'manifests/copilot-capabilities.json');
  return { schema: 'ecc.copilot.core-verification.v1', recordedAt: new Date().toISOString(),
    inventorySha256: fs.existsSync(inventoryFile) ? crypto.createHash('sha256').update(fs.readFileSync(inventoryFile)).digest('hex') : null,
    environment: { platform: process.platform, architecture: process.arch, node: process.version },
    fixturesPassed, complete: false,
    phases: Object.fromEntries(Object.entries(GAPS).map(([phase, pending]) => [phase, {
      implementationChecks: checks.filter(check => check.phase === phase).every(check => check.status === 'passed') ? 'passed' : 'failed',
      nativeAcceptance: 'pending', pending,
    }])), checks };
}

function main(args = process.argv.slice(2)) {
  let output;
  let requireNative = false;
  for (let index = 0; index < args.length; index++) {
    if (args[index] === '--require-native' && !requireNative) requireNative = true;
    else if (args[index] === '--output' && output === undefined && args[index + 1]) {
      output = args[++index];
      if (!path.isAbsolute(output)) throw new Error('Output must be an absolute new file.');
    } else throw new Error('Usage: copilot-core-verify.js [--output ABSOLUTE_NEW_FILE] [--require-native]');
  }
  const report = verify();
  const encoded = JSON.stringify(report, null, 2) + '\n';
  if (output) fs.writeFileSync(output, encoded, { flag: 'wx', mode: 0o600 });
  process.stdout.write(encoded);
  return !report.fixturesPassed ? 1 : requireNative && !report.complete ? 2 : 0;
}
if (require.main === module) {
  try { process.exitCode = main(); }
  catch { process.stderr.write('Core verification failed: invalid arguments or unavailable output. Existing files are preserved.\n'); process.exitCode = 1; }
}
module.exports = { verify, CHECKS };
