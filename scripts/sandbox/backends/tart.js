'use strict';

const { spawn } = require('child_process');
const { executeVm, memoryMiB } = require('./vm');

const DEFAULT_TART_SEED = 'ecc-sandbox-macos-tart-seed';

function parseJson(value) {
  try {
    return JSON.parse(String(value || ''));
  } catch {
    return null;
  }
}

function tartState(value) {
  return String(value?.State || value?.state || '').toLowerCase();
}

function tartSeedReady(result, expected = {}) {
  const parsed = parseJson(result.stdout);
  return Boolean(
    expected.arch === 'arm64'
    && parsed
    && parsed.Running === false
    && tartState(parsed) === 'stopped'
    && String(parsed.OS || parsed.os || '').toLowerCase() === 'darwin'
  );
}

function tartPreflight(invoke, _notes, run) {
  const listing = invoke(['list', '--source', 'local', '--format', 'json']);
  if (listing.error || listing.status !== 0) {
    return { pass: false, note: 'Tart cannot verify the Apple two-guest concurrency limit' };
  }
  const parsed = parseJson(listing.stdout);
  if (!Array.isArray(parsed)) {
    return { pass: false, note: 'Tart returned an unreadable VM inventory; concurrency cannot be verified' };
  }
  let running = parsed.filter(value => (
    value?.Running === true || ['running', 'starting'].includes(tartState(value))
  )).length;
  if (run) {
    const lume = run('lume', ['ls', '--format', 'json'], {
      encoding: 'utf8', shell: false, timeout: 5_000, maxBuffer: 1024 * 1024,
    });
    if (lume.error?.code !== 'ENOENT') {
      const lumeValues = parseJson(lume.stdout);
      if (lume.error || lume.status !== 0 || !Array.isArray(lumeValues)) {
        return { pass: false, note: 'Tart cannot verify the cross-backend Apple guest limit through Lume' };
      }
      running += lumeValues.filter(value => (
        ['running', 'starting'].includes(String(value?.status || value?.state || '').toLowerCase())
      )).length;
    }
  }
  return running >= 2
    ? { pass: false, note: 'Apple permits at most two concurrent macOS guests; stop one Tart VM and retry' }
    : { pass: true };
}

function startTart(executable, argv, options = {}) {
  try {
    const child = spawn(executable, argv, {
      cwd: options.cwd,
      detached: false,
      shell: false,
      stdio: 'ignore',
      windowsHide: true,
    });
    child.once('error', () => {});
    if (!Number.isInteger(child.pid)) {
      child.unref();
      return {
        status: null,
        stdout: '',
        stderr: '',
        error: new Error('Tart headless process did not start'),
      };
    }
    return { status: 0, stdout: '', stderr: '', error: null, child };
  } catch (error) {
    return { status: null, stdout: '', stderr: '', error };
  }
}

const TART_DRIVER = {
  backend: 'tart',
  binary: 'tart',
  lockName: 'apple-macos-guests',
  os: 'macos',
  defaultSeed: DEFAULT_TART_SEED,
  seedCheckArgs: seed => ['get', seed, '--format', 'json'],
  seedReady: tartSeedReady,
  seedFix: seed => `tart clone ghcr.io/cirruslabs/macos-tahoe-base:latest ${seed}`,
  preflight: tartPreflight,
  cloneArgs: (seed, vmName) => ['clone', seed, vmName],
  configureArgs: (vmName, manifest) => [
    'set', vmName,
    '--cpu', String(manifest.resources.cpu),
    '--memory', String(memoryMiB(manifest.resources.memory)),
  ],
  startArgs: (vmName, manifest) => [
    'run',
    '--no-graphics',
    '--no-audio',
    '--no-clipboard',
    ...(manifest.needs.capabilities.some(value => value.startsWith('network:'))
      ? []
      : ['--net-host']),
    vmName,
  ],
  readyArgs: vmName => ['exec', vmName, '/usr/bin/true'],
  execArgs: (vmName, command) => [
    'exec', vmName, '/bin/bash', '-lc', command,
  ],
  scanArgs: (vmName, command) => [
    'exec', vmName, '/bin/sh', '-c', command,
  ],
  stopArgs: vmName => ['stop', '--timeout', '30', vmName],
  deleteArgs: vmName => ['delete', vmName],
  missingInstance: result => /(?:does not exist|not found|no such virtual machine)/i.test(
    `${result.stderr || ''}\n${result.stdout || ''}`
  ),
  cleanupFix: vmName => `tart stop ${vmName} && tart delete ${vmName}`,
  notes: [
    'Tart uses Fair Source 100 licensing; personal use is free, while some large organizational server installations require a paid license',
    'Tart is optional and is never an ECC installation recommendation',
  ],
};

function executeTart(manifest, options = {}) {
  // DECISION: CONVENTIONS item 30 permits Tart only when its pinned CLI is
  // already installed, and uses a stopped guest-agent-enabled local seed.
  return executeVm(manifest, {
    ...options,
    driver: TART_DRIVER,
    seed: options.seed || process.env.ECC_SANDBOX_TART_SEED || DEFAULT_TART_SEED,
    start: options.start || (options.mock ? undefined : startTart),
  });
}

module.exports = {
  DEFAULT_TART_SEED,
  TART_DRIVER,
  executeTart,
  startTart,
  tartPreflight,
  tartSeedReady,
};
