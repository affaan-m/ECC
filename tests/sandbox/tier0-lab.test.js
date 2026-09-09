'use strict';

const assert = require('assert');
const fs = require('fs');
const path = require('path');
const { spawnSync } = require('child_process');
const { loadManifest } = require('../../scripts/sandbox/contracts');
const { routeManifest } = require('../../scripts/sandbox/router');

const repoRoot = path.join(__dirname, '..', '..');
const labRoot = path.join(repoRoot, 'examples', 'sandbox', 'tier0-lab');
const manifestPath = path.join(labRoot, 'sandbox.yaml');

const manifest = loadManifest(manifestPath);
assert.strictEqual(manifest.name, 'tier0-interactive-lab');
assert.deepStrictEqual(manifest.needs.os, ['any']);
assert.deepStrictEqual(manifest.needs.capabilities, ['fs-write']);
assert.strictEqual(manifest.needs.trust, 'untrusted');
assert.strictEqual(manifest.needs.native, false);
assert.strictEqual(manifest.report, 'exit-only');

const decision = routeManifest(manifest, {
  schema_version: 1,
  host: {
    os: 'macos',
    arch: 'arm64',
    cpus: 8,
    inside_container: false,
    virtualization: 'available',
  },
  backends: {
    srt: {
      available: true,
      state: 'ready',
      targets: [{ os: 'macos', arch: 'arm64' }],
    },
  },
}, { manifestPath });

assert.strictEqual(decision.result, 'routable');
assert.strictEqual(decision.routes.length, 1);
assert.strictEqual(decision.routes[0].backend, 'srt');
assert.strictEqual(decision.routes[0].tier, 0);

const proof = fs.readFileSync(path.join(labRoot, 'prove-isolation.js'), 'utf8');
assert.match(proof, /tier0-host-canary\.txt/);
assert.match(proof, /createServer/);
assert.doesNotMatch(proof, /\/Users\//);

assert.match(fs.readFileSync(path.join(labRoot, 'producer.mjs'), 'utf8'), /hello from process A/);
assert.match(fs.readFileSync(path.join(labRoot, 'consumer.mjs'), 'utf8'), /process B received/);

const hostRun = spawnSync(process.execPath, [path.join(labRoot, 'prove-isolation.js')], {
  cwd: labRoot,
  encoding: 'utf8',
  shell: false,
});
assert.strictEqual(hostRun.status, 1);
assert.match(hostRun.stderr, /outside-workspace read unexpectedly succeeded/);
assert.deepStrictEqual(
  fs.readdirSync(labRoot).filter(entry => entry.startsWith('.tier0-write-proof-')),
  []
);
assert.strictEqual(fs.existsSync(path.join(labRoot, '..', 'tier0-escape-attempt.txt')), false);

console.log('  ✓ Tier 0 interactive lab contract and route');
