'use strict';

const { spawn, spawnSync } = require('child_process');
const { isIP } = require('net');
const { executeVm } = require('./vm');

const DEFAULT_LUME_SEED = 'ecc-sandbox-macos-seed';

function parseJson(value) {
  const text = String(value || '').trim();
  try {
    return JSON.parse(text);
  } catch {
    const lines = text.split(/\r?\n/);
    for (let index = 1; index < lines.length; index += 1) {
      const candidate = lines.slice(index).join('\n').trim();
      if (!candidate.startsWith('{') && !candidate.startsWith('[')) continue;
      try {
        return JSON.parse(candidate);
      } catch {
        // Lume may prepend multiple timestamped INFO lines before JSON output.
      }
    }
    return null;
  }
}

function stateOf(value) {
  return String(value?.state || value?.status || '').toLowerCase();
}

function lumeSeedReady(result, expected = {}) {
  const parsed = parseJson(result.stdout);
  const values = Array.isArray(parsed) ? parsed : [parsed];
  return expected.arch === 'arm64' && values.some(details => (
    details
    && ['stopped', 'halted'].includes(stateOf(details))
    && ['macos', 'darwin'].includes(String(details.os || '').toLowerCase())
  ));
}

function lumeGuestStopped(result) {
  const parsed = parseJson(result.stdout);
  const values = Array.isArray(parsed) ? parsed : [parsed];
  return values.some(details => (
    details && ['stopped', 'halted'].includes(stateOf(details))
  ));
}

function shellQuote(value) {
  return `'${String(value).replace(/'/g, `'"'"'`)}'`;
}

function readProcessIdentity(pid, run = spawnSync) {
  const result = run('/bin/ps', [
    '-p', String(pid), '-o', 'lstart=', '-o', 'command=',
  ], {
    encoding: 'utf8',
    shell: false,
    windowsHide: true,
    maxBuffer: 1024 * 1024,
    timeout: 5_000,
  });
  if (result.error || result.status !== 0) return null;
  const match = String(result.stdout || '').trim().match(
    /^(\S+\s+\S+\s+\d{1,2}\s+\d{2}:\d{2}:\d{2}\s+\d{4})\s+(.+)$/
  );
  return match ? { started: match[1], command: match[2] } : null;
}

function processGroupIsAlive(processGroup, run = spawnSync) {
  const result = run('/bin/ps', ['-axo', 'pgid=,state='], {
    encoding: 'utf8',
    shell: false,
    windowsHide: true,
    maxBuffer: 1024 * 1024,
    timeout: 5_000,
  });
  if (result.error || result.status !== 0) return true;
  return String(result.stdout || '').split(/\r?\n/).some(line => {
    const match = line.trim().match(/^(\d+)\s+(\S+)/);
    return Number(match?.[1]) === processGroup && !String(match?.[2] || '').includes('Z');
  });
}

function readProcessTable(run = spawnSync) {
  const result = run('/bin/ps', [
    '-axo', 'pid=,ppid=,pgid=,state=,lstart=,command=',
  ], {
    encoding: 'utf8',
    shell: false,
    windowsHide: true,
    maxBuffer: 4 * 1024 * 1024,
    timeout: 5_000,
  });
  if (result.error || result.status !== 0) return null;
  return String(result.stdout || '').split(/\r?\n/).flatMap(line => {
    const match = line.match(
      /^\s*(\d+)\s+(\d+)\s+(\d+)\s+(\S+)\s+(\S+\s+\S+\s+\d{1,2}\s+\d{2}:\d{2}:\d{2}\s+\d{4})\s+(.+)$/
    );
    return match ? [{
      pid: Number(match[1]),
      ppid: Number(match[2]),
      pgid: Number(match[3]),
      state: match[4],
      started: match[5],
      command: match[6],
    }] : [];
  });
}

function descendantsOf(rootPid, processes) {
  const descendants = [];
  const parents = new Set([rootPid]);
  let added = true;
  while (added) {
    added = false;
    for (const entry of processes) {
      if (!parents.has(entry.pid) && parents.has(entry.ppid)) {
        parents.add(entry.pid);
        descendants.push(entry);
        added = true;
      }
    }
  }
  return descendants;
}

function lumeOwnershipMarker(result) {
  const parsed = parseJson(result.stdout);
  const values = Array.isArray(parsed) ? parsed : [parsed];
  const address = values.find(value => isIP(value?.ipAddress))?.ipAddress;
  return address ? { guestAddress: address } : null;
}

