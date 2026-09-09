'use strict';

const fs = require('fs');
const net = require('net');
const path = require('path');

const workspace = process.cwd();
const outsideReadTarget = path.resolve(workspace, '..', 'tier0-host-canary.txt');
const expectedDenials = new Set(['EACCES', 'EPERM', 'EROFS']);

function pass(message) {
  process.stdout.write(`PASS  ${message}\n`);
}

function requireExpectedDenial(action, target, operation) {
  try {
    operation();
  } catch (error) {
    if (expectedDenials.has(error.code)) {
      pass(`${action} was blocked with ${error.code}: ${target}`);
      return;
    }
    throw error;
  }
  throw new Error(`${action} unexpectedly succeeded: ${target}`);
}

function proveWorkspaceBoundary() {
  const visible = fs.readFileSync(path.resolve(workspace, 'workspace-visible.txt'), 'utf8').trim();
  if (visible !== 'Tier 0 may read this dedicated workspace file.') {
    throw new Error('workspace fixture changed');
  }
  pass('workspace read succeeded');

  const writeProbeDirectory = fs.mkdtempSync(path.resolve(workspace, '.tier0-write-proof-'));
  const writeProbe = path.join(writeProbeDirectory, 'result.txt');
  let written;
  try {
    fs.writeFileSync(writeProbe, 'workspace write succeeded\n', { flag: 'wx' });
    written = fs.readFileSync(writeProbe, 'utf8').trim();
  } finally {
    fs.rmSync(writeProbeDirectory, { recursive: true, force: true });
  }
  if (written !== 'workspace write succeeded') throw new Error('workspace write verification failed');
  pass('workspace write succeeded and was cleaned up');

  requireExpectedDenial('outside-workspace read', outsideReadTarget, () => {
    fs.readFileSync(outsideReadTarget, 'utf8');
  });
}

function proveEnvironmentBoundary() {
  const forbidden = ['AWS_ACCESS_KEY_ID', 'GITHUB_TOKEN', 'SSH_AUTH_SOCK', 'TIER0_HOST_SECRET'];
  const exposed = forbidden.filter(name => Object.hasOwn(process.env, name));
  if (exposed.length > 0) throw new Error(`secret-bearing environment names leaked: ${exposed.join(', ')}`);
  pass('secret-bearing environment variables are absent');
}

function proveLocalEndpointBlocked() {
  return new Promise((resolve, reject) => {
    const server = net.createServer();
    const timer = setTimeout(() => {
      server.close();
      reject(new Error('local endpoint check timed out'));
    }, 2000);

    server.once('error', error => {
      clearTimeout(timer);
      if (expectedDenials.has(error.code)) {
        pass(`local TCP endpoint binding was blocked with ${error.code}`);
        resolve();
        return;
      }
      reject(error);
    });

    server.listen(0, '127.0.0.1', () => {
      clearTimeout(timer);
      const address = server.address();
      server.close(() => reject(new Error(`local endpoint unexpectedly opened on ${address.port}`)));
    });
  });
}

async function main() {
  process.stdout.write(`\nTier 0 isolation proof in ${workspace}\n`);
  proveWorkspaceBoundary();
  proveEnvironmentBoundary();
  await proveLocalEndpointBlocked();
  process.stdout.write('RESULT: all Tier 0 isolation checks passed\n');
}

main().catch(error => {
  process.stderr.write(`FAIL  ${error.message}\n`);
  process.exitCode = 1;
});
