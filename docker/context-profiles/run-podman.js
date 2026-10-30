#!/usr/bin/env node
'use strict';

const assert = require('node:assert/strict');
const crypto = require('node:crypto');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { spawnSync } = require('node:child_process');

const repoRoot = path.resolve(__dirname, '../..');
const temp = fs.mkdtempSync(path.join(os.tmpdir(), 'ecc-context-podman-'));
const image = `localhost/ecc-context-profiles:${process.pid}-${Date.now()}`;
function run(command, args, capture = false) {
  const result = spawnSync(command, args, { cwd: repoRoot, encoding: 'utf8',
    timeout: 600000, maxBuffer: 32 * 1024 * 1024, stdio: capture ? 'pipe' : 'inherit' });
  assert.equal(result.status, 0, `${command}: ${result.error || result.stderr || result.stdout}`);
  return result.stdout;
}
try {
  const packed = JSON.parse(run('npm', ['pack', '--json', '--pack-destination', temp], true));
  const { planContextCarrier } = require('../../scripts/lib/context-carriers');
  const expected = [];
  for (const target of ['claude', 'codex', 'pi', 'opencode', 'cursor']) {
    for (const profileId of ['lean@1', 'full@1']) {
      expected.push(planContextCarrier({ repoRoot, target, profileId, selectionMode: 'auto' }));
    }
  }
  const archivePaths = new Set(packed[0].files.map(file => file.path));
  const missing = expected[1].files.filter(file => file.kind === 'copy' && !archivePaths.has(file.sourcePath));
  assert.deepEqual(missing, [], 'Packed archive omitted canonical skill resources');
  fs.writeFileSync(path.join(temp, 'expected-carriers.json'), JSON.stringify(expected));
  fs.renameSync(path.join(temp, packed[0].filename), path.join(temp, 'package.tgz'));
  for (const file of ['Dockerfile', 'native-probe.js', 'native-switch-probe.js', 'packed-smoke.js']) {
    fs.copyFileSync(path.join(__dirname, file), path.join(temp, file));
  }
  fs.copyFileSync(path.join(repoRoot, 'tests/lib/helpers/context-carrier-fixture.js'),
    path.join(temp, 'context-carrier-fixture.js'));
  const packageDigest = crypto.createHash('sha256').update(fs.readFileSync(path.join(temp, 'package.tgz'))).digest('hex');
  process.stdout.write(`${JSON.stringify({ packageDigest, image })}\n`);
  const args = ['build', '--tag', image];
  if (process.env.ECC_CONTEXT_NODE_IMAGE) args.push('--build-arg', `NODE_IMAGE=${process.env.ECC_CONTEXT_NODE_IMAGE}`);
  args.push(temp);
  run('podman', args);
  run('podman', ['run', '--rm', '--network=none', '--cap-drop=all', '--security-opt=no-new-privileges', image]);
} finally {
  // Only the image and temporary directory created by this invocation are removed.
  spawnSync('podman', ['image', 'rm', image], { stdio: 'ignore', timeout: 60000 });
  fs.rmSync(temp, { recursive: true, force: true });
}