function startLume(executable, argv, options = {}) {
  const launch = options.launch || spawn;
  const processIdentity = options.processIdentity || (pid => readProcessIdentity(pid));
  const groupIsAlive = options.processGroupIsAlive || (pid => processGroupIsAlive(pid));
  const processTable = options.processTable || (() => readProcessTable());
  const signalProcess = options.signalProcess || process.kill.bind(process);
  const sleep = options.sleep || (milliseconds => {
    Atomics.wait(new Int32Array(new SharedArrayBuffer(4)), 0, 0, milliseconds);
  });
  let child;
  try {
    child = launch(executable, argv, {
      cwd: options.cwd,
      detached: true,
      shell: false,
      stdio: 'ignore',
      windowsHide: true,
    });
    child.once('error', () => {});
  } catch (error) {
    return { status: null, stdout: '', stderr: '', error };
  }
  const pid = child.pid;
  if (!Number.isInteger(pid) || pid < 1) {
    child.unref();
    return {
      status: null,
      stdout: '',
      stderr: '',
      error: new Error('Lume launcher did not report its PID'),
    };
  }
  const expectedCommand = options.expectedCommand || `lume run ${argv[1]}`;
  let identity = null;
  for (let attempt = 0; attempt < 50; attempt += 1) {
    const candidate = processIdentity(pid);
    if (candidate?.command.includes(expectedCommand)) {
      identity = candidate;
      break;
    }
    sleep(20);
  }
  if (!identity) {
    try {
      process.kill(-pid, 'SIGTERM');
    } catch {
      child.kill('SIGTERM');
    }
    child.unref();
    return {
      status: null,
      stdout: '',
      stderr: '',
      error: new Error(`Lume launcher identity did not match ${expectedCommand}`),
    };
  }
  child.isOwned = () => {
    const current = processIdentity(pid);
    return Boolean(
      current
      && current.started === identity.started
      && current.command.includes(expectedCommand)
    );
  };
  const captured = new Map();
  const ownershipMarkers = new Set();
  const isCaptured = entry => {
    const current = processIdentity(entry.pid);
    return Boolean(
      current
      && current.started === entry.started
      && current.command === entry.command
    );
  };
  const captureEntry = entry => {
    if (!entry.state.includes('Z') && isCaptured(entry)) captured.set(entry.pid, entry);
  };
  const discoverMarkedHelpers = () => {
    if (ownershipMarkers.size === 0) return [];
    const processes = processTable();
    if (!Array.isArray(processes)) return null;
    const helpers = processes.filter(entry => {
      const commandTokens = entry.command.trim().split(/\s+/);
      return commandTokens[0] === '/usr/bin/ssh'
        && [...ownershipMarkers].some(address => commandTokens.includes(`lume@${address}`))
        && entry.command.includes('VNC_PORT=');
    });
    helpers.forEach(captureEntry);
    return helpers;
  };
  child.addOwnershipMarker = marker => {
    if (!marker || !isIP(marker.guestAddress)) return false;
    ownershipMarkers.add(marker.guestAddress);
    discoverMarkedHelpers();
    return true;
  };
  child.helperBarrierReady = () => {
    const helpers = discoverMarkedHelpers();
    return child.isOwned() && Array.isArray(helpers) && helpers.every(entry => !isCaptured(entry));
  };
  child.isAlive = () => (
    discoverMarkedHelpers() === null
    ||
    groupIsAlive(pid)
    || [...captured.values()].some(entry => isCaptured(entry))
  );
  child.prepareStop = () => {
    if (!child.isOwned()) return false;
    try {
      signalProcess(pid, 'SIGSTOP');
      for (let attempt = 0; attempt < 4; attempt += 1) {
        const processes = processTable();
        if (!Array.isArray(processes)) throw new Error('process table unavailable');
        const rootEntry = processes.find(entry => entry.pid === pid);
        if (
          !rootEntry
          || rootEntry.started !== identity.started
          || !rootEntry.command.includes(expectedCommand)
        ) {
          throw new Error('verified launcher is absent from process table');
        }
        let added = false;
        for (const entry of descendantsOf(pid, processes)) {
          if (entry.state.includes('Z') || captured.has(entry.pid)) continue;
          if (!isCaptured(entry)) continue;
          signalProcess(entry.pid, 'SIGSTOP');
          captureEntry(entry);
          added = true;
        }
        if (!added) break;
        sleep(10);
      }
      return true;
    } catch {
      try {
        if (child.isOwned()) signalProcess(pid, 'SIGCONT');
      } catch {
        // The caller will use name-based cleanup and report the failure.
      }
      return false;
    }
  };
  child.signalOwned = signal => {
    if (!child.isOwned()) throw new Error('Lume launcher identity changed before cleanup');
    for (const entry of [...captured.values()].reverse()) {
      if (!isCaptured(entry)) continue;
      signalProcess(entry.pid, 'SIGTERM');
      if (isCaptured(entry)) signalProcess(entry.pid, 'SIGCONT');
    }
    signalProcess(pid, 'SIGCONT');
    signalProcess(-pid, signal);
  };
  child.forceStop = () => {
    for (const entry of [...captured.values()].reverse()) {
      if (isCaptured(entry)) signalProcess(entry.pid, 'SIGKILL');
    }
    if (child.isOwned()) {
      signalProcess(pid, 'SIGCONT');
      signalProcess(-pid, 'SIGKILL');
      return true;
    }
    return !groupIsAlive(pid);
  };
  child.unref();
  return {
    status: 0,
    stdout: '',
    stderr: '',
    error: null,
    child,
  };
}

