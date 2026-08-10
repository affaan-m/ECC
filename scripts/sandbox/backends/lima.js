'use strict';

const { executeVm, memoryGiB } = require('./vm');

const DEFAULT_LIMA_SEED = 'ecc-sandbox-linux-seed';

function parseJson(value) {
  try {
    return JSON.parse(String(value || ''));
  } catch {
    return null;
  }
}

function limaSeedReady(result, expected = {}) {
  const parsed = parseJson(result.stdout);
  const values = Array.isArray(parsed) ? parsed : [parsed];
  const expectedArch = expected.arch === 'arm64' ? 'aarch64' : expected.arch;
  return values.some(value => (
    value
    && ['stopped', 'stopped (protected)'].includes(
      String(value.status || value.state || '').toLowerCase()
    )
    && value.arch === expectedArch
    && value.config?.os === 'Linux'
    && value.config?.arch === expectedArch
    && value.config?.plain === true
  ));
}

const LIMA_DRIVER = {
  backend: 'lima',
  binary: 'limactl',
  os: 'linux',
  defaultSeed: DEFAULT_LIMA_SEED,
  seedCheckArgs: seed => ['list', seed, '--format', 'json'],
  seedReady: limaSeedReady,
  seedFix: seed => `limactl --tty=false create --name ${seed} --plain template:default`,
  cloneArgs: (seed, vmName, manifest) => [
    '--tty=false',
    'clone',
    '--cpus', String(manifest.resources.cpu),
    '--memory', String(memoryGiB(manifest.resources.memory)),
    '--mount-none',
    seed,
    vmName,
  ],
  configureArgs: (vmName, manifest) => [
    '--tty=false',
    'edit',
    '--plain',
    '--mount-none',
    '--cpus', String(manifest.resources.cpu),
    '--memory', String(memoryGiB(manifest.resources.memory)),
    vmName,
  ],
  startArgs: (vmName, manifest) => [
    '--tty=false', 'start', '--timeout', `${manifest.resources.timeout}s`, vmName,
  ],
  readyArgs: vmName => ['--tty=false', 'shell', vmName, '--', '/bin/true'],
  execArgs: (vmName, command) => [
    '--tty=false', 'shell', vmName, '--', '/bin/bash', '-lc', command,
  ],
  scanArgs: (vmName, command) => [
    '--tty=false', 'shell', vmName, '--', '/bin/sh', '-c', command,
  ],
  stopArgs: vmName => ['--tty=false', 'stop', '--force', vmName],
  deleteArgs: vmName => ['--tty=false', 'delete', '--force', vmName],
  missingInstance: result => /(?:does not exist|no instance|not found)/i.test(
    `${result.stderr || ''}\n${result.stdout || ''}`
  ),
  cleanupFix: vmName => `limactl stop --force ${vmName} && limactl delete --force ${vmName}`,
};

function executeLima(manifest, options = {}) {
  // DECISION: CONVENTIONS item 29 clones a stopped mount-free Lima seed so a
  // native Linux guest never inherits the host home or workspace.
  return executeVm(manifest, {
    ...options,
    driver: LIMA_DRIVER,
    seed: options.seed || process.env.ECC_SANDBOX_LIMA_SEED || DEFAULT_LIMA_SEED,
  });
}

module.exports = {
  DEFAULT_LIMA_SEED,
  LIMA_DRIVER,
  executeLima,
  limaSeedReady,
};