function lumePreflight(invoke, _notes, run) {
  const listing = invoke(['ls', '--format', 'json']);
  if (listing.error || listing.status !== 0) {
    return { pass: false, note: 'Lume cannot verify the Apple two-guest concurrency limit' };
  }
  const parsed = parseJson(listing.stdout);
  const values = Array.isArray(parsed) ? parsed : (Array.isArray(parsed?.vms) ? parsed.vms : null);
  if (!Array.isArray(values)) {
    return { pass: false, note: 'Lume returned an unreadable VM inventory; concurrency cannot be verified' };
  }
  let running = values.filter(value => ['running', 'starting'].includes(stateOf(value))).length;
  if (run) {
    const tart = run('tart', ['list', '--source', 'local', '--format', 'json'], {
      encoding: 'utf8', shell: false, timeout: 5_000, maxBuffer: 1024 * 1024,
    });
    if (tart.error?.code !== 'ENOENT') {
      const tartValues = parseJson(tart.stdout);
      if (tart.error || tart.status !== 0 || !Array.isArray(tartValues)) {
        return { pass: false, note: 'Lume cannot verify the cross-backend Apple guest limit through Tart' };
      }
      running += tartValues.filter(value => (
        value?.Running === true || ['running', 'starting'].includes(stateOf(value))
      )).length;
    }
  }
  return running >= 2
    ? { pass: false, note: 'Apple permits at most two concurrent macOS guests; stop one Lume VM and retry' }
    : { pass: true };
}

const LUME_DRIVER = {
  backend: 'lume',
  binary: 'lume',
  lockName: 'apple-macos-guests',
  os: 'macos',
  defaultSeed: DEFAULT_LUME_SEED,
  seedCheckArgs: seed => ['get', seed, '--format', 'json'],
  seedReady: lumeSeedReady,
  seedFix: seed => `lume create ${seed} --os macos --ipsw latest --unattended tahoe --cpu 4 --memory 8GB --disk-size 80GB --no-display`,
  preflight: lumePreflight,
  cloneArgs: (seed, vmName) => ['clone', seed, vmName],
  configureArgs: (vmName, manifest) => [
    'set', vmName,
    '--cpu', String(manifest.resources.cpu),
    '--memory', manifest.resources.memory,
  ],
  startArgs: vmName => ['run', vmName, '--display', 'none'],
  stopViaLauncher: true,
  ownershipArgs: vmName => ['get', vmName, '--format', 'json'],
  ownershipMarker: lumeOwnershipMarker,
  readyArgs: vmName => ['ssh', vmName, '--timeout', '10', '--', '/usr/bin/true'],
  execArgs: (vmName, command, timeout) => [
    'ssh', vmName, '--timeout', String(timeout), '--', `/bin/bash -lc ${shellQuote(command)}`,
  ],
  scanArgs: (vmName, command, timeout) => [
    'ssh', vmName, '--timeout', String(timeout), '--', `/bin/sh -c ${shellQuote(command)}`,
  ],
  stopArgs: vmName => ['stop', vmName],
  stoppedArgs: vmName => ['get', vmName, '--format', 'json'],
  stopped: lumeGuestStopped,
  deleteArgs: vmName => ['delete', vmName, '--force'],
  missingInstance: result => /(?:not found|does not exist|no virtual machine)/i.test(
    `${result.stderr || ''}\n${result.stdout || ''}`
  ),
  cleanupFix: vmName => `lume stop ${vmName} && lume delete ${vmName} --force`,
  notes: ['Lume 0.5.1 combines remote stdout and stderr in its noninteractive SSH output'],
};

function executeLume(manifest, options = {}) {
  // DECISION: CONVENTIONS item 28 clones a stopped SSH-ready local seed and
  // owns Lume's display-free launcher as a dedicated process group so cleanup
  // can stop its helper descendants before deleting the clone, without mounts.
  return executeVm(manifest, {
    ...options,
    driver: LUME_DRIVER,
    seed: options.seed || process.env.ECC_SANDBOX_LUME_SEED || DEFAULT_LUME_SEED,
    start: options.start || (options.mock ? undefined : startLume),
  });
}

module.exports = {
  DEFAULT_LUME_SEED,
  LUME_DRIVER,
  descendantsOf,
  executeLume,
  lumeOwnershipMarker,
  lumePreflight,
  lumeSeedReady,
  processGroupIsAlive,
  readProcessTable,
  readProcessIdentity,
  shellQuote,
  startLume,
};
